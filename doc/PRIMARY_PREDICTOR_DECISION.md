# Decision: Primary Calibrated In-Silico Predictor & VCEP Override Policy (Phase 5a)

**Status:** Approved by the owner (2026-11-24), with the amendment below. Phase 5b built the default order, the
SpliceAI block on BP4, the disagreement note and the active PP3 + PM1 cap (`src/shared/insilico/primaryPredictor.ts`,
release note `RELEASE_NOTE_PRIMARY_PREDICTOR.md`). The VCEP table (item 3) follows in its own change; until then
`lookupVcepInsilicoRule` returns no rule and every gene uses the default order.

**Decision:**
1. **Default primary calibrated predictor:** **REVEL** (`revel`), emitting `PP3`/`BP4` up to its published ClinGen-calibrated strengths (`PP3` [`0.644`, `0.773`), `PP3_Moderate` [`0.773`, `0.932`), `PP3_Strong` ≥ `0.932`; `BP4` (`0.183`, `0.290`], `BP4_Moderate` (`0.016`, `0.183`], `BP4_Strong` (`0.003`, `0.016`], `BP4_VeryStrong` ≤ `0.003`; Pejaver et al. 2022).
2. **Fixed fallback order when the tool before has no score:** **REVEL → BayesDel noAF → AlphaMissense → ESM1b**.
3. **Gene-level VCEP overrides:** Apply a **version-pinned, manually audited override table** derived from the 113 active Released ClinGen Criteria Specification (CSpec) Registry specs (`cspec.genome.network`), never live runtime parsing of CSpec prose.
4. **Curator disagreement note:** When the active predictor emits `PP3` or `BP4` and any other calibrated predictor emits the opposite direction, display a visible disagreement note without altering the emitted criterion strength.

This decision resolves Phase 5a of `doc/IN_SILICO_PRUNING_PLAN.md` (reopening D2 from `doc/INDEPENDENT_AUDIT_RESPONSE.md`).

### Amendment: the pre-registered rule picked BayesDel noAF; the whole-chain comparison picks REVEL

The pre-registered rule (`scripts/primary_predictor_benchmark/PLAN.md` §4.3) ranks each tool **alone** and counts a
missing score as a miss. It selected **BayesDel noAF** (fallback `BayesDel noAF → REVEL → AlphaMissense → ESM1b`),
and the single-tool results below are reported unchanged. But the engine never uses one tool alone: when the
first tool has no score, the next one answers. REVEL has no score for about 16% of variants in the dbNSFP store
(`Cov_A` `84.2%`), and most of BayesDel noAF's single-tool lead came from that gap, which the fallback fills in
either order. Among variants REVEL does score, REVEL makes more Moderate-or-stronger calls and fewer
wrong-direction calls than BayesDel noAF.

The question the engine actually depends on is which **order** works best. That comparison was added after the
pre-registered results were seen, so it is a **post-hoc amendment**, not part of the pre-registration. It reuses the
same metrics and the same paired gene-cluster bootstrap (`2,000` replicates, seed `20261124`) on the same
per-variant calls (`scripts/primary_predictor_benchmark/compare_chains.py`). REVEL-first minus BayesDel-first:

| Cohort | `ΔH_Mod+` (95% CI) | `ΔW_bal` (95% CI) |
|---|---:|---:|
| `post_2023` (primary, `N = 4,857`) | **+2.22 pp** (`+0.68` to `+3.89`) | **−1.02 pp** (`−1.56` to `−0.45`) |
| `post_2024` (strictest, `N = 1,753`) | **+3.63 pp** (`+1.09` to `+6.58`) | **−1.24 pp** (`−2.12` to `−0.30`) |
| `full_2star` (`N = 66,847`) | −0.15 pp (`−0.66` to `+0.35`), tie | **−0.41 pp** (`−0.56` to `−0.27`) |

REVEL first gives more Moderate-or-stronger calls **and** fewer wrong-direction calls on both held-out cohorts, ties
on calls and still makes fewer errors on the full set, and is never worse. It also matches the ClinGen expert
panels: 90 of the 113 active VCEP specifications set their PP3/BP4 rules on REVEL, and 3 on BayesDel, so most gene
overrides change a REVEL cutoff instead of switching tools.

---

## Why (pre-registered single-tool results)

1. **BayesDel noAF makes the most Moderate-or-stronger calls in both directions when each tool is ranked alone** (it does not dominate on errors: its wrong-direction rate is higher than REVEL's and AlphaMissense's). On the primary post-training holdout (`post_2023`, `N = 4,857` variants across `1,331` genes), BayesDel noAF achieves **76.7%** `PP3_Moderate+` reach on P/LP variants and **51.6%** `BP4_Moderate+` reach on B/LB variants (`H_Mod+ = 61.7%`, 95% CI `58.6%–64.7%`). Paired gene-cluster bootstrap differences in `H_Mod+` exclude zero against every competitor: **+8.3 pp** over REVEL (95% CI `+5.3` to `+11.3 pp`), **+15.3 pp** over AlphaMissense (`+11.8` to `+18.8 pp`), and **+42.9 pp** over ESM1b (`+39.3` to `+46.6 pp`).
2. **Highest single-tool coverage.** BayesDel noAF scores **99.79%** of all `post_2023` ClinVar missense SNVs (and **99.60%** of `full_2star`, `66,580 / 66,847`), compared with **90.88%** for AlphaMissense, **84.17%** for REVEL, and **67.35%** for ESM1b. Together, the fallback chain covers **99.90%** (`post_2023`) / **99.92%** (`full_2star`).
3. **The single-tool ranking is the same in every cohort.** BayesDel noAF → REVEL → AlphaMissense → ESM1b holds identically across `post_2023`, the strict post-Bergquist-2025 sensitivity cohort (`post_2024`, `N = 1,753`: `H_Mod+ = 54.1%` vs REVEL `48.5%`, AM `43.1%`, ESM1b `17.3%`), `post_2017` (`N = 41,928`), `full_2star` (`N = 66,847`), and rare benign alleles (`gnomAD AF < 0.001`, `N = 4,688`: `H_Mod+ = 61.5%`).
4. **Subgroup stability separates BayesDel and REVEL from ESM1b and AlphaMissense.**
   - **ESM1b fails the pre-registered subgroup wrong-direction gate** on `post_2023` in both ordered residues (`W_bal = 8.56%`, excess `+2.09 pp` over next worst, 95% CI `+0.48` to `+3.88 pp`) and LoF-only genes (`W_bal = 7.59%`, excess `+2.70 pp`, 95% CI `+1.02` to `+4.58 pp`), misses ~30%–34% of variants, and hits `PP3_Strong` (`≤ -24.0`) on **0** `post_2023` / `post_2024` variants.
   - **AlphaMissense drops sharply in disordered regions (`pLDDT < 50`):** on `post_2023`, its pathogenic Moderate+ reach falls from `53.4%` in ordered domains to **38.5%** in disordered regions (`54.0% → 44.9%` on `full_2star`), whereas BayesDel maintains `84.2%` (`78.1%` on `full_2star`) and REVEL maintains `77.8%` (`70.0%` on `full_2star`).
   - **BayesDel's trade-off is a higher benign-side false-positive rate.** On `post_2023`, BayesDel's `W_B` (`PP3` on B/LB) is `7.17%` (`10.88%` on `post_2024`) vs AlphaMissense `3.45%` (`3.23%`) and REVEL `6.09%` (`9.28%`). However, when BayesDel's active call is in the **wrong** direction, another calibrated predictor disagrees **32.8%** of the time (`75 / 229` on `post_2023`; **39.3%** on `post_2024`), versus only **3.35%** (`132 / 3,935`) when the active call matches the ClinVar label — nearly a 10× enrichment for flagging potential misclassifications to curators.

---

## Pre-Registered Protocol & Data Provenance

Pre-registered plan, exact calibrated thresholds (pinned against `src/shared/thresholds/calibration.ts`), pure-stdlib metrics engine, and 14 unit tests were committed prior to running on real ClinVar × dbNSFP data (`scripts/primary_predictor_benchmark/PLAN.md`, `metrics.py`, `test_benchmark.py`, `run_vm_benchmark.py`, `audit_cspec.py`; outputs stored under git-ignored `logs/primary_predictor_bench/`). The post-hoc chain comparison (`compare_chains.py`, `test_chain_comparison.py`) was added afterwards; it reads only the per-variant output `variant_calls.tsv.gz` and writes `chain_comparison.json` / `.md`.

- **dbNSFP store (OCI VM, read-only):** `data/dbnsfp_v5.sqlite`, dbNSFP `5.4a`, `transcript_policy = mane` (`88,989,019` rows across `chr 1..22, X, Y, M`, ingested `2026-10-17T04:56:43Z`).
- **ClinVar truth set (`variant_summary.txt.gz`):** HTTP `Last-Modified: Mon, 23 Nov 2026 13:53:33 GMT` (`sha256: 1d910abfb5b576d9...`, `458,570,768` bytes). Filtered to GRCh38, germline single-nucleotide variants, review status ≥ 2 stars, unambiguous `P/LP` or `B/LB`, canonical single-residue missense protein change (`pos > 1`), yielding **`66,847`** unique genomic variants (`P/LP = 25,303`, `B/LB = 41,544`; `0` conflicting duplicates).
- **dbNSFP join (`Denominator B`):** Indexed `(chr, pos_genomic, ref, alt)` lookup matched **`66,812 / 66,847` (99.95%)** (`34` missing, `1` non-missense, `0` ambiguous gene overlaps, `0` ClinVar-vs-MANE amino-acid mismatches). All primary reach metrics use **`Denominator A` (`66,847`)** so missing dbNSFP coverage is penalized honestly.
- **Temporal holdouts:** Derived from `submission_summary.txt.gz` (`Last-Modified: Sun, 22 Nov 2026 23:46:18 GMT`, `268,405` contributing SCVs matched across `6,897,480` rows) combined with three historical ClinVar releases:
  - `post_2017`: excluding variants P/LP or B/LB in `clinvar_20171203.vcf.gz` (`Last-Modified: Thu, 07 Dec 2017`) or with contributing SCV `DateLastEvaluated <= 2017-12-31` → **`41,928`** variants (`P = 13,883`, `B = 28,045`, `6,740` genes).
  - `post_2023` (**primary cohort**, post-training of all 4 tools & Pejaver 2022 calibration): excluding variants P/LP or B/LB in `clinvar_20231226.vcf.gz` (`Last-Modified: Wed, 27 Dec 2023`) or with contributing SCV `<= 2023-12-31` → **`4,857`** variants (`P = 2,687`, `B = 2,170`, `1,331` genes; `0` missing SCV dates).
  - `post_2024` (strict sensitivity, post-Bergquist 2025 calibration): excluding variants P/LP or B/LB in `variant_summary_2025-01.txt.gz` (`Last-Modified: Thu, 02 Jan 2025`) or with contributing SCV `<= 2024-12-31` → **`1,753`** variants (`P = 1,079`, `B = 674`, `537` genes; `1` missing SCV date).
  - `post_2023_rare_benign`: `post_2023` with B/LB restricted to `gnomAD AF < 0.001` or absent (`N = 4,688`: `P = 2,687`, `B = 2,001`, `1,249` genes).
- **AlphaFold v6 pLDDT (`UP000005640_9606_HUMAN_v6.tar`):** Of `66,812` dbNSFP-matched variants, `66,676` mapped to a reviewed human UniProt accession (`64,566` via `MANE-Select`/`Ensembl`, `2,110` via unique `gene_primary`, `136` unmapped). Strict verification `af_aa == dbnsfp_aaref` retained **`62,267`** (`93.2%`) variants and excluded `4,131` MANE-vs-canonical isoform mismatches, `185` out-of-range positions, and `93` missing models.
- **Disease mechanisms (`data/g2p-context.json`, retrieved `2026-10-08T11:02:38Z`):** Restricting to `definitive` and `strong` assertions yielded `98` `gof_exclusive`, `143` `gof_any`, `1,794` `lof_only`, and `86` `dn_any` genes.

---

## Results

### 1. Primary Cohort (`post_2023`: `N_A = 4,857` [`P = 2,687`, `B = 2,170`], `N_B = 4,856`, `1,331` genes)

| Tool | `Cov_A` | `Cov_B` | `Reach_P_Mod+` | `Reach_B_Mod+` | `H_Mod+` (95% CI) | `W_bal` (95% CI) | `W_P` | `W_B` | `W_bal_Mod+` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **BayesDel noAF** | **99.8%** | **99.8%** | **76.7%** | **51.6%** | **61.7% (58.6%–64.7%)** | 4.96% (4.14%–5.84%) | 2.76% | 7.17% | 1.97% |
| REVEL | 84.2% | 84.2% | 68.9% | 43.6% | 53.4% (49.9%–56.8%) | 3.77% (3.05%–4.53%) | 1.45% | 6.09% | 1.55% |
| AlphaMissense | 90.9% | 90.9% | 51.9% | 41.9% | 46.4% (43.8%–48.7%) | 3.28% (2.71%–3.86%) | 3.11% | 3.45% | 1.38% |
| ESM1b | 67.3% | 67.4% | 32.4% | 13.2% | 18.8% (16.7%–20.6%) | 7.11% (5.85%–8.51%) | 7.63% | 6.60% | 1.89% |

*95% CIs from 2,000 gene-cluster bootstrap replicates (`seed = 20261124`).*

**Full strength distribution on `post_2023` (share of Denominator A):**

| Tool | P/LP: `PP3_S` / `PP3_M` / `PP3` / `Ind` / `Wrong_BP4` / `Miss` | B/LB: `BP4_VS` / `BP4_S` / `BP4_M` / `BP4` / `Ind` / `Wrong_PP3` / `Miss` |
|---|---|---|
| **BayesDel noAF** | `43.0%` / `33.7%` / `10.6%` / `9.8%` / `2.8%` / `0.1%` | `0.0%` / `0.0%` / `51.6%` / `21.4%` / `19.5%` / `7.1%` / `0.3%` |
| REVEL | `34.2%` / `34.7%` / `9.9%` / `7.4%` / `1.3%` / `12.7%` | `0.1%` / `2.0%` / `41.5%` / `13.0%` / `18.7%` / `4.9%` / `19.8%` |
| AlphaMissense | `21.8%` / `30.1%` / `13.1%` / `24.3%` / `2.9%` / `7.9%` | `0.0%` / `0.0%` / `41.9%` / `21.8%` / `22.6%` / `3.1%` / `10.6%` |
| ESM1b | `0.0%` / `32.4%` / `11.0%` / `17.5%` / `5.0%` / `34.1%` | `0.0%` / `0.0%` / `13.2%` / `36.3%` / `15.1%` / `4.6%` / `30.8%` |

### 2. Sensitivity Cohorts (`post_2024`, `post_2017`, `full_2star`, `post_2023_rare_benign`)

| Cohort (`N_A`, `P` / `B`, genes) | Tool | `Cov_A` | `Reach_P_Mod+` | `Reach_B_Mod+` | `H_Mod+` (95% CI) | `W_bal` (95% CI) |
|---|---|---:|---:|---:|---:|---:|
| **`post_2024`** (`1,753`, `1,079` / `674`, `537`) | **BayesDel noAF** | **99.8%** | **77.4%** | **41.5%** | **54.1% (48.8%–59.2%)** | 7.25% (5.77%–8.76%) |
| | REVEL | 83.8% | 69.0% | 37.4% | 48.5% (42.7%–53.7%) | 5.66% (4.04%–7.24%) |
| | AlphaMissense | 90.7% | 53.4% | 36.2% | 43.1% (39.5%–46.6%) | 3.56% (2.63%–4.53%) |
| | ESM1b | 72.2% | 35.9% | 11.4% | 17.3% (14.0%–20.2%) | 8.73% (6.56%–11.03%) |
| **`post_2023_rare_benign`** (`4,688`, `2,687` / `2,001`, `1,249`) | **BayesDel noAF** | **99.8%** | **76.7%** | **51.3%** | **61.5% (58.1%–64.6%)** | 5.09% (4.19%–5.98%) |
| | REVEL | 84.2% | 68.9% | 43.2% | 53.1% (49.2%–56.8%) | 3.81% (3.06%–4.64%) |
| | AlphaMissense | 90.7% | 51.9% | 42.1% | 46.5% (43.9%–48.9%) | 3.41% (2.82%–4.04%) |
| | ESM1b | 67.5% | 32.4% | 13.4% | 19.0% (16.9%–21.0%) | 7.15% (5.91%–8.50%) |
| **`post_2017`** (`41,928`, `13,883` / `28,045`, `6,740`) | **BayesDel noAF** | **99.5%** | **73.1%** | **60.0%** | **65.9% (64.6%–67.2%)** | 3.65% (3.35%–3.96%) |
| | REVEL | 84.4% | 64.9% | 51.0% | 57.1% (55.1%–59.1%) | 3.00% (2.72%–3.29%) |
| | AlphaMissense | 91.4% | 53.5% | 45.8% | 49.4% (47.7%–51.1%) | 3.06% (2.74%–3.39%) |
| | ESM1b | 63.3% | 30.3% | 12.2% | 17.5% (16.5%–18.4%) | 6.16% (5.49%–6.85%) |
| **`full_2star`** (`66,847`, `25,303` / `41,544`, `7,363`) | **BayesDel noAF** | **99.6%** | **74.5%** | **59.8%** | **66.4% (65.2%–67.4%)** | 3.41% (3.18%–3.66%) |
| | REVEL | 83.8% | 63.7% | 49.6% | 55.8% (53.7%–57.8%) | 2.92% (2.68%–3.18%) |
| | AlphaMissense | 91.1% | 53.0% | 46.7% | 49.6% (48.0%–51.4%) | 3.09% (2.79%–3.38%) |
| | ESM1b | 62.9% | 29.0% | 12.7% | 17.6% (16.7%–18.5%) | 6.21% (5.58%–6.88%) |

### 3. Subgroup Breakdown & Wrong-Direction Gate (`post_2023`, with `full_2star` comparison)

All four primary gate subgroups in `post_2023` met the `≥ 30` P/LP and `≥ 30` B/LB sample requirement without fallback to `full_2star`:

| Subgroup (`post_2023` `N`, `P` / `B`, genes) | BayesDel `H_Mod+` / `W_bal` | REVEL `H_Mod+` / `W_bal` | AlphaMissense `H_Mod+` / `W_bal` | ESM1b `H_Mod+` / `W_bal` | Gate status |
|---|---|---|---|---|---|
| **`ordered`** (`pLDDT ≥ 50`, `3,284`, `2,298`/`986`, `1,038`) | **57.8%** / 6.47% | 51.0% / 5.54% | 43.7% / 3.85% | 15.5% / **8.56%** | **ESM1b flagged** (`+2.09 pp`, CI `+0.48%`–`+3.88%`) |
| **`ordered_high_conf`** (`pLDDT ≥ 70`, `2,999`, `2,206`/`793`, `958`) | **57.3%** / 6.91% | 50.5% / 6.42% | 42.9% / 3.86% | 15.3% / **8.89%** | *(descriptive; ESM1b worst)* |
| **`disordered`** (`pLDDT < 50`, `1,161`, `221`/`940`, `423`) | **68.6%** / 3.57% | 63.3% / 1.90% | 42.9% / 3.63% | 20.0% / 8.91% | ok *(AM `Reach_P_Mod+` drops to `38.5%`)* |
| **`gof_exclusive`** (`141`, `59`/`82`, `49`) | 50.7% / 9.93% | **54.1%** / 4.49% | 44.6% / 4.55% | 15.7% / 4.31% | ok *(CIs wide; overlap)* |
| **`gof_any`** (`212`, `104`/`108`, `71`) | **52.3%** / 8.12% | 50.8% / 5.73% | 51.6% / 3.43% | 15.0% / 6.04% | ok |
| **`lof_only`** (`2,809`, `1,652`/`1,157`, `622`) | **60.6%** / 4.89% | 53.5% / 3.42% | 43.9% / 3.40% | 20.2% / **7.59%** | **ESM1b flagged** (`+2.70 pp`, CI `+1.02%`–`+4.58%`) |
| **`dn_any`** (`232`, `131`/`101`, `39`) | **60.3%** / 4.34% | 47.6% / 5.67% | 47.3% / 1.58% | 12.4% / 5.56% | *(descriptive)* |

On `full_2star`, `gof_exclusive` (`N = 2,550`, `P = 1,354`, `B = 1,196`, `98` genes) shows AlphaMissense slightly ahead on `H_Mod+` (`55.5%`, `W_bal = 2.97%`) vs BayesDel (`53.8%`, `W_bal = 5.46%`), REVEL (`45.6%`, `W_bal = 4.04%`), and ESM1b (`15.2%`, `W_bal = 5.89%`), with no tool exceeding the gate threshold. On `full_2star` `disordered` (`N = 17,360`), ESM1b is also flagged (`W_bal = 7.90%`, CI excess `+0.76%`–`+9.57%`) and AlphaMissense `Reach_P_Mod+` remains `44.9%` vs BayesDel `78.1%`.

### 4. Empirical Band Calibration Check (Descriptive, `post_2023` & `post_2024`)

ClinGen OddsPath targets (Tavtigian et al. 2018 / Pejaver et al. 2022): Supporting `≥ 2.08`, Moderate `≥ 4.33`, Strong `≥ 18.7`, Very Strong `≥ 350`.

| Tool | Cohort | `PP3_Strong` LR+ | `PP3_Mod` LR+ | `PP3` LR+ | `Indet` P:B LR | `BP4` LR− | `BP4_Mod` LR− | `BP4_Strong` LR− |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| **BayesDel noAF** | `post_2023` | `66.49` (`1155:14`) | `13.04` (`906:56`) | `2.70` (`285:85`) | `0.50` | `10.47` (`55:464`) | `73.15` (`19:1120`) | — |
| | `post_2024` | `40.16` (`452:7`) | `8.51` (`383:28`) | `2.14` (`131:38`) | `0.27` | `7.93` (`30:148`) | `50.03` (`9:280`) | — |
| REVEL | `post_2023` | `113.50` (`918:6`) | `17.73` (`932:39`) | `3.22` (`265:61`) | `0.36` | `17.34` (`22:283`) | `101.22` (`12:901`) | `∞` (`0:44`) |
| | `post_2024` | `102.58` (`354:2`) | `10.27` (`390:22`) | `2.25` (`101:26`) | `0.27` | `12.34` (`13:93`) | `71.60` (`6:249`) | `∞` (`0:3`) |
| AlphaMissense | `post_2023` | `91.75` (`585:5`) | `19.22` (`809:33`) | `9.49` (`351:29`) | `1.04` | `10.56` (`57:472`) | `58.02` (`20:910`) | — |
| | `post_2024` | `73.55` (`250:2`) | `15.99` (`326:12`) | `17.89` (`152:5`) | `0.84` | `9.49` (`29:162`) | `41.47` (`10:244`) | — |
| ESM1b | `post_2023` | — (`0:0`) | `19.42` (`870:38`) | `4.10` (`295:61`) | `1.22` | `8.22` (`113:788`) | `15.38` (`22:287`) | — |
| | `post_2024` | — (`0:0`) | `15.13` (`387:17`) | `2.68` (`121:30`) | `1.07` | `7.07` (`56:263`) | `19.31` (`6:77`) | — |

In both `post_2023` and `post_2024`, BayesDel noAF's empirical LR exceeds its published ClinGen target at every band it emits. (REVEL's `BP4_VeryStrong` saw `0:2` variants in `post_2023` and `0:0` in `post_2024`.)

### 5. Sequential Fallback & Disagreement-Note Rates

**Adopted order (`REVEL → BayesDel noAF → AlphaMissense → ESM1b`, post-hoc amendment):**

| Cohort | Answered by REVEL | Answered by fallback | Still missing | Disagreement rate (all active calls) | Disagreement when call matches label | Disagreement when call is wrong direction |
|---|---:|---:|---:|---:|---:|---:|
| `post_2023` (`4,857`) | `4,088` (`84.17%`) | `764` (`15.73%`: 759 BayesDel, 5 AM) | `5` (`0.10%`) | `4.5%` (`187 / 4,125`) | `3.63%` (`143 / 3,944`) | **`24.31%`** (`44 / 181`) |
| `post_2024` (`1,753`) | `1,469` (`83.80%`) | `281` (`16.03%`, all BayesDel) | `3` (`0.17%`) | `5.6%` (`83 / 1,490`) | `4.08%` (`57 / 1,398`) | **`28.26%`** (`26 / 92`) |
| `full_2star` (`66,847`) | `56,015` (`83.80%`) | `10,780` (`16.13%`: 10,566 BayesDel, 187 AM, 27 ESM1b) | `52` (`0.08%`) | `3.6%` (`2,039 / 56,150`) | `2.80%` (`1,510 / 54,012`) | **`24.74%`** (`529 / 2,138`) |

The note catches a smaller share of wrong-direction calls than under the BayesDel-first order (24% vs 33% on
`post_2023`), but there are fewer wrong-direction calls to catch: on `post_2023`, wrong calls the note does **not**
flag fall from `154` (BayesDel first) to `137` (REVEL first).

**Pre-registered order (`BayesDel noAF → REVEL → AlphaMissense → ESM1b`), not adopted:**

| Cohort | Answered by BayesDel | Answered by fallback | Still missing | Disagreement rate (all active calls) | Disagreement when call matches label | Disagreement when call is wrong direction |
|---|---:|---:|---:|---:|---:|---:|
| `post_2023` (`4,857`) | `4,847` (`99.79%`) | `5` (`0.10%`, all AM) | `5` (`0.10%`) | `5.0%` (`207 / 4,164`) | `3.35%` (`132 / 3,935`) | **`32.75%`** (`75 / 229`) |
| `post_2024` (`1,753`) | `1,750` (`99.83%`) | `0` (`0.00%`) | `3` (`0.17%`) | `6.4%` (`97 / 1,506`) | `3.80%` (`53 / 1,394`) | **`39.29%`** (`44 / 112`) |
| `full_2star` (`66,847`) | `66,580` (`99.60%`) | `215` (`0.32%`: 1 REVEL, 187 AM, 27 ESM1b) | `52` (`0.08%`) | `4.1%` (`2,365 / 57,496`) | `2.95%` (`1,626 / 55,106`) | **`30.92%`** (`739 / 2,390`) |

---

## ClinGen CSpec Registry Audit (VCEP Gene Overrides)

Fetched all `250` `SequenceVariantInterpretation` specifications from `https://cspec.genome.network/cspec/` on `2026-11-24`. After excluding legacy superseded records (`6`), in-prep/submitted pilot drafts (`111`), deleted records (`12`), and unlabelled records (`8` including `1` blank-status), **`113` active Released specifications cover `110` unique genes**:

| VCEP PP3/BP4 Category | Active Specs | Unique Genes | Representative Genes / Notes |
|---|---:|---:|---|
| **REVEL — Supporting only, gene-specific/single cutoff** | 52 | 50 | `PTEN` (`>0.7`/`<0.5`), `RUNX1` (`≥0.88`/`<0.5`), `HNF1A`/`HNF4A`/`GCK` (`≥0.70`/`≤0.15`), `ATM` (`>0.7333`/`≤0.249`), `RASopathy` 14 genes (`≥0.7`/`≤0.3`), `VHL` (`≥0.664`, no BP4 missense), `DDC` (no BP4 missense), `F8`/`F9`, `NF1`, `RYR1`/`ACTA1`/`LGMD` |
| **REVEL — Multi-strength (Pejaver 2022 or VCEP-capped)** | 20 | 20 | `PAH`, `MYOC`, `GATM`, `GAMT`, `SCN1A`/`2A`/`3A`/`8A`/`1B` (capped at Moderate), `GP1BA`/`GP1BB`/`GP9`, `IDUA`, `RPGR`, `FOXN1` (Strong downgraded to Moderate), `RPE65`, `RS1`, `DNAH5`, `OTC`, `PAX6` |
| **REVEL + CADD or AlphaMissense combo/fallback** | 10 | 10 | `CYP1B1` (REVEL + AM fallback), `BMPR2` (2-of-3 REVEL/AM/CADD), `CTLA4`/`PIK3CD`/`PIK3R1` (REVEL AND CADD), `ABCA4`/`GUCY2D`/`AIPL1`/`HBB`/`HBA2` |
| **Missense excluded (SpliceAI splicing only)** | 9 | 9 | `PALB2`, `APC`, `ADA`, `DCLRE1C`, `IL7R`, `JAK3`, `RAG1`, `RAG2`, `IL2RG` |
| **REVEL qualitative (no numeric cutoff in CSpec)** | 8 | 8 | `MYH7`, `MYBPC3`, `TNNI3`, `TNNT2`, `TPM1`, `ACTC1`, `MYL2`, `MYL3` |
| **No applicable PP3/BP4 strength entries in CSpec** | 8 | 8 | `CDH1`, `GAA`, `ITGA2B`/`ITGB3`, `RYR1` (`GN012`), `LDLR`, `FBN1`, `GFAP`, `GN015` (unlisted) |
| **BayesDel** | 3 | 3 | `TP53` (`GN009`, BayesDel + Align-GVGD class), `BRCA1` (`GN092`), `BRCA2` (`GN097`, domain-gated BayesDel noAF) |
| **AlphaMissense only** | 1 | 1 | `DDX41` (`GN159`, `≥0.792` / `≤0.169`, Supporting only) |
| **CADD only** | 1 | 1 | `CEP290` (`GN226`) |
| **Non-coding RNA (`RNAsnp`)** | 1 | 1 | `RMRP` (`GN088`) |

### Why Phase 5b Must Use a Version-Pinned Audited Table (Not Live CSpec Parsing)

The CSpec audit surfaced concrete defects in live Released VCEP text that would cause silent clinical misclassification if parsed automatically:
1. **Severe numeric typos in Released specs:** `AIPL1` (`GN208` v1.0) writes `REVEL >= 0.093` for `PP3_Strong` and `0.774 - 0.092` for `PP3_Moderate` (clearly `0.932`); `PAH` (`GN006` v2.1) writes `0.644 - 0.733` instead of `0.773`; `SLC9A6` (`GN033` v6.0) writes `0.664`; `CEP290` (`GN226` v1.0) shifts CADD `BP4_Strong` (`≤ 0.15`) into `BP4_Moderate`.
2. **Duplicate Released specs per gene:** `ACTA1` has both `GN147` v2.0 and `GN169` v1.0 marked `Released, legacy=False`; `RYR1` has three (`GN012`, `GN150`, `GN179`).
3. **Non-dbNSFP / domain-gated rules:** `TP53` (`GN009`) requires Align-GVGD class `C65` alongside BayesDel `≥ 0.16` for Moderate; `BRCA1`/`BRCA2` (`GN092`/`GN097`) gate BayesDel by functional domain coordinates.

Therefore Phase 5b will ship an explicit, version-pinned TypeScript table (`cspec_id`, `version`, exact audited thresholds/caps/exclusions) for genes covered by active computable missense rules, and display uncomputable clauses (e.g., Align-GVGD or functional-domain gating) as explicit notes rather than silently overriding scores.

---

## Limitations & Circularity Disclosure

1. **Residual clinical diagnostic circularity:** Even on `post_2023` and `post_2024` ClinVar releases, diagnostic laboratories routinely include REVEL, BayesDel, and AlphaMissense (under `PP3`/`BP4`) when submitting classifications. Consequently, post-2023 ClinVar labels are **not** completely independent of the predictors' outputs — particularly on `PP3` reach, where labs may rely heavily on REVEL/BayesDel scores.
2. **AlphaMissense population-frequency weak supervision:** Excluding pre-2024 ClinVar removes direct overlap with post-hoc calibration, not AlphaMissense's human/primate allele-frequency training prior. Removing common benign variants (`post_2023_rare_benign`, `gnomAD AF < 0.001`) left all four tools within `0.1–0.3 pp` of `post_2023`.
3. **BayesDel benign false-positive rate vs Indeterminate rate:** BayesDel has higher `W_B` (`7.17%` on `post_2023`, `10.88%` on `post_2024`) than AlphaMissense (`3.45%` / `3.23%`), which converts many borderline variants into `Indeterminate` (`22.6%–24.3%`). Under the adopted order BayesDel answers only where REVEL has no score (about 16% of variants), so this rate applies to that share; the disagreement note stays prominent for it.
4. **dbNSFP 5.4a transcript selection:** `dbnsfp_v5.sqlite` picks one transcript per locus (`MANE Select` for 80.2% of rows). AlphaMissense scores only canonical transcripts; ESM1b omits long/non-canonical proteins (`30–34%` missing in ClinVar) and never reached `PP3_Strong` (`≤ -24.0`) in `post_2023` or `post_2024`.
5. **GoF sample size:** `post_2023` `gof_exclusive` has `141` variants (`49` genes), giving wide CIs; `full_2star` (`2,550` variants, `98` genes) confirms no tool triggers the subgroup wrong-direction gate there.
6. **The adopted order comes from a post-hoc comparison.** The chain comparison was added after the pre-registered single-tool results were seen. It changes only the unit being ranked (an order instead of a tool); metrics, cohorts, bootstrap and seed are the pre-registered ones, and REVEL-first is better or tied on every cohort and both measures. It has not been tested on a cohort that was unseen when the amendment was made.
7. **REVEL's coverage gap is a property of the store, not of REVEL alone.** About 16% of variants have no REVEL score in `dbnsfp_v5.sqlite` and are answered by BayesDel noAF. If a later store fills that gap, those variants move to REVEL; the chain comparison should then be rerun.

---

## What Would Reopen This Decision

- A newly published ClinGen SVI calibration (post-Bergquist 2025) for a newer predictor whose chain (that tool first, then the adopted order) shows **both** higher `H_Mod+` than the REVEL-first chain on post-calibration ClinVar missense variants (paired 95% gene-cluster bootstrap CI above zero) **and** no subgroup wrong-direction failure.
- A new ClinVar release (variants classified after 2026-11-24) on which the BayesDel-first chain beats the REVEL-first chain on `H_Mod+` with a paired 95% CI above zero.
- Evidence from production audit logs (`logs/audit.jsonl`) that the active tool's benign-side `PP3` calls in a specific clinical gene family drive unacceptable curator overrides where no VCEP rule exists yet.
- A ClinGen SVI recommendation updating `PP3`/`BP4` combination or capping rules beyond Pejaver et al. 2022 and Walker et al. 2023.
