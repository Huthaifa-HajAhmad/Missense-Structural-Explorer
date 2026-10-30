import os
import torch
import asyncio
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tools.model_server_app.utils import (
    AA_LIST,
    validate_missense_residues,
    crop_sequence_around_mutation,
    encode_pdb_to_3di,
    compute_scientific_metrics,
    build_saprot_sequence,
    to_saprot_3di,
    validate_saprot_tokenization
)
from tools.model_server_app import models
from tools.model_server_app.routers.vesm import RemoteFailure, VesmRequest, predict_vesm_sync, remote_failures
from tools.model_server_app.engine_resilience import (
    InvalidProviderResponse,
    PERMANENT_STATUSES,
    account_level_refusal,
    extract_status,
    with_remote_failure,
)

# Every path scores the hidden residue (Meier et al. 2021), recorded on the result.
SCORING_METHOD = "masked-marginal"

router = APIRouter()

class SaprotRequest(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    wtPdb: str | None = None
    hfToken: str | None = None
    modelName: str = "westlake-repl/SaProt_650M_AF2"
    preferRemote: bool = False
    engine: str | None = None

class SaprotPreferenceItem(BaseModel):
    aa: str
    prob: float

class SaprotLocalShiftItem(BaseModel):
    position: int
    residue: str
    shift: float

class SaprotResponse(BaseModel):
    status: str
    wtProbability: float | None = None
    mutProbability: float | None = None
    llr: float | None = None
    preferences: list[SaprotPreferenceItem] | None = None
    mutRank: int | None = None
    positionalEntropy: float | None = None
    embeddingShift: float | None = None
    localShiftMap: list[SaprotLocalShiftItem] | None = None
    klDivergence: float | None = None
    conformationState: str | None = None
    provenance: str | None = None
    checkpoint: str | None = None
    scoringMethod: str | None = None
    hfError: str | None = None
    # Why the remote tier produced no score. Distinct from hfError only in emphasis: the card must
    # be able to say *which engine* it is describing rather than presenting one engine's failure as
    # the reason the headline model is missing.
    remoteEngineNote: str | None = None
    remoteFailure: RemoteFailure | None = None
    # Why every local SaProt candidate failed, i.e. the reason this response is VESM's numbers under
    # a SaProt heading. Previously printed and dropped, so the fallback was unexplainable.
    fallbackReason: str | None = None
    verdict: str | None = None
    error: str | None = None

def parse_saprot_fill_mask_scores(preds, expected_wt: str = None, expected_mut: str = None) -> dict[str, float]:
    """
    Probabilities over the 20 residues from a fill-mask answer. A distribution that lacks any residue is
    refused: padding the gaps with a tiny number would make the rank and entropy look complete.
    `expected_wt` and `expected_mut` are kept for callers; the completeness check covers both.
    """
    scores = {}
    for item in preds:
        raw_tok = item.token_str if hasattr(item, "token_str") else (item.get("token_str", "") if isinstance(item, dict) else "")
        candidate = raw_tok.strip().lstrip("Ġ ").strip()
        if not candidate or candidate.startswith(("<", "[", "#")):
            continue

        first_char = candidate[0].upper()
        if first_char not in AA_LIST:
            continue

        raw_score = item.score if hasattr(item, "score") else (item.get("score", 0.0) if isinstance(item, dict) else 0.0)
        try:
            score_val = float(raw_score)
        except (TypeError, ValueError):
            continue

        if not np.isfinite(score_val) or score_val <= 0:
            continue

        if first_char not in scores or score_val > scores[first_char]:
            scores[first_char] = score_val

    matched_aas = [aa for aa in AA_LIST if aa in scores]
    if len(matched_aas) < 2:
        raise InvalidProviderResponse(
            f"SaProt fill_mask returned insufficient valid amino acid tokens ({len(matched_aas)}/20 matched): "
            "the engine served a vocabulary with no residue tokens, so it cannot score SaProt's "
            "structure-aware (3Di-pair) output. Score this model on the local engine instead."
        )

    if len(matched_aas) < len(AA_LIST):
        raise InvalidProviderResponse(
            f"SaProt fill_mask returned {len(matched_aas)} of 20 residue tokens; an incomplete distribution is not scored."
        )

    total_score = sum(scores.values())
    if total_score <= 0 or not np.isfinite(total_score):
        raise InvalidProviderResponse(f"SaProt fill_mask invalid total score: {total_score}")

    probs = {aa: (scores[aa] / total_score) for aa in AA_LIST}
    prob_vals = list(probs.values())
    if np.std(prob_vals) < 1e-6:
        raise InvalidProviderResponse("SaProt fill_mask produced a degenerate uniform distribution.")

    return probs

def run_saprot_remote(model_name: str, sequence: str, pos: int, wt: str, mut: str, token: str, wt_pdb: str, start_offset: int = 0):
    from huggingface_hub import InferenceClient
    # Bounded, like the ESM-2 remote tier: the Node layer gives the whole sidecar call a fixed budget.
    client = InferenceClient(token=token, timeout=float(os.environ.get("SAPROT_REMOTE_TIMEOUT_S", "30")))

    wt_sequence = sequence.upper()
    
    if wt_pdb:
        seq_3di = encode_pdb_to_3di(wt_pdb, len(wt_sequence), start_idx=start_offset + 1, target_seq=wt_sequence)
    else:
        seq_3di = "#" * len(wt_sequence)
        
    # The 3Di alphabet is normalised to SaProt's lower-case pair tokens inside the helper: an
    # upper-case state ("D") builds "RD", which is absent from the vocabulary and collapses the
    # whole request to <unk>.
    masked_seq = build_saprot_sequence(wt_sequence, seq_3di, mask_index=pos - 1)

    s_pos = to_saprot_3di(seq_3di)[pos - 1]
    targets = [aa + s_pos for aa in AA_LIST]

    candidate_models = [model_name]
    if model_name != "westlake-repl/SaProt_35M_AF2":
        candidate_models.append("westlake-repl/SaProt_35M_AF2")

    preds = None
    last_err = None
    chosen_model = model_name

    for cand_model in candidate_models:
        try:
            print(f"[Model Server] Attempting remote fill_mask on {cand_model}...")
            try:
                preds = client.fill_mask(masked_seq, model=cand_model, targets=targets, top_k=50)
            except Exception as e_targets:
                if extract_status(e_targets) in PERMANENT_STATUSES:
                    raise e_targets
                print(f"[Model Server] targets call on {cand_model} failed: {e_targets}. Retrying with top_k=50...")
                preds = client.fill_mask(masked_seq, model=cand_model, top_k=50)
            
            # Verify parsed scores are valid
            probs = parse_saprot_fill_mask_scores(preds, expected_wt=wt, expected_mut=mut)
            chosen_model = cand_model
            break
        except Exception as cand_err:
            print(f"[Model Server] Remote candidate {cand_model} failed: {cand_err}")
            last_err = cand_err
            preds = None
            if extract_status(cand_err) in PERMANENT_STATUSES:
                break

    if preds is None or "probs" not in locals():
        raise RuntimeError(f"All remote SaProt models failed: {last_err}") from last_err

    wt_prob = probs.get(wt, 1e-9)
    mut_prob = probs.get(mut, 1e-9)

    llr = float(np.log(mut_prob + 1e-9) - np.log(wt_prob + 1e-9))

    preferences = [{"aa": aa, "prob": round(probs[aa], 6)} for aa in AA_LIST]
    preferences.sort(key=lambda x: x["prob"], reverse=True)

    mut_rank = 1
    for idx, pref in enumerate(preferences):
        if pref["aa"] == mut:
            mut_rank = idx + 1
            break
            
    pos_entropy = float(-sum(p * np.log2(p) for p in probs.values() if p > 0))
    
    wt_seq_sa = build_saprot_sequence(wt_sequence, seq_3di)
    mut_seq_chars = list(wt_sequence)
    mut_seq_chars[pos - 1] = mut
    mut_sequence = "".join(mut_seq_chars)
    mut_seq_sa = build_saprot_sequence(mut_sequence, seq_3di)
    
    # Left as None, not 0.0: HF's filler API exposes no per-residue feature extraction for
    # SaProt's 3Di tokens, and a coerced zero is indistinguishable from a measured zero shift
    # once it reaches the model card.
    embedding_shift: float | None = None
    local_shift_map = []
    try:
        wt_emb = np.array(client.feature_extraction(wt_seq_sa, model=chosen_model))
        if wt_emb.ndim == 3:
            wt_emb = wt_emb[0]
            
        mut_emb = np.array(client.feature_extraction(mut_seq_sa, model=chosen_model))
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
                    "position": target_token_idx + start_offset,
                    "residue": res_char,
                    "shift": round(shift_val, 4)
                })
    except Exception as e:
        print(f"[Model Server] SaProt remote feature extraction skipped (not supported by HF API): {e}")

    # Remote fill_mask predicts conditional token likelihoods at a masked position, not full unmasked logits.
    # Computing true 3Di structural KL divergence requires unmasked sequence forward evaluation.
    # Per Zero-Heuristics Policy: strictly return None rather than fabricating zero divergence.
    kl_div = None

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
        "klDivergence": kl_div,
        "conformationState": s_pos,
        "provenance": f"SaProt ({chosen_model.split('/')[-1]} - Remote)",
        "checkpoint": chosen_model,
        "scoringMethod": SCORING_METHOD,
    }

def predict_saprot_sync(req: SaprotRequest):
    validate_missense_residues(req.wt, req.mut)
    sequence = req.sequence.upper()
    wt = req.wt.upper()
    mut = req.mut.upper()
    pos = req.position
    # The VESM stand-in crops for itself and reports positions in full-protein numbering; handing it the
    # SaProt window would lose the offset and label residues from the window's start.
    full_sequence, full_pos = sequence, pos

    # Window sequence to 510 residues so sequence + 3Di pairs remain strictly within 1026 position embeddings
    sequence, pos, start_offset = crop_sequence_around_mutation(sequence, pos, 510)
            
    if pos < 1 or pos > len(sequence):
        raise HTTPException(status_code=400, detail=f"Position {pos} out of bounds.")
    if sequence[pos - 1] != wt:
        raise HTTPException(status_code=400, detail="Wild-type AA mismatch.")

    try:
        if getattr(req, "engine", None) == "saprot-35m" and req.modelName == "westlake-repl/SaProt_650M_AF2":
            req.modelName = "westlake-repl/SaProt_35M_AF2"

        hf_error_detail = None
        remote_engine_note = None
        # Tracks whether SaProt itself served this request, for the health status in the finally
        # block: reporting "ready" after a fallback made a host that could never load SaProt look
        # healthy from the outside.
        saprot_available = False
        should_prefer_remote = getattr(req, "preferRemote", False) or getattr(req, "engine", None) == "remote-hf"
        hf_blocked = (
            remote_failures.blocked_reason("saprot", "huggingface", req.hfToken)
            or account_level_refusal(remote_failures.blocked_reason("esm2", "huggingface", req.hfToken))
        ) if (req.hfToken and should_prefer_remote) else None
        if hf_blocked:
            hf_error_detail = f"remote skipped (recent refusal): {hf_blocked}"
            remote_engine_note = hf_error_detail
            print(f"[Model Server] SaProt remote skipped: {hf_blocked}")
        elif req.hfToken and should_prefer_remote:
            models.model_status["saprot"] = "remote_inference"
            try:
                print(f"[Model Server] Querying SaProt remotely via HF Serverless Inference API (model={req.modelName})...")
                result = run_saprot_remote(req.modelName, sequence, pos, wt, mut, req.hfToken, req.wtPdb, start_offset=start_offset)
                print(f"[Model Server] SaProt remote call succeeded.")
                saprot_available = True
                return result
            except Exception as e:
                import traceback
                hf_error_detail = remote_failures.record("saprot", "huggingface", req.hfToken, e)
                remote_engine_note = hf_error_detail
                print(f"[Model Server] SaProt remote run FAILED: {hf_error_detail}")
                print(traceback.format_exc())

        # Local CPU / GPU inference via PyTorch (zero CUDA requirement)
        engine_choice = getattr(req, "engine", None)
        if engine_choice == "saprot-35m":
            target_models = ["westlake-repl/SaProt_35M_AF2"]
        elif engine_choice == "saprot-650m":
            target_models = ["westlake-repl/SaProt_650M_AF2", "westlake-repl/SaProt_35M_AF2"]
        elif not torch.cuda.is_available():
            # On CPU without explicit 650M selection, prioritize the fast 35M model (~1.5s) to avoid CPU timeout
            target_models = ["westlake-repl/SaProt_35M_AF2", "westlake-repl/SaProt_650M_AF2"]
        else:
            target_models = [req.modelName]
            if req.modelName != "westlake-repl/SaProt_35M_AF2":
                target_models.append("westlake-repl/SaProt_35M_AF2")

        last_local_err = None
        # Every candidate's failure, kept so the fallback can report all of them rather than only
        # whichever model happened to be tried last.
        local_errors: list[str] = []
        for model_candidate in target_models:
            try:
                print(f"[Model Server] Attempting local SaProt execution using {model_candidate}...")
                models.model_status["saprot"] = "loading_into_ram"
                tokenizer, model = models.get_saprot_model(model_candidate, token=req.hfToken)
                saprot_available = True
                device = next(model.parameters()).device
                
                if req.wtPdb:
                    models.model_status["saprot"] = "generating_3di_tokens"
                    seq_3di = encode_pdb_to_3di(req.wtPdb, len(sequence), start_idx=start_offset + 1, target_seq=sequence)
                else:
                    seq_3di = "#" * len(sequence)
                    
                models.model_status["saprot"] = "scoring_perturbation"
                seq_sa = build_saprot_sequence(sequence, seq_3di)
                
                inputs = tokenizer(seq_sa, return_tensors="pt")
                inputs = {k: v.to(device) for k, v in inputs.items()}
                # A vocabulary mismatch is refused here, at the tokenisation that caused it, rather
                # than surfacing as an IndexError from logits[pos] further down.
                validate_saprot_tokenization(int(inputs["input_ids"].shape[-1]), len(sequence))
                
                with models.cpu_gate.acquire(priority=1), torch.inference_mode():
                    outputs = model(**inputs, output_hidden_states=True)
                    
                hidden_states = outputs.hidden_states[-1][0]

                # The residue is scored with itself hidden, as on the remote path; the unmasked pass
                # above is only for the embeddings. Reading the visible residue's own distribution
                # partly measures the model copying what it was shown.
                masked_inputs = tokenizer(build_saprot_sequence(sequence, seq_3di, mask_index=pos - 1), return_tensors="pt")
                masked_inputs = {k: v.to(device) for k, v in masked_inputs.items()}
                validate_saprot_tokenization(int(masked_inputs["input_ids"].shape[-1]), len(sequence))
                with models.cpu_gate.acquire(priority=1), torch.inference_mode():
                    masked_logits = model(**masked_inputs).logits[0]

                s_pos = to_saprot_3di(seq_3di)[pos - 1]
                
                vocab_map = {}
                for aa in AA_LIST:
                    tok_str = aa + s_pos
                    tok_id = tokenizer.convert_tokens_to_ids(tok_str)
                    if tok_id == tokenizer.unk_token_id or tok_id is None:
                        tok_id = tokenizer.convert_tokens_to_ids(aa + "#")
                    vocab_map[aa] = tok_id
                    
                wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
                    masked_logits, pos, wt, mut, vocab_map
                )

                mut_seq_chars = list(sequence)
                mut_seq_chars[pos - 1] = mut
                mut_sequence = "".join(mut_seq_chars)
                mut_seq_sa = build_saprot_sequence(mut_sequence, seq_3di)
                
                mut_inputs = tokenizer(mut_seq_sa, return_tensors="pt")
                mut_inputs = {k: v.to(device) for k, v in mut_inputs.items()}
                validate_saprot_tokenization(int(mut_inputs["input_ids"].shape[-1]), len(mut_sequence))
                with models.cpu_gate.acquire(priority=1), torch.inference_mode():
                    mut_outputs = model(**mut_inputs, output_hidden_states=True)
                    
                mut_hidden_states = mut_outputs.hidden_states[-1][0]
                
                seq_len = min(hidden_states.size(0), mut_hidden_states.size(0))
                diff = hidden_states[:seq_len] - mut_hidden_states[:seq_len]
                distances = torch.norm(diff, p=2, dim=-1)
                
                embedding_shift = round(distances[pos].item(), 4)
                
                local_shift_map = []
                for i in range(-10, 11):
                    target_token_idx = pos + i
                    if 1 <= target_token_idx < seq_len - 1:
                        shift_val = distances[target_token_idx].item()
                        res_char = sequence[target_token_idx - 1]
                        local_shift_map.append({
                            "position": target_token_idx + start_offset,
                            "residue": res_char,
                            "shift": round(shift_val, 4)
                        })
                        
                provenance_label= f"SaProt ({model_candidate.split('/')[-1]} - Local CPU)" if device.type == "cpu" else f"SaProt ({model_candidate.split('/')[-1]})"
                
                return {
                    "status": "success",
                    "wtProbability": wt_prob,
                    "mutProbability": mut_prob,
                    "llr": llr,
                    "preferences": preferences,
                    "mutRank": mut_rank,
                    "positionalEntropy": pos_entropy,
                    "embeddingShift": embedding_shift,
                    "localShiftMap": local_shift_map,
                    # Not reported: with the site hidden in both alleles a site KL is 0 by construction, and
                    # an unmasked one measures the model copying the residue it can see.
                    "klDivergence": None,
                    "conformationState": s_pos,
                    "provenance": provenance_label,
                    "checkpoint": model_candidate,
                    "scoringMethod": SCORING_METHOD,
                    "hfError": hf_error_detail,
                    "remoteEngineNote": remote_engine_note
                }
            except Exception as local_err:
                print(f"[Model Server] SaProt candidate {model_candidate} failed: {local_err}")
                last_local_err = local_err
                local_errors.append(f"{model_candidate.split('/')[-1]}: {type(local_err).__name__}: {local_err}")

        # Fallback to VESM-150M if all SaProt attempts fail.
        #
        # The local failure is returned, not merely printed: without it a response whose numbers come
        # from a different model can only say "SaProt unavailable", which is exactly the ambiguity
        # that makes this ladder unreadable from the UI.
        fallback_reason = "; ".join(local_errors) if local_errors else "no local SaProt candidate was attempted"
        print(f"[Model Server] All SaProt candidates failed ({fallback_reason}). Falling back to VESM-150M.")
        vesm_req = VesmRequest(sequence=full_sequence, position=full_pos, wt=wt, mut=mut)
        vesm_res = predict_vesm_sync(vesm_req)
        vesm_res["klDivergence"] = None  # Zero-heuristics compliant: VESM cannot compute 3Di structural KL divergence
        vesm_res["conformationState"] = "#"
        vesm_res["provenance"] = "VESM-150M (Local Fallback - SaProt unavailable)"
        vesm_res["hfError"] = hf_error_detail
        vesm_res["remoteEngineNote"] = remote_engine_note
        vesm_res["fallbackReason"] = fallback_reason
        return vesm_res
    finally:
        models.model_status["saprot"] = "ready" if saprot_available else "unavailable"

_inference_semaphore = asyncio.Semaphore(1)

@router.post("/predict/saprot", response_model=SaprotResponse)
async def predict_saprot(req: SaprotRequest):
    async with _inference_semaphore:
        return with_remote_failure(await asyncio.to_thread(predict_saprot_sync, req), "huggingface")
