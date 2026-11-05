"""
The frozen StabilityOracle code against proteins that played no part in building or choosing it.

S669 and Ssym were kept out of the charge table, but recipes were compared on them, so they are not independent. T2837 was never used in
this work, and neither was FireProtDB. This takes both and drops every variant on a protein that is also in S669, Ssym, p53 or myoglobin.
"Same protein" means the same UniProt entry (from PDBe), so a lysozyme mutant in another PDB file is dropped too. Related proteins with
different UniProt entries (for example other lysozymes) are NOT dropped. At most 5 variants are kept per chain (fixed seed). It compares
with the authors' published predictions and with lab values, with chain-resampled 95% intervals.

Usage, from the repository root:
    tools/.venv/Scripts/python.exe scripts/stabilityoracle-independent-check.py <upstream-folder>/data/predictions/SO [--entries-only] [--one-chain] [--rows <file.csv>]
  --entries-only  drop only the PDB entries used elsewhere, not the proteins (the first version of this check; it let p53, apomyoglobin
                  and lysozyme through under other PDB codes)
  --one-chain     send only the variant's chain, as the app does today. Without it the whole file goes in, so a partner chain that
                  touches the site joins the environment
  --rows <file>   save one line per scored variant (entry, chain, mutation, our value, published value, lab value) so the result can be
                  recomputed without running the model again
Downloads PDB files into logs/foldx_bench/t2837/pdb. Needs the network (RCSB, PDBe). Method: doc/STABILITY_ORACLE_INPUTS_RESEARCH.md.
"""
import csv
import json
import os
import random
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.getcwd())
import numpy as np

from tools.model_server_app.routers import stabilityoracle as SO

published_folder = sys.argv[1]
ENTRIES_ONLY = "--entries-only" in sys.argv
ONE_CHAIN = "--one-chain" in sys.argv
ROWS_FILE = sys.argv[sys.argv.index("--rows") + 1] if "--rows" in sys.argv else None
FOLDER = "logs/foldx_bench/t2837/pdb"
os.makedirs(FOLDER, exist_ok=True)


def read(name):
    with open(os.path.join(published_folder, f"{name}.csv"), encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


used = {row["pdb_id"].upper()[:4] for name in ("S669", "S-Sym", "p53", "myoglobin") for row in read(name)}
candidates = read("T2837") + read("fireprotdb")


def uniprot_by_chain(codes):
    """{PDB code: {chain: {UniProt entries}}} from PDBe. An entry PDBe has no mapping for gets no proteins, so it is never dropped."""
    def fetch(code):
        try:
            body = json.loads(urllib.request.urlopen(f"https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/{code.lower()}", timeout=60).read())
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return code, {}
            raise
        chains = {}
        for accession, detail in body.get(code.lower(), {}).get("UniProt", {}).items():
            for part in detail["mappings"]:
                chains.setdefault(part["chain_id"], set()).add(accession)
        return code, chains

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(fetch, sorted(codes)))


excluded_proteins, mapping = set(), {}
if not ENTRIES_ONLY:
    mapping = uniprot_by_chain(used | {row["pdb_id"].upper()[:4] for row in candidates})
    excluded_proteins = {accession for code in used for accessions in mapping.get(code, {}).values() for accession in accessions}
    print(json.dumps({"entriesUsedElsewhere": len(used), "proteinsUsedElsewhere": len(excluded_proteins)}), flush=True)

by_chain, seen, same_protein = {}, set(), 0
for row in candidates:
    mutation = (row["pdb_id"].upper()[:4], row["chain_id"], row["mutation"])
    if mutation[0] in used or mutation in seen:
        continue
    seen.add(mutation)
    if mapping.get(mutation[0], {}).get(mutation[1], set()) & excluded_proteins:
        same_protein += 1
        continue
    by_chain.setdefault(mutation[:2], []).append(row)
print(json.dumps({"variantsDroppedAsSameProtein": same_protein}), flush=True)
random.seed(20261105)
rows = [row for key in sorted(by_chain) for row in random.sample(by_chain[key], min(5, len(by_chain[key])))]
print(json.dumps({"chains": len(by_chain), "variants": len(rows)}), flush=True)

ours, published, lab, keys, refused, saved = [], [], [], [], {}, []
for row in rows:
    code, mutation, chain = row["pdb_id"].upper()[:4], row["mutation"], row["chain_id"]
    path = f"{FOLDER}/{code}.pdb"
    try:
        if not os.path.exists(path):
            urllib.request.urlretrieve(f"https://files.rcsb.org/download/{code}.pdb", path)
        with open(path, encoding="utf-8", errors="replace") as fh:
            pdb = fh.read()
        if ONE_CHAIN:
            first_model = pdb.split("ENDMDL")[0].splitlines()
            pdb = "\n".join(line for line in first_model if line.startswith(("ATOM", "HETATM")) and line[21] == chain)
        result = SO.predict_stabilityoracle_sync(SO.StabilityOracleRequest(sequence="", position=int(mutation[1:-1]), wt=mutation[0], mut=mutation[-1], wtPdb=pdb, chain=chain))
    except Exception as error:  # A refused or missing entry is a result to count, not a reason to stop the run.
        reason = str(getattr(error, "detail", error))[:60]
        refused[reason] = refused.get(reason, 0) + 1
        continue
    ours.append(result["ddG"])
    published.append(float(row["ddg_pred"]))
    lab.append(float(row["ddg"]))
    keys.append(code + chain)
    saved.append([code, chain, mutation, result["ddG"], row["ddg_pred"], row["ddg"]])

if ROWS_FILE:
    with open(ROWS_FILE, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["pdb_id", "chain_id", "mutation", "ours", "published", "lab"])
        writer.writerows(saved)

ours, published, lab = map(np.array, (ours, published, lab))
groups = [np.where(np.array(keys) == key)[0] for key in sorted(set(keys))]
random_state = np.random.default_rng(0)
with_published, with_lab, published_with_lab = [], [], []
for _ in range(2000):
    picked = np.concatenate([groups[i] for i in random_state.integers(0, len(groups), len(groups))])
    with_published.append(np.corrcoef(ours[picked], published[picked])[0, 1])
    with_lab.append(np.corrcoef(ours[picked], lab[picked])[0, 1])
    published_with_lab.append(np.corrcoef(published[picked], lab[picked])[0, 1])
interval = lambda draws: [round(float(np.percentile(draws, p)), 3) for p in (2.5, 97.5)]
print(json.dumps({
    "set": ("entries only" if ENTRIES_ONLY else "proteins") + (", one chain" if ONE_CHAIN else ", whole file"), "scored": len(ours), "chainsScored": len(groups), "refused": refused,
    "rWithPublished": round(float(np.corrcoef(ours, published)[0, 1]), 3), "rWithPublished95": interval(with_published),
    "meanDifferenceFromPublished": round(float(np.abs(ours - published).mean()), 3),
    "rWithLab": round(float(np.corrcoef(ours, lab)[0, 1]), 3), "rWithLab95": interval(with_lab),
    "rWithLabPublishedModel": round(float(np.corrcoef(published, lab)[0, 1]), 3), "rWithLabPublishedModel95": interval(published_with_lab),
    "sd": round(float(ours.std()), 3), "publishedSd": round(float(published.std()), 3),
}), flush=True)
