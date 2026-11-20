"""Download S669, Ssym (direct & reverse), PDBs, and build normalized cache/datasets.json."""
from __future__ import annotations

import csv
import io
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from common import CACHE_DIR, DOWNLOADS_DIR, atomic_write_json, clean_pdb_chain, fetch_url, find_repo_asset, locate_residue, residues_from_pdb
from training_overlap import check_heldout, load_training_profiles

S669_URL = "https://raw.githubusercontent.com/ivankovlab/abyssal/main/datasets/S669.tsv"
SSYM_URL = "https://raw.githubusercontent.com/ivankovlab/abyssal/main/datasets/Ssym.tsv"
PDB_DIR = DOWNLOADS_DIR / "pdb"
CLEAN_PDB_DIR = CACHE_DIR / "clean_pdb"


def _parse_mut(mut: str) -> tuple[str, int, str]:
    return mut[0].upper(), int(mut[1:-1]), mut[-1].upper()


def protein_cluster(uniprot: str, pdb: str, chain: str) -> tuple[str, bool]:
    """Return (group_id, no_accession). Groups by UniProt accession, falling back to PDB_chain."""
    up = (uniprot or "").strip().upper()
    if not up or up in {"NA", "N/A", "NONE", "-", "?"}:
        return f"{pdb.strip().upper()}_{chain.strip().upper()}", True
    return up, False


def _fetch_pdb(pdb_id: str, fallback_raw_urls: list[str] | None = None) -> pathlib.Path:
    pdb_u = pdb_id.strip().upper()
    dest = PDB_DIR / f"{pdb_u}.pdb"
    if dest.exists() and dest.stat().st_size > 100:
        return dest
    for bench_ds in ("s669", "ssym"):
        cached = find_repo_asset("logs", "foldx_bench", bench_ds, "pdb", f"{pdb_u}.pdb")
        if cached:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(cached.read_bytes())
            return dest
    urls = [f"https://files.rcsb.org/download/{pdb_u}.pdb"] + (fallback_raw_urls or [])
    for url in urls:
        try:
            fetch_url(url, dest, timeout=25)
            return dest
        except Exception:
            continue
    raise RuntimeError(f"Failed to download PDB {pdb_u} from all sources")


def _ensure_clean_chain(pdb_id: str, chain: str, wt: str, pos: int, fallback_urls: list[str]) -> tuple[str, int, int, str]:
    raw_path = _fetch_pdb(pdb_id, fallback_urls)
    clean_path = CLEAN_PDB_DIR / f"{pdb_id.upper()}_{chain.upper()}.pdb"
    if not clean_path.exists():
        cleaned = clean_pdb_chain(raw_path.read_text(encoding="utf-8", errors="replace"), chain)
        clean_path.parent.mkdir(parents=True, exist_ok=True)
        clean_path.write_text(cleaned, encoding="utf-8")
    else:
        cleaned = clean_path.read_text(encoding="utf-8")
    res = residues_from_pdb(cleaned)
    hit = locate_residue(res, wt, pos)
    if not hit:
        raise RuntimeError(f"Residue {wt}{pos} missing in {pdb_id}:{chain}")
    loc_res, mode = hit
    return str(clean_path), len(res), loc_res["res_seq"], mode


def _prefetch_pdbs(s669_rows: list[dict], ssym_rows: list[dict]) -> None:
    from concurrent.futures import ThreadPoolExecutor

    tasks: dict[str, list[str]] = {}
    for r in s669_rows:
        tasks.setdefault(r["pdb"].upper(), [])
    for r in ssym_rows:
        p, mp = r["pdb"].upper(), r["pdb_mutant"].upper()
        tasks.setdefault(p, [f"https://raw.githubusercontent.com/KULL-Centre/_2022_ML-ddG-Blaabjerg/main/data/test/Ssym_dir/structure/raw/{p}.pdb"])
        tasks.setdefault(mp, [f"https://raw.githubusercontent.com/KULL-Centre/_2022_ML-ddG-Blaabjerg/main/data/test/Ssym_inv/structure/raw/{mp}.pdb"])
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda item: _fetch_pdb(item[0], item[1]), tasks.items()))


def _build_s669_records(s669_rows: list[dict]) -> list[dict]:
    out = []
    for r in s669_rows:
        pdb, ch = r["pdb"].upper(), r["chain"].upper()
        wt, pos, mut = _parse_mut(r["mutation_pdb"])
        _, up_pos, _ = _parse_mut(r["mutation"])
        clean_p, n_res, pdb_pos, mode = _ensure_clean_chain(pdb, ch, wt, pos, [])
        uniprot = r["uniprot"].strip()
        cluster, no_acc = protein_cluster(uniprot, pdb, ch)
        out.append({
            "id": f"{pdb}{ch}_{r['mutation_pdb']}", "dataset": "s669", "pdb": pdb, "chain": ch,
            "wt": wt, "pos": pdb_pos, "uniprot_pos": up_pos, "mut": mut, "mutation": f"{wt}{pdb_pos}{mut}",
            "measured": float(r["ddG"]), "uniprot": uniprot, "organism": r["organism"].strip(),
            "wt_seq": r["wt_sequence"].strip(), "clean_pdb": clean_p, "n_residues": n_res, "pos_mode": mode,
            "cluster": cluster, "no_accession": no_acc,
        })
    return out


def _build_ssym_records(ssym_rows: list[dict]) -> tuple[list[dict], list[dict]]:
    direct, reverse = [], []
    for r in ssym_rows:
        pdb, ch = r["pdb"].upper(), r["chain"].upper()
        wt, pos, mut = _parse_mut(r["mutation_pdb"])
        _, up_pos, _ = _parse_mut(r["mutation"])
        dir_id = f"{pdb}{ch}_{r['mutation_pdb']}"
        clean_d, n_d, pos_d, mode_d = _ensure_clean_chain(
            pdb, ch, wt, pos,
            [f"https://raw.githubusercontent.com/KULL-Centre/_2022_ML-ddG-Blaabjerg/main/data/test/Ssym_dir/structure/raw/{pdb}.pdb"],
        )
        ddg_dir = float(r["ddG"])
        uniprot = r["uniprot"].strip()
        cluster, no_acc = protein_cluster(uniprot, pdb, ch)
        direct.append({
            "id": dir_id, "pair_id": dir_id, "dataset": "ssym_direct", "pdb": pdb, "chain": ch,
            "wt": wt, "pos": pos_d, "uniprot_pos": up_pos, "mut": mut, "mutation": f"{wt}{pos_d}{mut}",
            "measured": ddg_dir, "uniprot": uniprot, "organism": r["organism"].strip(),
            "wt_seq": r["wt_sequence"].strip(), "clean_pdb": clean_d, "n_residues": n_d, "pos_mode": mode_d,
            "cluster": cluster, "no_accession": no_acc,
        })
        mpdb, mch = r["pdb_mutant"].upper(), r["chain_mutant"].upper()
        clean_r, n_r, pos_r, mode_r = _ensure_clean_chain(
            mpdb, mch, mut, pos,
            [f"https://raw.githubusercontent.com/KULL-Centre/_2022_ML-ddG-Blaabjerg/main/data/test/Ssym_inv/structure/raw/{mpdb}.pdb"],
        )
        reverse.append({
            "id": f"{mpdb}{mch}_{mut}{pos_r}{wt}", "pair_id": dir_id, "dataset": "ssym_reverse", "pdb": mpdb, "chain": mch,
            "wt": mut, "pos": pos_r, "uniprot_pos": up_pos, "mut": wt, "mutation": f"{mut}{pos_r}{wt}",
            "measured": -ddg_dir, "uniprot": uniprot, "organism": r["organism"].strip(),
            "wt_seq": r["mutant_sequence"].strip(), "clean_pdb": clean_r, "n_residues": n_r, "pos_mode": mode_r,
            "cluster": cluster, "no_accession": no_acc,
        })
    return direct, reverse


def _build_records() -> dict[str, list[dict]]:
    s669_path, ssym_path = DOWNLOADS_DIR / "S669.tsv", DOWNLOADS_DIR / "Ssym.tsv"
    fetch_url(S669_URL, s669_path)
    fetch_url(SSYM_URL, ssym_path)
    s669_rows = list(csv.DictReader(io.StringIO(s669_path.read_text(encoding="utf-8")), delimiter="\t"))
    ssym_rows = list(csv.DictReader(io.StringIO(ssym_path.read_text(encoding="utf-8")), delimiter="\t"))
    _prefetch_pdbs(s669_rows, ssym_rows)
    ssym_dir, ssym_rev = _build_ssym_records(ssym_rows)
    return {"s669": _build_s669_records(s669_rows), "ssym_direct": ssym_dir, "ssym_reverse": ssym_rev}


def main() -> None:
    datasets = _build_records()
    profiles = load_training_profiles()
    protein_cache: dict[tuple[str, str, str, str], dict[str, dict]] = {}
    for ds_name, rows in datasets.items():
        for row in rows:
            pkey = (row["pdb"], row["chain"], row["uniprot"], row["wt_seq"])
            if pkey not in protein_cache:
                protein_cache[pkey] = {
                    eng: {"heldout": ok, "reason": reason}
                    for eng, prof in profiles.items()
                    for ok, reason in [check_heldout(row["pdb"], row["chain"], row["uniprot"], row["wt_seq"], prof)]
                }
            row["heldout"] = protein_cache[pkey]
        n_groups = len({r["cluster"] for r in rows})
        n_no_acc = sum(1 for r in rows if r.get("no_accession"))
        print(f"{ds_name}: {len(rows)} variants prepared ({n_groups} protein groups, {n_no_acc} no_accession)")
    for eng in profiles:
        kept = sum(1 for r in datasets["s669"] if r["heldout"][eng]["heldout"])
        print(f"  S669 held-out for {eng}: {kept} / {len(datasets['s669'])}")
    atomic_write_json(CACHE_DIR / "datasets.json", datasets)


if __name__ == "__main__":
    main()
