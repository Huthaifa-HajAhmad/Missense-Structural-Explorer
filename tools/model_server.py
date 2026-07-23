# /// script
# dependencies = [
#   "fastapi",
#   "uvicorn",
#   "pydantic",
#   "torch",
#   "transformers",
#   "huggingface_hub",
#   "numpy"
# ]
# ///

import os
import sys
import torch
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import uvicorn
from contextlib import asynccontextmanager

# Add current workspace to path to allow importing tools modules
sys.path.append(os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from tools.esm2_eval import download_weights

# Global model references for in-memory single-load caching
vesm_tokenizer = None
vesm_model = None

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
    state_dict = torch.load(weights_path, map_location="cpu", weights_only=True)
    vesm_model.load_state_dict(state_dict, strict=False)
    vesm_model.eval()
    print("[Model Server] VESM_150M model loaded successfully.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up models on server start
    try:
        load_vesm()
    except Exception as e:
        print(f"[Model Server Error] Failed to load VESM model: {e}")
    yield
    global vesm_tokenizer, vesm_model
    vesm_tokenizer = None
    vesm_model = None

app = FastAPI(title="Missense Structural Explorer Model Server", lifespan=lifespan)

@app.middleware("http")
async def verify_secret_header(request: Request, call_next):
    expected_secret = os.environ.get("SIDECAR_SECRET")
    # Read dynamic secret from .sidecar_secret if exists, else fallback to env
    secret_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".sidecar_secret")
    if os.path.exists(secret_file):
        try:
            with open(secret_file, "r") as f:
                expected_secret = f.read().strip()
        except Exception:
            pass

    if expected_secret and request.url.path != "/health":
        client_secret = request.headers.get("X-Sidecar-Secret")
        if client_secret != expected_secret:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "Unauthorized sidecar request"})
    response = await call_next(request)
    return response

@app.get("/health")
def health_check():
    return {"status": "healthy", "model_loaded": vesm_model is not None}

class VesmRequest(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str

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

        # 1. Logits and LLR (Masked Marginal Approach)
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

        # 2. Embedding Shifts (Unmasked hidden state representation differences)
        wt_seq = sequence
        mut_seq_chars = list(sequence)
        mut_seq_chars[pos - 1] = mut
        mut_seq = "".join(mut_seq_chars)

        wt_inputs = vesm_tokenizer(wt_seq, return_tensors="pt")
        mut_inputs = vesm_tokenizer(mut_seq, return_tensors="pt")

        with torch.no_grad():
            wt_outputs = vesm_model(**wt_inputs, output_hidden_states=True)
            mut_outputs = vesm_model(**mut_inputs, output_hidden_states=True)
            
            wt_emb = wt_outputs.hidden_states[-1][0]  # Shape: [seq_len, hidden_dim]
            mut_emb = mut_outputs.hidden_states[-1][0]  # Shape: [seq_len, hidden_dim]
            
            seq_len = min(wt_emb.size(0), mut_emb.size(0))
            diff = wt_emb[:seq_len] - mut_emb[:seq_len]
            distances = torch.norm(diff, p=2, dim=-1)  # Shape: [seq_len]

        embedding_shift = round(distances[pos].item(), 4)
        
        local_shift_map = []
        for i in range(-10, 11):
            target_pos = pos + i
            if 1 <= target_pos < seq_len - 1:  # avoid <cls> (0) and <eos> (seq_len - 1)
                shift_val = distances[target_pos].item()
                res_char = sequence[target_pos - 1]
                local_shift_map.append({
                    "position": target_pos,
                    "residue": res_char,
                    "shift": round(shift_val, 4)
                })

        return {
            "status": "success",
            "llr": llr,
            "verdict": "raw score",
            "embeddingShift": embedding_shift,
            "localShiftMap": local_shift_map
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
