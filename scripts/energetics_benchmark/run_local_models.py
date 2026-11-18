"""Run local ThermoMPNN and StabilityOracle via tools/model_server.py and cache outputs."""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from common import CACHE_DIR, append_jsonl, find_repo_asset, read_jsonl

SEED_MAP = {"s669": "s669", "ssym_direct": "ssym"}
SECRET = "bench-local-secret"


def _health_ok(base_url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{base_url}/health", timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False


def _resolve_venv_python(py_venv: pathlib.Path, env: dict[str, str]) -> pathlib.Path:
    probe = subprocess.run([str(py_venv), "-c", "import uvicorn"], capture_output=True)
    if probe.returncode == 0:
        return py_venv
    venv_dir = py_venv.parent.parent
    cfg = venv_dir / "pyvenv.cfg"
    if cfg.exists():
        for line in cfg.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.lower().startswith("home"):
                home_py = pathlib.Path(line.split("=", 1)[1].strip()) / "python.exe"
                if home_py.exists():
                    site = venv_dir / "Lib" / "site-packages"
                    env["PYTHONPATH"] = f"{site}{os.pathsep}{env.get('PYTHONPATH', '')}".rstrip(os.pathsep)
                    env["VIRTUAL_ENV"] = str(venv_dir)
                    return home_py
    return py_venv


def _start_sidecar(port: int) -> tuple[subprocess.Popen | None, str]:
    base_url = f"http://127.0.0.1:{port}"
    if _health_ok(base_url):
        return None, base_url
    py_venv = find_repo_asset("tools", ".venv", "Scripts", "python.exe") or find_repo_asset("tools", ".venv", "bin", "python")
    if not py_venv:
        raise FileNotFoundError("tools/.venv python not found in worktree or sibling main checkout")
    sidecar_root = py_venv.parent.parent.parent.parent
    env = os.environ.copy()
    env["SIDECAR_SECRET"] = SECRET
    env.setdefault("TORCH_NUM_THREADS", "4")
    py_exec = _resolve_venv_python(py_venv, env)
    log_path = CACHE_DIR / "model_server.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_file = log_path.open("w", encoding="utf-8")
    cmd = [str(py_exec), "-m", "uvicorn", "tools.model_server:app", "--host", "127.0.0.1", "--port", str(port)]
    proc = subprocess.Popen(cmd, cwd=sidecar_root, env=env, stdout=log_file, stderr=subprocess.STDOUT)
    for _ in range(90):
        if _health_ok(base_url):
            return proc, base_url
        if proc.poll() is not None:
            log_file.close()
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-500:]
            raise RuntimeError(f"Local model_server exited with {proc.returncode}: {tail}")
        time.sleep(1.0)
    proc.terminate()
    log_file.close()
    raise TimeoutError("Timed out waiting for local model_server /health")


def _post_json(url: str, payload: dict, timeout: int = 300) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "X-Sidecar-Secret": SECRET, "X-Budget-Ms": str(timeout * 1000)},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _seed_existing(engine: str, ds_name: str, out_path: pathlib.Path) -> set[str]:
    done = {r["id"] for r in read_jsonl(out_path) if r.get("status") == "ok"}
    bench_dir = SEED_MAP.get(ds_name)
    if not bench_dir:
        return done
    seed_file = find_repo_asset("logs", "foldx_bench", bench_dir, "engines.jsonl")
    if not seed_file:
        return done
    for item in read_jsonl(seed_file):
        vid = item.get("id")
        val = item.get(engine)
        if vid and vid not in done and isinstance(val, (int, float)):
            append_jsonl(out_path, {"id": vid, "status": "ok", "raw_ddg": float(val), "source": f"seed:{seed_file.parent.name}"})
            done.add(vid)
    return done


def _predict_one(base_url: str, engine: str, row: dict) -> dict:
    pdb_text = pathlib.Path(row["clean_pdb"]).read_text(encoding="utf-8")
    try:
        if engine == "thermompnn":
            mut_code = f"{row['wt']}{row['chain']}{row['pos']}{row['mut']}"
            res = _post_json(f"{base_url}/predict/thermompnn", {"pdb_content": pdb_text, "mutation": mut_code, "chain": row["chain"]})
        else:
            res = _post_json(
                f"{base_url}/predict/stabilityoracle",
                {"sequence": "", "position": int(row["pos"]), "wt": row["wt"], "mut": row["mut"], "wtPdb": pdb_text, "chain": row["chain"]},
            )
        val = res.get("ddG")
        if isinstance(val, (int, float)):
            return {"id": row["id"], "status": "ok", "raw_ddg": float(val), "source": "local_sidecar"}
        return {"id": row["id"], "status": "error", "raw_ddg": None, "error": str(res.get("error") or res)[:250]}
    except Exception as exc:
        return {"id": row["id"], "status": "error", "raw_ddg": None, "error": str(exc)[:250]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", nargs="+", default=["thermompnn", "stabilityoracle"])
    ap.add_argument("--datasets", nargs="+", default=["s669", "ssym_direct", "ssym_reverse"])
    ap.add_argument("--port", type=int, default=8011)
    ap.add_argument("--from-scratch", action="store_true")
    args = ap.parse_args()

    datasets = json.loads((CACHE_DIR / "datasets.json").read_text(encoding="utf-8"))
    work_plan: list[tuple[str, str, list[dict], pathlib.Path]] = []
    for eng in args.engines:
        for ds in args.datasets:
            out_path = CACHE_DIR / f"{eng}_{ds}.jsonl"
            if args.from_scratch and out_path.exists():
                out_path.unlink()
            done = set() if args.from_scratch else _seed_existing(eng, ds, out_path)
            todo = [r for r in datasets[ds] if r["id"] not in done]
            print(f"[{eng}] {ds}: {len(done)} cached/seeded, {len(todo)} to run", flush=True)
            if todo:
                work_plan.append((eng, ds, todo, out_path))

    if not work_plan:
        return
    proc, base_url = _start_sidecar(args.port)
    try:
        for eng, ds, todo, out_path in work_plan:
            for idx, row in enumerate(todo, 1):
                res = _predict_one(base_url, eng, row)
                append_jsonl(out_path, res)
                if idx % 25 == 0 or idx == len(todo):
                    print(f"[{eng}] {ds}: {idx}/{len(todo)} finished", flush=True)
    finally:
        if proc is not None:
            proc.terminate()
            proc.wait(timeout=10)


if __name__ == "__main__":
    main()
