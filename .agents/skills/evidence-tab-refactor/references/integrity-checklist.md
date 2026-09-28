# Scientific-integrity checklist

Run every item against the tab, its panels, its rail, and the server code behind them. Each "yes"
is a finding. Severity: **Critical** changes a classification; **High** asserts something false to
a curator; **Medium** misleads without changing a call; **Low** drift or wording.

## Cut-points and calibration
- [ ] Is any cut-point labelled "ClinGen", "SVI", "calibrated" or "ACMG" that is not the value in the
      cited paper's table? Check the paper itself (Pejaver 2022 Table 2; Bergquist 2025 Table 1;
      ClinGen SVI splicing (Walker 2023); the tool's own paper).
- [ ] Is a paper cited for a tool it predates or does not cover?
- [ ] Is a strength name wrong (e.g. REVEL ≥ 0.75 called "Strong"; ClinGen Strong is ≥ 0.932)?
- [ ] Does a benign threshold exist in code that the source never published?
- [ ] Is an author's class label (e.g. AlphaMissense likely_pathogenic > 0.564) used as a calibrated call?
- [ ] Are interval edges (≥ vs >, inclusive ends, one-decimal gaps) as printed?
- [ ] Is a score's orientation (higher vs lower = damaging) handled everywhere it is drawn?

## Rule engine
- [ ] Does the tab compute its own verdict with a rule different from the engine's?
- [ ] Does anything raise a criterion's strength from a single uncalibrated or composite score?
- [ ] Does a composite score vote beside one of its own inputs (double counting)?
- [ ] Do correlated tools vote as independent evidence without disclosure?
- [ ] Do tools that use allele frequency or ClinVar labels contribute to PP3/BP4 without a caveat
      (overlap with PM2/BS1; circularity)?
- [ ] Does the reason string name every input that decided the criterion?
- [ ] Is a weighting-withheld criterion reported as withheld, not as absent?

## Data provenance
- [ ] Is a score labelled with a model that may not have produced it (fallback tiers, remote vs local)?
- [ ] Are source/version strings hard-coded rather than read from the payload?
- [ ] Is a missing value rendered as 0, "benign", "N/A" or a legacy status word?
- [ ] Is an outage/refusal (build gate, timeout, no key) reported as a confirmed absence?
- [ ] Are display windows clipping values silently (no off-scale marker)?

## Interpretation
- [ ] Is conservation, stability (ΔΔG) or a rank presented as pathogenicity?
- [ ] Do colours/bars disagree with the badge next to them (swapped cut-points, wrong tint)?
- [ ] Does any prose claim a feature the code lacks?
- [ ] Is a placeholder presented as a measurement?

## Propagation
- [ ] grep the old numbers/labels in `src/` and `server/`: Threshold Guide rows, heatmaps,
      `MetricExplanations.ts`, `shared/attributions.ts`, `THRESHOLD_NOTES`, `THRESHOLDS_METADATA`,
      engine reason text, tests.

## Known published values (verified 2026-09)
- REVEL (Pejaver 2022): PP3 ≥0.644 / ≥0.773 Mod / ≥0.932 Strong; BP4 ≤0.290 / ≤0.183 Mod / ≤0.016 Strong / ≤0.003 VStrong.
- BayesDel noAF: PP3 ≥0.13 / ≥0.27 / ≥0.50; BP4 ≤−0.18 / ≤−0.36.
- CADD: PP3 ≥25.3 / ≥28.1 (no Strong); BP4 ≤22.7 / ≤17.3 / ≤0.15 Strong.
- phyloP: PP3 ≥7.367 / ≥9.741; BP4 ≤1.879 / ≤0.021. GERP++: no PP3; BP4 ≤2.70 / ≤−4.54.
- AlphaMissense (Bergquist 2025): PP3 ≥0.792 / ≥0.906 / ≥0.990; BP4 ≤0.169 / ≤0.099.
- ESM1b (Bergquist 2025): PP3 ≤−10.7 / ≤−12.2 / ≤−24.0; BP4 ≥−6.3 / ≥−3.1.
- popEVE (Orenbuch 2025): ≤−4.617 moderately, ≤−5.056 highly deleterious; no benign cut.
- ClinGen: use one pre-specified calibrated tool for PP3/BP4; cap PP3 + PM1 at Strong.
All of these are already in `src/shared/thresholds/calibration.ts` — import, do not retype.
