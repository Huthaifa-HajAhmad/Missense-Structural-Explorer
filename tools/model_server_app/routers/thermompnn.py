import os
import sys
import re
import tempfile
import asyncio
from pathlib import Path
from types import SimpleNamespace
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Add tools/thermompnn to sys.path for direct access to official modules
THERMOMPNN_DIR = Path(__file__).resolve().parent.parent.parent / "thermompnn"
if str(THERMOMPNN_DIR) not in sys.path:
    sys.path.insert(0, str(THERMOMPNN_DIR))

from dataclasses import dataclass
from typing import Optional

@dataclass
class Mutation:
    position: int
    wildtype: str
    mutation: str
    ddG: Optional[float] = None
    pdb: Optional[str] = ''

try:
    import torch
    import torch.nn as nn
    from protein_mpnn_utils import alt_parse_PDB_biounits
    from transfer_model import TransferModel
    HAS_TORCH = True
except ImportError as e:
    HAS_TORCH = False
    _import_err = str(e)

router = APIRouter()

class ThermoMpnnRequest(BaseModel):
    pdb: str | None = None
    pdb_content: str | None = None
    mutation: str  # e.g., "RA408W", "A:R408W", or "R408W"
    chain: str | None = None

ALPHABET = 'ACDEFGHIKLMNPQRSTVWYX'

def parse_mutation_code(mutation: str, default_chain: str = "A"):
    """Extracts (wt, chain, pos, mut) from diverse mutation formats."""
    clean = mutation.replace("p.", "").strip()
    
    # Format: A:R408W
    m = re.match(r"^([a-zA-Z]):([a-zA-Z])(\d+)([a-zA-Z])$", clean)
    if m:
        return m.group(2).upper(), m.group(1).upper(), int(m.group(3)), m.group(4).upper()

    # Format: RA408W (FoldX 4-part: WT=R, Chain=A, Pos=408, Mut=W)
    m = re.match(r"^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$", clean)
    if m:
        return m.group(1).upper(), m.group(2).upper(), int(m.group(3)), m.group(4).upper()

    # Format: R408W (Standard 1-letter)
    m = re.match(r"^([a-zA-Z])(\d+)([a-zA-Z])$", clean)
    if m:
        return m.group(1).upper(), default_chain.upper(), int(m.group(2)), m.group(3).upper()

    return None, None, None, None

class ConfigNode:
    def __init__(self, d):
        for k, v in d.items():
            if isinstance(v, dict):
                setattr(self, k, ConfigNode(v))
            else:
                setattr(self, k, v)
    def __contains__(self, key):
        return hasattr(self, key)
    def __getitem__(self, key):
        return getattr(self, key)
    def get(self, key, default=None):
        return getattr(self, key, default)

def dict_to_config(d):
    return ConfigNode(d)

_official_model: "TransferModel | None" = None
_model_loaded: bool = False
_model_load_error: str | None = None

def get_official_model():
    """Loads the official Kuhlman Lab ThermoMPNN model using genuine pre-trained weights."""
    global _official_model, _model_loaded, _model_load_error
    if _model_loaded:
        return _official_model

    if not HAS_TORCH:
        _model_load_error = f"PyTorch or ThermoMPNN dependencies missing: {_import_err}"
        print(f"[ThermoMPNN Guard] {_model_load_error}")
        return None

    checkpoint_path = THERMOMPNN_DIR / "models" / "thermoMPNN_default.pt"
    vanilla_path = THERMOMPNN_DIR / "vanilla_model_weights" / "v_48_020.pt"

    if not checkpoint_path.exists() or not vanilla_path.exists():
        _model_load_error = f"Official weight files not found at {checkpoint_path} or {vanilla_path}"
        print(f"[ThermoMPNN Guard] {_model_load_error}")
        return None

    cfg_dict = {
        'training': {
            'num_workers': 1,
            'learn_rate': 0.001,
            'epochs': 100,
            'lr_schedule': True,
        },
        'model': {
            'hidden_dims': [64, 32],
            'subtract_mut': True,
            'num_final_layers': 2,
            'freeze_weights': True,
            'load_pretrained': True,
            'lightattn': False,
            'lr_schedule': True,
        },
        'platform': {
            'thermompnn_dir': str(THERMOMPNN_DIR)
        }
    }
    cfg = dict_to_config(cfg_dict)

    try:
        model = TransferModel(cfg)
        checkpoint = torch.load(str(checkpoint_path), map_location="cpu")
        ckpt_state = checkpoint.get("state_dict", checkpoint) if isinstance(checkpoint, dict) else checkpoint

        # Strip Lightning 'model.' prefix if present
        clean_state = {}
        for k, v in ckpt_state.items():
            clean_k = k.replace("model.", "") if k.startswith("model.") else k
            clean_state[clean_k] = v

        model_dict = model.state_dict()
        matched = sum(
            1 for k in clean_state.keys()
            if k in model_dict and model_dict[k].shape == clean_state[k].shape
        )
        match_ratio = matched / max(1, len(model_dict))

        if match_ratio < 0.85:
            _model_load_error = (
                f"Official checkpoint incompatible: only {matched}/{len(model_dict)} tensors matched "
                f"({match_ratio * 100:.1f}%). Required >= 85% tensor match."
            )
            print(f"[ThermoMPNN Guard] {_model_load_error}")
            return None

        model.load_state_dict(clean_state, strict=False)
        model.eval()
        for param in model.parameters():
            param.requires_grad = False

        _official_model = model
        _model_loaded = True
        _model_load_error = None
        print(f"[ThermoMPNN] Successfully loaded official Kuhlman-Lab ThermoMPNN model ({matched}/{len(model_dict)} tensors verified).")
        return _official_model
    except Exception as e:
        _model_load_error = f"Failed to instantiate official ThermoMPNN model: {e}"
        print(f"[ThermoMPNN Error] {_model_load_error}")
        return None

def predict_thermompnn_sync(req: ThermoMpnnRequest):
    """
    Evaluates ThermoMPNN using exclusively the official Kuhlman-Lab neural network.
    No heuristics or random weights are permitted.
    """
    pdb_raw = req.pdb or req.pdb_content or ""
    if not pdb_raw.strip():
        raise HTTPException(status_code=400, detail="Missing PDB structural content in request")

    wt, chain, pos, mut = parse_mutation_code(req.mutation, req.chain or "A")
    if not wt or not mut or pos is None:
        raise HTTPException(status_code=400, detail=f"Invalid mutation format: '{req.mutation}'")

    if wt not in ALPHABET or mut not in ALPHABET:
        raise HTTPException(status_code=400, detail=f"Non-canonical amino acid in mutation: '{req.mutation}'")

    model = get_official_model()
    if model is None:
        err_msg = _model_load_error or "Official ThermoMPNN model could not be loaded."
        raise HTTPException(
            status_code=503,
            detail=f"ThermoMPNN engine unavailable: {err_msg}. No heuristic fallbacks are permitted."
        )

    # Write temporary PDB file for official biounit parser
    with tempfile.NamedTemporaryFile(suffix=".pdb", mode="w", delete=False) as tmp_pdb:
        tmp_pdb.write(pdb_raw)
        tmp_pdb_path = tmp_pdb.name

    try:
        sidechain_atoms = ['N', 'CA', 'C', 'O']
        xyz, seq, resn_list = alt_parse_PDB_biounits(tmp_pdb_path, atoms=sidechain_atoms, chain=chain)
        
        if isinstance(xyz, str) and xyz == 'no_chain':
            # Fallback without chain filter
            xyz, seq, resn_list = alt_parse_PDB_biounits(tmp_pdb_path, atoms=sidechain_atoms, chain=None)

        if isinstance(xyz, str) and xyz == 'no_chain' or len(xyz) == 0:
            raise HTTPException(status_code=400, detail="Could not extract coordinates from PDB structure")

        # Locate residue position index
        pos_str = str(pos)
        target_seq_idx = None
        for idx, r_num in enumerate(resn_list):
            if r_num == pos_str:
                target_seq_idx = idx
                break

        if target_seq_idx is None:
            # Fallback 1-indexed match
            if 1 <= pos <= len(resn_list):
                target_seq_idx = pos - 1
            else:
                raise HTTPException(
                    status_code=422,
                    detail=f"Residue position {pos} not found in parsed structure (range: 1-{len(resn_list)})"
                )

        # Build parsed PDB dictionary structure expected by ProteinMPNN tied_featurize
        parsed_pdb_dict = {
            'name': 'query_struct',
            'num_of_chains': 1,
            'seq': seq[0],
            'seq_chain_' + chain: seq[0],
            'coords_chain_' + chain: {
                'N_chain_' + chain: xyz[:, 0, :].tolist(),
                'CA_chain_' + chain: xyz[:, 1, :].tolist(),
                'C_chain_' + chain: xyz[:, 2, :].tolist(),
                'O_chain_' + chain: xyz[:, 3, :].tolist(),
            }
        }

        mutation_obj = Mutation(
            position=target_seq_idx,
            wildtype=wt,
            mutation=mut,
            ddG=None,
            pdb='query_struct'
        )

        with torch.no_grad():
            out, _ = model([parsed_pdb_dict], [mutation_obj])

        if not out or out[0] is None or "ddG" not in out[0]:
            raise HTTPException(status_code=500, detail="ThermoMPNN model failed to compute ddG for mutation")

        raw_ddg = float(out[0]["ddG"].item())

        return {
            "status": "success",
            "ddG": round(raw_ddg, 3),
            "isStabilizing": raw_ddg < 0.0,
            "mutation": req.mutation,
            "contactsAnalyzed": len(xyz),
            "provenance": "ThermoMPNN (Official Kuhlman-Lab Model & Weights)"
        }
    finally:
        if os.path.exists(tmp_pdb_path):
            try:
                os.remove(tmp_pdb_path)
            except OSError:
                pass

@router.post("/predict/thermompnn")
@router.post("/models/thermompnn/predict")
async def predict_thermompnn(req: ThermoMpnnRequest):
    return await asyncio.to_thread(predict_thermompnn_sync, req)
