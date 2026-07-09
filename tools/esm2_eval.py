# /// script
# dependencies = [
#   "torch",
#   "transformers",
#   "huggingface_hub"
# ]
# ///

import sys
import json
import torch
import os
import time
from transformers import AutoTokenizer, EsmForMaskedLM
from huggingface_hub import hf_hub_download
from huggingface_hub.utils import disable_progress_bars

# Programmatically disable tqdm progress bars to prevent TTY hangs in background tasks
disable_progress_bars()

def download_weights(repo_id, filename, local_dir):
    os.makedirs(local_dir, exist_ok=True)
    weights_path = os.path.join(local_dir, filename)
    if os.path.exists(weights_path) and os.path.getsize(weights_path) > 10 * 1024 * 1024:
        return weights_path

    print(f"Downloading {filename} from {repo_id}...")
    for attempt in range(1, 6):
        try:
            hf_hub_download(repo_id=repo_id, filename=filename, local_dir=local_dir)
            if os.path.exists(weights_path) and os.path.getsize(weights_path) > 10 * 1024 * 1024:
                print(f"Successfully downloaded {filename} ({os.path.getsize(weights_path)} bytes)")
                return weights_path
        except Exception as e:
            print(f"Attempt {attempt}/5 failed: {str(e)}")
            # Cleanup any partial download
            part_path = weights_path + ".part"
            for p in [weights_path, part_path]:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except:
                        pass
            time.sleep(3)
            
    raise RuntimeError(f"Failed to download {filename} after 5 attempts.")

def compute_llr(sequence: str, pos: int, wt: str, mut: str):
    model_name = "VESM_150M"
    base_model_name = "facebook/esm2_t30_150M_UR50D"
    
    # Download pretrained VESM weights locally in tools/vesm
    local_dir = os.path.join(os.path.dirname(__file__), "vesm")
    weights_path = download_weights(repo_id="ntranoslab/vesm", filename=f"{model_name}.pth", local_dir=local_dir)
        
    tokenizer = AutoTokenizer.from_pretrained(base_model_name)
    model = EsmForMaskedLM.from_pretrained(base_model_name)
    
    # Load pretrained VESM weights
    state_dict = torch.load(weights_path, map_location="cpu")
    model.load_state_dict(state_dict, strict=False)
    
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
        print(json.dumps({
            "status": "success",
            "llr": llr,
            "verdict": "raw score"
        }))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)
