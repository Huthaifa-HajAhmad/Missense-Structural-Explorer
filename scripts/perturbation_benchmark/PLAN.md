# Pre-Registered Analysis Plan: Structural Perturbation Benchmark

**Registration Date:** 2026-11-18  
**Repository:** `Missense-Structural-Explorer`  
**Status:** Pre-registered prior to inspecting or receiving any real `logs/perturbation_bench/scores.csv` data.  
**Rule:** Do not alter metrics, thresholds, or decision rules after observing real benchmark results. Any post-hoc modification or sensitivity check must be appended to a dated **Deviations** section at the bottom of this document.

---

## 1. Scientific Questions & Hypotheses

The app's **Structural perturbation** tab reports per-model zero-shot protein language model (pLM) readings ($\Delta\text{LLR} = \log P(\text{mut}) - \log P(\text{wt})$ in nats, amino-acid ranks, positional Shannon entropy in bits, and optional embedding shift) for ESM-2 650M (`masked-marginal`), SaProt 35M AF2 (`masked-marginal`, structure-aware), and VESM-150M (`wild-type-marginal`), headlined by `"N of N models favour native"` (where a model "favours native" iff $\Delta\text{LLR} \le -\ln 2$ and positional entropy $< 0.95 \cdot \log_2 20$ bits).

We evaluate:
1. **Q1 (Headline honesty):** Does the `"N of N favour native"` rule separate pathogenic from benign/common variants, or does it routinely fire on neutral variants?
2. **Q2 (Per-model discrimination & calibration marks):** What is the clinical discrimination (AUROC) of each model's $-\Delta\text{LLR}$, and what are the Youden-optimal and 95%-benign-specificity $\Delta\text{LLR}$ thresholds?
3. **Q3 (Incremental value beyond AlphaMissense):** Does adding $\Delta\text{LLR}$ from one or all three pLMs improve cross-validated protein-grouped discrimination over AlphaMissense alone?
4. **Q4 (Cross-model agreement):** Does the headline count (`0..3` favouring native) or a within-model z-score composite outperform the best single model?
5. **Q5 (Positional entropy):** How discriminative is positional entropy alone (`-entropy_bits`, low entropy = constrained)?
6. **Q6 (Embedding shift):** Does `shift_at_site` or `shift_window_mean` carry sufficient clinical signal to justify the embeddings subtab?
7. **Q7 (Reference distributions for UI):** Empirical class-stratified $\Delta\text{LLR}$ quantiles and fixed-range histograms per model.

---

## 2. Input Schema & Preprocessing

### 2.1 Primary Input: `logs/perturbation_bench/scores.csv`
Required columns:
`uniprot_id, pos, wt, mut, label, label_source, model, checkpoint, scoring_method, llr, wt_logp, mut_logp, wt_rank, mut_rank, entropy_bits, structure_token, sequence_length, truncated`

- Allowed labels: `label` $\in \{\text{pathogenic}, \text{benign}, \text{gnomad\_common}\}$.
- Variant identity key: `(uniprot_id, int(pos), wt.upper(), mut.upper())`.
- Deduplication: if duplicate `(uniprot_id, pos, wt, mut, label, model)` rows appear, retain the first and log the duplicate count. If the same `(uniprot_id, pos, wt, mut)` appears under multiple labels, keep distinct `(variant, label)` rows for pairwise tasks and report overlap count.
- Canonical model slugs (used for filenames and grouping):
  - Any model matching `esm-?2` / `esm2` $\rightarrow$ slug `esm2_650m` (preserving exact raw `model` string in tables).
  - Any model matching `saprot` $\rightarrow$ slug `saprot_35m_af2`.
  - Any model matching `vesm` $\rightarrow$ slug `vesm_150m`.
  - Any other model name $\rightarrow$ lowercase alphanumeric underscore slug.
- Valid scored row: `llr` is finite (`np.isfinite`).
- Flatness definition (matching `src/shared/modelCalibration.ts`):
  $$\text{FLAT\_ENTROPY\_BITS} = 0.95 \cdot \log_2(20) \approx 4.1058320569\text{ bits}$$
  A scored row is **flat** iff `entropy_bits` is finite and `entropy_bits >= 0.95 * log2(20)`. Otherwise (if `entropy_bits` is finite and below the cutoff, or if `entropy_bits` is missing/NaN), it is treated as **non-flat** for direction counting (missing entropy is logged).
- "Favours native" definition (matching `src/shared/perturbationEvidence.ts`):
  $$\text{EVEN\_ODDS\_LLR} = \ln 2 \approx 0.6931471806\text{ nats}$$
  A scored, non-flat model **favours native** iff $\Delta\text{LLR} \le -\ln 2$.

### 2.2 Embedding Shift Input: `logs/perturbation_bench/embedding_shift.csv` (optional)
Columns: `uniprot_id, pos, wt, mut, model, shift_at_site, shift_window_mean`.
If absent or empty, Q6 reports `MISSING` cleanly without crashing.

### 2.3 AlphaMissense Input: `logs/perturbation_bench/alphamissense.csv` (fetched by benchmark pipeline)
Columns: `uniprot_id, pos, wt, mut, am_pathogenicity, am_class, source, version`.
Fetch strategy (per unique `uniprot_id` in `scores.csv`):
1. Primary: `https://alphafold.ebi.ac.uk/files/AF-<UniProt>-F1-aa-substitutions.csv` (matches on `protein_variant == f"{wt}{pos}{mut}"`), recording HTTP `Last-Modified` / `ETag` and URL as `source`/`version`.
2. Fallback (only if EBI file returns 404/unavailable): per-variant query on `myvariant.info` (`/v1/query` with exact `uniprot` + `aapos` + `aaref` + `aaalt`, never range queries).
3. Variants not found in either source are recorded with empty `am_pathogenicity` and excluded from complete-case Q3 comparisons (coverage % reported).

---

## 3. Statistical Protocol & Pre-Registered Rules

### 3.1 Uncertainty Quantification (Shared Across Questions)
- **Proportions (Q1):** Wilson score 95% confidence interval with $z = \Phi^{-1}(0.975) \approx 1.959964$:
  $$\frac{\hat{p} + \frac{z^2}{2n} \pm z\sqrt{\frac{\hat{p}(1-\hat{p})}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}$$
- **AUROC & $\Delta\text{AUROC}$ (Q2–Q6):** Nonparametric protein-cluster bootstrap with **$B = 2{,}000$ replicates** and fixed PRNG seed **`20261118`** (`numpy.random.Generator(numpy.random.PCG64(20261118))`).
  - Each replicate samples $G$ protein clusters (`uniprot_id`) **with replacement** from the $G$ unique proteins in the evaluated comparison set, retaining all variants of each sampled protein (with multiplicity).
  - Replicates yielding only one class are skipped and the valid replicate count is logged.
  - 95% CI = `[2.5th percentile, 97.5th percentile]` of the bootstrap replicate distribution.
  - For paired $\Delta\text{AUROC} = \text{AUROC}(A) - \text{AUROC}(B)$ (Q3, Q4), both models are evaluated on the **exact same variants** within each protein-cluster bootstrap draw.

### 3.2 Q1 — Headline Honesty
- Evaluated per label class $c \in \{\text{pathogenic}, \text{benign}, \text{gnomad\_common}\}$ over variants with $\ge 1$ scored, non-flat model (`k_nonflat >= 1`; also report total class $N$, variants with all 3 models non-flat, and variants with `k_nonflat == 0`).
- Metrics per class:
  1. $r_{\text{all}}(c)$: fraction with `k_nonflat >= 1` and `k_favour_native == k_nonflat` (`"N of N favour native"`), with Wilson 95% CI.
  2. $r_{\ge 1}(c)$: fraction with `k_favour_native >= 1` (`">= 1 model favours native"`), with Wilson 95% CI.
  3. Auxiliary: UI majority rule (`k_favour_native * 2 > k_scored`, where `k_scored` counts all scored models including flat).
- **Pre-registered Decision Rule:**
  If $r_{\text{all}}(\text{benign}) \ge 0.50$ OR $r_{\text{all}}(\text{gnomad\_common}) \ge 0.50$, the headline **"is not discriminative"**. (We also report the same check for $r_{\ge 1} \ge 0.50$.)

### 3.3 Q2 — Per-Model Discrimination & Reference Thresholds
- Orientation: score $s = -\Delta\text{LLR}$ (higher $s$ = more predicted constraint / pathogenicity).
- Pairwise comparisons per model:
  1. **Primary:** `pathogenic` ($y=1$) vs `benign` ($y=0$).
  2. **Secondary:** `pathogenic` ($y=1$) vs `gnomad_common` ($y=0$).
- Metrics per `(model, comparison)`:
  - Overall AUROC with 2,000-rep protein-cluster bootstrap 95% CI.
  - **Per-protein-balanced AUROC:** unweighted mean of per-protein AUROCs restricted to proteins having $\ge 5$ positive variants AND $\ge 5$ negative variants in that comparison; report $K$ (qualifying proteins), variant counts, median/IQR, SD, and cluster bootstrap 95% CI across the $K$ proteins.
  - **Youden-optimal threshold $t_{\text{Youden}}$:** cut-point on $\Delta\text{LLR}$ (calling pathogenic if $\Delta\text{LLR} \le t$) maximizing $J(t) = \text{Sensitivity}(t) + \text{Specificity}(t) - 1$ across observed finite $\Delta\text{LLR}$ values. If multiple thresholds tie for maximum $J$, take the median of the tied thresholds. Report $t_{\text{Youden}}$ to 4 decimal places alongside sensitivity and specificity.
  - **95% specificity threshold $t_{\text{spec95}}$:** largest observed $\Delta\text{LLR}$ threshold $t$ (most sensitive cutoff) such that empirical negative-class specificity $\ge 0.95$ ($\text{FPR} \le 0.05$). Reported to 4 decimal places alongside sensitivity and achieved specificity. Primary UI mark is derived from `pathogenic vs benign`; `pathogenic vs gnomad_common` is reported separately.
- **Sensitivity stratifications (logged as auxiliary checks):**
  - SaProt stratified by `structure_token != '#'` (3Di-conditioned) vs `structure_token == '#'` (sequence-only fallback).
  - Each model stratified by `truncated == False` vs `truncated == True`.

### 3.4 Q3 — Added Value Beyond AlphaMissense
- Evaluated separately for `pathogenic vs benign` and `pathogenic vs gnomad_common` on the **complete-case variant intersection** for each comparison:
  - `AM` vs `AM + ΔLLR(model)` for each single model (`ESM-2 650M`, `SaProt 35M AF2`, `VESM-150M`) on variants with finite `am_pathogenicity` and finite `llr` for that model.
  - `AM` vs `AM + all three` on variants with finite `am_pathogenicity` and finite `llr` for all 3 models.
- Model specification: `Pipeline([StandardScaler(), LogisticRegression(C=1.0, max_iter=1000, random_state=20261118)])`.
- Cross-validation: `GroupKFold(n_splits=5)` grouped by `uniprot_id` (falling back to `min(5, n_proteins)` only if $<5$ proteins exist).
- Evaluation:
  - Out-of-fold predicted probabilities $p_{\text{oof}}$ pooled across all 5 folds; report `AUROC(AM)`, `AUROC(AM + ΔLLR)`, and paired `ΔAUROC = AUROC(AM + ΔLLR) - AUROC(AM)` with 2,000-rep protein-cluster bootstrap 95% CI (seed `20261118`).
  - Also report mean $\pm$ SD of per-fold AUROCs and standalone raw `am_pathogenicity` AUROC.
- **Incremental value criterion:** Adding a pLM feature is considered to show statistically supported incremental value iff the 95% CI of $\Delta\text{AUROC}$ excludes $0$ ($\text{CI}_{\text{low}} > 0$).

### 3.5 Q4 — Cross-Model Agreement vs Best Single Model
- Evaluated on the complete-case intersection where all 3 models have finite `llr`, separately for `pathogenic vs benign` and `pathogenic vs gnomad_common`.
- Candidate predictors:
  1. `count_favour_native` $\in \{0, 1, 2, 3\}$: count of models with finite `llr <= -ln(2)` and non-flat entropy (`entropy_bits < 0.95 * log2(20)`).
  2. `-mean_z_llr`: negative mean across the 3 models of within-model z-scored $\Delta\text{LLR}$ ($z_m = (\Delta\text{LLR}_m - \mu_m) / \sigma_m$, where $\mu_m, \sigma_m$ are computed over the evaluated comparison's complete-case set).
  3. Reference comparator: **best single model** (`argmax_m AUROC(-ΔLLR_m)` on the same complete-case set).
- Report AUROC with 2,000-rep protein-cluster bootstrap 95% CI and paired $\Delta\text{AUROC}$ (composite minus best single model) with 95% CI.

### 3.6 Q5 — Positional Entropy Alone
- Orientation: $s = -\text{entropy\_bits}$ (lower entropy = higher sequence constraint = higher score).
- Per model, for `pathogenic vs benign` and `pathogenic vs gnomad_common`, report AUROC and 2,000-rep protein-cluster bootstrap 95% CI (seed `20261118`), plus comparison against $-\Delta\text{LLR}$ AUROC.

### 3.7 Q6 — Embedding Shift
- Evaluated per model present in `embedding_shift.csv` for both `shift_at_site` and `shift_window_mean` (higher shift = more pathogenic), on `pathogenic vs benign` and `pathogenic vs gnomad_common`, with 2,000-rep protein-cluster bootstrap 95% CI (seed `20261118`).
- **Pre-registered Decision Rule:**
  On the primary `pathogenic vs benign` comparison, a metric passes iff $\text{AUROC} \ge 0.60$ **and** the 95% CI excludes $0.50$ ($\text{CI}_{\text{low}} > 0.50$). If **every** evaluated `(model, metric)` pair has $\text{AUROC} < 0.60$ or its 95% CI includes $0.50$, **recommend removing the embeddings subtab**.

### 3.8 Q7 — UI Reference Distributions (`reference_<model>.json`)
- One JSON file per model: `logs/perturbation_bench/reference_<model_slug>.json`.
- Fixed common histogram specification across all models and classes:
  - Range: **`[-16.0, 4.5]` nats**
  - Number of bins: **`41`**
  - Bin width: **`0.5` nats** (`42` edges: `-16.0, -15.5, ..., 4.0, 4.5`; `0.0` is an exact edge at bin index `32`)
  - Tail handling: values $< -16.0$ are clamped into bin `0` (`clamped_low` recorded); values $> 4.5$ are clamped into bin `40` (`clamped_high` recorded), so $\sum \text{counts} = n$.
- Quantiles per class (`pathogenic`, `benign`, `gnomad_common`): percentiles **`1, 5, 10, 25, 50, 75, 90, 95, 99`** (linear interpolation, `numpy.percentile`).
- Top-level JSON keys:
  `schema_version`, `model`, `model_slug`, `checkpoint`, `scoring_method`, `unit`, `generated_at`, `sources`, `thresholds` (`youden_llr`, `benign_spec95_llr`, `even_odds_llr`), `histogram_spec` (`n_bins`, `range`, `bin_width`, `edges`, `centers`, `clamp_tails`), `classes` (keyed by class name with `n`, `n_proteins`, `quantiles`, `histogram`: `{counts, density, clamped_low, clamped_high}`).

---

## 4. Known Training Data & Leakage Disclosures (Pre-Registered)

1. **ESM-2 650M (`facebook/esm2_t33_650M_UR50D`):** Lin et al. (*Science*, 2023); masked-marginal scoring per Meier et al. (*NeurIPS*, 2021). Self-supervised on UniRef50/90 sequences. **No clinical ClinVar or gnomAD labels** were used in training, though human reference sequences and homologs are in UniRef (evolutionary constraint).
2. **SaProt 35M AF2 (`westlake-repl/SaProt_35M_AF2`):** Su et al. (*ICLR*, 2024). Self-supervised on ~40M AlphaFold DB sequence+3Di pairs (50% identity filtered). **No clinical ClinVar or gnomAD labels** were used in training, though AlphaFold DB includes human AF2 models whose MSA-derived structures reflect evolutionary conservation. Note that 35M is a smaller independently trained checkpoint, and `structure_token == '#'` falls back to sequence-only tokens.
3. **VESM-150M (`ntranoslab/vesm`, `VESM_150M.pth`):** Dinh et al. (*Nature Methods*, 2026, `doi:10.1038/s41592-026-03050-9`). Fine-tuned from `facebook/esm2_t30_150M_UR50D` via unsupervised co-distillation of an ESM ensemble (ESMIN aggregation) on UniProt human (`UPh`) and non-human (`UPnh`) sequences. **No clinical ClinVar labels** were used in training (ClinVar and ProteinGym were held out for zero-shot evaluation in Dinh et al. 2026). However, it shares the ESM-2 architecture/backbone (so ESM-2 and VESM are **not independent** models) and uses wild-type-marginal scoring aligned to human UniProt evolutionary priors.
4. **AlphaMissense (`Cheng et al., Science 2023`, `doi:10.1126/science.adg7492`):** Trained with weak supervision from **human/primate population allele frequency** (common vs unseen variants). Although ClinVar labels were excluded from training, **population frequency supervision creates direct circularity/leakage for the `pathogenic vs gnomad_common` comparison** and partial correlation with ClinVar benign variants (which are enriched for common alleles). Therefore `AM` performance on `gnomad_common` must not be interpreted as an unconfounded out-of-sample benchmark.

---

## 5. Deviations

- **2026-11-18 — Structure-to-UniProt residue numbering remap & ClinVar release:** Inspection of `data/df_rasp_gnomad_clinvar.sqlite` (`rasp_variants`) before scoring revealed that several `(uniprot_id, pdb)` entries store `pos` in experimental PDB structure numbering rather than canonical UniProt sequence numbering (e.g., `+1` where the initiator Met is omitted, or signal-peptide / construct shifts). For every `(uniprot_id, pdb)` group, using all rows in `rasp_variants` carrying `clinvar_significance` or `gnomad_af`, we solved for the integer offset $\in [-100, 100]$ maximizing `uniprot_seq[pos + offset - 1] == wt`, accepting a group iff the offset explains $\ge 95\%$ of its annotated rows (and strictly beats offset $0$ when offset $\ne 0$). Rejected groups and residual post-offset mismatches were dropped and logged (`logs/perturbation_bench/offsets.csv`, `logs/perturbation_bench/mismatches.csv`), and variant resampling (`seed=20261118`, cap 40 per protein per class) was performed on the remapped UniProt positions. The exact ClinVar release date/version embedded in `df_rasp_gnomad_clinvar.sqlite` is unknown (`rasp_index_meta` records `built_at = 2026-09-19T07:58:12.054Z` for source `df_rasp_gnomad_clinvar.csv`).

