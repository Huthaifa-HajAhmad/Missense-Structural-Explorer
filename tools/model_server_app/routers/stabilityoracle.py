import os
import math
import asyncio
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tools.model_server_app.utils import validate_missense_residues
from tools.model_server_app.stability_oracle_model import SiameseGraphormer

try:
    import torch
    HAS_TORCH = True
except ImportError:
    torch = None
    HAS_TORCH = False

router = APIRouter()

class StabilityOracleRequest(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    wtPdb: str | None = None
    chain: str | None = None

class StabilityOracleResponse(BaseModel):
    status: str
    ddG: float | None = None
    ddg: float | None = None
    isStabilizing: bool | None = None
    contacts: int | None = None
    contactsAnalyzed: int | None = None
    provenance: str | None = None
    error: str | None = None

AA_3TO1 = {
    "CYS": "C", "ASP": "D", "SER": "S", "GLN": "Q", "LYS": "K",
    "ILE": "I", "PRO": "P", "THR": "T", "PHE": "F", "ASN": "N",
    "GLY": "G", "HIS": "H", "LEU": "L", "ARG": "R", "TRP": "W",
    "ALA": "A", "VAL": "V", "GLU": "E", "TYR": "Y", "MET": "M"
}
AA_1TO3 = {v: k for k, v in AA_3TO1.items()}

AA_INDEX = {
    "ALA": 0, "ARG": 1, "ASN": 2, "ASP": 3, "CYS": 4, "GLU": 5, "GLN": 6, "GLY": 7, "HIS": 8, "ILE": 9,
    "LEU": 10, "LYS": 11, "MET": 12, "PHE": 13, "PRO": 14, "SER": 15, "THR": 16, "TRP": 17, "TYR": 18, "VAL": 19
}

ELEMENT_MAP = lambda x: {
    "H": 0, "C": 1, "N": 2, "O": 3, "F": 4, "S": 5, "P": 6, "CL": 7, "BR": 7, "I": 7
}.get(x.strip().upper(), 8)

RES_CHARGE = {
    "ARG": 1.0, "LYS": 1.0, "ASP": -1.0, "GLU": -1.0, "HIS": 0.1
}

class StabilityOracleArgs:
    debug = ""
    depth = 4
    return_idx = [3]
    use_clstoken = True
    clstoken_unify = False
    encoder_decoder = False
    out_prod = False
    freeze_backbone = False
    use_seq_info = False

def get_stability_oracle_model():
    from tools.model_server_app.models import loaded_models, _evict_if_needed, MAX_LOADED_MODELS, _model_lock
    model_key = "stability_oracle"
    with _model_lock:
        if model_key in loaded_models:
            loaded_models.move_to_end(model_key)
            return loaded_models[model_key][1]

        if not HAS_TORCH:
            raise RuntimeError("PyTorch is not available for StabilityOracle.")

        ckpt_path = os.path.join(os.path.dirname(__file__), "..", "checkpoints", "stability_oracle_cdna117k.pt")
        if not os.path.exists(ckpt_path):
            raise FileNotFoundError(f"StabilityOracle checkpoint not found at: {ckpt_path}")

        _evict_if_needed(MAX_LOADED_MODELS)

        print(f"[Model Server] Loading StabilityOracle model from: {ckpt_path}...")
        model = SiameseGraphormer(StabilityOracleArgs())
        ckpt = torch.load(ckpt_path, map_location="cpu")
        new_ckpt = {k.replace("module.", ""): v for k, v in ckpt.items()}
        model.load_state_dict(new_ckpt, strict=True)
        model.eval()
        print("[Model Server] StabilityOracle SiameseGraphormer loaded successfully (strict=True).")
        loaded_models[model_key] = (None, model)
        return model

def featurize_pdb_for_stability_oracle(
    pdb_content: str,
    position: int,
    wt: str,
    mut: str,
    max_atoms: int = 512,
    chain: str | None = None
):
    wt1 = wt.upper()
    mut1 = mut.upper()
    wt3 = AA_1TO3.get(wt1, wt1)
    mut3 = AA_1TO3.get(mut1, mut1)
    requested_chain = (chain or "").strip().upper()

    raw_atoms = []
    chains_seen = []

    for line in pdb_content.splitlines():
        if not line.startswith("ATOM  "):
            continue
        if len(line) < 54:
            continue
        alt_loc = line[16]
        if alt_loc not in (" ", "A", "1"):
            continue
        icode = line[26].strip()
        if icode:
            continue
        try:
            atom_name = line[12:16].strip()
            res_name = line[17:20].strip().upper()
            line_chain = (line[21].strip() or "A").upper()
            res_seq = int(line[22:26].strip())
            x = float(line[30:38].strip())
            y = float(line[38:46].strip())
            z = float(line[46:54].strip())
            element = line[76:78].strip() if len(line) >= 78 else atom_name[0]
            if not element:
                element = atom_name[0]
            if element.upper() == "H":
                continue

            if line_chain not in chains_seen:
                chains_seen.append(line_chain)

            charge = RES_CHARGE.get(res_name, 0.0)
            raw_atoms.append({
                "x": x, "y": y, "z": z,
                "chain": line_chain,
                "res_seq": res_seq,
                "res_name": res_name,
                "atom_name": atom_name,
                "element": element,
                "charge": charge,
            })
        except Exception:
            continue

    if not raw_atoms:
        raise ValueError("No valid protein ATOM records found in PDB structure.")

    if requested_chain and requested_chain in chains_seen:
        target_chain = requested_chain
    else:
        # Match chain holding the requested position if unique, else first chain
        matching_chains = sorted({a["chain"] for a in raw_atoms if a["res_seq"] == position})
        target_chain = matching_chains[0] if matching_chains else chains_seen[0]

    target_ca = None
    target_res_name = None
    for a in raw_atoms:
        is_target = (a["chain"] == target_chain and a["res_seq"] == position)
        a["is_target"] = is_target
        if is_target:
            if target_res_name is None:
                target_res_name = a["res_name"]
            if a["atom_name"] == "CA":
                target_ca = (a["x"], a["y"], a["z"])

    if target_ca is None:
        raise ValueError(f"Alpha carbon (CA) for position {position} on chain {target_chain} not found in PDB structure.")

    if target_res_name and wt3 in AA_INDEX and target_res_name != wt3:
        raise ValueError(
            f"Wild-type residue mismatch at position {position} on chain {target_chain}: "
            f"structure has {target_res_name}, expected {wt3} ({wt1})."
        )

    for a in raw_atoms:
        dx = a["x"] - target_ca[0]
        dy = a["y"] - target_ca[1]
        dz = a["z"] - target_ca[2]
        a["dist"] = math.sqrt(dx * dx + dy * dy + dz * dz)

    raw_atoms.sort(key=lambda a: a["dist"])
    selected_atoms = raw_atoms[:max_atoms]

    # Compute geometric solvent accessibility proxy from 3D heavy-atom packing around each selected atom
    # (never from column 61-66, which holds pLDDT on AlphaFold models and B-factors on crystals).
    env_atoms = [a for a in raw_atoms if a["dist"] <= 22.0]
    env_coords = np.array([[a["x"], a["y"], a["z"]] for a in env_atoms], dtype=np.float32)
    env_res_keys = [(a["chain"], a["res_seq"]) for a in env_atoms]

    for a in selected_atoms:
        if len(env_atoms) <= 1:
            a["sasa"] = 30.0
            continue
        ax, ay, az = a["x"], a["y"], a["z"]
        d2 = (
            (env_coords[:, 0] - ax) ** 2
            + (env_coords[:, 1] - ay) ** 2
            + (env_coords[:, 2] - az) ** 2
        )
        self_key = (a["chain"], a["res_seq"])
        neighbor_count = sum(
            1 for idx, dist_sq in enumerate(d2)
            if dist_sq <= 64.0 and env_res_keys[idx] != self_key
        )
        sasa_est = 30.0 * math.exp(-float(neighbor_count) / 18.0)
        a["sasa"] = min(max(sasa_est, 0.0), 30.0)

    coords_tensor = torch.zeros([1, max_atoms, 3], dtype=torch.float32)
    atom_types_tensor = torch.zeros([1, max_atoms], dtype=torch.long)
    pp_tensor = torch.zeros([1, max_atoms, 2], dtype=torch.float32)
    mask_tensor = torch.zeros([1, max_atoms], dtype=torch.float32)

    for i, a in enumerate(selected_atoms):
        coords_tensor[0, i, 0] = a["x"]
        coords_tensor[0, i, 1] = a["y"]
        coords_tensor[0, i, 2] = a["z"]
        atom_types_tensor[0, i] = ELEMENT_MAP(a["element"])
        pp_tensor[0, i, 0] = a["charge"]
        pp_tensor[0, i, 1] = a["sasa"]
        mask_tensor[0, i] = 1.0

    ca_tensor = torch.tensor([[target_ca[0], target_ca[1], target_ca[2]]], dtype=torch.float32)
    wt_idx = AA_INDEX.get(wt3, 0)
    mut_idx = AA_INDEX.get(mut3, 0)
    aa_feats = torch.tensor([[wt_idx, mut_idx]], dtype=torch.long)

    contacts = sum(1 for a in selected_atoms if a["dist"] <= 10.0 and not a["is_target"])
    return coords_tensor, atom_types_tensor, pp_tensor, ca_tensor, mask_tensor, aa_feats, contacts

def predict_stabilityoracle_sync(req: StabilityOracleRequest):
    validate_missense_residues(req.wt, req.mut)

    if not req.wtPdb:
        raise HTTPException(
            status_code=400,
            detail="StabilityOracle requires an active wild-type 3D structure (wtPdb). None was provided."
        )

    try:
        model = get_stability_oracle_model()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"StabilityOracle model initialization failed: {e}"
        )

    try:
        coords, atom_types, pp, ca, mask, aa_feats, contacts = featurize_pdb_for_stability_oracle(
            req.wtPdb, req.position, req.wt, req.mut, chain=req.chain
        )
    except ValueError as ve:
        status_code = 422 if "mismatch" in str(ve).lower() or "not found" in str(ve).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(ve))
    except Exception as fe:
        raise HTTPException(status_code=500, detail=f"PDB featurization failed: {fe}")

    try:
        with torch.inference_mode():
            pred, _ = model([None], atom_types, pp, coords, ca, mask, aa_feats)
            raw_ddg = float(pred.item())

        return {
            "status": "success",
            "ddG": round(raw_ddg, 4),
            "ddg": round(raw_ddg, 4),
            "isStabilizing": raw_ddg < -0.5,
            "contacts": contacts,
            "contactsAnalyzed": contacts,
            "provenance": "Stability Oracle (Diaz et al. 2024 - Graph Transformer)"
        }
    except Exception as ie:
        raise HTTPException(status_code=500, detail=f"StabilityOracle inference failed: {ie}")

@router.post("/predict/stabilityoracle", response_model=StabilityOracleResponse)
async def predict_stabilityoracle(req: StabilityOracleRequest):
    return await asyncio.to_thread(predict_stabilityoracle_sync, req)
