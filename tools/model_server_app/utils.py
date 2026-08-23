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

def encode_pdb_to_3di(pdb_content: str, seq_len: int = None, start_idx: int = 1) -> str:
    try:
        import mini3di
    except ImportError:
        print("[Model Server Warning] mini3di library not available. Using structure-masked fallback.")
        return "#" * (seq_len if seq_len is not None else 1)

    residues = {}
    for line in pdb_content.splitlines():
        if line.startswith("ATOM  ") or line.startswith("HETATM"):
            try:
                atom_name = line[12:16].strip()
                res_seq = int(line[22:26].strip())
                alt_loc = line[16]
                if alt_loc != ' ' and alt_loc != 'A':
                    continue
                x = float(line[30:38].strip())
                y = float(line[38:46].strip())
                z = float(line[46:54].strip())
                
                if res_seq not in residues:
                    residues[res_seq] = {}
                if atom_name in ["N", "CA", "C", "CB"] and atom_name not in residues[res_seq]:
                    residues[res_seq][atom_name] = [x, y, z]
            except Exception:
                continue

    sorted_res_seqs = sorted(residues.keys())
    if not sorted_res_seqs:
        return "#" * (seq_len if seq_len is not None else 1)

    min_seq = sorted_res_seqs[0]
    max_seq = sorted_res_seqs[-1]
    
    length = seq_len if seq_len is not None else (max_seq - min_seq + 1)
    offset = start_idx - 1
    
    ca_coords = []
    cb_coords = []
    n_coords = []
    c_coords = []
    
    nan_val = float("nan")
    for i in range(1, length + 1):
        res_idx = i + offset
        res = residues.get(res_idx, {})
        ca_coords.append(res.get("CA", [nan_val, nan_val, nan_val]))
        cb_coords.append(res.get("CB", [nan_val, nan_val, nan_val]))
        n_coords.append(res.get("N", [nan_val, nan_val, nan_val]))
        c_coords.append(res.get("C", [nan_val, nan_val, nan_val]))

    try:
        encoder = mini3di.Encoder()
        states = encoder.encode_atoms(
            ca=np.array(ca_coords),
            cb=np.array(cb_coords),
            n=np.array(n_coords),
            c=np.array(c_coords)
        )
        return encoder.build_sequence(states)
    except Exception as e:
        print(f"[Model Server Error] Foldseek 3Di encoding failed: {e}")
        return "#" * length

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
