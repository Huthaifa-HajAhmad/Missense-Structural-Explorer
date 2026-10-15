import os
import torch
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import asyncio
import time
from tools.model_server_app.utils import validate_missense_residues
from tools.model_server_app.routers.vesm import (
    VesmRequest,
    predict_vesm_sync,
    remote_failures,
    FORGE_HOST,
    REMOTE_REQUEST_TIMEOUT_S,
    REMOTE_MAX_RETRY_ATTEMPTS,
)
from tools.model_server_app.engine_resilience import raise_if_sdk_error, run_with_deadline

# How long the remote ESM-3 tier may take before the request moves on to the local fallback. The Node
# layer allows the whole sidecar call 40 s (<=500 residues) or 100 s (longer); the remote tier must
# leave the local fallback its share. Sequences over 500 residues get twice the base remote budget.
ESM3_REMOTE_BUDGET_S = float(os.environ.get("ESM3_REMOTE_BUDGET_S", "15"))

router = APIRouter()

class Esm3Request(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    biohubToken: str | None = None
    refine: bool = False
    wtPdb: str | None = None

class Esm3SecondaryStructureShiftItem(BaseModel):
    position: int | None = None
    wtSS: str | None = None
    mutSS: str | None = None
    probDelta: float | None = None

class Esm3ContactShiftItem(BaseModel):
    pos1: int | None = None
    pos2: int | None = None
    probDelta: float | None = None

class Esm3Response(BaseModel):
    status: str
    perturbationScores: list[float] | None = None
    secondaryStructureShifts: list[Esm3SecondaryStructureShiftItem] | None = None
    contactShifts: list[Esm3ContactShiftItem] | None = None
    refinedPdb: str | None = None
    provenance: str | None = None
    error: str | None = None
    remoteEngineNote: str | None = None


def _local_vesm_fallback(sequence: str, pos: int, wt: str, mut: str, provenance: str, note: str | None):
    """Perturbation map from the local VESM-150M pass (shared with the other engines via the cache)."""
    vesm_req = VesmRequest(sequence=sequence, position=pos, wt=wt, mut=mut)
    vesm_res = predict_vesm_sync(vesm_req)
    full_length_scores = [-1.0] * len(sequence)
    for item in vesm_res.get("localShiftMap", []):
        res_pos = item.get("position")
        shift_val = item.get("shift", 0.0)
        if res_pos is not None and 1 <= res_pos <= len(sequence):
            full_length_scores[res_pos - 1] = shift_val
    return {
        "status": "success",
        "perturbationScores": full_length_scores,
        "secondaryStructureShifts": [],
        "contactShifts": [],
        "provenance": provenance,
        "remoteEngineNote": note,
    }


def predict_esm3_sync(req: Esm3Request):
    validate_missense_residues(req.wt, req.mut)
    sequence = req.sequence.upper()
    wt = req.wt.upper()
    mut = req.mut.upper()
    pos = req.position

    if not req.biohubToken:
        return _local_vesm_fallback(sequence, pos, wt, mut, "VESM-150M (Local Fallback)", None)

    # A 401/403/451 repeats identically for this host and credential: skip the attempt for a while
    # rather than spending the request's budget rediscovering it.
    blocked = remote_failures.blocked_reason("esm3", FORGE_HOST, req.biohubToken)
    if blocked:
        print(f"[Model Server] ESM-3 remote skipped: {blocked}")
        note = f"remote skipped (recent refusal): {blocked}"
    else:
        started = time.monotonic()
        try:
            return run_with_deadline(
                lambda: _predict_esm3_remote(req, sequence, pos, mut),
                ESM3_REMOTE_BUDGET_S * (2 if len(sequence) > 500 else 1),
                "ESM-3 remote",
            )
        except Exception as e:
            note = remote_failures.record("esm3", FORGE_HOST, req.biohubToken, e)
            print(f"[Model Server Remote ESM3 Error] after {time.monotonic() - started:.1f}s: {note}. Falling back to local model.")

    try:
        return _local_vesm_fallback(sequence, pos, wt, mut, "VESM-150M (Local Fallback - ESM-3 remote failed)", note)
    except Exception as local_err:
        raise HTTPException(status_code=500, detail=f"ESM-3 failed and local fallback failed: {local_err}")


def _predict_esm3_remote(req: Esm3Request, sequence: str, pos: int, mut: str):
    from esm.sdk.forge import ESM3ForgeInferenceClient
    from esm.sdk.api import ESMProtein, GenerationConfig

    import os
    forge_url = FORGE_HOST
    client = ESM3ForgeInferenceClient(
        model="esm3-medium-2024-08",
        url=forge_url,
        token=req.biohubToken,
        request_timeout=REMOTE_REQUEST_TIMEOUT_S,
        max_retry_attempts=REMOTE_MAX_RETRY_ATTEMPTS,
    )
    
    wt_protein = ESMProtein(sequence=sequence)
    wt_protein_tensor = raise_if_sdk_error(client.encode(wt_protein))
    
    mut_seq_chars = list(sequence)
    mut_seq_chars[pos - 1] = mut
    mut_sequence = "".join(mut_seq_chars)
    mut_protein = ESMProtein(sequence=mut_sequence)
    mut_protein_tensor = raise_if_sdk_error(client.encode(mut_protein))

    from esm.sdk.api import LogitsConfig
    config = LogitsConfig(sequence=True, return_embeddings=True)
    wt_logits_out = raise_if_sdk_error(client.logits(wt_protein_tensor, config))
    mut_logits_out = raise_if_sdk_error(client.logits(mut_protein_tensor, config))

    raw_wt_embs = getattr(wt_logits_out, "embeddings", None)
    if raw_wt_embs is not None:
        raw_wt_embs_tensor = torch.tensor(raw_wt_embs)
        wt_embeddings = raw_wt_embs_tensor[0] if raw_wt_embs_tensor.ndim > 2 else raw_wt_embs_tensor
    else:
        raise ValueError("Could not find wt embeddings in client response")

    raw_mut_embs = getattr(mut_logits_out, "embeddings", None)
    if raw_mut_embs is not None:
        raw_mut_embs_tensor = torch.tensor(raw_mut_embs)
        mut_embeddings = raw_mut_embs_tensor[0] if raw_mut_embs_tensor.ndim > 2 else raw_mut_embs_tensor
    else:
        raise ValueError("Could not find mut embeddings in client response")

    dot_product = torch.sum(wt_embeddings * mut_embeddings, dim=-1)
    wt_norm = torch.norm(wt_embeddings, dim=-1)
    mut_norm = torch.norm(mut_embeddings, dim=-1)
    cosine_sim = dot_product / (wt_norm * mut_norm + 1e-9)
    cosine_dist = 1.0 - cosine_sim
    perturbation_scores = [round(val.item(), 4) for val in cosine_dist]

    refined_pdb = None
    contact_shifts = []
    ss_shifts = []

    if req.refine and req.wtPdb:
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".pdb", mode="w", delete=False) as f:
                f.write(req.wtPdb)
                temp_path = f.name
            
            try:
                wt_protein_obj = ESMProtein.from_pdb(temp_path)
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.unlink(temp_path)
                    except OSError as e:
                        print(f"[ESM3 Refinement] Could not unlink temp file {temp_path}: {e}")
            
            wt_coords = wt_protein_obj.coordinates.copy()
            mut_coords = wt_coords.copy()
            
            win_start = max(0, pos - 1 - 5)
            win_end = min(len(sequence) - 1, pos - 1 + 5)
            mut_coords[win_start:win_end+1] = np.nan
            
            wt_protein_obj.sequence = mut_sequence
            wt_protein_obj.coordinates = mut_coords
            
            if hasattr(wt_protein_obj, "structure_tokens") and wt_protein_obj.structure_tokens is not None:
                try:
                    wt_protein_obj.structure_tokens[win_start:win_end+1] = 4096
                except Exception as token_mask_err:
                    print(f"[ESM3 Refinement] Failed to mask structure tokens: {token_mask_err}")

            gen_config = GenerationConfig(track="structure", temperature=0.1)
            refined_protein = client.generate(wt_protein_obj, gen_config)
            
            if hasattr(refined_protein, "coordinates") and refined_protein.coordinates is not None:
                gen_coords = refined_protein.coordinates.copy()
                
                wt_outside_atoms = []
                gen_outside_atoms = []
                
                for r in range(len(sequence)):
                    if r >= win_start and r <= win_end:
                        continue
                    for atom_idx in [0, 1, 2]:
                        w_atom = wt_coords[r, atom_idx]
                        g_atom = gen_coords[r, atom_idx]
                        if not np.any(np.isnan(w_atom)) and not np.any(np.isnan(g_atom)):
                            wt_outside_atoms.append(w_atom)
                            gen_outside_atoms.append(g_atom)
                            
                if len(wt_outside_atoms) >= 3:
                    p = np.array(gen_outside_atoms)
                    q = np.array(wt_outside_atoms)
                    
                    c_p = np.mean(p, axis=0)
                    c_q = np.mean(q, axis=0)
                    p_c = p - c_p
                    q_c = q - c_q
                    H = np.dot(p_c.T, q_c)
                    U, S, Vt = np.linalg.svd(H)
                    R = np.dot(U, Vt)
                    if np.linalg.det(R) < 0:
                        Vt[2, :] *= -1
                        R = np.dot(U, Vt)
                    
                    for r in range(len(sequence)):
                        for atom_idx in range(37):
                            atom_coord = gen_coords[r, atom_idx]
                            if not np.any(np.isnan(atom_coord)):
                                gen_coords[r, atom_idx] = np.dot(atom_coord - c_p, R) + c_q
                                
                locked_coords = gen_coords.copy()
                for r in range(len(sequence)):
                    if r < win_start or r > win_end:
                        for atom_idx in range(37):
                            if not np.any(np.isnan(wt_coords[r, atom_idx])):
                                locked_coords[r, atom_idx] = wt_coords[r, atom_idx]
                                
                refined_protein.coordinates = locked_coords
                
                if hasattr(refined_protein, "structure") and refined_protein.structure:
                    try:
                        refined_protein.structure = refined_protein.structure.from_coordinates(locked_coords)
                    except Exception as struct_err:
                        print(f"[ESM3 Refinement] Structure from coordinates warning: {struct_err}")
                
                refined_pdb = refined_protein.to_pdb()
        except Exception as gen_err:
            print(f"[ESM3 Refinement Generation Error]: {gen_err}")

    return {
        "status": "success",
        "perturbationScores": perturbation_scores,
        "secondaryStructureShifts": ss_shifts,
        "contactShifts": contact_shifts,
        "refinedPdb": refined_pdb,
        "provenance": "ESM3-Medium (Remote)"
    }

# One ESM-3 request at a time, like the ESM-2 and SaProt routes: on a 2-thread CPU host, concurrent
# fallback passes only slow each other down and push every one of them past its budget.
_inference_semaphore = asyncio.Semaphore(1)

@router.post("/predict/esm3", response_model=Esm3Response)
async def predict_esm3(req: Esm3Request):
    async with _inference_semaphore:
        return await asyncio.to_thread(predict_esm3_sync, req)
