import os
import time
import hashlib
import torch
import asyncio
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tools.model_server_app.utils import (
    AA_LIST,
    validate_missense_residues,
    crop_sequence_around_mutation,
    compute_scientific_metrics
)
from tools.model_server_app import models
from tools.model_server_app.routers.vesm import RemoteFailure, VesmRequest, predict_vesm_sync, remote_failures
from tools.model_server_app.engine_resilience import (
    InvalidProviderResponse,
    SingleFlightCache,
    account_level_refusal,
    classify_remote_failure,
    run_with_deadline,
    to_full_coordinates,
)

router = APIRouter()

# Every path scores the hidden residue (Meier et al. 2021). Recorded on the result so a reading from
# the old local path, which scored the visible residue, can never pass for this one.
SCORING_METHOD = "masked-marginal"

# The score needs one masked pass; the shift trace needs two more. Those two run only if they can
# finish within this many seconds of the request reaching the sidecar (the Node layer allows 120 s,
# queueing included), so a long protein on a CPU host still gets its score in time.
EMBEDDING_BUDGET_S = float(os.environ.get("ESM2_EMBEDDING_BUDGET_S", "90"))

# Measured forward-pass cost per token, per checkpoint, from this process's own passes.
_seconds_per_token: dict[str, float] = {}

# Shared across alleles at one site (masked logits) and across variants in one protein (WT states).
_masked_site_logits = SingleFlightCache(max_entries=32)
_wt_hidden_states = SingleFlightCache(max_entries=8)


def clear_esm2_caches() -> None:
    _masked_site_logits.clear()
    _wt_hidden_states.clear()


class Esm2Request(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    hfToken: str | None = None
    modelName: str = "facebook/esm2_t33_650M_UR50D"

class Esm2PreferenceItem(BaseModel):
    aa: str
    prob: float

class Esm2LocalShiftItem(BaseModel):
    position: int
    residue: str
    shift: float

class Esm2Response(BaseModel):
    status: str
    wtProbability: float | None = None
    mutProbability: float | None = None
    llr: float | None = None
    preferences: list[Esm2PreferenceItem] | None = None
    mutRank: int | None = None
    positionalEntropy: float | None = None
    embeddingShift: float | None = None
    localShiftMap: list[Esm2LocalShiftItem] | None = None
    # Not reported on any path: masking the site in both alleles gives one input (KL 0 by construction),
    # and an unmasked site KL measures the model copying the residue it can see. Kept for the contract.
    klDivergence: float | None = None
    # Why the shift trace is absent when the score is present (e.g. skipped to stay within the budget).
    embeddingNote: str | None = None
    provenance: str | None = None
    checkpoint: str | None = None
    scoringMethod: str | None = None
    # Fallback diagnostics, matching the SaProt router: which engine failed and why, per tier.
    remoteEngineNote: str | None = None
    remoteFailure: RemoteFailure | None = None
    fallbackReason: str | None = None
    verdict: str | None = None
    error: str | None = None

def run_esm2_remote(model_name: str, sequence: str, pos: int, wt: str, mut: str, token: str):
    from huggingface_hub import InferenceClient
    # Bounded: three serverless calls follow (fill_mask and two feature_extraction), and a cold model on
    # the provider can otherwise hold this request past the Node layer's budget.
    client = InferenceClient(token=token, timeout=float(os.environ.get("ESM2_REMOTE_TIMEOUT_S", "30")))

    wt_sequence = sequence.upper()
    masked_seq = wt_sequence[:pos-1] + "<mask>" + wt_sequence[pos:]

    preds = client.fill_mask(masked_seq, model=model_name, targets=AA_LIST, top_k=20)

    scores = {}
    for item in preds:
        tok_str = item.token_str if hasattr(item, "token_str") else item["token_str"]
        score_val = item.score if hasattr(item, "score") else item["score"]
        scores[tok_str] = score_val

    for aa in AA_LIST:
        if aa not in scores or not np.isfinite(scores[aa]) or scores[aa] < 0:
            raise InvalidProviderResponse("ESM-2 returned an incomplete or invalid amino-acid distribution")

    # Renormalised over the 20 residues only: the provider's other tokens (<eos>, X, B…) are not
    # substitutions. The ΔLLR is unchanged by this; probabilities and entropy are per 20 residues.
    total_score = sum(scores[aa] for aa in AA_LIST)
    if total_score <= 0:
        raise InvalidProviderResponse("ESM-2 returned an empty probability distribution")
    probs = {aa: (scores[aa] / total_score) for aa in AA_LIST}

    wt_prob = probs[wt]
    mut_prob = probs[mut]

    llr = float(np.log(mut_prob + 1e-9) - np.log(wt_prob + 1e-9))

    preferences = [{"aa": aa, "prob": round(probs[aa], 6)} for aa in AA_LIST]
    preferences.sort(key=lambda x: x["prob"], reverse=True)
    mut_rank = next(i + 1 for i, pref in enumerate(preferences) if pref["aa"] == mut)

    pos_entropy = float(-sum(p * np.log2(p) for p in probs.values() if p > 0))

    mut_seq_chars = list(wt_sequence)
    mut_seq_chars[pos - 1] = mut
    mut_sequence = "".join(mut_seq_chars)

    # Left as None, not 0.0: the serverless filler API exposes no per-residue feature
    # extraction, and a coerced zero is indistinguishable from a measured zero shift once it
    # reaches the model card.
    embedding_shift: float | None = None
    local_shift_map = []
    try:
        wt_emb = np.array(client.feature_extraction(wt_sequence, model=model_name))
        if wt_emb.ndim == 3:
            wt_emb = wt_emb[0]

        mut_emb = np.array(client.feature_extraction(mut_sequence, model=model_name))
        if mut_emb.ndim == 3:
            mut_emb = mut_emb[0]

        seq_len = min(wt_emb.shape[0], mut_emb.shape[0])
        distances = np.linalg.norm(wt_emb[:seq_len] - mut_emb[:seq_len], axis=-1)

        emb_pos = pos if pos < seq_len else seq_len - 1
        embedding_shift = float(distances[emb_pos])

        for i in range(-10, 11):
            target_token_idx = pos + i
            if 1 <= target_token_idx < seq_len - 1:
                shift_val = float(distances[target_token_idx])
                res_char = wt_sequence[target_token_idx - 1]
                local_shift_map.append({
                    "position": target_token_idx,
                    "residue": res_char,
                    "shift": round(shift_val, 4)
                })
    except Exception as e:
        print(f"[Model Server] ESM-2 remote feature extraction skipped (not supported by HF API): {e}")

    return {
        "status": "success",
        "wtProbability": round(wt_prob, 6),
        "mutProbability": round(mut_prob, 6),
        "llr": round(llr, 4),
        "preferences": preferences,
        "mutRank": mut_rank,
        "positionalEntropy": round(pos_entropy, 4),
        "embeddingShift": round(embedding_shift, 4) if embedding_shift is not None else None,
        "localShiftMap": local_shift_map,
        # Not reported: masking the site in both alleles gives one input, so a site KL is 0 by
        # construction, and an unmasked one measures the model copying the residue it can see.
        "klDivergence": None,
        "provenance": f"ESM-2 ({model_name.split('/')[-1]} - Remote)",
        "checkpoint": model_name,
        "scoringMethod": SCORING_METHOD,
    }


def run_esm2_local(model_name: str, sequence: str, pos: int, wt: str, mut: str, start_offset: int, deadline: float | None = None):
    """
    Masked-marginal scoring plus the unmasked WT/mutant embedding shift, on whatever device loaded.
    With a `deadline` (monotonic seconds) the embedding passes are skipped, and said to be, when the
    measured pass cost says they would not finish by then.
    """
    tokenizer, model = models.get_esm2_model(model_name)
    device = next(model.parameters()).device
    seq_hash = hashlib.sha256(sequence.encode()).hexdigest()

    def encode(seq: str):
        return {k: v.to(device) for k, v in tokenizer(seq, return_tensors="pt").items()}

    # Index `pos` is the residue: the tokenizer puts <cls> at index 0.
    def forward(inputs, **kwargs):
        with models.cpu_gate.acquire(priority=1), torch.inference_mode():
            started = time.monotonic()
            outputs = model(**inputs, **kwargs)
            _seconds_per_token[model_name] = (time.monotonic() - started) / inputs["input_ids"].shape[1]
            return outputs

    def masked_site_logits():
        inputs = encode(sequence)
        inputs["input_ids"][0, pos] = tokenizer.mask_token_id
        return forward(inputs).logits[0, pos : pos + 1].float().cpu().clone()

    def final_hidden_states(seq: str):
        return forward(encode(seq), output_hidden_states=True).hidden_states[-1][0].float().cpu().clone()

    site_logits = _masked_site_logits.get_or_compute((model_name, seq_hash, pos), masked_site_logits)
    vocab_map = {aa: tokenizer.convert_tokens_to_ids(aa) for aa in AA_LIST}
    wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
        site_logits, 0, wt, mut, vocab_map
    )

    hardware = "GPU" if device.type == "cuda" else "CPU"
    result = {
        "status": "success",
        "wtProbability": wt_prob,
        "mutProbability": mut_prob,
        "llr": llr,
        "preferences": preferences,
        "mutRank": mut_rank,
        "positionalEntropy": pos_entropy,
        "embeddingShift": None,
        "localShiftMap": [],
        "klDivergence": None,
        "provenance": f"ESM-2 ({model_name.split('/')[-1]} - Local {hardware})",
        "checkpoint": model_name,
        "scoringMethod": SCORING_METHOD,
    }
    # Two passes at most (the wild type may be cached); <cls> and <eos> make it len + 2 tokens.
    estimate_s = 2 * _seconds_per_token.get(model_name, 0.0) * (len(sequence) + 2)
    if deadline is not None and time.monotonic() + estimate_s > deadline:
        result["embeddingNote"] = (
            f"The embedding shift was not computed: its two passes (about {estimate_s:.0f} s for "
            f"{len(sequence)} residues on this server) would not finish in time. The score is complete."
        )
        return result

    mut_sequence = sequence[: pos - 1] + mut + sequence[pos:]
    wt_hidden = _wt_hidden_states.get_or_compute((model_name, seq_hash), lambda: final_hidden_states(sequence))
    mut_hidden = final_hidden_states(mut_sequence)
    seq_len = min(wt_hidden.size(0), mut_hidden.size(0))
    distances = torch.norm(wt_hidden[:seq_len] - mut_hidden[:seq_len], p=2, dim=-1)

    local_shift_map = [
        {"position": p, "residue": sequence[p - 1], "shift": round(distances[p].item(), 4)}
        for p in range(pos - 10, pos + 11)
        if 1 <= p < seq_len - 1
    ]
    result["embeddingShift"] = round(distances[pos].item(), 4)
    result["localShiftMap"] = to_full_coordinates(local_shift_map, start_offset)
    return result


def predict_esm2_3b_sync(req: Esm2Request, deadline: float | None = None):
    validate_missense_residues(req.wt, req.mut)
    sequence = req.sequence.upper()
    wt = req.wt.upper()
    mut = req.mut.upper()
    pos = req.position
    # The VESM fallback crops for itself and reports positions in full-protein numbering; handing it the
    # already-cropped window would lose the offset and stop it sharing a result with the other engines.
    full_sequence, full_pos = sequence, pos

    sequence, pos, start_offset = crop_sequence_around_mutation(sequence, pos, 1022)

    if pos < 1 or pos > len(sequence):
        raise HTTPException(status_code=400, detail=f"Position {pos} out of bounds.")
    if sequence[pos - 1] != wt:
        raise HTTPException(status_code=400, detail="Wild-type AA mismatch.")

    remote_engine_note = None
    remote_failure = None
    hf_blocked = (
        remote_failures.blocked_reason("esm2", "huggingface", req.hfToken)
        or account_level_refusal(remote_failures.blocked_reason("saprot", "huggingface", req.hfToken))
    ) if req.hfToken else None
    if hf_blocked:
        remote_engine_note = f"remote skipped (recent refusal): {hf_blocked}"
        remote_failure = {"provider": "huggingface", "code": classify_remote_failure(hf_blocked)}
        print(f"[Model Server] ESM-2 remote skipped: {hf_blocked}")
    # The hosted try gets a fixed share of the request. With less time left than that share plus a local
    # masked pass, it is skipped: the Node layer stops waiting at 120 s, but this process would keep the
    # CPU busy for a result nobody reads.
    remote_budget = float(os.environ.get("ESM2_REMOTE_BUDGET_S", "25"))
    if req.hfToken and not hf_blocked and deadline is not None and deadline - time.monotonic() < remote_budget + 30:
        remote_engine_note = "remote skipped: this request had already waited too long to try it"
        remote_failure = {"provider": "huggingface", "code": "timeout"}
        hf_blocked = remote_engine_note
    if req.hfToken and not hf_blocked:
        try:
            print(f"[Model Server] Querying ESM-2 remotely via HF Serverless Inference API (model={req.modelName})...")
            result = run_with_deadline(
                lambda: run_esm2_remote(req.modelName, sequence, pos, wt, mut, req.hfToken), remote_budget, "ESM-2 remote"
            )
            print(f"[Model Server] ESM-2 remote call succeeded.")
            result["localShiftMap"] = to_full_coordinates(result.get("localShiftMap"), start_offset)
            return result
        except Exception as e:
            import traceback
            remote_engine_note = remote_failures.record("esm2", "huggingface", req.hfToken, e)
            remote_failure = {"provider": "huggingface", "code": classify_remote_failure(e)}
            print(f"[Model Server] ESM-2 remote run FAILED: {remote_engine_note}")
            print(traceback.format_exc())

    # Without CUDA the checkpoint is the host setting (models.ESM2_CPU_MODEL), loaded at startup.
    local_model = req.modelName if torch.cuda.is_available() else models.ESM2_CPU_MODEL
    if local_model.lower() == "vesm":
        local_error = "ESM2_CPU_MODEL=vesm: genuine ESM-2 is disabled on this host"
    elif not torch.cuda.is_available() and models.model_status.get("esm2") == "preparing":
        # First start on this host: the weights are still downloading in the background. Waiting for
        # them here could outlast the request, so VESM serves and says why.
        local_error = f"{local_model.split('/')[-1]} is still being downloaded on this server and serves once it is ready"
    else:
        try:
            result = run_esm2_local(local_model, sequence, pos, wt, mut, start_offset, deadline)
            result["remoteEngineNote"] = remote_engine_note
            result["remoteFailure"] = remote_failure
            return result
        except Exception as e:
            local_error = f"{local_model.split('/')[-1]}: {type(e).__name__}: {e}"
            print(f"[Model Server] ESM-2 local run failed: {local_error}. Falling back to VESM-150M.")

    vesm_res = predict_vesm_sync(VesmRequest(sequence=full_sequence, position=full_pos, wt=wt, mut=mut))
    vesm_res["klDivergence"] = None  # Zero-heuristics compliant: VESM fallback cannot compute ESM-2 KL divergence
    vesm_res["provenance"] = "VESM-150M (Local Fallback)"
    vesm_res["checkpoint"] = "ntranoslab/vesm VESM_150M"
    vesm_res["scoringMethod"] = SCORING_METHOD
    # The card serves another model's numbers here, so it carries both reasons: the remote engine that
    # did not answer and the reason genuine ESM-2 could not run on this host.
    vesm_res["remoteEngineNote"] = remote_engine_note
    vesm_res["remoteFailure"] = remote_failure
    vesm_res["fallbackReason"] = local_error
    return vesm_res

_inference_semaphore = asyncio.Semaphore(1)

@router.post("/predict/esm2", response_model=Esm2Response)
@router.post("/predict/esm2_3b", response_model=Esm2Response)
async def predict_esm2_3b(req: Esm2Request):
    # Counted from arrival, so time spent queued behind another ESM-2 request comes out of the budget.
    deadline = time.monotonic() + EMBEDDING_BUDGET_S
    async with _inference_semaphore:
        return await asyncio.to_thread(predict_esm2_3b_sync, req, deadline)
