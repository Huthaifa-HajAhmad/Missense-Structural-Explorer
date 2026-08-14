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
from tools.model_server_app.routers.vesm import VesmRequest, predict_vesm_sync

router = APIRouter()

class Esm2Request(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    hfToken: str | None = None
    modelName: str = "facebook/esm2_t33_650M_UR50D"

def run_esm2_remote(model_name: str, sequence: str, pos: int, wt: str, mut: str, token: str):
    from huggingface_hub import InferenceClient
    client = InferenceClient(token=token)
    
    wt_sequence = sequence.upper()
    masked_seq = wt_sequence[:pos-1] + "<mask>" + wt_sequence[pos:]
    
    targets = ["L", "A", "G", "V", "S", "E", "R", "T", "I", "D", "P", "F", "K", "N", "Q", "Y", "M", "H", "W", "C"]
    
    preds = client.fill_mask(masked_seq, model=model_name, targets=targets, top_k=20)
    
    scores = {}
    for item in preds:
        tok_str = item.token_str if hasattr(item, "token_str") else item["token_str"]
        score_val = item.score if hasattr(item, "score") else item["score"]
        scores[tok_str] = score_val
        
    for aa in targets:
        if aa not in scores:
            scores[aa] = 1e-9
            
    total_score = sum(scores.values())
    probs = {aa: (scores[aa] / total_score) for aa in targets}
    
    wt_prob = probs.get(wt, 1e-9)
    mut_prob = probs.get(mut, 1e-9)
    
    llr = float(np.log(mut_prob + 1e-9) - np.log(wt_prob + 1e-9))
    
    preferences = [{"aa": aa, "prob": round(probs[aa], 6)} for aa in targets]
    preferences.sort(key=lambda x: x["prob"], reverse=True)
    
    mut_rank = 1
    for idx, pref in enumerate(preferences):
        if pref["aa"] == mut:
            mut_rank = idx + 1
            break
            
    pos_entropy = float(-sum(p * np.log2(p) for p in probs.values() if p > 0))
    
    mut_seq_chars = list(wt_sequence)
    mut_seq_chars[pos - 1] = mut
    mut_sequence = "".join(mut_seq_chars)
    
    embedding_shift = 0.0
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

    mut_masked_seq = mut_sequence[:pos-1] + "<mask>" + mut_sequence[pos:]
    mut_preds = client.fill_mask(mut_masked_seq, model=model_name, targets=targets, top_k=20)
    
    mut_scores = {}
    for item in mut_preds:
        tok_str = item.token_str if hasattr(item, "token_str") else item["token_str"]
        score_val = item.score if hasattr(item, "score") else item["score"]
        mut_scores[tok_str] = score_val
        
    for aa in targets:
        if aa not in mut_scores:
            mut_scores[aa] = 1e-9
            
    mut_total_score = sum(mut_scores.values())
    mut_probs = {aa: (mut_scores[aa] / mut_total_score) for aa in targets}
    
    kl_div = float(sum(probs[aa] * np.log((probs[aa] + 1e-9) / (mut_probs[aa] + 1e-9)) for aa in targets))
    
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
        "provenance": f"ESM-2 ({model_name.split('/')[-1]} - Remote)"
    }

def predict_esm2_3b_sync(req: Esm2Request):
    validate_missense_residues(req.wt, req.mut)
    sequence = req.sequence.upper()
    wt = req.wt.upper()
    mut = req.mut.upper()
    pos = req.position
    
    sequence, pos, start_offset = crop_sequence_around_mutation(sequence, pos, 1022)
            
    if pos < 1 or pos > len(sequence):
        raise HTTPException(status_code=400, detail=f"Position {pos} out of bounds.")
    if sequence[pos - 1] != wt:
        raise HTTPException(status_code=400, detail="Wild-type AA mismatch.")

    if req.hfToken:
        try:
            print(f"[Model Server] Querying ESM-2 remotely via HF Serverless Inference API (model={req.modelName})...")
            result = run_esm2_remote(req.modelName, sequence, pos, wt, mut, req.hfToken)
            print(f"[Model Server] ESM-2 remote call succeeded.")
            return result
        except Exception as e:
            import traceback
            print(f"[Model Server] ESM-2 remote run FAILED: {type(e).__name__}: {e}")
            print(traceback.format_exc())
            print(f"[Model Server] Remote failed — checking for CPU fallback path...")

    if not torch.cuda.is_available():
        print(f"[Model Server] No GPU detected. Using VESM-150M for fast CPU inference.")
        vesm_req = VesmRequest(sequence=sequence, position=pos, wt=wt, mut=mut)
        vesm_res = predict_vesm_sync(vesm_req)
        vesm_res["klDivergence"] = 0.0
        vesm_res["provenance"] = "VESM-150M (CPU Local - no GPU)" if not req.hfToken else "VESM-150M (CPU Fallback - remote failed)"
        return vesm_res

    try:
        tokenizer, model = models.get_esm2_model(req.modelName, token=req.hfToken)
        device = next(model.parameters()).device
        inputs = tokenizer(sequence, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = model(**inputs, output_hidden_states=True)
            
        logits = outputs.logits[0]
        hidden_states = outputs.hidden_states[-1][0]
        
        vocab_map = {aa: tokenizer.convert_tokens_to_ids(aa) for aa in AA_LIST}
        
        wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
            logits, pos, wt, mut, vocab_map
        )
        
        mut_seq_chars = list(sequence)
        mut_seq_chars[pos - 1] = mut
        mut_sequence = "".join(mut_seq_chars)
        
        mut_inputs = tokenizer(mut_sequence, return_tensors="pt")
        mut_inputs = {k: v.to(device) for k, v in mut_inputs.items()}
        with torch.no_grad():
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
                    "position": target_token_idx,
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
            "provenance": f"ESM-2 ({req.modelName.split('/')[-1]})"
        }
    except Exception as e:
        print(f"[Model Server] ESM-2 local run failed: {e}. Falling back to VESM-150M.")
        vesm_req = VesmRequest(sequence=sequence, position=pos, wt=wt, mut=mut)
        vesm_res = predict_vesm_sync(vesm_req)
        vesm_res["klDivergence"] = 0.0
        vesm_res["provenance"] = "VESM-150M (Local Fallback)"
        return vesm_res

@router.post("/predict/esm2_3b")
async def predict_esm2_3b(req: Esm2Request):
    return await asyncio.to_thread(predict_esm2_3b_sync, req)
