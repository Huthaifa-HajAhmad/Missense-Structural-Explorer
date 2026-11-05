"""
Does our copy of the StabilityOracle checkpoint give the authors' published predictions when it is fed the authors' own stored inputs?

This checks the MODEL only (weights, architecture, sign and scale). It does not check how we build inputs from a PDB file; that is
`scripts/stabilityoracle-published-eval.py` and `scripts/stabilityoracle-independent-check.py`.

The authors store, for every variant, the 128 numbers per atom the model reads (`input`), plus coordinates and the two residue types.
We feed those straight in, skipping the model's own input step, and convert the output the way the app does (value = -output / 2).
Each prediction is matched to the authors' published row by PDB entry, mutation and chain.

Usage, from the repository root:
    tools/.venv/Scripts/python.exe scripts/stabilityoracle-published-reproduction.py <stored-inputs-folder> <published-folder> [Set ...]
  <stored-inputs-folder>  holds <Set>.jsonl from the authors' Zenodo record 12636946 (default sets: P53, Myoglobin, S-Sym)
  <published-folder>      is <upstream-repo>/data/predictions/SO, which holds <set>.csv with a `ddg_pred` column
Prints one JSON line per set: variants matched, Pearson r, the largest absolute difference and the mean absolute difference.
Method and results: doc/STABILITY_ORACLE_INPUTS_RESEARCH.md.
"""
import csv
import json
import os
import sys

sys.path.insert(0, os.getcwd())
import numpy as np
import torch

from tools.model_server_app.routers.stabilityoracle import get_stability_oracle_model

stored_folder, published_folder = sys.argv[1], sys.argv[2]
sets = sys.argv[3:] or ["P53", "Myoglobin", "S-Sym"]
model = get_stability_oracle_model()

for name in sets:
    with open(os.path.join(published_folder, f"{name.lower() if name != 'S-Sym' else 'S-Sym'}.csv"), encoding="utf-8") as fh:
        published = {(row["pdb_id"].lower()[:4], row["mutation"], row["chain_id"]): float(row["ddg_pred"]) for row in csv.DictReader(fh)}
    ours, theirs = [], []
    with open(os.path.join(stored_folder, f"{name}.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            entry = json.loads(line)
            mutation, chain = entry["mut_info"].split("_")[:2]
            key = (entry["pdb_id"].lower()[:4], mutation, chain)
            if key not in published:
                continue
            feats = torch.tensor([entry["input"]], dtype=torch.float32)
            coords = torch.tensor([entry["coords"]], dtype=torch.float32)
            ca = torch.tensor([entry["ca"]], dtype=torch.float32)
            mask = torch.tensor([entry["mask"]], dtype=torch.float32)
            aa = torch.tensor([[entry["from"], entry["to"]]], dtype=torch.long)
            # atom types and physical properties are only read when `feats` is None, so they are placeholders here.
            placeholder_types = torch.zeros(1, feats.shape[1], dtype=torch.long)
            placeholder_pp = torch.zeros(1, feats.shape[1], 2)
            with torch.inference_mode():
                output, _ = model(feats, placeholder_types, placeholder_pp, coords, ca, mask, aa)
            ours.append(-float(output.item()) / 2)
            theirs.append(published[key])
    ours, theirs = np.array(ours), np.array(theirs)
    print(json.dumps({
        "set": name, "matched": len(ours), "published": len(published),
        "r": round(float(np.corrcoef(ours, theirs)[0, 1]), 5),
        "maxAbsDifference": round(float(np.abs(ours - theirs).max()), 5),
        "meanAbsDifference": round(float(np.abs(ours - theirs).mean()), 5),
    }), flush=True)
