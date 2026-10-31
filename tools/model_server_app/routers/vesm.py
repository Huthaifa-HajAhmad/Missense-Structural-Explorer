import torch
import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tools.model_server_app.utils import (
    AA_LIST,
    validate_missense_residues,
    crop_sequence_around_mutation,
    compute_scientific_metrics
)
from tools.model_server_app import models
from tools.model_server_app.engine_resilience import (
    RemoteFailureMemory,
    SingleFlightCache,
    describe_remote_error,
    extract_status,
    raise_if_sdk_error,
    to_full_coordinates,
    with_remote_failure,
)
import hashlib
import os

# Shared across the VESM, ESM-2 and ESM-3 routers so a deterministic remote failure (401/403/451) is
# paid for once, not on every analysis, and so concurrent engines that fall back to the same local
# VESM-150M pass compute it once.
remote_failures = RemoteFailureMemory(ttl_seconds=float(os.environ.get("REMOTE_FAILURE_TTL_S", "600")))
_local_vesm_results = SingleFlightCache(max_entries=16)
_local_vesm_masked_cache = SingleFlightCache(max_entries=32)
_local_vesm_wt_emb_cache = SingleFlightCache(max_entries=8)


def clear_vesm_caches() -> None:
    _local_vesm_results.clear()
    _local_vesm_masked_cache.clear()
    _local_vesm_wt_emb_cache.clear()

BIOHUB_HOST = "https://biohub.ai"
FORGE_HOST = os.environ.get("FORGE_API_URL", "https://forge.evolutionaryscale.ai").rstrip("/")
# Per-request ceiling for the remote SDK. Its own default is 120 s with 5 retries and waits of up to
# 10 s, which alone can outlast the 60 s the Node layer allows the whole sidecar call.
REMOTE_REQUEST_TIMEOUT_S = int(os.environ.get("REMOTE_REQUEST_TIMEOUT_S", "20"))
REMOTE_MAX_RETRY_ATTEMPTS = int(os.environ.get("REMOTE_MAX_RETRY_ATTEMPTS", "2"))

# Canonical ESM-C / ESM-3 amino acid token indices (EvolutionaryScale vocabulary):
# Indices 0..3 are <cls>, <pad>, <eos>, <unk>. Standard amino acids start at index 4.
ESMC_CANONICAL_VOCAB = {
    "L": 4, "A": 5, "G": 6, "V": 7, "S": 8, "E": 9,
    "R": 10, "T": 11, "I": 12, "D": 13, "P": 14, "F": 15,
    "K": 16, "N": 17, "Q": 18, "Y": 19, "M": 20, "H": 21,
    "W": 22, "C": 23
}

router = APIRouter()

class VesmRequest(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    biohubToken: str | None = None
    includeEmbeddings: bool = True

class VesmPreferenceItem(BaseModel):
    aa: str
    prob: float

class VesmLocalShiftItem(BaseModel):
    position: int
    residue: str
    shift: float

class RemoteFailure(BaseModel):
    """A remote refusal as data: the provider and one of engine_resilience.FAILURE_CODES."""
    provider: str
    code: str

class VesmResponse(BaseModel):
    status: str
    wtProbability: float | None = None
    mutProbability: float | None = None
    llr: float | None = None
    preferences: list[VesmPreferenceItem] | None = None
    mutRank: int | None = None
    positionalEntropy: float | None = None
    embeddingShift: float | None = None
    localShiftMap: list[VesmLocalShiftItem] | None = None
    klDivergence: float | None = None
    conformationState: str | None = None
    provenance: str | None = None
    checkpoint: str | None = None
    scoringMethod: str | None = None
    verdict: str | None = None
    hfError: str | None = None
    error: str | None = None
    remoteEngineNote: str | None = None
    remoteFailure: RemoteFailure | None = None

def predict_vesm_sync(req: VesmRequest):
    validate_missense_residues(req.wt, req.mut)
    sequence = req.sequence.upper()
    wt = req.wt.upper()
    mut = req.mut.upper()
    pos = req.position

    sequence, pos, start_offset = crop_sequence_around_mutation(sequence, pos, 1022)

    if pos < 1 or pos > len(sequence):
        raise HTTPException(status_code=400, detail=f"Position {pos} out of bounds.")
    if sequence[pos - 1] != wt:
        raise HTTPException(status_code=400, detail=f"Wild-type AA mismatch at position {pos}.")

    # 1. If remote Biohub Token is configured, route via ESMCForgeInferenceClient.
    # EvolutionaryScale routes via both forge.evolutionaryscale.ai and biohub.ai. In regions where
    # biohub.ai answers 451, Forge remains reachable.
    remote_engine_note = None
    if req.biohubToken:
        candidate_hosts = [FORGE_HOST, BIOHUB_HOST] if FORGE_HOST != BIOHUB_HOST else [BIOHUB_HOST]
        notes: list[str] = []
        for host in candidate_hosts:
            host_blocked = remote_failures.blocked_reason("esmc", host, req.biohubToken)
            if host_blocked:
                notes.append(f"{host}: skipped (recent refusal: {host_blocked})")
                continue
            try:
                result = _run_esmc_remote_host(req, sequence, pos, wt, mut, start_offset, host)
                return result
            except Exception as e:
                err_note = remote_failures.record("esmc", host, req.biohubToken, e)
                notes.append(f"{host}: {err_note}")
                print(f"[Model Server Remote ESMC Error on {host}]: {err_note}")
                continue
        if notes:
            remote_engine_note = " · ".join(notes)
            print(f"[Model Server] All remote ESMC hosts failed. Falling back to local model. Reason: {remote_engine_note}")

    # 2. Local Fallback (VESM-150M). Concurrent engines that fall back to the same local pass (ESM-3,
    # ESM-2) share one computation instead of each running three forward passes on the CPU.
    seq_hash = hashlib.sha256(sequence.encode()).hexdigest()
    cache_key = (
        seq_hash, pos, wt, mut, bool(req.includeEmbeddings), start_offset
    )
    result = _local_vesm_results.get_or_compute(
        cache_key, lambda: _predict_vesm_local(req, sequence, pos, wt, mut, start_offset, seq_hash=seq_hash)
    )
    if remote_engine_note:
        result["remoteEngineNote"] = remote_engine_note
    return result


def _ensure_vesm_loaded():
    if models.vesm_model is None or models.vesm_tokenizer is None:
        try:
            models.load_vesm()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"VESM model is not loaded: {e}")


def _compute_masked_site_logits(sequence: str, pos: int):
    _ensure_vesm_loaded()
    seq_chars = list(sequence)
    seq_chars[pos - 1] = models.vesm_tokenizer.mask_token
    masked_seq = "".join(seq_chars)

    inputs = models.vesm_tokenizer(masked_seq, return_tensors="pt")
    with models.cpu_gate.acquire(priority=0), torch.no_grad():
        outputs = models.vesm_model(**inputs)
        logits = outputs.logits

    mask_token_id = models.vesm_tokenizer.mask_token_id
    mask_indices = (inputs["input_ids"][0] == mask_token_id).nonzero(as_tuple=True)[0]
    token_idx = mask_indices[0].item()
    return logits[0, token_idx : token_idx + 1].detach().clone()


def _compute_wt_hidden_states(sequence: str):
    _ensure_vesm_loaded()
    wt_inputs = models.vesm_tokenizer(sequence, return_tensors="pt")
    with models.cpu_gate.acquire(priority=1), torch.no_grad():
        wt_outputs = models.vesm_model(**wt_inputs, output_hidden_states=True)
        return wt_outputs.hidden_states[-1][0].detach().clone()


def _predict_vesm_local(req, sequence, pos, wt, mut, start_offset, seq_hash: str | None = None):
    _ensure_vesm_loaded()
    if seq_hash is None:
        seq_hash = hashlib.sha256(sequence.encode()).hexdigest()

    try:
        # 1. Masked site logits (shared across includeEmbeddings=False and True, and across all
        # alternate alleles at the same site). Runs at priority=0 so Evidence triage finishes first.
        site_logits = _local_vesm_masked_cache.get_or_compute(
            (seq_hash, pos, start_offset),
            lambda: _compute_masked_site_logits(sequence, pos),
        )

        vocab_map = {aa: models.vesm_tokenizer.convert_tokens_to_ids(aa) for aa in AA_LIST}

        wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
            site_logits, 0, wt, mut, vocab_map
        )

        embedding_shift = None
        local_shift_map = []
        cosine_profile = []

        # Optimization: Only run the two expensive unmasked forward passes (WT and Mutant)
        # when the caller actually needs embeddings. Triage evaluation (LLR only) skips them,
        # and WT embeddings are cached by (seq_hash, start_offset) across variants in the same window.
        if req.includeEmbeddings:
            wt_emb = _local_vesm_wt_emb_cache.get_or_compute(
                (seq_hash, start_offset),
                lambda: _compute_wt_hidden_states(sequence),
            )
            mut_seq_chars = list(sequence)
            mut_seq_chars[pos - 1] = mut
            mut_seq = "".join(mut_seq_chars)
            mut_inputs = models.vesm_tokenizer(mut_seq, return_tensors="pt")

            with models.cpu_gate.acquire(priority=1), torch.no_grad():
                mut_outputs = models.vesm_model(**mut_inputs, output_hidden_states=True)
                mut_emb = mut_outputs.hidden_states[-1][0]

                seq_len = min(wt_emb.size(0), mut_emb.size(0))
                diff = wt_emb[:seq_len] - mut_emb[:seq_len]
                distances = torch.norm(diff, p=2, dim=-1)
                cosine = 1.0 - torch.nn.functional.cosine_similarity(wt_emb[:seq_len], mut_emb[:seq_len], dim=-1)

            embedding_shift = round(distances[pos].item(), 4)
            # Every residue of the window, as cosine distance: the ESM-3 slot's metric. Its Euclidean
            # ±10 map was drawn and banded as cosine when VESM stood in for ESM-3. Index 0 is <cls>.
            cosine_profile = [
                {"position": r, "residue": sequence[r - 1], "shift": round(cosine[r].item(), 4)}
                for r in range(1, min(len(sequence), seq_len - 2) + 1)
            ]

            for i in range(-10, 11):
                target_pos = pos + i
                if 1 <= target_pos < seq_len - 1:
                    shift_val = distances[target_pos].item()
                    res_char = sequence[target_pos - 1]
                    local_shift_map.append({
                        "position": target_pos,
                        "residue": res_char,
                        "shift": round(shift_val, 4)
                    })

        return {
            "status": "success",
            "wtProbability": wt_prob,
            "mutProbability": mut_prob,
            "llr": llr,
            "preferences": preferences,
            "mutRank": mut_rank,
            "positionalEntropy": pos_entropy,
            "embeddingShift": embedding_shift,
            "localShiftMap": to_full_coordinates(local_shift_map, start_offset),
            # Internal to the sidecar (no response model declares it); the ESM-3 fallback reads it.
            "cosineProfile": to_full_coordinates(cosine_profile, start_offset),
            "provenance": "VESM-150M (Local)",
            "checkpoint": "ntranoslab/vesm VESM_150M",
            "scoringMethod": "masked-marginal",
            "verdict": "raw score"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _run_esmc_remote_host(req: VesmRequest, sequence: str, pos: int, wt: str, mut: str, start_offset: int, host: str):
    from esm.sdk.forge import ESMCForgeInferenceClient
    from esm.sdk.api import ESMProtein, LogitsConfig

    client = ESMCForgeInferenceClient(
        model="esmc-6b-2024-12",
        url=host,
        token=req.biohubToken,
        request_timeout=REMOTE_REQUEST_TIMEOUT_S,
        max_retry_attempts=REMOTE_MAX_RETRY_ATTEMPTS,
    )
    # The site is scored with the residue hidden ("_" is the SDK's sequence mask character). The
    # unmasked sequences are encoded further down, only for the embedding shift.
    masked_protein = ESMProtein(sequence=sequence[: pos - 1] + "_" + sequence[pos:])
    masked_tensor = raise_if_sdk_error(client.encode(masked_protein))
    logits_output = raise_if_sdk_error(client.logits(masked_tensor, LogitsConfig(sequence=True)))

    seq_logits = None
    if hasattr(logits_output, "logits") and logits_output.logits:
        seq_logits = getattr(logits_output.logits, "sequence", None)
    if seq_logits is None:
        seq_logits = getattr(logits_output, "sequence", None)

    if seq_logits is not None:
        seq_logits_tensor = torch.tensor(seq_logits) if not isinstance(seq_logits, torch.Tensor) else seq_logits
        logits = seq_logits_tensor[0] if seq_logits_tensor.ndim > 2 else seq_logits_tensor
    else:
        raise ValueError("Could not find sequence logits in client response")

    vocab_map = {}
    if hasattr(client, "tokenizer") and client.tokenizer:
        try:
            vocab_map = {aa: client.tokenizer.encode(aa)[0] for aa in AA_LIST}
        except Exception as tok_err:
            print(f"[Model Server] Tokenizer encode check: {tok_err}")

    if not vocab_map:
        try:
            for aa in AA_LIST:
                p_aa = ESMProtein(sequence=aa)
                pt_aa = client.encode(p_aa)
                vocab_map[aa] = int(pt_aa.sequence[1].item())
        except Exception as ve:
            print(f"[Model Server] Failed to build dynamic ESMC vocab map: {ve}. Using canonical ESM-C token indices.")
            vocab_map = ESMC_CANONICAL_VOCAB.copy()

    wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
        logits, pos, wt, mut, vocab_map
    )

    embedding_shift = None
    local_shift_map = []

    if req.includeEmbeddings:
        embedding_config = LogitsConfig(sequence=True, return_embeddings=True)

        def embeddings_of(residues: str) -> torch.Tensor:
            tensor = raise_if_sdk_error(client.encode(ESMProtein(sequence=residues)))
            raw = getattr(raise_if_sdk_error(client.logits(tensor, embedding_config)), "embeddings", None)
            if raw is None:
                raise ValueError(f"Could not find embeddings in client response for {residues[:12]}…")
            embs = torch.tensor(raw) if not isinstance(raw, torch.Tensor) else raw
            return embs[0] if embs.ndim > 2 else embs

        embeddings = embeddings_of(sequence)
        mut_embeddings = embeddings_of(sequence[: pos - 1] + mut + sequence[pos:])

        diff = embeddings - mut_embeddings
        distances = torch.norm(diff, p=2, dim=-1)
        embedding_shift = round(distances[pos].item(), 4)

        for i in range(-10, 11):
            target_pos = pos + i
            if 1 <= target_pos <= len(sequence):
                shift_val = distances[target_pos].item()
                res_char = sequence[target_pos - 1]
                local_shift_map.append({
                    "position": target_pos,
                    "residue": res_char,
                    "shift": round(shift_val, 4)
                })

    host_label = "Forge" if "forge" in host.lower() else "Remote"
    return {
        "status": "success",
        "wtProbability": wt_prob,
        "mutProbability": mut_prob,
        "llr": llr,
        "preferences": preferences,
        "mutRank": mut_rank,
        "positionalEntropy": pos_entropy,
        "embeddingShift": embedding_shift,
        "localShiftMap": to_full_coordinates(local_shift_map, start_offset),
        "provenance": f"ESMC-6B ({host_label})",
        "checkpoint": "esmc-6b-2024-12",
        "scoringMethod": "masked-marginal",
        "verdict": "raw score"
    }


@router.post("/predict/vesm", response_model=VesmResponse)
async def predict_vesm(req: VesmRequest):
    # The remote tier here is EvolutionaryScale's ESMC (Forge / Biohub).
    return with_remote_failure(await asyncio.to_thread(predict_vesm_sync, req), "biohub")
