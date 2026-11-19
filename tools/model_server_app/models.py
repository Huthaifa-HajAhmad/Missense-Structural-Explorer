import os
import sys

# Configure OpenMP, MKL, and PyTorch CPU thread allocations prior to importing torch or numpy
DEFAULT_NUM_THREADS = os.environ.get("TORCH_NUM_THREADS", os.environ.get("OMP_NUM_THREADS", "2"))
os.environ.setdefault("OMP_NUM_THREADS", DEFAULT_NUM_THREADS)
os.environ.setdefault("MKL_NUM_THREADS", DEFAULT_NUM_THREADS)
os.environ.setdefault("OPENBLAS_NUM_THREADS", DEFAULT_NUM_THREADS)
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", DEFAULT_NUM_THREADS)
os.environ.setdefault("NUMEXPR_NUM_THREADS", DEFAULT_NUM_THREADS)

import gc
import threading
import torch
from collections import OrderedDict
from tools.model_server_app.engine_resilience import PriorityCpuGate

_model_lock = threading.Lock()
cpu_gate = PriorityCpuGate()

# Default to 2 so the cached checkpoints coexist on CPU without evicting each other and triggering a
# multi-second gc.collect() + disk reload on every variant.
MAX_LOADED_MODELS = int(os.environ.get("MAX_LOADED_MODELS", "2"))
loaded_models: "OrderedDict[str, tuple]" = OrderedDict()

# Optimize CPU thread allocation for OCI Ampere A1 (2-4 cores) and local dev
if not torch.cuda.is_available():
    torch_threads = int(DEFAULT_NUM_THREADS)
    torch.set_num_threads(torch_threads)
    print(f"[Model Server] PyTorch CPU thread count set to {torch_threads} (OMP/MKL: {DEFAULT_NUM_THREADS}).")

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

model_status: dict[str, str] = {
    "thermompnn": "standby",
    "stabilityoracle": "standby",
}
model_errors: dict[str, str] = {}

def verify_local_checkpoints():
    """
    Dry-runs unpickling and model architecture initialization for StabilityOracle and ThermoMPNN.
    Catches LayerScale/DropPath/AttentionBlock NameErrors or missing weights immediately on startup.
    """
    global model_status, model_errors
    # 1. StabilityOracle validation
    model_status["stabilityoracle"] = "loading"
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
    model_status["thermompnn"] = "loading"
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
    """Validates the local stability checkpoints in the background so uvicorn binds port 8000 immediately.

    It also loaded VESM-150M and downloaded ESM-2 650M until the runtime protein language models were
    retired on 2026-11-18 (doc/PROTEIN_LANGUAGE_MODELS_DECISION.md).
    """
    # Publish pending startup work before the thread runs, so health cannot report ready early.
    for name in ("stabilityoracle", "thermompnn"):
        model_status[name] = "loading"
    def _warmup():
        try:
            verify_local_checkpoints()
        except Exception as e:
            print(f"[Model Server Warning] Local checkpoints verification error: {e}")
    t = threading.Thread(target=_warmup, name="checkpoint_background_warmup", daemon=True)
    t.start()
