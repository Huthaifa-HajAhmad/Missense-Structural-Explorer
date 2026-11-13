from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import asyncio
import os
from tools.model_server_app.routers.vesm import REMOTE_REQUEST_TIMEOUT_S, REMOTE_MAX_RETRY_ATTEMPTS
from tools.model_server_app.engine_resilience import raise_if_sdk_error, run_with_deadline

router = APIRouter()

class EsmfoldRequest(BaseModel):
    sequence: str
    biohubToken: str | None = None

class EsmfoldResponse(BaseModel):
    status: str
    pdb: str | None = None
    provenance: str | None = None
    error: str | None = None

def predict_esmfold_sync(req: EsmfoldRequest):
    if not req.biohubToken:
        raise HTTPException(status_code=400, detail="Biohub token is required for remote ESMFold folding.")
    try:
        from esm.sdk.forge import SequenceStructureForgeInferenceClient

        forge_url = os.environ.get("FORGE_API_URL", "https://forge.evolutionaryscale.ai").rstrip("/")
        client = SequenceStructureForgeInferenceClient(
            model="esmfold2-fast-2026-05",
            url=forge_url,
            token=req.biohubToken,
            request_timeout=REMOTE_REQUEST_TIMEOUT_S,
            max_retry_attempts=REMOTE_MAX_RETRY_ATTEMPTS,
        )
        budget_s = float(os.environ.get("ESMFOLD_REMOTE_BUDGET_S", "60"))
        result = raise_if_sdk_error(run_with_deadline(lambda: client.fold(req.sequence), budget_s, "ESMFold2 remote"))
        
        pdb_string = result.to_pdb_string()
        return {
            "status": "success",
            "pdb": pdb_string,
            "provenance": "ESMFold2 (Remote)"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict/esmfold", response_model=EsmfoldResponse)
async def predict_esmfold(req: EsmfoldRequest):
    return await asyncio.to_thread(predict_esmfold_sync, req)
