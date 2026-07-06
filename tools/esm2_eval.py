# /// script
# dependencies = [
#   "torch",
#   "transformers"
# ]
# ///

import sys
import json
import torch
from transformers import AutoTokenizer, AutoModelForMaskedLM

def compute_llr(sequence: str, pos: int, wt: str, mut: str):
    model_name = "facebook/esm2_t6_8M_UR50D"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForMaskedLM.from_pretrained(model_name)
    
    # Standardize
    sequence = sequence.upper()
    wt = wt.upper()
    mut = mut.upper()
    
    if pos < 1 or pos > len(sequence):
        raise ValueError(f"Position {pos} is out of bounds for sequence of length {len(sequence)}")
        
    if sequence[pos - 1] != wt:
        raise ValueError(f"Wild-type amino acid mismatch: expected '{wt}' at position {pos}, but found '{sequence[pos - 1]}'")
        
    # Masked marginal approach: mask the mutated position
    seq_chars = list(sequence)
    seq_chars[pos - 1] = tokenizer.mask_token
    masked_seq = "".join(seq_chars)
    
    # Tokenize
    inputs = tokenizer(masked_seq, return_tensors="pt")
    
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits # shape: (1, seq_len, vocab_size)
        
    # Map token ids
    wt_id = tokenizer.convert_tokens_to_ids(wt)
    mut_id = tokenizer.convert_tokens_to_ids(mut)
    
    if wt_id == tokenizer.unk_token_id or mut_id == tokenizer.unk_token_id:
        raise ValueError(f"Invalid amino acid character: '{wt}' or '{mut}'")
        
    # Find position index in tokenized output
    mask_token_id = tokenizer.mask_token_id
    mask_indices = (inputs["input_ids"][0] == mask_token_id).nonzero(as_tuple=True)[0]
    
    if len(mask_indices) == 0:
        raise ValueError("Mask token not found in tokenized input")
    token_idx = mask_indices[0].item()
    
    # Compute Log-Likelihood Ratio
    pos_logits = logits[0, token_idx]
    pos_log_probs = torch.log_softmax(pos_logits, dim=-1)
    
    mut_log_prob = pos_log_probs[mut_id].item()
    wt_log_prob = pos_log_probs[wt_id].item()
    
    llr = mut_log_prob - wt_log_prob
    return round(llr, 4)

if __name__ == "__main__":
    if len(sys.argv) < 5:
        print(json.dumps({"status": "error", "message": "Usage: python esm2_eval.py [SEQUENCE] [1_INDEXED_POSITION] [WT_1_LETTER] [MUT_1_LETTER]"}))
        sys.exit(1)
        
    seq = sys.argv[1]
    try:
        pos = int(sys.argv[2])
    except ValueError:
        print(json.dumps({"status": "error", "message": "Position must be an integer"}))
        sys.exit(1)
        
    wt = sys.argv[3]
    mut = sys.argv[4]
    
    try:
        llr = compute_llr(seq, pos, wt, mut)
        verdict = "pathogenic" if llr <= -6.0 else "benign"
        print(json.dumps({
            "status": "success",
            "llr": llr,
            "verdict": verdict
        }))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)
