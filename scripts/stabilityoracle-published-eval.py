"""
The shipped StabilityOracle code, end to end, against the authors' published predictions and against lab values.

Usage, from the repository root, with the sidecar's Python and the bench folders in place:
    tools/.venv/Scripts/python.exe scripts/stabilityoracle-published-eval.py <upstream-folder>/data/predictions/SO [--one-chain]

With --one-chain only the variant's chain is sent, as the app does today. Without it the whole file goes in, so a partner chain that
touches the site joins the environment. Both are reported in the research doc.

<upstream-folder> is a copy of the authors' repository (https://github.com/danny305/StabilityOracle). PDB files come from
logs/foldx_bench/{ssym,s669}/pdb. "Bootstrap" below means re-sampling whole chains, so nearby variants do not count as independent.
Method and results: doc/STABILITY_ORACLE_INPUTS_RESEARCH.md.
"""
import csv
import json
import os
import sys

sys.path.insert(0, os.getcwd())
import numpy as np

from tools.model_server_app.routers import stabilityoracle as SO

published_folder = sys.argv[1]
ONE_CHAIN = "--one-chain" in sys.argv
for name, folder in (("S-Sym", "ssym"), ("S669", "s669")):
    with open(os.path.join(published_folder, f"{name}.csv"), encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    ours, published, lab, chains, refused = [], [], [], [], {}
    for row in rows:
        code, mutation, chain = row["pdb_id"].upper(), row["mutation"], row["chain_id"]
        with open(f"logs/foldx_bench/{folder}/pdb/{code}.pdb", encoding="utf-8", errors="replace") as fh:
            pdb = fh.read()
        if ONE_CHAIN:
            pdb = "\n".join(line for line in pdb.split("ENDMDL")[0].splitlines() if line.startswith(("ATOM", "HETATM")) and line[21] == chain)
        request = SO.StabilityOracleRequest(sequence="", position=int(mutation[1:-1]), wt=mutation[0], mut=mutation[-1], wtPdb=pdb, chain=chain)
        try:
            ours.append(SO.predict_stabilityoracle_sync(request)["ddG"])
        except Exception as error:  # A refused chain is a result to report, not a reason to stop the run.
            key = f"{code}_{chain}: {getattr(error, 'detail', error)}"
            refused[key] = refused.get(key, 0) + 1
            continue
        published.append(float(row["ddg_pred"]))
        lab.append(float(row["ddg"]))
        chains.append(code + chain)

    ours, published, lab = map(np.array, (ours, published, lab))
    rows_of_chain = {key: np.where(np.array(chains) == key)[0] for key in sorted(set(chains))}
    groups = list(rows_of_chain.values())
    random = np.random.default_rng(0)
    resampled = []
    for _ in range(2000):
        picked = np.concatenate([groups[i] for i in random.integers(0, len(groups), len(groups))])
        resampled.append(np.corrcoef(ours[picked], published[picked])[0, 1])
    print(json.dumps({
        "set": name + (", one chain" if ONE_CHAIN else ", whole file"), "scored": len(ours), "of": len(rows), "refused": refused,
        "rWithPublished": round(float(np.corrcoef(ours, published)[0, 1]), 3),
        "rWithPublished95": [round(float(np.percentile(resampled, p)), 3) for p in (2.5, 97.5)],
        "meanDifferenceFromPublished": round(float(np.abs(ours - published).mean()), 3),
        "rWithLab": round(float(np.corrcoef(ours, lab)[0, 1]), 3),
        "rWithLabPublishedModel": round(float(np.corrcoef(published, lab)[0, 1]), 3),
    }), flush=True)
