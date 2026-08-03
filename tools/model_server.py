# /// script
# dependencies = [
#   "fastapi",
#   "uvicorn",
#   "pydantic",
#   "torch",
#   "transformers",
#   "huggingface_hub",
#   "numpy",
#   "esm @ git+https://github.com/Biohub/esm.git@main",
#   "mini3di"
# ]
# ///

import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

# Add current workspace to path to allow importing tools modules
sys.path.append(os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from tools.model_server_app import models, utils
from tools.model_server_app.routers import vesm, esm3, esm2, saprot, esmfold

# Re-export helper functions for backward compatibility (e.g. unit tests)
crop_sequence_around_mutation = utils.crop_sequence_around_mutation
compute_scientific_metrics = utils.compute_scientific_metrics
validate_missense_residues = utils.validate_missense_residues
from fastapi import HTTPException  # Re-export HTTPException for test compatibility

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up local models on server start
    try:
        models.load_vesm()
    except Exception as e:
        print(f"[Model Server Error] Failed to load local VESM model: {e}")
    yield
    models.clear_vesm()

app = FastAPI(title="Missense Structural Explorer Model Server", lifespan=lifespan)

@app.middleware("http")
async def verify_secret_header(request: Request, call_next):
    expected_secret = os.environ.get("SIDECAR_SECRET")

    if expected_secret and request.url.path != "/health":
        client_secret = request.headers.get("X-Sidecar-Secret")
        if client_secret != expected_secret:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized sidecar request"})
    response = await call_next(request)
    return response

@app.get("/health")
def health_check():
    return {"status": "healthy", "model_loaded": models.vesm_model is not None}

# Register model sub-routers
app.include_router(vesm.router)
app.include_router(esm3.router)
app.include_router(esm2.router)
app.include_router(saprot.router)
app.include_router(esmfold.router)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
