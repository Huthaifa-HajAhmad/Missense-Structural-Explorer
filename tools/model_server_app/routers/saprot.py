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
    compute_scientific_metrics
)
from tools.model_server_app import models
from tools.model_server_app.routers.vesm import VesmRequest, predict_vesm_sync

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

def parse_saprot_fill_mask_scores(preds, expected_wt: str = None, expected_mut: str = None) -> dict[str, float]:
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
        raise ValueError(f"SaProt fill_mask returned insufficient valid amino acid tokens ({len(matched_aas)}/20 matched).")

    if (expected_wt and expected_mut) and (expected_wt not in scores and expected_mut not in scores):
        raise ValueError(f"SaProt fill_mask missing both expected WT ({expected_wt}) and MUT ({expected_mut}) in candidate scores.")

    for aa in AA_LIST:
        if aa not in scores:
            scores[aa] = 1e-9

    total_score = sum(scores.values())
    if total_score <= 0 or not np.isfinite(total_score):
        raise ValueError(f"SaProt fill_mask invalid total score: {total_score}")

    probs = {aa: (scores[aa] / total_score) for aa in AA_LIST}
    prob_vals = list(probs.values())
    if np.std(prob_vals) < 1e-6:
        raise ValueError("SaProt fill_mask produced a degenerate uniform distribution.")

    return probs

def run_saprot_remote(model_name: str, sequence: str, pos: int, wt: str, mut: str, token: str, wt_pdb: str, start_offset: int = 0):
    from huggingface_hub import InferenceClient
    client = InferenceClient(token=token)
    
    wt_sequence = sequence.upper()
    
    if wt_pdb:
        seq_3di = encode_pdb_to_3di(wt_pdb, len(wt_sequence), start_idx=start_offset + 1)
    else:
        seq_3di = "#" * len(wt_sequence)
        
    seq_sa_list = []
    for idx, (a, d) in enumerate(zip(wt_sequence, seq_3di)):
        if idx == pos - 1:
            seq_sa_list.append("<mask>")
        else:
            seq_sa_list.append(a + d)
            
    masked_seq = "".join(seq_sa_list)
    
    s_pos = seq_3di[pos - 1]
    targets = [aa + s_pos for aa in AA_LIST]
    
    try:
        preds = client.fill_mask(masked_seq, model=model_name, targets=targets, top_k=20)
    except Exception as e:
        print(f"[Model Server] SaProt remote call for {model_name} failed: {e}. Trying westlake-repl/SaProt_35M_AF2...")
        try:
            model_name = "westlake-repl/SaProt_35M_AF2"
            preds = client.fill_mask(masked_seq, model=model_name, targets=targets, top_k=20)
        except Exception:
            preds = client.fill_mask(masked_seq, model=model_name, top_k=50)

    probs = parse_saprot_fill_mask_scores(preds, expected_wt=wt, expected_mut=mut)

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
    
    wt_seq_sa = "".join(a + d for a, d in zip(wt_sequence, seq_3di))
    mut_seq_chars = list(wt_sequence)
    mut_seq_chars[pos - 1] = mut
    mut_sequence = "".join(mut_seq_chars)
    mut_seq_sa = "".join(a + d for a, d in zip(mut_sequence, seq_3di))
    
    embedding_shift = 0.0
    local_shift_map = []
    try:
        wt_emb = np.array(client.feature_extraction(wt_seq_sa, model=model_name))
        if wt_emb.ndim == 3:
            wt_emb = wt_emb[0]
            
        mut_emb = np.array(client.feature_extraction(mut_seq_sa, model=model_name))
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

    mut_seq_sa_masked_list = []
    for idx, (a, d) in enumerate(zip(mut_sequence, seq_3di)):
        if idx == pos - 1:
            mut_seq_sa_masked_list.append("<mask>")
        else:
            mut_seq_sa_masked_list.append(a + d)
    mut_masked_seq = "".join(mut_seq_sa_masked_list)
    
    mut_preds = []
    try:
        mut_preds = client.fill_mask(mut_masked_seq, model=model_name, targets=targets, top_k=20)
    except Exception as e:
        try:
            mut_preds = client.fill_mask(mut_masked_seq, model=model_name, top_k=50)
        except Exception:
            pass

    try:
        mut_probs = parse_saprot_fill_mask_scores(mut_preds, expected_wt=wt, expected_mut=mut)
    except Exception:
        mut_probs = probs

    kl_div = float(sum(probs[aa] * np.log((probs[aa] + 1e-9) / (mut_probs[aa] + 1e-9)) for aa in AA_LIST))
    
    return {
        "status": "success",
        "wtProbability": round(wt_prob, 6),
        "mutProbability": round(mut_prob, 6),
        "llr": round(llr, 4),
        "preferences": preferences,
        "mutRank": mut_rank,
        "positionalEntropy": round(pos_entropy, 4),
        "embeddingShift": round(embedding_shift, 4),
        "localShiftMap": local_shift_map,
        "klDivergence": round(kl_div, 4),
        "conformationState": s_pos,
        "provenance": f"SaProt ({model_name.split('/')[-1]} - Remote)"
    }

def predict_saprot_sync(req: SaprotRequest):
    validate_missense_residues(req.wt, req.mut)
    sequence = req.sequence.upper()
    wt = req.wt.upper()
    mut = req.mut.upper()
    pos = req.position
    
    # Window sequence to 510 residues so sequence + 3Di pairs remain strictly within 1026 position embeddings
    sequence, pos, start_offset = crop_sequence_around_mutation(sequence, pos, 510)
            
    if pos < 1 or pos > len(sequence):
        raise HTTPException(status_code=400, detail=f"Position {pos} out of bounds.")
    if sequence[pos - 1] != wt:
        raise HTTPException(status_code=400, detail="Wild-type AA mismatch.")

    if getattr(req, "engine", None) == "saprot-35m" and req.modelName == "westlake-repl/SaProt_650M_AF2":
        req.modelName = "westlake-repl/SaProt_35M_AF2"

    hf_error_detail = None
    should_prefer_remote = getattr(req, "preferRemote", False) or getattr(req, "engine", None) == "remote-hf"
    if req.hfToken and should_prefer_remote:
        try:
            print(f"[Model Server] Querying SaProt remotely via HF Serverless Inference API (model={req.modelName})...")
            result = run_saprot_remote(req.modelName, sequence, pos, wt, mut, req.hfToken, req.wtPdb, start_offset=start_offset)
            print(f"[Model Server] SaProt remote call succeeded.")
            return result
        except Exception as e:
            import traceback
            hf_error_detail = f"{type(e).__name__}: {e}"
            print(f"[Model Server] SaProt remote run FAILED: {hf_error_detail}")
            print(traceback.format_exc())

    # Local CPU / GPU inference via PyTorch (zero CUDA requirement)
    target_models = [req.modelName]
    if req.modelName != "westlake-repl/SaProt_35M_AF2":
        target_models.append("westlake-repl/SaProt_35M_AF2")

    last_local_err = None
    for model_candidate in target_models:
        try:
            print(f"[Model Server] Attempting local SaProt execution using {model_candidate}...")
            tokenizer, model = models.get_saprot_model(model_candidate, token=req.hfToken)
            device = next(model.parameters()).device
            
            if req.wtPdb:
                seq_3di = encode_pdb_to_3di(req.wtPdb, len(sequence), start_idx=start_offset + 1)
            else:
                seq_3di = "#" * len(sequence)
                
            seq_sa = "".join(a + d for a, d in zip(sequence, seq_3di))
            
            inputs = tokenizer(seq_sa, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            
            with torch.inference_mode():
                outputs = model(**inputs, output_hidden_states=True)
                
            logits = outputs.logits[0]
            hidden_states = outputs.hidden_states[-1][0]
            
            s_pos = seq_3di[pos - 1]
            
            vocab_map = {}
            for aa in AA_LIST:
                tok_str = aa + s_pos
                tok_id = tokenizer.convert_tokens_to_ids(tok_str)
                if tok_id == tokenizer.unk_token_id or tok_id is None:
                    tok_id = tokenizer.convert_tokens_to_ids(aa + "#")
                vocab_map[aa] = tok_id
                
            wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
                logits, pos, wt, mut, vocab_map
            )
            
            mut_seq_chars = list(sequence)
            mut_seq_chars[pos - 1] = mut
            mut_sequence = "".join(mut_seq_chars)
            mut_seq_sa = "".join(a + d for a, d in zip(mut_sequence, seq_3di))
            
            mut_inputs = tokenizer(mut_seq_sa, return_tensors="pt")
            mut_inputs = {k: v.to(device) for k, v in mut_inputs.items()}
            with torch.inference_mode():
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
                    
            aa_tokens = [vocab_map[aa] for aa in AA_LIST]
            wt_logits = logits[pos]
            wt_std_logits = torch.tensor([wt_logits[tok].item() for tok in aa_tokens])
            p_wt = torch.softmax(wt_std_logits, dim=-1)
            
            mut_logits = mut_outputs.logits[0, pos]
            mut_std_logits = torch.tensor([mut_logits[tok].item() for tok in aa_tokens])
            p_mut = torch.softmax(mut_std_logits, dim=-1)
            
            kl_div = float(torch.sum(p_wt * torch.log((p_wt + 1e-9) / (p_mut + 1e-9))).item())
            
            provenance_label = f"SaProt ({model_candidate.split('/')[-1]} - Local CPU)" if device.type == "cpu" else f"SaProt ({model_candidate.split('/')[-1]})"
            
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
                "klDivergence": round(kl_div, 4),
                "conformationState": s_pos,
                "provenance": provenance_label,
                "hfError": hf_error_detail
            }
        except Exception as local_err:
            print(f"[Model Server] SaProt candidate {model_candidate} failed: {local_err}")
            last_local_err = local_err

    # Fallback to VESM-150M if all SaProt attempts fail
    print(f"[Model Server] All SaProt candidates failed ({last_local_err}). Falling back to VESM-150M.")
    vesm_req = VesmRequest(sequence=sequence, position=pos, wt=wt, mut=mut)
    vesm_res = predict_vesm_sync(vesm_req)
    vesm_res["klDivergence"] = 0.0
    vesm_res["conformationState"] = "#"
    vesm_res["provenance"] = "VESM-150M (Local Fallback - SaProt unavailable)"
    vesm_res["hfError"] = hf_error_detail
    return vesm_res

_inference_semaphore = asyncio.Semaphore(1)

@router.post("/predict/saprot")
async def predict_saprot(req: SaprotRequest):
    async with _inference_semaphore:
        return await asyncio.to_thread(predict_saprot_sync, req)
