"""
The frozen StabilityOracle code against proteins that played no part in building or choosing it.

S669 and Ssym were kept out of the charge table, but recipes were compared on them, so they are not independent. T2837 was never used in
this work, and neither was FireProtDB. This takes both, drops every PDB entry also in S669, Ssym, p53 or myoglobin, keeps at most 5 variants
per chain (fixed seed), and compares with the authors' published predictions and with lab values. Chain-resampled 95% intervals.

Usage, from the repository root:
    tools/.venv/Scripts/python.exe scripts/stabilityoracle-independent-check.py <upstream-folder>/data/predictions/SO
Downloads PDB files into logs/foldx_bench/t2837/pdb. Method: doc/STABILITY_ORACLE_INPUTS_RESEARCH.md.
"""
import csv
import json
import os
import random
import sys
import urllib.request

sys.path.insert(0, os.getcwd())
import numpy as np

from tools.model_server_app.routers import stabilityoracle as SO

published_folder = sys.argv[1]
FOLDER = "logs/foldx_bench/t2837/pdb"
os.makedirs(FOLDER, exist_ok=True)


def read(name):
    with open(os.path.join(published_folder, f"{name}.csv"), encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


used = {row["pdb_id"].upper()[:4] for name in ("S669", "S-Sym", "p53", "myoglobin") for row in read(name)}
by_chain, seen = {}, set()
for row in read("T2837") + read("fireprotdb"):
    mutation = (row["pdb_id"].upper()[:4], row["chain_id"], row["mutation"])
    if mutation[0] not in used and mutation not in seen:
        seen.add(mutation)
        by_chain.setdefault(mutation[:2], []).append(row)
random.seed(20261105)
rows = [row for key in sorted(by_chain) for row in random.sample(by_chain[key], min(5, len(by_chain[key])))]
print(json.dumps({"chains": len(by_chain), "variants": len(rows)}), flush=True)

ours, published, lab, keys, refused = [], [], [], [], {}
for row in rows:
    code, mutation, chain = row["pdb_id"].upper()[:4], row["mutation"], row["chain_id"]
    path = f"{FOLDER}/{code}.pdb"
    try:
        if not os.path.exists(path):
            urllib.request.urlretrieve(f"https://files.rcsb.org/download/{code}.pdb", path)
        with open(path, encoding="utf-8", errors="replace") as fh:
            pdb = fh.read()
        result = SO.predict_stabilityoracle_sync(SO.StabilityOracleRequest(sequence="", position=int(mutation[1:-1]), wt=mutation[0], mut=mutation[-1], wtPdb=pdb, chain=chain))
    except Exception as error:  # A refused or missing entry is a result to count, not a reason to stop the run.
        reason = str(getattr(error, "detail", error))[:60]
        refused[reason] = refused.get(reason, 0) + 1
        continue
    ours.append(result["ddG"])
    published.append(float(row["ddg_pred"]))
    lab.append(float(row["ddg"]))
    keys.append(code + chain)

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
    "scored": len(ours), "chainsScored": len(groups), "refused": refused,
    "rWithPublished": round(float(np.corrcoef(ours, published)[0, 1]), 3), "rWithPublished95": interval(with_published),
    "meanDifferenceFromPublished": round(float(np.abs(ours - published).mean()), 3),
    "rWithLab": round(float(np.corrcoef(ours, lab)[0, 1]), 3), "rWithLab95": interval(with_lab),
    "rWithLabPublishedModel": round(float(np.corrcoef(published, lab)[0, 1]), 3), "rWithLabPublishedModel95": interval(published_with_lab),
    "sd": round(float(ours.std()), 3), "publishedSd": round(float(published.std()), 3),
}), flush=True)
