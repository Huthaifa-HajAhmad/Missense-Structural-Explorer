# Decision: retire runtime protein language models (2026-11-18, owner-approved)

**Decision: stop running protein language models on routine analyses.** ESM-2 650M, SaProt-35M, VESM-150M, ESMC-6B and
the ESM3 embedding reading are no longer computed per variant and no longer shown. The Structural perturbation tab goes away.
Its FoldX "Packing & geometry" view moves into the Energetics tab, next to the FoldX stability estimate.

A protein language model is a neural network trained on millions of natural protein sequences. For a missense variant it
reports ΔLLR: how much less (or more) likely the model finds the replacement amino acid than the original at that position.

This **reverses the 2026-10-30 decision** in `doc/STRUCTURAL_PERTURBATION_RESOLUTION.md` ("ESM-2 decision"), which ran
genuine ESM-2 650M on the server's CPU. That decision was about making the ESM-2 reading reliable. The benchmark below asks
a different question, whether the reading is worth having, and the answer is no.

**What curators keep.** ESM1b stays on the In-silico predictors tab. It is a protein language model with published ClinGen
calibration (Bergquist et al. 2025) and costs nothing at runtime, because its scores are precomputed in dbNSFP. So no
calibrated language-model evidence is lost.

## Why

1. **No clinical value beyond AlphaMissense.** AlphaMissense alone separates pathogenic from benign variants with AUROC
   0.926 (95% CI 0.909–0.941). AUROC is the chance that a random pathogenic variant scores worse than a random benign one; 0.5
   is a coin toss. Adding any language model's ΔLLR to AlphaMissense changed AUROC by +0.001 to +0.007, and every 95% CI
   included zero (5-fold cross-validation with whole proteins held out).
2. **The tab's headline did not discriminate.** "All models favour the original amino acid" fired for 59.7% of benign
   variants, 60.5% of common gnomAD variants and 80.7% of pathogenic ones. "At least one model" fired for 100% of every class.
3. **Showing them invites double counting.** The scores appeared on Predictors, Insights, the report and the AI narrative.
   The engine gave them no PP3/BP4 vote, but a reader seeing several agreeing predictors may count the same signal more than
   once. ClinGen recommends choosing one calibrated in-silico tool in advance (Pejaver et al. 2022).
4. **They are expensive on the production VM.** Measured on the 2-OCPU VM: ESM-2 650M takes 6.7 / 14.3 / 25.3 s per pass
   at 300 / 600 / 1,022 residues, with up to 2.95 GB peak memory. A new variant needs three passes. SaProt, ESMC, ESM3 and
   VESM add their own requests, and the remote tiers failed often (Hugging Face out of credits), which cluttered the screen.

## Evidence

Pre-registered benchmark, 2026-11-18. The plan, scripts and fixed decision rules are kept in
`scripts/perturbation_benchmark/` (`PLAN.md`, `score.py`, `analyze.py`, `make_synthetic.py`). Outputs are written under
`logs/perturbation_bench/`, which git ignores; the numbers that decided this are copied below.

**Data.** Variants from `data/df_rasp_gnomad_clinvar.sqlite`: 2,306 unique variants in 175 proteins (1,502 pathogenic,
692 benign, 435 common in gnomAD with allele frequency above 1e-3; 323 benign variants are also common). The ClinVar release
is unknown. 36 structure groups were stored in the experimental structure's residue numbering; they were remapped to UniProt
numbering by one offset per structure, and 7 groups that no single offset explained were dropped (see `offsets.csv`).

**Scoring.** The benchmark imports the app's own model-server scoring code. Three test variants matched the app's output
exactly. The model server's own tests passed (114). VESM and SaProt scored every variant. ESM-2 650M was stopped by this
decision at 30 of 175 proteins; the analysis below used the 23 proteins finished at the time.

| Model | AUROC, pathogenic vs benign (95% CI) | Note |
|---|---|---|
| AlphaMissense (reference) | 0.926 (0.909–0.941) | already on Predictors |
| VESM-150M | 0.885 (0.863–0.907) | all 175 proteins |
| ESM-2 650M | 0.857 (0.788–0.923) | 23 proteins only |
| SaProt-35M | 0.701 (0.656–0.744) | 0.530 where no structure token was available |

CIs come from 2,000 bootstrap resamples of whole proteins. Two independent recomputations from the raw scores matched the
report exactly (VESM AUROC; the headline rate on benign variants).

**Embedding shift** (how much the model's internal description of the protein changes after the substitution, ESM-2, 23
proteins): at the variant's own position AUROC 0.448 (fails); averaged over ±10 residues 0.718 (0.641–0.803, passes the
pre-registered ≥0.60 rule). This tests ESM-2 only. It does not validate the ESM3/VESM trace the app showed, and it adds
nothing shown beyond AlphaMissense, so it does not change the decision.

**Stability.** On 28 small measured-stability domains (Tsuboyama et al. 2023; `logs/foldx_bench/lm_compare_wt.out`, ESM-2
150M), the mean per-protein Spearman correlation with measured stability was 0.35 for ESM-2 and 0.42 for VESM: modest.

## Review

An independent advisor (a second model, read-only) reviewed the plan twice. It corrected two errors made during the work: a
stability log cited for ESM-2 650M was for the 150M model, and the embedding benchmark measured ESM-2, not the ESM3/VESM
trace the tab displayed. Both corrections are reflected above. The advisor recommended this decision independently.

## What changes

1. **Stop showing the readings.** Remove the language-model parts of Structural perturbation, the model selector, the 3D
   embedding colour mode, and the model rows in Predictors, Insights, the report and the narrative input. Saved analyses
   still open with their recorded provenance. PP3/BP4 codes and strengths must not change for any variant.
2. **Stop running the models.** Remove the automatic requests, startup warm-up, retries, settings and progress states for
   these models. Keep model-server services that other features still use. A fresh analysis must make zero calls to them.
   Measure end-to-end time and memory on the VM before claiming a saving.
3. **Keep the physical result.** Packing & geometry (FoldX local geometry, clash and contact counts) moves to Energetics.

## What would reopen this

- A reliable gain over AlphaMissense on independent, release-dated clinical data, at a threshold curators actually use. A
  higher standalone AUROC alone is not enough.
- Or curators showing a real, recurring need to see which other amino acids a model accepts at a site, which Species and
  Predictors cannot answer. That would justify **one** model, VESM-150M (one forward pass, the best AUROC here), run on
  request and cached, on the Species tab.
