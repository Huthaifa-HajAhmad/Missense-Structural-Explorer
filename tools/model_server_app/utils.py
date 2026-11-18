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
