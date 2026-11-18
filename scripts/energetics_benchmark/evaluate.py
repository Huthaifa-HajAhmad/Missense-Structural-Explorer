"""Aggregate engine caches, compute protein-clustered bootstrap metrics, and emit results.json / results.md."""
from __future__ import annotations

import collections
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from common import BENCH_DIR, CACHE_DIR, ENGINE_SIGN_CONVENTIONS, atomic_write_json, read_jsonl, to_canonical_ddg
from metrics import MIN_REGRESSION_N, MIN_ROC_CLASS_N, summarize_regression, summarize_ssym_pairs
from published_refs import PUBLISHED_METRICS

ENGINES = ["foldx", "thermompnn", "stabilityoracle", "rasp", "dynamut2", "ddmut", "protvar"]
LABELS = {
    "foldx": "FoldX",
    "thermompnn": "ThermoMPNN",
    "stabilityoracle": "StabilityOracle",
    "rasp": "RaSP (SQLite)",
    "dynamut2": "DynaMut2",
    "ddmut": "DDMut",
    "protvar": "ProtVar FoldX",
}
DATASETS = ["s669", "ssym_direct", "ssym_reverse"]
HUMAN_ONLY_ENGINES = {"rasp", "protvar"}
IN_PROGRESS_ENGINES = {"dynamut2", "ddmut"}
LARGE_HYDROPHOBIC = set("WFYLIMV")
SMALL_ACCEPTOR = set("AG")

_CA_COORD_CACHE: dict[str, dict[int, tuple[float, float, float]]] = {}


def _is_human(row: dict) -> bool:
    return (row.get("organism") or "").strip().lower() == "homo sapiens"


def _load_engine_cache(engine: str, ds: str) -> dict[str, dict]:
    jsonl = CACHE_DIR / f"{engine}_{ds}.jsonl"
    jfile = CACHE_DIR / f"{engine}_{ds}.json"
    rows = read_jsonl(jsonl) if jsonl.exists() else (json.loads(jfile.read_text(encoding="utf-8")) if jfile.exists() else [])
    out = {r["id"]: r for r in rows if "id" in r}
    bdir = CACHE_DIR / "biosig" / engine
    if bdir.is_dir():
        for fp in sorted(bdir.glob(f"{ds}__*.json")):
            rec = json.loads(fp.read_text(encoding="utf-8"))
            if "id" in rec and (rec["id"] not in out or rec.get("status") == "ok"):
                out[rec["id"]] = rec
    return out


def _normalize_missing_reason(engine: str, ds: str, row: dict, rec: dict | None) -> str:
    if engine in HUMAN_ONLY_ENGINES:
        if ds == "ssym_reverse":
            return "not_applicable_wt_lookup (WT human AF2 only; mutant PDBs excluded)"
        if not _is_human(row):
            return "non_human_protein"
        if rec is None:
            return "not_run_yet"
        st = rec.get("status") or "unknown"
        if st == "no_uniprot_map":
            return "human_no_uniprot_map"
        if st == "miss":
            return "human_not_in_precomputed_db"
        if st == "fragment_disagreement":
            return "human_fragment_disagreement"
        err = (rec.get("error") or "").strip()
        return f"human_{st}: {err[:80]}" if err else f"human_{st}"

    if rec is None:
        return "not_run_yet (run in progress)" if engine in IN_PROGRESS_ENGINES else "not_run_yet"
    st = rec.get("status") or "unknown"
    err = (rec.get("error") or "").strip()
    if st == "running":
        return "running (in progress)"
    if st == "timeout":
        return f"timeout ({err[:60]})" if err else "timeout"
    if "BuildModel" in err and "foldx" in err.lower():
        return "FoldX BuildModel error (missing adjacent residue / repair)"
    if "HTTP Error 422" in err:
        return "HTTP 422 Unprocessable Entity (missing adjacent residue)"
    if "HTTP Error 400" in err:
        return "HTTP 400 Bad Request (PDB2PQR failed)"
    if err:
        return f"{st}: {err[:80]}"
    return st


def _ca_neighbors_8a(clean_pdb_path: str, pos: int) -> int:
    key = str(clean_pdb_path)
    if key not in _CA_COORD_CACHE:
        p = pathlib.Path(key)
        if not p.exists():
            p = CACHE_DIR / "clean_pdb" / p.name
        coords: dict[int, tuple[float, float, float]] = {}
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.startswith("ATOM") and line[12:16].strip() == "CA":
                    try:
                        rseq = int(line[22:26])
                        coords[rseq] = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
                    except ValueError:
                        continue
        _CA_COORD_CACHE[key] = coords
    coords = _CA_COORD_CACHE[key]
    if pos not in coords:
        return 0
    tx, ty, tz = coords[pos]
    return sum(
        1
        for rseq, (x, y, z) in coords.items()
        if rseq != pos and (x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2 <= 64.0
    )


def _eval_split(engine: str, ds: str, ds_rows: list[dict], preds: dict[str, dict], heldout_only: bool) -> dict:
    pool = [
        r for r in ds_rows
        if not heldout_only or (r["heldout"][engine]["heldout"] and not r.get("no_accession", False))
    ]
    conv = ENGINE_SIGN_CONVENTIONS[engine]
    scored_items: list[dict] = []
    missing_counts: collections.Counter[str] = collections.Counter()

    for r in pool:
        rec = preds.get(r["id"])
        if rec and rec.get("status") == "ok" and isinstance(rec.get("raw_ddg"), (int, float)):
            scored_items.append({
                "cluster": r["cluster"],
                "measured": float(r["measured"]),
                "pred": to_canonical_ddg(float(rec["raw_ddg"]), conv),
            })
        else:
            missing_counts[_normalize_missing_reason(engine, ds, r, rec)] += 1

    n_dataset = len(pool)
    if engine in HUMAN_ONLY_ENGINES:
        eligible = 0 if ds == "ssym_reverse" else sum(1 for r in pool if _is_human(r))
    else:
        eligible = n_dataset

    attempted = sum(1 for r in pool if r["id"] in preds)
    n_scored = len(scored_items)
    cov = (n_scored / eligible) if eligible else 0.0
    ds_cov = (n_scored / n_dataset) if n_dataset else 0.0
    stats = summarize_regression(scored_items, threshold_kcal=1.0, n_boot=2000, seed=42)
    run_in_progress = engine in IN_PROGRESS_ENGINES and n_scored < eligible
    partial_set = engine in HUMAN_ONLY_ENGINES

    return {
        "n_dataset": n_dataset,
        "eligible": eligible,
        "attempted": attempted,
        "scored": n_scored,
        "n_groups": stats["n_groups"],
        "n_pos": stats["n_pos"],
        "n_neg": stats["n_neg"],
        "coverage": cov,
        "dataset_coverage": ds_cov,
        "partial_set": partial_set,
        "run_in_progress": run_in_progress,
        "missing_total": n_dataset - n_scored,
        "missing_reasons": dict(sorted(missing_counts.items(), key=lambda kv: (-kv[1], kv[0]))),
        "stats": stats,
    }


def _eval_ssym_pairs(engine: str, datasets: dict, d_preds: dict, r_preds: dict, heldout_only: bool) -> dict:
    rev_by_pair = {r["pair_id"]: r for r in datasets["ssym_reverse"]}
    conv = ENGINE_SIGN_CONVENTIONS[engine]
    pairs = []
    eligible_pairs = 0
    for r in datasets["ssym_direct"]:
        rr = rev_by_pair.get(r["pair_id"])
        if heldout_only:
            if not r["heldout"][engine]["heldout"] or r.get("no_accession", False):
                continue
            if not rr or not rr["heldout"][engine]["heldout"] or rr.get("no_accession", False):
                continue
        eligible_pairs += 1
        dp = d_preds.get(r["id"])
        rp = r_preds.get(rr["id"]) if rr else None
        if dp and rp and dp.get("status") == "ok" and rp.get("status") == "ok":
            pairs.append({
                "cluster": r["cluster"],
                "dir": to_canonical_ddg(float(dp["raw_ddg"]), conv),
                "inv": to_canonical_ddg(float(rp["raw_ddg"]), conv),
            })
    summary = summarize_ssym_pairs(pairs, n_boot=2000, seed=42)
    run_in_progress = engine in IN_PROGRESS_ENGINES and len(pairs) < eligible_pairs
    return {
        "eligible_pairs": 0 if engine in HUMAN_ONLY_ENGINES else eligible_pairs,
        "n_pairs": summary["n_pairs"],
        "n_groups": summary["n_groups"],
        "partial_set": engine in HUMAN_ONLY_ENGINES,
        "run_in_progress": run_in_progress,
        "stats": summary,
    }


def _a5_signed_examples(engine: str, ds_rows: list[dict], preds: dict[str, dict], k: int = 5) -> dict:
    conv = ENGINE_SIGN_CONVENTIONS[engine]
    cands = []
    for r in ds_rows:
        if r["wt"] not in LARGE_HYDROPHOBIC or r["mut"] not in SMALL_ACCEPTOR:
            continue
        rec = preds.get(r["id"])
        if not rec or rec.get("status") != "ok" or not isinstance(rec.get("raw_ddg"), (int, float)):
            continue
        nb8 = _ca_neighbors_8a(r["clean_pdb"], int(r["pos"]))
        raw = float(rec["raw_ddg"])
        converted = to_canonical_ddg(raw, conv)
        meas = float(r["measured"])
        agree = (meas > 0 and converted > 0) or (meas < 0 and converted < 0)
        cands.append((
            1 if nb8 >= 10 else 0,
            1 if meas > 0 else 0,
            nb8,
            meas,
            r["id"],
            {
                "id": r["id"],
                "mutation": r["mutation"],
                "ca_neighbors_8a": nb8,
                "measured": meas,
                "raw_ddg": raw,
                "converted_ddg": converted,
                "sign_agrees": agree,
            },
        ))
    cands.sort(key=lambda x: (x[0], x[1], x[2], x[3], x[4]), reverse=True)
    examples = [x[5] for x in cands[:k]]
    n_destab = sum(1 for ex in examples if ex["measured"] > 0)
    n_agree = sum(1 for ex in examples if ex["sign_agrees"])
    n_destab_agree = sum(1 for ex in examples if ex["measured"] > 0 and ex["sign_agrees"])
    return {
        "n_candidates": len(cands),
        "n_examples": len(examples),
        "n_destab_examples": n_destab,
        "n_agree": n_agree,
        "n_destab_agree": n_destab_agree,
        "examples": examples,
    }


def _evaluate_criteria(engine: str, res: dict, a5: dict) -> dict:
    # A5: sign & units
    s669_a5 = a5["s669"]
    ssym_a5 = a5["ssym_direct"]
    ssym_dir_all = res["ssym_direct"]["all"]
    ssym_r = (ssym_dir_all["stats"].get("pearson") or {}).get("point")

    if ssym_dir_all["run_in_progress"] and ssym_a5["n_examples"] == 0:
        a5_verdict = "unverified (run in progress)"
    elif ssym_r is None or s669_a5["n_examples"] == 0 or ssym_a5["n_examples"] == 0:
        a5_verdict = "unverified (too few / no WFYLIMV->AG scored)"
    elif ssym_r <= 0:
        a5_verdict = "fail (negative Ssym direct Pearson r)"
    elif s669_a5["n_agree"] >= 4 and ssym_a5["n_agree"] >= 4:
        counts = f"s669 {s669_a5['n_agree']}/{s669_a5['n_examples']}, ssym_dir {ssym_a5['n_agree']}/{ssym_a5['n_examples']}"
        if ssym_dir_all["partial_set"]:
            a5_verdict = f"pass (partial set; {counts})"
        elif ssym_dir_all["run_in_progress"]:
            a5_verdict = f"pass (run in progress; {counts})"
        else:
            a5_verdict = f"pass ({counts})"
    else:
        a5_verdict = "fail (signed examples disagree)"

    # A6: agreement with published paper (Pearson r per dataset)
    a6_details = {}
    a6_states = []
    for ds in DATASETS:
        row = res[ds]["all"]
        pub = PUBLISHED_METRICS.get((engine, ds), {})
        pub_r = pub.get("r")
        if pub_r is None or (engine == "ddmut" and ds == "s669"):
            a6_details[ds] = "no comparator"
            continue
        if row["partial_set"]:
            a6_details[ds] = "unverified (partial set)"
            a6_states.append("unverified")
            continue
        if row["run_in_progress"]:
            a6_details[ds] = "unverified (run in progress)"
            a6_states.append("unverified")
            continue
        pr = row["stats"].get("pearson")
        if pr is None:
            a6_details[ds] = "too few"
            a6_states.append("unverified")
            continue
        lo, hi = pr.get("ci_low"), pr.get("ci_high")
        if hi is not None and hi < pub_r:
            a6_details[ds] = f"fail (CI [{lo:.3f}, {hi:.3f}] < {pub_r:.2f})"
            a6_states.append("fail")
        else:
            a6_details[ds] = f"pass (CI [{lo:.3f}, {hi:.3f}] vs {pub_r:.2f})"
            a6_states.append("pass")
    if "fail" in a6_states:
        a6_verdict = "fail"
    elif a6_states and all(s == "pass" for s in a6_states):
        a6_verdict = "pass"
    elif not a6_states:
        a6_verdict = "no comparator"
    else:
        a6_verdict = "unverified"

    # A7: held-out proteins (ROC AUC lower 95% CI > 0.5 on S669 held-out)
    ho = res["s669"]["heldout"]
    roc = ho["stats"].get("roc_auc")
    if ho["run_in_progress"] and roc is None:
        a7_verdict = "too few to judge (run in progress)"
    elif ho["n_pos"] < MIN_ROC_CLASS_N or ho["n_neg"] < MIN_ROC_CLASS_N or roc is None:
        a7_verdict = "too few to judge"
    elif ho["run_in_progress"]:
        lo = roc.get("ci_low")
        a7_verdict = f"unverified (run in progress; provisional AUC CI [{lo:.3f}, {roc['ci_high']:.3f}])"
    elif roc.get("ci_low") is not None and roc["ci_low"] > 0.5:
        a7_verdict = "pass (partial set)" if ho["partial_set"] else "pass"
    else:
        a7_verdict = "fail"

    return {
        "A5": a5_verdict,
        "A6": a6_verdict,
        "A6_by_dataset": a6_details,
        "A7": a7_verdict,
    }


def _fmt_stat(stats: dict | None, key: str) -> str:
    if not stats:
        return "too few to judge" if key == "roc_auc" else "too few"
    b = stats.get(key)
    if not b or b.get("point") is None:
        return "too few to judge" if key == "roc_auc" else "too few"
    if b.get("ci_low") is None:
        return f"{b['point']:.3f}"
    return f"{b['point']:.3f} [{b['ci_low']:.3f}, {b['ci_high']:.3f}]"


def _fmt_cov(row: dict) -> str:
    if row["partial_set"]:
        if row["eligible"] == 0:
            return f"0/0 human WT ({row['scored']}/{row['n_dataset']} total)"
        return f"{row['scored']}/{row['eligible']} human ({row['coverage']*100:.1f}%; {row['scored']}/{row['n_dataset']} total)"
    return f"{row['scored']}/{row['eligible']} ({row['coverage']*100:.1f}%)"


def _fmt_status(row: dict) -> str:
    flags = []
    if row["partial_set"]:
        flags.append("partial set")
    if row["run_in_progress"]:
        flags.append("run in progress")
    if not flags:
        if row["n_dataset"] == 0:
            flags.append("0 held-out variants")
        elif row["scored"] == row["eligible"] and row["eligible"] > 0:
            flags.append("complete")
        else:
            flags.append("complete (with misses)")
    return ", ".join(flags)


def _caveat_lines(summary: dict) -> list[str]:
    fx_rev = summary["results"]["foldx"]["ssym_reverse"]["all"]
    dm2_s = summary["results"]["dynamut2"]["s669"]["all"]
    dm2_d = summary["results"]["dynamut2"]["ssym_direct"]["all"]
    dm2_r = summary["results"]["dynamut2"]["ssym_reverse"]["all"]
    ddm_s = summary["results"]["ddmut"]["s669"]["all"]
    ddm_d = summary["results"]["ddmut"]["ssym_direct"]["all"]
    return [
        "\n## Local Execution & Failure Caveats\n",
        "| Engine | Scope / Condition | Exact Status & Reason |",
        "| --- | --- | --- |",
        "| FoldX | `s669` (`3DV0I_V129A`, `3DV0I_V129G`) | `BuildModel` exited non-zero (`wt_Repair` lacks adjacent residue 128). |",
        f"| FoldX | `ssym_reverse` | {fx_rev['scored']}/{fx_rev['eligible']} unique mutant crystal PDBs completed locally (`RepairPDB` + 5x `BuildModel` per PDB). |",
        "| ThermoMPNN | `s669` (`3DV0I_V129A`, `3DV0I_V129G`) | Sidecar HTTP 422 (missing adjacent residue 128 in `3DV0_I.pdb`). |",
        "| StabilityOracle | `s669` (31 `3DV0I`), `ssym_direct` (5 `5PTIA`) | Sidecar HTTP 400: `PDB2PQR could not add hydrogens to this chain`. |",
        "| RaSP / ProtVar | `s669`, `ssym_direct`, `ssym_reverse` | Human WT proteome lookups only (`partial set`); `ssym_reverse` marked `not_applicable_wt_lookup` (`0` human WT eligible). |",
        f"| DynaMut2 | BioSig queue (`run in progress`, `seed 42`) | `s669`: {dm2_s['scored']}/{dm2_s['eligible']}, `ssym_direct`: {dm2_d['scored']}/{dm2_d['eligible']}, `ssym_reverse`: {dm2_r['scored']}/{dm2_r['eligible']}. |",
        f"| DDMut | BioSig queue (`run in progress`, `seed 42`) | `s669`: {ddm_s['scored']}/{ddm_s['eligible']}, `ssym_direct`: {ddm_d['scored']}/{ddm_d['eligible']}. |",
    ]


def _render_md(summary: dict) -> str:
    lines: list[str] = [
        "# Energetics Benchmark Report (S669 & Ssym)\n",
        "- **Sign convention**: `positive = destabilizing` (kcal/mol). `DynaMut2` and `DDMut` raw outputs are negated; `FoldX`, `ThermoMPNN`, `StabilityOracle`, `RaSP`, and `ProtVar FoldX` are positive-destabilizing natively.",
        "- **Bootstrap grouping**: 2,000 draws (seed 42) resampling whole **proteins** by UniProt accession (rows with missing accession get a `PDB_chain` group and `no_accession: true`, and are excluded from all held-out sets; Ssym direct and reverse partners share the same protein group).",
        f"- **Sample-size thresholds**: Spearman / Pearson / RMSE require `n >= {MIN_REGRESSION_N}` scored variants (otherwise `too few`); ROC AUC and A7 require `>= {MIN_ROC_CLASS_N}` destabilizing (`measured >= 1.0`) and `>= {MIN_ROC_CLASS_N}` other variants (otherwise `too few to judge`).\n",
    ]

    lines.append("## Release Criteria Summary (A5, A6, A7)\n")
    lines.append("| Engine | Status | A5 (Sign & Units) | A6 (Paper Agreement, All) | A7 (S669 Held-Out AUC > 0.5) | S669 Held-Out n (Destab/Other, Groups) |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for eng in ENGINES:
        crit = summary["criteria"][eng]
        ho = summary["results"][eng]["s669"]["heldout"]
        a6_str = f"{crit['A6']} (" + "; ".join(f"{ds}: {v}" for ds, v in crit["A6_by_dataset"].items()) + ")"
        lines.append(
            f"| {LABELS[eng]} | {_fmt_status(summary['results'][eng]['s669']['all'])} | {crit['A5']} | {a6_str} | {crit['A7']} | "
            f"{ho['scored']}/{ho['eligible']} ({ho['n_pos']}/{ho['n_neg']}, {ho['n_groups']} grp) |"
        )
    lines.append("")

    for split in ("all", "heldout"):
        title = "All Variants" if split == "all" else "Strictly Held-Out (UniProt-matched, <25% seq id, excl. same UniProt/PDB & unmatched)"
        lines.append(f"## Benchmark Results ({title})\n")
        for ds in DATASETS:
            lines.append(f"### {ds}\n")
            lines.append("| Engine | Status | Scored / Eligible | Proteins | Destab / Other | Spearman rho [95% CI] | Pearson r [95% CI] | RMSE [95% CI] | ROC AUC [95% CI] | Pub. r | Pub. RMSE |")
            lines.append("| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |")
            for eng in ENGINES:
                row = summary["results"][eng][ds][split]
                st = row.get("stats")
                pub = PUBLISHED_METRICS.get((eng, ds), {})
                pr = f"{pub['r']:.2f}" if isinstance(pub.get("r"), (int, float)) else "-"
                prmse = f"{pub['rmse']:.2f}" if isinstance(pub.get("rmse"), (int, float)) else "-"
                lines.append(
                    f"| {LABELS[eng]} | {_fmt_status(row)} | {_fmt_cov(row)} | {row['n_groups']} | {row['n_pos']} / {row['n_neg']} | "
                    f"{_fmt_stat(st, 'spearman')} | {_fmt_stat(st, 'pearson')} | "
                    f"{_fmt_stat(st, 'rmse')} | {_fmt_stat(st, 'roc_auc')} | {pr} | {prmse} |"
                )
            lines.append("")

    lines.append("## Ssym Antisymmetry (Direct vs Reverse)\n")
    lines.append("| Engine | Split | Status | Pairs | Proteins | r_dir_inv [95% CI] | mean(dir+inv)/2 [95% CI] | Pub. r_dir_inv | Pub. delta (dir+inv) |")
    lines.append("| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: |")
    for eng in ENGINES:
        for split in ("all", "heldout"):
            row = summary["antisymmetry"][eng][split]
            st = row.get("stats")
            pub = PUBLISHED_METRICS.get((eng, "ssym_reverse"), {})
            prdi = f"{pub['r_dir_inv']:.2f}" if isinstance(pub.get("r_dir_inv"), (int, float)) else "-"
            pdel = f"{pub['mean_bias_sum']:.2f}" if isinstance(pub.get("mean_bias_sum"), (int, float)) else "-"
            status = "partial set" if row["partial_set"] else ("run in progress" if row["run_in_progress"] else "complete")
            lines.append(
                f"| {LABELS[eng]} | {split} | {status} | {row['n_pairs']} | {row['n_groups']} | "
                f"{_fmt_stat(st, 'r_dir_inv')} | {_fmt_stat(st, 'mean_bias')} | {prdi} | {pdel} |"
            )

    lines.append("\n## Missing Variants & Coverage Breakdown\n")
    lines.append("| Engine | Dataset | Split | Dataset Total | Eligible | Scored | Missing | Missing Reasons |")
    lines.append("| --- | --- | --- | ---: | ---: | ---: | ---: | --- |")
    for eng in ENGINES:
        for ds in DATASETS:
            for split in ("all", "heldout"):
                row = summary["results"][eng][ds][split]
                if row["missing_total"] > 0:
                    reasons_str = "; ".join(f"{cnt}x {reason}" for reason, cnt in row["missing_reasons"].items())
                    lines.append(
                        f"| {LABELS[eng]} | {ds} | {split} | {row['n_dataset']} | {row['eligible']} | {row['scored']} | {row['missing_total']} | {reasons_str} |"
                    )

    lines.append("\n## A5 Signed-Example Check (Five Large Buried W/F/Y/L/I/M/V -> A/G per Engine & Dataset)\n")
    lines.append("Buried residues selected by CA neighbors within 8 A (`>= 10`) prioritizing `measured > 0`. Canonical convention: `positive = destabilizing`.\n")
    lines.append("| Engine | Dataset | Variant | Mutation | CA <=8A | Measured | Raw Engine | Converted | Sign Agrees |")
    lines.append("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |")
    for eng in ENGINES:
        for ds in DATASETS:
            a5 = summary["a5_signed_examples"][eng][ds]
            if not a5["examples"]:
                note = "not applicable (WT human lookup)" if (eng in HUMAN_ONLY_ENGINES and ds == "ssym_reverse") else "0 scored WFYLIMV->AG"
                lines.append(f"| {LABELS[eng]} | {ds} | - | - | - | - | - | - | {note} |")
                continue
            for ex in a5["examples"]:
                agree_str = "Yes" if ex["sign_agrees"] else "No"
                lines.append(
                    f"| {LABELS[eng]} | {ds} | {ex['id']} | {ex['mutation']} | {ex['ca_neighbors_8a']} | "
                    f"{ex['measured']:+.2f} | {ex['raw_ddg']:+.3f} | {ex['converted_ddg']:+.3f} | {agree_str} |"
                )

    lines.append("\n## Published Reference Citations & Factual Caveats\n")
    lines.append("| Engine | Dataset | Published Source | URL | Caveat |")
    lines.append("| --- | --- | --- | --- | --- |")
    for (eng, ds), info in PUBLISHED_METRICS.items():
        lines.append(f"| {LABELS[eng]} | {ds} | {info['citation']} | {info['url']} | {info['note']} |")
    lines.extend(_caveat_lines(summary))
    return "\n".join(lines) + "\n"


def main() -> None:
    datasets = json.loads((CACHE_DIR / "datasets.json").read_text(encoding="utf-8"))
    results, antisym, a5_checks, criteria = {}, {}, {}, {}
    for eng in ENGINES:
        caches = {ds: _load_engine_cache(eng, ds) for ds in DATASETS}
        results[eng] = {
            ds: {
                "all": _eval_split(eng, ds, datasets[ds], caches[ds], False),
                "heldout": _eval_split(eng, ds, datasets[ds], caches[ds], True),
            }
            for ds in DATASETS
        }
        antisym[eng] = {
            "all": _eval_ssym_pairs(eng, datasets, caches["ssym_direct"], caches["ssym_reverse"], False),
            "heldout": _eval_ssym_pairs(eng, datasets, caches["ssym_direct"], caches["ssym_reverse"], True),
        }
        a5_checks[eng] = {ds: _a5_signed_examples(eng, datasets[ds], caches[ds], k=5) for ds in DATASETS}
        criteria[eng] = _evaluate_criteria(eng, results[eng], a5_checks[eng])
    summary = {
        "sign_convention": "positive=destabilizing (kcal/mol)",
        "bootstrap_draws": 2000,
        "min_regression_n": MIN_REGRESSION_N,
        "min_roc_class_n": MIN_ROC_CLASS_N,
        "criteria": criteria,
        "a5_signed_examples": a5_checks,
        "results": results,
        "antisymmetry": antisym,
    }
    atomic_write_json(BENCH_DIR / "results.json", summary)
    (BENCH_DIR / "results.md").write_text(_render_md(summary), encoding="utf-8")
    print("Wrote results.json and results.md", flush=True)


if __name__ == "__main__":
    main()
