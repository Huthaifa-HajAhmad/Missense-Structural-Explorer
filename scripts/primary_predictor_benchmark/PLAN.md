# Pre-Registered Analysis Plan: Primary Calibrated In-Silico Predictor (Phase 5a)

**Registration Date:** 2026-11-24
**Repository:** `Missense-Structural-Explorer`
**Worktree Branch:** `docs/primary-predictor-benchmark`
**Status:** Pre-registered prior to joining or inspecting any real ClinVar × dbNSFP benchmark scores.
**Rule:** Do not alter metrics, thresholds, subgroups, or selection rules after observing real benchmark results. Any data-driven adjustment discovered during ingestion must be appended to a dated **Deviations** section at the bottom of this document without changing the decision criteria.

---

## 1. Purpose & Clinical Questions

`doc/IN_SILICO_PRUNING_PLAN.md` (Phase 5) reopens decision D2: end the plurality vote across predictors and select **one primary calibrated tool** (chosen in advance) that emits `PP3` or `BP4` at its ClinGen-calibrated strength, with a **fixed fallback order** when the primary tool has no score, gene-level **ClinGen VCEP overrides** where specified, and a **curator disagreement note** when other calibrated tools point in the opposite direction (without changing strength).

Before writing any engine code (Phase 5b), we compare the four calibrated missense predictors in `src/shared/thresholds/calibration.ts`:

1. **REVEL** (`revel`, Pejaver et al. 2022)
2. **BayesDel noAF** (`bayesdel`, Pejaver et al. 2022)
3. **AlphaMissense** (`alphamissense`, Bergquist et al. 2025)
4. **ESM1b** (`esm1b`, Bergquist et al. 2025)

We answer:
1. **Q1 (Primary selection & fallback ranking on post-training ClinVar):** Which tool delivers the most correct Moderate-or-stronger calls in **both** directions (`PP3_Moderate`/`PP3_Strong` on P/LP and `BP4_Moderate`/`BP4_Strong`/`BP4_VeryStrong` on B/LB) without failing any subgroup wrong-direction gate?
2. **Q2 (Subgroup robustness):** Does any candidate show an elevated wrong-direction rate in **disordered regions** (`AlphaFold pLDDT < 50`), **ordered regions** (`pLDDT >= 50`), **gain-of-function (GoF)** genes, or **loss-of-function (LoF)** genes?
3. **Q3 (Sensitivity to circularity & rare benign variants):** Does the ranking remain stable across strict post-training temporal holdouts (Post-2023 primary cohort, Post-2024 post-calibration cohort, Post-2017 cohort, Full ≥2-star baseline) and when restricting B/LB to rare alleles (`gnomAD AF < 0.001`)?
4. **Q4 (Empirical calibration & operational impact):** How do empirical band likelihood ratios compare with ClinGen OddsPath targets, how much missing coverage does the fallback order recover, and how often will a curator see a disagreement note?
5. **Q5 (ClinGen CSpec VCEP overrides):** Across all active Released specs in the ClinGen Criteria Specification Registry (`cspec.genome.network`), which genes and tools have explicit PP3/BP4 VCEP specifications or custom thresholds?

---

## 2. Published Calibration Bands (Pinned to `src/shared/thresholds/calibration.ts`)

Tested strongest first (`VeryStrong` → `Strong` → `Moderate` → `Supporting`); scores not passing any band are **Indeterminate**; missing/non-finite scores are **Missing**.

| Tool (`key`) | Source | Orientation | PP3 thresholds | BP4 thresholds |
|---|---|---|---|---|
| **REVEL** (`revel`) | Pejaver 2022 Table 2 | higher = pathogenic | Strong `≥ 0.932`, Moderate `[0.773, 0.932)`, Supporting `[0.644, 0.773)` | Very Strong `≤ 0.003`, Strong `(0.003, 0.016]`, Moderate `(0.016, 0.183]`, Supporting `(0.183, 0.290]` |
| **BayesDel noAF** (`bayesdel`) | Pejaver 2022 Table 2 | higher = pathogenic | Strong `≥ 0.50`, Moderate `[0.27, 0.50)`, Supporting `[0.13, 0.27)` | Moderate `≤ -0.36`, Supporting `(-0.36, -0.18]` |
| **AlphaMissense** (`alphamissense`) | Bergquist 2025 Table 1 | higher = pathogenic | Strong `≥ 0.990`, Moderate `[0.906, 0.990)`, Supporting `[0.792, 0.906)` | Moderate `<= 0.099`, Supporting `(0.099, 0.169]` |
| **ESM1b** (`esm1b`) | Bergquist 2025 Table 1 | lower = pathogenic | Strong `≤ -24.0`, Moderate `(-24.0, -12.2]`, Supporting `(-12.2, -10.7]` | Moderate `≥ -3.1`, Supporting `[-6.3, -3.1)` |

Note: Bergquist 2025 prints ESM1b to one decimal place; values in gaps (e.g., `-10.65`) fall into `Indeterminate`, matching `calibratedCall` in `calibration.ts`.

---

## 3. Data Sources & Join Specification

### 3.1 ClinVar Truth Set
- **Current snapshot:** `https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz` and `submission_summary.txt.gz` (record exact `Last-Modified` HTTP header and SHA-256).
- **Inclusion criteria (row-level):**
  - `Assembly == "GRCh38"`
  - `Type == "single nucleotide variant"`
  - `ReferenceAlleleVCF` and `AlternateAlleleVCF` each a single base in `{A, C, G, T}` with `ref != alt`
  - `Chromosome` (with `MT` normalized to `M`) in `{"1".."22", "X", "Y", "M"}`, valid integer `PositionVCF > 0`
  - `OriginSimple` contains `"germline"` (case-insensitive; excludes somatic-only entries)
  - `ReviewStatus` (`≥ 2` stars) in:
    - `"criteria provided, multiple submitters, no conflicts"`
    - `"reviewed by expert panel"`
    - `"practice guideline"`
  - `ClinicalSignificance` in:
    - **P/LP (`y = 1`):** `"Pathogenic"`, `"Likely pathogenic"`, `"Pathogenic/Likely pathogenic"`
    - **B/LB (`y = 0`):** `"Benign"`, `"Likely benign"`, `"Benign/Likely benign"`
- **Missense parsing & two denominators:**
  - Parse ClinVar `Name` for canonical single-residue missense protein notation `\(p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})\)` mapped via the 20 standard amino acids, requiring `wt != mut` and `aa_pos > 1` (excludes start-loss `p.Met1...`, nonsense `Ter`/`*`, frameshift `fs`, synonymous `=`, indels, uncertain `?`).
  - Deduplicate by genomic key `(chr, pos_genomic, ref, alt)` (if identical genomic keys carry conflicting P/LP vs B/LB labels across rows, log and drop).
  - **Denominator A (All ≥2-star ClinVar missense SNVs):** all deduplicated variants passing the filters above. Coverage over Denominator A measures true end-to-end availability including variants absent from `dbnsfp_v5.sqlite`.
  - **Denominator B (dbNSFP-matched missense SNVs):** subset present in `dbnsfp_v5.sqlite` (`variant_scores` indexed lookup on `(chr, pos_genomic, ref, alt)`) with `aaref != aaalt`, both in the 20 standard 1-letter amino acids, and `pos > 1`. When multiple rows exist at the same genomic coordinate (overlapping genes), select the row whose `gene` matches a symbol in ClinVar's `GeneSymbol`; if still ambiguous (`>1` matching or `0` matching when `>1` rows exist), log the overlap count and exclude from per-gene subgroup analyses (and report cleanly).

### 3.2 Predictor Store (`data/dbnsfp_v5.sqlite` on OCI VM)
- Built from dbNSFP `5.4a` (`transcript_policy = mane`, ~89.0M rows across chromosomes `1..22, X, Y, M`).
- Opened strictly read-only (`uri=True`, `?mode=ro`, `PRAGMA query_only = ON`).
- Columns read per matched coordinate: `gene, transcript, aaref, aaalt, pos, revel, bayesdel, alphamissense, esm1b, gnomad_ac, gnomad_an, transcript_basis`.

### 3.3 Temporal Holdout Cohorts ("first classified after each tool's training cut-off")
For every ClinVar `VariationID`, compute `min_eval_date` = minimum `DateLastEvaluated` across SCVs in `submission_summary.txt.gz` with `ContributesToAggregateClassification == "yes"` and `ClinicalSignificance` in P/LP or B/LB. We define five nested/sensitivity cohorts:

1. **Post-2023 Holdout (`post_2023`, PRIMARY COMPARISON COHORT):**
   - Strictly post-dates training of all four tools (REVEL Oct 2016, BayesDel Aug 2017, ESM1b Aug 2023, AlphaMissense Sep 2023) and Pejaver 2022 calibration.
   - Variant `(chr, pos, ref, alt)` AND `VariationID` were NOT classified as P/LP or B/LB in `vcf_GRCh38/archive_2.0/2023/clinvar_20231226.vcf.gz`, **AND** no contributing P/LP/B/LB SCV in `submission_summary.txt.gz` has `DateLastEvaluated <= 2023-12-31`.
2. **Post-2024 Holdout (`post_2024`, STRICT POST-CALIBRATION COHORT):**
   - Strictly post-dates Bergquist 2025 calibration as well.
   - Variant `(chr, pos, ref, alt)` AND `VariationID` were NOT classified as P/LP or B/LB in `tab_delimited/archive/variant_summary_2025-01.txt.gz` (GRCh38), **AND** no contributing P/LP/B/LB SCV has `DateLastEvaluated <= 2024-12-31`.
3. **Post-2017 Holdout (`post_2017`, POST-REVEL/BAYESDEL COHORT):**
   - Variant `(chr, pos, ref, alt)` AND `VariationID` were NOT classified as P/LP or B/LB in `vcf_GRCh38/archive_2.0/2017/clinvar_20171203.vcf.gz`, **AND** no contributing P/LP/B/LB SCV has `DateLastEvaluated <= 2017-12-31`.
4. **Full ≥2-Star (`full_2star`, BASELINE):**
   - All ≥2-star ClinVar missense SNVs as of the current download (expected to contain pre-2023 training/calibration circularity).
5. **Rare-Benign Sensitivity (`post_2023_rare_benign`):**
   - Subset of `post_2023` retaining all P/LP variants and restricting B/LB variants to rare alleles (`gnomad_ac IS NULL OR gnomad_an IS NULL OR gnomad_an = 0 OR gnomad_ac * 1.0 / gnomad_an < 0.001`), testing sensitivity to AlphaMissense's human/primate allele-frequency weak supervision.

### 3.4 Subgroups
1. **Ordered vs Disordered (`AlphaFold pLDDT < 50`):**
   - AlphaFold DB v6 per-residue confidence JSONs (`https://alphafold.ebi.ac.uk/files/AF-<UNIPROT>-F<k>-confidence_v6.json`) + UniProt reviewed human mapping (`accession, gene_primary, xref_mane-select, xref_ensembl, length, sequence`).
   - Map dbNSFP `transcript` (version stripped) via UniProt `MANE-Select` / `Ensembl` cross-references, falling back to `gene_primary` only when unique.
   - Strictly verify `1 <= pos <= len(uniprot_seq)` and `uniprot_seq[pos - 1] == dbnsfp_aaref`. Unmapped or mismatched positions are logged and excluded from the Ordered/Disordered split (never guessed).
   - For proteins `<= 2,700` aa (or `pos <= 1,400`), fetch `F1` where local position equals `pos`. For proteins `> 2,700` aa at `pos > 1,400` split into overlapping `1,400`-aa fragments stepped by `200` aa (`F<k>`), select fragment `k = clamp(round((pos - 700) / 200) + 1, 1, max_k)` (midpoint closest to `pos`) and read `local_pos = pos - (k - 1) * 200`.
   - **Disordered:** `pLDDT < 50.0`. **Ordered:** `pLDDT >= 50.0` (also report `pLDDT >= 70.0` descriptively).
2. **Disease Mechanism Subgroups (from pinned local `data/g2p-context.json`):**
   - Restrict to G2P assertions with `confidence` in `{"definitive", "strong"}`.
   - **`gof_exclusive`:** genes with `mechanism == "gain of function"` and NO `"loss of function"` record.
   - **`gof_any`:** genes with at least one `"gain of function"` record.
   - **`lof_only`:** genes with `mechanism == "loss of function"` and NO `"gain of function"` or `"dominant negative"` record.
   - **`dn_any`:** genes with at least one `"dominant negative"` record (descriptive).
   - For the primary GoF wrong-direction gate, use `gof_exclusive` if it has `≥ 30` P/LP and `≥ 30` B/LB variants in `post_2023`; otherwise use `gof_any` (and still report both).

---

## 4. Measures, Uncertainty & Pre-Registered Selection Rule

### 4.1 Per-Tool Metrics
For each tool `t` in each `(cohort, subgroup)`:
- **Coverage:** `Cov_A = n_scored / N_A` and `Cov_B = n_scored / N_B` (overall, P/LP, B/LB).
- **Strength distribution (over Denominator A):** exact fraction of P/LP variants in `{PP3_Strong, PP3_Moderate, PP3_Supporting, Indeterminate, Wrong_BP4, Missing}` and of B/LB variants in `{BP4_VeryStrong, BP4_Strong, BP4_Moderate, BP4_Supporting, Indeterminate, Wrong_PP3, Missing}`.
- **Key Moderate+ yield metrics (evaluated over Denominator A, penalizing missing coverage):**
  - `Reach_P_Mod+ = P(PP3_Moderate or PP3_Strong | P/LP)`
  - `Reach_B_Mod+ = P(BP4_Moderate, BP4_Strong, or BP4_VeryStrong | B/LB)`
  - `H_Mod+ = 2 * Reach_P_Mod+ * Reach_B_Mod+ / (Reach_P_Mod+ + Reach_B_Mod+)` (`0.0` if sum is `0`).
- **Wrong-direction rates (evaluated over scored variants):**
  - `W_P = P(any BP4 | P/LP, scored)`
  - `W_B = P(any PP3 | B/LB, scored)`
  - `W_bal = 0.5 * (W_P + W_B)` (and `W_bal_Mod+` for Moderate-or-stronger wrong-direction calls).
- **Empirical Likelihood Ratios (descriptive calibration check):**
  - Per band `b`: `LR+ = P(band b | P/LP, scored) / P(band b | B/LB, scored)` (for PP3 bands) and `LR- = P(band b | B/LB, scored) / P(band b | P/LP, scored)` (for BP4 bands), compared against ClinGen OddsPath targets (`2.08`, `4.33`, `18.7`, `350`).

### 4.2 Uncertainty
- **Gene-cluster nonparametric bootstrap (`B = 2,000` replicates, seed `20261124`):** resample unique genes with replacement, keeping all variants in each sampled gene together; report 2.5th–97.5th percentile 95% CIs for all rates, `H_Mod+`, `W_bal`, and pairwise tool deltas using identical paired bootstrap draws across the four tools.
- **Wilson 95% CIs** (`z = 1.959964`) reported alongside point proportions where helpful.

### 4.3 Pre-Registered Selection & Fallback-Order Rule
Evaluated on the **Primary Cohort (`post_2023`)** (and checked for agreement on `post_2024` and `full_2star`):

1. **Subgroup wrong-direction gate:** Inspect the four primary subgroups (`ordered`, `disordered`, `gof` [`gof_exclusive` if `≥30/30`, else `gof_any`], `lof_only`). If any subgroup has `< 30` P/LP or `< 30` B/LB variants in `post_2023`, evaluate that subgroup's gate on `full_2star` and flag that substitution. A tool `t` **fails** the subgroup gate iff there exists a primary subgroup `S` in which `t` has the strictly highest `W_bal(t, S)` among all four candidates **and** the 95% gene-cluster bootstrap CI of `W_bal(t, S) - max_{u != t} W_bal(u, S)` has `CI_low > 0`.
2. **Primary tool selection among gate-eligible tools:**
   - If one eligible tool **strictly Pareto-dominates** all other eligible tools on both `Reach_P_Mod+` and `Reach_B_Mod+` (strictly higher point estimate in both directions), select it as primary.
   - Otherwise, select the eligible tool with the **highest `H_Mod+`**. If two eligible tools have overlapping performance where the paired 95% bootstrap CI of `ΔH_Mod+` includes `0`, tie-break by (a) higher `Cov_A`, then (b) lower overall `W_bal`.
3. **Fallback order:** Rank remaining gate-eligible tools by the exact same rule, followed by any subgroup-flagged tools (also ranked by `H_Mod+`, carrying their subgroup disclosure).
4. **Sequential fallback & disagreement audit:** Given the resulting `(primary, fallback_1, fallback_2, fallback_3)` chain, measure on `post_2023` and `full_2star`:
   - Fraction of variants answered by the primary tool vs each fallback tier vs remaining missing;
   - Fraction of active PP3/BP4 calls where ≥ 1 other calibrated tool emits the **opposite** direction (broken down by whether the active call matched or contradicted the ClinVar label).

---

## 5. ClinGen CSpec Registry Audit Scope

Enumerate all `SequenceVariantInterpretation` specifications (`https://cspec.genome.network/cspec/SequenceVariantInterpretation/id?pg=1..N&pgSize=100`, then `?detail=high`). Filter to `currentStatus == "Released"` and `legacy == False`, extract all HGNC gene symbols and PP3/BP4 rule texts/strengths, categorize tools and custom thresholds, and determine whether Phase 5b should use a version-pinned curated override table vs automated parsing.

---

## 6. Deviations

*(None prior to execution. Any necessary ingestion deviation will be appended here with date and justification.)*
