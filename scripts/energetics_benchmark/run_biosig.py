"""Strict sequential BioSig runner (DynaMut2, DDMut): 1 in flight, >=10s spacing, full disk cache."""
from __future__ import annotations

import argparse
import datetime
import http.client
import json
import pathlib
import random
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from common import CACHE_DIR, atomic_write_json

UA = "MissenseStructuralExplorer/1.0"
BIOSIG_CACHE = CACHE_DIR / "biosig"


def _ts() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S")


class UpstreamSubmitError(RuntimeError):
    """Non-retryable HTTP 4xx/5xx from BioSig during job submission or polling."""


def _multipart_body(fields: dict[str, str], file_field: str, filename: str, content: str) -> tuple[bytes, str]:
    boundary = f"----BenchBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode("utf-8"))
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: text/plain\r\n\r\n{content}\r\n--{boundary}--\r\n".encode("utf-8")
    )
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _submit_ddmut(pdb_text: str, chain: str, mut_code: str) -> str:
    body, ctype = _multipart_body({"mutation_single": mut_code, "chain_single": chain}, "pdb_file_single", "wt.pdb", pdb_text)
    conn = http.client.HTTPSConnection("biosig.lab.uq.edu.au", timeout=90)
    try:
        conn.request("POST", "/ddmut/run_single_prediction", body=body, headers={"Content-Type": ctype, "User-Agent": UA})
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8", errors="replace")
        loc = resp.getheader("Location") or ""
        m = re.search(r"results_prediction/([0-9a-zA-Z]+)", loc) or re.search(r"results_prediction/([0-9a-zA-Z]+)", raw)
        if not m:
            msg = f"DDMut HTTP {resp.status} without job_id: {raw[:200]}"
            if resp.status in (400, 404, 422, 500):
                raise UpstreamSubmitError(msg)
            raise RuntimeError(msg)
        return m.group(1)
    finally:
        conn.close()


def _submit_dynamut2(pdb_text: str, chain: str, mut_code: str) -> str:
    body, ctype = _multipart_body({"mutation": mut_code, "chain": chain}, "pdb_file", "wt.pdb", pdb_text)
    req = urllib.request.Request(
        "https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single",
        data=body,
        headers={"Content-Type": ctype, "User-Agent": UA, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body_txt = exc.read().decode("utf-8", errors="replace")[:200]
        msg = f"DynaMut2 HTTP {exc.code}: {body_txt}"
        if exc.code in (400, 404, 422, 500):
            raise UpstreamSubmitError(msg) from exc
        raise RuntimeError(msg) from exc
    if not data.get("job_id"):
        raise UpstreamSubmitError(f"DynaMut2 no job_id: {data}")
    return str(data["job_id"])


def _poll_job(engine: str, job_id: str) -> dict:
    if engine == "ddmut":
        conn = http.client.HTTPSConnection("biosig.lab.uq.edu.au", timeout=45)
        try:
            conn.request(
                "GET", "/ddmut/api/prediction_single", body=f"job_id={job_id}",
                headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, "Accept": "application/json"},
            )
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8", errors="replace")
            if resp.status >= 400:
                msg = f"HTTP {resp.status}: {raw[:180]}"
                if resp.status in (400, 404, 422, 500):
                    raise UpstreamSubmitError(msg)
                raise RuntimeError(msg)
            return json.loads(raw)
        finally:
            conn.close()
    url = f"https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single?job_id={job_id}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")[:180]
        msg = f"HTTP {exc.code}: {raw}"
        if exc.code in (400, 404, 422, 500):
            raise UpstreamSubmitError(msg) from exc
        raise RuntimeError(msg) from exc


def _poll_with_retry(engine: str, job_id: str, poll_sec: int, max_retries: int = 3) -> dict:
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            return _poll_job(engine, job_id)
        except UpstreamSubmitError:
            raise
        except Exception as exc:
            last_exc = exc
            if attempt + 1 < max_retries:
                time.sleep(min(poll_sec, 10))
    assert last_exc is not None
    raise last_exc


def _ordered_indices(datasets: dict[str, list[dict]], seed: int, initial_sample: int = 150) -> dict[str, list[int]]:
    """Keep exact seed-42 sorted initial sample first, then deterministic seed-42 extension order."""
    rng_s669 = random.Random(seed)
    s669_perm = rng_s669.sample(range(len(datasets["s669"])), len(datasets["s669"]))
    k669 = min(initial_sample, len(s669_perm))
    s669_order = sorted(s669_perm[:k669]) + s669_perm[k669:]

    rng_ssym = random.Random(seed)
    _ = rng_ssym.sample(range(len(datasets["s669"])), k669)
    ssym_perm = rng_ssym.sample(range(len(datasets["ssym_direct"])), len(datasets["ssym_direct"]))
    kssym = min(initial_sample, len(ssym_perm))
    ssym_order = sorted(ssym_perm[:kssym]) + ssym_perm[kssym:]
    return {"s669": s669_order, "ssym": ssym_order}


def _evaluate_poll_data(rec: dict, data: dict, cache_file: pathlib.Path) -> dict | None:
    status = str(data.get("status", "")).upper()
    raw_pred = data.get("prediction")
    if raw_pred is not None and raw_pred != "":
        try:
            pred = float(raw_pred)
            if pred == pred and abs(pred) != float("inf"):
                rec.update({"status": "ok", "raw_ddg": pred, "finished_at": time.time(), "payload": data})
                atomic_write_json(cache_file, rec)
                return rec
        except (TypeError, ValueError):
            pass
        rec.update({"status": "upstream_error", "raw_ddg": None, "error": f"Non-numeric prediction: {raw_pred!r}", "finished_at": time.time()})
        atomic_write_json(cache_file, rec)
        return rec
    if status in ("ERROR", "FAILED"):
        rec.update({"status": "upstream_error", "raw_ddg": None, "error": str(data)[:220], "finished_at": time.time()})
        atomic_write_json(cache_file, rec)
        return rec
    if status in ("DONE", "FINISHED", "COMPLETED"):
        rec.update({"status": "upstream_error", "raw_ddg": None, "error": f"DONE without prediction: {str(data)[:220]}", "finished_at": time.time()})
        atomic_write_json(cache_file, rec)
        return rec
    return None


def _process_one(
    engine: str,
    ds: str,
    row: dict,
    cache_file: pathlib.Path,
    job_timeout: int,
    poll_sec: int,
    min_delay: float,
    last_submit_ts: list[float],
) -> tuple[dict, bool, bool]:
    """Return (record, submitted_now, live_network_activity)."""
    rec = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {"id": row["id"], "dataset": ds, "status": "new"}
    if rec.get("status") in ("ok", "upstream_error"):
        return rec, False, False

    if rec.get("status") == "timeout" and rec.get("timed_out_limit", 0) >= job_timeout and rec.get("job_id"):
        return rec, False, False

    pdb_text = pathlib.Path(row["clean_pdb"]).read_text(encoding="utf-8")
    mut_code = f"{row['wt']}{row['pos']}{row['mut']}"
    submitted = False
    if not rec.get("job_id"):
        wait_needed = min_delay - (time.time() - last_submit_ts[0])
        if wait_needed > 0:
            time.sleep(wait_needed)
        try:
            job_id = _submit_ddmut(pdb_text, row["chain"], mut_code) if engine == "ddmut" else _submit_dynamut2(pdb_text, row["chain"], mut_code)
            last_submit_ts[0] = time.time()
        except UpstreamSubmitError as exc:
            last_submit_ts[0] = time.time()
            rec = {"id": row["id"], "dataset": ds, "status": "upstream_error", "raw_ddg": None, "error": str(exc)[:300], "failed_at": time.time()}
            atomic_write_json(cache_file, rec)
            return rec, False, True
        except Exception as exc:
            last_submit_ts[0] = time.time()
            rec = {"id": row["id"], "dataset": ds, "status": "error", "raw_ddg": None, "error": str(exc)[:300], "failed_at": time.time()}
            atomic_write_json(cache_file, rec)
            raise
        rec = {"id": row["id"], "dataset": ds, "status": "running", "job_id": job_id, "submitted_at": last_submit_ts[0]}
        atomic_write_json(cache_file, rec)
        submitted = True

    submitted_at = float(rec.get("submitted_at") or time.time())
    deadline = submitted_at + job_timeout
    first_poll = True
    while first_poll or time.time() < deadline:
        if not first_poll or submitted:
            time.sleep(poll_sec)
        first_poll = False
        try:
            data = _poll_with_retry(engine, str(rec["job_id"]), poll_sec)
        except UpstreamSubmitError as exc:
            rec.update({"status": "upstream_error", "raw_ddg": None, "error": str(exc)[:300], "failed_at": time.time()})
            atomic_write_json(cache_file, rec)
            return rec, submitted, True
        except Exception as exc:
            rec.update({"status": "error", "raw_ddg": None, "error": str(exc)[:300], "failed_at": time.time()})
            atomic_write_json(cache_file, rec)
            raise
        done_rec = _evaluate_poll_data(rec, data, cache_file)
        if done_rec is not None:
            return done_rec, submitted, True
        if time.time() >= deadline:
            break

    now = time.time()
    elapsed = now - submitted_at
    rec.update({
        "status": "timeout",
        "raw_ddg": None,
        "timed_out_at": now,
        "elapsed_sec": round(elapsed, 1),
        "timed_out_limit": job_timeout,
        "error": f"Still RUNNING after {elapsed:.0f}s (limit {job_timeout}s)",
    })
    atomic_write_json(cache_file, rec)
    return rec, submitted, True


def _flush_dataset_cache(engine: str, ds: str, ds_rows: list[dict]) -> list[dict]:
    bdir = BIOSIG_CACHE / engine
    out: list[dict] = []
    for row in ds_rows:
        cfile = bdir / f"{ds}__{row['id']}.json"
        if cfile.exists():
            out.append(json.loads(cfile.read_text(encoding="utf-8")))
    atomic_write_json(CACHE_DIR / f"{engine}_{ds}.json", out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", nargs="+", default=["dynamut2", "ddmut"])
    ap.add_argument("--datasets", nargs="+", default=["s669", "ssym"])
    ap.add_argument("--s669-target", type=int, default=150)
    ap.add_argument("--ssym-target", type=int, default=100)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--delay", type=float, default=10.0)
    ap.add_argument("--poll-sec", type=int, default=12)
    ap.add_argument("--job-timeout", type=int, default=900)
    ap.add_argument("--max-consec-err", type=int, default=10)
    ap.add_argument("--max-wall-sec", type=int, default=0, help="Stop starting new variants after N seconds")
    args = ap.parse_args()

    t_start = time.time()
    print(f"[{_ts()}] Starting run_biosig: engines={args.engines} datasets={args.datasets}", flush=True)

    min_delay = max(10.0, args.delay)
    datasets = json.loads((CACHE_DIR / "datasets.json").read_text(encoding="utf-8"))
    orders = _ordered_indices(datasets, args.seed, initial_sample=150)
    last_submit_ts = [0.0]

    for eng in args.engines:
        consec_err = 0
        aborted = False

        if "s669" in args.datasets:
            ok_count = 0
            attempted = 0
            for idx in orders["s669"]:
                if ok_count >= args.s669_target:
                    break
                if args.max_wall_sec > 0 and time.time() - t_start >= args.max_wall_sec:
                    print(f"[{_ts()}] Reached --max-wall-sec={args.max_wall_sec}s, stopping cleanly.", flush=True)
                    aborted = True
                    break
                row = datasets["s669"][idx]
                cfile = BIOSIG_CACHE / eng / f"s669__{row['id']}.json"
                attempted += 1
                live = False
                try:
                    rec, submitted, live = _process_one(eng, "s669", row, cfile, args.job_timeout, args.poll_sec, min_delay, last_submit_ts)
                    if rec.get("status") == "ok":
                        ok_count += 1
                        if live:
                            consec_err = 0
                    elif live:
                        consec_err += 1
                        print(f"[{_ts()}] [{eng}] s669 {row['id']} {rec.get('status')} ({consec_err}/{args.max_consec_err}): {rec.get('error')}", flush=True)
                    if live and submitted:
                        time.sleep(min_delay)
                except Exception as exc:
                    live = True
                    consec_err += 1
                    print(f"[{_ts()}] [{eng}] s669 {row['id']} ERROR ({consec_err}/{args.max_consec_err}): {exc}", flush=True)
                    time.sleep(min_delay)
                _flush_dataset_cache(eng, "s669", datasets["s669"])
                if live and (attempted % 10 == 0 or ok_count >= args.s669_target):
                    print(f"[{_ts()}] [{eng}] s669 progress: {ok_count}/{args.s669_target} scored (attempted {attempted})", flush=True)
                if consec_err >= args.max_consec_err:
                    print(f"[{_ts()}] [{eng}] Stopping early after {consec_err} consecutive failures.", flush=True)
                    aborted = True
                    break
            print(f"[{_ts()}] [{eng}] s669 finished: {ok_count} scored / {attempted} attempted", flush=True)

        if not aborted and ("ssym" in args.datasets or "ssym_direct" in args.datasets or "ssym_reverse" in args.datasets):
            paired_ok = 0
            dir_ok = 0
            rev_ok = 0
            attempted_pairs = 0
            for idx in orders["ssym"]:
                if paired_ok >= args.ssym_target:
                    break
                if args.max_wall_sec > 0 and time.time() - t_start >= args.max_wall_sec:
                    print(f"[{_ts()}] Reached --max-wall-sec={args.max_wall_sec}s, stopping cleanly.", flush=True)
                    aborted = True
                    break
                d_row = datasets["ssym_direct"][idx]
                r_row = datasets["ssym_reverse"][idx]
                d_file = BIOSIG_CACHE / eng / f"ssym_direct__{d_row['id']}.json"
                r_file = BIOSIG_CACHE / eng / f"ssym_reverse__{r_row['id']}.json"
                attempted_pairs += 1
                d_live = False
                r_live = False
                try:
                    d_rec, d_sub, d_live = _process_one(eng, "ssym_direct", d_row, d_file, args.job_timeout, args.poll_sec, min_delay, last_submit_ts)
                    if d_rec.get("status") == "ok":
                        dir_ok += 1
                        if d_live:
                            consec_err = 0
                    elif d_live:
                        consec_err += 1
                        print(f"[{_ts()}] [{eng}] ssym_direct {d_row['id']} {d_rec.get('status')} ({consec_err}/{args.max_consec_err}): {d_rec.get('error')}", flush=True)
                    if d_live and d_sub:
                        time.sleep(min_delay)
                except Exception as exc:
                    d_live = True
                    consec_err += 1
                    d_rec = {"status": "error"}
                    print(f"[{_ts()}] [{eng}] ssym_direct {d_row['id']} ERROR ({consec_err}/{args.max_consec_err}): {exc}", flush=True)
                    time.sleep(min_delay)
                _flush_dataset_cache(eng, "ssym_direct", datasets["ssym_direct"])
                if consec_err >= args.max_consec_err:
                    print(f"[{_ts()}] [{eng}] Stopping early after {consec_err} consecutive failures.", flush=True)
                    aborted = True
                    break

                if d_rec.get("status") == "ok":
                    try:
                        r_rec, r_sub, r_live = _process_one(eng, "ssym_reverse", r_row, r_file, args.job_timeout, args.poll_sec, min_delay, last_submit_ts)
                        if r_rec.get("status") == "ok":
                            rev_ok += 1
                            paired_ok += 1
                            if r_live:
                                consec_err = 0
                        elif r_live:
                            consec_err += 1
                            print(f"[{_ts()}] [{eng}] ssym_reverse {r_row['id']} {r_rec.get('status')} ({consec_err}/{args.max_consec_err}): {r_rec.get('error')}", flush=True)
                        if r_live and r_sub:
                            time.sleep(min_delay)
                    except Exception as exc:
                        r_live = True
                        consec_err += 1
                        print(f"[{_ts()}] [{eng}] ssym_reverse {r_row['id']} ERROR ({consec_err}/{args.max_consec_err}): {exc}", flush=True)
                        time.sleep(min_delay)
                    _flush_dataset_cache(eng, "ssym_reverse", datasets["ssym_reverse"])
                    if consec_err >= args.max_consec_err:
                        print(f"[{_ts()}] [{eng}] Stopping early after {consec_err} consecutive failures.", flush=True)
                        aborted = True
                        break

                if (d_live or r_live) and (attempted_pairs % 10 == 0 or paired_ok >= args.ssym_target):
                    print(f"[{_ts()}] [{eng}] ssym progress: {paired_ok}/{args.ssym_target} paired (dir_ok={dir_ok}, rev_ok={rev_ok}, pairs_attempted={attempted_pairs})", flush=True)

            print(f"[{_ts()}] [{eng}] ssym finished: {paired_ok} paired ok (dir={dir_ok}, rev={rev_ok}, attempted_pairs={attempted_pairs})", flush=True)

    print(f"[{_ts()}] Completed run_biosig in {time.time() - t_start:.1f}s", flush=True)


if __name__ == "__main__":
    main()
