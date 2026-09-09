import os
import sys
import gc
import torch
from collections import OrderedDict
from tools.esm2_eval import download_weights

vesm_tokenizer = None
vesm_model = None

import threading

_model_lock = threading.Lock()

MAX_LOADED_MODELS = int(os.environ.get("MAX_LOADED_MODELS", "1"))
loaded_models: "OrderedDict[str, tuple]" = OrderedDict()

# Optimize CPU thread allocation for OCI Ampere A1 (2-4 cores)
if not torch.cuda.is_available():
    torch_threads = int(os.environ.get("TORCH_NUM_THREADS", "2"))
    torch.set_num_threads(torch_threads)
    print(f"[Model Server] PyTorch CPU thread count set to {torch_threads}.")

# Backward-compatible references for router and health check inspections
esm2_models = loaded_models
saprot_models = loaded_models

def clear_gpu_cache():
    """Explicitly runs garbage collection and flushes CUDA GPU cache."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
    print("[Model Server] GPU memory cache cleared.")

def _evict_if_needed(max_size: int = MAX_LOADED_MODELS):
    """Evicts the least recently used model from memory if unified cache limit exceeded.
    Must be called within _model_lock context to ensure thread-safety on multi-threaded runtimes.
    """
    while len(loaded_models) >= max_size:
        evicted_name, (evicted_tok, evicted_mod) = loaded_models.popitem(last=False)
        print(f"[Model Server] Evicting model from memory: {evicted_name}")
        del evicted_tok
        del evicted_mod
        clear_gpu_cache()

# Pinned Hugging Face Hub revisions for absolute reproducibility with env overrides
HF_MODEL_REVISIONS = {
    "facebook/esm2_t33_650M_UR50D": os.environ.get("HF_REV_ESM2_650M", "08e4846e537177426273712802403f7ba8261b6c"),
    "facebook/esm2_t30_150M_UR50D": os.environ.get("HF_REV_ESM2_150M", "a695f6045e2e32885fa60af20c13cb35398ce30c"),
    "westlake-repl/SaProt_650M_AF2": os.environ.get("HF_REV_SAPROT_650M", "d9b9ad00ef61c0990e611b2b43f2231c7de24b38"),
    "westlake-repl/SaProt_35M_AF2": os.environ.get("HF_REV_SAPROT_35M", "f9f257ef5352c3c9c61230e7ea2054ffcfab51d9"),
}

def _safe_load_tokenizer(model_name: str, token: str = None, revision: str = None):
    from transformers import AutoTokenizer
    if revision:
        try:
            return AutoTokenizer.from_pretrained(model_name, token=token, revision=revision)
        except Exception as e:
            print(f"[Model Server Warning] Failed to load tokenizer {model_name} at revision {revision}: {e}. Falling back to default branch...")
    return AutoTokenizer.from_pretrained(model_name, token=token)

def _safe_load_esm_model(model_name: str, dtype, token: str = None, revision: str = None):
    from transformers import EsmForMaskedLM
    kwargs = {"dtype": dtype}
    if token:
        kwargs["token"] = token
    if revision:
        try:
            try:
                return EsmForMaskedLM.from_pretrained(model_name, revision=revision, **kwargs)
            except TypeError:
                return EsmForMaskedLM.from_pretrained(model_name, torch_dtype=dtype, token=token, revision=revision)
        except Exception as e:
            print(f"[Model Server Warning] Failed to load model {model_name} at revision {revision}: {e}. Falling back to default branch...")
    try:
        return EsmForMaskedLM.from_pretrained(model_name, **kwargs)
    except TypeError:
        return EsmForMaskedLM.from_pretrained(model_name, torch_dtype=dtype, token=token)

def get_esm2_model(model_name: str, token: str = None):
    cache_key = f"esm2:{model_name}"
    with _model_lock:
        if cache_key in loaded_models:
            loaded_models.move_to_end(cache_key)
            return loaded_models[cache_key]
        _evict_if_needed()
        print(f"[Model Server] Loading ESM-2 model: {model_name}...")
        revision = HF_MODEL_REVISIONS.get(model_name)
        tokenizer = _safe_load_tokenizer(model_name, token=token, revision=revision)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        model = _safe_load_esm_model(model_name, dtype=dtype, token=token, revision=revision)
        model.to(device)
        model.eval()
        print(f"[Model Server] ESM-2 model {model_name} loaded successfully on {device}.")
        loaded_models[cache_key] = (tokenizer, model)
        return tokenizer, model

def get_saprot_model(model_name: str, token: str = None):
    cache_key = f"saprot:{model_name}"
    with _model_lock:
        if cache_key in loaded_models:
            loaded_models.move_to_end(cache_key)
            return loaded_models[cache_key]
        _evict_if_needed()
        print(f"[Model Server] Loading SaProt model: {model_name}...")
        revision = HF_MODEL_REVISIONS.get(model_name)
        tokenizer = _safe_load_tokenizer(model_name, token=token, revision=revision)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        model = _safe_load_esm_model(model_name, dtype=dtype, token=token, revision=revision)
        model.to(device)
        model.eval()
        print(f"[Model Server] SaProt model {model_name} loaded successfully on {device}.")
        loaded_models[cache_key] = (tokenizer, model)
        return tokenizer, model


model_status: dict[str, str] = {
    "vesm": "standby",
    "thermompnn": "standby",
    "stabilityoracle": "standby",
    "saprot": "standby",
    "esm2": "standby"
}
model_errors: dict[str, str] = {}

def verify_local_checkpoints():
    """
    Dry-runs unpickling and model architecture initialization for StabilityOracle and ThermoMPNN.
    Catches LayerScale/DropPath/AttentionBlock NameErrors or missing weights immediately on startup.
    """
    global model_status, model_errors
    # 1. StabilityOracle validation
    try:
        from tools.model_server_app.routers.stabilityoracle import get_stability_oracle_model
        get_stability_oracle_model()
        model_status["stabilityoracle"] = "ready"
        print("[Model Server Guard] StabilityOracle verified: architecture and weights intact.")
    except Exception as e:
        model_status["stabilityoracle"] = "failed"
        model_errors["stabilityoracle"] = str(e)
        print(f"[Model Server Guard] CRITICAL: StabilityOracle failed startup self-test: {e}", file=sys.stderr)

    # 2. ThermoMPNN validation
    try:
        from tools.model_server_app.routers.thermompnn import get_official_model
        m = get_official_model()
        if m is not None:
            model_status["thermompnn"] = "ready"
            print("[Model Server Guard] ThermoMPNN verified: architecture and weights intact.")
        else:
            model_status["thermompnn"] = "standby"
    except Exception as e:
        model_status["thermompnn"] = "failed"
        model_errors["thermompnn"] = str(e)
        print(f"[Model Server Guard] CRITICAL: ThermoMPNN failed startup self-test: {e}", file=sys.stderr)

def start_background_warmup():
    """Starts background warmup of local models so uvicorn binds port 8000 immediately."""
    import threading
    def _warmup():
        try:
            verify_local_checkpoints()
        except Exception as e:
            print(f"[Model Server Warning] Local checkpoints verification error: {e}")
        try:
            load_vesm()
        except Exception as e:
            print(f"[Model Server Warning] Background VESM warmup deferred: {e}")
    t = threading.Thread(target=_warmup, name="vesm_background_warmup", daemon=True)
    t.start()

def load_vesm():
    global vesm_tokenizer, vesm_model, model_status
    if vesm_model is not None:
        model_status["vesm"] = "ready"
        return
    model_status["vesm"] = "downloading"
    model_name = "VESM_150M"
    base_model_name = "facebook/esm2_t30_150M_UR50D"
    base_revision = HF_MODEL_REVISIONS.get(base_model_name)
    
    hf_home = os.environ.get("HF_HOME")
    if hf_home and os.path.exists(hf_home):
        default_dir = os.path.join(hf_home, "vesm")
    else:
        default_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "vesm")
    local_dir = os.environ.get("VESM_CACHE_DIR", default_dir)
    os.makedirs(local_dir, exist_ok=True)

    try:
        weights_path = download_weights(repo_id="ntranoslab/vesm", filename=f"{model_name}.pth", local_dir=local_dir)
        print(f"[Model Server] Loading VESM tokenizer from {base_model_name}...")
        model_status["vesm"] = "loading"
        vesm_tokenizer = _safe_load_tokenizer(base_model_name, revision=base_revision)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float32
        vesm_model = _safe_load_esm_model(base_model_name, dtype=dtype, revision=base_revision)
        
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
        model_status["vesm"] = "ready"
        print(f"[Model Server] VESM_150M model loaded successfully with strict=True.")
        print(f"[Model Server] Validation - word embeddings stats: mean={emb_weight.mean().item():.6f}, std={emb_weight.std().item():.6f}")
    except Exception as e:
        model_status["vesm"] = "failed"
        raise e

def clear_vesm():
    global vesm_tokenizer, vesm_model, model_status
    vesm_tokenizer = None
    vesm_model = None
    model_status["vesm"] = "standby"
