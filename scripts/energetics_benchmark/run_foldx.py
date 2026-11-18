"""Run FoldX (full repair <=233 res, local fix-shell >233 res, BuildModel x5) and cache results."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from common import AA_3TO1, CACHE_DIR, append_jsonl, find_repo_asset, read_jsonl

SEED_MAP = {"s669": "s669", "ssym_direct": "ssym"}
FULL_REPAIR_THRESHOLD = 233
WRITE_LOCK = threading.Lock()


def plan_fix_shell(cleaned_pdb: str, chain: str, res_seq: int, ins_code: str = "") -> str | None:
    """Exact port of server/services/stability/foldx/repair-shell.ts (r15-seq14)."""
    residues: dict[str, dict] = {}
    for line in cleaned_pdb.splitlines():
        if not line.startswith("ATOM"):
            continue
        atom = line[12:16].strip().upper()
        if atom.startswith("H"):
            continue
        ch = line[21:22] or " "
        rseq = int(line[22:26])
        ins = line[26:27].strip()
        rid = f"{ch}{rseq}{ins}"
        entry = residues.setdefault(rid, {"id": rid, "chain": ch, "res_seq": rseq, "ins": ins, "res3": line[17:20].strip().upper(), "xyz": []})
        entry["xyz"].append((float(line[30:38]), float(line[38:46]), float(line[46:54])))

    target = next((r for r in residues.values() if r["chain"] == chain and r["res_seq"] == res_seq and r["ins"] == ins_code), None)
    if not target:
        return None
    limit2 = 15.0 * 15.0
    movable: set[str] = set()
    for r in residues.values():
        if r["chain"] == chain and abs(r["res_seq"] - res_seq) <= 1:
            movable.add(r["id"])
            continue
        if any((x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2 <= limit2 for x, y, z in r["xyz"] for tx, ty, tz in target["xyz"]):
            movable.add(r["id"])
    if len(movable) < 25:
        for r in residues.values():
            if r["chain"] == chain and abs(r["res_seq"] - res_seq) <= 14:
                movable.add(r["id"])
    fixed = [f"{AA_3TO1[r['res3']]}{r['id']}" for r in residues.values() if r["id"] not in movable and r["res3"] in AA_3TO1]
    return ",".join(fixed) + ";" if fixed else None


def find_foldx_binary() -> tuple[pathlib.Path, pathlib.Path]:
    env_bin = os.environ.get("FOLDX_PATH")
    if env_bin and pathlib.Path(env_bin).exists():
        p = pathlib.Path(env_bin)
        return p, p.parent / "rotabase.txt"
    foldx_dir = find_repo_asset("tools", "foldx")
    if foldx_dir and foldx_dir.is_dir():
        for pat in ("foldx.exe", "foldx_*.exe", "foldx"):
            hits = sorted(foldx_dir.glob(pat))
            if hits:
                return hits[0], foldx_dir / "rotabase.txt"
    raise FileNotFoundError("FoldX binary not found under tools/foldx or FOLDX_PATH")


def _parse_foldx_dif(dif_path: pathlib.Path) -> float:
    vals: list[float] = []
    for line in dif_path.read_text(encoding="utf-8", errors="replace").splitlines():
        cols = line.split("\t")
        if len(cols) >= 2 and cols[0].startswith("wt_"):
            vals.append(float(cols[1]))
    if not vals:
        raise RuntimeError(f"No DDG rows found in {dif_path.name}")
    return sum(vals) / len(vals)


CONDITIONS = ["--timeSeedRotabase=false", "--pH=7.4", "--temperature=298.15", "--ionStrength=0.15"]


def _run_one_foldx(row: dict, foldx_bin: pathlib.Path, rotabase: pathlib.Path) -> dict:
    clean_pdb = pathlib.Path(row["clean_pdb"]).read_text(encoding="utf-8")
    work_root = rotabase.parent.parent.parent / "logs" / "foldx_bench" / "_fx_work"
    work_root.mkdir(parents=True, exist_ok=True)
    safe_id = "".join(c if c.isalnum() or c in "_-" else "_" for c in row["id"])
    work_dir = work_root / f"fx_{safe_id}"
    shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        try:
            os.link(rotabase, work_dir / "rotabase.txt")
        except OSError:
            shutil.copy2(rotabase, work_dir / "rotabase.txt")
        mol_dir = rotabase.parent / "molecules"
        if mol_dir.is_dir():
            shutil.copytree(mol_dir, work_dir / "molecules")
        (work_dir / "wt.pdb").write_text(clean_pdb + "\n", encoding="utf-8")
        mode = "full" if row["n_residues"] <= FULL_REPAIR_THRESHOLD else "local"
        repair_cmd = [str(foldx_bin), "--command=RepairPDB", "--pdb=wt.pdb", *CONDITIONS]
        if mode == "local":
            fix_txt = plan_fix_shell(clean_pdb, row["chain"], row["pos"])
            if fix_txt:
                (work_dir / "fix.txt").write_text(fix_txt, encoding="utf-8")
                repair_cmd.append("--fix-residues-file=fix.txt")
        subprocess.run(repair_cmd, cwd=work_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)

        repaired = work_dir / "wt_Repair.pdb"
        if not repaired.exists():
            raise RuntimeError("RepairPDB did not produce wt_Repair.pdb")
        (work_dir / "individual_list.txt").write_text(f"{row['wt']}{row['chain']}{row['pos']}{row['mut']};\n", encoding="utf-8")
        build_cmd = [
            str(foldx_bin), "--command=BuildModel", "--pdb=wt_Repair.pdb",
            "--mutant-file=individual_list.txt", "--numberOfRuns=5", *CONDITIONS,
        ]
        subprocess.run(build_cmd, cwd=work_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)
        ddg = _parse_foldx_dif(work_dir / "Dif_wt_Repair.fxout")
        return {"id": row["id"], "status": "ok", "raw_ddg": round(ddg, 4), "mode": mode, "source": "local_foldx"}
    except subprocess.CalledProcessError as exc:
        out = (exc.stdout or b"").decode("utf-8", errors="replace").strip()
        tail = " | ".join(line.strip() for line in out.splitlines()[-8:] if line.strip())
        cmd_name = next((a for a in exc.cmd if str(a).startswith("--command=")), "foldx")
        msg = f"{cmd_name} exit={exc.returncode}" + (f": {tail}" if tail else "")
        return {"id": row["id"], "status": "error", "raw_ddg": None, "error": msg[:500]}
    except Exception as exc:
        return {"id": row["id"], "status": "error", "raw_ddg": None, "error": str(exc)[:500]}
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _seed_from_existing(ds_name: str, out_path: pathlib.Path) -> set[str]:
    done = {r["id"] for r in read_jsonl(out_path) if r.get("status") == "ok"}
    bench_dir = SEED_MAP.get(ds_name)
    if not bench_dir:
        return done
    seed_file = find_repo_asset("logs", "foldx_bench", bench_dir, "results.jsonl")
    if not seed_file:
        return done
    for item in read_jsonl(seed_file):
        vid = item.get("id")
        if not vid or vid in done:
            continue
        n_res = int(item.get("residues") or 0)
        mode = "full" if n_res <= FULL_REPAIR_THRESHOLD else "local"
        val = (item.get("ddg") or {}).get(mode)
        if isinstance(val, (int, float)):
            append_jsonl(out_path, {"id": vid, "status": "ok", "raw_ddg": float(val), "mode": mode, "source": f"seed:{seed_file.parent.name}"})
            done.add(vid)
    return done


def run_dataset(ds_name: str, rows: list[dict], workers: int, from_scratch: bool, limit: int = 0) -> None:
    out_path = CACHE_DIR / f"foldx_{ds_name}.jsonl"
    if from_scratch and out_path.exists():
        out_path.unlink()
    done = set() if from_scratch else _seed_from_existing(ds_name, out_path)
    todo = [r for r in rows if r["id"] not in done]
    if limit > 0:
        todo = todo[:limit]
    print(f"[FoldX] {ds_name}: {len(done)} cached/seeded, {len(todo)} to run", flush=True)
    if not todo:
        return
    foldx_bin, rotabase = find_foldx_binary()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_run_one_foldx, row, foldx_bin, rotabase): row["id"] for row in todo}
        done_n = 0
        for fut in as_completed(futs):
            res = fut.result()
            with WRITE_LOCK:
                append_jsonl(out_path, res)
            done_n += 1
            if done_n % 25 == 0 or done_n == len(todo):
                print(f"[FoldX] {ds_name}: {done_n}/{len(todo)} finished", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--datasets", nargs="+", default=["s669", "ssym_direct", "ssym_reverse"])
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--from-scratch", action="store_true")
    args = ap.parse_args()
    datasets = json.loads((CACHE_DIR / "datasets.json").read_text(encoding="utf-8"))
    for ds in args.datasets:
        run_dataset(ds, datasets[ds], args.workers, args.from_scratch, args.limit)


if __name__ == "__main__":
    main()
