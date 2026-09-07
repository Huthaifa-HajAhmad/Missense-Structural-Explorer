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

## 2. Capabilities Diagnostic Endpoint

Before assuming an engine is missing or broken, query the machine-readable capabilities endpoint:
```http
GET /api/v1/capabilities
```
Returns live JSON status for all 8 engines (`foldx_linux_elf`, `foldx_windows`, `box64`, `rasp`, `thermompnn`, `stabilityoracle`, `saprot`, `japanfold`) along with system architecture and sidecar latency.

## 3. Strict No-Heuristics Policy

* **Zero Synthetic Fallbacks**: Never fabricate, extrapolate, or heuristically approximate stability scores (ΔΔG), binding pockets, or evolutionary likelihoods.
* If an engine cannot compute a score, return `null` and document the exact reason. Calibrated consensus automatically re-weights available evidence.
