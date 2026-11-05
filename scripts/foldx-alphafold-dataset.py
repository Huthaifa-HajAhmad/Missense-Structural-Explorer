"""Builds a dataset for scripts/foldx-repair-benchmark.ts that runs the S669 and Ssym variants on AlphaFold models.

Each PDB chain is mapped to UniProt with SIFTS (PDBe), and a variant is kept only if the wild type matches the AlphaFold DB
model at the mapped position. Models up to 1500 residues, at most 8 variants per accession (first in file order), so that a
few well-studied proteins cannot dominate. Writes dataset.csv, sources.json and pdb/<code>.pdb into the output folder, where
the benchmark script finds them.

    python scripts/foldx-alphafold-dataset.py logs/foldx_bench/af
    npx tsx scripts/foldx-repair-benchmark.ts --dataset logs/foldx_bench/af/dataset.csv --out logs/foldx_bench/af
"""
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

OUT = sys.argv[1]
DATA = "tools/thermompnn/data_all/testing/"
MAX_RESIDUES = 1500
MAX_PER_ACCESSION = 8
THREE = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
         "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V"}


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "foldx-benchmark"}), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except OSError:
            pass
        time.sleep(2 * (attempt + 1))
    return None


rows = []
for name, label in (("s669_clean_dir.csv", "s669"), ("ssym-5fold_clean_dir.csv", "ssym")):
    for r in csv.DictReader(open(DATA + name, encoding="utf-8")):
        m = re.match(r"^([A-Z])(\d+)([A-Z])$", r["MUT"])
        rows.append({"set": label, "pdb": r["PDB"][:4].lower(), "chain": r["PDB"][4:], "wt": m[1], "pos": int(m[2]), "mut": m[3], "ddg": r["DDG"], "id": f'{r["PDB"]}_{r["MUT"]}'})

segments = {}
for pdb in sorted({r["pdb"] for r in rows}):
    raw = get(f"https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/{pdb}")
    segments[pdb] = []
    for acc, info in (json.loads(raw).get(pdb, {}).get("UniProt", {}) if raw else {}).items():
        for s in info["mappings"]:
            if s["start"].get("author_residue_number") is None or s["end"].get("author_residue_number") is None:
                continue
            segments[pdb].append({"acc": acc, "chain": s["chain_id"], "unp": s["unp_start"], "a": s["start"]["author_residue_number"], "b": s["end"]["author_residue_number"]})

    # SIFTS often leaves the author numbers empty at segment ends. The file's own DBREF records fill the gap,
    # and the wild-type check below rejects any position they get wrong.
    for folder in ("logs/foldx_bench/s669/pdb", "logs/foldx_bench/ssym/pdb"):
        path = f"{folder}/{pdb.upper()}.pdb"
        if os.path.exists(path):
            for line in open(path, encoding="utf-8", errors="replace"):
                if line.startswith("DBREF ") and line[26:32].strip() == "UNP":
                    segments[pdb].append({"acc": line[33:41].strip(), "chain": line[12], "unp": int(line[55:60]), "a": int(line[14:18]), "b": int(line[20:24])})
            break

models = {}


def model(acc):
    if acc in models:
        return models[acc]
    models[acc] = None
    raw = get(f"https://alphafold.ebi.ac.uk/api/prediction/{acc}")
    if raw:
        entries = [e for e in json.loads(raw) if e.get("uniprotAccession") == acc and e.get("pdbUrl")]
        if entries:
            text = get(entries[0]["pdbUrl"])
            if text:
                text = text.decode("utf-8")
                seq = {}
                for line in text.splitlines():
                    if line.startswith("ATOM") and line[12:16].strip() == "CA":
                        seq[int(line[22:26])] = THREE.get(line[17:20].strip(), "?")
                models[acc] = {"text": text, "seq": seq}
    return models[acc]


os.makedirs(os.path.join(OUT, "pdb"), exist_ok=True)
codes, kept, seen, counts = {}, [], set(), {}
drop = {"no SIFTS mapping": 0, "no or too large a model": 0, "wild type differs": 0, "over the per-protein cap": 0, "same variant twice": 0}
for r in rows:
    segs = [s for s in segments[r["pdb"]] if s["chain"] == r["chain"] and s["a"] <= r["pos"] <= s["b"]]
    if not segs:
        drop["no SIFTS mapping"] += 1
        continue
    s = segs[0]
    acc, pos = s["acc"], s["unp"] + (r["pos"] - s["a"])
    m = model(acc)
    if not m or len(m["seq"]) > MAX_RESIDUES:
        drop["no or too large a model"] += 1
        continue
    if m["seq"].get(pos) != r["wt"]:
        drop["wild type differs"] += 1
        continue
    if (acc, pos, r["mut"]) in seen:
        drop["same variant twice"] += 1
        continue
    if counts.get(acc, 0) >= MAX_PER_ACCESSION:
        drop["over the per-protein cap"] += 1
        continue
    seen.add((acc, pos, r["mut"]))
    counts[acc] = counts.get(acc, 0) + 1
    if acc not in codes:
        codes[acc] = f"A{len(codes):03d}"
        with open(os.path.join(OUT, "pdb", codes[acc] + ".pdb"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(m["text"])
    kept.append({"PDB": codes[acc] + "A", "MUT": f'{r["wt"]}{pos}{r["mut"]}', "DDG": r["ddg"], "accession": acc, "source": r["id"], "set": r["set"]})

with open(os.path.join(OUT, "dataset.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=["PDB", "MUT", "DDG"])
    w.writeheader()
    w.writerows({k: k_row[k] for k in ("PDB", "MUT", "DDG")} for k_row in kept)
with open(os.path.join(OUT, "sources.json"), "w", encoding="utf-8") as fh:
    json.dump({f'{k["PDB"]}_{k["MUT"]}': {"source": k["source"], "set": k["set"], "accession": k["accession"]} for k in kept}, fh, indent=1)
sizes = sorted(len(models[a]["seq"]) for a in codes)
print(f"kept {len(kept)} of {len(rows)}: {sum(k['set'] == 's669' for k in kept)} S669, {sum(k['set'] == 'ssym' for k in kept)} Ssym; {len(codes)} proteins; sizes {sizes[0]} to {sizes[-1]}, median {sizes[len(sizes) // 2]}, above 233: {sum(s > 233 for s in sizes)}; dropped {drop}")
