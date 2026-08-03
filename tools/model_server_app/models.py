import os
import sys
import torch
from tools.esm2_eval import download_weights

vesm_tokenizer = None
vesm_model = None

esm2_models = {}
saprot_models = {}

def get_esm2_model(model_name: str, token: str = None):
    if model_name in esm2_models:
        return esm2_models[model_name]
    from transformers import AutoTokenizer, EsmForMaskedLM
    print(f"[Model Server] Loading ESM-2 model: {model_name}...")
    tokenizer = AutoTokenizer.from_pretrained(model_name, token=token)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = EsmForMaskedLM.from_pretrained(model_name, torch_dtype=dtype, token=token)
    model.to(device)
    model.eval()
    print(f"[Model Server] ESM-2 model {model_name} loaded successfully on {device}.")
    esm2_models[model_name] = (tokenizer, model)
    return tokenizer, model

def get_saprot_model(model_name: str, token: str = None):
    if model_name in saprot_models:
        return saprot_models[model_name]
    from transformers import AutoTokenizer, EsmForMaskedLM
    print(f"[Model Server] Loading SaProt model: {model_name}...")
    tokenizer = AutoTokenizer.from_pretrained(model_name, token=token)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = EsmForMaskedLM.from_pretrained(model_name, torch_dtype=dtype, token=token)
    model.to(device)
    model.eval()
    print(f"[Model Server] SaProt model {model_name} loaded successfully on {device}.")
    saprot_models[model_name] = (tokenizer, model)
    return tokenizer, model

def load_vesm():
    global vesm_tokenizer, vesm_model
    if vesm_model is not None:
        return
    from transformers import AutoTokenizer, EsmForMaskedLM
    model_name = "VESM_150M"
    base_model_name = "facebook/esm2_t30_150M_UR50D"
    local_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "vesm")
    weights_path = download_weights(repo_id="ntranoslab/vesm", filename=f"{model_name}.pth", local_dir=local_dir)
    vesm_tokenizer = AutoTokenizer.from_pretrained(base_model_name)
    vesm_model = EsmForMaskedLM.from_pretrained(base_model_name)
    
    state_dict = torch.load(weights_path, map_location="cpu", weights_only=True)
    
    model_keys = set(vesm_model.state_dict().keys())
    ckpt_keys = set(state_dict.keys())
    
    missing_keys = model_keys - ckpt_keys
    unexpected_keys = ckpt_keys - model_keys
    
    if missing_keys:
        print(f"[Model Server] Warning: Missing keys in state dict: {missing_keys}", file=sys.stderr)
    if unexpected_keys:
        print(f"[Model Server] Warning: Unexpected keys in state dict: {unexpected_keys}", file=sys.stderr)
        
    non_buffer_missing = {k for k in missing_keys if "inv_freq" not in k}
    if non_buffer_missing:
        raise RuntimeError(f"Failed to load VESM model: critical weight keys are missing: {non_buffer_missing}")
        
    for k in list(state_dict.keys()):
        if k in unexpected_keys:
            del state_dict[k]
            
    for k in missing_keys:
        if k not in state_dict:
            state_dict[k] = vesm_model.state_dict()[k]
            
    vesm_model.load_state_dict(state_dict, strict=True)
    vesm_model.eval()
    
    emb_weight = vesm_model.esm.embeddings.word_embeddings.weight
    print(f"[Model Server] VESM_150M model loaded successfully with strict=True.")
    print(f"[Model Server] Validation - word embeddings stats: mean={emb_weight.mean().item():.6f}, std={emb_weight.std().item():.6f}")

def clear_vesm():
    global vesm_tokenizer, vesm_model
    vesm_tokenizer = None
    vesm_model = None
