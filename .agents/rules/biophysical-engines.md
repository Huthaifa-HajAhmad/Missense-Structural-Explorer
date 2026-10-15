---
trigger: always_on
description: Biophysical stability & language model engines protocol — rules for FoldX, ThermoMPNN, StabilityOracle, RaSP, SaProt, ESMC, and JapanFold execution.
---

# Biophysical Stability & Language Model Engines Protocol

When diagnosing, modifying, testing, or executing biophysical calculations and protein language model evaluations in Missense-Structural-Explorer, adhere strictly to these operational protocols.

## 1. Engine Directory & Platform Discovery Hierarchy

Never assume a single binary path or hardcoded operating system architecture.

### FoldX (Force Field Repacking & ΔΔG)
* **Windows (Local Dev)**: `tools/foldx/foldx_1_20270131.exe`
* **Linux ARM64 (OCI VM)**: `tools/foldx_linux/foldx_20261231` (86.7 MB x86_64 ELF) executed via **Box64** (`box64 foldx_20261231`).
* **Docker Container Paths**: `/app/tools/foldx_linux` and `/app/tools/foldx`.
* **Parameter Files**: `rotabase.txt` and `molecules/` directory are required. Look in `tools/foldx/`, `tools/foldx_linux/`, or `/app/tools/foldx/`.
* **Mounting in OCI**: Both `./tools/foldx` and `./tools/foldx_linux` are mounted into the container in `docker-compose.oci.yml`.

### RaSP (Rapid Stability Prediction)
* **Storage Hierarchy**:
  1. Primary: `data/df_rasp_gnomad_clinvar.sqlite` (indexed O(log n) lookup).
  2. Build script: `npx tsx scripts/build-rasp-sqlite.ts`.
  3. Never block UI if variant is missing from precomputed database; report `Not in Zenodo DB` without failing other engines.

### ThermoMPNN & StabilityOracle
* **Local Sidecar**: Evaluated locally via Python sidecar on `http://127.0.0.1:8000`.
  - ThermoMPNN: `POST /predict/thermompnn` (ProteinMPNN neural embeddings).
  - StabilityOracle: `POST /predict/stabilityoracle` (3D SiameseGraphormer).
* **Non-Blocking Warmup**: The sidecar binds port 8000 immediately (<100ms); initial VESM weights load asynchronously in a background thread.
* **Fallback & Errors**: Never throw fatal errors when sidecar is warming up or in standby. Return `status: "unavailable"` or `status: "pending"` so the UI displays clean standby states instead of false "API Error" banners.

### SaProt & ESMC
* **Local Sidecar**: `POST /predict/saprot` and `POST /predict/esmc` (VESM-150M).
* **Remote Sovereign Fallback**: If local sidecar is offline or warming up, automatically fallback to **JapanFold** (`POST https://api.japanfold.aiand.com/v1/predictions`).
* **Keyless**: JapanFold is 100% keyless and incurs zero compute overhead on resource-constrained cloud VMs.

### Remote tiers (ESM3 / ESMC via Forge-Biohub, ESM-2 via Hugging Face) and their fallbacks
* **Measured 2026-10-14/15 from the dev host**: an unauthenticated `POST` to `forge.evolutionaryscale.ai/api/v1/encode` answers 401 (reachable); `biohub.ai/api/v1/encode` answers **451** (regionally restricted). A HEAD on a host root is not evidence either way: the root gave 451 on both while Forge's API path was reachable. ESM3 uses the Forge host, ESMC uses `biohub.ai`, so one saved token can work for ESM3 and be refused for ESMC. HF lists `facebook/esm2_t33_650M_UR50D` as live on `hf-inference` for `fill-mask`, so a failing ESM-2 remote call is a token/provider/cold-start problem, not an unsupported model.
* **The ESM SDK retries only 429/500/502/503/504** (5 attempts, backoff up to 10 s, 120 s request timeout by default) and **returns** an `ESMProteinError` from `encode`/`logits` instead of raising it. The sidecar caps the timeout and retries (`REMOTE_REQUEST_TIMEOUT_S`, `REMOTE_MAX_RETRY_ATTEMPTS`), bounds the ESM-3 remote tier (`ESM3_REMOTE_BUDGET_S`, 15 s, doubled past 500 residues) and calls `raise_if_sdk_error` so the status survives.
* **Deterministic refusals (401/403/451) are remembered** for `REMOTE_FAILURE_TTL_S` (600 s) per engine, host and credential (`tools/model_server_app/engine_resilience.py`); transient ones (429, 5xx, timeouts) are not. A skipped attempt reports `remote skipped (recent refusal): ...` in `remoteEngineNote`.
* **The local VESM-150M pass is computed once per `(sequence, position, wt, mut)`** and shared by the ESM-3 and ESM-2 fallbacks (single-flight cache). Pass the FULL sequence and position to `predict_vesm_sync`: it crops to 1,022 residues itself and returns `localShiftMap` positions in full-protein numbering (`to_full_coordinates`). Handing it an already-cropped window loses the offset.
* **Diagnosing a "timed out after Ns" ESM3 warning**: read the sidecar line `[Model Server Remote ESM3 Error] after Xs: <reason>`. A reason with HTTP 451/401/403 is access; HTTP 429/5xx is the provider; a bare `exceeded its Ns remote budget` is a slow remote on a long sequence; no such line means the local pass itself was slow. The Node budget (`esm3_forge.ts`: 40 s, or 100 s past 500 residues) must cover the remote tier plus the local fallback.
* **Not measurable from an agent shell**: the sidecar venv's DLLs fail to load there (`_ctypes`), so local VESM timings for CNOT1 were not benchmarked; run the sidecar normally and read its log.

## 2. Capabilities Diagnostic Endpoint

Before assuming an engine is missing or broken, query the machine-readable capabilities endpoint:
```http
GET /api/v1/capabilities
```
Returns live JSON status for all 8 engines (`foldx_linux_elf`, `foldx_windows`, `box64`, `rasp`, `thermompnn`, `stabilityoracle`, `saprot`, `japanfold`) along with system architecture and sidecar latency.

## 3. Strict No-Heuristics Policy

* **Zero Synthetic Fallbacks**: Never fabricate, extrapolate, or heuristically approximate stability scores (ΔΔG), binding pockets, or evolutionary likelihoods.
* If an engine cannot compute a score, return `null` and document the exact reason. Calibrated consensus automatically re-weights available evidence.

## 4. Diagnosing FoldX Timeouts, Crashes and Suspicious ΔΔG

* **Measure before tuning budgets**: `npm run foldx:timing -- --pdb <file.pdb> --mut Q867H [--runs 1,5] [--repair] [--keep]` reproduces the runner's job layout and command line (Box64 routing included) and reports time-to-first-output, wall time, exit state, peak RSS (Linux) and ΔΔG. No first output before the cap = a hang, not slow progress. Run it on the host in question; native Windows numbers say nothing about Box64.
* **Measured costs** (5-run BuildModel): native Windows x64 2.3 s on SOD1 (154 residues), 4.7 s on 875 residues (~0.5 s/run); OCI ARM64 + Box64 (2 vCPU) 167.2 s on SLC12A4 (1,085 residues) = 13.3 s fixed + 30.8 s/run, ~60x native. RepairPDB native: 48 s (154 residues), 232 s (875 residues).
* **BuildModel budget is sized, not flat**: `foldx/budget.ts` → native hosts get `foldxBuildModelMs` (180 s); under Box64 `clamp(2 × (fixed + runs × residues × ms/residue/run), 180 s, 600 s)`, all four numbers env-overridable in `server/config.ts`. It fits `foldxSec` only because structures above `FOLDX_REPAIR_MAX_RESIDUES` skip RepairPDB; `server/tests/foldx-timeout-budget.test.ts` asserts both paths. Re-measure with `foldx:timing` before changing the constants.
* **Box64 flags (measured 2026-10-04, not adopted)**: `BOX64_DYNAREC_FASTNAN=0 FASTROUND=0` (strict x86 floating point) gave an identical ΔΔG (1.1119) at +36% time, so the default fast-FP mode is safe for FoldX. `BIGBLOCK=2 CALLRET=1 SAFEFLAGS=0` saved ~4% on single samples (within noise), and `SAFEFLAGS=0` trades flag correctness for speed, so none are set in `docker-compose.oci.yml`. Revisit only with repeated samples and a multi-variant ΔΔG check.
* **Emulated cost is superlinear** (~residues^1.44: SOD1 154 res 9.6 s, SLC12A4 1,085 res ~161–167 s for 5 runs). The sized budget covers up to ~2,500 residues; above that the 600 s ceiling binds.
* **Timeout before crash**: `classifyFoldxFailure` treats `error.killed` (Node killed it on budget) as a timeout even if Box64 printed "Unhandled signal caught" while dying. Do not reorder.
* **Timeout messages carry their own context**: budget, residue count, template state and emulation are in the error text, and `[FoldX Timeout Context]` logs the exact reproduction (job dir, args, atom counts).
* **Windows `%TEMP%` gotcha**: FoldX run in `AppData\Local\Temp` prints "run OK" but writes no output files (RepairPDB: no `wt_Repair.pdb`; BuildModel: "BuildModel failed:"). The same inputs succeed inside the repo. Production job dirs live in `temp_jobs/`; ad-hoc harnesses should use `node_modules/.cache/tmp`.
* **`Dif_wt.fxout` appends**: FoldX appends to an existing Dif file, so reusing a job dir for a second mutation silently mixes runs. Use a fresh dir per mutation.
* **Run averaging**: all BuildModel runs enter the mean and SD; only runs with |ΔΔG| > 20 kcal/mol are excluded (`excludedDdGs`). Runs are discrete rotamer outcomes and can be bimodal; never reintroduce a MAD/Z-score outlier filter for 5 runs (it dropped legitimate runs on 8 of 26 SOD1 variant runs). Identical runs are expected when one rotamer dominates and are not a failure.
* **AlphaFold repair skip is unverified**: the "pLDDT confuses RepairPDB" rationale did not reproduce (RepairPDB succeeded on AF-P00441). Changing the guard needs a benchmark against experimental ΔΔG, not a single protein.
