# Energetics Reproducibility & FoldX Large-Template (`> 400` aa) Repair Plan (v2 — Reconciled)

> [!NOTE]
> **Implementation status (2026-11-03) — shipped, with these verified corrections to this plan**
>
> | Item | Status |
> | :--- | :--- |
> | P0-1 persist companion results | **Shipped**: `backfillMutantCacheCompanions` (`foldx/cache.ts`), called from `finishFoldxQueueJob`; only answers are kept, never an outage. **The joined-job copy was dropped**: a joined request's response carries no StabilityOracle, RaSP or ProtVar fields at all (they travel on the poll of the job record, which already holds them), so there was nothing to copy. |
> | P0-2 completeness gate | **Shipped** as `agreement.provisional` plus a "Provisional · N still running" marker and a sentence naming the running engines. The Comparison tab already said "other results are still being collected"; the Records tab did not. |
> | Interval-aware cut-point caveat | **Not built.** FoldX's `sd` is the run-to-run spread (about 0.002), so `max(2·sd, 0.25)` is a constant ±0.25 band: the same arbitrary guard the review rejected, under a different name. The honest disclosure is the repair mode (the offset that is actually measured). |
> | P0-3 cache identity | **Shipped**: key version v5 with `_repair:<mode>`; payload carries `repairMode`, `repairModeIntended`, `repairShell`, `conditions`, `templateExtent` (through the enrich whitelist, the agent result schema and the client contract). |
> | P1-1 text bugs | **Shipped** (Comparison chip no longer repeats its state; Inspector no longer prints `.;`), with tests. |
> | P2-1 StabilityOracle SASA | **Unchanged on purpose**, as written. |
> | Part B local repair | **Shipped** as a disclosed estimator chosen by template size alone (`src/shared/foldxRepairMode.ts`): whole chain up to 233 residues, `--fix-residues-file` local repair above. The old "skip repair above 400, repair later in the background, replace the answer" two-phase behaviour is gone for large templates. Background repair remains only for a whole-chain repair that does not fit a slow host. |
> | Cost model | `nativeFoldxRepairPriorMs` is kept as the whole-chain curve (valid at 154 and 305 residues); sizes above 233 use a local-repair constant (15 s native, 5.6x emulated). |
> | Acceptance test | **Done, and replaced by a stronger one.** All of S669 against experiment (667 variants on 94 chains, `scripts/foldx-repair-benchmark.ts`, bench doc section 9.3). The whole-chain-to-local size rule stands: whole-chain is slightly better up to 233 residues, and no difference is detectable above. |
>
> The site counts in this plan were corrected from "9" to "8" (five GATA4 and three CNNM2 sites).


> [!IMPORTANT]
> **Reconciliation & Benchmark Update (2026-11-02):**
> 1. **Why v1's `--mutate-residues-file` failed the benchmark:** Direct measurement on `CNNM2 p.Ser489Cys` (875 aa) and `GATA4 p.Ser159Cys` (442 aa) in [`doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md) showed that `--mutate-residues-file` diverged from full `RepairPDB` by `0.73 kcal/mol` on CNNM2 (`+0.441` vs `+1.175`) and `0.47 kcal/mol` on GATA4 (`+0.602` vs `+0.128`). Diagnostic testing (`test_all_mutate_flag`) revealed the root cause inside FoldX 5.1: passing `--mutate-residues-file` — **even when listing all 442 residues of the protein** — switches FoldX into a simplified single-pass code branch (`48.2 s`) that skips standard `RepairPDB` optimization (`89.0 s`).
> 2. **`--fix-residues-file` + adaptive sequence buffer (revised after held-out validation):** passing the *complement* set keeps FoldX 5.1 on its standard `RepairPDB` code path and is **10–26× faster**, but it is **not a drop-in equivalent to full repair**. At the two tuning sites it agrees to `0.002`–`0.033 kcal/mol`; across the six held-out substitutions (eight sites with the two tuning sites) the disagreement reaches **0.33 and 0.51 kcal/mol**, band-changing in 2 of 8 sites — and both failures are in the `≥25`-residue regime the `< 25` buffer rule calls safe. See §9.1 of [`doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md). It may be served as the single, disclosed repair mode; it must not be described as reproducing `RepairPDB`, and must not be mixed with full-repair values for the same variant.
> 3. **Architectural Revisions Adopted from Review & GLM-5.3-Flash Concordance:**
>    - `P0-2` is rewritten against the actual current code in [`foldx-queue-job.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx-queue-job.ts#L244-L264) and [`generation.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/routes/biophysics/generation.ts#L591-L605).
>    - `repairMode` (`none` | `full` | `fix-shell:r15-seq14:v1`) is added to `getFoldxCacheKey` (`FOLDX_CACHE_VERSION = "v5"`) so cache warmth can never silently flip a served answer.
>    - Host-class-dependent repair mode branching and Tier 2 strip-and-splice are **dropped** so every machine computes the same estimator.
>    - `P1-1` (StabilityOracle SASA) is gated on upstream checkpoint feature-scale calibration so raw $\text{Å}^2$ values do not shift the `[0, 30]` tensor distribution.

**Date:** 2026-11-02 (Reconciled v2; original 2026-10-30)  
**Related Documents:**  
- [`doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md) — Empirical benchmark of `--mutate-residues-file` vs. `--fix-residues-file` vs. full `RepairPDB`  
- [`doc/FOLDX_REPAIR_RCA_2026-10-29.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/FOLDX_REPAIR_RCA_2026-10-29.md) — FoldX RepairPDB skip & Box64 budget RCA  
- [`doc/ENERGETICS_TAB_REVIEW.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/ENERGETICS_TAB_REVIEW.md) — Energetics scientific-integrity review  

---

## 1. Executive Context: The `GATA4 p.Ser159Cys` Discrepancy

Across three runs of `GATA4 p.Ser159Cys` (`GRCh38 8-11708788-C-G`, UniProt `P43694`, AlphaFold 442 residues), the Energetics tab produced three different headline verdicts (`Engines disagree` $\rightarrow$ `Mostly no destabilization` $\rightarrow$ `Mostly moderately destabilizing`) and shifting engine outputs. All readings are **100% deterministic functions of template state and panel completeness** (FoldX itself is bit-reproducible to 4 decimal places):

| Signal / Engine | Screen 1 (Unrepaired Template) | Screen 2 (Warm Full-Repair Cache) | Screen 3 (Cold Cache + Partial Panel) | Confirmed Root Cause |
| :--- | :--- | :--- | :--- | :--- |
| **Headline Verdict** | `Engines disagree` (`5/6`, median `+0.23`) | `Mostly no destabilization` (`6/6`, median `+0.25`) | `Mostly moderately destabilizing` (`3/6`, median `+0.58`) | [`buildEnergeticsEvidence`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/energeticsEvidence.ts#L569-L611) applies the `>= 2/3` modal band rule over whatever engines have reported so far, with no gate for `running` engines or provisional unrepaired templates. |
| **FoldX 5.1** | `+0.58 kcal/mol` (`+0.5761 ± 0.0014`, unrepaired) | `+0.13 kcal/mol` (`+0.1276 ± 0.0045`, `repaired (reused)`) | `+0.58 kcal/mol` (`+0.5761 ± 0.0014`, unrepaired) | Two-phase repair policy ([`runner.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/runner.ts#L537-L592), [`cache.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/cache.ts#L56-L61)): `442 > FOLDX_REPAIR_MAX_RESIDUES (400)` skips foreground `RepairPDB` on Run 1 (`+0.58`), schedules background repair, and invalidates the unrepaired mutant cache entry once `repairedStructureCache` is populated (`+0.13`). |
| **StabilityOracle** | `+0.23 kcal/mol` (Neutral) | `+0.58 kcal/mol` (Moderately destabilizing) | `No result` (`no-result`) | Screen 1 $\rightarrow$ 2 shift came from commit `9560ea3` replacing the B-factor/pLDDT SASA bug (`43.3/10 = 4.33`) with the geometric neighbor proxy (`30 * exp(-N/18)`) in [`stabilityoracle.py`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/tools/model_server_app/routers/stabilityoracle.py#L201-L228). Screen 3 dropped to `No result` because companion results are written only to the ephemeral queue job record in [`foldx-queue-job.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx-queue-job.ts#L85-L214), not persisted to `mutantCache` on job completion, and omitted when joining an active job in [`generation.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/routes/biophysics/generation.ts#L594-L602). |
| **DynaMut2** | `Provider busy` | `+0.37 kcal/mol` (Neutral) | `Running` | External Monash API rate limit / in-flight remote polling while FoldX had already finished. |
| **ThermoMPNN** | `-0.38 kcal/mol` | `-0.38 kcal/mol` | `Not available here` | Local Python model sidecar (`localhost:8001`) offline during Screen 3. |
| **DDMut / RaSP** | `-0.08` / `+0.81` | `-0.08` / `+0.81` | `-0.08` / `+0.81` | Deterministic across all 3 runs. |

---

## 2. Remediation Plan — Part A: Concrete Pipeline, Cache & UI Fixes

### P0-1 (Was Bug 1): Persist Companion Engine Results Atomically into `mutantCache` & Copy on Joined Jobs
- **Where:**
  - [`server/services/stability/foldx-queue-job.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx-queue-job.ts#L244-L264) (`finishFoldxQueueJob`)
  - [`server/services/stability/foldx/cache.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/cache.ts#L118-L148) (`writeMutantToCache` / companion backfill helper)
  - [`server/routes/biophysics/generation.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/routes/biophysics/generation.ts#L591-L605) (joined active job branch)
- **Root Cause (Verified Against Current Tree):**
  1. Inside [`runFoldxQueueJobOnServer`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx-queue-job.ts#L266-L310), `generateMutantPdb` writes the raw FoldX result to `mutantCache` inside [`runner.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/runner.ts#L596) **before** `finishFoldxQueueJob` merges `remoteJobs` (`rasp`, `protvar`, `stabilityoracle`) via `enrichBiophysicalResult` ([`foldx-queue-job.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx-queue-job.ts#L263)). Consequently, `mutantCache` on disk and in memory always starts with `stabilityoracle: null`, `rasp: null`, `protvar: null`.
  2. Although [`generation.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/routes/biophysics/generation.ts#L803-L890) now attempts a synchronous re-evaluation of `StabilityOracle` and `RaSP` on a cache hit, **joining an in-flight queue job** (`submission.joined === true` at [`generation.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/routes/biophysics/generation.ts#L591-L605)) copies only `dynamut2*`, `ddmut*`, and `thermompnn*` from `existingJobData.remoteJobs` — omitting `stabilityoracleVal`, `stabilityoracleStatus`, `stabilityoracleError`, `raspVal`, `raspStatus`, `raspReason`, `protvarVal`, and `protvarStatus`.
- **Fix:**
  1. In [`finishFoldxQueueJob`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx-queue-job.ts#L263), after `const enriched = enrichBiophysicalResult(...)`, persist the completed companion scores and statuses (`stabilityoracle`, `rasp`, `protvar`, and `structureProvenance`, excluding transient outage errors so a temporary sidecar restart isn't fossilized for 24h) back into `mutantCache` via a dedicated `backfillMutantCacheCompanions(cacheKey, enriched)` in [`cache.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/cache.ts).
  2. In [`generation.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/routes/biophysics/generation.ts#L594-L602), copy `stabilityoracle*`, `rasp*`, and `protvar*` fields from `existingJobData.remoteJobs` when `submission.joined` is true.

### P0-2 (Was Bug 5): Gate Headline Consensus on Panel Completeness & Principled Cutpoint Intervals
- **Where:**
  - [`src/shared/energeticsEvidence.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/energeticsEvidence.ts#L569-L611)
  - [`src/components/energetics/EnergeticsVerdictCard.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/energetics/EnergeticsVerdictCard.tsx)
- **Root Cause:**
  - `buildEnergeticsEvidence` computes the `>= 2/3` modal band verdict solely from `readings.filter(r => r.counted && r.ddg !== null)` without checking whether any consensus-eligible engines are still in `outcome.status === "running"` (e.g., Screen 3 where 3 of 6 engines had reported and DynaMut2 was still running).
- **Fix:**
  1. **Completeness Gate on Consensus:** Add `runningCount = readings.filter(r => r.outcome.status === "running").length` and `isComplete = runningCount === 0` to `EnergeticsAgreement`. While `runningCount > 0` (or when `nCounted < 3`), mark the verdict as **provisional** (`provisional: true`, badge: `Provisional — ${nCounted} of ${totalEligible} engines settled`) and suppress final consensus confidence until all running engines settle.
  2. **Interval-Aware Cutpoint Disclosure (Replacing `±0.15`):** Because FoldX's empirical RMSE is `~0.5–1.0 kcal/mol` and each multi-run FoldX result carries a sample standard deviation `sd`, replace the arbitrary `±0.15 kcal/mol` guard with an interval check: flag a borderline cutpoint caveat when FoldX's `[mean - max(2*sd, 0.25), mean + max(2*sd, 0.25)]` straddles `0.50` or `1.50 kcal/mol`, or when the template is unrepaired.

### P0-3: Cache Key Discipline (`repairMode` + `structureExtent` Provenance)
- **Where:**
  - [`server/services/stability/foldx/cache.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/cache.ts#L152-L176)
  - [`server/services/stability/foldx/runner.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/runner.ts#L537-L605)
- **Root Cause:**
  - Today `getFoldxCacheKey` does not include `repairMode`, and `getMutantFromCache` ([`cache.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/cache.ts#L59-L60)) silently invalidates a previously served unrepaired result once a background repair lands. Furthermore, `pH`, `temperature`, `ionicStrength`, `repairMode`, and template residue extent (`firstResidue..lastResidue`, `residueCount`) are not recorded in the stored `energetics` payload.
- **Fix:**
  1. Include `repairMode: "none" | "full" | "fix-shell:r15-seq14"` in `FoldxCacheKeyOptions` and bump `FOLDX_CACHE_VERSION` from `"v4"` to `"v5"`.
  2. Persist `conditions: { pH, temperature, ionicStrength }`, `repairMode`, and `templateExtent: { residueCount, chainId, seqRange }` inside the cached payload so the UI and exports always report exact provenance.

### P1-1 (Was Bugs 3 & 4): Fix Duplicated Status Prefix in `EnergeticsComparison` & `.;` in `EnergeticsInspector`
- **Where:**
  - [`src/components/energetics/EnergeticsComparison.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/energetics/EnergeticsComparison.tsx#L82)
  - [`src/components/inspector/EnergeticsInspector.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/inspector/EnergeticsInspector.tsx#L277)
- **Fix:**
  - In `EnergeticsComparison.tsx` L82, avoid concatenating `r.status` and `r.reason` when `r.reason` already starts with the status phrase (`Not available`).
  - In `EnergeticsInspector.tsx` L277, strip trailing periods before `.join("; ")` (`absent.map(r => absenceText(r).replace(/\.$/, "")).join("; ") + "."`).

### P2-1 (Was Bug 6 — Gated on Calibration): Verify `StabilityOracle` Upstream SASA Feature Scaling Before Changing `featurize_pdb_for_stability_oracle`
- **Where:**
  - [`tools/model_server_app/routers/stabilityoracle.py`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/tools/model_server_app/routers/stabilityoracle.py#L201-L228)
- **Why Gated:**
  - As the review and GLM-5.3-Flash noted, `pp_tensor[0, i, 1]` is clamped to `[0.0, 30.0]` and fed into a frozen pretrained checkpoint (`stability_oracle.pt`). Feeding unnormalized Shrake–Rupley $\text{Å}^2$ values without matching the exact probe/radii/scaling used by the upstream `mark_surface` preprocessor would introduce a new distribution shift.
- **Action:**
  - Keep the deterministic geometric neighbor proxy (`30.0 * exp(-neighbor_count / 18.0)`) in production until we verify the exact upstream `mark_surface` atom-level SASA distribution against `stability_oracle.pt` on a reference benchmark.

---

## 3. Remediation Plan - Part B (Revised): Fast FoldX Template Repair via `--fix-residues-file` (a distinct, disclosed estimator — not an equivalent)

### 3.1 Why v1's `--mutate-residues-file` Failed — And Why `--fix-residues-file` Succeeds

In v1 of this plan, we proposed passing a $15\text{ Å}$ contact shell to `FoldX --command=RepairPDB --mutate-residues-file=shell.txt`. Direct benchmarking in [`doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md) proved that `--mutate-residues-file` failed on both test cases:
- **CNNM2 (875 aa, `SA489C`):** `--mutate-residues-file` gave `+0.441 ± 0.019 kcal/mol` vs. full repair `+1.175 ± 0.023 kcal/mol` (an error of **`-0.734 kcal/mol`**, flipping `moderate` $\rightarrow$ `neutral`).
- **GATA4 (442 aa, `SA159C`):** `--mutate-residues-file` gave `+0.602 ± 0.001 kcal/mol` vs. full repair `+0.128 ± 0.005 kcal/mol` (an error of **`+0.475 kcal/mol`**, flipping `neutral` $\rightarrow$ `moderate`).

#### Controlled Diagnostic: What Happens Inside FoldX 5.1
To isolate why `--mutate-residues-file` diverged even at radius $30\text{ Å}$ on GATA4, we ran `RepairPDB --mutate-residues-file=shell.txt` listing **all 442 residues of GATA4** (`logs/foldx_bench/gata4/test_all_mutate_flag`):
- Even with **all 442 residues listed**, `--mutate-residues-file` ran in `48.16 s` (vs. `89.0 s` for standard `RepairPDB`) and produced coordinates at `Tyr158`/`Ser159`/`Tyr162` that matched the broken `shell_15` output (`diff = 0.0010 Å` at `Ser159`, `0.137 Å` at `Tyr158`) while diverging by **`2.20 Å`** from standard `RepairPDB`!
- **Conclusion:** Inside FoldX 5.1, `--mutate-residues-file` invokes a **different, simplified C++ repair routine** (`Checking if there are specific residues to repair`), **not** standard `RepairPDB`.

#### The Solution: `--fix-residues-file` + Adaptive Sequence Buffer
Unlike `--mutate-residues-file`, passing the **complement set** (all residues *outside* the local neighborhood) via **`--fix-residues-file=fix.txt`** (with no `--mutate-residues-file` flag) keeps FoldX 5.1 on its standard `RepairPDB` code path, simply skipping rotamer optimization on the fixed distant residues. It is therefore a *different minimisation* from full-chain `RepairPDB` — the same code, not the same result (measured spread: ≤0.03 kcal/mol at most sites, up to 0.51 at others).

Furthermore, to prevent the second failure mode identified in the review — **shell collapse in disordered/extended segments** (where `GATA4 p.Ser159Cys` at `pLDDT 43.3` had only 11 residues within $15\text{ Å}$, clamping `Phe154` against fixed sequence neighbors `146..153`) — we define the unfixed repair region $U(c, p)$ around target residue $(c, p)$ as:

$$U(c, p) = S_{15\text{Å}}(c, p) \cup \begin{cases} [p - 14,\, p + 14]_c & \text{if } |S_{15\text{Å}}(c, p)| < 25 \text{ (sparse / disordered loop)} \\ [p - 1,\, p + 1]_c & \text{if } |S_{15\text{Å}}(c, p)| \ge 25 \text{ (globular domain)} \end{cases}$$

where $S_{15\text{Å}}(c, p)$ is the set of all residues with at least one heavy atom within $15.0\text{ Å}$ of any heavy atom of $(c, p)$. Every residue **not** in $U(c, p)$ is written to `fix.txt` and passed to `FoldX --command=RepairPDB --pdb=wt.pdb --fix-residues-file=fix.txt`.

---

### 3.2 Measured Benchmark: `--fix-residues-file` (Adaptive Shell) vs. `--mutate-residues-file` vs. Full `RepairPDB`

> **Held-out validation changes the conclusion of this table (see §9.1 of the bench doc).** These two
> rows are the sites the rule was tuned on. Applied unchanged to six further substitutions, the
> fix-complement method disagreed with full repair by up to **0.51 kcal/mol** and flipped the band in
> **2 of 8** sites — both in the `|S₁₅| ≥ 25` regime that this table treats as safe. The speed-up is
> real; the equivalence is not. Read the table as "works at these two sites", not "equivalent".

All runs executed with native FoldX 5.1 (`tools/foldx/foldx_1_20270131.exe`, `--numberOfRuns=5`, `--timeSeedRotabase=false`; scripts and raw outputs in `logs/foldx_bench/`):

| Protein & Substitution | Regime | Template Method | Unfixed / Total Residues | `RepairPDB` Wall Time | `BuildModel ×5` ΔΔG (kcal/mol) | SD | Error vs. Full `RepairPDB` | FoldX Band (`0.50` cut) |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| **CNNM2 875 aa** (`SA489C`) | Globular (`|S₁₅| = 62 ≥ 25`) | Unrepaired | 0 / 875 | — | `+1.0610` | `0.0030` | `-0.1140` | moderate |
| **CNNM2 875 aa** (`SA489C`) | Globular | `--mutate-residues-file` (15 Å, v1 plan) | 62 / 875 | `11.10 s` | `+0.4406` | `0.0187` | **`-0.7344` (FAIL)** | **neutral (FLIP)** |
| **CNNM2 875 aa** (`SA489C`) | Globular | **`--fix-residues-file` (15 Å, v2 plan)** | **62 / 875** | **`10.93 s` (26× faster)** | **`+1.1732`** | **`0.0168`** | **`-0.0018` (PASS)** | **moderate (MATCH)** |
| **CNNM2 875 aa** (`SA489C`) | Globular | **Full-chain `RepairPDB`** | 875 / 875 | `284.10 s` | **`+1.1750`** | `0.0230` | `0.0000` (ref) | **moderate** |
| **GATA4 442 aa** (`SA159C`) | Disordered (`pLDDT 43.3`, `|S₁₅| = 11 < 25`) | Unrepaired (Screen 1 & 3) | 0 / 442 | — | `+0.5761` | `0.0014` | `+0.4485` | **moderate (FLIP)** |
| **GATA4 442 aa** (`SA159C`) | Disordered | `--mutate-residues-file` (15 Å, v1 plan) | 11 / 442 | `0.90 s` | `+0.6023` | `0.0013` | **`+0.4747` (FAIL)** | **moderate (FLIP)** |
| **GATA4 442 aa** (`SA159C`) | Disordered | **`--fix-residues-file` (`15 Å ∪ ±14 seq`, v2 plan)** | **29 / 442** | **`8.48 s` (10.5× faster)** | **`+0.1610`** | **`0.0263`** | **`+0.0334` (PASS)** | **neutral (MATCH)** |
| **GATA4 442 aa** (`SA159C`) | Disordered | **Full-chain `RepairPDB` (Screen 2)** | 442 / 442 | `89.00 s` | **`+0.1276`** | `0.0045` | `0.0000` (ref) | **neutral** |

---

### 3.3 Reconciled Policy for Repair & Cost Calibration

1. **Single, Host-Invariant Repair Policy Above 233 Residues (No Host-Class Divergence):**
   - To guarantee that the same variant on the same template never produces two different answers depending on whether it ran on an x64 workstation or an ARM64/Box64 server:
   - **Option B1 (Strict Full-Repair / Cache-First):** If a full-chain `wt_Repair.pdb` is already in `repairedStructureCache`, always use it.
   - **Option B2 (Foreground Adaptive `--fix-residues-file` Repair above 233 aa):** When a template has `> 233` residues (or is ineligible for foreground full repair) and has no cached full repair, run `RepairPDB --fix-residues-file=fix.txt` using the adaptive shell $U(c, p)$ (`15 Å 3D sphere`, padded with `±14` sequence neighbors when `|S_{15\text{Å}}| < 25`).
   - **Key Separation & No Silent Overwrite:** Record `repairMode: "fix-shell:r15-seq14"` in the mutant cache key and diagnostic payload (`template: "repaired (local fix-shell, K unfixed residues)"`). Never silently overwrite a served mutant cache key in place; if a user or background pre-warm requests full-chain repair, it is keyed under `repairMode: "full"`.
   - **Mode Is Chosen by Template Size Alone, Never by Host or Cache Warmth:** because the two modes can differ by up to 0.51 kcal/mol at some sites (§9.1), a variant must never be served under two modes. Pick the mode from `residueCount` (identical on every deployment), and treat a mode change as a cache-version change, not an upgrade.
2. **`nativeFoldxRepairPriorMs` recalibration — NOT applied (open item):**
   - The curve (`49 s @ 154 aa`, exponent 2.1) still predicts `449 s` at 442 aa where `89.0 s` was measured. The shipped change adds a separate local-repair prior (`15 s` native, `5.6×` emulated) and leaves the old curve for the ≤ 233 full-repair path and background admission, where no measurement contradicts it yet.
   - It is a placement/ETA error, not an answer error: it can make a job look slower than it is. Recalibrate only with ≥ 10 measured full repairs in 100–233 aa, not from the 442/875 aa points (those are now `fix-shell` and do not exercise `RepairPDB` whole-chain).

---

## 4. Revised & Prioritized Implementation Checklist

| Priority | Work Package | Target Files | Verification |
| :--- | :--- | :--- | :--- |
| **P0-1** | **Persist Companion Results (`StabilityOracle`, `RaSP`, `ProtVar`, ThermoMPNN) into `mutantCache` on Job Finish** (joined jobs need no copy: the job poll already carries them) | [`server/services/stability/foldx-queue-job.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx-queue-job.ts#L244-L264), [`server/services/stability/foldx/cache.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/cache.ts), [`server/routes/biophysics/generation.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/routes/biophysics/generation.ts#L591-L605) | Cold run followed by cache hit and concurrent joined-job request all return identical `StabilityOracle`, `RaSP`, and `ProtVar` scores/statuses without dropping to `No result`. |
| **P0-2** | **Add `repairMode` to `getFoldxCacheKey` (`v5`) & Persist Conditions/Template Extent in Payload** | [`server/services/stability/foldx/cache.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/cache.ts#L152-L176), [`server/services/stability/foldx/runner.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/runner.ts) | Unit tests verifying distinct cache keys per `repairMode` and full condition/extent provenance in cached JSON. |
| **P0-3** | **Completeness Gate on `buildEnergeticsEvidence` (provisional while any counting engine runs)** — the interval-based cutpoint rule was dropped: FoldX's run-to-run SD is ~0.002, so `mean ± max(2·sd, 0.25)` is a fixed ±0.25 band, i.e. the arbitrary guard the review rejected. The measured repair-mode offset is the honest disclosure instead. | [`src/shared/energeticsEvidence.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/energeticsEvidence.ts), [`src/components/EnergeticsView.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/EnergeticsView.tsx) | Tests confirm a partial panel is `provisional: true` and that the marker is visible on the default Comparison tab as well as Engine records. |
| **P1-1** | **Adaptive `--fix-residues-file` Local Repair (`15 Å ∪ ±14 seq if <25`) & `nativeFoldxRepairPriorMs` Recalibration** | [`server/services/stability/foldx/pdb-utils.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/pdb-utils.ts), [`server/services/stability/foldx/runner.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/server/services/stability/foldx/runner.ts), [`src/shared/computeRouting.ts`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/shared/computeRouting.ts) | Held-out regression on **≥10 substitutions across ≥2 templates**, not the two tuning sites: report the full \|Δ vs full `RepairPDB`\| distribution, count band flips, and assert determinism. Completed (14 sites, 4 structures, 3 proteins): 9 within 0.04, five at 0.06–0.51, two band flips, and the misses are not confined to one structure — so the acceptance criterion is "disclosed offset", not "equivalence". Any further site is a new measurement, not a code change. |
| **P1-2** | **Missing-Engine Chip Prefix Deduplication & Rule Trace Step 2 `.;` Fix** | [`src/components/energetics/EnergeticsComparison.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/energetics/EnergeticsComparison.tsx#L82), [`src/components/inspector/EnergeticsInspector.tsx`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/src/components/inspector/EnergeticsInspector.tsx#L277) | Component test confirming clean copy (`Not available here — Requires the local model sidecar.` and single `.` delimiter). |

---

## 5. Verification Round (2026-11-03): What Was Checked, Fixed, and What Remains

Checked against the tree, not against the summary.

**Verified**
- `tsc --noEmit` clean; focused suites 120 (energetics evidence/comparison/view) and 172 (all FoldX) pass.
- **Shipped runner end-to-end with real FoldX 5.1**, repo-local job directory: GATA4 `SA159C` gives `+0.1610` in 4.2 s (`fix-shell`, 29 movable) — exact match to the benchmark; CNNM2 `SA489C` gives `+1.1769` in 15.6 s (62 movable) against the benchmark's `+1.1732`; the 0.0037 difference is the cleaned input, not a logic difference.
- The mode is decided by residue count alone; `_repair:` is in the mutant key; a result whose **actual** mode differs from the key's is refused by `writeMutantToCache`; the old "supersede once a background repair exists" path is gone from `getMutantFromCache`.
- Companions are written back with the FoldX entry (`backfillMutantCacheCompanions`), answers only; the browser cache namespace was bumped (`v4.9`).

**Fixed during this review**
1. The **Provisional** marker existed only on the Engine records tab. The default Comparison tab — the headline — still presented a settled verdict over a partial panel. It now renders beside the headline, with tests for both tabs.
2. The local-repair offset was reachable only through a hover `title` on the caveat chip. It is now a visible caution line on the Comparison tab, the same rule the unrepaired note follows.

**Remaining gaps (recommended, not fixed here)**
1. **A failed local repair loops.** A timeout sets `foldxRepairFailed`, so the result is `none` and is deliberately not cached; but background repair keys the *whole-chain* entry, which a >233 template never reads. Every later request repeats the attempt. Cheapest correct fix: make `none` a first-class cacheable mode (keyed as such), or add a short negative cache.
2. **The local repair's cost prior ignores incomplete side chains.** `--fix-residues-file` still rebuilds truncated side chains (~4.7 s each under Box64), so a crystal with many of them can exceed the 420 s cap and the queue ETA is optimistic for it.
3. **The N ≤ 233 slow-host fallback is still a (narrow) flip:** unrepaired now, whole-chain repaired once the background repair lands. Making the mode depend on predicted cost as well as size would remove it without reintroducing host-dependence.
4. **`fix-shell` still feeds the 2/3 band rule with a known ≤0.51 kcal/mol systematic offset.** It is disclosed, but a value that can cross the 0.5 mark by itself is counted like a whole-chain value. Recommended: when a `fix-shell` reading lies within its measured offset of a mark, report the band as uncertain rather than counting it.
5. `nativeFoldxRepairPriorMs` is still the old curve (§3.3 item 2) — placement/ETA only.
