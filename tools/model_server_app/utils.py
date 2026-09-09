try:
    import torch
except ImportError:
    torch = None
import numpy as np
from fastapi import HTTPException

# 20 standard amino acids mapping
AA_LIST = ["L", "A", "G", "V", "S", "E", "R", "T", "I", "D", "P", "F", "K", "N", "Q", "Y", "M", "H", "W", "C"]

def validate_missense_residues(wt: str, mut: str):
    wt_upper = wt.upper()
    mut_upper = mut.upper()
    if wt_upper not in AA_LIST or mut_upper not in AA_LIST:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid amino acid residue code: wild-type={wt}, mutant={mut}. Must be canonical 20 amino acids."
        )

def crop_sequence_around_mutation(sequence: str, pos: int, max_len: int = 1022):
    if len(sequence) <= max_len:
        return sequence, pos, 0
    half_len = max_len // 2
    start = max(0, pos - 1 - half_len)
    end = start + max_len
    if end > len(sequence):
        end = len(sequence)
        start = max(0, end - max_len)
    return sequence[start:end], pos - start, start

import difflib

THREE_TO_ONE = {
    "ALA": "A", "CYS": "C", "ASP": "D", "GLU": "E", "PHE": "F",
    "GLY": "G", "HIS": "H", "ILE": "I", "LYS": "K", "LEU": "L",
    "MET": "M", "ASN": "N", "PRO": "P", "GLN": "Q", "ARG": "R",
    "SER": "S", "THR": "T", "VAL": "V", "TRP": "W", "TYR": "Y",
    "MSE": "M", "SEC": "C", "PYL": "K"
}

def encode_pdb_to_3di(
    pdb_content: str,
    seq_len: int = None,
    start_idx: int = 1,
    target_seq: str = None,
    chain_id: str = None
) -> str:
    nan_val = float("nan")

    if target_seq:
        expected_len = len(target_seq)
    elif seq_len is not None:
        expected_len = seq_len
    else:
        expected_len = None

    try:
        import mini3di
    except ImportError:
        print("[Model Server Warning] mini3di library not available. Using structure-masked fallback.")
        return "#" * (expected_len if expected_len is not None else 1)

    residues = {}
    ordered_keys = []
    for line in pdb_content.splitlines():
        if line.startswith("ATOM  ") or line.startswith("HETATM"):
            try:
                atom_name = line[12:16].strip()
                alt_loc = line[16]
                if alt_loc != ' ' and alt_loc != 'A':
                    continue
                res_name = line[17:20].strip().upper()
                chain = line[21].strip() or "A"
                res_seq = int(line[22:26].strip())
                ins_code = line[26].strip() if len(line) > 26 else ""

                key = (chain, res_seq, ins_code)
                if key not in residues:
                    residues[key] = {"atoms": {}, "res_name": res_name, "chain": chain}
                    ordered_keys.append(key)

                x = float(line[30:38].strip())
                y = float(line[38:46].strip())
                z = float(line[46:54].strip())

                if atom_name in ["N", "CA", "C", "CB"] and atom_name not in residues[key]["atoms"]:
                    residues[key]["atoms"][atom_name] = [x, y, z]
            except Exception:
                continue

    if not ordered_keys:
        return "#" * (expected_len if expected_len is not None else 1)

    target_chain = chain_id if chain_id else ordered_keys[0][0]
    chain_keys = [k for k in ordered_keys if k[0] == target_chain]
    if not chain_keys:
        chain_keys = ordered_keys

    pdb_seq = "".join(THREE_TO_ONE.get(residues[k]["res_name"], "X") for k in chain_keys)

    ca_coords = []
    cb_coords = []
    n_coords = []
    c_coords = []

    if target_seq:
        matcher = difflib.SequenceMatcher(None, target_seq.upper(), pdb_seq)
        matching_blocks = matcher.get_matching_blocks()
        target_to_pdb = {}
        for block in matching_blocks:
            for offset in range(block.size):
                target_to_pdb[block.a + offset] = block.b + offset

        for target_idx in range(len(target_seq)):
            pdb_idx = target_to_pdb.get(target_idx)
            if pdb_idx is not None and pdb_idx < len(chain_keys):
                res_key = chain_keys[pdb_idx]
                atoms = residues[res_key]["atoms"]
                ca_coords.append(atoms.get("CA", [nan_val, nan_val, nan_val]))
                cb_coords.append(atoms.get("CB", [nan_val, nan_val, nan_val]))
                n_coords.append(atoms.get("N", [nan_val, nan_val, nan_val]))
                c_coords.append(atoms.get("C", [nan_val, nan_val, nan_val]))
            else:
                ca_coords.append([nan_val, nan_val, nan_val])
                cb_coords.append([nan_val, nan_val, nan_val])
                n_coords.append([nan_val, nan_val, nan_val])
                c_coords.append([nan_val, nan_val, nan_val])
    else:
        n_res = expected_len if expected_len is not None else len(chain_keys)
        for i in range(n_res):
            if i < len(chain_keys):
                res_key = chain_keys[i]
                atoms = residues[res_key]["atoms"]
                ca_coords.append(atoms.get("CA", [nan_val, nan_val, nan_val]))
                cb_coords.append(atoms.get("CB", [nan_val, nan_val, nan_val]))
                n_coords.append(atoms.get("N", [nan_val, nan_val, nan_val]))
                c_coords.append(atoms.get("C", [nan_val, nan_val, nan_val]))
            else:
                ca_coords.append([nan_val, nan_val, nan_val])
                cb_coords.append([nan_val, nan_val, nan_val])
                n_coords.append([nan_val, nan_val, nan_val])
                c_coords.append([nan_val, nan_val, nan_val])

    total_len = len(ca_coords)
    try:
        encoder = mini3di.Encoder()
        states = encoder.encode_atoms(
            ca=np.array(ca_coords),
            cb=np.array(cb_coords),
            n=np.array(n_coords),
            c=np.array(c_coords)
        )
        raw_3di = encoder.build_sequence(states)

        result_chars = []
        for i in range(total_len):
            if np.isnan(ca_coords[i][0]) or np.isnan(n_coords[i][0]) or np.isnan(c_coords[i][0]):
                result_chars.append("#")
            elif i < len(raw_3di):
                result_chars.append(raw_3di[i])
            else:
                result_chars.append("#")
        return "".join(result_chars)
    except Exception as e:
        print(f"[Model Server Error] Foldseek 3Di encoding failed: {e}")
        return "#" * total_len

def compute_scientific_metrics(logits, pos_idx, wt_aa, mut_aa, vocab_map):
    aa_tokens = [vocab_map.get(aa, 3) for aa in AA_LIST]
    pos_logits = logits[pos_idx]
    standard_logits = torch.tensor([pos_logits[tok].item() for tok in aa_tokens])
    
    probs = torch.softmax(standard_logits, dim=-1)
    
    aa_probs = {AA_LIST[i]: probs[i].item() for i in range(len(AA_LIST))}
    wt_prob = aa_probs.get(wt_aa, 0.0)
    mut_prob = aa_probs.get(mut_aa, 0.0)
    
    llr = float(np.log(mut_prob + 1e-9) - np.log(wt_prob + 1e-9))
    
    preferences = [{"aa": aa, "prob": aa_probs[aa]} for aa in AA_LIST]
    preferences.sort(key=lambda x: x["prob"], reverse=True)
    
    sorted_aas = [p["aa"] for p in preferences]
    mut_rank = sorted_aas.index(mut_aa) + 1
    
    pos_entropy = -float(torch.sum(probs * torch.log2(probs + 1e-9)).item())
    
    return wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy
