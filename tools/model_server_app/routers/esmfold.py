from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import asyncio

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
        from esm.sdk.api import ESMProteinError

        import os
        forge_url = os.environ.get("FORGE_API_URL", "https://forge.evolutionaryscale.ai").rstrip("/")
        client = SequenceStructureForgeInferenceClient(
            model="esmfold2-fast-2026-05",
            url=forge_url,
            token=req.biohubToken
        )
        result = client.fold(req.sequence)
        if isinstance(result, ESMProteinError):
            raise Exception(f"ESM SDK Error ({result.error_code}): {result.error_msg}")
        
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
