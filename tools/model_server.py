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
from fastapi import FastAPI, HTTPException
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

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
