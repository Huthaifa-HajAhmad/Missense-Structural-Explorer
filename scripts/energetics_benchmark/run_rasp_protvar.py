"""Query local RaSP SQLite (read-only) and EBI ProtVar FoldX API with disk caching."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import pathlib
import sqlite3
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from common import CACHE_DIR, DOWNLOADS_DIR, atomic_write_json, find_repo_asset

PROTVAR_CACHE = CACHE_DIR / "protvar_api_cache.json"
UNIPROT_FASTA_CACHE = DOWNLOADS_DIR / "uniprot_fasta.json"


def _load_uniprot_seqs(datasets: dict[str, list[dict]]) -> dict[str, str]:
    cached: dict[str, str] = json.loads(UNIPROT_FASTA_CACHE.read_text(encoding="utf-8")) if UNIPROT_FASTA_CACHE.exists() else {}
    needed = sorted({
        (r.get("uniprot") or "").strip().upper()
        for ds in ("s669", "ssym_direct") for r in datasets[ds]
        if (r.get("uniprot") or "").strip()
    } - set(cached))
    for acc in needed:
        req = urllib.request.Request(f"https://rest.uniprot.org/uniprotkb/{acc}.fasta", headers={"User-Agent": "MissenseStructuralExplorer/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                lines = resp.read().decode("utf-8", errors="replace").splitlines()
                cached[acc] = "".join(ln.strip() for ln in lines if ln.strip() and not ln.startswith(">"))
        except Exception:
            cached[acc] = ""
    if needed:
        atomic_write_json(UNIPROT_FASTA_CACHE, cached)
    return cached


def _canonical_uniprot_pos(row: dict, uniprot_seqs: dict[str, str]) -> int | None:
    acc = (row.get("uniprot") or "").strip().upper()
    seq = uniprot_seqs.get(acc, "")
    wt_seq = (row.get("wt_seq") or "").strip().upper()
    up_pos = int(row.get("uniprot_pos") or row["pos"])
    if not acc or not seq or not (1 <= up_pos <= len(wt_seq)):
        return None
    if wt_seq in seq:
        canon = seq.find(wt_seq) + up_pos
        if 1 <= canon <= len(seq) and seq[canon - 1] == row["wt"]:
            return canon
    lo, hi = max(0, up_pos - 7), min(len(wt_seq), up_pos + 6)
    probe = wt_seq[lo:hi]
    if len(probe) >= 7 and probe in seq:
        canon = seq.find(probe) + (up_pos - 1 - lo) + 1
        if 1 <= canon <= len(seq) and seq[canon - 1] == row["wt"]:
            return canon
    if 1 <= up_pos <= len(seq) and seq[up_pos - 1] == row["wt"]:
        return up_pos
    return None


def run_rasp(datasets: dict[str, list[dict]], uniprot_seqs: dict[str, str]) -> None:
    db_path = find_repo_asset("data", "df_rasp_gnomad_clinvar.sqlite")
    if not db_path:
        raise FileNotFoundError("data/df_rasp_gnomad_clinvar.sqlite not found")
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        for ds_name, rows in datasets.items():
            if ds_name == "ssym_reverse":
                out_rows = [{"id": r["id"], "status": "not_applicable_wt_lookup", "raw_ddg": None} for r in rows]
                atomic_write_json(CACHE_DIR / f"rasp_{ds_name}.json", out_rows)
                print(f"[RaSP] {ds_name}: 0/{len(rows)} (WT AlphaFoldDB lookup not applicable to mutant PDBs)", flush=True)
                continue
            out_rows, hits = [], 0
            for r in rows:
                acc = (r.get("uniprot") or "").strip().upper()
                c_pos = _canonical_uniprot_pos(r, uniprot_seqs) if acc else None
                if c_pos is None:
                    out_rows.append({"id": r["id"], "status": "no_uniprot_map", "raw_ddg": None})
                    continue
                hit = conn.execute(
                    "SELECT rasp_score, pdb FROM rasp_variants WHERE uniprot_id=? AND pos=? AND wt=? AND mut=? LIMIT 1",
                    (acc, c_pos, r["wt"], r["mut"]),
                ).fetchone()
                if hit is not None:
                    hits += 1
                    out_rows.append({"id": r["id"], "status": "ok", "raw_ddg": float(hit[0]), "pdb": hit[1], "canon_pos": c_pos})
                else:
                    out_rows.append({"id": r["id"], "status": "miss", "raw_ddg": None, "canon_pos": c_pos})
            atomic_write_json(CACHE_DIR / f"rasp_{ds_name}.json", out_rows)
            print(f"[RaSP] {ds_name}: {hits}/{len(rows)} matched in local SQLite", flush=True)
    finally:
        conn.close()


def _fetch_protvar_key(acc: str, pos: int) -> tuple[str, list[dict] | str]:
    url = f"https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/{acc}/{pos}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "MissenseStructuralExplorer/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return f"{acc}:{pos}", data if isinstance(data, list) else []
    except urllib.error.HTTPError as err:
        return (f"{acc}:{pos}", []) if err.code == 404 else (f"{acc}:{pos}", f"HTTP {err.code}")
    except Exception as exc:
        return f"{acc}:{pos}", str(exc)[:180]


def _score_protvar_row(row: dict, c_pos: int | None, api_cache: dict) -> dict:
    acc = (row.get("uniprot") or "").strip().upper()
    if not acc or c_pos is None:
        return {"id": row["id"], "status": "no_uniprot_map", "raw_ddg": None}
    payload = api_cache.get(f"{acc}:{c_pos}")
    if isinstance(payload, str):
        return {"id": row["id"], "status": "error", "raw_ddg": None, "error": payload}
    if not isinstance(payload, list):
        return {"id": row["id"], "status": "miss", "raw_ddg": None}
    matches = [
        float(e["foldxDdg"]) for e in payload
        if str(e.get("wildType", "")).upper() == row["wt"]
        and str(e.get("mutatedType", "")).upper() == row["mut"]
        and isinstance(e.get("foldxDdg"), (int, float))
    ]
    if not matches:
        return {"id": row["id"], "status": "miss", "raw_ddg": None}
    if max(matches) - min(matches) > 0.05:
        return {"id": row["id"], "status": "fragment_disagreement", "raw_ddg": None}
    return {"id": row["id"], "status": "ok", "raw_ddg": matches[0], "canon_pos": c_pos}


def run_protvar(datasets: dict[str, list[dict]], uniprot_seqs: dict[str, str]) -> None:
    api_cache: dict = json.loads(PROTVAR_CACHE.read_text(encoding="utf-8")) if PROTVAR_CACHE.exists() else {}
    pos_map = {
        (ds, r["id"]): _canonical_uniprot_pos(r, uniprot_seqs)
        for ds in ("s669", "ssym_direct") for r in datasets[ds]
    }
    needed = sorted({
        (r["uniprot"].strip().upper(), pos_map[(ds, r["id"])])
        for ds in ("s669", "ssym_direct") for r in datasets[ds]
        if pos_map[(ds, r["id"])] is not None
        and f"{r['uniprot'].strip().upper()}:{pos_map[(ds, r['id'])]}" not in api_cache
    })
    print(f"[ProtVar] {len(needed)} uncached (UniProt, canonical_pos) lookups", flush=True)
    if needed:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for key, val in pool.map(lambda ap: _fetch_protvar_key(ap[0], ap[1]), needed):
                api_cache[key] = val
        atomic_write_json(PROTVAR_CACHE, api_cache)

    for ds_name, rows in datasets.items():
        if ds_name == "ssym_reverse":
            out_rows = [{"id": r["id"], "status": "not_applicable_wt_lookup", "raw_ddg": None} for r in rows]
            atomic_write_json(CACHE_DIR / f"protvar_{ds_name}.json", out_rows)
            print(f"[ProtVar] {ds_name}: 0/{len(rows)} (WT AlphaFoldDB lookup not applicable to mutant PDBs)", flush=True)
            continue
        out_rows = [_score_protvar_row(r, pos_map[(ds_name, r["id"])], api_cache) for r in rows]
        hits = sum(1 for r in out_rows if r["status"] == "ok")
        atomic_write_json(CACHE_DIR / f"protvar_{ds_name}.json", out_rows)
        print(f"[ProtVar] {ds_name}: {hits}/{len(rows)} matched (with <=0.05 fragment agreement)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", nargs="+", default=["rasp", "protvar"])
    args = ap.parse_args()
    datasets = json.loads((CACHE_DIR / "datasets.json").read_text(encoding="utf-8"))
    uniprot_seqs = _load_uniprot_seqs(datasets)
    if "rasp" in args.engines:
        run_rasp(datasets, uniprot_seqs)
    if "protvar" in args.engines:
        run_protvar(datasets, uniprot_seqs)


if __name__ == "__main__":
    main()
