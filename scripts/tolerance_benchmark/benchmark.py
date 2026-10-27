"""Offline benchmark of residue-level missense-tolerance signals against ClinVar and gnomAD.

  python -I scripts/tolerance_benchmark/benchmark.py

Reads data/<GENE>.json.gz (built by fetch.py) and thresholds.json (pre-registered). Writes results.json and
results.md next to this file and prints the grade. No network.
"""
import gzip
import hashlib
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from metrics import (auprc, auroc, bootstrap, codon_background, decile_edges, decile_of, lr_positive,  # noqa: E402
                     mosy, odds_ratio, paired_bootstrap_diff, window)
from sources import CODON  # noqa: E402

AA3 = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
       "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V"}
HALF = 10  # MetaDome sw10: 21-residue window


def load(gene):
    with gzip.open(HERE / "data" / f"{gene}.json.gz", "rt", encoding="utf-8") as fh:
        return json.load(fh)


def counted(s):
    """In-house counting rule (fixed before results): a distinct SNV allele observed with AC>0 and no
    filter flag in the exome or the genome callset."""
    ex = s["exomeAc"] and s["exomeAc"] > 0 and s["exomeFilters"] == []
    ge = s["genomeAc"] and s["genomeAc"] > 0 and s["genomeFilters"] == []
    return bool(ex or ge)


def ac_of(s):
    if s["jointAc"] is not None:
        return s["jointAc"]
    return (s["exomeAc"] or 0) + (s["genomeAc"] or 0)


def residue_scores(rec):
    L = len(rec["protein"])
    prot = rec["protein"]
    out = {"metadome": [None] * L, "mtr3daf2": [None] * L, "ccr": [None] * L, "rmc_oe": [None] * L}
    checks = {}

    md = rec["candidates"]["metadomeRaw"]
    mism = 0
    for k, v in md.items():
        r = int(k)
        if 1 <= r <= L and v["sw_dn_ds"] is not None:
            if v["ref_aa"] != prot[r - 1]:
                mism += 1
                continue
            out["metadome"][r - 1] = v["sw_dn_ds"]
    checks["metadome"] = {"refAaMismatch": mism, "transcriptVersioned": True}

    mt = rec["candidates"]["mtr3daf2Raw"]
    mism = 0
    tx = set()
    for k, v in mt.items():
        r = int(k)
        tx.add(v["transcript"])
        if 1 <= r <= L and v["a11"] is not None:
            if AA3.get(v["resid"]) != prot[r - 1]:
                mism += 1
                continue
            out["mtr3daf2"][r - 1] = v["a11"]
    checks["mtr3daf2"] = {"refAaMismatch": mism, "transcriptVersioned": False, "transcripts": sorted(tx)}

    g37 = rec["grch37"]
    if g37["identicalProtein"] and g37["codonPositions"]:
        rows = rec["candidates"]["ccrRows"]
        labels = sorted({r["gene"] for r in rows})
        for i, codon in enumerate(g37["codonPositions"][:L]):
            vals = [r["pct"] for r in rows for p in codon if r["start0"] < p <= r["end"]]
            if vals:
                out["ccr"][i] = max(vals)
        checks["ccr"] = {"identicalProteinGRCh37": True, "grch37Version": g37["version"], "rowsInWindow": len(rows), "geneLabels": labels}
    else:
        checks["ccr"] = {"identicalProteinGRCh37": False}

    for reg in rec["regions"]:
        lo, hi = reg["residues"]
        for r in range(lo, hi + 1):
            out["rmc_oe"][r - 1] = reg["oe"]
    return out, checks


def inhouse(rec):
    """MetaDome's formula on the counted gnomAD v4.1 SNVs; returns per-residue arrays needed for LOO."""
    L = len(rec["protein"])
    cds = rec["cds"]
    mis_bg, syn_bg = [], []
    for i in range(L):
        m, s = codon_background(cds[3 * i:3 * i + 3], CODON)
        mis_bg.append(m)
        syn_bg.append(s)
    mis, syn = [0] * L, [0] * L
    counted_ids = set()
    for s in rec["snvs"]:
        if not counted(s) or not (1 <= s["residue"] <= L):
            continue
        if s["csq"] == "missense":
            mis[s["residue"] - 1] += 1
            counted_ids.add(s["id"])
        elif s["csq"] == "synonymous":
            syn[s["residue"] - 1] += 1
    sums = []
    for i in range(L):
        lo, hi = window(i, L, HALF)
        sums.append((sum(mis[lo:hi]), sum(mis_bg[lo:hi]), sum(syn[lo:hi]), sum(syn_bg[lo:hi])))
    score = [mosy(*t) for t in sums]
    n_obs = [t[0] + t[2] for t in sums]
    return score, sums, counted_ids, n_obs


def variant_sets(rec):
    L = len(rec["protein"])
    ok = lambda v: v["csq"] == "missense" and 2 <= v["residue"] <= L  # noqa: E731  residue 1 is start loss
    cv = {}
    for v in rec["clinvar"]:
        if ok(v):
            cv.setdefault(v["id"], v)
    plp = [v for v in cv.values() if v["class"] == "plp" and (v["stars"] or 0) >= 1]
    blb = [v for v in cv.values() if v["class"] == "blb" and (v["stars"] or 0) >= 1]
    exclude = {v["id"] for v in cv.values() if v["class"] == "plp" or "conflicting" in str(v["significance"]).lower()}
    gn = {}
    for s in rec["snvs"]:
        if ok(s) and counted(s) and s["id"] not in exclude:
            gn.setdefault(s["id"], s)
    gn = list(gn.values())
    return {
        "plp": plp,
        "blb": blb,
        "gnomad_ac2": [s for s in gn if ac_of(s) >= 2],
        "gnomad_singleton": [s for s in gn if ac_of(s) == 1],
        "gnomad_ac10": [s for s in gn if ac_of(s) >= 10],
    }


CONTRAST_NEG = {"plp_vs_gnomad_ac2": "gnomad_ac2", "plp_vs_gnomad_singleton": "gnomad_singleton",
                "plp_vs_gnomad_ac10": "gnomad_ac10", "plp_vs_blb": "blb"}


def evaluate(rec, th):
    L = len(rec["protein"])
    res, checks = residue_scores(rec)
    ih_score, ih_sums, ih_counted, ih_n = inhouse(rec)
    res["inhouse"] = ih_score
    sets = variant_sets(rec)
    boot = th["bootstrap"]
    directions = {**{k: v["direction"] for k, v in th["candidates"].items()}, **{k: v["direction"] for k, v in th["baseline"].items()}}

    def oriented(name, value):
        if value is None:
            return None
        return -value if directions[name] == "lower_is_intolerant" else value

    def vscore(name, v):
        r = v["residue"]
        if name != "inhouse":
            return oriented(name, res[name][r - 1])
        mis_sum, mis_bg, syn_sum, syn_bg = ih_sums[r - 1]
        if v["id"] in ih_counted:  # leave the variant itself out of its own window
            mis_sum -= 1
        return oriented(name, mosy(mis_sum, mis_bg, syn_sum, syn_bg))

    gene = {"gene": rec["gene"], "transcript": rec["transcript"], "length": L, "checks": checks,
            "clinvarRelease": rec["provenance"]["clinvarRelease"],
            "sets": {k: len(v) for k, v in sets.items()}, "regions": [{k: r[k] for k in ("residues", "oe", "p", "n")} for r in rec["regions"]],
            "refMismatch": rec["refMismatch"], "clinvarRefMismatch": rec["clinvarRefMismatch"], "candidates": {}}
    w = sorted(ih_n)
    gene["windowN"] = {"median": statistics.median(w), "p10": w[int(0.1 * (len(w) - 1))], "min": w[0],
                       "fracBelow10": sum(1 for x in w if x < 10) / len(w)}

    for name in list(th["candidates"]) + list(th["baseline"]):
        scored = [oriented(name, x) for x in res[name] if x is not None]
        c = {"residueCoverage": len(scored) / L, "residuesScored": len(scored), "contrasts": {}}
        if len(set(scored)) < 2:
            c["note"] = "constant or empty across the gene: no within-gene ranking possible"
        edges = decile_edges(scored) if scored else None
        if scored:
            c["residuesPerDecile"] = [sum(1 for x in scored if decile_of(x, edges) == k) for k in range(1, 11)]
        for cname, neg_key in CONTRAST_NEG.items():
            P = [vscore(name, v) for v in sets["plp"]]
            N = [vscore(name, v) for v in sets[neg_key]]
            Pk, Nk = [x for x in P if x is not None], [x for x in N if x is not None]
            out = {"nPos": len(P), "nNeg": len(N), "nPosScored": len(Pk), "nNegScored": len(Nk)}
            if Pk and Nk and edges is not None and len(set(scored)) >= 2:
                out["auroc"] = auroc(Pk, Nk)
                out["aurocCI"] = bootstrap(Pk, Nk, auroc, boot["iterations"], boot["seed"])
                out["auprc"] = auprc(Pk, Nk)
                out["auprcBaseline"] = len(Pk) / (len(Pk) + len(Nk))
                dp = [decile_of(x, edges) for x in Pk]
                dn = [decile_of(x, edges) for x in Nk]
                rows = []
                for k in range(1, 11):
                    a, b = dp.count(k), dn.count(k)
                    orr, lo, hi = odds_ratio(a, b, len(Pk) - a, len(Nk) - b)
                    rows.append({"decile": k, "pos": a, "neg": b, "or": orr, "orCI": [lo, hi]})
                out["deciles"] = rows
                a, b = dp.count(10), dn.count(10)
                lr, lo, hi = lr_positive(a, b, len(Pk), len(Nk))
                out["topDecileLR"] = {"lr": lr, "ci": [lo, hi], "pos": a, "neg": b}
            c["contrasts"][cname] = out
        gene["candidates"][name] = c

    # P5: paired comparison against the RMC baseline on variants both score.
    prim = th["primary_contrast"]
    neg_key = CONTRAST_NEG[prim]
    gene["vsRmc"] = {}
    for name in th["candidates"]:
        pairs_p = [(vscore(name, v), vscore("rmc_oe", v)) for v in sets["plp"]]
        pairs_n = [(vscore(name, v), vscore("rmc_oe", v)) for v in sets[neg_key]]
        pairs_p = [p for p in pairs_p if None not in p]
        pairs_n = [p for p in pairs_n if None not in p]
        if pairs_p and pairs_n:
            a = auroc([p[0] for p in pairs_p], [p[0] for p in pairs_n])
            b = auroc([p[1] for p in pairs_p], [p[1] for p in pairs_n])
            ci = paired_bootstrap_diff(pairs_p, pairs_n, auroc, boot["iterations"], boot["seed"])
            gene["vsRmc"][name] = {"auroc": a, "rmcAuroc": b, "diff": a - b, "diffCI": ci, "nPos": len(pairs_p), "nNeg": len(pairs_n)}
    return gene


def grade(genes, th, traceable):
    P = th["pass"]
    prim = th["primary_contrast"]
    out = {}
    for name in th["candidates"]:
        cov_ok = [g["gene"] for g in genes if g["candidates"][name]["residueCoverage"] >= P["P1_coverage"]["min_residue_fraction"]]
        identity = True
        if name == "mtr3daf2":
            identity = False  # unversioned Ensembl ids: cannot meet the RMC identity rule
        if name == "ccr":
            identity = all(g["checks"]["ccr"].get("identicalProteinGRCh37") for g in genes if g["candidates"]["ccr"]["residuesScored"])
        p1 = len(cov_ok) >= P["P1_coverage"]["min_genes"] and identity
        disc = []
        for g in genes:
            c = g["candidates"][name]["contrasts"][prim]
            if c.get("auroc") is None or c["nPosScored"] < P["P3_discrimination"]["min_positives"] or c["nNegScored"] < P["P3_discrimination"]["min_negatives"]:
                continue
            if c["auroc"] >= P["P3_discrimination"]["min_auroc"] and c["aurocCI"][0] >= P["P3_discrimination"]["min_ci_low"]:
                disc.append(g["gene"])
        p3 = len(disc) >= P["P3_discrimination"]["min_genes"] and P["P3_discrimination"]["required_gene"] in disc
        ryr2 = next((g for g in genes if g["gene"] == "RYR2"), None)
        v = ryr2["vsRmc"].get(name) if ryr2 else None
        p5 = bool(v and v["diffCI"][0] is not None and v["diffCI"][0] > 0)
        lr_genes = [g["gene"] for g in genes if (g["candidates"][name]["contrasts"][prim].get("topDecileLR") or {}).get("lr", 0) >= th["step3_gate"]["P4_decile_lr"]["min_lr"]
                    and g["candidates"][name]["contrasts"][prim]["topDecileLR"]["ci"][0] > 1]
        p4 = len(lr_genes) >= th["step3_gate"]["P4_decile_lr"]["min_genes"]
        p2 = traceable.get(name, False)
        out[name] = {"P1": p1, "P1_genes": cov_ok, "P1_identity": identity, "P2": p2, "P3": p3, "P3_genes": disc,
                     "P5": p5, "P4": p4, "P4_genes": lr_genes, "adopt": p1 and p2 and p3 and p5, "step3": p1 and p2 and p3 and p5 and p4}
    return out


def fmt(x, nd=2):
    return "–" if x is None else f"{x:.{nd}f}"


def markdown(genes, grades, th, th_sha, repro):
    lines = ["# Residue-tolerance benchmark results", "",
             f"Generated by `scripts/tolerance_benchmark/benchmark.py` from `data/*.json`. thresholds.json sha256 `{th_sha}`.", ""]
    for g in genes:
        lines += [f"## {g['gene']} ({g['transcript']}, {g['length']} aa, ClinVar {g['clinvarRelease']})", "",
                  f"Variant sets: P/LP ≥1★ {g['sets']['plp']}; B/LB ≥1★ {g['sets']['blb']}; gnomAD missense AC≥2 {g['sets']['gnomad_ac2']}, "
                  f"AC=1 {g['sets']['gnomad_singleton']}, AC≥10 {g['sets']['gnomad_ac10']}. REF mismatches vs CDS: gnomAD {g['refMismatch']}, ClinVar {g['clinvarRefMismatch']}.", "",
                  f"In-house window n (observed missense+synonymous SNVs per 21-residue window): median {g['windowN']['median']}, "
                  f"10th percentile {g['windowN']['p10']}, min {g['windowN']['min']}, share of residues below 10: {g['windowN']['fracBelow10']:.1%}.", "",
                  "RMC intervals (v4.1.1, projected): " + "; ".join(f"{r['residues'][0]}–{r['residues'][1]} O/E {r['oe']:.2f} (p {r['p']:.1e})" for r in g["regions"]), "",
                  "| Signal | Coverage | Contrast | n+ / n− scored | AUROC (95% CI) | AUPRC (baseline) | Top-decile LR+ (95% CI) |",
                  "|---|---|---|---|---|---|---|"]
        for name, c in g["candidates"].items():
            for cname, x in c["contrasts"].items():
                ci = x.get("aurocCI") or (None, None)
                lr = x.get("topDecileLR")
                lines.append(f"| {name} | {c['residueCoverage']:.0%} | {cname} | {x['nPosScored']} / {x['nNegScored']} | "
                             f"{fmt(x.get('auroc'))} ({fmt(ci[0])}–{fmt(ci[1])}) | {fmt(x.get('auprc'))} ({fmt(x.get('auprcBaseline'))}) | "
                             + (f"{lr['lr']:.2f} ({lr['ci'][0]:.2f}–{lr['ci'][1]:.2f}); {lr['pos']}+/{lr['neg']}−" if lr else "–") + " |")
        lines += ["", "Decile odds ratios, primary contrast (decile 10 = most intolerant):", "",
                  "| Signal | " + " | ".join(f"D{k}" for k in range(1, 11)) + " |", "|---|" + "---|" * 10]
        for name, c in g["candidates"].items():
            d = c["contrasts"][th["primary_contrast"]].get("deciles")
            if d:
                lines.append(f"| {name} | " + " | ".join("– (0/0)" if r["pos"] + r["neg"] == 0 else f"{r['or']:.2f} ({r['pos']}/{r['neg']})" for r in d) + " |")
        if g["vsRmc"]:
            lines += ["", "Paired vs RMC O/E baseline (primary contrast): " + "; ".join(
                f"{k} ΔAUROC {v['diff']:+.3f} ({fmt(v['diffCI'][0], 3)} to {fmt(v['diffCI'][1], 3)})" for k, v in g["vsRmc"].items())]
        lines.append("")
    lines += ["## Grade", "", "| Candidate | P1 coverage+identity | P2 traceable | P3 discrimination | P5 beats RMC in RYR2 | P4 decile LR | Adopt |", "|---|---|---|---|---|---|---|"]
    for k, v in grades.items():
        yn = lambda b: "pass" if b else "fail"  # noqa: E731
        lines.append(f"| {k} | {yn(v['P1'])} ({', '.join(v['P1_genes']) or 'none'}; identity {yn(v['P1_identity'])}) | {yn(v['P2'])} | "
                     f"{yn(v['P3'])} ({', '.join(v['P3_genes']) or 'none'}) | {yn(v['P5'])} | {yn(v['P4'])} ({', '.join(v['P4_genes']) or 'none'}) | {'yes' if v['adopt'] else 'no'} |")
    if repro:
        lines += ["", "## MetaDome reproduction", "", "```", json.dumps(repro, indent=1)[:4000], "```"]
    return "\n".join(lines) + "\n"


def main():
    th_bytes = (HERE / "thresholds.json").read_bytes()
    th = json.loads(th_bytes)
    th_sha = hashlib.sha256(th_bytes).hexdigest()
    repro_path = HERE / "reproduction.json"
    repro = json.loads(repro_path.read_text()) if repro_path.exists() else None
    # P2: MetaDome and in-house are traceable iff reproduce_metadome.py recomputed the deposit exactly from
    # public gnomAD v4.1 under MetaDome's own rules. MTR3D-AF2 needs UK Biobank (application-gated) and
    # DiscovEHR (no longer public) per Kovacs 2024 Methods; CCR's inputs (gnomAD v2.0.1, Ensembl 75) are public.
    md_ok = bool(repro and repro.get("verdict") == "exact")
    traceable = {"metadome": md_ok, "inhouse": md_ok, "mtr3daf2": False, "ccr": True}
    genes = [evaluate(load(g), th) for g in th["genes"]]
    grades = grade(genes, th, traceable)
    (HERE / "results.json").write_text(json.dumps({"thresholdsSha256": th_sha, "genes": genes, "grades": grades}, indent=1))
    (HERE / "results.md").write_text(markdown(genes, grades, th, th_sha, repro), encoding="utf-8")
    for k, v in grades.items():
        print(k, {x: v[x] for x in ("P1", "P2", "P3", "P5", "P4", "adopt")})


if __name__ == "__main__":
    main()
