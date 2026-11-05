import os
import sys
import re
import tempfile
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

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
    import numpy as np
    import torch
    import torch.nn as nn
    from transfer_model import TransferModel
    HAS_TORCH = True
except ImportError as e:
    HAS_TORCH = False
    _import_err = str(e)

def parse_pdb_chains_for_thermompnn(
    pdb_file_path: str,
    atoms: list[str] = ['N', 'CA', 'C', 'O']
):
    """
    Parses EVERY chain, each in the exact per-chain shape the official
    ``protein_mpnn_utils.parse_PDB`` produces (contiguous 0-based numbering, '-' for
    unmodelled residues with NaN coordinates — the data semantics the Kuhlman-Lab
    ThermoMPNN weights were trained under), so ProteinMPNN's neighbor featurization sees
    all chains of a complex instead of the mutated chain alone. Interface residues lose
    their partner-chain contacts without this, which mis-scores them.

    Returns (chains, chain_order):
      chains: dict letter -> {"seq": list of one-letter codes padded per the official parser,
                              "resn_index": {(resn key: str or int) -> local sequence index},
                              "min_resn": int, "max_resn": int}
      chain_order: first-appearance order; ``tied_featurize`` concatenates chains in
                   per-chain key insertion order, so this is the model's global sequence order.
    'span_too_large' replaces the dict when padded residue count would be absurd.
    """
    alpha_1 = list("ARNDCQEGHILKMFPSTWYV-")
    alpha_3 = ['ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
               'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL', 'GAP']
    aa_3_N = {b: a for a, b in enumerate(alpha_3)}
    aa_N_1 = {a: b for a, b in enumerate(alpha_1)}

    raw_by_chain: dict = {}
    chain_order: list[str] = []
    with open(pdb_file_path, "rb") as f:
        for line in f:
            line = line.decode("utf-8", "ignore").rstrip()

            if line[:6] == "ENDMDL":
                break  # An NMR file holds many models. Only the first is the structure.

            if line[:6] == "HETATM" and line[17:20] == "MSE":
                line = "ATOM  " + line[6:17] + "MET" + line[20:]

            if line[:4] != "ATOM":
                continue
            if len(line) > 16 and line[16] not in (" ", "A", "1"):
                continue

            ch = (line[21:22].strip() or "A").upper()
            if ch not in raw_by_chain:
                raw_by_chain[ch] = {"xyz": {}, "seq": {}, "min_resn": 1000000, "max_resn": -1000000}
                chain_order.append(ch)

            raw = raw_by_chain[ch]
            atom = line[12:16].strip()
            resi = line[17:20].strip()
            raw_resn = line[22:27].strip()
            if not raw_resn:
                continue

            try:
                x_coord = float(line[30:38])
                y_coord = float(line[38:46])
                z_coord = float(line[46:54])
            except (ValueError, IndexError):
                continue

            try:
                if raw_resn[-1].isalpha():
                    resa, res_num = raw_resn[-1], int(raw_resn[:-1]) - 1
                else:
                    resa, res_num = "", int(raw_resn) - 1
            except (ValueError, IndexError):
                continue

            if res_num < raw["min_resn"]:
                raw["min_resn"] = res_num
            if res_num > raw["max_resn"]:
                raw["max_resn"] = res_num

            if res_num not in raw["xyz"]:
                raw["xyz"][res_num] = {}
            if resa not in raw["xyz"][res_num]:
                raw["xyz"][res_num][resa] = {}
            if res_num not in raw["seq"]:
                raw["seq"][res_num] = {}
            if resa not in raw["seq"][res_num]:
                raw["seq"][res_num][resa] = resi

            if atom not in raw["xyz"][res_num][resa]:
                raw["xyz"][res_num][resa][atom] = np.array([x_coord, y_coord, z_coord])

    if not chain_order or all(raw["min_resn"] > raw["max_resn"] for raw in raw_by_chain.values()):
        return {}, []

    # Guard against denial-of-service via massive non-contiguous numbering spans.
    total_padded = sum(raw["max_resn"] - raw["min_resn"] + 1 for raw in raw_by_chain.values())
    if total_padded > 12000:
        return 'span_too_large', []

    chains: dict = {}
    for ch in chain_order:
        raw = raw_by_chain[ch]
        seq_: list = []
        xyz_N: list = []
        xyz_CA: list = []
        xyz_C: list = []
        xyz_O: list = []
        resn_index: dict = {}
        for resn in range(raw["min_resn"], raw["max_resn"] + 1):
            keys = sorted(raw["seq"][resn]) if resn in raw["seq"] else None
            if keys is None:
                # Unmodelled residue: '-' in the sequence, NaN coordinates — the official
                # parser's padding, which means the rows above stay mutually aligned.
                seq_.append(20)
                for sink in (xyz_N, xyz_CA, xyz_C, xyz_O):
                    sink.append(np.full(3, np.nan))
                continue
            for k in keys:
                res_1based = resn + 1
                curr_idx = len(seq_)
                resn_index[str(res_1based) + k] = curr_idx
                if not k:
                    resn_index[str(res_1based)] = curr_idx
                    resn_index[res_1based] = curr_idx
                seq_.append(aa_3_N.get(raw["seq"][resn][k], 20))
                # Coordinates stay row-aligned with the sequence: one row per (residue,
                # insertion code), NaN where the official parser would have had none.
                coords = raw["xyz"].get(resn, {}).get(k, {})
                for atom, sink in (("N", xyz_N), ("CA", xyz_CA), ("C", xyz_C), ("O", xyz_O)):
                    sink.append(coords.get(atom, np.full(3, np.nan)))
        chains[ch] = {
            "seq": ["".join([aa_N_1.get(a, "-") for a in seq_])],
            "resn_index": resn_index,
            "min_resn": raw["min_resn"],
            "max_resn": raw["max_resn"],
            "xyz": {"N": xyz_N, "CA": xyz_CA, "C": xyz_C, "O": xyz_O},
            "length": len(seq_),
        }
    return chains, chain_order


def select_thermompnn_target_chain(chains: dict, chain_order: list[str], chain: Optional[str], target_pos: Optional[int]) -> Optional[str]:
    """
    Chooses the chain holding the mutation. An explicitly requested chain wins when present;
    without one (or when the requested letter does not exist in this file), the chain that
    actually carries the residue decides, and the first chain is the last resort — the same
    precedence ``stabilityoracle.py`` uses, so the two sidecars never disagree on "the chain".
    """
    explicit = (chain or "").strip().upper()
    if explicit and explicit in chains:
        return explicit
    if target_pos is not None:
        matching = [ch for ch in chain_order if str(target_pos) in chains[ch]["resn_index"]]
        if len(matching) == 1:
            return matching[0]
        if len(matching) > 1:
            return matching[0]
    if chain_order:
        return chain_order[0]
    return None

router = APIRouter()

class ThermoMpnnRequest(BaseModel):
    pdb: str | None = None
    pdb_content: str | None = None
    mutation: str  # e.g., "RA408W", "A:R408W", or "R408W"
    chain: str | None = None

class ThermoMpnnResponse(BaseModel):
    status: str
    ddG: float | None = None
    isStabilizing: bool | None = None
    mutation: str | None = None
    contactsAnalyzed: int | None = None
    provenance: str | None = None
    error: str | None = None

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
            # The published model has this attention layer: upstream's config.yaml and custom_inference.py set it,
            # and its checkpoint holds its weights. Without it the model runs with a layer missing and gives
            # near-constant values (SD 0.19 kcal/mol on S669).
            'lightattn': True,
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

        # Every tensor must match, both ways. A partial match here once dropped a whole layer without any error.
        model_dict = model.state_dict()
        matched = sum(
            1 for k in clean_state.keys()
            if k in model_dict and model_dict[k].shape == clean_state[k].shape
        )
        if matched != len(model_dict) or matched != len(clean_state):
            unused = sorted(set(clean_state) - set(model_dict))[:3]
            absent = sorted(set(model_dict) - set(clean_state))[:3]
            _model_load_error = (
                f"Official checkpoint does not match the model: {matched} tensors matched of "
                f"{len(model_dict)} in the model and {len(clean_state)} in the checkpoint "
                f"(not in the model: {unused}; not in the checkpoint: {absent})."
            )
            print(f"[ThermoMPNN Guard] {_model_load_error}")
            return None

        model.load_state_dict(clean_state, strict=True)
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

    # Write temporary PDB file for coordinate & wild-type validation before model execution
    with tempfile.NamedTemporaryFile(suffix=".pdb", mode="w", delete=False) as tmp_pdb:
        tmp_pdb.write(pdb_raw)
        tmp_pdb_path = tmp_pdb.name

    try:
        backbone_atoms = ['N', 'CA', 'C', 'O']
        chains, chain_order = parse_pdb_chains_for_thermompnn(tmp_pdb_path, atoms=backbone_atoms)

        if chains == 'span_too_large':
            raise HTTPException(status_code=400, detail="Residue numbering span exceeds maximum supported length (12000)")

        if not chains:
            raise HTTPException(status_code=400, detail="Could not extract coordinates from PDB structure")

        resolved_chain = select_thermompnn_target_chain(chains, chain_order, chain, pos)
        if resolved_chain is None:
            raise HTTPException(status_code=400, detail="Could not extract coordinates from PDB structure")

        # Locate the residue within its chain's sequence (index synchronized with the chain's
        # coordinates, same mapping the official parser produces).
        target_chain = chains[resolved_chain]
        target_seq_idx = target_chain["resn_index"].get(str(pos))
        if target_seq_idx is None:
            target_seq_idx = target_chain["resn_index"].get(pos)

        if target_seq_idx is None:
            raise HTTPException(
                status_code=422,
                detail=f"Residue position {pos} is not resolved or has missing coordinates in the structure"
            )

        parsed_wt = target_chain["seq"][0][target_seq_idx]
        if parsed_wt == '-':
            raise HTTPException(
                status_code=422,
                detail=f"Residue position {pos} is in an unmodeled gap / missing coordinate region"
            )

        if wt and parsed_wt != wt:
            raise HTTPException(
                status_code=422,
                detail=f"Wild-type residue mismatch at position {pos} on chain {resolved_chain or chain or 'A'}: structure has {parsed_wt}, expected {wt}"
            )

        model = get_official_model()
        if model is None:
            err_msg = _model_load_error or "Official ThermoMPNN model could not be loaded."
            raise HTTPException(
                status_code=503,
                detail=f"ThermoMPNN engine unavailable: {err_msg}. No heuristic fallbacks are permitted."
            )

        chain_id = resolved_chain or chain or 'A'

        # Build the parsed PDB dictionary the official ProteinMPNN `tied_featurize` expects:
        # every chain of the complex in PDB order (per-chain keys feed the concatenation
        # order), so the model's neighbor features see cross-chain contacts.
        parsed_pdb_dict = {
            'name': 'query_struct',
            'num_of_chains': len(chain_order),
            # tied_featurize sizes the batch from this concatenated sequence, exactly as
            # the official parse_PDB writes it.
            'seq': ''.join(chains[c]["seq"][0] for c in chain_order),
        }
        for c in chain_order:
            d = chains[c]
            parsed_pdb_dict['seq_chain_' + c] = d["seq"][0]
            parsed_pdb_dict['coords_chain_' + c] = {
                'N_chain_' + c: [np.asarray(v, dtype=float).tolist() for v in d["xyz"]["N"]],
                'CA_chain_' + c: [np.asarray(v, dtype=float).tolist() for v in d["xyz"]["CA"]],
                'C_chain_' + c: [np.asarray(v, dtype=float).tolist() for v in d["xyz"]["C"]],
                'O_chain_' + c: [np.asarray(v, dtype=float).tolist() for v in d["xyz"]["O"]],
            }

        # `mut.position` indexes ThermoMPNN's FULL concatenated sequence: offset of this chain
        # in the concatenation order, plus the residue's index inside its own chain.
        target_global_idx = sum(chains[c]["length"] for c in chain_order[:chain_order.index(chain_id)]) + target_seq_idx

        mutation_obj = Mutation(
            position=target_global_idx,
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
            "contactsAnalyzed": sum(chains[c]["length"] for c in chain_order),
            "provenance": "ThermoMPNN (Official Kuhlman-Lab Model & Weights)"
        }
    finally:
        if os.path.exists(tmp_pdb_path):
            try:
                os.remove(tmp_pdb_path)
            except OSError:
                pass

@router.post("/predict/thermompnn", response_model=ThermoMpnnResponse)
@router.post("/models/thermompnn/predict", response_model=ThermoMpnnResponse)
async def predict_thermompnn(req: ThermoMpnnRequest):
    return await asyncio.to_thread(predict_thermompnn_sync, req)
