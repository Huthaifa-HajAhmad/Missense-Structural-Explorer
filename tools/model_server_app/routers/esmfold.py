from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import asyncio
import os

# Per-request ceiling for the remote SDK. Its own default is 120 s with 5 retries and waits of up to
# 10 s, which alone can outlast the time the Node layer allows the whole sidecar call.
REMOTE_REQUEST_TIMEOUT_S = int(os.environ.get("REMOTE_REQUEST_TIMEOUT_S", "20"))
REMOTE_MAX_RETRY_ATTEMPTS = int(os.environ.get("REMOTE_MAX_RETRY_ATTEMPTS", "2"))
from tools.model_server_app.engine_resilience import RemoteDeadlineExceeded, raise_if_sdk_error, run_with_deadline

router = APIRouter()

class EsmfoldRequest(BaseModel):
    sequence: str
    biohubToken: str | None = None

class EsmfoldResponse(BaseModel):
    status: str
    pdb: str | None = None
    provenance: str | None = None
    error: str | None = None

def _run_forge_fold(forge_url: str, sequence: str, token: str, budget_s: float):
    from esm.sdk.forge import SequenceStructureForgeInferenceClient

    client = SequenceStructureForgeInferenceClient(
        model="esmfold2-fast-2026-05",
        url=forge_url,
        token=token,
        request_timeout=REMOTE_REQUEST_TIMEOUT_S,
        max_retry_attempts=REMOTE_MAX_RETRY_ATTEMPTS,
    )
    return raise_if_sdk_error(run_with_deadline(lambda: client.fold(sequence), budget_s, "ESMFold2 remote"))

def predict_esmfold_sync(req: EsmfoldRequest):
    if not req.biohubToken:
        raise HTTPException(status_code=400, detail="Biohub token is required for remote ESMFold folding.")
    try:
        forge_url = os.environ.get("FORGE_API_URL", "https://forge.evolutionaryscale.ai").rstrip("/")
        budget_s = float(os.environ.get("ESMFOLD_REMOTE_BUDGET_S", "60"))
        try:
            result = _run_forge_fold(forge_url, req.sequence, req.biohubToken, budget_s)
        except Exception as primary_err:
            # Match /validate-biohub-token: fall back to biohub.ai on regional HTTP 451 when using default Forge URL.
            if getattr(primary_err, "error_code", None) == 451 and forge_url == "https://forge.evolutionaryscale.ai":
                result = _run_forge_fold("https://biohub.ai", req.sequence, req.biohubToken, budget_s)
            else:
                raise

        pdb_string = result.to_pdb_string()
        return {
            "status": "success",
            "pdb": pdb_string,
            "provenance": "ESMFold2 (Remote)"
        }
    except HTTPException:
        raise
    except RemoteDeadlineExceeded as e:
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        code = getattr(e, "error_code", None)
        status = code if isinstance(code, int) and 400 <= code <= 599 else 500
        raise HTTPException(status_code=status, detail=str(e))

@router.post("/predict/esmfold", response_model=EsmfoldResponse)
async def predict_esmfold(req: EsmfoldRequest):
    return await asyncio.to_thread(predict_esmfold_sync, req)
