# Pre-registered comparison protocol: adding StabilityOracle vs keeping the 3-engine ensemble

**Date pre-registered:** 2026-11-24
**Status:** Pre-registered — no new comparison benchmark run yet
**Parent records:**
- [doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md](FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md) (§9.5–§9.6)
- [doc/STABILITY_ORACLE_INPUTS_RESEARCH.md](STABILITY_ORACLE_INPUTS_RESEARCH.md)
- [doc/IN_SILICO_PRUNING_PLAN.md](IN_SILICO_PRUNING_PLAN.md) (Phase 6 & Future work)
- [scripts/primary_predictor_benchmark/PLAN.md](../scripts/primary_predictor_benchmark/PLAN.md) (pre-registration pattern)

---

## 1. Purpose

On 2026-11-24, Phase 6 of the in-silico pruning plan retired DynaMut2, DDMut, and the Tamarind ThermoMPNN cloud fallback, leaving **four counted stability engines**:

1. **FoldX 5.1** (physics force field; production size-gated repair rule in `src/shared/foldxRepairMode.ts`, `FOLDX_FULL_REPAIR_MAX_RESIDUES = 233`, ProtVar FoldX as AlphaFold-only stand-in).
2. **ThermoMPNN** (local sidecar, structure-conditioned ProteinMPNN embeddings).
3. **RaSP** (precomputed SQLite lookup table over 1,345 human proteins with experimental structures).
4. **StabilityOracle** (local sidecar, 3D SiameseGraphormer with reconstructed hydrogens via PDB2PQR and recovered per-atom charges).

With DynaMut2 and DDMut removed, two practical questions arise before spending maintenance effort on StabilityOracle's input reconstruction or per-engine calibration:

1. **Consensus gain:** Does including StabilityOracle (**Arm B: FoldX + ThermoMPNN + RaSP + StabilityOracle**) materially improve variant stability classification over the 3-engine ensemble without StabilityOracle (**Arm A: FoldX + ThermoMPNN + RaSP**), especially when RaSP covers the human variant under `MIN_ENGINES_FOR_CONSENSUS = 3`?
2. **Operational cost vs benefit:** On the production OCI ARM64 host (`2 vCPU`), does StabilityOracle's sidecar wall latency, memory footprint, and PDB2PQR failure rate justify retaining it as a default counted engine versus freezing or retiring it?

This protocol freezes the arms, datasets, primary endpoints, bootstrap scheme, and Keep / Freeze / Retire decision rules **before** executing any comparison script against experimental benchmarks or modifying StabilityOracle's code.

---

## 2. Prior verified baselines (locked; not re-tuned)

From [doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md](FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md) §9.5–§9.6 (prior to Phase 6; S669 n = 638, Ssym n = 337, AlphaFold n = 335):

- **Reconstructed StabilityOracle vs upstream published StabilityOracle predictions:**
  - Pearson `r = 0.85` (Ssym), `0.79` (S669), `0.87` (independent UniProt entries outside S669/Ssym/p53/myoglobin, single-chain; `0.81` and `0.88` on whole PDBs).
- **Solo Pearson `r` vs experimental ΔΔG (S669 / Ssym / AlphaFold):**
  - FoldX: `0.33 / 0.65 / 0.40`
  - ThermoMPNN: `0.42 / 0.71 / 0.44`
  - StabilityOracle: `0.38 / 0.66 / 0.37`
- **Solo 3-band verdict match (StabilityOracle):**
  - `45.8%` (S669), `48.7%` (Ssym), `46.3%` (AlphaFold).
- **Pre-Phase-6 three-engine consensus (`FoldX + ThermoMPNN + StabilityOracle`, RaSP excluded on benchmark PDBs):**
  - Verdict band match: `58.4%` on S669 (`+9.3 pts` over always predicting no-destabilization; 95% cluster bootstrap CI `−0.2 to +18.2`, 90% CI `+1.3 to +16.8`), `77.2%` on Ssym (`+21.5 pts`, 95% CI `+5.7 to +32.0`), `62.4%` on AlphaFold (`+12.2 pts`, 95% CI `+4.8 to +20.0`).

Because RaSP had no coverage on non-human or PDB-based benchmark items outside its 1,345-protein table, the effect of adding StabilityOracle alongside **FoldX + ThermoMPNN + RaSP** has never been measured head-to-head.

---

## 3. Pre-registered comparison arms

Both arms evaluate the exact production consensus function `computeStabilityConsensus` (`src/shared/thresholds/consensus.ts`) and `buildEnergeticsEvidence` (`src/shared/energeticsEvidence.ts`) without changing any engine thresholds (`foldx`: `0.5 / 1.5`, `thermompnn`: `0.5 / 1.0`, `rasp`: `0.5 / 1.0`, `stabilityoracle`: `0.2 / 0.2`, `kcal/mol`):

| Arm | Included counted engines | Primary quorum | Sensitivity quorum |
|---|---|---|---|
| **Arm A (3-engine)** | `foldx`, `thermompnn`, `rasp` | `MIN_ENGINES_FOR_CONSENSUS = 3` | sensitivity check with `2` |
| **Arm B (4-engine)** | `foldx`, `thermompnn`, `rasp`, `stabilityoracle` | `MIN_ENGINES_FOR_CONSENSUS = 3` | sensitivity check with `2` |

Rules fixed in advance:
- ProtVar FoldX (`protvar`) participates only under the single-FoldX stand-in rule on AlphaFold templates when local FoldX has no value, identically in both arms.
- Missing/rejected StabilityOracle predictions (e.g., PDB2PQR hydrogen failure) remain `null` in Arm B (strict no-heuristics policy); variants where Arm B produces no StabilityOracle score are kept in the primary intent-to-treat analysis and reported with a separate per-protocol coverage diagnostic.

---

## 4. Datasets and strata

Every benchmark dataset is evaluated **as-shipped** using the production pipeline rules (Single-chain FoldX with `FOLDX_FULL_REPAIR_MAX_RESIDUES = 233`, local shell `fix-shell:r15-seq14:v1` above 233 residues, ThermoMPNN unmasked inference, StabilityOracle single-chain/interface reconstruction per `doc/STABILITY_ORACLE_INPUTS_RESEARCH.md`). S669 and Ssym were used when tuning StabilityOracle's input recipe, so non-overlapping human sets are strictly required for unbiased generalisation.

1. **Stratum 1 — Direct experimental structure benchmarks (`S669` + `Ssym` direct, single-chain):**
   - Evaluates experimental-template agreement and consensus behaviour on established test sets (acknowledging S669/Ssym overlap with prior StabilityOracle input-recipe development).
2. **Stratum 2 — Human AlphaFold 4-engine stratum (with RaSP coverage):**
   - Human missense variants backed by AlphaFold DB models where RaSP (`data/df_rasp_gnomad_clinvar.sqlite`) provides lookup scores alongside FoldX, ThermoMPNN, and StabilityOracle.
   - Drawn from **non-overlapping UniProt entries** in FireProtDB / MegaScale (excluding any UniProt accession present in S669, Ssym, p53 `P04637`, myoglobin `P02144` / `P68082`, or StabilityOracle's training split).
   - **Sample floor:** minimum `>= 50` distinct UniProt proteins and `>= 100` variants so 4-engine consensus vs 3-engine consensus (`FoldX + ThermoMPNN + RaSP` vs `+ StabilityOracle`) has non-degenerate protein clusters. If curated experimental-ΔΔG human variants meeting the RaSP lookup table fall short of the floor, the shortfall is recorded in §7 (Deviations) rather than relaxing overlap exclusions.
3. **Stratum 3 — Direct vs reverse antisymmetry (`Ssym` direct + reverse pairs):**
   - Evaluates thermodynamic antisymmetry (`ΔΔG(wt -> mut) ≈ -ΔΔG(mut -> wt)`) and verdict flip consistency for Arm A vs Arm B on coupled direct/reverse experimental structures.

---

## 5. Primary & secondary endpoints and statistical plan

1. **Primary endpoint (`Stratum 2`, `MIN_ENGINES_FOR_CONSENSUS = 3`):**
   - Paired difference `ΔAccuracy = Acc(Arm B) − Acc(Arm A)` in 3-class experimental stability band match (Stabilizing / Neutral vs Moderately vs Destabilizing per production cut-points `0.5` / `1.5` on lab ΔΔG in `doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md`) and binary destabilization accuracy (`ΔΔG_lab >= 1.0 kcal/mol`).
   - Secondary consensus discrimination: AUROC and AUPRC for `ΔΔG_lab >= 1.0 kcal/mol` using consensus median ΔΔG and destabilizing-vote fraction.
2. **Paired protein-cluster bootstrap:**
   - Resample **UniProt protein clusters** with replacement, **`B = 2,000` replicates**, fixed PRNG seed **`20261124`**, computing percentile `95% CI` and `90% CI` for `ΔAccuracy` (`Arm B − Arm A`) and `ΔAUROC`.
3. **Coverage & quorum sensitivity (`min = 2` vs `3`):**
   - Fraction of variants reaching consensus quorum (`Insufficient engines (< 3)` rate in Arm A vs Arm B) when RaSP is absent vs present.
4. **Operational & reliability metrics (OCI ARM64 production parity, `2 vCPU`):**
   - Per-variant median and p95 wall-clock latency (ms) and peak RSS (MiB) of `/predict/stabilityoracle` vs `/predict/thermompnn`.
   - Rate of PDB2PQR hydrogen-addition rejections and `180 s` timeout / `503` busy exits on Stratum 1–3 structures.

---

## 6. Fixed decision gates

The evaluation leads directly to one of three mutually exclusive, collectively exhaustive dispositions for StabilityOracle, evaluated in order (**Retire** > **Keep** > **Freeze**):

| Outcome | Quantitative trigger (evaluated in precedence order on **Stratum 2** + operational telemetry) | Action |
|---|---|---|
| **Retire (Phase 7 candidate)** | Any one holds: **(a)** upper bound of 95% CI on `ΔAccuracy <= +1.0 percentage point` **or** 90% CI on `ΔAccuracy` lies strictly `< 0` (`Arm B` degrades consensus accuracy); **or (b)** OCI ARM64 p95 latency `> 60 s`; **or (c)** operational/structural failure rate `> 10%` (combined PDB2PQR rejections, `180 s` timeouts, and `503` failures). | Retire StabilityOracle following the Phase 6 pattern; keep `FoldX + ThermoMPNN + RaSP` (with sensitivity review of `MIN_ENGINES_FOR_CONSENSUS`). |
| **Keep (active default)** | No **Retire** trigger fires (`p95 <= 60 s`, failure rate `<= 10%`), **and** all of: **(a)** lower bound of 95% CI on `ΔAccuracy > +1.0 percentage point` (or consensus coverage gain `>= +2.0 percentage points` where `Arm A` lacks quorum while `Arm B` keeps `ΔAccuracy` 90% CI lower bound `>= 0` and AUROC 95% CI lower bound `>= -0.02`); **and (b)** OCI ARM64 p95 latency `<= 30 s` and failure rate `< 10%`. | Retain StabilityOracle in `COUNTED_ENERGY_ENGINES` and maintain PDB2PQR/charge support. |
| **Freeze (no new engineering)** | Every remaining case that triggers neither **Retire** nor **Keep** — specifically when `(a)` `ΔAccuracy` 95% CI straddles `+1.0` (`lower <= +1.0 < upper` without failing 90% CI `< 0`) while `p95 <= 60 s` and failure rate `<= 10%`, **or** `(b)` accuracy meets **Keep** while OCI ARM64 p95 latency falls in `(30 s, 60 s]` or failure rate equals `10%`. | Keep current code frozen (`doc/FUTURE_WORK.md`), invest zero additional engineering on input reconstruction or ChargeFW2, and revisit only if a cheaper local predictor replaces it. |

---

## 7. Deviations & execution log

*(Empty at pre-registration. Record any dataset availability adjustments, exclusion corrections, host substitutions, or script revisions here with exact dates before interpreting results.)*
