"""Training set manifests and held-out overlap checks (UniProt + >=25% seq identity)."""
from __future__ import annotations

import csv
import io
import json
import pathlib
import urllib.request

from common import DOWNLOADS_DIR, fetch_url, global_sequence_identity

TRAIN_DIR = DOWNLOADS_DIR / "training"

GUEROIS_2002_PDBS = [
    ("1A2P", "A"), ("1YPC", "I"), ("2CHF", "A"), ("1BF4", "A"), ("1FMK", "A"),
    ("1FKB", "A"), ("1TEN", "A"), ("1SHG", "A"), ("1AYE", "A"),
]

URLS = {
    "mega_train": "https://raw.githubusercontent.com/Kuhlman-Lab/ThermoMPNN/main/data_all/training/mega_train.csv",
    "mega_val": "https://raw.githubusercontent.com/Kuhlman-Lab/ThermoMPNN/main/data_all/training/mega_val.csv",
    "mega_m8": "https://raw.githubusercontent.com/Kuhlman-Lab/ThermoMPNN/main/dataset_splits/s669_vs_megascale_homologues.m8",
    "cdna117k": "https://raw.githubusercontent.com/danny305/StabilityOracle/master/data/datasets/cdna117K.csv",
    "rasp_pdbids": "https://raw.githubusercontent.com/KULL-Centre/_2022_ML-ddG-Blaabjerg/main/data/train/cavity/structure/pdbids.txt",
    "rasp_down": "https://raw.githubusercontent.com/KULL-Centre/_2022_ML-ddG-Blaabjerg/main/data/train/downstream/ddG_Rosetta/ddg.csv",
    "s2298": "https://raw.githubusercontent.com/sambitmishra0628/PSP-GNM/master/datasets/S2298_forward.csv",
    "s2648": "https://raw.githubusercontent.com/ivankovlab/abyssal/main/datasets/S2648.tsv",
    "fireprot_train": "https://raw.githubusercontent.com/Kuhlman-Lab/ThermoMPNN/main/data_all/training/fireprot_train.csv",
    "fireprot_val": "https://raw.githubusercontent.com/Kuhlman-Lab/ThermoMPNN/main/data_all/training/fireprot_val.csv",
}


def fetch_pdbe_uniprot_map(pdb_ids: list[str], cache_path: pathlib.Path) -> dict[str, dict[str, set[str]]]:
    """Return {pdb_lower: {chain_upper: set(uniprot_acc)}} cached on disk."""
    from concurrent.futures import ThreadPoolExecutor

    cached: dict[str, dict[str, list[str]]] = {}
    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
    todo = sorted({p.lower() for p in pdb_ids if len(p) == 4 and p.lower() not in cached})

    def _one(pdb: str) -> tuple[str, dict[str, list[str]]]:
        mapping: dict[str, list[str]] = {}
        try:
            raw = fetch_url(f"https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/{pdb}", timeout=15)
            data = json.loads(raw).get(pdb, {}).get("UniProt", {})
            for acc, info in data.items():
                for seg in info.get("mappings", []):
                    ch = str(seg.get("chain_id") or seg.get("struct_asym_id") or "").upper()
                    if ch and acc not in mapping.setdefault(ch, []):
                        mapping[ch].append(acc)
        except Exception:
            pass
        return pdb, mapping

    if todo:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for pdb, mapping in pool.map(_one, todo):
                cached[pdb] = mapping
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cached), encoding="utf-8")
    return {p: {c: set(accs) for c, accs in chs.items()} for p, chs in cached.items()}


def fetch_rcsb_sequences(pdb_ids: list[str], cache_path: pathlib.Path) -> dict[str, str]:
    """Fetch PDB chain FASTA sequences via RCSB GraphQL/REST for sequence identity checks."""
    cached: dict[str, str] = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    missing = [p.upper() for p in sorted({x[:4].upper() for x in pdb_ids}) if p.upper() not in cached]
    for i in range(0, len(missing), 40):
        batch = missing[i:i + 40]
        url = f"https://www.rcsb.org/fasta/entry/{','.join(batch)}"
        try:
            txt = fetch_url(url, timeout=25).decode("utf-8", errors="replace")
            _parse_fasta_into(txt, cached)
        except Exception:
            for p in batch:
                cached.setdefault(p, "")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cached), encoding="utf-8")
    return cached


def _parse_fasta_into(fasta_text: str, out: dict[str, str]) -> None:
    cur_pdb, cur_seq = "", []
    for line in fasta_text.splitlines():
        if line.startswith(">"):
            if cur_pdb:
                out.setdefault(cur_pdb, "".join(cur_seq))
            cur_pdb = line[1:5].upper()
            cur_seq = []
        else:
            cur_seq.append(line.strip())
    if cur_pdb:
        out.setdefault(cur_pdb, "".join(cur_seq))


def _csv_rows(path: pathlib.Path, delim: str = ",") -> list[dict[str, str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(text), delimiter=delim))


def _download_training_files() -> dict[str, pathlib.Path]:
    TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    paths = {k: TRAIN_DIR / f"{k}.{u.split('.')[-1]}" for k, u in URLS.items()}
    for k, u in URLS.items():
        fetch_url(u, paths[k], timeout=45)
    return paths


def _collect_rasp_s2298_s2648(paths: dict[str, pathlib.Path]) -> tuple[list[str], set[str], set[str], set[str], set[str], set[str], set[str], set[str]]:
    rasp_ids = [x.strip()[:4].upper() for x in paths["rasp_pdbids"].read_text().splitlines() if len(x.strip()) >= 4]
    rasp_ids += sorted({r["pdbid"].strip()[:4].upper() for r in _csv_rows(paths["rasp_down"]) if r.get("pdbid")})
    s2298_rows = _csv_rows(paths["s2298"])
    s2298_pdbs = {r["PDB_CHAIN"][:4].upper() for r in s2298_rows if r.get("PDB_CHAIN")}
    s2298_seqs = {r["PDB_SEQUENCE"].strip().upper() for r in s2298_rows if r.get("PDB_SEQUENCE")}
    s2648_rows = _csv_rows(paths["s2648"], delim="\t")
    s2648_ups = {r["uniprot"].strip().upper() for r in s2648_rows if r.get("uniprot")}
    s2648_seqs = {r["wt_sequence"].strip().upper() for r in s2648_rows if r.get("wt_sequence")}
    s2648_pdbs = {r["pdb"].strip().upper() for r in s2648_rows if r.get("pdb")}
    fp_rows = _csv_rows(paths["fireprot_train"]) + _csv_rows(paths["fireprot_val"])
    fp_ups = {r["uniprot_id"].strip().upper() for r in fp_rows if r.get("uniprot_id")}
    fp_pdbs = {p.strip().upper() for r in fp_rows for p in r.get("pdb_id", "").split("|") if p.strip()}
    return rasp_ids, s2298_pdbs, s2298_seqs, s2648_ups, s2648_seqs, s2648_pdbs | fp_pdbs, s2648_ups | fp_ups, s2648_pdbs


def load_training_profiles() -> dict[str, dict]:
    """Download training manifests and build {uniprots, seqs, pdbs, m8_pairs} per engine."""
    paths = _download_training_files()
    mega_seqs = {r["wt_seq"].strip().upper() for k in ("mega_train", "mega_val") for r in _csv_rows(paths[k]) if r.get("wt_seq")}
    mega_m8 = {ln.split("\t")[0].strip().upper() for ln in paths["mega_m8"].read_text(encoding="utf-8").splitlines() if ln.strip() and float(ln.split("\t")[2]) >= 0.25}
    cdna_rows = _csv_rows(paths["cdna117k"])
    cdna_ups = {r["uniprot_id"].strip().upper() for r in cdna_rows if r.get("uniprot_id")}
    cdna_seqs = {r["sequence"].strip().upper() for r in cdna_rows if r.get("sequence")}
    cdna_pdbs = {r["pdb_code"].strip().upper() for r in cdna_rows if r.get("pdb_code")}
    rasp_ids, s2298_pdbs, s2298_seqs, _, s2648_seqs, ddmut_pdbs, ddmut_ups, _ = _collect_rasp_s2298_s2648(paths)
    pdbe = fetch_pdbe_uniprot_map([p for p, _ in GUEROIS_2002_PDBS] + rasp_ids + sorted(s2298_pdbs), TRAIN_DIR / "pdbe_train_uniprot.json")
    guerois_ups = {acc for p, ch in GUEROIS_2002_PDBS for acc in pdbe.get(p.lower(), {}).get(ch, set())}
    rasp_ups = {acc for p in rasp_ids for ch_accs in pdbe.get(p.lower(), {}).values() for acc in ch_accs}
    s2298_ups = {acc for p in s2298_pdbs for ch_accs in pdbe.get(p.lower(), {}).values() for acc in ch_accs}
    rcsb_seqs = fetch_rcsb_sequences([p for p, _ in GUEROIS_2002_PDBS] + rasp_ids, TRAIN_DIR / "rcsb_train_seqs.json")
    guerois_seqs = {rcsb_seqs[p] for p, _ in GUEROIS_2002_PDBS if rcsb_seqs.get(p)}
    rasp_seqs = {rcsb_seqs[p] for p in rasp_ids if rcsb_seqs.get(p)}
    foldx_prof = {"pdbs": {p for p, _ in GUEROIS_2002_PDBS}, "uniprots": guerois_ups, "seqs": sorted(guerois_seqs), "m8": set()}
    return {
        "foldx": foldx_prof,
        "protvar": foldx_prof,
        "thermompnn": {"pdbs": set(), "uniprots": set(), "seqs": sorted(mega_seqs), "m8": mega_m8},
        "stabilityoracle": {"pdbs": cdna_pdbs, "uniprots": cdna_ups, "seqs": sorted(cdna_seqs), "m8": set()},
        "rasp": {"pdbs": set(rasp_ids), "uniprots": rasp_ups, "seqs": sorted(rasp_seqs), "m8": set()},
        "dynamut2": {"pdbs": s2298_pdbs, "uniprots": s2298_ups, "seqs": sorted(s2298_seqs), "m8": set()},
        "ddmut": {"pdbs": ddmut_pdbs, "uniprots": ddmut_ups, "seqs": sorted(s2648_seqs), "m8": set()},
    }


def check_heldout(pdb: str, chain: str, uniprot: str, wt_seq: str, prof: dict) -> tuple[bool, str | None]:
    """Return (is_heldout, exclusion_reason) for one target protein against an engine profile."""
    pdb_u = pdb.upper()
    up_u = (uniprot or "").strip().upper()
    if not up_u or up_u in {"NA", "N/A", "NONE", "-", "?"}:
        return False, "no_uniprot_accession"
    if pdb_u in prof["pdbs"]:
        return False, f"same_pdb:{pdb_u}"
    if up_u in prof["uniprots"]:
        return False, f"same_uniprot:{up_u}"
    key_m8 = f"{pdb_u}:{chain.upper()}"
    if key_m8 in prof["m8"]:
        return False, f"m8_homologue>=25%:{key_m8}"
    if wt_seq:
        for tseq in prof["seqs"]:
            ident = global_sequence_identity(wt_seq, tseq)
            if ident >= 0.25:
                return False, f"seq_id={ident:.2f}>=0.25"
    return True, None
