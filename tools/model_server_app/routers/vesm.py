import torch
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tools.model_server_app.utils import (
    AA_LIST,
    validate_missense_residues,
    crop_sequence_around_mutation,
    compute_scientific_metrics
)
from tools.model_server_app import models

router = APIRouter()

class VesmRequest(BaseModel):
    sequence: str
    position: int
    wt: str
    mut: str
    biohubToken: str | None = None

@router.post("/predict/vesm")
def predict_vesm(req: VesmRequest):
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

    # 1. If remote Biohub Token is configured, route via ESMCForgeInferenceClient
    if req.biohubToken:
        try:
            from esm.sdk.forge import ESMCForgeInferenceClient
            from esm.sdk.api import ESMProtein, LogitsConfig

            client = ESMCForgeInferenceClient(
                model="esmc-6b-2024-12",
                url="https://biohub.ai",
                token=req.biohubToken
            )
            protein = ESMProtein(sequence=sequence)
            protein_tensor = client.encode(protein)
            
            config = LogitsConfig(sequence=True, return_embeddings=True)
            logits_output = client.logits(protein_tensor, config)
            
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

            raw_embs = getattr(logits_output, "embeddings", None)
            if raw_embs is not None:
                raw_embs_tensor = torch.tensor(raw_embs) if not isinstance(raw_embs, torch.Tensor) else raw_embs
                embeddings = raw_embs_tensor[0] if raw_embs_tensor.ndim > 2 else raw_embs_tensor
            else:
                raise ValueError("Could not find embeddings in client response")
            
            vocab_map = {}
            if hasattr(client, "tokenizer") and client.tokenizer:
                try:
                    vocab_map = {aa: client.tokenizer.encode(aa)[0] for aa in AA_LIST}
                except Exception:
                    pass
            
            if not vocab_map:
                try:
                    for aa in AA_LIST:
                        p_aa = ESMProtein(sequence=aa)
                        pt_aa = client.encode(p_aa)
                        vocab_map[aa] = int(pt_aa.sequence[1].item())
                except Exception as ve:
                    print(f"[Model Server] Failed to build dynamic ESMC vocab map: {ve}. Using fallback order.")
                    vocab_map = {aa: i for i, aa in enumerate(AA_LIST)}

            wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
                logits, pos, wt, mut, vocab_map
            )

            mut_seq_chars = list(sequence)
            mut_seq_chars[pos - 1] = mut
            mut_sequence = "".join(mut_seq_chars)
            mut_protein = ESMProtein(sequence=mut_sequence)
            mut_protein_tensor = client.encode(mut_protein)
            
            mut_logits_output = client.logits(mut_protein_tensor, config)
            raw_mut_embs = getattr(mut_logits_output, "embeddings", None)
            if raw_mut_embs is not None:
                raw_mut_embs_tensor = torch.tensor(raw_mut_embs) if not isinstance(raw_mut_embs, torch.Tensor) else raw_mut_embs
                mut_embeddings = raw_mut_embs_tensor[0] if raw_mut_embs_tensor.ndim > 2 else raw_mut_embs_tensor
            else:
                raise ValueError("Could not find mutant embeddings in client response")

            diff = embeddings - mut_embeddings
            distances = torch.norm(diff, p=2, dim=-1)
            embedding_shift = round(distances[pos].item(), 4)
            
            local_shift_map = []
            for i in range(-10, 11):
                target_pos = pos + i
                if 1 <= target_pos < len(sequence) - 1:
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
                "localShiftMap": local_shift_map,
                "provenance": "ESMC-6B (Remote)",
                "verdict": "raw score"
            }
        except Exception as e:
            print(f"[Model Server Remote ESMC Error]: {e}. Falling back to local model.")

    # 2. Local Fallback (VESM-150M)
    if models.vesm_model is None or models.vesm_tokenizer is None:
        try:
            models.load_vesm()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"VESM model is not loaded: {e}")

    try:
        seq_chars = list(sequence)
        seq_chars[pos - 1] = models.vesm_tokenizer.mask_token
        masked_seq = "".join(seq_chars)

        inputs = models.vesm_tokenizer(masked_seq, return_tensors="pt")
        with torch.no_grad():
            outputs = models.vesm_model(**inputs)
            logits = outputs.logits

        mask_token_id = models.vesm_tokenizer.mask_token_id
        mask_indices = (inputs["input_ids"][0] == mask_token_id).nonzero(as_tuple=True)[0]
        token_idx = mask_indices[0].item()

        vocab_map = {aa: models.vesm_tokenizer.convert_tokens_to_ids(aa) for aa in AA_LIST}

        wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
            logits[0], token_idx, wt, mut, vocab_map
        )

        wt_inputs = models.vesm_tokenizer(sequence, return_tensors="pt")
        mut_seq_chars = list(sequence)
        mut_seq_chars[pos - 1] = mut
        mut_seq = "".join(mut_seq_chars)
        mut_inputs = models.vesm_tokenizer(mut_seq, return_tensors="pt")

        with torch.no_grad():
            wt_outputs = models.vesm_model(**wt_inputs, output_hidden_states=True)
            mut_outputs = models.vesm_model(**mut_inputs, output_hidden_states=True)
            
            wt_emb = wt_outputs.hidden_states[-1][0]
            mut_emb = mut_outputs.hidden_states[-1][0]
            
            seq_len = min(wt_emb.size(0), mut_emb.size(0))
            diff = wt_emb[:seq_len] - mut_emb[:seq_len]
            distances = torch.norm(diff, p=2, dim=-1)

        embedding_shift = round(distances[pos].item(), 4)
        
        local_shift_map = []
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
            "localShiftMap": local_shift_map,
            "provenance": "VESM-150M (Local)",
            "verdict": "raw score"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
