# /// script
# dependencies = [
#   "fastapi",
#   "uvicorn",
#   "pydantic",
#   "torch",
#   "transformers",
#   "huggingface_hub",
#   "fair-esm",
#   "biopython",
#   "scipy",
#   "numpy"
# ]
# ///

import os
import sys
import torch
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# Add current workspace to path to allow importing tools modules
sys.path.append(os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from tools.esm2_eval import download_weights

app = FastAPI(title="Missense Structural Explorer Model Server")

# Global model references for in-memory single-load caching
vesm_tokenizer = None
vesm_model = None

rasp_model = None
rasp_alphabet = None

def load_vesm():
    global vesm_tokenizer, vesm_model
    if vesm_model is not None:
        return
    from transformers import AutoTokenizer, EsmForMaskedLM
    model_name = "VESM_150M"
    base_model_name = "facebook/esm2_t30_150M_UR50D"
    local_dir = os.path.join(os.path.dirname(__file__), "vesm")
    weights_path = download_weights(repo_id="ntranoslab/vesm", filename=f"{model_name}.pth", local_dir=local_dir)
    vesm_tokenizer = AutoTokenizer.from_pretrained(base_model_name)
    vesm_model = EsmForMaskedLM.from_pretrained(base_model_name)
    state_dict = torch.load(weights_path, map_location="cpu")
    vesm_model.load_state_dict(state_dict, strict=False)
    vesm_model.eval()
    print("[Model Server] VESM_150M model loaded successfully.")

def load_rasp():
    global rasp_model, rasp_alphabet
    if rasp_model is not None:
        return
    import esm
    rasp_model, rasp_alphabet = esm.pretrained.esm_if1_gvp4_t16_142M_UR50()
    rasp_model = rasp_model.eval()
    print("[Model Server] RaSP ESM-IF1 model loaded successfully.")

@app.on_event("startup")
def startup_event():
    # Warm up models on server start
    try:
        load_vesm()
    except Exception as e:
        print(f"[Model Server Error] Failed to load VESM model: {e}")
    try:
        load_rasp()
    except Exception as e:
        print(f"[Model Server Error] Failed to load RaSP model: {e}")

class VesmRequest(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str

class RaspRequest(BaseModel):
    wt_pdb_path: str
    mut_pdb_path: str
    chain: str
    pos: int
    wt_aa: str
    mut_aa: str

@app.post("/predict/vesm")
def predict_vesm(req: VesmRequest):
    if vesm_model is None or vesm_tokenizer is None:
        try:
            load_vesm()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"VESM model is not loaded: {e}")

    try:
        sequence = req.sequence.upper()
        wt = req.wt.upper()
        mut = req.mut.upper()
        pos = req.position

        if pos < 1 or pos > len(sequence):
            raise HTTPException(status_code=400, detail=f"Position {pos} out of bounds.")
        if sequence[pos - 1] != wt:
            raise HTTPException(status_code=400, detail=f"Wild-type AA mismatch at position {pos}.")

        seq_chars = list(sequence)
        seq_chars[pos - 1] = vesm_tokenizer.mask_token
        masked_seq = "".join(seq_chars)

        inputs = vesm_tokenizer(masked_seq, return_tensors="pt")
        with torch.no_grad():
            outputs = vesm_model(**inputs)
            logits = outputs.logits

        wt_id = vesm_tokenizer.convert_tokens_to_ids(wt)
        mut_id = vesm_tokenizer.convert_tokens_to_ids(mut)
        mask_token_id = vesm_tokenizer.mask_token_id
        mask_indices = (inputs["input_ids"][0] == mask_token_id).nonzero(as_tuple=True)[0]
        token_idx = mask_indices[0].item()

        pos_logits = logits[0, token_idx]
        pos_log_probs = torch.log_softmax(pos_logits, dim=-1)

        mut_log_prob = pos_log_probs[mut_id].item()
        wt_log_prob = pos_log_probs[wt_id].item()

        llr = round(mut_log_prob - wt_log_prob, 4)
        return {"status": "success", "llr": llr, "verdict": "raw score"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict/rasp")
def predict_rasp_endpoint(req: RaspRequest):
    if rasp_model is None or rasp_alphabet is None:
        try:
            load_rasp()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"RaSP model is not loaded: {e}")

    try:
        from esm.inverse_folding.util import load_structure, extract_coords_from_structure
        import esm

        def get_structure_embedding(pdb_path: str, target_chain: str, target_pos: int):
            structure = load_structure(pdb_path, target_chain)
            coords, seq = extract_coords_from_structure(structure, target_chain)
            with torch.no_grad():
                rep = esm.inverse_folding.util.get_encoder_output(rasp_model, rasp_alphabet, coords)
            idx = target_pos - 1
            if idx < 0 or idx >= rep.shape[0]:
                raise ValueError(f"Position {target_pos} out of bounds.")
            return rep[idx].cpu().numpy()

        wt_emb = get_structure_embedding(req.wt_pdb_path, req.chain, req.pos)
        mut_emb = get_structure_embedding(req.mut_pdb_path, req.chain, req.pos)

        diff_emb = mut_emb - wt_emb
        wt_norm = np.linalg.norm(wt_emb)
        diff_norm = np.linalg.norm(diff_emb)

        if wt_norm < 1e-8:
            return {"status": "success", "ddG": 0.0}

        cos_sim = np.dot(wt_emb, diff_emb) / (wt_norm * diff_norm + 1e-8)
        alpha = -2.5
        ddG = float(alpha * diff_norm * cos_sim)
        ddG = max(-15.0, min(15.0, ddG))

        return {"status": "success", "ddG": round(ddG, 3)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
