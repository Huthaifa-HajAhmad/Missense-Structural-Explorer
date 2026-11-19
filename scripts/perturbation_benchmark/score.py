#!/usr/bin/env python3
"""
Structural Perturbation pLM Benchmark — Dataset Builder & Scoring Pipeline.

Reuses the exact tokenization, sequence cropping, 3Di structural encoding, and
scientific metric math from `tools/model_server_app` (`esm2.py`, `saprot.py`,
`vesm.py`, `utils.py`, `models.py`).
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

# Configure threading and silence noisy warnings BEFORE importing torch/transformers/models.py
_DEFAULT_THREADS = os.environ.get("TORCH_NUM_THREADS", "10")
os.environ["TORCH_NUM_THREADS"] = _DEFAULT_THREADS
os.environ.setdefault("OMP_NUM_THREADS", _DEFAULT_THREADS)
os.environ.setdefault("MKL_NUM_THREADS", _DEFAULT_THREADS)
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import numpy as np
import pandas as pd
import torch
from huggingface_hub.utils import disable_progress_bars

disable_progress_bars()

from tools.model_server_app import models as app_models
from tools.model_server_app import utils as app_utils
from tools.model_server_app.routers import esm2 as esm2_router
from tools.model_server_app.routers import saprot as saprot_router
from tools.model_server_app.routers import vesm as vesm_router

SEED = 20261118
CAP_PER_CLASS_PER_PROTEIN = 40
CANONICAL_AAS = set(app_utils.AA_LIST)

SQLITE_PATH = REPO_ROOT / "data" / "df_rasp_gnomad_clinvar.sqlite"
OUT_DIR = REPO_ROOT / "logs" / "perturbation_bench"
CACHE_DIR = OUT_DIR / "cache"
UNIPROT_CACHE_DIR = CACHE_DIR / "uniprot"
AFDB_CACHE_DIR = CACHE_DIR / "afdb"

VARIANTS_CSV = OUT_DIR / "variants.csv"
OFFSETS_CSV = OUT_DIR / "offsets.csv"
MISMATCHES_CSV = OUT_DIR / "mismatches.csv"
SCORES_CSV = OUT_DIR / "scores.csv"
EMBEDDING_SHIFT_CSV = OUT_DIR / "embedding_shift.csv"
SCORE_LOG = OUT_DIR / "score.log"

SCORES_COLUMNS = [
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
    "wt_logp",
    "mut_logp",
    "wt_rank",
    "mut_rank",
    "entropy_bits",
    "structure_token",
    "sequence_length",
    "truncated",
]

EMBEDDING_SHIFT_COLUMNS = [
    "uniprot_id",
    "pos",
    "wt",
    "mut",
    "model",
    "shift_at_site",
    "shift_window_mean",
]

MODEL_SPECS = {
    "esm2_650m": {
        "checkpoint": "facebook/esm2_t33_650M_UR50D",
        "scoring_method": "masked-marginal",
        "max_len": 1022,
    },
    "saprot_35m_af2": {
        "checkpoint": "westlake-repl/SaProt_35M_AF2",
        "scoring_method": "masked-marginal",
        "max_len": 510,
    },
    "vesm_150m": {
        "checkpoint": "ntranoslab/vesm VESM_150M",
        "scoring_method": "wild-type-marginal",
        "max_len": 1022,
    },
}


def setup_logging(log_path: Path) -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("perturbation_bench")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    fh = logging.FileHandler(log_path, mode="a", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def append_final_log_line(log_path: Path, line: str) -> None:
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(line.rstrip("\n") + "\n")


def _classify_row_labels(sig: str | None, af: float | None) -> list[tuple[str, str]]:
    labels: list[tuple[str, str]] = []
    if sig == "pathogenic":
        labels.append(("pathogenic", "clinvar"))
    elif sig == "benign":
        labels.append(("benign", "clinvar"))
    if af is not None and float(af) > 1e-3 and sig != "pathogenic":
        labels.append(("gnomad_common", "gnomad"))
    return labels


def build_variants_csv(sqlite_path: Path, out_csv: Path, logger: logging.Logger) -> pd.DataFrame:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite file not found: {sqlite_path}")

    conn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    cur = conn.cursor()

    meta_rows = cur.execute("SELECT * FROM rasp_index_meta").fetchall()
    logger.info("SQLite rasp_index_meta: %s", meta_rows)

    proteins = [
        r[0]
        for r in cur.execute(
            """
            SELECT uniprot_id
            FROM rasp_variants
            GROUP BY uniprot_id
            HAVING SUM(CASE WHEN clinvar_significance = 'pathogenic' THEN 1 ELSE 0 END) > 0
               AND SUM(CASE WHEN clinvar_significance = 'benign' THEN 1 ELSE 0 END) > 0
            ORDER BY uniprot_id
            """
        ).fetchall()
    ]
    logger.info("Proteins with both pathogenic and benign ClinVar variants: %d", len(proteins))

    placeholders = ",".join("?" * len(proteins))
    all_annotated_rows = cur.execute(
        f"""
        SELECT uniprot_id, pos, wt, mut, pdb, pdb_chain, clinvar_significance, gnomad_af
        FROM rasp_variants
        WHERE uniprot_id IN ({placeholders})
          AND (clinvar_significance IS NOT NULL OR gnomad_af IS NOT NULL)
        """,
        proteins,
    ).fetchall()
    conn.close()

    # Fetch/load UniProt sequences for all candidate proteins before computing structure offsets
    sequences: dict[str, str] = {}
    seq_errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        seq_futs = {pool.submit(fetch_uniprot_sequence, uid): uid for uid in proteins}
        for fut in as_completed(seq_futs):
            uid = seq_futs[fut]
            seq, err = fut.result()
            if seq:
                sequences[uid] = seq
            else:
                seq_errors[uid] = err or "unknown"
    if seq_errors:
        logger.warning("Missing UniProt sequences during offset resolution: %s", seq_errors)

    groups: dict[tuple[str, str], list[tuple[Any, ...]]] = defaultdict(list)
    for row in all_annotated_rows:
        uid_s = str(row[0]).strip()
        pdb_s = "" if row[4] is None else str(row[4]).strip()
        groups[(uid_s, pdb_s)].append(row)

    offset_records: list[dict[str, Any]] = []
    mismatch_records: list[dict[str, Any]] = []
    by_prot_class: dict[tuple[str, str], dict[tuple[str, int, str, str], tuple[str, str, str]]] = defaultdict(dict)

    for (uid, pdb), items in sorted(groups.items()):
        seq = sequences.get(uid, "")
        n_rows = len(items)
        if not seq:
            offset_records.append(
                {
                    "uniprot_id": uid,
                    "pdb": pdb,
                    "offset": 0,
                    "rows": n_rows,
                    "explained_fraction": 0.0,
                    "decision": "drop_group",
                }
            )
            for r_uid, r_pos, r_wt, r_mut, r_pdb, r_pdb_chain, r_sig, r_af in items:
                cls_list = _classify_row_labels(r_sig, r_af)
                lbl = ",".join(c for c, _ in cls_list) if cls_list else "gnomad_rare"
                mismatch_records.append(
                    {
                        "uniprot_id": uid,
                        "pos": int(r_pos),
                        "uniprot_pos": "",
                        "wt": str(r_wt).strip().upper(),
                        "mut": str(r_mut).strip().upper(),
                        "pdb": pdb,
                        "pdb_chain": "" if r_pdb_chain is None else str(r_pdb_chain).strip(),
                        "label": lbl,
                        "reason": f"group_dropped:missing_sequence:{seq_errors.get(uid, 'unknown')}",
                    }
                )
            continue

        seq_len = len(seq)
        match0 = sum(
            1
            for _, r_pos, r_wt, *_ in items
            if 1 <= int(r_pos) <= seq_len and seq[int(r_pos) - 1] == str(r_wt).strip().upper()
        )
        best_off = 0
        best_match = match0
        for off in range(-100, 101):
            if off == 0:
                continue
            m = sum(
                1
                for _, r_pos, r_wt, *_ in items
                if 1 <= int(r_pos) + off <= seq_len and seq[int(r_pos) + off - 1] == str(r_wt).strip().upper()
            )
            if m > best_match or (m == best_match and best_off != 0 and abs(off) < abs(best_off)):
                best_match = m
                best_off = off

        explained_frac = best_match / n_rows if n_rows > 0 else 0.0
        accepted = (explained_frac >= 0.95) and (best_off == 0 or best_match > match0)
        decision = "accept" if accepted else "drop_group"

        offset_records.append(
            {
                "uniprot_id": uid,
                "pdb": pdb,
                "offset": best_off,
                "rows": n_rows,
                "explained_fraction": round(explained_frac, 6),
                "decision": decision,
            }
        )

        if not accepted:
            fail_reason = (
                f"group_dropped:explained_fraction={explained_frac:.4f}<0.95(best_offset={best_off},match0={match0}/{n_rows})"
                if explained_frac < 0.95
                else f"group_dropped:offset_{best_off}_did_not_beat_0({best_match}<={match0})"
            )
            for r_uid, r_pos, r_wt, r_mut, r_pdb, r_pdb_chain, r_sig, r_af in items:
                cls_list = _classify_row_labels(r_sig, r_af)
                lbl = ",".join(c for c, _ in cls_list) if cls_list else "gnomad_rare"
                mismatch_records.append(
                    {
                        "uniprot_id": uid,
                        "pos": int(r_pos),
                        "uniprot_pos": "",
                        "wt": str(r_wt).strip().upper(),
                        "mut": str(r_mut).strip().upper(),
                        "pdb": pdb,
                        "pdb_chain": "" if r_pdb_chain is None else str(r_pdb_chain).strip(),
                        "label": lbl,
                        "reason": fail_reason,
                    }
                )
            continue

        for r_uid, r_pos, r_wt, r_mut, r_pdb, r_pdb_chain, r_sig, r_af in items:
            raw_pos = int(r_pos)
            upos = raw_pos + best_off
            wt_s = str(r_wt).strip().upper()
            mut_s = str(r_mut).strip().upper()
            pdb_chain_s = "" if r_pdb_chain is None else str(r_pdb_chain).strip()

            if upos < 1 or upos > seq_len:
                cls_list = _classify_row_labels(r_sig, r_af)
                lbl = ",".join(c for c, _ in cls_list) if cls_list else "gnomad_rare"
                mismatch_records.append(
                    {
                        "uniprot_id": uid,
                        "pos": raw_pos,
                        "uniprot_pos": upos,
                        "wt": wt_s,
                        "mut": mut_s,
                        "pdb": pdb,
                        "pdb_chain": pdb_chain_s,
                        "label": lbl,
                        "reason": f"post_offset_out_of_bounds:offset={best_off},len={seq_len}",
                    }
                )
                continue

            if seq[upos - 1] != wt_s:
                cls_list = _classify_row_labels(r_sig, r_af)
                lbl = ",".join(c for c, _ in cls_list) if cls_list else "gnomad_rare"
                mismatch_records.append(
                    {
                        "uniprot_id": uid,
                        "pos": raw_pos,
                        "uniprot_pos": upos,
                        "wt": wt_s,
                        "mut": mut_s,
                        "pdb": pdb,
                        "pdb_chain": pdb_chain_s,
                        "label": lbl,
                        "reason": f"post_offset_wt_mismatch:offset={best_off},expected={seq[upos - 1]}",
                    }
                )
                continue

            if wt_s not in CANONICAL_AAS or mut_s not in CANONICAL_AAS:
                continue

            key = (uid, upos, wt_s, mut_s)
            for cls_name, src_name in _classify_row_labels(r_sig, r_af):
                by_prot_class[(uid, cls_name)][key] = (src_name, pdb, pdb_chain_s)

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    offsets_df = pd.DataFrame(
        offset_records,
        columns=["uniprot_id", "pdb", "offset", "rows", "explained_fraction", "decision"],
    )
    offsets_df.to_csv(OFFSETS_CSV, index=False)
    n_acc = int((offsets_df["decision"] == "accept").sum())
    n_drop_grp = int((offsets_df["decision"] != "accept").sum())
    n_shifted = int(((offsets_df["decision"] == "accept") & (offsets_df["offset"] != 0)).sum())
    logger.info(
        "Saved %s: %d (uniprot_id, pdb) groups (%d accepted [%d non-zero offset], %d dropped).",
        OFFSETS_CSV,
        len(offsets_df),
        n_acc,
        n_shifted,
        n_drop_grp,
    )

    mm_df = pd.DataFrame(
        mismatch_records,
        columns=["uniprot_id", "pos", "uniprot_pos", "wt", "mut", "pdb", "pdb_chain", "label", "reason"],
    )
    mm_df.to_csv(MISMATCHES_CSV, index=False)
    logger.info("Saved %s: %d dropped/mismatching annotated rows.", MISMATCHES_CSV, len(mm_df))

    rng = random.Random(SEED)
    selected_rows: list[dict[str, Any]] = []
    for uid in proteins:
        for cls in ("pathogenic", "benign", "gnomad_common"):
            items = sorted(by_prot_class[(uid, cls)].items(), key=lambda x: x[0])
            if len(items) > CAP_PER_CLASS_PER_PROTEIN:
                chosen_idx = set(rng.sample(range(len(items)), CAP_PER_CLASS_PER_PROTEIN))
                items = [items[i] for i in range(len(items)) if i in chosen_idx]
            for (u, p, w, m), (src, pdb_s, pdb_chain_s) in items:
                selected_rows.append(
                    {
                        "uniprot_id": u,
                        "pos": p,
                        "wt": w,
                        "mut": m,
                        "label": cls,
                        "label_source": src,
                        "pdb": pdb_s,
                        "pdb_chain": pdb_chain_s,
                    }
                )

    df = pd.DataFrame(
        selected_rows,
        columns=["uniprot_id", "pos", "wt", "mut", "label", "label_source", "pdb", "pdb_chain"],
    )
    # Deduplicate within (uniprot_id, pos, wt, mut, label) — keeps distinct (variant, label) rows
    # while noting any multi-label overlap between benign and gnomad_common.
    df = df.drop_duplicates(subset=["uniprot_id", "pos", "wt", "mut", "label"], keep="first").reset_index(drop=True)

    df.to_csv(out_csv, index=False)

    cls_counts = df["label"].value_counts().to_dict()
    n_unique_vars = len(df[["uniprot_id", "pos", "wt", "mut"]].drop_duplicates())
    n_prots_rem = int(df["uniprot_id"].nunique())
    n_overlap = int((df.groupby(["uniprot_id", "pos", "wt", "mut"])["label"].nunique() > 1).sum())
    logger.info(
        "Saved %s: %d rows across %d proteins (%d unique variants, %d benign/gnomad_common overlap). Counts: %s",
        out_csv,
        len(df),
        n_prots_rem,
        n_unique_vars,
        n_overlap,
        cls_counts,
    )
    return df


def _http_get_text(url: str, timeout: float = 30.0, retries: int = 3) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "MissenseStructuralExplorer-Bench/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, ""
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (2**attempt))
                continue
            return e.code, ""
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.5 * (2**attempt))
                continue
            return 0, ""
    return 0, ""


def parse_fasta(fasta_text: str) -> str:
    lines = []
    for line in fasta_text.splitlines():
        line = line.strip()
        if not line or line.startswith(">"):
            continue
        lines.append(line)
    return "".join(lines).upper()


def fetch_uniprot_sequence(uid: str) -> tuple[str, str | None]:
    UNIPROT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fasta_path = UNIPROT_CACHE_DIR / f"{uid}.fasta"
    missing_path = UNIPROT_CACHE_DIR / f"{uid}.missing"
    if fasta_path.exists() and fasta_path.stat().st_size > 0:
        seq = parse_fasta(fasta_path.read_text(encoding="utf-8"))
        if seq:
            return seq, None
    if missing_path.exists():
        return "", missing_path.read_text(encoding="utf-8").strip() or "cached_missing"

    url = f"https://rest.uniprot.org/uniprotkb/{urllib.parse.quote(uid)}.fasta"
    status, text = _http_get_text(url, timeout=30.0)
    if status == 200 and text.startswith(">"):
        seq = parse_fasta(text)
        if seq:
            fasta_path.write_text(text, encoding="utf-8")
            return seq, None
    reason = f"uniprot_http_{status}"
    missing_path.write_text(reason, encoding="utf-8")
    return "", reason


def fetch_afdb_pdb(uid: str) -> tuple[str, str | None]:
    AFDB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pdb_path = AFDB_CACHE_DIR / f"{uid}.pdb"
    missing_path = AFDB_CACHE_DIR / f"{uid}.missing"
    if pdb_path.exists() and pdb_path.stat().st_size > 0:
        return pdb_path.read_text(encoding="utf-8", errors="replace"), None
    if missing_path.exists():
        cached_reason = missing_path.read_text(encoding="utf-8").strip()
        if cached_reason == "afdb_http_404":
            return "", cached_reason
        missing_path.unlink(missing_ok=True)

    pdb_url = None
    api_url = f"https://alphafold.ebi.ac.uk/api/prediction/{urllib.parse.quote(uid)}"
    status, meta_text = _http_get_text(api_url, timeout=30.0, retries=5)
    if status == 200 and meta_text:
        try:
            meta = json.loads(meta_text)
            if isinstance(meta, list) and meta:
                pdb_url = meta[0].get("pdbUrl")
                (AFDB_CACHE_DIR / f"{uid}_meta.json").write_text(meta_text, encoding="utf-8")
        except Exception:
            pdb_url = None

    candidate_urls = []
    if pdb_url:
        candidate_urls.append(pdb_url)
    candidate_urls.extend(
        [
            f"https://alphafold.ebi.ac.uk/files/AF-{urllib.parse.quote(uid)}-F1-model_v6.pdb",
            f"https://alphafold.ebi.ac.uk/files/AF-{urllib.parse.quote(uid)}-F1-model_v4.pdb",
        ]
    )

    last_status = status
    for url in candidate_urls:
        st, pdb_text = _http_get_text(url, timeout=45.0, retries=5)
        last_status = st
        if st == 200 and ("ATOM  " in pdb_text):
            pdb_path.write_text(pdb_text, encoding="utf-8")
            return pdb_text, None

    reason = f"afdb_http_{last_status}"
    if last_status == 404:
        missing_path.write_text(reason, encoding="utf-8")
    return "", reason


def prepare_sequences_and_structures(
    variants_df: pd.DataFrame,
    logger: logging.Logger,
    max_workers: int = 8,
) -> tuple[dict[str, str], dict[str, str], pd.DataFrame]:
    uids = sorted(variants_df["uniprot_id"].unique().tolist())
    sequences: dict[str, str] = {}
    seq_errors: dict[str, str] = {}
    pdbs: dict[str, str] = {}
    pdb_errors: dict[str, str] = {}

    logger.info("Fetching/loading cached UniProt sequences & AFDB PDBs for %d proteins...", len(uids))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        seq_futs = {pool.submit(fetch_uniprot_sequence, uid): uid for uid in uids}
        for fut in as_completed(seq_futs):
            uid = seq_futs[fut]
            seq, err = fut.result()
            if seq:
                sequences[uid] = seq
            else:
                seq_errors[uid] = err or "unknown"

    # Fetch AFDB PDBs gently (2 workers + small sleep on uncached hits) to avoid HTTP 429
    def _fetch_afdb_polite(uid: str) -> tuple[str, str | None]:
        pdb_path = AFDB_CACHE_DIR / f"{uid}.pdb"
        if not pdb_path.exists():
            time.sleep(0.25)
        return fetch_afdb_pdb(uid)

    with ThreadPoolExecutor(max_workers=2) as pool:
        pdb_futs = {pool.submit(_fetch_afdb_polite, uid): uid for uid in uids}
        for fut in as_completed(pdb_futs):
            uid = pdb_futs[fut]
            pdb_text, err = fut.result()
            if pdb_text:
                pdbs[uid] = pdb_text
            else:
                pdb_errors[uid] = err or "unknown"

    logger.info(
        "Sequences ready: %d/%d (errors: %s). AFDB PDBs ready: %d/%d (missing: %s).",
        len(sequences),
        len(uids),
        seq_errors if seq_errors else "none",
        len(pdbs),
        len(uids),
        pdb_errors if pdb_errors else "none",
    )

    # Validate pos/wt against UniProt sequence
    valid_mask = []
    mismatches = []
    for row in variants_df.itertuples(index=False):
        seq = sequences.get(row.uniprot_id, "")
        if not seq:
            valid_mask.append(False)
            mismatches.append(
                {
                    "uniprot_id": row.uniprot_id,
                    "pos": row.pos,
                    "wt": row.wt,
                    "mut": row.mut,
                    "label": row.label,
                    "reason": f"missing_sequence:{seq_errors.get(row.uniprot_id, 'unknown')}",
                }
            )
        elif row.pos < 1 or row.pos > len(seq):
            valid_mask.append(False)
            mismatches.append(
                {
                    "uniprot_id": row.uniprot_id,
                    "pos": row.pos,
                    "wt": row.wt,
                    "mut": row.mut,
                    "label": row.label,
                    "reason": f"pos_out_of_bounds:len={len(seq)}",
                }
            )
        elif seq[row.pos - 1] != row.wt:
            valid_mask.append(False)
            mismatches.append(
                {
                    "uniprot_id": row.uniprot_id,
                    "pos": row.pos,
                    "wt": row.wt,
                    "mut": row.mut,
                    "label": row.label,
                    "reason": f"wt_mismatch:expected={seq[row.pos - 1]}",
                }
            )
        else:
            valid_mask.append(True)

    if mismatches:
        mm_df = pd.DataFrame(mismatches)
        logger.warning("Found %d unexpected pos/wt sequence mismatches after loading variants.csv; dropping them.", len(mm_df))
    else:
        logger.info("UniProt pos/wt sequence verification: 0 mismatches across all %d rows.", len(variants_df))

    clean_df = variants_df[valid_mask].reset_index(drop=True)
    return sequences, pdbs, clean_df


def compute_metrics_from_logits(
    pos_logits: torch.Tensor,
    wt_aa: str,
    mut_aa: str,
    vocab_map: dict[str, int],
) -> dict[str, float | int]:
    standard_logits = torch.tensor(
        [pos_logits[vocab_map[aa]].item() for aa in app_utils.AA_LIST],
        dtype=torch.float32,
    )
    probs = torch.softmax(standard_logits, dim=-1)
    aa_to_idx = {aa: idx for idx, aa in enumerate(app_utils.AA_LIST)}

    wt_prob = probs[aa_to_idx[wt_aa]].item()
    mut_prob = probs[aa_to_idx[mut_aa]].item()
    wt_logp = float(np.log(wt_prob + 1e-9))
    mut_logp = float(np.log(mut_prob + 1e-9))
    llr = float(mut_logp - wt_logp)

    sorted_indices = torch.argsort(probs, descending=True)
    wt_rank = int((sorted_indices == aa_to_idx[wt_aa]).nonzero(as_tuple=True)[0].item() + 1)
    mut_rank = int((sorted_indices == aa_to_idx[mut_aa]).nonzero(as_tuple=True)[0].item() + 1)
    entropy_bits = -float(torch.sum(probs * torch.log2(probs + 1e-9)).item())

    return {
        "llr": llr,
        "wt_logp": wt_logp,
        "mut_logp": mut_logp,
        "wt_rank": wt_rank,
        "mut_rank": mut_rank,
        "entropy_bits": entropy_bits,
    }


def _append_csv_rows(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists() or path.stat().st_size == 0
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)


def _load_existing_score_keys(path: Path) -> set[tuple[str, int, str, str, str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return set()
    df = pd.read_csv(path, usecols=["uniprot_id", "pos", "wt", "mut", "label", "model"])
    return set(
        zip(
            df["uniprot_id"].astype(str),
            df["pos"].astype(int),
            df["wt"].astype(str),
            df["mut"].astype(str),
            df["label"].astype(str),
            df["model"].astype(str),
        )
    )


def _load_existing_shift_keys(path: Path) -> set[tuple[str, int, str, str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return set()
    df = pd.read_csv(path, usecols=["uniprot_id", "pos", "wt", "mut", "model"])
    return set(
        zip(
            df["uniprot_id"].astype(str),
            df["pos"].astype(int),
            df["wt"].astype(str),
            df["mut"].astype(str),
            df["model"].astype(str),
        )
    )


def score_vesm_protein(
    uid: str,
    full_seq: str,
    rows: list[Any],
    model: Any,
    tokenizer: Any,
    vocab_map: dict[str, int],
    done_keys: set[tuple[str, int, str, str, str, str]],
) -> list[dict[str, Any]]:
    spec = MODEL_SPECS["vesm_150m"]
    max_len = spec["max_len"]
    seq_len = len(full_seq)
    truncated = 1 if seq_len > max_len else 0

    by_window: dict[str, list[tuple[Any, int]]] = defaultdict(list)
    for r in rows:
        key = (r.uniprot_id, int(r.pos), r.wt, r.mut, r.label, "vesm_150m")
        if key in done_keys:
            continue
        cropped_seq, pos_in_window, _ = app_utils.crop_sequence_around_mutation(full_seq, int(r.pos), max_len=max_len)
        by_window[cropped_seq].append((r, pos_in_window))

    out_rows: list[dict[str, Any]] = []
    for cropped_seq, items in by_window.items():
        inputs = tokenizer(cropped_seq, return_tensors="pt")
        with torch.no_grad():
            seq_logits = model(**inputs).logits[0]
        for r, pos_in_window in items:
            metrics = compute_metrics_from_logits(seq_logits[pos_in_window], r.wt, r.mut, vocab_map)
            out_rows.append(
                {
                    "uniprot_id": r.uniprot_id,
                    "pos": int(r.pos),
                    "wt": r.wt,
                    "mut": r.mut,
                    "label": r.label,
                    "label_source": r.label_source,
                    "model": "vesm_150m",
                    "checkpoint": spec["checkpoint"],
                    "scoring_method": spec["scoring_method"],
                    **metrics,
                    "structure_token": "",
                    "sequence_length": seq_len,
                    "truncated": truncated,
                }
            )
    return out_rows


def score_saprot_protein(
    uid: str,
    full_seq: str,
    wt_pdb: str,
    rows: list[Any],
    model: Any,
    tokenizer: Any,
    done_keys: set[tuple[str, int, str, str, str, str]],
    logger: logging.Logger,
) -> list[dict[str, Any]]:
    if not wt_pdb:
        logger.warning("SaProt skipped for %s (%d rows): missing AFDB structure.", uid, len(rows))
        return []

    spec = MODEL_SPECS["saprot_35m_af2"]
    max_len = spec["max_len"]
    seq_len = len(full_seq)
    truncated = 1 if seq_len > max_len else 0

    by_window: dict[tuple[str, int], dict[int, list[Any]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        key = (r.uniprot_id, int(r.pos), r.wt, r.mut, r.label, "saprot_35m_af2")
        if key in done_keys:
            continue
        cropped_seq, pos_in_window, start_offset = app_utils.crop_sequence_around_mutation(
            full_seq, int(r.pos), max_len=max_len
        )
        by_window[(cropped_seq, start_offset)][pos_in_window].append(r)

    out_rows: list[dict[str, Any]] = []
    for (cropped_seq, start_offset), pos_map in by_window.items():
        seq_3di = app_utils.encode_pdb_to_3di(
            wt_pdb,
            len(cropped_seq),
            start_idx=start_offset + 1,
            target_seq=cropped_seq,
            chain_id=None,
        )
        saprot_3di = app_utils.to_saprot_3di(seq_3di)
        for pos_in_window, items in pos_map.items():
            saprot_masked = app_utils.build_saprot_sequence(cropped_seq, seq_3di, mask_index=pos_in_window - 1)
            inputs = tokenizer(saprot_masked, return_tensors="pt")
            app_utils.validate_saprot_tokenization(int(inputs["input_ids"].shape[-1]), len(cropped_seq))
            with torch.no_grad():
                pos_logits = model(**inputs).logits[0, pos_in_window]
            s_pos = saprot_3di[pos_in_window - 1]
            vocab_map: dict[str, int] = {}
            for aa in app_utils.AA_LIST:
                tok_id = tokenizer.convert_tokens_to_ids(aa + s_pos)
                if tok_id is None or tok_id == tokenizer.unk_token_id:
                    tok_id = tokenizer.convert_tokens_to_ids(aa + "#")
                vocab_map[aa] = tok_id
            for r in items:
                metrics = compute_metrics_from_logits(pos_logits, r.wt, r.mut, vocab_map)
                out_rows.append(
                    {
                        "uniprot_id": r.uniprot_id,
                        "pos": int(r.pos),
                        "wt": r.wt,
                        "mut": r.mut,
                        "label": r.label,
                        "label_source": r.label_source,
                        "model": "saprot_35m_af2",
                        "checkpoint": spec["checkpoint"],
                        "scoring_method": spec["scoring_method"],
                        **metrics,
                        "structure_token": s_pos,
                        "sequence_length": seq_len,
                        "truncated": truncated,
                    }
                )
    return out_rows


def score_esm2_protein(
    uid: str,
    full_seq: str,
    rows: list[Any],
    model: Any,
    tokenizer: Any,
    vocab_map: dict[str, int],
    done_score_keys: set[tuple[str, int, str, str, str, str]],
    done_shift_keys: set[tuple[str, int, str, str, str]],
    batch_size: int = 8,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    spec = MODEL_SPECS["esm2_650m"]
    max_len = spec["max_len"]
    seq_len = len(full_seq)
    truncated = 1 if seq_len > max_len else 0

    by_window: dict[str, dict[int, list[Any]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        score_done = (r.uniprot_id, int(r.pos), r.wt, r.mut, r.label, "esm2_650m") in done_score_keys
        shift_done = (r.uniprot_id, int(r.pos), r.wt, r.mut, "esm2_650m") in done_shift_keys
        if score_done and shift_done:
            continue
        cropped_seq, pos_in_window, _ = app_utils.crop_sequence_around_mutation(full_seq, int(r.pos), max_len=max_len)
        by_window[cropped_seq][pos_in_window].append((r, score_done, shift_done))

    score_rows: list[dict[str, Any]] = []
    shift_rows: list[dict[str, Any]] = []

    for cropped_seq, pos_map in by_window.items():
        # 1. Masked marginal LLR — one pass per unique pos_in_window needing scores (batched over identical-length sequences)
        positions_needing_score = [
            p for p, items in sorted(pos_map.items()) if any(not s_done for _, s_done, _ in items)
        ]
        pos_logits_cache: dict[int, torch.Tensor] = {}
        if positions_needing_score:
            base_inputs = tokenizer(cropped_seq, return_tensors="pt")
            base_ids = base_inputs["input_ids"][0]
            base_attn = base_inputs["attention_mask"][0]
            mask_id = tokenizer.mask_token_id
            for i in range(0, len(positions_needing_score), batch_size):
                chunk_pos = positions_needing_score[i : i + batch_size]
                batch_ids = base_ids.unsqueeze(0).repeat(len(chunk_pos), 1)
                batch_attn = base_attn.unsqueeze(0).repeat(len(chunk_pos), 1)
                for b_idx, p_idx in enumerate(chunk_pos):
                    batch_ids[b_idx, p_idx] = mask_id
                with torch.no_grad():
                    logits = model(input_ids=batch_ids, attention_mask=batch_attn).logits
                for b_idx, p_idx in enumerate(chunk_pos):
                    pos_logits_cache[p_idx] = logits[b_idx, p_idx]

        # 2. Unmasked WT hidden states + mutant hidden states for embedding_shift.csv
        unique_muts_needing_shift: list[tuple[int, str]] = []
        seen_mut_keys: set[tuple[int, str]] = set()
        for p_idx, items in sorted(pos_map.items()):
            for r, _, sh_done in items:
                if not sh_done and (p_idx, r.mut) not in seen_mut_keys:
                    seen_mut_keys.add((p_idx, r.mut))
                    unique_muts_needing_shift.append((p_idx, r.mut))

        shift_cache: dict[tuple[int, str], tuple[float, float]] = {}
        if unique_muts_needing_shift:
            wt_inputs = tokenizer(cropped_seq, return_tensors="pt")
            with torch.no_grad():
                wt_hidden = model(**wt_inputs, output_hidden_states=True).hidden_states[-1][0]
            tok_seq_len = wt_hidden.shape[0]
            mut_seqs = [
                cropped_seq[: p_idx - 1] + mut_aa + cropped_seq[p_idx:]
                for p_idx, mut_aa in unique_muts_needing_shift
            ]
            for i in range(0, len(unique_muts_needing_shift), batch_size):
                chunk_meta = unique_muts_needing_shift[i : i + batch_size]
                chunk_seqs = mut_seqs[i : i + batch_size]
                mut_inputs = tokenizer(chunk_seqs, return_tensors="pt")
                with torch.no_grad():
                    mut_hiddens = model(**mut_inputs, output_hidden_states=True).hidden_states[-1]
                for b_idx, (p_idx, mut_aa) in enumerate(chunk_meta):
                    mut_hidden = mut_hiddens[b_idx]
                    distances = torch.norm(wt_hidden[:tok_seq_len] - mut_hidden[:tok_seq_len], p=2, dim=-1)
                    shift_at_site = float(distances[p_idx].item())
                    win_vals = [
                        float(distances[p].item())
                        for p in range(p_idx - 10, p_idx + 11)
                        if 1 <= p < tok_seq_len - 1
                    ]
                    shift_window_mean = float(sum(win_vals) / len(win_vals))
                    shift_cache[(p_idx, mut_aa)] = (shift_at_site, shift_window_mean)

        # 3. Emit rows
        emitted_shift_this_call: set[tuple[str, int, str, str, str]] = set()
        for p_idx, items in sorted(pos_map.items()):
            for r, s_done, sh_done in items:
                if not s_done:
                    metrics = compute_metrics_from_logits(pos_logits_cache[p_idx], r.wt, r.mut, vocab_map)
                    score_rows.append(
                        {
                            "uniprot_id": r.uniprot_id,
                            "pos": int(r.pos),
                            "wt": r.wt,
                            "mut": r.mut,
                            "label": r.label,
                            "label_source": r.label_source,
                            "model": "esm2_650m",
                            "checkpoint": spec["checkpoint"],
                            "scoring_method": spec["scoring_method"],
                            **metrics,
                            "structure_token": "",
                            "sequence_length": seq_len,
                            "truncated": truncated,
                        }
                    )
                sh_key = (r.uniprot_id, int(r.pos), r.wt, r.mut, "esm2_650m")
                if not sh_done and sh_key not in emitted_shift_this_call:
                    emitted_shift_this_call.add(sh_key)
                    s_site, s_mean = shift_cache[(p_idx, r.mut)]
                    shift_rows.append(
                        {
                            "uniprot_id": r.uniprot_id,
                            "pos": int(r.pos),
                            "wt": r.wt,
                            "mut": r.mut,
                            "model": "esm2_650m",
                            "shift_at_site": s_site,
                            "shift_window_mean": s_mean,
                        }
                    )

    return score_rows, shift_rows


def run_sanity_check(
    clean_df: pd.DataFrame,
    sequences: dict[str, str],
    pdbs: dict[str, str],
    logger: logging.Logger,
) -> None:
    """Reproduce 3 variants directly via the router functions and verify <= 1e-4 agreement."""
    sample_rows = []
    seen_prots = set()
    for row in clean_df.itertuples(index=False):
        if row.uniprot_id in seen_prots:
            continue
        if not pdbs.get(row.uniprot_id):
            continue
        seen_prots.add(row.uniprot_id)
        sample_rows.append(row)
        if len(sample_rows) == 3:
            break

    app_models.load_vesm()
    vesm_model, vesm_tok = app_models.vesm_model, app_models.vesm_tokenizer
    vesm_vocab = {aa: vesm_tok.convert_tokens_to_ids(aa) for aa in app_utils.AA_LIST}
    saprot_tok, saprot_model = app_models.get_saprot_model(MODEL_SPECS["saprot_35m_af2"]["checkpoint"])
    esm2_tok, esm2_model = app_models.get_esm2_model(MODEL_SPECS["esm2_650m"]["checkpoint"])
    esm2_vocab = {aa: esm2_tok.convert_tokens_to_ids(aa) for aa in app_utils.AA_LIST}

    old_hf = os.environ.pop("HF_TOKEN", None)
    try:
        for r in sample_rows:
            seq = sequences[r.uniprot_id]
            pdb = pdbs[r.uniprot_id]

            # 1. VESM
            vesm_ours = score_vesm_protein(r.uniprot_id, seq, [r], vesm_model, vesm_tok, vesm_vocab, set())[0]
            vesm_req = vesm_router.VesmRequest(
                sequence=seq, position=int(r.pos), wt=r.wt, mut=r.mut, includeEmbeddings=False
            )
            vesm_router_res = vesm_router.predict_vesm_sync(vesm_req)
            diff_vesm = abs(vesm_ours["llr"] - vesm_router_res["llr"])
            assert diff_vesm <= 1e-4, f"VESM LLR mismatch: {diff_vesm}"

            # 2. SaProt
            saprot_ours = score_saprot_protein(
                r.uniprot_id, seq, pdb, [r], saprot_model, saprot_tok, set(), logger
            )[0]
            saprot_req = saprot_router.SaprotRequest(
                sequence=seq,
                position=int(r.pos),
                wt=r.wt,
                mut=r.mut,
                wtPdb=pdb,
                modelName=MODEL_SPECS["saprot_35m_af2"]["checkpoint"],
            )
            saprot_router_res = saprot_router.predict_saprot_sync(saprot_req)
            diff_saprot = abs(saprot_ours["llr"] - saprot_router_res["llr"])
            assert diff_saprot <= 1e-4, f"SaProt LLR mismatch: {diff_saprot}"

            # 3. ESM-2
            esm2_s, esm2_sh = score_esm2_protein(
                r.uniprot_id, seq, [r], esm2_model, esm2_tok, esm2_vocab, set(), set(), batch_size=8
            )
            esm2_ours = esm2_s[0]
            esm2_shift_ours = esm2_sh[0]
            cropped_seq, pos_in_win, start_offset = app_utils.crop_sequence_around_mutation(seq, int(r.pos), 1022)
            esm2_router_res = esm2_router.run_esm2_local(
                MODEL_SPECS["esm2_650m"]["checkpoint"],
                cropped_seq,
                pos_in_win,
                r.wt,
                r.mut,
                start_offset,
            )
            diff_esm2 = abs(esm2_ours["llr"] - esm2_router_res["llr"])
            diff_shift_site = abs(esm2_shift_ours["shift_at_site"] - esm2_router_res["embeddingShift"])
            router_win_mean = float(np.mean([x["shift"] for x in esm2_router_res["localShiftMap"]]))
            diff_shift_win = abs(esm2_shift_ours["shift_window_mean"] - router_win_mean)
            assert diff_esm2 <= 1e-4, f"ESM2 LLR mismatch: {diff_esm2}"
            assert diff_shift_site <= 1e-4, f"ESM2 site shift mismatch: {diff_shift_site}"
            assert diff_shift_win <= 1e-4, f"ESM2 window shift mismatch: {diff_shift_win}"

            logger.info(
                "Sanity check %s %s%d%s: d_vesm=%.2e d_saprot=%.2e d_esm2=%.2e d_shift_site=%.2e d_shift_win=%.2e",
                r.uniprot_id,
                r.wt,
                r.pos,
                r.mut,
                diff_vesm,
                diff_saprot,
                diff_esm2,
                diff_shift_site,
                diff_shift_win,
            )
    finally:
        if old_hf is not None:
            os.environ["HF_TOKEN"] = old_hf


def main() -> None:
    parser = argparse.ArgumentParser(description="Score structural perturbation pLM benchmark variants.")
    parser.add_argument("--prepare-only", action="store_true", help="Only build variants.csv and cache UniProt/AFDB.")
    parser.add_argument("--rebuild-variants", action="store_true", help="Force rebuild of offsets.csv, mismatches.csv, and variants.csv.")
    parser.add_argument("--sanity-check", action="store_true", help="Run 3-variant router agreement check and exit.")
    parser.add_argument("--max-proteins", type=int, default=0, help="Optional cap on proteins for ESM2/bench testing.")
    parser.add_argument(
        "--models",
        nargs="+",
        default=["vesm_150m", "saprot_35m_af2", "esm2_650m"],
        choices=["vesm_150m", "saprot_35m_af2", "esm2_650m"],
    )
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    logger = setup_logging(SCORE_LOG)
    logger.info("=== Start score.py (TORCH_NUM_THREADS=%s, batch_size=%d) ===", _DEFAULT_THREADS, args.batch_size)

    needs_rebuild = args.rebuild_variants or not VARIANTS_CSV.exists() or not OFFSETS_CSV.exists()
    if not needs_rebuild:
        variants_df = pd.read_csv(VARIANTS_CSV)
        if not {"pdb", "pdb_chain"}.issubset(variants_df.columns):
            needs_rebuild = True
        else:
            logger.info("Loaded existing %s (%d rows)", VARIANTS_CSV, len(variants_df))
    if needs_rebuild:
        variants_df = build_variants_csv(SQLITE_PATH, VARIANTS_CSV, logger)

    sequences, pdbs, clean_df = prepare_sequences_and_structures(variants_df, logger)
    if args.prepare_only:
        return

    if args.sanity_check:
        run_sanity_check(clean_df, sequences, pdbs, logger)
        return

    # Deterministic unbiased protein ordering (shuffled with SEED)
    all_uids = sorted(clean_df["uniprot_id"].unique().tolist())
    rng = random.Random(SEED)
    rng.shuffle(all_uids)
    if args.max_proteins > 0:
        target_uids = all_uids[: args.max_proteins]
    else:
        target_uids = all_uids

    by_uid: dict[str, list[Any]] = defaultdict(list)
    for r in clean_df.itertuples(index=False):
        by_uid[r.uniprot_id].append(r)

    done_score_keys = _load_existing_score_keys(SCORES_CSV)
    done_shift_keys = _load_existing_shift_keys(EMBEDDING_SHIFT_CSV)
    logger.info("Resume state: %d score rows, %d shift rows already on disk.", len(done_score_keys), len(done_shift_keys))

    t0_total = time.perf_counter()
    completed_by_model: dict[str, int] = {m: 0 for m in args.models}

    if "vesm_150m" in args.models:
        t0 = time.perf_counter()
        app_models.load_vesm()
        vesm_model, vesm_tok = app_models.vesm_model, app_models.vesm_tokenizer
        vesm_vocab = {aa: vesm_tok.convert_tokens_to_ids(aa) for aa in app_utils.AA_LIST}
        n_rows = 0
        for idx, uid in enumerate(target_uids, 1):
            new_rows = score_vesm_protein(uid, sequences[uid], by_uid[uid], vesm_model, vesm_tok, vesm_vocab, done_score_keys)
            _append_csv_rows(SCORES_CSV, SCORES_COLUMNS, new_rows)
            for row in new_rows:
                done_score_keys.add((row["uniprot_id"], row["pos"], row["wt"], row["mut"], row["label"], "vesm_150m"))
            n_rows += len(new_rows)
            completed_by_model["vesm_150m"] += 1
            if idx % 25 == 0 or idx == len(target_uids):
                logger.info("[vesm_150m] %d/%d proteins (%d new rows, %.1fs)", idx, len(target_uids), n_rows, time.perf_counter() - t0)

    if "saprot_35m_af2" in args.models:
        t0 = time.perf_counter()
        saprot_tok, saprot_model = app_models.get_saprot_model(MODEL_SPECS["saprot_35m_af2"]["checkpoint"])
        n_rows = 0
        for idx, uid in enumerate(target_uids, 1):
            new_rows = score_saprot_protein(
                uid, sequences[uid], pdbs.get(uid, ""), by_uid[uid], saprot_model, saprot_tok, done_score_keys, logger
            )
            _append_csv_rows(SCORES_CSV, SCORES_COLUMNS, new_rows)
            for row in new_rows:
                done_score_keys.add((row["uniprot_id"], row["pos"], row["wt"], row["mut"], row["label"], "saprot_35m_af2"))
            n_rows += len(new_rows)
            completed_by_model["saprot_35m_af2"] += 1
            if idx % 25 == 0 or idx == len(target_uids):
                logger.info("[saprot_35m_af2] %d/%d proteins (%d new rows, %.1fs)", idx, len(target_uids), n_rows, time.perf_counter() - t0)
        del saprot_model

    if "esm2_650m" in args.models:
        t0 = time.perf_counter()
        esm2_tok, esm2_model = app_models.get_esm2_model(MODEL_SPECS["esm2_650m"]["checkpoint"])
        esm2_vocab = {aa: esm2_tok.convert_tokens_to_ids(aa) for aa in app_utils.AA_LIST}
        n_rows = 0
        n_shifts = 0
        for idx, uid in enumerate(target_uids, 1):
            tp = time.perf_counter()
            s_rows, sh_rows = score_esm2_protein(
                uid,
                sequences[uid],
                by_uid[uid],
                esm2_model,
                esm2_tok,
                esm2_vocab,
                done_score_keys,
                done_shift_keys,
                batch_size=args.batch_size,
            )
            _append_csv_rows(SCORES_CSV, SCORES_COLUMNS, s_rows)
            _append_csv_rows(EMBEDDING_SHIFT_CSV, EMBEDDING_SHIFT_COLUMNS, sh_rows)
            for row in s_rows:
                done_score_keys.add((row["uniprot_id"], row["pos"], row["wt"], row["mut"], row["label"], "esm2_650m"))
            for row in sh_rows:
                done_shift_keys.add((row["uniprot_id"], row["pos"], row["wt"], row["mut"], "esm2_650m"))
            n_rows += len(s_rows)
            n_shifts += len(sh_rows)
            completed_by_model["esm2_650m"] += 1
            if idx <= 3 or idx % 10 == 0 or idx == len(target_uids):
                logger.info(
                    "[esm2_650m] %d/%d proteins (%s len=%d, +%d/+%d rows in %.1fs; total %.1fs)",
                    idx,
                    len(target_uids),
                    uid,
                    len(sequences[uid]),
                    len(s_rows),
                    len(sh_rows),
                    time.perf_counter() - tp,
                    time.perf_counter() - t0,
                )
        del esm2_model

    elapsed = time.perf_counter() - t0_total
    logger.info("Finished requested run in %.1fs. Completed per model: %s", elapsed, completed_by_model)
    if args.max_proteins == 0 and len(target_uids) == len(all_uids):
        append_final_log_line(SCORE_LOG, "DONE")
    else:
        append_final_log_line(SCORE_LOG, f"DONE (partial: {len(target_uids)} of {len(all_uids)} proteins)")


if __name__ == "__main__":
    main()
