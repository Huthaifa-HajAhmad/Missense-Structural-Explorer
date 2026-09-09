import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

# Add current workspace to path to allow importing tools modules
sys.path.append(os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from tools.model_server_app import models, utils
from tools.model_server_app.routers import vesm, esm3, esm2, saprot, esmfold, stabilityoracle, thermompnn

# Re-export helper functions for backward compatibility (e.g. unit tests)
crop_sequence_around_mutation = utils.crop_sequence_around_mutation
compute_scientific_metrics = utils.compute_scientific_metrics
validate_missense_residues = utils.validate_missense_residues
from fastapi import HTTPException  # Re-export HTTPException for test compatibility

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Trigger non-blocking background model warmup so uvicorn binds port 8000 immediately
    try:
        models.start_background_warmup()
    except Exception as e:
        print(f"[Model Server Error] Failed to initiate background warmup: {e}")
    yield
    models.clear_vesm()
    models.clear_gpu_cache()

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
    is_warming = models.model_status.get("vesm") in ("downloading", "loading")
    return {
        "status": "healthy",
        "state": "warming_up" if is_warming else "ready",
        "model_loaded": models.vesm_model is not None,
        "active_models": len(models.esm2_models) + len(models.saprot_models),
        "models": models.model_status,
        "model_status": models.model_status,
        "model_errors": models.model_errors
    }

@app.post("/models/clear-cache")
def clear_model_cache():
    """Explicitly releases cached PyTorch model weights and flushes GPU RAM."""
    models.esm2_models.clear()
    models.saprot_models.clear()
    models.clear_gpu_cache()
    return {"status": "success", "message": "GPU memory cache cleared"}

# Register model sub-routers
app.include_router(vesm.router)
app.include_router(esm3.router)
app.include_router(esm2.router)
app.include_router(saprot.router)
app.include_router(esmfold.router)
app.include_router(stabilityoracle.router)
app.include_router(thermompnn.router)

if __name__ == "__main__":
    host = os.environ.get("SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("SIDECAR_PORT", "8000"))
    workers = int(os.environ.get("SIDECAR_WORKERS", "1"))
    if workers > 1:
        uvicorn.run("tools.model_server:app", host=host, port=port, workers=workers)
    else:
        uvicorn.run(app, host=host, port=port)

