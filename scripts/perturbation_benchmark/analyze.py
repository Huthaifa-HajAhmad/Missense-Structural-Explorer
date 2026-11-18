"""Offline statistical analysis for the Structural Perturbation pLM benchmark.

Implements pre-registered Q1-Q7 analyses from scripts/perturbation_benchmark/PLAN.md.

Usage:
  uv run --python 3.12 --with numpy,pandas,scipy,scikit-learn \\
    scripts/perturbation_benchmark/analyze.py \\
    --input-dir logs/perturbation_bench \\
    --output-dir logs/perturbation_bench
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import norm, rankdata
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_curve
from sklearn.model_selection import GroupKFold, StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

# ---------------------------------------------------------------------------
# Pre-registered constants (must match PLAN.md and src/shared/)
# ---------------------------------------------------------------------------
BOOTSTRAP_REPS = 2000
BOOTSTRAP_SEED = 20261118
EVEN_ODDS_LLR = math.log(2.0)  # 0.6931471805599453 nats
FLAT_ENTROPY_BITS = 0.95 * math.log2(20.0)  # 4.1058320569 bits

HIST_MIN = -16.0
HIST_MAX = 4.5
HIST_N_BINS = 41
HIST_EDGES = np.linspace(HIST_MIN, HIST_MAX, HIST_N_BINS + 1)
HIST_CENTERS = 0.5 * (HIST_EDGES[:-1] + HIST_EDGES[1:])
HIST_BIN_WIDTH = (HIST_MAX - HIST_MIN) / HIST_N_BINS  # 0.5

QUANTILES = [1, 5, 10, 25, 50, 75, 90, 95, 99]
CLASSES = ["pathogenic", "benign", "gnomad_common"]
PAIRWISE_TASKS = [
    ("pathogenic", "benign", "pathogenic vs benign"),
    ("pathogenic", "gnomad_common", "pathogenic vs gnomad_common"),
]

Z_95 = float(norm.ppf(0.975))  # 1.959963984540054


# ---------------------------------------------------------------------------
# Model identity helpers
# ---------------------------------------------------------------------------
def canonical_model_slug(model_name: str) -> tuple[str, int]:
    low = str(model_name).strip().lower()
    if re.search(r"esm-?2|esm2", low):
        return "esm2_650m", 0
    if "saprot" in low:
        return "saprot_35m_af2", 1
    if "vesm" in low:
        return "vesm_150m", 2
    slug = re.sub(r"[^a-z0-9]+", "_", low).strip("_") or "unknown"
    return slug, 99


def order_models(models: list[str]) -> list[str]:
    return sorted(models, key=lambda m: (canonical_model_slug(m)[1], str(m)))


# ---------------------------------------------------------------------------
# Statistical primitives
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


def fast_auroc(y: np.ndarray, score: np.ndarray) -> float | None:
    if len(y) == 0:
        return None
    n1 = int(np.sum(y == 1))
    n0 = int(len(y) - n1)
    if n1 == 0 or n0 == 0:
        return None
    ranks = rankdata(score, method="average")
    return float((np.sum(ranks[y == 1]) - n1 * (n1 + 1) / 2.0) / (n1 * n0))


def _group_arrays(
    proteins: np.ndarray, y: np.ndarray, *scores: np.ndarray
) -> tuple[list[np.ndarray], list[tuple[np.ndarray, ...]]]:
    order = np.argsort(proteins, kind="mergesort")
    p_sorted = proteins[order]
    y_sorted = y[order]
    s_sorted = [s[order] for s in scores]
    _, split_idx = np.unique(p_sorted, return_index=True)
    y_groups = np.split(y_sorted, split_idx[1:])
    s_groups_per_score = [np.split(s, split_idx[1:]) for s in s_sorted]
    s_groups = list(zip(*s_groups_per_score)) if scores else [() for _ in y_groups]
    return y_groups, s_groups


def cluster_bootstrap_auroc(
    proteins: np.ndarray,
    y: np.ndarray,
    score: np.ndarray,
    reps: int = BOOTSTRAP_REPS,
    seed: int = BOOTSTRAP_SEED,
) -> dict[str, Any]:
    point = fast_auroc(y, score)
    n_pos = int(np.sum(y == 1))
    n_neg = int(np.sum(y == 0))
    n_prot = int(len(np.unique(proteins)))
    if point is None or n_prot < 2:
        return {
            "auroc": point,
            "ci_low": None,
            "ci_high": None,
            "n_pos": n_pos,
            "n_neg": n_neg,
            "n_proteins": n_prot,
            "valid_reps": 0,
        }

    y_groups, s_groups = _group_arrays(proteins, y, score)
    g_count = len(y_groups)
    rng = np.random.Generator(np.random.PCG64(seed))
    vals: list[float] = []
    for _ in range(reps):
        idx = rng.integers(0, g_count, size=g_count)
        yb = np.concatenate([y_groups[i] for i in idx])
        sb = np.concatenate([s_groups[i][0] for i in idx])
        auc = fast_auroc(yb, sb)
        if auc is not None:
            vals.append(auc)

    if not vals:
        ci_low = ci_high = None
    else:
        arr = np.asarray(vals, dtype=float)
        ci_low = float(np.percentile(arr, 2.5))
        ci_high = float(np.percentile(arr, 97.5))

    return {
        "auroc": point,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "n_pos": n_pos,
        "n_neg": n_neg,
        "n_proteins": n_prot,
        "valid_reps": len(vals),
    }


def cluster_bootstrap_paired_delta(
    proteins: np.ndarray,
    y: np.ndarray,
    score_a: np.ndarray,
    score_b: np.ndarray,
    reps: int = BOOTSTRAP_REPS,
    seed: int = BOOTSTRAP_SEED,
) -> dict[str, Any]:
    """Paired cluster bootstrap for AUROC(score_a) - AUROC(score_b) on identical rows."""
    auc_a = fast_auroc(y, score_a)
    auc_b = fast_auroc(y, score_b)
    delta = (auc_a - auc_b) if (auc_a is not None and auc_b is not None) else None
    n_pos = int(np.sum(y == 1))
    n_neg = int(np.sum(y == 0))
    n_prot = int(len(np.unique(proteins)))
    if delta is None or n_prot < 2:
        return {
            "auroc_a": auc_a,
            "auroc_b": auc_b,
            "delta": delta,
            "ci_low": None,
            "ci_high": None,
            "a_ci_low": None,
            "a_ci_high": None,
            "b_ci_low": None,
            "b_ci_high": None,
            "n_pos": n_pos,
            "n_neg": n_neg,
            "n_proteins": n_prot,
            "valid_reps": 0,
        }

    y_groups, s_groups = _group_arrays(proteins, y, score_a, score_b)
    g_count = len(y_groups)
    rng = np.random.Generator(np.random.PCG64(seed))
    a_vals: list[float] = []
    b_vals: list[float] = []
    d_vals: list[float] = []
    for _ in range(reps):
        idx = rng.integers(0, g_count, size=g_count)
        yb = np.concatenate([y_groups[i] for i in idx])
        sab = np.concatenate([s_groups[i][0] for i in idx])
        sbb = np.concatenate([s_groups[i][1] for i in idx])
        aa = fast_auroc(yb, sab)
        ab = fast_auroc(yb, sbb)
        if aa is not None and ab is not None:
            a_vals.append(aa)
            b_vals.append(ab)
            d_vals.append(aa - ab)

    if not d_vals:
        return {
            "auroc_a": auc_a,
            "auroc_b": auc_b,
            "delta": delta,
            "ci_low": None,
            "ci_high": None,
            "a_ci_low": None,
            "a_ci_high": None,
            "b_ci_low": None,
            "b_ci_high": None,
            "n_pos": n_pos,
            "n_neg": n_neg,
            "n_proteins": n_prot,
            "valid_reps": 0,
        }

    return {
        "auroc_a": auc_a,
        "auroc_b": auc_b,
        "delta": delta,
        "ci_low": float(np.percentile(d_vals, 2.5)),
        "ci_high": float(np.percentile(d_vals, 97.5)),
        "a_ci_low": float(np.percentile(a_vals, 2.5)),
        "a_ci_high": float(np.percentile(a_vals, 97.5)),
        "b_ci_low": float(np.percentile(b_vals, 2.5)),
        "b_ci_high": float(np.percentile(b_vals, 97.5)),
        "n_pos": n_pos,
        "n_neg": n_neg,
        "n_proteins": n_prot,
        "valid_reps": len(d_vals),
    }


def compute_llr_thresholds(y: np.ndarray, llr: np.ndarray) -> dict[str, Any]:
    """Compute Youden-optimal LLR threshold and LLR threshold at negative specificity >= 0.95."""
    if len(y) == 0 or len(np.unique(y)) < 2:
        return {
            "youden_llr": None,
            "youden_j": None,
            "youden_sens": None,
            "youden_spec": None,
            "spec95_llr": None,
            "spec95_sens": None,
            "spec95_spec": None,
        }
    score = -llr
    fpr, tpr, thresh = roc_curve(y, score, drop_intermediate=False)
    finite_mask = np.isfinite(thresh)
    fpr_f = fpr[finite_mask]
    tpr_f = tpr[finite_mask]
    llr_f = -thresh[finite_mask]
    if len(llr_f) == 0:
        return {
            "youden_llr": None,
            "youden_j": None,
            "youden_sens": None,
            "youden_spec": None,
            "spec95_llr": None,
            "spec95_sens": None,
            "spec95_spec": None,
        }

    j_vals = tpr_f - fpr_f
    max_j = float(np.max(j_vals))
    best_idxs = np.where(np.abs(j_vals - max_j) <= 1e-12)[0]
    youden_llr = float(np.median(llr_f[best_idxs]))
    rep_idx = int(best_idxs[np.argmin(np.abs(llr_f[best_idxs] - youden_llr))])
    youden_sens = float(tpr_f[rep_idx])
    youden_spec = float(1.0 - fpr_f[rep_idx])

    spec_mask = fpr_f <= 0.05 + 1e-12
    if np.any(spec_mask):
        # Among thresholds achieving spec >= 0.95, choose the largest LLR (highest sensitivity).
        cand_idxs = np.where(spec_mask)[0]
        pick = int(cand_idxs[np.argmax(llr_f[cand_idxs])])
        spec95_llr = float(llr_f[pick])
        spec95_sens = float(tpr_f[pick])
        spec95_spec = float(1.0 - fpr_f[pick])
    else:
        spec95_llr = None
        spec95_sens = None
        spec95_spec = None

    return {
        "youden_llr": youden_llr,
        "youden_j": max_j,
        "youden_sens": youden_sens,
        "youden_spec": youden_spec,
        "spec95_llr": spec95_llr,
        "spec95_sens": spec95_sens,
        "spec95_spec": spec95_spec,
    }


# ---------------------------------------------------------------------------
# AlphaMissense fetcher (Q3)
# ---------------------------------------------------------------------------
def _fetch_ebi_protein_am(uniprot_id: str) -> tuple[dict[str, tuple[float, str]], str, str] | None:
    url = f"https://alphafold.ebi.ac.uk/files/AF-{urllib.parse.quote(uniprot_id)}-F1-aa-substitutions.csv"
    req = urllib.request.Request(url, headers={"User-Agent": "MissenseStructuralExplorer-Bench/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                return None
            last_mod = resp.headers.get("Last-Modified") or ""
            etag = resp.headers.get("ETag") or ""
            version = f"AFDB-EBI ({last_mod or etag or 'v1'})".strip()
            raw_text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None

    lookup: dict[str, tuple[float, str]] = {}
    reader = csv.DictReader(io.StringIO(raw_text))
    for row in reader:
        pv = (row.get("protein_variant") or "").strip().upper()
        val_s = (row.get("am_pathogenicity") or "").strip()
        cls_s = (row.get("am_class") or "").strip()
        if pv and val_s:
            try:
                lookup[pv] = (float(val_s), cls_s)
            except ValueError:
                continue
    return lookup, url, version


def _fetch_myvariant_single(uniprot_id: str, pos: int, wt: str, mut: str) -> tuple[float, str, str, str] | None:
    query = (
        f'dbnsfp.uniprot.acc:"{uniprot_id}" AND dbnsfp.aa.pos:{pos} '
        f'AND dbnsfp.aa.ref:"{wt}" AND dbnsfp.aa.alt:"{mut}"'
    )
    params = urllib.parse.urlencode({"q": query, "fields": "dbnsfp.alphamissense,dbnsfp.aa", "size": 5})
    url = f"https://myvariant.info/v1/query?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "MissenseStructuralExplorer-Bench/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None

    for hit in payload.get("hits", []):
        dbnsfp = hit.get("dbnsfp")
        if isinstance(dbnsfp, list):
            dbnsfp = dbnsfp[0] if dbnsfp else {}
        if not isinstance(dbnsfp, dict):
            continue
        am = dbnsfp.get("alphamissense")
        if isinstance(am, list):
            am = am[0] if am else {}
        if not isinstance(am, dict):
            continue
        raw_score = am.get("score") if am.get("score") is not None else am.get("am_pathogenicity")
        raw_pred = am.get("pred") if am.get("pred") is not None else am.get("am_class", "")
        if raw_score is None:
            continue
        if isinstance(raw_score, list):
            aa_info = dbnsfp.get("aa") or {}
            aa_pos = aa_info.get("pos") if isinstance(aa_info, dict) else None
            idx = 0
            if isinstance(aa_pos, list):
                for i, p_val in enumerate(aa_pos):
                    if p_val == pos and i < len(raw_score):
                        idx = i
                        break
            val = raw_score[idx]
            cls_v = raw_pred[idx] if isinstance(raw_pred, list) and idx < len(raw_pred) else raw_pred
        else:
            val = raw_score
            cls_v = raw_pred[0] if isinstance(raw_pred, list) and raw_pred else raw_pred
        try:
            return float(val), str(cls_v or ""), "https://myvariant.info/v1/query", "dbnsfp-myvariant"
        except (TypeError, ValueError):
            continue
    return None


def fetch_alphamissense_for_variants(
    variants_df: pd.DataFrame, out_path: Path, refetch: bool = False
) -> pd.DataFrame:
    """Fetch AlphaMissense scores for unique (uniprot_id, pos, wt, mut) rows."""
    unique_vars = (
        variants_df[["uniprot_id", "pos", "wt", "mut"]]
        .drop_duplicates()
        .sort_values(["uniprot_id", "pos", "wt", "mut"])
        .reset_index(drop=True)
    )

    if out_path.exists() and not refetch:
        existing = pd.read_csv(out_path)
        if {"uniprot_id", "pos", "wt", "mut", "am_pathogenicity"}.issubset(existing.columns):
            merged = unique_vars.merge(
                existing.drop_duplicates(["uniprot_id", "pos", "wt", "mut"]),
                on=["uniprot_id", "pos", "wt", "mut"],
                how="left",
            )
            missing = merged[merged["source"].isna()] if "source" in merged.columns else pd.DataFrame()
            if len(missing) == 0:
                print(f"[AlphaMissense] Reusing existing {out_path} ({len(merged)} variants).")
                return merged

    proteins = sorted(unique_vars["uniprot_id"].astype(str).unique())
    print(f"[AlphaMissense] Fetching per-protein CSVs from alphafold.ebi.ac.uk for {len(proteins)} proteins...")

    protein_tables: dict[str, tuple[dict[str, tuple[float, str]], str, str]] = {}
    fallback_proteins: list[str] = []

    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(_fetch_ebi_protein_am, uid): uid for uid in proteins}
        for fut in as_completed(futs):
            uid = futs[fut]
            res = fut.result()
            if res is not None:
                protein_tables[uid] = res
            else:
                fallback_proteins.append(uid)

    print(
        f"[AlphaMissense] EBI hit {len(protein_tables)}/{len(proteins)} proteins; "
        f"fallback needed for {len(fallback_proteins)} proteins."
    )

    rows: list[dict[str, Any]] = []
    for row in unique_vars.itertuples(index=False):
        uid = str(row.uniprot_id)
        pos = int(row.pos)
        wt = str(row.wt).upper()
        mut = str(row.mut).upper()
        key = f"{wt}{pos}{mut}"
        if uid in protein_tables:
            lookup, src, ver = protein_tables[uid]
            if key in lookup:
                score, cls_s = lookup[key]
                rows.append(
                    {
                        "uniprot_id": uid,
                        "pos": pos,
                        "wt": wt,
                        "mut": mut,
                        "am_pathogenicity": score,
                        "am_class": cls_s,
                        "source": src,
                        "version": ver,
                    }
                )
            else:
                rows.append(
                    {
                        "uniprot_id": uid,
                        "pos": pos,
                        "wt": wt,
                        "mut": mut,
                        "am_pathogenicity": np.nan,
                        "am_class": "",
                        "source": src,
                        "version": f"{ver}|variant_absent",
                    }
                )
        else:
            mv = _fetch_myvariant_single(uid, pos, wt, mut)
            if mv is not None:
                score, cls_s, src, ver = mv
                rows.append(
                    {
                        "uniprot_id": uid,
                        "pos": pos,
                        "wt": wt,
                        "mut": mut,
                        "am_pathogenicity": score,
                        "am_class": cls_s,
                        "source": src,
                        "version": ver,
                    }
                )
            else:
                rows.append(
                    {
                        "uniprot_id": uid,
                        "pos": pos,
                        "wt": wt,
                        "mut": mut,
                        "am_pathogenicity": np.nan,
                        "am_class": "",
                        "source": "unavailable",
                        "version": "not_found",
                    }
                )
            time.sleep(0.05)

    am_df = pd.DataFrame(rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    am_df.to_csv(out_path, index=False)
    n_found = int(am_df["am_pathogenicity"].notna().sum())
    print(f"[AlphaMissense] Wrote {out_path}: {n_found}/{len(am_df)} variants scored.")
    return am_df


# ---------------------------------------------------------------------------
# Loading & preprocessing
# ---------------------------------------------------------------------------
def load_scores(scores_path: Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    df = pd.read_csv(scores_path)
    required = {
        "uniprot_id",
        "pos",
        "wt",
        "mut",
        "label",
        "label_source",
        "model",
        "checkpoint",
        "scoring_method",
        "llr",
        "entropy_bits",
    }
    missing_cols = required - set(df.columns)
    if missing_cols:
        raise ValueError(f"{scores_path} missing required columns: {sorted(missing_cols)}")

    df["uniprot_id"] = df["uniprot_id"].astype(str).str.strip()
    df["pos"] = pd.to_numeric(df["pos"], errors="coerce").astype("Int64")
    df["wt"] = df["wt"].astype(str).str.strip().str.upper()
    df["mut"] = df["mut"].astype(str).str.strip().str.upper()
    df["label"] = df["label"].astype(str).str.strip()
    df["model"] = df["model"].astype(str).str.strip()
    df["llr"] = pd.to_numeric(df["llr"], errors="coerce")
    df["entropy_bits"] = pd.to_numeric(df["entropy_bits"], errors="coerce")
    if "truncated" in df.columns:
        df["truncated_bool"] = df["truncated"].astype(str).str.strip().str.lower().isin(["true", "1", "yes"])
    else:
        df["truncated_bool"] = False
    if "structure_token" not in df.columns:
        df["structure_token"] = np.nan

    n_raw = len(df)
    valid_label = df["label"].isin(CLASSES)
    n_invalid_label = int((~valid_label).sum())
    df = df[valid_label & df["pos"].notna()].copy()

    key_cols = ["uniprot_id", "pos", "wt", "mut", "label", "model"]
    n_dup = int(df.duplicated(subset=key_cols).sum())
    df = df.drop_duplicates(subset=key_cols, keep="first").reset_index(drop=True)

    # Check variants appearing under multiple labels
    var_labels = df.groupby(["uniprot_id", "pos", "wt", "mut"])["label"].nunique()
    n_multi_label_vars = int((var_labels > 1).sum())

    df["is_scored"] = np.isfinite(df["llr"])
    df["is_flat"] = df["is_scored"] & np.isfinite(df["entropy_bits"]) & (df["entropy_bits"] >= FLAT_ENTROPY_BITS)
    df["is_nonflat"] = df["is_scored"] & (~df["is_flat"])
    df["favours_native"] = df["is_nonflat"] & (df["llr"] <= -EVEN_ODDS_LLR)

    meta = {
        "n_raw_rows": n_raw,
        "n_invalid_label_dropped": n_invalid_label,
        "n_duplicate_rows_dropped": n_dup,
        "n_multi_label_variants": n_multi_label_vars,
        "n_rows_after_clean": len(df),
        "n_missing_llr": int((~df["is_scored"]).sum()),
        "n_missing_entropy_with_llr": int((df["is_scored"] & ~np.isfinite(df["entropy_bits"])).sum()),
        "models": order_models(df["model"].unique().tolist()),
        "label_sources": sorted(df["label_source"].dropna().astype(str).unique().tolist()),
    }
    return df, meta


# ---------------------------------------------------------------------------
# Q1: Headline honesty
# ---------------------------------------------------------------------------
def run_q1(df: pd.DataFrame) -> dict[str, Any]:
    # Per (uniprot_id, pos, wt, mut, label) aggregate across models
    grouped = (
        df.groupby(["uniprot_id", "pos", "wt", "mut", "label"], as_index=False)
        .agg(
            n_models_present=("model", "nunique"),
            n_scored=("is_scored", "sum"),
            n_nonflat=("is_nonflat", "sum"),
            n_flat=("is_flat", "sum"),
            n_fav_native=("favours_native", "sum"),
        )
    )

    per_class: dict[str, Any] = {}
    for cls in CLASSES:
        sub = grouped[grouped["label"] == cls]
        n_total = len(sub)
        n_prot_total = int(sub["uniprot_id"].nunique())
        nonflat_sub = sub[sub["n_nonflat"] >= 1]
        n_eval = len(nonflat_sub)
        n_prot_eval = int(nonflat_sub["uniprot_id"].nunique())
        n_all_flat = int((sub["n_nonflat"] == 0).sum())

        k_all = int((nonflat_sub["n_fav_native"] == nonflat_sub["n_nonflat"]).sum())
        k_ge1 = int((nonflat_sub["n_fav_native"] >= 1).sum())
        k_maj = int((nonflat_sub["n_fav_native"] * 2 > nonflat_sub["n_scored"]).sum())

        r_all, all_lo, all_hi = wilson_ci(k_all, n_eval)
        r_ge1, ge1_lo, ge1_hi = wilson_ci(k_ge1, n_eval)
        r_maj, maj_lo, maj_hi = wilson_ci(k_maj, n_eval)

        per_class[cls] = {
            "n_total_variants": n_total,
            "n_total_proteins": n_prot_total,
            "n_eval_nonflat_ge1": n_eval,
            "n_eval_proteins": n_prot_eval,
            "n_all_flat_or_unscored": n_all_flat,
            "all_favour_native": {"k": k_all, "n": n_eval, "rate": r_all, "ci_low": all_lo, "ci_high": all_hi},
            "ge1_favour_native": {"k": k_ge1, "n": n_eval, "rate": r_ge1, "ci_low": ge1_lo, "ci_high": ge1_hi},
            "ui_majority_favour_native": {"k": k_maj, "n": n_eval, "rate": r_maj, "ci_low": maj_lo, "ci_high": maj_hi},
        }

    ben_rate = per_class["benign"]["all_favour_native"]["rate"]
    gno_rate = per_class["gnomad_common"]["all_favour_native"]["rate"]
    ben_ge1 = per_class["benign"]["ge1_favour_native"]["rate"]
    gno_ge1 = per_class["gnomad_common"]["ge1_favour_native"]["rate"]

    not_discriminative_all = bool(
        (ben_rate is not None and ben_rate >= 0.5) or (gno_rate is not None and gno_rate >= 0.5)
    )
    not_discriminative_ge1 = bool(
        (ben_ge1 is not None and ben_ge1 >= 0.5) or (gno_ge1 is not None and gno_ge1 >= 0.5)
    )

    return {
        "per_class": per_class,
        "decision_all_favour_native_not_discriminative": not_discriminative_all,
        "decision_ge1_favour_native_not_discriminative": not_discriminative_ge1,
    }


# ---------------------------------------------------------------------------
# Q2: Per-model discrimination, per-protein balanced AUROC, thresholds
# ---------------------------------------------------------------------------
def _per_protein_balanced_auroc(
    sub: pd.DataFrame, pos_label: str, neg_label: str, score_col: str = "score"
) -> dict[str, Any]:
    prot_aucs: list[float] = []
    n_pos_tot = 0
    n_neg_tot = 0
    for _, grp in sub.groupby("uniprot_id"):
        y_g = (grp["label"] == pos_label).to_numpy(dtype=int)
        n1 = int(np.sum(y_g == 1))
        n0 = int(np.sum(y_g == 0))
        if n1 >= 5 and n0 >= 5:
            auc = fast_auroc(y_g, grp[score_col].to_numpy(dtype=float))
            if auc is not None:
                prot_aucs.append(auc)
                n_pos_tot += n1
                n_neg_tot += n0

    k = len(prot_aucs)
    if k == 0:
        return {
            "k_proteins": 0,
            "n_pos": 0,
            "n_neg": 0,
            "mean": None,
            "ci_low": None,
            "ci_high": None,
            "median": None,
            "sd": None,
            "iqr": None,
        }

    arr = np.asarray(prot_aucs, dtype=float)
    mean_val = float(np.mean(arr))
    if k >= 2:
        rng = np.random.Generator(np.random.PCG64(BOOTSTRAP_SEED))
        idx = rng.integers(0, k, size=(BOOTSTRAP_REPS, k))
        boot_means = np.mean(arr[idx], axis=1)
        ci_low = float(np.percentile(boot_means, 2.5))
        ci_high = float(np.percentile(boot_means, 97.5))
    else:
        ci_low = ci_high = None

    return {
        "k_proteins": k,
        "n_pos": n_pos_tot,
        "n_neg": n_neg_tot,
        "mean": mean_val,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "median": float(np.median(arr)),
        "sd": float(np.std(arr, ddof=1)) if k > 1 else 0.0,
        "iqr": float(np.percentile(arr, 75) - np.percentile(arr, 25)),
    }


def run_q2(df: pd.DataFrame, models: list[str]) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for m in models:
        mdf = df[(df["model"] == m) & df["is_scored"]].copy()
        mdf["score"] = -mdf["llr"]
        m_res: dict[str, Any] = {}

        for pos_lbl, neg_lbl, task_name in PAIRWISE_TASKS:
            sub = mdf[mdf["label"].isin([pos_lbl, neg_lbl])].copy()
            y = (sub["label"] == pos_lbl).to_numpy(dtype=int)
            s = sub["score"].to_numpy(dtype=float)
            llr = sub["llr"].to_numpy(dtype=float)
            prots = sub["uniprot_id"].to_numpy()

            overall = cluster_bootstrap_auroc(prots, y, s)
            balanced = _per_protein_balanced_auroc(sub, pos_lbl, neg_lbl, "score")
            thresh = compute_llr_thresholds(y, llr)

            # Truncation sensitivity
            trunc_sens: dict[str, Any] = {}
            for t_flag, t_name in [(False, "untruncated"), (True, "truncated")]:
                tsub = sub[sub["truncated_bool"] == t_flag]
                if len(tsub) > 0 and tsub["label"].nunique() == 2:
                    trunc_sens[t_name] = cluster_bootstrap_auroc(
                        tsub["uniprot_id"].to_numpy(),
                        (tsub["label"] == pos_lbl).to_numpy(dtype=int),
                        tsub["score"].to_numpy(dtype=float),
                    )

            # SaProt structure token sensitivity
            struct_sens: dict[str, Any] = {}
            if canonical_model_slug(m)[0] == "saprot_35m_af2":
                tok_s = sub["structure_token"].fillna("#").astype(str).str.strip()
                has_3di = tok_s != "#"
                for flag, s_name in [(True, "structure_aware_3di"), (False, "sequence_only_hash")]:
                    ssub = sub[has_3di == flag]
                    if len(ssub) > 0 and ssub["label"].nunique() == 2:
                        struct_sens[s_name] = cluster_bootstrap_auroc(
                            ssub["uniprot_id"].to_numpy(),
                            (ssub["label"] == pos_lbl).to_numpy(dtype=int),
                            ssub["score"].to_numpy(dtype=float),
                        )

            m_res[task_name] = {
                "overall": overall,
                "per_protein_balanced": balanced,
                "thresholds": thresh,
                "truncation_sensitivity": trunc_sens,
                "structure_token_sensitivity": struct_sens,
            }
        results[m] = m_res
    return results


# ---------------------------------------------------------------------------
# Q3: Incremental value beyond AlphaMissense
# ---------------------------------------------------------------------------
def _cv_logreg_oof(
    X: np.ndarray, y: np.ndarray, groups: np.ndarray, n_splits: int = 5
) -> tuple[np.ndarray, list[float], str]:
    n_groups = len(np.unique(groups))
    k = min(n_splits, n_groups)
    if k < 2:
        raise ValueError("Need at least 2 unique proteins for GroupKFold CV.")

    cv = GroupKFold(n_splits=k)
    splits = list(cv.split(X, y, groups))
    # Verify every training fold has both classes; fall back to StratifiedGroupKFold only if GroupKFold fails class presence
    cv_name = f"GroupKFold(n_splits={k})"
    if any(len(np.unique(y[tr])) < 2 for tr, _ in splits):
        cv = StratifiedGroupKFold(n_splits=k)
        splits = list(cv.split(X, y, groups))
        cv_name = f"StratifiedGroupKFold(n_splits={k}) [fallback: single-class GroupKFold train fold]"

    oof = np.full(len(y), np.nan, dtype=float)
    fold_aucs: list[float] = []
    for tr, te in splits:
        if len(np.unique(y[tr])) < 2:
            continue
        pipe = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", LogisticRegression(C=1.0, max_iter=1000, random_state=BOOTSTRAP_SEED)),
            ]
        )
        pipe.fit(X[tr], y[tr])
        probs = pipe.predict_proba(X[te])[:, 1]
        oof[te] = probs
        f_auc = fast_auroc(y[te], probs)
        if f_auc is not None:
            fold_aucs.append(f_auc)
    return oof, fold_aucs, cv_name


def run_q3(df: pd.DataFrame, am_df: pd.DataFrame | None, models: list[str]) -> dict[str, Any]:
    if am_df is None or len(am_df) == 0:
        return {"status": "MISSING", "reason": "No AlphaMissense scores available."}

    am_clean = am_df.drop_duplicates(["uniprot_id", "pos", "wt", "mut"]).copy()
    am_clean["am_pathogenicity"] = pd.to_numeric(am_clean["am_pathogenicity"], errors="coerce")

    # Pivot LLR by (uniprot_id, pos, wt, mut, label)
    scored = df[df["is_scored"]].copy()
    piv = (
        scored.pivot_table(
            index=["uniprot_id", "pos", "wt", "mut", "label"],
            columns="model",
            values="llr",
            aggfunc="first",
        )
        .reset_index()
    )
    piv = piv.merge(
        am_clean[["uniprot_id", "pos", "wt", "mut", "am_pathogenicity"]],
        on=["uniprot_id", "pos", "wt", "mut"],
        how="left",
    )

    n_unique_variants = len(piv[["uniprot_id", "pos", "wt", "mut"]].drop_duplicates())
    n_am_scored = int(
        piv[["uniprot_id", "pos", "wt", "mut", "am_pathogenicity"]]
        .drop_duplicates(["uniprot_id", "pos", "wt", "mut"])["am_pathogenicity"]
        .notna()
        .sum()
    )

    out: dict[str, Any] = {
        "status": "OK",
        "am_coverage": {
            "n_scored_variants": n_am_scored,
            "n_total_variants": n_unique_variants,
            "fraction": (n_am_scored / n_unique_variants) if n_unique_variants > 0 else 0.0,
        },
        "tasks": {},
    }

    for pos_lbl, neg_lbl, task_name in PAIRWISE_TASKS:
        tdf = piv[piv["label"].isin([pos_lbl, neg_lbl])].copy()
        task_res: dict[str, Any] = {}

        # Standalone raw AM
        am_only = tdf[tdf["am_pathogenicity"].notna()].copy()
        if len(am_only) > 0 and am_only["label"].nunique() == 2:
            task_res["AM_raw_standalone"] = cluster_bootstrap_auroc(
                am_only["uniprot_id"].to_numpy(),
                (am_only["label"] == pos_lbl).to_numpy(dtype=int),
                am_only["am_pathogenicity"].to_numpy(dtype=float),
            )

        specs: list[tuple[str, list[str]]] = [(f"AM + {m}", [m]) for m in models if m in piv.columns]
        avail_all = [m for m in models if m in piv.columns]
        if len(avail_all) >= 2:
            specs.append(("AM + all models", avail_all))

        comparisons: dict[str, Any] = {}
        for label_name, m_cols in specs:
            req_cols = ["am_pathogenicity"] + m_cols
            sub = tdf.dropna(subset=req_cols).copy()
            if len(sub) < 10 or sub["label"].nunique() < 2 or sub["uniprot_id"].nunique() < 2:
                comparisons[label_name] = {
                    "status": "INSUFFICIENT_DATA",
                    "n_variants": len(sub),
                    "n_proteins": int(sub["uniprot_id"].nunique()),
                }
                continue

            y = (sub["label"] == pos_lbl).to_numpy(dtype=int)
            groups = sub["uniprot_id"].to_numpy()
            X_base = sub[["am_pathogenicity"]].to_numpy(dtype=float)
            X_plus = sub[["am_pathogenicity"] + m_cols].to_numpy(dtype=float)

            oof_base, fold_base, cv_name = _cv_logreg_oof(X_base, y, groups)
            oof_plus, fold_plus, _ = _cv_logreg_oof(X_plus, y, groups)

            valid_oof = np.isfinite(oof_base) & np.isfinite(oof_plus)
            paired = cluster_bootstrap_paired_delta(
                groups[valid_oof], y[valid_oof], oof_plus[valid_oof], oof_base[valid_oof]
            )
            comparisons[label_name] = {
                "status": "OK",
                "cv": cv_name,
                "models_included": m_cols,
                "n_pos": int(np.sum(y == 1)),
                "n_neg": int(np.sum(y == 0)),
                "n_proteins": int(sub["uniprot_id"].nunique()),
                "auroc_am_cv": paired["auroc_b"],
                "auroc_am_cv_ci": [paired["b_ci_low"], paired["b_ci_high"]],
                "auroc_plus_cv": paired["auroc_a"],
                "auroc_plus_cv_ci": [paired["a_ci_low"], paired["a_ci_high"]],
                "delta_auroc": paired["delta"],
                "delta_ci_low": paired["ci_low"],
                "delta_ci_high": paired["ci_high"],
                "fold_mean_am": float(np.mean(fold_base)) if fold_base else None,
                "fold_sd_am": float(np.std(fold_base, ddof=1)) if len(fold_base) > 1 else None,
                "fold_mean_plus": float(np.mean(fold_plus)) if fold_plus else None,
                "fold_sd_plus": float(np.std(fold_plus, ddof=1)) if len(fold_plus) > 1 else None,
                "significant_gain": bool(paired["ci_low"] is not None and paired["ci_low"] > 0.0),
            }

        task_res["comparisons"] = comparisons
        out["tasks"][task_name] = task_res

    return out


# ---------------------------------------------------------------------------
# Q4: Cross-model agreement vs best single model
# ---------------------------------------------------------------------------
def run_q4(df: pd.DataFrame, models: list[str]) -> dict[str, Any]:
    scored = df[df["is_scored"]].copy()
    piv_llr = scored.pivot_table(
        index=["uniprot_id", "pos", "wt", "mut", "label"], columns="model", values="llr", aggfunc="first"
    )
    piv_fav = scored.pivot_table(
        index=["uniprot_id", "pos", "wt", "mut", "label"],
        columns="model",
        values="favours_native",
        aggfunc="first",
    )
    avail = [m for m in models if m in piv_llr.columns]
    if len(avail) < 2:
        return {"status": "INSUFFICIENT_MODELS", "models": avail}

    llr_complete = piv_llr[avail].dropna().copy()
    fav_complete = piv_fav.loc[llr_complete.index, avail].fillna(False).astype(int)
    base = llr_complete.reset_index()
    base["count_favour_native"] = fav_complete.sum(axis=1).to_numpy()

    out: dict[str, Any] = {"status": "OK", "models": avail, "tasks": {}}
    for pos_lbl, neg_lbl, task_name in PAIRWISE_TASKS:
        sub = base[base["label"].isin([pos_lbl, neg_lbl])].copy()
        if len(sub) < 10 or sub["label"].nunique() < 2:
            out["tasks"][task_name] = {"status": "INSUFFICIENT_DATA", "n_variants": len(sub)}
            continue

        y = (sub["label"] == pos_lbl).to_numpy(dtype=int)
        prots = sub["uniprot_id"].to_numpy()

        # Within-model z-scored ΔLLR on this comparison set
        z_cols = []
        single_aucs: dict[str, dict[str, Any]] = {}
        for m in avail:
            vals = sub[m].to_numpy(dtype=float)
            sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else 1.0
            z = (vals - float(np.mean(vals))) / (sd if sd > 0 else 1.0)
            z_cols.append(z)
            single_aucs[m] = cluster_bootstrap_auroc(prots, y, -vals)

        best_model = max(
            avail,
            key=lambda m: single_aucs[m]["auroc"] if single_aucs[m]["auroc"] is not None else -1.0,
        )
        best_score = -sub[best_model].to_numpy(dtype=float)
        count_score = sub["count_favour_native"].to_numpy(dtype=float)
        mean_z_score = -np.mean(np.column_stack(z_cols), axis=1)

        cmp_count = cluster_bootstrap_paired_delta(prots, y, count_score, best_score)
        cmp_meanz = cluster_bootstrap_paired_delta(prots, y, mean_z_score, best_score)

        out["tasks"][task_name] = {
            "status": "OK",
            "n_pos": int(np.sum(y == 1)),
            "n_neg": int(np.sum(y == 0)),
            "n_proteins": int(sub["uniprot_id"].nunique()),
            "single_models": single_aucs,
            "best_single_model": best_model,
            "best_single_auroc": single_aucs[best_model],
            "count_favour_native": cmp_count,
            "neg_mean_z_llr": cmp_meanz,
        }
    return out


# ---------------------------------------------------------------------------
# Q5: Positional entropy alone
# ---------------------------------------------------------------------------
def run_q5(df: pd.DataFrame, models: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for m in models:
        mdf = df[(df["model"] == m) & np.isfinite(df["entropy_bits"])].copy()
        mdf["neg_entropy"] = -mdf["entropy_bits"]
        m_res: dict[str, Any] = {}
        for pos_lbl, neg_lbl, task_name in PAIRWISE_TASKS:
            sub = mdf[mdf["label"].isin([pos_lbl, neg_lbl])]
            if len(sub) == 0 or sub["label"].nunique() < 2:
                m_res[task_name] = {"auroc": None, "n_pos": 0, "n_neg": 0, "n_proteins": 0}
                continue
            m_res[task_name] = cluster_bootstrap_auroc(
                sub["uniprot_id"].to_numpy(),
                (sub["label"] == pos_lbl).to_numpy(dtype=int),
                sub["neg_entropy"].to_numpy(dtype=float),
            )
        out[m] = m_res
    return out


# ---------------------------------------------------------------------------
# Q6: Embedding shift
# ---------------------------------------------------------------------------
def run_q6(df: pd.DataFrame, emb_path: Path) -> dict[str, Any]:
    if not emb_path.exists():
        return {"status": "MISSING", "path": str(emb_path), "decision": "NOT_EVALUATED_MISSING_FILE"}

    edf = pd.read_csv(emb_path)
    if len(edf) == 0:
        return {"status": "EMPTY", "path": str(emb_path), "decision": "NOT_EVALUATED_EMPTY_FILE"}

    req = {"uniprot_id", "pos", "wt", "mut", "model", "shift_at_site", "shift_window_mean"}
    if not req.issubset(edf.columns):
        return {
            "status": "INVALID_SCHEMA",
            "missing_columns": sorted(req - set(edf.columns)),
            "decision": "NOT_EVALUATED_INVALID_SCHEMA",
        }

    edf = edf.copy()
    edf["uniprot_id"] = edf["uniprot_id"].astype(str).str.strip()
    edf["pos"] = pd.to_numeric(edf["pos"], errors="coerce").astype("Int64")
    edf["wt"] = edf["wt"].astype(str).str.strip().str.upper()
    edf["mut"] = edf["mut"].astype(str).str.strip().str.upper()
    edf["model"] = edf["model"].astype(str).str.strip()
    edf["shift_at_site"] = pd.to_numeric(edf["shift_at_site"], errors="coerce")
    edf["shift_window_mean"] = pd.to_numeric(edf["shift_window_mean"], errors="coerce")
    edf = edf.drop_duplicates(subset=["uniprot_id", "pos", "wt", "mut", "model"])

    var_labels = df[["uniprot_id", "pos", "wt", "mut", "label"]].drop_duplicates()
    merged = edf.merge(var_labels, on=["uniprot_id", "pos", "wt", "mut"], how="inner")
    if len(merged) == 0:
        return {"status": "NO_MATCHING_VARIANTS", "path": str(emb_path), "decision": "NOT_EVALUATED_NO_MATCH"}

    models = order_models(merged["model"].unique().tolist())
    metrics_out: dict[str, Any] = {}
    any_primary_pass = False

    for m in models:
        mdf = merged[merged["model"] == m]
        m_res: dict[str, Any] = {}
        for metric_col in ["shift_at_site", "shift_window_mean"]:
            metric_res: dict[str, Any] = {}
            for pos_lbl, neg_lbl, task_name in PAIRWISE_TASKS:
                sub = mdf[mdf["label"].isin([pos_lbl, neg_lbl]) & np.isfinite(mdf[metric_col])]
                if len(sub) == 0 or sub["label"].nunique() < 2:
                    res = {"auroc": None, "ci_low": None, "ci_high": None, "n_pos": 0, "n_neg": 0, "n_proteins": 0, "passes": False}
                else:
                    res = cluster_bootstrap_auroc(
                        sub["uniprot_id"].to_numpy(),
                        (sub["label"] == pos_lbl).to_numpy(dtype=int),
                        sub[metric_col].to_numpy(dtype=float),
                    )
                    passes = bool(
                        res["auroc"] is not None
                        and res["auroc"] >= 0.60
                        and res["ci_low"] is not None
                        and res["ci_low"] > 0.50
                    )
                    res["passes"] = passes
                    if task_name == "pathogenic vs benign" and passes:
                        any_primary_pass = True
                metric_res[task_name] = res
            m_res[metric_col] = metric_res
        metrics_out[m] = m_res

    decision = "KEEP_EMBEDDINGS_SUBTAB" if any_primary_pass else "RECOMMEND_REMOVE_EMBEDDINGS_SUBTAB"
    return {
        "status": "OK",
        "models": metrics_out,
        "any_primary_pass": any_primary_pass,
        "decision": decision,
    }


# ---------------------------------------------------------------------------
# Q7: Reference distributions JSON for the UI
# ---------------------------------------------------------------------------
def build_reference_jsons(
    df: pd.DataFrame, models: list[str], q2_res: dict[str, Any], out_dir: Path, label_sources: list[str]
) -> list[Path]:
    written: list[Path] = []
    now_iso = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for m in models:
        slug, _ = canonical_model_slug(m)
        mdf = df[(df["model"] == m) & df["is_scored"]].copy()
        checkpoints = sorted(mdf["checkpoint"].dropna().astype(str).unique().tolist())
        methods = sorted(mdf["scoring_method"].dropna().astype(str).unique().tolist())

        pv_thresh = q2_res.get(m, {}).get("pathogenic vs benign", {}).get("thresholds", {})
        classes_payload: dict[str, Any] = {}

        for cls in CLASSES:
            cdf = mdf[mdf["label"] == cls]
            vals = cdf["llr"].to_numpy(dtype=float)
            n = int(len(vals))
            n_prot = int(cdf["uniprot_id"].nunique())

            if n > 0:
                q_vals = np.percentile(vals, QUANTILES)
                quantiles_dict = {str(q): round(float(v), 6) for q, v in zip(QUANTILES, q_vals)}
                clamped_low = int(np.sum(vals < HIST_MIN))
                clamped_high = int(np.sum(vals > HIST_MAX))
                clipped = np.clip(vals, HIST_MIN, HIST_MAX)
                counts, _ = np.histogram(clipped, bins=HIST_EDGES)
                counts_list = [int(c) for c in counts]
                density_list = [round(c / n, 6) for c in counts_list]
            else:
                quantiles_dict = {str(q): None for q in QUANTILES}
                clamped_low = 0
                clamped_high = 0
                counts_list = [0] * HIST_N_BINS
                density_list = [0.0] * HIST_N_BINS

            classes_payload[cls] = {
                "n": n,
                "n_proteins": n_prot,
                "quantiles": quantiles_dict,
                "histogram": {
                    "counts": counts_list,
                    "density": density_list,
                    "clamped_low": clamped_low,
                    "clamped_high": clamped_high,
                },
            }

        payload = {
            "schema_version": 1,
            "model": m,
            "model_slug": slug,
            "checkpoint": checkpoints[0] if len(checkpoints) == 1 else checkpoints,
            "scoring_method": methods[0] if len(methods) == 1 else methods,
            "unit": "nats",
            "generated_at": now_iso,
            "sources": label_sources,
            "thresholds": {
                "youden_llr": round(pv_thresh["youden_llr"], 4) if pv_thresh.get("youden_llr") is not None else None,
                "benign_spec95_llr": round(pv_thresh["spec95_llr"], 4) if pv_thresh.get("spec95_llr") is not None else None,
                "even_odds_llr": round(-EVEN_ODDS_LLR, 6),
            },
            "histogram_spec": {
                "n_bins": HIST_N_BINS,
                "range": [HIST_MIN, HIST_MAX],
                "bin_width": HIST_BIN_WIDTH,
                "edges": [round(float(x), 4) for x in HIST_EDGES],
                "centers": [round(float(x), 4) for x in HIST_CENTERS],
                "clamp_tails": True,
            },
            "classes": classes_payload,
        }

        out_file = out_dir / f"reference_{slug}.json"
        out_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        written.append(out_file)

    return written


# ---------------------------------------------------------------------------
# Formatting & RESULTS.md writer
# ---------------------------------------------------------------------------
def _fmt(v: float | None, digits: int = 4) -> str:
    return "NA" if v is None or not math.isfinite(v) else f"{v:.{digits}f}"


def _fmt_ci(val: float | None, lo: float | None, hi: float | None, digits: int = 4) -> str:
    if val is None:
        return "NA"
    if lo is None or hi is None:
        return f"{val:.{digits}f} (CI NA)"
    return f"{val:.{digits}f} ({lo:.{digits}f}–{hi:.{digits}f})"


def _fmt_pct_ci(val: float | None, lo: float | None, hi: float | None) -> str:
    if val is None:
        return "NA"
    if lo is None or hi is None:
        return f"{val*100:.1f}%"
    return f"{val*100:.1f}% ({lo*100:.1f}%–{hi*100:.1f}%)"


def write_results_md(
    out_path: Path,
    meta: dict[str, Any],
    q1: dict[str, Any],
    q2: dict[str, Any],
    q3: dict[str, Any],
    q4: dict[str, Any],
    q5: dict[str, Any],
    q6: dict[str, Any],
    ref_files: list[Path],
    is_synthetic: bool = False,
) -> None:
    lines: list[str] = []
    title_tag = " [SYNTHETIC VALIDATION]" if is_synthetic else ""
    lines.append(f"# Structural Perturbation pLM Benchmark Results{title_tag}")
    lines.append("")
    lines.append(f"**Generated:** {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}  ")
    lines.append(f"**Protocol:** Pre-registered in `scripts/perturbation_benchmark/PLAN.md` (2026-11-18)  ")
    lines.append(f"**Bootstrap:** {BOOTSTRAP_REPS:,} protein-cluster replicates, seed `{BOOTSTRAP_SEED}`  ")
    lines.append(f"**Sources:** {', '.join(meta['label_sources']) or 'NA'}")
    lines.append("")

    # Dataset summary
    lines.append("## Dataset & Data Quality Summary")
    lines.append("")
    lines.append(f"- Raw score rows: **{meta['n_raw_rows']:,}**; cleaned rows: **{meta['n_rows_after_clean']:,}**")
    lines.append(f"- Dropped invalid-label rows: **{meta['n_invalid_label_dropped']}**; duplicate `(variant, label, model)` rows dropped: **{meta['n_duplicate_rows_dropped']}**")
    lines.append(f"- Variants appearing in >1 label class: **{meta['n_multi_label_variants']}**")
    lines.append(f"- Rows with missing/non-finite `llr`: **{meta['n_missing_llr']}**; scored rows missing `entropy_bits`: **{meta['n_missing_entropy_with_llr']}**")
    lines.append(f"- Models evaluated: {', '.join(f'`{m}`' for m in meta['models'])}")
    lines.append("")

    # Q1
    lines.append("## Q1 — Headline Honesty (\"N of N models favour native\")")
    lines.append("")
    lines.append(f"Rule: a scored, non-flat model (`entropy_bits < {FLAT_ENTROPY_BITS:.4f}` bits) favours native iff `ΔLLR ≤ -{EVEN_ODDS_LLR:.4f}` nats (`-ln 2`).")
    lines.append("")
    lines.append("| Label Class | Total Variants (Proteins) | Eval Non-Flat ≥1 | All Non-Flat Favour Native (95% Wilson CI) | ≥1 Favour Native (95% Wilson CI) | UI Majority Favour Native | All Flat/Unscored |")
    lines.append("|---|---:|---:|---|---|---|---:|")
    for cls in CLASSES:
        c = q1["per_class"][cls]
        a = c["all_favour_native"]
        g = c["ge1_favour_native"]
        u = c["ui_majority_favour_native"]
        lines.append(
            f"| `{cls}` | {c['n_total_variants']:,} ({c['n_total_proteins']:,}) | {c['n_eval_nonflat_ge1']:,} "
            f"| {a['k']:,}/{a['n']:,} = {_fmt_pct_ci(a['rate'], a['ci_low'], a['ci_high'])} "
            f"| {g['k']:,}/{g['n']:,} = {_fmt_pct_ci(g['rate'], g['ci_low'], g['ci_high'])} "
            f"| {u['k']:,}/{u['n']:,} = {_fmt_pct_ci(u['rate'], u['ci_low'], u['ci_high'])} "
            f"| {c['n_all_flat_or_unscored']:,} |"
        )
    lines.append("")
    verdict_all = "**IS NOT DISCRIMINATIVE**" if q1["decision_all_favour_native_not_discriminative"] else "Passes `< 0.50` neutral false-positive criterion"
    verdict_ge1 = "**≥ 0.50 on neutral variants**" if q1["decision_ge1_favour_native_not_discriminative"] else "< 0.50 on neutral variants"
    lines.append(f"- **Pre-registered Decision (`all favour native` ≥ 0.50 on benign or gnomad_common):** {verdict_all}.")
    lines.append(f"- **Secondary check (`≥1 model favours native` ≥ 0.50 on benign or gnomad_common):** {verdict_ge1}.")
    lines.append("")

    # Q2
    lines.append("## Q2 — Per-Model Discrimination & Reference Thresholds")
    lines.append("")
    lines.append("### Q2a — Overall & Per-Protein-Balanced AUROC (`-ΔLLR`)")
    lines.append("")
    lines.append("| Model | Comparison | n_pos | n_neg | Proteins | Overall AUROC (95% Cluster CI) | Balanced AUROC ≥5/class (95% CI; K proteins) |")
    lines.append("|---|---|---:|---:|---:|---|---|")
    for m in meta["models"]:
        for _, _, task in PAIRWISE_TASKS:
            d = q2[m][task]
            ov = d["overall"]
            bal = d["per_protein_balanced"]
            bal_str = (
                f"{_fmt_ci(bal['mean'], bal['ci_low'], bal['ci_high'])} (K={bal['k_proteins']}; n={bal['n_pos']}/{bal['n_neg']})"
                if bal["mean"] is not None
                else f"NA (K={bal['k_proteins']})"
            )
            lines.append(
                f"| `{m}` | {task} | {ov['n_pos']:,} | {ov['n_neg']:,} | {ov['n_proteins']:,} "
                f"| {_fmt_ci(ov['auroc'], ov['ci_low'], ov['ci_high'])} | {bal_str} |"
            )
    lines.append("")

    lines.append("### Q2b — Reference Thresholds (`ΔLLR` in nats, call pathogenic if `ΔLLR ≤ threshold`)")
    lines.append("")
    lines.append("| Model | Comparison | Youden ΔLLR | Youden J | Sens / Spec @ Youden | Spec=0.95 ΔLLR | Sens / Spec @ Spec95 |")
    lines.append("|---|---|---:|---:|---|---:|---|")
    for m in meta["models"]:
        for _, _, task in PAIRWISE_TASKS:
            th = q2[m][task]["thresholds"]
            lines.append(
                f"| `{m}` | {task} | `{_fmt(th['youden_llr'])}` | {_fmt(th['youden_j'])} "
                f"| {_fmt(th['youden_sens'], 3)} / {_fmt(th['youden_spec'], 3)} "
                f"| `{_fmt(th['spec95_llr'])}` | {_fmt(th['spec95_sens'], 3)} / {_fmt(th['spec95_spec'], 3)} |"
            )
    lines.append("")

    # Sensitivity stratifications if populated
    sens_rows: list[str] = []
    for m in meta["models"]:
        for _, _, task in PAIRWISE_TASKS:
            d = q2[m][task]
            for k, v in d.get("structure_token_sensitivity", {}).items():
                sens_rows.append(
                    f"| `{m}` | {task} | {k} | {v['n_pos']:,} / {v['n_neg']:,} ({v['n_proteins']}) | {_fmt_ci(v['auroc'], v['ci_low'], v['ci_high'])} |"
                )
            for k, v in d.get("truncation_sensitivity", {}).items():
                if len(d.get("truncation_sensitivity", {})) > 1:
                    sens_rows.append(
                        f"| `{m}` | {task} | {k} | {v['n_pos']:,} / {v['n_neg']:,} ({v['n_proteins']}) | {_fmt_ci(v['auroc'], v['ci_low'], v['ci_high'])} |"
                    )
    if sens_rows:
        lines.append("### Q2c — Sensitivity Stratifications (Structure Token / Sequence Truncation)")
        lines.append("")
        lines.append("| Model | Comparison | Stratum | n_pos / n_neg (Proteins) | AUROC (95% CI) |")
        lines.append("|---|---|---|---|---|")
        lines.extend(sens_rows)
        lines.append("")

    # Q3
    lines.append("## Q3 — Incremental Value Beyond AlphaMissense (5-Fold GroupKFold CV)")
    lines.append("")
    if q3.get("status") != "OK":
        lines.append(f"Status: `{q3.get('status')}` — {q3.get('reason', '')}")
    else:
        cov = q3["am_coverage"]
        lines.append(
            f"AlphaMissense coverage across unique variants in `scores.csv`: "
            f"**{cov['n_scored_variants']:,}/{cov['n_total_variants']:,}** ({cov['fraction']*100:.1f}%)."
        )
        lines.append("")
        lines.append("> **Circularity Note:** AlphaMissense was trained with weak supervision from human/primate population allele frequencies, so `pathogenic vs gnomad_common` reflects training-prior circularity for AM.")
        lines.append("")
        for _, _, task in PAIRWISE_TASKS:
            td = q3["tasks"].get(task, {})
            lines.append(f"### Q3 — {task}")
            am_raw = td.get("AM_raw_standalone")
            if am_raw:
                lines.append(
                    f"- Standalone raw AlphaMissense AUROC (n={am_raw['n_pos']:,}/{am_raw['n_neg']:,}, "
                    f"{am_raw['n_proteins']} proteins): **{_fmt_ci(am_raw['auroc'], am_raw['ci_low'], am_raw['ci_high'])}**"
                )
            lines.append("")
            lines.append("| Model Specification | n_pos / n_neg (Proteins) | CV AUROC(AM) (95% CI) | CV AUROC(AM+ΔLLR) (95% CI) | ΔAUROC (95% Cluster CI) | Fold Mean±SD (AM → +ΔLLR) | Gain? |")
            lines.append("|---|---:|---|---|---|---|---|")
            for spec_name, c in td.get("comparisons", {}).items():
                if c.get("status") != "OK":
                    lines.append(f"| `{spec_name}` | {c.get('n_variants', 0)} ({c.get('n_proteins', 0)}) | NA | NA | NA | NA | {c.get('status')} |")
                    continue
                am_ci = c["auroc_am_cv_ci"]
                pl_ci = c["auroc_plus_cv_ci"]
                f_str = f"{_fmt(c['fold_mean_am'], 3)}±{_fmt(c['fold_sd_am'], 3)} → {_fmt(c['fold_mean_plus'], 3)}±{_fmt(c['fold_sd_plus'], 3)}"
                lines.append(
                    f"| `{spec_name}` | {c['n_pos']:,} / {c['n_neg']:,} ({c['n_proteins']}) "
                    f"| {_fmt_ci(c['auroc_am_cv'], am_ci[0], am_ci[1])} "
                    f"| {_fmt_ci(c['auroc_plus_cv'], pl_ci[0], pl_ci[1])} "
                    f"| {_fmt_ci(c['delta_auroc'], c['delta_ci_low'], c['delta_ci_high'])} "
                    f"| {f_str} | {'Yes' if c['significant_gain'] else 'No'} |"
                )
            lines.append("")

    # Q4
    lines.append("## Q4 — Cross-Model Agreement vs Best Single Model")
    lines.append("")
    if q4.get("status") != "OK":
        lines.append(f"Status: `{q4.get('status')}`")
    else:
        lines.append("| Comparison | n_pos / n_neg (Proteins) | Best Single Model (AUROC) | `count_favour_native` (95% CI) | Δ vs Best (95% CI) | `-mean_z(ΔLLR)` (95% CI) | Δ vs Best (95% CI) |")
        lines.append("|---|---:|---|---|---|---|---|")
        for _, _, task in PAIRWISE_TASKS:
            td = q4["tasks"].get(task, {})
            if td.get("status") != "OK":
                lines.append(f"| {task} | NA | NA | NA | NA | NA | NA |")
                continue
            bm = td["best_single_model"]
            ba = td["best_single_auroc"]
            cc = td["count_favour_native"]
            mz = td["neg_mean_z_llr"]
            lines.append(
                f"| {task} | {td['n_pos']:,} / {td['n_neg']:,} ({td['n_proteins']}) "
                f"| `{bm}` ({_fmt_ci(ba['auroc'], ba['ci_low'], ba['ci_high'])}) "
                f"| {_fmt_ci(cc['auroc_a'], cc['a_ci_low'], cc['a_ci_high'])} "
                f"| {_fmt_ci(cc['delta'], cc['ci_low'], cc['ci_high'])} "
                f"| {_fmt_ci(mz['auroc_a'], mz['a_ci_low'], mz['a_ci_high'])} "
                f"| {_fmt_ci(mz['delta'], mz['ci_low'], mz['ci_high'])} |"
            )
    lines.append("")

    # Q5
    lines.append("## Q5 — Positional Entropy Alone (`-entropy_bits`)")
    lines.append("")
    lines.append("| Model | Comparison | n_pos / n_neg (Proteins) | Entropy AUROC (95% CI) | `-ΔLLR` AUROC (for reference) |")
    lines.append("|---|---|---:|---|---|")
    for m in meta["models"]:
        for _, _, task in PAIRWISE_TASKS:
            e = q5[m][task]
            d = q2[m][task]["overall"]
            lines.append(
                f"| `{m}` | {task} | {e['n_pos']:,} / {e['n_neg']:,} ({e['n_proteins']}) "
                f"| {_fmt_ci(e['auroc'], e['ci_low'], e['ci_high'])} "
                f"| {_fmt_ci(d['auroc'], d['ci_low'], d['ci_high'])} |"
            )
    lines.append("")

    # Q6
    lines.append("## Q6 — Embedding Shift (`shift_at_site` & `shift_window_mean`)")
    lines.append("")
    if q6.get("status") != "OK":
        lines.append(f"- Status: **{q6.get('status')}** (`{q6.get('path', '')}`).")
        lines.append(f"- Decision: **{q6.get('decision')}** — `embedding_shift.csv` was not produced, so embedding shift could not be evaluated.")
    else:
        lines.append("| Model | Metric | Comparison | n_pos / n_neg (Proteins) | AUROC (95% CI) | Meets Criterion (≥0.60 & CI > 0.50)? |")
        lines.append("|---|---|---|---:|---|---|")
        for m, m_dict in q6["models"].items():
            for metric_col in ["shift_at_site", "shift_window_mean"]:
                for _, _, task in PAIRWISE_TASKS:
                    r = m_dict[metric_col][task]
                    lines.append(
                        f"| `{m}` | `{metric_col}` | {task} | {r['n_pos']:,} / {r['n_neg']:,} ({r['n_proteins']}) "
                        f"| {_fmt_ci(r['auroc'], r['ci_low'], r['ci_high'])} | {'Yes' if r['passes'] else 'No'} |"
                    )
        lines.append("")
        lines.append(f"- **Pre-registered Decision:** **{q6['decision']}**.")
    lines.append("")

    # Q7
    lines.append("## Q7 — UI Reference Distribution Artifacts")
    lines.append("")
    lines.append(f"41-bin histograms over fixed range `[{HIST_MIN}, {HIST_MAX}]` nats (bin width `{HIST_BIN_WIDTH}` nats; out-of-range tails clamped into edge bins) and quantiles `1, 5, 10, 25, 50, 75, 90, 95, 99`:")
    for rf in ref_files:
        lines.append(f"- `{rf}`")
    lines.append("")

    # Plain-English conclusions & Leakage & Limitations
    lines.append("## Plain-English Conclusions")
    lines.append("")
    if q1["decision_all_favour_native_not_discriminative"]:
        lines.append(
            "1. **Headline rule:** Because ≥50% of neutral (`benign` and/or `gnomad_common`) variants trigger `"
            "all non-flat models favour native` (`ΔLLR ≤ -ln 2`), the current headline rule **is not discriminative** "
            "and overstates constraint on neutral substitutions. Empirical model-native reference thresholds (Q2b) or quantiles (Q7) are required instead of `-ln 2`."
        )
    else:
        lines.append(
            "1. **Headline rule:** Fewer than 50% of neutral variants trigger `all non-flat models favour native` (`ΔLLR ≤ -ln 2`), "
            "though per-class rates (Q1) and `≥1 model favours native` rates should still be displayed alongside reference quantiles rather than treated as clinical proof."
        )

    best_pv = max(
        meta["models"],
        key=lambda m: q2[m]["pathogenic vs benign"]["overall"]["auroc"] or -1.0,
    )
    best_pv_auc = q2[best_pv]["pathogenic vs benign"]["overall"]
    lines.append(
        f"2. **Single-model clinical signal:** On `pathogenic vs benign`, the top single pLM is `{best_pv}` "
        f"(AUROC {_fmt_ci(best_pv_auc['auroc'], best_pv_auc['ci_low'], best_pv_auc['ci_high'])})."
    )

    if q3.get("status") == "OK":
        pv_cmps = q3["tasks"].get("pathogenic vs benign", {}).get("comparisons", {})
        gains = [k for k, v in pv_cmps.items() if v.get("significant_gain")]
        if gains:
            lines.append(
                f"3. **Value beyond AlphaMissense:** Adding ΔLLR produced a statistically positive ΔAUROC (95% CI > 0) on `pathogenic vs benign` for: {', '.join(gains)}."
            )
        else:
            lines.append(
                "3. **Value beyond AlphaMissense:** None of the ΔLLR additions produced a statistically reliable gain (95% CI > 0) over AlphaMissense alone on `pathogenic vs benign`."
            )

    if q6.get("status") == "OK":
        if q6["decision"] == "RECOMMEND_REMOVE_EMBEDDINGS_SUBTAB":
            lines.append("4. **Embeddings subtab:** No embedding shift metric met AUROC ≥ 0.60 with 95% CI above 0.50; **recommend removing the embeddings subtab**.")
        else:
            lines.append("4. **Embeddings subtab:** At least one embedding shift metric exceeded AUROC ≥ 0.60 with 95% CI excluding 0.50.")
    lines.append("")

    lines.append("## Training Data, Leakage & Limitations")
    lines.append("")
    lines.append("- **ESM-2 650M** (Lin et al., *Science* 2023; masked-marginal per Meier et al., *NeurIPS* 2021): Self-supervised on UniRef50/90. No clinical ClinVar/gnomAD labels in training, though human reference sequences and homologs encode evolutionary constraint.")
    lines.append("- **SaProt 35M AF2** (Su et al., *ICLR* 2024): Self-supervised on ~40M AlphaFold DB structures/sequences. No clinical ClinVar/gnomAD labels, though AF2 structures incorporate evolutionary MSAs; 35M is a smaller checkpoint and falls back to sequence-only when `structure_token == '#'`.")
    lines.append("- **VESM-150M** (Dinh et al., *Nature Methods* 2026): Co-distilled from an ESM-1b/1v/2 ensemble on UniProt human and non-human sequences atop `esm2_t30_150M_UR50D`. ClinVar/ProteinGym were held out for evaluation in Dinh et al., **but** VESM shares its backbone family with ESM-2 (not independent) and distills multi-ESM evolutionary priors on human UniProt.")
    lines.append("- **AlphaMissense** (Cheng et al., *Science* 2023): Trained with weak supervision from human/primate population allele frequencies, creating direct circularity for `pathogenic vs gnomad_common` and indirect enrichment overlap with ClinVar benign variants.")
    lines.append("- **Limitations:** Variant ascertainment bias in ClinVar; proteins exceeding 1,022 residues are cropped/truncated in sequence models; missing AlphaMissense or `embedding_shift.csv` rows reduce complete-case sample sizes where noted.")
    lines.append("")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze Structural Perturbation benchmark scores.")
    parser.add_argument("--input-dir", type=Path, default=Path("logs/perturbation_bench"))
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--skip-fetch-am", action="store_true", help="Do not hit network to fetch AlphaMissense.")
    parser.add_argument("--refetch-am", action="store_true", help="Re-download AlphaMissense even if csv exists.")
    parser.add_argument("--synthetic", action="store_true", help="Label outputs as synthetic validation.")
    args = parser.parse_args()

    in_dir: Path = args.input_dir
    out_dir: Path = args.output_dir or in_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    scores_path = in_dir / "scores.csv"
    if not scores_path.exists():
        raise FileNotFoundError(f"scores.csv not found at {scores_path}")

    df, meta = load_scores(scores_path)
    models = meta["models"]

    am_path = in_dir / "alphamissense.csv"
    if args.skip_fetch_am:
        am_df = pd.read_csv(am_path) if am_path.exists() else None
    else:
        am_df = fetch_alphamissense_for_variants(df, out_dir / "alphamissense.csv", refetch=args.refetch_am)

    q1 = run_q1(df)
    q2 = run_q2(df, models)
    q3 = run_q3(df, am_df, models)
    q4 = run_q4(df, models)
    q5 = run_q5(df, models)
    q6 = run_q6(df, in_dir / "embedding_shift.csv")
    ref_files = build_reference_jsons(df, models, q2, out_dir, meta["label_sources"])

    summary = {
        "meta": meta,
        "q1": q1,
        "q2": q2,
        "q3": q3,
        "q4": q4,
        "q5": q5,
        "q6": q6,
        "reference_files": [str(p) for p in ref_files],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    write_results_md(out_dir / "RESULTS.md", meta, q1, q2, q3, q4, q5, q6, ref_files, is_synthetic=args.synthetic)

    # Print key reference marks precisely
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("\n=== Q2 Reference Marks (pathogenic vs benign) ===")
    for m in models:
        th = q2[m]["pathogenic vs benign"]["thresholds"]
        ov = q2[m]["pathogenic vs benign"]["overall"]
        ci_str = (
            f"{ov['auroc']:.4f} ({ov['ci_low']:.4f}-{ov['ci_high']:.4f})"
            if ov["auroc"] is not None and ov["ci_low"] is not None
            else _fmt(ov["auroc"])
        )
        print(
            f"  {m:18s} | AUROC={ci_str} "
            f"| Youden dLLR={_fmt(th['youden_llr'])} | Spec95 dLLR={_fmt(th['spec95_llr'])}"
        )
    print(f"\nWrote {out_dir / 'RESULTS.md'}, {out_dir / 'summary.json'}, and {len(ref_files)} reference JSONs.")


if __name__ == "__main__":
    main()
