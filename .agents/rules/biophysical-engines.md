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

### ProtVar FoldX (cross-check; one FoldX reading counts)
* **Source**: EBI ProtVar `GET /ProtVar/api/prediction/foldx/{accession}/{position}` — FoldX precomputed on the AlphaFold DB model (`server/services/external-api/protvar.ts`).
* **Never a second vote**: it is FoldX again, so its engine descriptor is `referenceOnly` — excluded from coverage ("N of 6 engines"), from the run's running/missing lists and from `pendingTools`. Any new count over engines must skip `referenceOnly` rows (`COUNTED_ENERGY_ENGINES`).
* **One FoldX reading counts** (`FOLDX_STAND_IN_RULE`, `src/shared/energeticsEvidence.ts`): local FoldX whenever it has a value; ProtVar's value only when there is no local value AND the template is the AlphaFold model. Never on an experimental/homology template. Any caller building a consensus from a narrow object must pass `protvar` and `structureProvenance` (`computeStabilityConsensus`), or its verdict will disagree with the screen.
* **Cross-check** (`evidence.foldxTemplateCheck`) when both exist: consistent / differs / opposite, with a local 1 kcal/mol gap mark. A gap is a template-and-pipeline difference, not an error bar on either value.
* **No value, with a reason** when AlphaFold fragment models disagree (proteins > ~2,700 aa) or ProtVar's wild type differs. Never pick a fragment.
* **Local FoldX still always runs** (it builds the mutant structure the 3D view reads); `doc/ENERGETICS_TAB_REVIEW.md` says why deferring it on AlphaFold monomers was not done.

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
Returns live JSON status for every engine (`foldx_linux_elf`, `foldx_windows`, `box64`, `rasp`, `thermompnn`, `stabilityoracle`, `saprot`, `japanfold`, `p2rank`, `dbnsfp_local`) along with system architecture and sidecar latency. FoldX readiness (binary + `rotabase.txt` + Box64 when emulated) comes from `server/services/stability/foldx/readiness.ts`, the same rule `/api/v1/diagnostics` uses — the per-platform FoldX entries are an inventory, and only the one this host would run is gated on it.

## 3. Strict No-Heuristics Policy

* **Zero Synthetic Fallbacks**: Never fabricate, extrapolate, or heuristically approximate stability scores (ΔΔG), binding pockets, or evolutionary likelihoods.
* If an engine cannot compute a score, return `null` and document the exact reason. Calibrated consensus automatically re-weights available evidence.

## 4. Diagnosing FoldX Timeouts, Crashes and Suspicious ΔΔG

* **Measure before tuning budgets**: `npm run foldx:timing -- --pdb <file.pdb> --mut Q867H [--runs 1,5] [--repair] [--keep]` reproduces the runner's job layout and command line (Box64 routing included) and reports time-to-first-output, wall time, exit state, peak RSS (Linux) and ΔΔG. No first output before the cap = a hang, not slow progress. Run it on the host in question; native Windows numbers say nothing about Box64.
* **Measured costs** (5-run BuildModel): native Windows x64 2.3 s on SOD1 (154 residues), 4.7 s on 875 residues (~0.5 s/run). OCI ARM64 + Box64 (2 vCPU), 2026-10-17, n=3 per cell, CV <= 1%, no throttling: SOD1 10.0 s, p53 (393) 173.3 s, CNNM2 AlphaFold (875) 21.8 s, SLC12A4 (1,085) 169.8 s for Q867H and 386 s for Q867K; CNNM2 6N7E (305, 44 incomplete side chains) 213.7 s unrepaired vs 7.5 s repaired. RepairPDB under Box64: 272 s (154), 456 s (393), 660 s (305 with 44 incomplete); native 49 s (154), 205 s (305). **Box64 costs 3-6x where a native number exists; the "~60x" was the spread between easy and hard substitutions.** Two things set BuildModel's cost and residue count is neither (R^2 = 0.29): the number of incomplete residues FoldX rebuilds itself (~4.7 s each) and the substitution (Gln867 -> Ala/Cys/Asp/His/Lys, 1 run: 28/29/31/45/84 s).
* **BuildModel budget is sized, not flat**: `foldx/budget.ts` → native hosts get `foldxBuildModelMs` (180 s); under Box64 `clamp(2 × (fixed + incompleteResidues × 5 s + runs × residues × 90 ms), 180 s, 600 s)`, all numbers env-overridable in `server/config.ts`; the 90 ms is the upper envelope of what was measured, not a fit, so the budget is a ceiling. RepairPDB is not started under Box64 when `repairFitsBudget` predicts it cannot finish in `foldxRepairMs` (about 230 residues when complete), and BuildModel's cap is clamped to the job's remaining time. `server/tests/foldx-timeout-budget.test.ts` asserts the paths. Re-measure with `foldx:timing` (or the grid in the 2026-10-17 investigation) before changing the constants, in a container that a blue/green deploy cannot replace.
* **Box64 flags (measured 2026-10-04, not adopted)**: `BOX64_DYNAREC_FASTNAN=0 FASTROUND=0` (strict x86 floating point) gave an identical ΔΔG (1.1119) at +36% time, so the default fast-FP mode is safe for FoldX. `BIGBLOCK=2 CALLRET=1 SAFEFLAGS=0` saved ~4% on single samples (within noise), and `SAFEFLAGS=0` trades flag correctness for speed, so none are set in `docker-compose.oci.yml`. Revisit only with repeated samples and a multi-variant ΔΔG check.
* **Emulated cost is not a function of size.** The old ~residues^1.44 curve is exact at its two anchors (154, 1,085) and 4.5x too low at 393, 5.6x too high at 875. Do not re-anchor a size curve; if a tighter bound is needed, the substitution has to be an input.
* **Timeout before crash**: `classifyFoldxFailure` treats `error.killed` (Node killed it on budget) as a timeout even if Box64 printed "Unhandled signal caught" while dying. Do not reorder.
* **Background repair (idle-time, preemptible)**: when a job reports `foldxRepairSkippedReason: "repair-exceeds-budget"`, `runFoldxQueueJobOnServer` calls `requestBackgroundRepair` (`foldx/background-repair.ts`) with that job's own FoldX conditions. Later variants on the structure then hit the repair cache (6N7E: 214 s -> 7.5 s per variant; break-even is the fourth variant). Two modes (`backgroundRepairSlot`): **spare core** when the host has more cores than FoldX slots (the OCI host: 2 vCPU, FoldX concurrency **1**) — the repair starts within a poll even while jobs run, at `nice -n 19`, outside the FoldX semaphore, never preempted, one background repair at a time; measured 2026-10-18 (n=3) it slowed interactive BuildModels 1.5-2.6% and still got 96% of a core. **Shared** otherwise — it takes the FoldX slot only after two idle 30 s polls, and `runner.ts` calls `preemptBackgroundFoldx()` before an interactive job waits, which kills it (up to `MAX_PREEMPTIONS` = 3, then it gives up for 6 h). A job on the **same structure** that arrives while a spare-core repair runs may **join** it (`inflight-repairs.ts`, `joinWaitMs`): it waits only when the repair envelope says it ends before an unrepaired BuildModel would (incomplete residues x 5 s), never longer than that saving (+30 s grace for an overdue repair, still capped), and always leaving the job its unrepaired fallback; the UI shows the phase "repairing" while it waits, and the result reports `foldxRepairCached`. Its cap is `backgroundRepairBudgetMs` (1.5x the repair envelope, 1153 s for 6N7E, ceiling `FOLDX_BACKGROUND_REPAIR_MAX_MS`), outside the 900 s job cap and the nest test. Off with `FOLDX_BACKGROUND_REPAIR=false`; never in tests unless `=true`. State and reasons: `backgroundRepairStatus()`; log prefix `[Background Repair]`. The repair cache is `logs/foldx_cache`, a host bind mount, so deploys keep it; only `repair_<hash>_pH.._temp.._ion.._seed.._version` keys with the **same conditions** as the job are hit. Bump `REPAIR_CACHE_VERSION` in `cache.ts` when the FoldX binary or repair command line changes.
* **Timeout messages carry their own context**: budget, residue count, template state and emulation are in the error text, and `[FoldX Timeout Context]` logs the exact reproduction (job dir, args, atom counts, the real `emulated` flag and the RepairPDB diagnostic: outcome, elapsed, FoldX's incomplete-residue count, residues optimised, last residue, stderr/stdout tails). A killed RepairPDB also logs `[RepairPDB Timeout Context]`; a RepairPDB that merely hit its cap looks like a failed repair without it.
* **Windows `%TEMP%` gotcha**: FoldX run in `AppData\Local\Temp` prints "run OK" but writes no output files (RepairPDB: no `wt_Repair.pdb`; BuildModel: "BuildModel failed:"). The same inputs succeed inside the repo. Production job dirs live in `temp_jobs/`; ad-hoc harnesses should use `node_modules/.cache/tmp`.
* **`Dif_wt.fxout` appends**: FoldX appends to an existing Dif file, so reusing a job dir for a second mutation silently mixes runs. Use a fresh dir per mutation.
* **Run averaging**: all BuildModel runs enter the mean and SD; only runs with |ΔΔG| > 20 kcal/mol are excluded (`excludedDdGs`). Runs are discrete rotamer outcomes and can be bimodal; never reintroduce a MAD/Z-score outlier filter for 5 runs (it dropped legitimate runs on 8 of 26 SOD1 variant runs). Identical runs are expected when one rotamer dominates and are not a failure.
* **Repair is a preparation standard, not an accuracy claim**: the owner requested removal of the recurrent unrepaired-template path and remediation of its review findings (2026-10-29; `doc/FOLDX_REPAIR_RCA_2026-10-29.md`). Follow FoldX's [RepairPDB recommendation](https://foldxsuite.crg.es/command/RepairPDB) for predicted and experimental templates within the same resource budgets. Preserve pLDDT as confidence metadata; do not infer that it prevents repair. This supersedes the old guard/benchmark gate for the preparation policy only. A claim that repair improves prediction accuracy still requires a multi-protein benchmark against experimental delta-delta-G; the SOD1 execution proof does not establish that. Keep skipped/rejected repairs visible and never silently manufacture repaired provenance.
