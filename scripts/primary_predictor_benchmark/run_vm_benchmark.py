"""Run the pre-registered Phase 5a comparison on the OCI VM.

Strictly opens `data/dbnsfp_v5.sqlite` in read-only mode, uses indexed point
lookups (`idx_chr_pos_genomic_ref_alt`), streams AlphaFold v6 human proteome
models only for mapped target UniProt accessions, and writes `results.json` and
`summary.md`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

# Allow running both as `python3 run_vm_benchmark.py` and as module
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import metrics as m  # noqa: E402

CLINVAR_VARIANT_SUMMARY_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz"
)
CLINVAR_SUBMISSION_SUMMARY_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/submission_summary.txt.gz"
)
CLINVAR_2017_VCF_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/archive_2.0/2017/clinvar_20171203.vcf.gz"
)
CLINVAR_2023_VCF_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/archive_2.0/2023/clinvar_20231226.vcf.gz"
)
CLINVAR_2025_01_VS_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/archive/variant_summary_2025-01.txt.gz"
)
UNIPROT_HUMAN_REVIEWED_URL = (
    "https://rest.uniprot.org/uniprotkb/stream?format=tsv"
    "&query=%28organism_id%3A9606%29+AND+%28reviewed%3Atrue%29"
    "&fields=accession,gene_primary,xref_mane-select,xref_ensembl,length"
)
ALPHAFOLD_HUMAN_V6_TAR_URL = (
    "https://ftp.ebi.ac.uk/pub/databases/alphafold/latest/UP000005640_9606_HUMAN_v6.tar"
)

CUTOFF_2017 = dt.date(2017, 12, 31)
CUTOFF_2023 = dt.date(2023, 12, 31)
CUTOFF_2024 = dt.date(2024, 12, 31)


def log(msg: str) -> None:
    ts = dt.datetime.now(dt.timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def download_if_missing(url: str, dest: Path) -> dict[str, Any]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.stat().st_size == 0:
        log(f"Downloading {url} -> {dest}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        subprocess.run(
            ["curl", "-fSL", "--retry", "4", "--retry-delay", "3", "-o", str(tmp), url],
            check=True,
        )
        tmp.replace(dest)
    else:
        log(f"Using cached {dest} ({dest.stat().st_size / (1024 * 1024):.1f} MiB)")

    # Fetch Last-Modified header + compute SHA-256
    last_mod = None
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=20) as resp:
            last_mod = resp.headers.get("Last-Modified")
    except Exception:
        pass

    h = hashlib.sha256()
    with dest.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)

    return {
        "url": url,
        "path": str(dest),
        "size_bytes": dest.stat().st_size,
        "last_modified": last_mod,
        "sha256": h.hexdigest(),
    }


def load_clinvar_current(vs_gz: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    stats = {
        "rows_total": 0,
        "rows_grch38": 0,
        "rows_snv": 0,
        "rows_2star": 0,
        "rows_germline": 0,
        "rows_plp_blb": 0,
        "rows_missense": 0,
        "dropped_conflicting_dup": 0,
        "dedup_same_label": 0,
    }
    by_coord: dict[tuple[str, int, str, str], dict[str, Any]] = {}
    conflicting_coords: set[tuple[str, int, str, str]] = set()

    with gzip.open(vs_gz, "rt", encoding="utf-8", errors="replace") as f:
        header = f.readline().rstrip("\r\n").split("\t")
        col = {name: i for i, name in enumerate(header)}
        idx_type = col["Type"]
        idx_name = col["Name"]
        idx_gene = col["GeneSymbol"]
        idx_sig = col["ClinicalSignificance"]
        idx_orig = col["OriginSimple"]
        idx_asm = col["Assembly"]
        idx_chr = col["Chromosome"]
        idx_rev = col["ReviewStatus"]
        idx_varid = col["VariationID"]
        idx_pos = col["PositionVCF"]
        idx_ref = col["ReferenceAlleleVCF"]
        idx_alt = col["AlternateAlleleVCF"]

        for line in f:
            stats["rows_total"] += 1
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) <= idx_alt:
                continue
            if parts[idx_asm] != "GRCh38":
                continue
            stats["rows_grch38"] += 1

            if parts[idx_type] != "single nucleotide variant":
                continue
            ref = parts[idx_ref].strip().upper()
            alt = parts[idx_alt].strip().upper()
            if ref not in m.VALID_BASES or alt not in m.VALID_BASES or ref == alt:
                continue
            chrom = m.normalize_chrom(parts[idx_chr])
            if chrom not in m.ALLOWED_CHROMS:
                continue
            try:
                pos_genomic = int(parts[idx_pos])
            except ValueError:
                continue
            if pos_genomic <= 0:
                continue
            stats["rows_snv"] += 1

            if parts[idx_rev].strip().lower() not in m.STAR2_REVIEW_STATUSES:
                continue
            stats["rows_2star"] += 1

            if "germline" not in parts[idx_orig].lower():
                continue
            stats["rows_germline"] += 1

            y = m.classify_clinvar_label(parts[idx_sig])
            if y is None:
                continue
            stats["rows_plp_blb"] += 1

            parsed_prot = m.parse_missense_protein_change(parts[idx_name])
            if parsed_prot is None:
                continue
            wt_aa, aa_pos, mut_aa = parsed_prot
            stats["rows_missense"] += 1

            key = (chrom, pos_genomic, ref, alt)
            if key in conflicting_coords:
                continue
            existing = by_coord.get(key)
            if existing is not None:
                if existing["y"] != y:
                    conflicting_coords.add(key)
                    del by_coord[key]
                    stats["dropped_conflicting_dup"] += 1
                else:
                    stats["dedup_same_label"] += 1
                continue

            by_coord[key] = {
                "coord": key,
                "chr": chrom,
                "pos_genomic": pos_genomic,
                "ref": ref,
                "alt": alt,
                "variation_id": parts[idx_varid].strip(),
                "clinvar_genes": m.parse_gene_symbols(parts[idx_gene]),
                "clinvar_wt": wt_aa,
                "clinvar_aa_pos": aa_pos,
                "clinvar_mut": mut_aa,
                "y": y,
                "review_status": parts[idx_rev].strip(),
            }

    return list(by_coord.values()), stats


def load_min_scv_eval_dates(
    sub_gz: Path, target_var_ids: set[str]
) -> tuple[dict[str, dt.date], dict[str, int]]:
    min_dates: dict[str, dt.date] = {}
    stats = {"scv_rows": 0, "matched_scvs": 0, "missing_date_scvs": 0}
    with gzip.open(sub_gz, "rt", encoding="utf-8", errors="replace") as f:
        header: list[str] | None = None
        col: dict[str, int] = {}
        for line in f:
            if line.startswith("##"):
                continue
            if line.startswith("#VariationID") or line.startswith("VariationID"):
                header = line.lstrip("#").rstrip("\r\n").split("\t")
                col = {name: i for i, name in enumerate(header)}
                continue
            if not header:
                continue
            stats["scv_rows"] += 1
            parts = line.rstrip("\r\n").split("\t")
            var_id = parts[col["VariationID"]].strip()
            if var_id not in target_var_ids:
                continue
            contrib_idx = col.get("ContributesToAggregateClassification")
            if contrib_idx is not None and len(parts) > contrib_idx:
                if parts[contrib_idx].strip().lower() != "yes":
                    continue
            if m.classify_clinvar_label(parts[col["ClinicalSignificance"]]) is None:
                continue
            stats["matched_scvs"] += 1
            d = m.parse_clinvar_date(parts[col["DateLastEvaluated"]])
            if d is None:
                stats["missing_date_scvs"] += 1
                continue
            prev = min_dates.get(var_id)
            if prev is None or d < prev:
                min_dates[var_id] = d
    return min_dates, stats


def load_historical_vcf_classified(
    vcf_gz: Path,
    target_coords: set[tuple[str, int, str, str]],
    target_var_ids: set[str],
) -> tuple[set[tuple[str, int, str, str]], set[str]]:
    found_coords: set[tuple[str, int, str, str]] = set()
    found_ids: set[str] = set()
    with gzip.open(vcf_gz, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\r\n").split("\t", 8)
            if len(parts) < 8:
                continue
            chrom = m.normalize_chrom(parts[0])
            if chrom not in m.ALLOWED_CHROMS:
                continue
            try:
                pos = int(parts[1])
            except ValueError:
                continue
            var_id = parts[2].strip()
            ref = parts[3].strip().upper()
            alt = parts[4].strip().upper()
            coord = (chrom, pos, ref, alt)
            if coord not in target_coords and var_id not in target_var_ids:
                continue
            if m.parse_vcf_clnsig_is_classified(parts[7]):
                if coord in target_coords:
                    found_coords.add(coord)
                if var_id in target_var_ids:
                    found_ids.add(var_id)
    return found_coords, found_ids


def load_historical_vs_classified(
    vs_gz: Path,
    target_coords: set[tuple[str, int, str, str]],
    target_var_ids: set[str],
) -> tuple[set[tuple[str, int, str, str]], set[str]]:
    found_coords: set[tuple[str, int, str, str]] = set()
    found_ids: set[str] = set()
    with gzip.open(vs_gz, "rt", encoding="utf-8", errors="replace") as f:
        header = f.readline().rstrip("\r\n").split("\t")
        col = {name: i for i, name in enumerate(header)}
        idx_asm = col["Assembly"]
        idx_chr = col["Chromosome"]
        idx_pos = col["PositionVCF"]
        idx_ref = col["ReferenceAlleleVCF"]
        idx_alt = col["AlternateAlleleVCF"]
        idx_varid = col["VariationID"]
        idx_sig = col["ClinicalSignificance"]
        for line in f:
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) <= idx_alt:
                continue
            if parts[idx_asm] != "GRCh38":
                continue
            var_id = parts[idx_varid].strip()
            chrom = m.normalize_chrom(parts[idx_chr])
            try:
                pos = int(parts[idx_pos])
            except ValueError:
                continue
            ref = parts[idx_ref].strip().upper()
            alt = parts[idx_alt].strip().upper()
            coord = (chrom, pos, ref, alt)
            if coord not in target_coords and var_id not in target_var_ids:
                continue
            if m.classify_clinvar_label(parts[idx_sig]) is not None:
                if coord in target_coords:
                    found_coords.add(coord)
                if var_id in target_var_ids:
                    found_ids.add(var_id)
    return found_coords, found_ids


def join_dbnsfp_and_score(
    variants: list[dict[str, Any]], db_path: Path
) -> dict[str, int]:
    uri = f"file:{db_path.resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.execute("PRAGMA query_only = ON;")
    cur = conn.cursor()

    stmt = (
        "SELECT gene, transcript, aaref, aaalt, pos, "
        "revel, bayesdel, alphamissense, esm1b, gnomad_ac, gnomad_an, transcript_basis "
        "FROM variant_scores WHERE chr = ? AND pos_genomic = ? AND ref = ? AND alt = ?"
    )
    cols = (
        "gene",
        "transcript",
        "aaref",
        "aaalt",
        "pos",
        "revel",
        "bayesdel",
        "alphamissense",
        "esm1b",
        "gnomad_ac",
        "gnomad_an",
        "transcript_basis",
    )

    stats = {
        "total_variants": len(variants),
        "matched": 0,
        "missing": 0,
        "non_missense": 0,
        "ambiguous_gene": 0,
        "clinvar_aa_differs_from_mane": 0,
    }
    missing_calls = {t: "Missing" for t in m.TOOLS}

    for v in variants:
        cur.execute(stmt, v["coord"])
        raw_rows = cur.fetchall()
        row_dicts = [dict(zip(cols, r)) for r in raw_rows]
        chosen, status = m.select_dbnsfp_row(
            row_dicts, v["clinvar_genes"], v["clinvar_wt"], v["clinvar_mut"]
        )
        stats[status] = stats.get(status, 0) + 1
        if chosen is None:
            v["in_dbnsfp"] = False
            v["gene"] = v["clinvar_genes"][0] if v["clinvar_genes"] else "UNKNOWN"
            v["transcript"] = None
            v["db_aaref"] = None
            v["db_pos"] = None
            v["gnomad_ac"] = None
            v["gnomad_an"] = None
            v["calls"] = dict(missing_calls)
            continue

        v["in_dbnsfp"] = True
        v["gene"] = str(chosen["gene"]).strip()
        v["transcript"] = str(chosen["transcript"] or "").split(".")[0].strip()
        v["db_aaref"] = chosen["aaref"]
        v["db_pos"] = chosen["pos"]
        v["gnomad_ac"] = chosen["gnomad_ac"]
        v["gnomad_an"] = chosen["gnomad_an"]
        if (
            chosen["aaref"] != v["clinvar_wt"]
            or chosen["aaalt"] != v["clinvar_mut"]
        ):
            stats["clinvar_aa_differs_from_mane"] += 1

        calls: dict[str, str] = {}
        for t in m.TOOLS:
            _, _, code = m.calibrated_call(t, chosen[t])
            calls[t] = code
        v["calls"] = calls

    conn.close()
    return stats


def load_uniprot_mapping(
    uniprot_tsv: Path,
) -> tuple[dict[str, str], dict[str, str]]:
    """Build (enst_no_ver -> uniprot_acc, unique_gene_upper -> uniprot_acc)."""
    enst_to_acc: dict[str, str] = {}
    gene_to_accs: dict[str, set[str]] = defaultdict(set)
    with uniprot_tsv.open("r", encoding="utf-8", errors="replace") as f:
        header = f.readline().rstrip("\r\n").split("\t")
        col = {name: i for i, name in enumerate(header)}
        idx_acc = col["Entry"]
        idx_gene = col["Gene Names (primary)"]
        idx_mane = col["MANE-Select"]
        idx_ens = col["Ensembl"]
        for line in f:
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) <= idx_acc:
                continue
            acc = parts[idx_acc].strip()
            if not acc:
                continue
            if len(parts) > idx_gene and parts[idx_gene].strip():
                for g in re.split(r"[;,\s]+", parts[idx_gene].strip()):
                    if g:
                        gene_to_accs[g.upper()].add(acc)
            for idx in (idx_mane, idx_ens):
                if len(parts) > idx and parts[idx]:
                    for tok in re.findall(r"ENST\d+", parts[idx]):
                        enst_to_acc.setdefault(tok, acc)

    unique_gene_to_acc = {
        g: next(iter(accs)) for g, accs in gene_to_accs.items() if len(accs) == 1
    }
    return enst_to_acc, unique_gene_to_acc


def stream_alphafold_plddt(
    needed_accs: set[str],
    needed_positions_by_acc: dict[str, set[int]],
) -> tuple[dict[str, dict[int, dict[int, tuple[str, float]]]], dict[str, int]]:
    """Stream UP000005640_9606_HUMAN_v6.tar via curl, parsing ONLY needed PDB.gz files."""
    fragments_by_acc: dict[str, dict[int, dict[int, tuple[str, float]]]] = defaultdict(dict)
    stats = {"tar_members_seen": 0, "pdb_members_parsed": 0, "residues_kept": 0}
    member_re = re.compile(r"^AF-([A-Z0-9]+)-F(\d+)-model_v\d+\.pdb\.gz$")

    log(
        f"Streaming AlphaFold v6 human proteome tar for {len(needed_accs)} UniProt accessions..."
    )
    proc = subprocess.Popen(
        ["curl", "-fsSL", "--retry", "3", ALPHAFOLD_HUMAN_V6_TAR_URL],
        stdout=subprocess.PIPE,
    )
    assert proc.stdout is not None
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for member in tf:
                stats["tar_members_seen"] += 1
                if stats["tar_members_seen"] % 5000 == 0:
                    tf.members.clear()
                    log(
                        f"  AlphaFold stream: {stats['tar_members_seen']:,} members, "
                        f"{stats['pdb_members_parsed']:,} matched PDBs..."
                    )
                if not member.isfile():
                    continue
                name = os.path.basename(member.name)
                match = member_re.match(name)
                if not match:
                    continue
                acc, frag_str = match.group(1), match.group(2)
                if acc not in needed_accs:
                    continue
                frag_idx = int(frag_str)
                extracted = tf.extractfile(member)
                if extracted is None:
                    continue
                raw_gz = extracted.read()
                pdb_bytes = gzip.decompress(raw_gz)
                offset = (frag_idx - 1) * 200
                wanted = needed_positions_by_acc[acc]
                pos_map: dict[int, tuple[str, float]] = {}
                for line in pdb_bytes.decode("ascii", errors="replace").splitlines():
                    if not line.startswith("ATOM  "):
                        continue
                    if line[12:16].strip() != "CA":
                        continue
                    try:
                        local_pos = int(line[22:26].strip())
                    except ValueError:
                        continue
                    if (offset + local_pos) not in wanted:
                        continue
                    res3 = line[17:20].strip().upper()
                    aa1 = m.AA3_UPPER_TO_1.get(res3)
                    if aa1 is None:
                        continue
                    try:
                        plddt = float(line[60:66].strip())
                    except ValueError:
                        continue
                    pos_map[local_pos] = (aa1, plddt)
                if pos_map:
                    fragments_by_acc[acc][frag_idx] = pos_map
                    stats["residues_kept"] += len(pos_map)
                stats["pdb_members_parsed"] += 1
    finally:
        proc.stdout.close()
        ret = proc.wait()
        if ret != 0:
            raise RuntimeError(f"curl failed with exit code {ret}")

    return fragments_by_acc, stats


def annotate_subgroups(
    variants: list[dict[str, Any]],
    uniprot_tsv: Path,
    g2p_path: Path,
) -> tuple[dict[str, int], dict[str, int]]:
    enst_to_acc, gene_to_acc = load_uniprot_mapping(uniprot_tsv)
    af_stats = {
        "mapped_via_enst": 0,
        "mapped_via_gene": 0,
        "unmapped_to_uniprot": 0,
        "plddt_ok": 0,
        "no_af_model": 0,
        "pos_out_of_range": 0,
        "aa_mismatch": 0,
    }
    needed_accs: set[str] = set()
    needed_pos: dict[str, set[int]] = defaultdict(set)

    for v in variants:
        if not v["in_dbnsfp"] or not v.get("db_pos"):
            v["uniprot_acc"] = None
            continue
        acc = None
        tx = v.get("transcript") or ""
        if tx and tx in enst_to_acc:
            acc = enst_to_acc[tx]
            af_stats["mapped_via_enst"] += 1
        elif v["gene"].upper() in gene_to_acc:
            acc = gene_to_acc[v["gene"].upper()]
            af_stats["mapped_via_gene"] += 1
        else:
            af_stats["unmapped_to_uniprot"] += 1
        v["uniprot_acc"] = acc
        if acc is not None:
            needed_accs.add(acc)
            needed_pos[acc].add(int(v["db_pos"]))

    fragments_by_acc, tar_stats = stream_alphafold_plddt(needed_accs, needed_pos)
    af_stats.update(tar_stats)

    for v in variants:
        acc = v.get("uniprot_acc")
        if not acc or not v.get("db_pos") or not v.get("db_aaref"):
            v["plddt"] = None
            continue
        plddt, status = m.resolve_alphafold_plddt(
            fragments_by_acc.get(acc, {}), int(v["db_pos"]), v["db_aaref"]
        )
        v["plddt"] = plddt
        if status == "ok":
            af_stats["plddt_ok"] += 1
        else:
            af_stats[status] = af_stats.get(status, 0) + 1

    with g2p_path.open("r", encoding="utf-8") as f:
        g2p_payload = json.load(f)
    mech_sets = m.extract_g2p_mechanism_sets(g2p_payload)
    g2p_counts = {k: len(s) for k, s in mech_sets.items()}
    for v in variants:
        g = str(v["gene"]).upper()
        v["is_gof_exclusive"] = g in mech_sets["gof_exclusive"]
        v["is_gof_any"] = g in mech_sets["gof_any"]
        v["is_lof_only"] = g in mech_sets["lof_only"]
        v["is_dn_any"] = g in mech_sets["dn_any"]

    return af_stats, g2p_counts


def is_rare_benign(v: dict[str, Any]) -> bool:
    if v["y"] == 1:
        return True
    ac = v.get("gnomad_ac")
    an = v.get("gnomad_an")
    if ac is None or an is None or an == 0:
        return True
    return (ac / an) < 0.001


def format_pct(val: float | None, digits: int = 1) -> str:
    if val is None:
        return "—"
    return f"{val * 100:.{digits}f}%"


def render_summary_markdown(results: dict[str, Any]) -> str:
    lines: list[str] = [
        "# Primary Predictor Benchmark Summary (Phase 5a)",
        "",
        f"Generated: {results['generated_at']}",
        "",
        "## Primary Selection Outcome (`post_2023`)",
        "",
    ]
    sel = results["selection"]
    lines.append(
        f"- **Primary tool:** `{sel['primary']}` (basis: `{sel['selection_basis']}`)"
    )
    lines.append(
        f"- **Fallback order:** `{' -> '.join(sel['fallback_order'])}`"
    )
    if sel["flagged_tools"]:
        lines.append(f"- **Subgroup-flagged tools:** `{', '.join(sel['flagged_tools'])}`")
    lines.append("")

    for cname in ("post_2023", "post_2024", "post_2017", "full_2star", "post_2023_rare_benign"):
        c = results["cohorts"][cname]
        lines.append(
            f"## Cohort `{cname}` (N_A={c['n_variants_a']:,} [P={c['n_p_a']:,}, B={c['n_b_a']:,}], "
            f"N_B={c['n_variants_b']:,}, genes={c['n_genes']:,})"
        )
        lines.append("")
        lines.append(
            "| Tool | Cov_A | Reach_P_Mod+ | Reach_B_Mod+ | H_Mod+ (95% CI) | W_bal (95% CI) | W_P | W_B |"
        )
        lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")
        for t in m.TOOLS:
            tm = c["tools"][t]
            ci = c["cis"][t]
            hci = ci["h_mod"]
            wci = ci["w_bal"]
            h_str = (
                f"{format_pct(tm['h_mod'])} ({format_pct(hci[0])}–{format_pct(hci[1])})"
                if hci
                else format_pct(tm["h_mod"])
            )
            w_str = (
                f"{format_pct(tm['w_bal'], 2)} ({format_pct(wci[0], 2)}–{format_pct(wci[1], 2)})"
                if wci
                else format_pct(tm["w_bal"], 2)
            )
            lines.append(
                f"| {m.TOOL_LABELS[t]} | {format_pct(tm['cov_a'])} | {format_pct(tm['reach_p_mod'])} | "
                f"{format_pct(tm['reach_b_mod'])} | {h_str} | {w_str} | "
                f"{format_pct(tm['w_p'], 2)} | {format_pct(tm['w_b'], 2)} |"
            )
        lines.append("")

    lines.append("## Subgroups (`post_2023`)")
    lines.append("")
    for sname, sdata in results["subgroups_post_2023"].items():
        lines.append(
            f"### `{sname}` (N_A={sdata['n_variants_a']:,} [P={sdata['n_p_a']:,}, B={sdata['n_b_a']:,}], genes={sdata['n_genes']:,})"
        )
        lines.append("| Tool | Reach_P_Mod+ | Reach_B_Mod+ | H_Mod+ | W_bal (95% CI) | Gate worst? |")
        lines.append("|---|---:|---:|---:|---:|---|")
        for t in m.TOOLS:
            tm = sdata["tools"][t]
            wci = sdata["cis"][t]["w_bal"]
            wex = sdata["w_bal_excess"][t]
            w_str = (
                f"{format_pct(tm['w_bal'], 2)} ({format_pct(wci[0], 2)}–{format_pct(wci[1], 2)})"
                if wci
                else format_pct(tm["w_bal"], 2)
            )
            lines.append(
                f"| {m.TOOL_LABELS[t]} | {format_pct(tm['reach_p_mod'])} | {format_pct(tm['reach_b_mod'])} | "
                f"{format_pct(tm['h_mod'])} | {w_str} | {'FLAGGED' if wex['is_strictly_worst'] else 'ok'} |"
            )
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Phase 5a primary predictor benchmark")
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--g2p", required=True, type=Path)
    parser.add_argument("--workdir", required=True, type=Path)
    parser.add_argument("--outdir", required=True, type=Path)
    parser.add_argument("--reps", type=int, default=m.BOOTSTRAP_REPS)
    args = parser.parse_args()

    t0 = time.time()
    args.workdir.mkdir(parents=True, exist_ok=True)
    args.outdir.mkdir(parents=True, exist_ok=True)

    # 1. Download all required inputs with provenance
    prov: dict[str, Any] = {}
    vs_path = args.workdir / "variant_summary.txt.gz"
    sub_path = args.workdir / "submission_summary.txt.gz"
    vcf2017_path = args.workdir / "clinvar_20171203.vcf.gz"
    vcf2023_path = args.workdir / "clinvar_20231226.vcf.gz"
    vs2025_path = args.workdir / "variant_summary_2025-01.txt.gz"
    uniprot_path = args.workdir / "uniprot_human_reviewed.tsv"

    prov["clinvar_current"] = download_if_missing(CLINVAR_VARIANT_SUMMARY_URL, vs_path)
    prov["clinvar_submissions"] = download_if_missing(
        CLINVAR_SUBMISSION_SUMMARY_URL, sub_path
    )
    prov["clinvar_2017_vcf"] = download_if_missing(CLINVAR_2017_VCF_URL, vcf2017_path)
    prov["clinvar_2023_vcf"] = download_if_missing(CLINVAR_2023_VCF_URL, vcf2023_path)
    prov["clinvar_2025_01_vs"] = download_if_missing(
        CLINVAR_2025_01_VS_URL, vs2025_path
    )
    prov["uniprot_human_reviewed"] = download_if_missing(
        UNIPROT_HUMAN_REVIEWED_URL, uniprot_path
    )

    # 2. Load current >=2-star ClinVar missense SNVs
    log("Parsing current ClinVar variant_summary.txt.gz...")
    variants, clinvar_stats = load_clinvar_current(vs_path)
    log(
        f"Loaded {len(variants):,} unique >=2-star missense SNVs "
        f"(P={sum(v['y'] == 1 for v in variants):,}, B={sum(v['y'] == 0 for v in variants):,})"
    )

    target_coords = {v["coord"] for v in variants}
    target_var_ids = {v["variation_id"] for v in variants if v["variation_id"]}

    # 3. Load submission_summary earliest evaluation dates + historical snapshots
    log("Scanning submission_summary.txt.gz for earliest contributing SCV dates...")
    min_eval_dates, scv_stats = load_min_scv_eval_dates(sub_path, target_var_ids)

    log("Scanning historical snapshots (2017 VCF, 2023 VCF, 2025-01 variant_summary)...")
    c17, id17 = load_historical_vcf_classified(
        vcf2017_path, target_coords, target_var_ids
    )
    c23, id23 = load_historical_vcf_classified(
        vcf2023_path, target_coords, target_var_ids
    )
    c25, id25 = load_historical_vs_classified(
        vs2025_path, target_coords, target_var_ids
    )

    # 4. Indexed lookup in local dbNSFP SQLite
    log(f"Joining {len(variants):,} variants against read-only {args.db}...")
    db_stats = join_dbnsfp_and_score(variants, args.db)
    log(f"dbNSFP join stats: {db_stats}")

    # 5. Annotate AlphaFold v6 pLDDT and G2P disease mechanisms
    af_stats, g2p_counts = annotate_subgroups(variants, uniprot_path, args.g2p)
    log(f"AlphaFold pLDDT annotation stats: {af_stats}")

    # 6. Build cohorts
    cohorts_variants: dict[str, list[dict[str, Any]]] = {
        "full_2star": variants,
        "post_2017": [],
        "post_2023": [],
        "post_2024": [],
        "post_2023_rare_benign": [],
    }
    missing_date_counts = {"post_2017": 0, "post_2023": 0, "post_2024": 0}
    for v in variants:
        coord = v["coord"]
        vid = v["variation_id"]
        d = min_eval_dates.get(vid)
        if m.is_post_cutoff_variant(coord, vid, c17, id17, d, CUTOFF_2017):
            cohorts_variants["post_2017"].append(v)
            if d is None:
                missing_date_counts["post_2017"] += 1
        if m.is_post_cutoff_variant(coord, vid, c23, id23, d, CUTOFF_2023):
            cohorts_variants["post_2023"].append(v)
            if d is None:
                missing_date_counts["post_2023"] += 1
            if is_rare_benign(v):
                cohorts_variants["post_2023_rare_benign"].append(v)
        if m.is_post_cutoff_variant(coord, vid, c25, id25, d, CUTOFF_2024):
            cohorts_variants["post_2024"].append(v)
            if d is None:
                missing_date_counts["post_2024"] += 1

    log("Computing cohort summaries & gene-cluster bootstrap CIs...")
    cohorts_summary = {
        name: m.summarize_variants(vlist, reps=args.reps, seed=m.BOOTSTRAP_SEED)
        for name, vlist in cohorts_variants.items()
    }

    # 7. Subgroups on post_2023 and full_2star
    def build_subgroups(vlist: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        return {
            "ordered": [v for v in vlist if v["plddt"] is not None and v["plddt"] >= 50.0],
            "ordered_high_conf": [
                v for v in vlist if v["plddt"] is not None and v["plddt"] >= 70.0
            ],
            "disordered": [v for v in vlist if v["plddt"] is not None and v["plddt"] < 50.0],
            "gof_exclusive": [v for v in vlist if v["is_gof_exclusive"]],
            "gof_any": [v for v in vlist if v["is_gof_any"]],
            "lof_only": [v for v in vlist if v["is_lof_only"]],
            "dn_any": [v for v in vlist if v["is_dn_any"]],
        }

    p23_subs = build_subgroups(cohorts_variants["post_2023"])
    full_subs = build_subgroups(cohorts_variants["full_2star"])

    subgroups_post_2023 = {
        sname: m.summarize_variants(slist, reps=args.reps, seed=m.BOOTSTRAP_SEED)
        for sname, slist in p23_subs.items()
    }
    subgroups_full_2star = {
        sname: m.summarize_variants(slist, reps=args.reps, seed=m.BOOTSTRAP_SEED)
        for sname, slist in full_subs.items()
    }

    # Select primary GoF subgroup per pre-registered >=30 P/LP and >=30 B/LB gate rule
    gof_excl = subgroups_post_2023["gof_exclusive"]
    gof_key = (
        "gof_exclusive"
        if (gof_excl["n_p_a"] >= 30 and gof_excl["n_b_a"] >= 30)
        else "gof_any"
    )
    gate_substitutions: dict[str, str] = {}
    gate_subgroups: dict[str, dict[str, Any]] = {}
    for label, sub_name in (
        ("ordered", "ordered"),
        ("disordered", "disordered"),
        ("gof", gof_key),
        ("lof_only", "lof_only"),
    ):
        cand = subgroups_post_2023[sub_name]
        if cand["n_p_a"] >= 30 and cand["n_b_a"] >= 30:
            gate_subgroups[label] = cand
            gate_substitutions[label] = f"post_2023:{sub_name}"
        else:
            gate_subgroups[label] = subgroups_full_2star[sub_name]
            gate_substitutions[label] = f"full_2star:{sub_name}"

    selection = m.evaluate_selection_rule(
        cohorts_summary["post_2023"], gate_subgroups
    )
    selection["gate_sources"] = gate_substitutions

    # Also compute selection on post_2024 and full_2star as consistency checks
    selection_post_2024 = m.evaluate_selection_rule(
        cohorts_summary["post_2024"], gate_subgroups
    )
    selection_full = m.evaluate_selection_rule(
        cohorts_summary["full_2star"],
        {
            "ordered": subgroups_full_2star["ordered"],
            "disordered": subgroups_full_2star["disordered"],
            "gof": subgroups_full_2star[gof_key],
            "lof_only": subgroups_full_2star["lof_only"],
        },
    )

    fallback_audit = {
        "post_2023": m.audit_fallback_and_disagreement(
            cohorts_variants["post_2023"], selection["fallback_order"]
        ),
        "post_2024": m.audit_fallback_and_disagreement(
            cohorts_variants["post_2024"], selection["fallback_order"]
        ),
        "full_2star": m.audit_fallback_and_disagreement(
            cohorts_variants["full_2star"], selection["fallback_order"]
        ),
    }

    # dbNSFP metadata for provenance
    uri = f"file:{args.db.resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    db_meta = dict(conn.execute("SELECT key, value FROM build_meta").fetchall())
    conn.close()

    results = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "elapsed_seconds": round(time.time() - t0, 2),
        "provenance": prov,
        "dbnsfp_build_meta": db_meta,
        "clinvar_stats": clinvar_stats,
        "scv_stats": scv_stats,
        "missing_eval_date_in_post_cohorts": missing_date_counts,
        "dbnsfp_join_stats": db_stats,
        "alphafold_stats": af_stats,
        "g2p_gene_counts": g2p_counts,
        "cohorts": cohorts_summary,
        "subgroups_post_2023": subgroups_post_2023,
        "subgroups_full_2star": subgroups_full_2star,
        "selection": selection,
        "selection_consistency": {
            "post_2024": selection_post_2024,
            "full_2star": selection_full,
        },
        "fallback_and_disagreement": fallback_audit,
    }

    out_json = args.outdir / "results.json"
    out_md = args.outdir / "summary.md"
    out_tsv = args.outdir / "variant_calls.tsv.gz"
    out_json.write_text(json.dumps(results, indent=2), encoding="utf-8")
    out_md.write_text(render_summary_markdown(results), encoding="utf-8")
    p23_set = {v["coord"] for v in cohorts_variants["post_2023"]}
    p24_set = {v["coord"] for v in cohorts_variants["post_2024"]}
    with gzip.open(out_tsv, "wt", encoding="utf-8") as tf:
        tf.write(
            "chr\tpos_genomic\tref\talt\tvariation_id\tgene\ty\tin_dbnsfp\tplddt\t"
            "post_2023\tpost_2024\trevel_call\tbayesdel_call\talphamissense_call\tesm1b_call\n"
        )
        for v in variants:
            c = v["coord"]
            calls = v["calls"]
            plddt_s = f"{v['plddt']:.2f}" if v.get("plddt") is not None else ""
            tf.write(
                f"{c[0]}\t{c[1]}\t{c[2]}\t{c[3]}\t{v['variation_id']}\t{v['gene']}\t"
                f"{v['y']}\t{int(v['in_dbnsfp'])}\t{plddt_s}\t"
                f"{int(c in p23_set)}\t{int(c in p24_set)}\t"
                f"{calls['revel']}\t{calls['bayesdel']}\t{calls['alphamissense']}\t{calls['esm1b']}\n"
            )
    log(f"Done in {results['elapsed_seconds']}s -> {out_json}, {out_md}, {out_tsv}")


if __name__ == "__main__":
    main()
