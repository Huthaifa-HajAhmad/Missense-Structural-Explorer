"""Core metrics, calibration bands, parsers, and selection rules for Phase 5a.

Implemented in pure Python 3.12+ standard library so the script runs identically on
Windows development hosts and the OCI VM without external package dependencies.
"""
from __future__ import annotations

import datetime as dt
import math
import random
import re
from collections import defaultdict
from typing import Any

# ---------------------------------------------------------------------------
# Pre-registered constants
# ---------------------------------------------------------------------------
BOOTSTRAP_REPS = 2000
BOOTSTRAP_SEED = 20261124
Z_95 = 1.959963984540054

TOOLS: tuple[str, ...] = ("revel", "bayesdel", "alphamissense", "esm1b")
TOOL_LABELS: dict[str, str] = {
    "revel": "REVEL",
    "bayesdel": "BayesDel noAF",
    "alphamissense": "AlphaMissense",
    "esm1b": "ESM1b",
}

STRENGTH_ORDER: tuple[str, ...] = ("VeryStrong", "Strong", "Moderate", "Supporting")
ALLOWED_CHROMS: frozenset[str] = frozenset(
    [str(i) for i in range(1, 23)] + ["X", "Y", "M"]
)
VALID_BASES: frozenset[str] = frozenset(("A", "C", "G", "T"))
STANDARD_AA_1: frozenset[str] = frozenset("ACDEFGHIKLMNPQRSTVWY")

AA3_TO_1: dict[str, str] = {
    "Ala": "A",
    "Arg": "R",
    "Asn": "N",
    "Asp": "D",
    "Cys": "C",
    "Gln": "Q",
    "Glu": "E",
    "Gly": "G",
    "His": "H",
    "Ile": "I",
    "Leu": "L",
    "Lys": "K",
    "Met": "M",
    "Phe": "F",
    "Pro": "P",
    "Ser": "S",
    "Thr": "T",
    "Trp": "W",
    "Tyr": "Y",
    "Val": "V",
}
AA3_UPPER_TO_1: dict[str, str] = {k.upper(): v for k, v in AA3_TO_1.items()}

# Must stay byte-for-byte identical to src/shared/thresholds/calibration.ts.
CALIBRATION_BANDS: dict[str, dict[str, Any]] = {
    "revel": {
        "orientation": "higher",
        "pp3": {"Supporting": 0.644, "Moderate": 0.773, "Strong": 0.932},
        "bp4": {"Supporting": 0.29, "Moderate": 0.183, "Strong": 0.016, "VeryStrong": 0.003},
    },
    "bayesdel": {
        "orientation": "higher",
        "pp3": {"Supporting": 0.13, "Moderate": 0.27, "Strong": 0.5},
        "bp4": {"Supporting": -0.18, "Moderate": -0.36},
    },
    "alphamissense": {
        "orientation": "higher",
        "pp3": {"Supporting": 0.792, "Moderate": 0.906, "Strong": 0.99},
        "bp4": {"Supporting": 0.169, "Moderate": 0.099},
    },
    "esm1b": {
        "orientation": "lower",
        "pp3": {"Supporting": -10.7, "Moderate": -12.2, "Strong": -24.0},
        "bp4": {"Supporting": -6.3, "Moderate": -3.1},
    },
}

STAR2_REVIEW_STATUSES: frozenset[str] = frozenset(
    (
        "criteria provided, multiple submitters, no conflicts",
        "reviewed by expert panel",
        "practice guideline",
    )
)

CLINVAR_PLP_LABELS: frozenset[str] = frozenset(
    ("pathogenic", "likely pathogenic", "pathogenic/likely pathogenic")
)
CLINVAR_BLB_LABELS: frozenset[str] = frozenset(
    ("benign", "likely benign", "benign/likely benign")
)

MISSENSE_HGVS_RE = re.compile(r"\(p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})\)")

# Outcome bucket indices stored per gene per tool (18 ints total = 9 P + 9 B):
#   0: PP3_Strong, 1: PP3_Moderate, 2: PP3_Supporting, 3: Indeterminate,
#   4: BP4_Supporting, 5: BP4_Moderate, 6: BP4_Strong, 7: BP4_VeryStrong, 8: Missing
BUCKET_NAMES: tuple[str, ...] = (
    "PP3_Strong",
    "PP3_Moderate",
    "PP3",
    "Indeterminate",
    "BP4",
    "BP4_Moderate",
    "BP4_Strong",
    "BP4_VeryStrong",
    "Missing",
)
BUCKET_INDEX: dict[str, int] = {name: i for i, name in enumerate(BUCKET_NAMES)}
N_BUCKETS = len(BUCKET_NAMES)  # 9


# ---------------------------------------------------------------------------
# Calibration calls
# ---------------------------------------------------------------------------
def _passes(score: float, threshold: float, orientation: str, side: str) -> bool:
    pathogenic_is_high = orientation == "higher"
    want_high = pathogenic_is_high if side == "pp3" else (not pathogenic_is_high)
    return score >= threshold if want_high else score <= threshold


def calibrated_call(tool: str, score: float | None) -> tuple[str | None, str | None, str]:
    """Return (direction, strength, code) matching src/shared/thresholds/calibration.ts.

    Returns (None, None, "Missing") when score is None or non-finite.
    Returns (None, None, "Indeterminate") when finite score falls between bands.
    """
    if score is None:
        return None, None, "Missing"
    try:
        val = float(score)
    except (TypeError, ValueError):
        return None, None, "Missing"
    if not math.isfinite(val):
        return None, None, "Missing"

    bands = CALIBRATION_BANDS[tool]
    orientation = bands["orientation"]
    for side in ("pp3", "bp4"):
        direction = "PP3" if side == "pp3" else "BP4"
        for strength in STRENGTH_ORDER:
            threshold = bands[side].get(strength)
            if threshold is None:
                continue
            if _passes(val, threshold, orientation, side):
                code = direction if strength == "Supporting" else f"{direction}_{strength}"
                return direction, strength, code
    return None, None, "Indeterminate"


# ---------------------------------------------------------------------------
# ClinVar & VCF parsing helpers
# ---------------------------------------------------------------------------
def normalize_chrom(chrom: str) -> str:
    c = str(chrom).strip()
    if c.lower().startswith("chr"):
        c = c[3:]
    c = c.upper()
    if c == "MT":
        c = "M"
    return c


def normalize_clinsig(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.replace("_", " ").strip().lower())


def classify_clinvar_label(raw: str) -> int | None:
    """Return 1 for P/LP, 0 for B/LB, or None for anything else."""
    norm = normalize_clinsig(raw)
    if norm in CLINVAR_PLP_LABELS:
        return 1
    if norm in CLINVAR_BLB_LABELS:
        return 0
    return None


def parse_missense_protein_change(name: str) -> tuple[str, int, str] | None:
    """Parse canonical single-residue missense `(p.Arg175His)` from ClinVar Name.

    Excludes synonymous, nonsense (Ter), start-loss (pos == 1), frameshifts, and indels.
    """
    matches = MISSENSE_HGVS_RE.findall(name or "")
    if len(matches) != 1:
        return None
    wt3, pos_str, mut3 = matches[0]
    wt1 = AA3_TO_1.get(wt3)
    mut1 = AA3_TO_1.get(mut3)
    if wt1 is None or mut1 is None or wt1 == mut1:
        return None
    pos = int(pos_str)
    if pos <= 1:
        return None
    return wt1, pos, mut1


def parse_clinvar_date(raw: str) -> dt.date | None:
    s = (raw or "").strip()
    if not s or s in {"-", "na", "NA"}:
        return None
    for fmt in ("%b %d, %Y", "%Y-%m-%d", "%b %d %Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_gene_symbols(raw: str) -> tuple[str, ...]:
    if not raw or raw.strip() in {"-", "na", "NA"}:
        return ()
    tokens = [t.strip() for t in re.split(r"[;,|]", raw) if t.strip() and t.strip() != "-"]
    # Preserve order, deduplicate
    seen: set[str] = set()
    out: list[str] = []
    for tok in tokens:
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return tuple(out)


def parse_vcf_clnsig_is_classified(info: str) -> bool:
    """Return True if ClinVar VCF INFO/CLNSIG carries any P/LP or B/LB classification.

    Handles both archive_2.0 text labels (e.g. Pathogenic, Likely_benign,
    Pathogenic/Likely_pathogenic) and legacy archive_1.0 numeric codes (2=B, 3=LB, 4=LP, 5=P).
    """
    for field in info.split(";"):
        if not field.startswith("CLNSIG="):
            continue
        val = field[7:].strip()
        if not val:
            return False
        for part in re.split(r"[|,]", val):
            token = part.strip()
            if not token:
                continue
            if token in {"2", "3", "4", "5"}:
                return True
            if classify_clinvar_label(token) is not None:
                return True
            # Some ClinVar VCF entries encode slash-separated multi-values or compound strings
            if "/" in token:
                subparts = [normalize_clinsig(p) for p in token.split("/")]
                if all(p in CLINVAR_PLP_LABELS for p in subparts) or all(
                    p in CLINVAR_BLB_LABELS for p in subparts
                ):
                    return True
        return False
    return False


def is_post_cutoff_variant(
    coord_key: tuple[str, int, str, str],
    variation_id: str,
    historical_coords: set[tuple[str, int, str, str]],
    historical_var_ids: set[str],
    min_eval_date: dt.date | None,
    cutoff_date: dt.date,
) -> bool:
    """Return True iff variant was NOT P/LP/B/LB in historical snapshot AND no SCV predates cutoff."""
    if coord_key in historical_coords:
        return False
    if variation_id and variation_id in historical_var_ids:
        return False
    if min_eval_date is not None and min_eval_date <= cutoff_date:
        return False
    return True


def select_dbnsfp_row(
    rows: list[dict[str, Any]],
    clinvar_genes: tuple[str, ...],
    clinvar_wt: str,
    clinvar_mut: str,
) -> tuple[dict[str, Any] | None, str]:
    """Select the single matching missense row from dbNSFP hits at one genomic locus.

    Returns (row_or_None, status) where status is one of:
      'matched', 'missing', 'non_missense', 'ambiguous_gene'
    """
    if not rows:
        return None, "missing"

    missense_rows = [
        r
        for r in rows
        if r.get("aaref") in STANDARD_AA_1
        and r.get("aaalt") in STANDARD_AA_1
        and r.get("aaref") != r.get("aaalt")
        and (r.get("pos") or 0) > 1
    ]
    if not missense_rows:
        return None, "non_missense"
    if len(missense_rows) == 1:
        return missense_rows[0], "matched"

    gene_set = {g.upper() for g in clinvar_genes}
    if gene_set:
        gene_hits = [r for r in missense_rows if str(r.get("gene", "")).upper() in gene_set]
        if len(gene_hits) == 1:
            return gene_hits[0], "matched"
        if len(gene_hits) > 1:
            missense_rows = gene_hits

    aa_hits = [
        r
        for r in missense_rows
        if r.get("aaref") == clinvar_wt and r.get("aaalt") == clinvar_mut
    ]
    if len(aa_hits) == 1:
        return aa_hits[0], "matched"

    # Prefer MANE > ensembl-canonical > single if still tied within the same gene
    unique_genes = {str(r.get("gene", "")).upper() for r in missense_rows}
    if len(unique_genes) == 1:
        basis_rank = {"mane": 0, "ensembl-canonical": 1, "single": 2, "first-listed": 3}
        missense_rows_sorted = sorted(
            missense_rows, key=lambda r: basis_rank.get(str(r.get("transcript_basis", "")), 9)
        )
        return missense_rows_sorted[0], "matched"

    return None, "ambiguous_gene"


# ---------------------------------------------------------------------------
# AlphaFold fragment coordinate resolution
# ---------------------------------------------------------------------------
def resolve_alphafold_plddt(
    fragments: dict[int, dict[int, tuple[str, float]]],
    uniprot_pos: int,
    expected_aa1: str,
) -> tuple[float | None, str]:
    """Resolve AlphaFold v6 pLDDT for `uniprot_pos`, verifying residue identity.

    `fragments` maps fragment index `k` (1, 2, ...) to `{local_res_seq: (aa1, plddt)}`.
    For proteins <= 2700 aa only F1 exists and `local_res_seq == uniprot_pos`.
    For fragmented proteins (>2700 aa), fragment k covers 1400 aa starting at
    `(k - 1) * 200 + 1`; choose the fragment whose midpoint `(k - 1) * 200 + 700`
    is closest to `uniprot_pos` where `local_pos = uniprot_pos - (k - 1) * 200` exists.
    """
    if not fragments:
        return None, "no_af_model"

    candidates: list[tuple[float, int, str, float]] = []
    for k, pos_map in fragments.items():
        offset = (k - 1) * 200
        local_pos = uniprot_pos - offset
        if local_pos in pos_map:
            aa1, plddt = pos_map[local_pos]
            midpoint = offset + 700.0
            candidates.append((abs(uniprot_pos - midpoint), k, aa1, plddt))

    if not candidates:
        return None, "pos_out_of_range"

    candidates.sort(key=lambda item: (item[0], item[1]))
    _, _, aa1, plddt = candidates[0]
    if aa1 != expected_aa1:
        return None, "aa_mismatch"
    return plddt, "ok"


def verify_uniprot_residue(
    uniprot_seq: str, uniprot_pos: int, expected_aa1: str
) -> str:
    """Verify `uniprot_pos` matches `expected_aa1` on the canonical UniProt sequence."""
    if not uniprot_seq:
        return "no_uniprot_seq"
    if uniprot_pos < 1 or uniprot_pos > len(uniprot_seq):
        return "pos_out_of_range"
    if uniprot_seq[uniprot_pos - 1] != expected_aa1:
        return "aa_mismatch"
    return "ok"


def fragment_for_position(uniprot_pos: int, seq_length: int) -> tuple[int, int]:
    """Return (fragment_index_1based, local_res_num) for AlphaFold DB v6 models."""
    if seq_length <= 2700 or uniprot_pos <= 1400:
        return 1, uniprot_pos
    max_k = ((seq_length - 1400 + 199) // 200) + 1
    k = round((uniprot_pos - 700) / 200) + 1
    k = max(1, min(max_k, k))
    local_pos = uniprot_pos - (k - 1) * 200
    return k, local_pos


def parse_af_confidence_json(payload: dict[str, Any]) -> dict[int, float]:
    """Parse AlphaFold `AF-*-confidence_v6.json` into {local_res_num: plddt}."""
    res_nums = payload.get("residueNumber") or []
    scores = payload.get("confidenceScore") or []
    if len(res_nums) != len(scores):
        raise ValueError(
            f"Mismatched AlphaFold confidence arrays: {len(res_nums)} vs {len(scores)}"
        )
    out: dict[int, float] = {}
    for rn, sc in zip(res_nums, scores):
        out[int(rn)] = float(sc)
    return out


# ---------------------------------------------------------------------------
# G2P disease-mechanism gene sets
# ---------------------------------------------------------------------------
def extract_g2p_mechanism_sets(
    g2p_payload: dict[str, Any],
    allowed_confidences: frozenset[str] = frozenset(("definitive", "strong")),
) -> dict[str, set[str]]:
    """Build GoF / LoF / DN gene symbol sets (uppercased) from g2p-context.json."""
    genes_dict = g2p_payload.get("genes", {})
    by_gene: dict[str, set[str]] = defaultdict(set)
    for key, entries in genes_dict.items():
        items = entries if isinstance(entries, list) else [entries]
        for entry in items:
            if not isinstance(entry, dict):
                continue
            conf = str(entry.get("confidence", "")).strip().lower()
            if conf not in allowed_confidences:
                continue
            mech = str(entry.get("mechanism", "")).strip().lower()
            symbol = str(entry.get("gene") or key).strip().upper()
            if symbol and mech:
                by_gene[symbol].add(mech)

    gof_any = {g for g, mechs in by_gene.items() if "gain of function" in mechs}
    gof_exclusive = {
        g
        for g, mechs in by_gene.items()
        if "gain of function" in mechs and "loss of function" not in mechs
    }
    lof_only = {
        g
        for g, mechs in by_gene.items()
        if "loss of function" in mechs
        and "gain of function" not in mechs
        and "dominant negative" not in mechs
    }
    dn_any = {g for g, mechs in by_gene.items() if "dominant negative" in mechs}
    return {
        "gof_any": gof_any,
        "gof_exclusive": gof_exclusive,
        "lof_only": lof_only,
        "dn_any": dn_any,
    }


# ---------------------------------------------------------------------------
# Statistical aggregation & gene-cluster bootstrap
# ---------------------------------------------------------------------------
def wilson_ci(k: int, n: int) -> tuple[float | None, float | None, float | None]:
    if n <= 0:
        return None, None, None
    p = k / n
    z2 = Z_95 * Z_95
    denom = 1.0 + z2 / n
    center = (p + z2 / (2.0 * n)) / denom
    half = (Z_95 * math.sqrt((p * (1.0 - p)) / n + z2 / (4.0 * n * n))) / denom
    return p, max(0.0, center - half), min(1.0, center + half)


def percentile_linear(sorted_vals: list[float], q: float) -> float:
    """Linear-interpolation percentile matching numpy.percentile defaults (q in [0, 100])."""
    n = len(sorted_vals)
    if n == 0:
        raise ValueError("Cannot take percentile of empty list")
    if n == 1:
        return float(sorted_vals[0])
    pos = (q / 100.0) * (n - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(sorted_vals[lo])
    frac = pos - lo
    return float(sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac)


def _metrics_from_counts(counts_18: list[int] | tuple[int, ...]) -> dict[str, float | None]:
    """Compute scalar metrics from a single tool's 18-int count vector (9 P + 9 B)."""
    p = counts_18[:9]
    b = counts_18[9:]

    p_tot = sum(p)
    b_tot = sum(b)
    p_scored = p_tot - p[8]
    b_scored = b_tot - b[8]
    tot = p_tot + b_tot
    scored = p_scored + b_scored

    cov_a = (scored / tot) if tot > 0 else None
    cov_p_a = (p_scored / p_tot) if p_tot > 0 else None
    cov_b_a = (b_scored / b_tot) if b_tot > 0 else None

    reach_p_mod = ((p[0] + p[1]) / p_tot) if p_tot > 0 else None
    reach_b_mod = ((b[5] + b[6] + b[7]) / b_tot) if b_tot > 0 else None
    reach_p_sup = ((p[0] + p[1] + p[2]) / p_tot) if p_tot > 0 else None
    reach_b_sup = ((b[4] + b[5] + b[6] + b[7]) / b_tot) if b_tot > 0 else None

    if reach_p_mod is not None and reach_b_mod is not None:
        s = reach_p_mod + reach_b_mod
        h_mod = (2.0 * reach_p_mod * reach_b_mod / s) if s > 0 else 0.0
    else:
        h_mod = None

    w_p = ((p[4] + p[5] + p[6] + p[7]) / p_scored) if p_scored > 0 else None
    w_b = ((b[0] + b[1] + b[2]) / b_scored) if b_scored > 0 else None
    w_bal = (0.5 * (w_p + w_b)) if (w_p is not None and w_b is not None) else None

    w_p_mod = ((p[5] + p[6] + p[7]) / p_scored) if p_scored > 0 else None
    w_b_mod = ((b[0] + b[1]) / b_scored) if b_scored > 0 else None
    w_bal_mod = (
        0.5 * (w_p_mod + w_b_mod)
        if (w_p_mod is not None and w_b_mod is not None)
        else None
    )

    return {
        "cov_a": cov_a,
        "cov_p_a": cov_p_a,
        "cov_b_a": cov_b_a,
        "reach_p_mod": reach_p_mod,
        "reach_b_mod": reach_b_mod,
        "h_mod": h_mod,
        "reach_p_sup": reach_p_sup,
        "reach_b_sup": reach_b_sup,
        "w_p": w_p,
        "w_b": w_b,
        "w_bal": w_bal,
        "w_bal_mod": w_bal_mod,
        "p_strong": (p[0] / p_tot) if p_tot > 0 else None,
        "p_moderate": (p[1] / p_tot) if p_tot > 0 else None,
        "p_supporting": (p[2] / p_tot) if p_tot > 0 else None,
        "p_indet": (p[3] / p_tot) if p_tot > 0 else None,
        "p_wrong_any": ((p[4] + p[5] + p[6] + p[7]) / p_tot) if p_tot > 0 else None,
        "p_missing": (p[8] / p_tot) if p_tot > 0 else None,
        "b_verystrong": (b[7] / b_tot) if b_tot > 0 else None,
        "b_strong": (b[6] / b_tot) if b_tot > 0 else None,
        "b_moderate": (b[5] / b_tot) if b_tot > 0 else None,
        "b_supporting": (b[4] / b_tot) if b_tot > 0 else None,
        "b_indet": (b[3] / b_tot) if b_tot > 0 else None,
        "b_wrong_any": ((b[0] + b[1] + b[2]) / b_tot) if b_tot > 0 else None,
        "b_missing": (b[8] / b_tot) if b_tot > 0 else None,
    }


def _empirical_lr_from_counts(counts_18: list[int] | tuple[int, ...]) -> dict[str, dict[str, Any]]:
    """Compute descriptive per-band empirical likelihood ratios on scored variants."""
    p = counts_18[:9]
    b = counts_18[9:]
    p_scored = sum(p[:8])
    b_scored = sum(b[:8])
    out: dict[str, dict[str, Any]] = {}
    for idx, name in enumerate(BUCKET_NAMES[:8]):
        p_cnt = p[idx]
        b_cnt = b[idx]
        p_rate = (p_cnt / p_scored) if p_scored > 0 else None
        b_rate = (b_cnt / b_scored) if b_scored > 0 else None
        if name.startswith("PP3"):
            lr = (
                (p_rate / b_rate)
                if (p_rate is not None and b_rate is not None and b_rate > 0)
                else (math.inf if (p_rate and b_rate == 0) else None)
            )
            direction = "PP3"
        elif name.startswith("BP4"):
            lr = (
                (b_rate / p_rate)
                if (p_rate is not None and b_rate is not None and p_rate > 0)
                else (math.inf if (b_rate and p_rate == 0) else None)
            )
            direction = "BP4"
        else:
            lr = (
                (p_rate / b_rate)
                if (p_rate is not None and b_rate is not None and b_rate > 0)
                else None
            )
            direction = "Indeterminate"
        out[name] = {
            "direction": direction,
            "n_p": p_cnt,
            "n_b": b_cnt,
            "lr": None if lr is None or math.isinf(lr) else lr,
            "lr_inf": bool(lr is not None and math.isinf(lr)),
        }
    return out


def summarize_variants(
    variants: list[dict[str, Any]],
    *,
    reps: int = BOOTSTRAP_REPS,
    seed: int = BOOTSTRAP_SEED,
    tools: tuple[str, ...] = TOOLS,
) -> dict[str, Any]:
    """Compute point estimates, raw counts, empirical LRs, and paired gene-cluster bootstrap CIs.

    Each variant record must contain:
      - `gene`: str (cluster unit)
      - `y`: int (1 for P/LP, 0 for B/LB)
      - `in_dbnsfp`: bool
      - `calls`: dict[tool, code_str] where code_str is in BUCKET_NAMES
    """
    n_a = len(variants)
    n_p_a = sum(1 for v in variants if v["y"] == 1)
    n_b_a = n_a - n_p_a
    n_b = sum(1 for v in variants if v.get("in_dbnsfp", False))
    n_p_b = sum(1 for v in variants if v.get("in_dbnsfp", False) and v["y"] == 1)
    n_b_b = n_b - n_p_b

    # Group by gene into compact 72-int arrays (4 tools x 18 ints) plus [in_dbnsfp_P, in_dbnsfp_B]
    gene_vecs: dict[str, list[int]] = {}
    gene_db_counts: dict[str, list[int]] = {}
    n_tools = len(tools)
    vec_len = n_tools * 18

    for v in variants:
        g = str(v.get("gene") or "__UNKNOWN__").upper()
        vec = gene_vecs.get(g)
        if vec is None:
            vec = [0] * vec_len
            gene_vecs[g] = vec
            gene_db_counts[g] = [0, 0]
        is_b_class = 0 if v["y"] == 1 else 1
        if v.get("in_dbnsfp", False):
            gene_db_counts[g][is_b_class] += 1
        calls = v["calls"]
        for t_i, tool in enumerate(tools):
            code = calls.get(tool, "Missing")
            b_idx = BUCKET_INDEX.get(code, 8)
            vec[t_i * 18 + is_b_class * 9 + b_idx] += 1

    genes = sorted(gene_vecs.keys())
    n_genes = len(genes)
    vecs_list = [gene_vecs[g] for g in genes]
    db_list = [gene_db_counts[g] for g in genes]

    total_vec = [0] * vec_len
    for vec in vecs_list:
        for j in range(vec_len):
            total_vec[j] += vec[j]

    point_by_tool: dict[str, dict[str, Any]] = {}
    lr_by_tool: dict[str, dict[str, Any]] = {}
    counts_by_tool: dict[str, dict[str, list[int]]] = {}

    for t_i, tool in enumerate(tools):
        c18 = total_vec[t_i * 18 : (t_i + 1) * 18]
        m = _metrics_from_counts(c18)
        scored_all = (c18[0] + c18[1] + c18[2] + c18[3] + c18[4] + c18[5] + c18[6] + c18[7])
        m["cov_b"] = (scored_all / n_b) if n_b > 0 else None
        m["n_scored"] = scored_all
        m["n_scored_p"] = sum(c18[0:8])
        m["n_scored_b"] = sum(c18[9:17])
        point_by_tool[tool] = m
        lr_by_tool[tool] = _empirical_lr_from_counts(c18)
        counts_by_tool[tool] = {
            "P": {BUCKET_NAMES[i]: c18[i] for i in range(9)},
            "B": {BUCKET_NAMES[i]: c18[9 + i] for i in range(9)},
        }

    # Bootstrap CIs + paired comparisons
    metric_keys = (
        "cov_a",
        "reach_p_mod",
        "reach_b_mod",
        "h_mod",
        "reach_p_sup",
        "reach_b_sup",
        "w_p",
        "w_b",
        "w_bal",
        "w_bal_mod",
    )
    boot_samples: dict[str, dict[str, list[float]]] = {
        t: {k: [] for k in metric_keys} for t in tools
    }
    paired_h_deltas: dict[tuple[str, str], list[float]] = {
        (a, b): [] for a in tools for b in tools if a != b
    }
    paired_w_excess: dict[str, list[float]] = {t: [] for t in tools}

    if n_genes >= 2 and reps > 0 and n_p_a > 0 and n_b_a > 0:
        rng = random.Random(seed)
        # Pre-compute which positions we actually need to accumulate in the bootstrap
        for _ in range(reps):
            # Sample gene indices with replacement and aggregate weights for ~2.5x speedup
            weights: dict[int, int] = {}
            for _ in range(n_genes):
                gi = rng.randrange(n_genes)
                weights[gi] = weights.get(gi, 0) + 1

            draw_vec = [0] * vec_len
            for gi, w in weights.items():
                gv = vecs_list[gi]
                if w == 1:
                    for j in range(vec_len):
                        draw_vec[j] += gv[j]
                else:
                    for j in range(vec_len):
                        draw_vec[j] += w * gv[j]

            draw_metrics: dict[str, dict[str, float | None]] = {}
            for t_i, tool in enumerate(tools):
                c18 = draw_vec[t_i * 18 : (t_i + 1) * 18]
                dm = _metrics_from_counts(c18)
                draw_metrics[tool] = dm
                bs = boot_samples[tool]
                for k in metric_keys:
                    val = dm[k]
                    if val is not None:
                        bs[k].append(val)

            for a in tools:
                ha = draw_metrics[a]["h_mod"]
                if ha is not None:
                    for b in tools:
                        if a == b:
                            continue
                        hb = draw_metrics[b]["h_mod"]
                        if hb is not None:
                            paired_h_deltas[(a, b)].append(ha - hb)

            if all(draw_metrics[t]["w_bal"] is not None for t in tools):
                for t in tools:
                    wt = float(draw_metrics[t]["w_bal"])  # type: ignore[arg-type]
                    max_other = max(
                        float(draw_metrics[u]["w_bal"]) for u in tools if u != t  # type: ignore[arg-type]
                    )
                    paired_w_excess[t].append(wt - max_other)

    cis_by_tool: dict[str, dict[str, list[float] | None]] = {}
    for t in tools:
        t_cis: dict[str, list[float] | None] = {}
        for k in metric_keys:
            vals = boot_samples[t][k]
            if vals:
                vals_sorted = sorted(vals)
                t_cis[k] = [
                    percentile_linear(vals_sorted, 2.5),
                    percentile_linear(vals_sorted, 97.5),
                ]
            else:
                t_cis[k] = None
        cis_by_tool[t] = t_cis

    paired_deltas_summary: dict[str, dict[str, Any]] = {}
    for (a, b), vals in paired_h_deltas.items():
        ha_pt = point_by_tool[a]["h_mod"]
        hb_pt = point_by_tool[b]["h_mod"]
        delta_pt = (
            (ha_pt - hb_pt) if (ha_pt is not None and hb_pt is not None) else None
        )
        if vals:
            svals = sorted(vals)
            ci_lo = percentile_linear(svals, 2.5)
            ci_hi = percentile_linear(svals, 97.5)
        else:
            ci_lo = ci_hi = None
        paired_deltas_summary[f"{a}_minus_{b}"] = {
            "delta_h_mod": delta_pt,
            "ci_low": ci_lo,
            "ci_high": ci_hi,
            "valid_reps": len(vals),
        }

    w_excess_summary: dict[str, dict[str, Any]] = {}
    for t in tools:
        wt_pt = point_by_tool[t]["w_bal"]
        others = [point_by_tool[u]["w_bal"] for u in tools if u != t]
        if wt_pt is not None and all(o is not None for o in others):
            excess_pt = float(wt_pt) - max(float(o) for o in others)  # type: ignore[arg-type]
        else:
            excess_pt = None
        vals = paired_w_excess[t]
        if vals:
            svals = sorted(vals)
            ci_lo = percentile_linear(svals, 2.5)
            ci_hi = percentile_linear(svals, 97.5)
        else:
            ci_lo = ci_hi = None
        w_excess_summary[t] = {
            "w_bal": wt_pt,
            "excess_over_next_worst": excess_pt,
            "ci_low": ci_lo,
            "ci_high": ci_hi,
            "is_strictly_worst": bool(
                excess_pt is not None and excess_pt > 0 and ci_lo is not None and ci_lo > 0
            ),
        }

    return {
        "n_variants_a": n_a,
        "n_p_a": n_p_a,
        "n_b_a": n_b_a,
        "n_variants_b": n_b,
        "n_p_b": n_p_b,
        "n_b_b": n_b_b,
        "n_genes": n_genes,
        "bootstrap_reps": reps,
        "bootstrap_seed": seed,
        "tools": point_by_tool,
        "cis": cis_by_tool,
        "counts": counts_by_tool,
        "empirical_lr": lr_by_tool,
        "paired_h_mod_deltas": paired_deltas_summary,
        "w_bal_excess": w_excess_summary,
    }


# ---------------------------------------------------------------------------
# Pre-registered selection rule & fallback / disagreement audit
# ---------------------------------------------------------------------------
def evaluate_selection_rule(
    primary_cohort: dict[str, Any],
    subgroup_summaries: dict[str, dict[str, Any]],
    tools: tuple[str, ...] = TOOLS,
) -> dict[str, Any]:
    """Apply pre-registered Plan Section 4.3 primary selection and fallback ranking."""
    flagged_reasons: dict[str, list[dict[str, Any]]] = {t: [] for t in tools}

    for sub_name, sub in subgroup_summaries.items():
        w_ex = sub.get("w_bal_excess", {})
        for t in tools:
            entry = w_ex.get(t, {})
            if entry.get("is_strictly_worst"):
                flagged_reasons[t].append(
                    {
                        "subgroup": sub_name,
                        "w_bal": entry.get("w_bal"),
                        "excess_over_next_worst": entry.get("excess_over_next_worst"),
                        "ci_low": entry.get("ci_low"),
                        "ci_high": entry.get("ci_high"),
                    }
                )

    eligible = [t for t in tools if not flagged_reasons[t]]
    flagged = [t for t in tools if flagged_reasons[t]]

    def rank_group(group: list[str]) -> tuple[list[str], str]:
        if len(group) <= 1:
            return list(group), "single_candidate"

        # Check Pareto dominance on (Reach_P_Mod+, Reach_B_Mod+)
        p_tools = primary_cohort["tools"]
        for cand in group:
            cp = p_tools[cand]["reach_p_mod"] or 0.0
            cb = p_tools[cand]["reach_b_mod"] or 0.0
            dominates_all = True
            for other in group:
                if other == cand:
                    continue
                op = p_tools[other]["reach_p_mod"] or 0.0
                ob = p_tools[other]["reach_b_mod"] or 0.0
                if not (cp > op and cb > ob):
                    dominates_all = False
                    break
            if dominates_all:
                rest = [t for t in group if t != cand]
                rest_sorted, _ = rank_group(rest)
                return [cand] + rest_sorted, "pareto_dominant"

        # Otherwise sort by H_Mod+, checking whether top 2 overlap in paired 95% CI
        ranked = sorted(
            group,
            key=lambda t: (
                -(p_tools[t]["h_mod"] if p_tools[t]["h_mod"] is not None else -1.0),
                -(p_tools[t]["cov_a"] if p_tools[t]["cov_a"] is not None else -1.0),
                (p_tools[t]["w_bal"] if p_tools[t]["w_bal"] is not None else 999.0),
            ),
        )
        # Apply explicit tie-break rule if top two have overlapping 95% CI on ΔH_Mod+
        if len(ranked) >= 2:
            top, runner = ranked[0], ranked[1]
            delta = primary_cohort.get("paired_h_mod_deltas", {}).get(
                f"{top}_minus_{runner}", {}
            )
            ci_lo = delta.get("ci_low")
            ci_hi = delta.get("ci_high")
            if ci_lo is not None and ci_hi is not None and ci_lo <= 0.0 <= ci_hi:
                tied_top = [top, runner]
                tied_top.sort(
                    key=lambda t: (
                        -(p_tools[t]["cov_a"] if p_tools[t]["cov_a"] is not None else -1.0),
                        (p_tools[t]["w_bal"] if p_tools[t]["w_bal"] is not None else 999.0),
                        -(p_tools[t]["h_mod"] if p_tools[t]["h_mod"] is not None else -1.0),
                    )
                )
                ranked = tied_top + ranked[2:]
                return ranked, "h_mod_ci_overlap_tiebreak"
        return ranked, "h_mod_ranked"

    eligible_ranked, selection_basis = rank_group(eligible)
    flagged_ranked, _ = rank_group(flagged)
    full_order = eligible_ranked + flagged_ranked

    return {
        "primary": full_order[0] if full_order else None,
        "fallback_order": full_order,
        "eligible_tools": eligible_ranked,
        "flagged_tools": flagged_ranked,
        "flagged_reasons": {t: r for t, r in flagged_reasons.items() if r},
        "selection_basis": selection_basis if eligible_ranked else "all_flagged_fallback",
    }


def audit_fallback_and_disagreement(
    variants: list[dict[str, Any]],
    fallback_order: list[str],
) -> dict[str, Any]:
    """Compute fallback tier usage and curator disagreement-note frequency."""
    n_total = len(variants)
    tier_counts = {t: 0 for t in fallback_order}
    still_missing = 0

    active_calls = 0
    active_pp3_or_bp4 = 0
    disagree_total = 0
    active_correct_dir = 0
    disagree_when_correct = 0
    active_wrong_dir = 0
    disagree_when_wrong = 0

    for v in variants:
        calls = v["calls"]
        chosen_tool: str | None = None
        chosen_code = "Missing"
        for t in fallback_order:
            code = calls.get(t, "Missing")
            if code != "Missing":
                chosen_tool = t
                chosen_code = code
                tier_counts[t] += 1
                break
        if chosen_tool is None:
            still_missing += 1
            continue

        active_calls += 1
        active_dir = (
            "PP3"
            if chosen_code.startswith("PP3")
            else ("BP4" if chosen_code.startswith("BP4") else None)
        )
        if active_dir is None:
            continue

        active_pp3_or_bp4 += 1
        opp_dir = "BP4" if active_dir == "PP3" else "PP3"
        has_opposite = any(
            t != chosen_tool and str(calls.get(t, "")).startswith(opp_dir)
            for t in fallback_order
        )
        if has_opposite:
            disagree_total += 1

        is_true_dir = (v["y"] == 1 and active_dir == "PP3") or (
            v["y"] == 0 and active_dir == "BP4"
        )
        if is_true_dir:
            active_correct_dir += 1
            if has_opposite:
                disagree_when_correct += 1
        else:
            active_wrong_dir += 1
            if has_opposite:
                disagree_when_wrong += 1

    return {
        "n_total": n_total,
        "tier_counts": tier_counts,
        "tier_shares": {
            t: (cnt / n_total) if n_total > 0 else None for t, cnt in tier_counts.items()
        },
        "still_missing": still_missing,
        "still_missing_share": (still_missing / n_total) if n_total > 0 else None,
        "cumulative_coverage": (
            (n_total - still_missing) / n_total if n_total > 0 else None
        ),
        "active_pp3_or_bp4": active_pp3_or_bp4,
        "disagree_count": disagree_total,
        "disagree_rate_given_call": (
            disagree_total / active_pp3_or_bp4 if active_pp3_or_bp4 > 0 else None
        ),
        "active_correct_dir": active_correct_dir,
        "disagree_when_correct": disagree_when_correct,
        "disagree_rate_when_correct": (
            disagree_when_correct / active_correct_dir if active_correct_dir > 0 else None
        ),
        "active_wrong_dir": active_wrong_dir,
        "disagree_when_wrong": disagree_when_wrong,
        "disagree_rate_when_wrong": (
            disagree_when_wrong / active_wrong_dir if active_wrong_dir > 0 else None
        ),
    }


# ---------------------------------------------------------------------------
# ClinGen CSpec SVI parsing
# ---------------------------------------------------------------------------
CSPEC_TOOL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("REVEL", re.compile(r"\bREVEL\b", re.IGNORECASE)),
    ("BayesDel", re.compile(r"\bBayesDel(?:[-_ ]?noAF|[-_ ]?addAF)?\b", re.IGNORECASE)),
    ("AlphaMissense", re.compile(r"\bAlphaMissense\b", re.IGNORECASE)),
    ("ESM1b", re.compile(r"\bESM-?1b\b", re.IGNORECASE)),
    ("SpliceAI", re.compile(r"\bSpliceAI\b", re.IGNORECASE)),
    ("MaxEntScan", re.compile(r"\bMaxEntScan\b", re.IGNORECASE)),
    ("CADD", re.compile(r"\bCADD\b", re.IGNORECASE)),
    ("VEP/PolyPhen/SIFT", re.compile(r"\b(?:SIFT|PolyPhen|MutationTaster|PROVEAN|Align[- ]?GVGD)\b", re.IGNORECASE)),
    ("EVE", re.compile(r"\bEVE\b")),
    ("MAPP/Vfold/MutPred", re.compile(r"\b(?:MutPred|MAPP|Varity|VARITY|PrimateAI)\b", re.IGNORECASE)),
)


def parse_cspec_svi_record(doc: dict[str, Any]) -> dict[str, Any]:
    """Extract release status, genes, PP3/BP4 strength rules, and tools from a CSpec SVI doc."""
    ent_id = str(doc.get("@id", "")).rstrip("/").split("/")[-1]
    label = str(doc.get("label", "")).strip()
    status = str(doc.get("currentStatus") or doc.get("cspecStatus") or "").strip()
    legacy = bool(doc.get("legacy", False))
    legacy_replaced = bool(doc.get("legacyReplaced", False))
    aff = doc.get("affiliation")
    vcep = aff.get("label", "").strip() if isinstance(aff, dict) else ""

    rule_sets_out: list[dict[str, Any]] = []
    all_genes: list[str] = []
    seen_genes: set[str] = set()
    all_tools: set[str] = set()
    pp3_applicable: list[str] = []
    bp4_applicable: list[str] = []

    for rs in doc.get("ruleSets") or []:
        if not isinstance(rs, dict):
            continue
        genes: list[str] = []
        for g in rs.get("genes") or []:
            if isinstance(g, dict) and g.get("label"):
                sym = str(g["label"]).strip()
                genes.append(sym)
                if sym not in seen_genes:
                    seen_genes.add(sym)
                    all_genes.append(sym)

        codes_out: dict[str, Any] = {}
        for cc in rs.get("criteriaCodes") or []:
            if not isinstance(cc, dict):
                continue
            code_label = str(cc.get("label", "")).strip()
            if code_label not in {"PP3", "BP4"}:
                continue
            strengths_raw = cc.get("evidenceStrengths")
            strengths_info: list[dict[str, str]] = []
            rs_tools: set[str] = set()
            applicable_levels: list[str] = []
            if isinstance(strengths_raw, list):
                for es in strengths_raw:
                    if not isinstance(es, dict):
                        continue
                    s_label = str(es.get("label", "")).strip()
                    app = str(es.get("applicability", "")).strip()
                    desc = str(es.get("description", "")).strip()
                    if app.lower() == "applicable":
                        applicable_levels.append(s_label)
                        for tool_name, pat in CSPEC_TOOL_PATTERNS:
                            if pat.search(desc):
                                rs_tools.add(tool_name)
                                all_tools.add(tool_name)
                    strengths_info.append(
                        {"strength": s_label, "applicability": app, "description": desc}
                    )
            else:
                desc = str(cc.get("description", "")).strip()
                for tool_name, pat in CSPEC_TOOL_PATTERNS:
                    if pat.search(desc):
                        rs_tools.add(tool_name)
                        all_tools.add(tool_name)
            if isinstance(strengths_raw, list) and applicable_levels:
                cc_desc = str(cc.get("description", "")).strip()
                for tool_name, pat in CSPEC_TOOL_PATTERNS:
                    if pat.search(cc_desc):
                        rs_tools.add(tool_name)
                        all_tools.add(tool_name)
            if code_label == "PP3":
                pp3_applicable.extend(applicable_levels)
            else:
                bp4_applicable.extend(applicable_levels)
            codes_out[code_label] = {
                "description": str(cc.get("description", "")).strip(),
                "applicable_strengths": applicable_levels,
                "strengths": strengths_info,
                "tools_mentioned": sorted(rs_tools),
            }
        rule_sets_out.append({"genes": genes, "codes": codes_out})

    return {
        "cspec_id": ent_id,
        "label": label,
        "version": str(doc.get("version", "")).strip(),
        "status": status,
        "legacy": legacy,
        "legacy_replaced": legacy_replaced,
        "is_active_released": (status == "Released" and not legacy),
        "last_updated": doc.get("lastUpdated"),
        "vcep": vcep,
        "genes": all_genes,
        "tools_mentioned": sorted(all_tools),
        "pp3_applicable": sorted(set(pp3_applicable)),
        "bp4_applicable": sorted(set(bp4_applicable)),
        "rule_sets": rule_sets_out,
    }
