# Energetics Benchmarking Suite (S669 & Ssym)

Self-contained benchmark suite evaluating 7 stability prediction engines (`FoldX`, `ThermoMPNN`, `StabilityOracle`, `RaSP (SQLite)`, `DynaMut2`, `DDMut`, `ProtVar FoldX`) on **S669** (669 variants), **Ssym direct** (342 variants), and **Ssym reverse** (342 variants).

## Sign Convention

All metrics use the canonical convention **`positive = destabilizing` (kcal/mol)**, matching `toCanonicalDdg` in `src/shared/engineStatus.ts`:
- **Negated (`-raw_ddg`) in `common.py` ONLY**: `DynaMut2`, `DDMut` (`negative-destabilizing` natively)
- **NOT negated (used as reported, `positive = destabilizing`)**: `FoldX`, `ThermoMPNN`, `StabilityOracle`, `RaSP (SQLite)`, `ProtVar FoldX`

Note explicitly: **`StabilityOracle` and `RaSP` are NOT negated**.

## Strictly Held-Out Filtering & Statistics

- **Protein bootstrap grouping (`prepare_datasets.py`)**: Variants are grouped (`cluster`) by **UniProt accession** so all PDB structures/chains of the same protein are resampled together as one unit (`2,000` bootstrap draws, seed `42`). A variant with no UniProt accession gets its own `PDB_chain` group and is flagged `no_accession: true`. In Ssym, direct and reverse partners share `pair_id` and the same protein `cluster` so pairs are resampled together.
- **Held-out criteria (`training_overlap.py`)**: Any protein without a UniProt accession is **excluded** from every held-out set (`no_uniprot_accession`). Otherwise, a protein is excluded from an engine's held-out split if its PDB ID or UniProt ID matches that engine's training set, OR if global Needleman-Wunsch sequence identity against any chain in that engine's training set is **>= 25%**.
- **Sample-size thresholds (`metrics.py`, `evaluate.py`)**:
  - Spearman $\rho$, Pearson $r$, RMSE, and Ssym antisymmetry require **$n \ge 20$** scored variants/pairs (otherwise reported as `"too few"`, with no numeric estimate).
  - ROC AUC (destabilizing = $\text{measured} \ge 1.0\ \text{kcal/mol}$) and the A7 held-out check require **$\ge 20$ destabilizing and $\ge 20$ other** variants (otherwise reported as `"too few to judge"`, with no numeric estimate).
  - Every table reports `scored / eligible` coverage, missing-row reasons, independent protein group counts, and both class counts (`destab / other`) beside every statistic. `RaSP` and `ProtVar` cover human proteins only (reported separately and marked `"partial set"`).
- **A5 signed-example check (`evaluate.py`)**: Per engine and dataset, checks up to 5 large buried hydrophobic-to-small substitutions (`W/F/Y/L/I/M/V -> A/G`, prioritized by `CA <= 8 A` neighbor count and `measured > 0`), reporting measured $\Delta\Delta G$, raw engine score, canonical converted score, and sign agreement.

## Running End-to-End

Run scripts from the repository root with isolated Python (`C:\Python314\python.exe -I`):

```powershell
# 1. Download S669 / Ssym / clean PDBs & build datasets.json (with training overlap flags)
& C:\Python314\python.exe -I scripts/energetics_benchmark/prepare_datasets.py

# 2. FoldX (seeds S669/Ssym direct from logs/foldx_bench unless --from-scratch)
& C:\Python314\python.exe -I scripts/energetics_benchmark/run_foldx.py --workers 8

# 3. Local ML sidecar (ThermoMPNN & StabilityOracle; seeds from logs/foldx_bench unless --from-scratch)
& C:\Python314\python.exe -I scripts/energetics_benchmark/run_local_models.py --engines thermompnn
& C:\Python314\python.exe -I scripts/energetics_benchmark/run_local_models.py --engines stabilityoracle

# 4. Local RaSP SQLite & EBI ProtVar FoldX API (canonical UniProt coordinate mapping)
& C:\Python314\python.exe -I scripts/energetics_benchmark/run_rasp_protvar.py

# 5. BioSig APIs (DynaMut2 & DDMut): 1 in flight, >=10s delay, cached on disk, fixed random sample (seed 42)
& C:\Python314\python.exe -I scripts/energetics_benchmark/run_biosig.py --sample 150 --seed 42 --delay 10

# 6. Evaluate metrics, bootstrap CIs, A5/A6/A7 checks, and published comparisons -> results.json & results.md
& C:\Python314\python.exe -I scripts/energetics_benchmark/evaluate.py

# 7. Unit tests
& C:\Python314\python.exe -I scripts/energetics_benchmark/test_metrics.py -v
```

## Execution & Methodological Notes

- **FoldX Windows path constraint**: `foldx_1_20270131.exe` silently produces no output files when run inside `%TEMP%` or dot-prefixed paths (`.t3/`). `run_foldx.py` stages temporary run directories under `logs/foldx_bench/_fx_work` and cleans each directory immediately after parsing `Dif_wt_Repair.fxout`.
- **UV venv launch fallback**: On Windows setups where `tools/.venv/Scripts/python.exe` fails with `0xC0000142` (`DLL_INIT_FAILED`), `run_local_models.py` reads `tools/.venv/pyvenv.cfg` and invokes the base Python executable with `PYTHONPATH` set to `tools/.venv/Lib/site-packages`.
- **WT-only database lookups (`RaSP (SQLite)`, `ProtVar FoldX`)**: `S669.tsv` and `Ssym.tsv` human mutations frequently use PDB construct numbering rather than canonical UniProt numbering; `run_rasp_protvar.py` resolves canonical UniProt coordinates via cached UniProt FASTA sequences (`seq[pos - 1] == wt`). Because both engines index wild-type human proteomes only, `ssym_reverse` (mutant crystal structures) is marked `not_applicable_wt_lookup` (`0` human WT eligible).
- **BioSig rate limits & observed queue behavior**: `run_biosig.py` enforces strict sequential execution (`1` request in flight, `>= 10s` delay between submissions, per-variant disk cache under `cache/biosig/`) and defaults to a fixed random sample (`--sample 150 --seed 42`) when full sets are impractical over the public web queue. Repeated public-server stalls/errors (`RUNNING >180-480s` timeouts on `1DIVA`, `HTTP 500` on `DDMut` `1DIVA_V21A`, and transient `Errno 11001` DNS failures) are recorded verbatim in cache and `results.md`.
- **FoldX `ssym_reverse` throughput**: Unlike `s669` and `ssym_direct` (which share repaired WT structures across variants), every one of the 342 `ssym_reverse` variants uses a distinct mutant crystal PDB requiring its own `RepairPDB` + 5x `BuildModel` run; partial checkpoints are persisted immediately to `cache/foldx_ssym_reverse.jsonl`.
