"""Shared paths, PDB utilities, sign normalization, and sequence identity."""
from __future__ import annotations

import json
import os
import pathlib
import re
import tempfile
import urllib.request

BENCH_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = BENCH_DIR.parent.parent
DOWNLOADS_DIR = BENCH_DIR / "downloads"
CACHE_DIR = BENCH_DIR / "cache"

AA_3TO1 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
    "HID": "H", "HIE": "H", "HIP": "H", "HSD": "H", "HSE": "H", "HSP": "H",
    "CYX": "C", "CYM": "C", "ASH": "D", "GLH": "E", "LYN": "K",
}

ENGINE_SIGN_CONVENTIONS = {
    "foldx": "positive-destabilizing",
    "thermompnn": "positive-destabilizing",
    "stabilityoracle": "positive-destabilizing",
    "rasp": "positive-destabilizing",
    "protvar": "positive-destabilizing",
    "dynamut2": "negative-destabilizing",
    "ddmut": "negative-destabilizing",
}


def find_repo_asset(*parts: str) -> pathlib.Path | None:
    """Resolve an asset in the worktree first, then an optional sibling main checkout."""
    candidates = [REPO_ROOT.joinpath(*parts)]
    env_main = os.environ.get("MSE_MAIN_REPO")
    if env_main:
        candidates.append(pathlib.Path(env_main).joinpath(*parts))
    sibling = pathlib.Path(r"C:\Users\HSA19\antigravity\Missense-Structural-Explorer")
    if sibling != REPO_ROOT:
        candidates.append(sibling.joinpath(*parts))
    for path in candidates:
        if path.exists():
            return path
    return None


def to_canonical_ddg(raw_value: float, convention: str) -> float:
    """Convert a score into positive-destabilizing kcal/mol."""
    if convention == "positive-destabilizing":
        return float(raw_value)
    if convention == "negative-destabilizing":
        return -float(raw_value)
    raise ValueError(f"Unknown sign convention: {convention}")


def atomic_write_text(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
        os.replace(tmp, path)
    except Exception:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def atomic_write_json(path: pathlib.Path, data: object) -> None:
    atomic_write_text(path, json.dumps(data, indent=2) + "\n")


def read_jsonl(path: pathlib.Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def append_jsonl(path: pathlib.Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(row) + "\n")


def fetch_url(url: str, dest: pathlib.Path | None = None, timeout: int = 30) -> bytes:
    """Download URL (optionally cached at dest) with a clear User-Agent."""
    if dest and dest.exists() and dest.stat().st_size > 0:
        return dest.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": "MissenseStructuralExplorer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    if dest:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return data


def clean_pdb_chain(pdb_text: str, chain: str) -> str:
    """Extract first-model single-chain heavy ATOM records matching cleanPdbForFoldX."""
    target = (chain or "A").strip().upper()
    cleaned: list[str] = []
    for line in pdb_text.splitlines():
        if line.startswith("ENDMDL"):
            cleaned.append(line)
            break
        if line.startswith("ATOM"):
            line_chain = (line[21] if len(line) > 21 else " ").strip().upper() or "A"
            if line_chain != target:
                continue
            alt = line[16] if len(line) > 16 else " "
            if alt not in (" ", "A", "1"):
                continue
            atom_name = line[12:16].strip()
            elem = line[76:78].strip().upper() if len(line) >= 78 else ""
            if elem == "H" or re.match(r"^[1-3]?H", atom_name, re.I):
                continue
            if len(line) > 16 and line[16] != " ":
                line = line[:16] + " " + line[17:]
            if len(line) <= 21 or line[21] == " ":
                line = (line[:21] if len(line) >= 21 else line.ljust(21)) + target + line[22:]
            cleaned.append(line)
        elif line.startswith(("TER", "END")):
            cleaned.append(line)
    return "\n".join(cleaned)


def residues_from_pdb(cleaned_pdb: str) -> list[dict]:
    """Return ordered unique CA residues with res_seq, ins_code, and 1-letter AA."""
    seen: dict[str, dict] = {}
    for line in cleaned_pdb.splitlines():
        if not line.startswith("ATOM") or line[12:16].strip() != "CA":
            continue
        key = line[22:27]
        if key not in seen:
            res3 = line[17:20].strip().upper()
            seen[key] = {
                "res_seq": int(line[22:26]),
                "ins_code": line[26].strip(),
                "aa": AA_3TO1.get(res3, "?"),
            }
    return list(seen.values())


def locate_residue(residues: list[dict], wt: str, pos: int) -> tuple[dict, str] | None:
    """Match dataset position by structure residue number first, then 1-based index."""
    for r in residues:
        if r["res_seq"] == pos and r["ins_code"] == "":
            if r["aa"] == wt:
                return r, "structure"
            break
    if 1 <= pos <= len(residues) and residues[pos - 1]["aa"] == wt:
        return residues[pos - 1], "running-count"
    return None


def _kmer_overlap(seq_a: str, seq_b: str, k: int = 4) -> float:
    if len(seq_a) < k or len(seq_b) < k:
        return 1.0
    kmers_a = {seq_a[i:i + k] for i in range(len(seq_a) - k + 1)}
    kmers_b = {seq_b[i:i + k] for i in range(len(seq_b) - k + 1)}
    return len(kmers_a & kmers_b) / max(1, min(len(kmers_a), len(kmers_b)))


def global_sequence_identity(seq_a: str, seq_b: str) -> float:
    """Standard Needleman-Wunsch global identity (matches / alignment_length) with k-mer gate."""
    a, b = seq_a.strip().upper(), seq_b.strip().upper()
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if min(len(a), len(b)) / max(len(a), len(b)) < 0.25:
        return 0.0
    if _kmer_overlap(a, b, k=4) < 0.02 and min(len(a), len(b)) > 30:
        return 0.0
    matches, aligned_len = _nw_align(a, b)
    return matches / max(1, aligned_len)


def _nw_align(a: str, b: str) -> tuple[int, int]:
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = -2 * i
    for j in range(1, m + 1):
        dp[0][j] = -2 * j
    for i in range(1, n + 1):
        ai = a[i - 1]
        row, prev_row = dp[i], dp[i - 1]
        for j in range(1, m + 1):
            s = prev_row[j - 1] + (1 if ai == b[j - 1] else -1)
            u = prev_row[j] - 2
            l = row[j - 1] - 2
            row[j] = s if s >= u and s >= l else (u if u >= l else l)
    matches, aligned = 0, 0
    i, j = n, m
    while i > 0 or j > 0:
        aligned += 1
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + (1 if a[i - 1] == b[j - 1] else -1):
            if a[i - 1] == b[j - 1]:
                matches += 1
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] - 2:
            i -= 1
        else:
            j -= 1
    return matches, aligned
