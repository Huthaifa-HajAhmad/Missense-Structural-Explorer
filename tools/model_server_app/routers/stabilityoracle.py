import os
import sys
import json
import math
import time
import asyncio
import functools
import hashlib
import importlib.util
import subprocess
import tempfile
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy.spatial import cKDTree
from tools.model_server_app import models
from tools.model_server_app.engine_resilience import GateDeadlineExceeded, SingleFlightCache, request_deadline
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

# The inputs the model was trained on: atoms within this distance of the variant's alpha carbon, without the variant residue.
ENVIRONMENT_RADIUS_A = 10.0
PROBE_RADIUS_A = 1.4
HYDROGEN_PARENT_MAX_A = 1.3
FALLBACK_HYDROGEN_CHARGE = 0.07
FALLBACK_RADIUS_A = 1.7

PDB2PQR_LIMIT_S = 180.0


@functools.lru_cache(maxsize=1)
def _input_tables() -> dict:
    """
    The charge and radius tables, read on first use. A missing or damaged file stops this engine with a clear message.

    This router is imported at server start, so reading the file at import would stop every engine. Empty tables would be
    worse: every charge would silently become 0 and the model would still answer.
    """
    with open(os.path.join(os.path.dirname(__file__), "..", "data", "stability_oracle_inputs.json"), encoding="utf-8") as fh:
        tables = json.load(fh)
    for name in ("heavyCharge", "hydrogenChargeByName", "hydrogenChargeByParent", "radius"):
        if not tables.get(name):
            raise ValueError(f"The StabilityOracle input tables are damaged: '{name}' is missing or empty.")
    return tables


# Adding hydrogens and measuring exposure take about a second, once per chain. Variants on one chain share the result.
_prepared_chains = SingleFlightCache(max_entries=8)


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

def _read_chain_atoms(pdb_content: str, chain: str | None):
    """Protein atoms of the first model, the chain to score, and the first-model chains seen."""
    atoms = []
    for line in pdb_content.splitlines():
        if line.startswith("ENDMDL"):
            break  # An NMR file holds many models. Reading them all stacks copies of the chain on top of each other.
        if not line.startswith("ATOM  ") or len(line) < 54 or line[16] not in (" ", "A", "1") or line[26].strip():
            continue
        name = line[12:16].strip()
        element = line[76:78].strip() if len(line) >= 78 and line[76:78].strip() else name.lstrip("0123456789")[0]
        if element.upper() == "H":
            continue
        atoms.append({"line": line, "chain": (line[21].strip() or "A").upper(), "res_seq": int(line[22:26]), "res_name": line[17:20].strip().upper(), "name": name})
    return atoms


def _shrake_rupley_areas(xyz: np.ndarray, radii: np.ndarray) -> np.ndarray:
    """Solvent-exposed area of each atom: the share of points on its surface that no neighbouring atom covers."""
    count = 100
    golden = math.pi * (3 - math.sqrt(5))
    heights = 1 - 2 * (np.arange(count) + 0.5) / count
    rings = np.sqrt(1 - heights ** 2)
    sphere = np.stack([np.cos(golden * np.arange(count)) * rings, heights, np.sin(golden * np.arange(count)) * rings], axis=1)
    expanded = radii + PROBE_RADIUS_A
    tree = cKDTree(xyz)
    areas = np.zeros(len(xyz))
    for i, neighbours in enumerate(tree.query_ball_point(xyz, r=expanded + expanded.max())):
        points = xyz[i] + sphere * expanded[i]
        others = [j for j in neighbours if j != i]
        free = np.ones(count, dtype=bool)
        if others:
            distances = np.linalg.norm(points[:, None, :] - xyz[others][None, :, :], axis=2)
            free = ~(distances < expanded[others]).any(axis=1)
        areas[i] = 4 * math.pi * expanded[i] ** 2 * free.mean()
    return areas


def _prepare_chain(chain_pdb_text: str):
    """
    Hydrogens from PDB2PQR, the charge of every atom, and the exposure of heavy atoms, for the given chains.

    Chains PDB2PQR refuses come back as {"refused": reason}, so the refusal is cached like any other result: the same chains
    fail the same way, and every variant on them would otherwise repeat the attempt.
    """
    limit = request_deadline.get()
    allowed_s = PDB2PQR_LIMIT_S if limit is None else min(PDB2PQR_LIMIT_S, max(0.0, limit - time.monotonic()))
    with tempfile.TemporaryDirectory() as folder:
        source, output = os.path.join(folder, "chain.pdb"), os.path.join(folder, "chain.pqr")
        with open(source, "w", newline="\n") as fh:
            fh.write(chain_pdb_text)
        # --noopt --nodebump: place hydrogens without moving anything else. The default run hangs on some chains.
        try:
            done = subprocess.run(
                [sys.executable, "-m", "pdb2pqr", "--ff=AMBER", "--noopt", "--nodebump", "--keep-chain", "--drop-water", source, output],
                capture_output=True, text=True, timeout=allowed_s,
            )
        except subprocess.TimeoutExpired as expired:
            # Out of time says nothing about the chain, so this is a busy answer that is not kept.
            raise GateDeadlineExceeded("PDB2PQR did not finish before the caller's deadline.") from expired
        if done.returncode != 0 or not os.path.exists(output):
            return {"refused": "PDB2PQR could not add hydrogens to this chain, so StabilityOracle cannot score it."}
        with open(output, encoding="utf-8") as fh:
            lines = [line for line in fh if line.startswith("ATOM")]

    names, res_names, res_seqs, chains, elements = [], [], [], [], []
    xyz = np.zeros((len(lines), 3))
    for i, line in enumerate(lines):
        name = line[12:16].strip()
        bare = name.lstrip("0123456789")
        names.append(name)
        res_names.append(line[17:20].strip())
        res_seqs.append(int(line[22:26]))
        chains.append((line[21].strip() or "A").upper())
        elements.append("H" if bare.startswith("H") else bare[0])
        xyz[i] = [float(line[30:38]), float(line[38:46]), float(line[46:54])]

    tables = _input_tables()
    heavy = np.array([i for i, el in enumerate(elements) if el != "H"])
    radii = np.array([tables["radius"].get(f"{res_names[i]} {names[i]}", FALLBACK_RADIUS_A) for i in heavy])
    exposure = np.zeros(len(lines))
    exposure[heavy] = _shrake_rupley_areas(xyz[heavy], radii)

    charge = np.zeros(len(lines))
    parents = cKDTree(xyz[heavy])
    for i in range(len(lines)):
        if elements[i] != "H":
            charge[i] = tables["heavyCharge"].get(f"{res_names[i]} {names[i]}", 0.0)
            continue
        by_name = tables["hydrogenChargeByName"].get(f"{res_names[i]} {names[i]}")
        if by_name is not None:
            charge[i] = by_name
            continue
        distance, nearest = parents.query(xyz[i])
        parent = heavy[nearest]
        charge[i] = tables["hydrogenChargeByParent"].get(f"{res_names[parent]} {names[parent]}", FALLBACK_HYDROGEN_CHARGE) if distance <= HYDROGEN_PARENT_MAX_A else FALLBACK_HYDROGEN_CHARGE
    return {"xyz": xyz, "names": names, "res_seqs": np.array(res_seqs), "chains": np.array(chains), "elements": elements, "charge": charge, "exposure": exposure}


def featurize_pdb_for_stability_oracle(
    pdb_content: str,
    position: int,
    wt: str,
    mut: str,
    max_atoms: int = 512,
    chain: str | None = None
):
    """
    The model's inputs for one variant, built from a PDB file.

    The authors' pipeline is not published as code, so this follows what their published inputs show: the chain and any partner
    touching the site, hydrogens present, atoms within 10 A of the variant's alpha carbon without the variant residue, and a charge and a solvent exposure
    per atom. Against their published predictions this reaches r 0.88 on proteins never used in this work, not an exact match: their charge method is not identified. See doc/STABILITY_ORACLE_INPUTS_RESEARCH.md.
    """
    wt3 = AA_1TO3.get(wt.upper(), wt.upper())
    mut3 = AA_1TO3.get(mut.upper(), mut.upper())
    requested_chain = (chain or "").strip().upper()

    atoms = _read_chain_atoms(pdb_content, chain)
    if not atoms:
        raise ValueError("No valid protein ATOM records found in PDB structure.")

    chains_seen = list(dict.fromkeys(a["chain"] for a in atoms))
    if requested_chain and requested_chain in chains_seen:
        target_chain = requested_chain
    else:
        # Match chain holding the requested position if unique, else first chain
        matching_chains = sorted({a["chain"] for a in atoms if a["res_seq"] == position})
        target_chain = matching_chains[0] if matching_chains else chains_seen[0]

    target = [a for a in atoms if a["chain"] == target_chain and a["res_seq"] == position]
    if not any(a["name"] == "CA" for a in target):
        raise ValueError(f"Alpha carbon (CA) for position {position} on chain {target_chain} not found in PDB structure.")
    if wt3 in AA_INDEX and target[0]["res_name"] != wt3:
        raise ValueError(
            f"Wild-type residue mismatch at position {position} on chain {target_chain}: "
            f"structure has {target[0]['res_name']}, expected {wt3} ({wt.upper()})."
        )

    # The variant's chain, plus any partner chain that touches the site: a neighbouring chain is part of the environment. Measured
    # on S669 before adopting it: r with published 0.786 to 0.812. Other chains are left out so a large complex stays affordable.
    alpha_line = next(a["line"] for a in target if a["name"] == "CA")
    alpha_xyz = np.array([float(alpha_line[30:38]), float(alpha_line[38:46]), float(alpha_line[46:54])])
    chains_used = {target_chain} | {
        a["chain"] for a in atoms
        if np.linalg.norm(np.array([float(a["line"][30:38]), float(a["line"][38:46]), float(a["line"][46:54])]) - alpha_xyz) < ENVIRONMENT_RADIUS_A
    }
    chain_text = "\n".join(a["line"] for a in atoms if a["chain"] in chains_used) + "\nEND\n"

    def prepare_when_the_cpu_is_free():
        with models.cpu_gate.acquire(priority=1):
            return _prepare_chain(chain_text)

    prepared = _prepared_chains.get_or_compute(hashlib.sha256(chain_text.encode()).hexdigest(), prepare_when_the_cpu_is_free)
    if "refused" in prepared:
        raise ValueError(prepared["refused"])

    xyz, res_seqs, atom_chains = prepared["xyz"], prepared["res_seqs"], prepared["chains"]
    in_variant_residue = (res_seqs == position) & (atom_chains == target_chain)
    alpha = next(i for i in np.flatnonzero(in_variant_residue) if prepared["names"][i] == "CA")
    distance = np.linalg.norm(xyz - xyz[alpha], axis=1)
    keep = [i for i in np.argsort(distance, kind="stable") if distance[i] < ENVIRONMENT_RADIUS_A and not in_variant_residue[i]][:max_atoms]

    coords_tensor = torch.zeros([1, max_atoms, 3], dtype=torch.float32)
    atom_types_tensor = torch.zeros([1, max_atoms], dtype=torch.long)
    pp_tensor = torch.zeros([1, max_atoms, 2], dtype=torch.float32)
    mask_tensor = torch.zeros([1, max_atoms], dtype=torch.float32)
    for slot, i in enumerate(keep):
        coords_tensor[0, slot] = torch.from_numpy(xyz[i]).float()
        atom_types_tensor[0, slot] = ELEMENT_MAP(prepared["elements"][i])
        pp_tensor[0, slot, 0] = float(prepared["charge"][i])
        pp_tensor[0, slot, 1] = float(prepared["exposure"][i])
        mask_tensor[0, slot] = 1.0

    ca_tensor = torch.from_numpy(xyz[alpha]).float().reshape(1, 3)
    aa_feats = torch.tensor([[AA_INDEX.get(wt3, 0), AA_INDEX.get(mut3, 0)]], dtype=torch.long)
    contacts = sum(1 for i in keep if prepared["elements"][i] != "H")
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
        _input_tables()
        if importlib.util.find_spec("pdb2pqr") is None:
            raise RuntimeError("PDB2PQR is not installed, so hydrogens cannot be added. Rebuild the model server image.")
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
    except GateDeadlineExceeded:
        raise  # A busy answer, which the server turns into a 503. It is not a failure of this variant.
    except Exception as fe:
        raise HTTPException(status_code=500, detail=f"PDB featurization failed: {fe}")

    try:
        with models.cpu_gate.acquire(priority=1), torch.inference_mode():
            pred, _ = model([None], atom_types, pp, coords, ca, mask, aa_feats)
            # The authors' published value is -output/2: their embeddings reproduce their predictions exactly
            # with this conversion (r 1.00000 on 42 p53 variants). Positive = destabilizing, as in the app.
            ddg = -float(pred.item()) / 2

        return {
            "status": "success",
            "ddG": round(ddg, 4),
            "ddg": round(ddg, 4),
            "isStabilizing": ddg < -0.5,
            "contacts": contacts,
            "contactsAnalyzed": contacts,
            "provenance": "Stability Oracle (Diaz et al. 2024 - Graph Transformer)"
        }
    except GateDeadlineExceeded:
        raise
    except Exception as ie:
        raise HTTPException(status_code=500, detail=f"StabilityOracle inference failed: {ie}")

@router.post("/predict/stabilityoracle", response_model=StabilityOracleResponse)
async def predict_stabilityoracle(req: StabilityOracleRequest):
    return await asyncio.to_thread(predict_stabilityoracle_sync, req)
