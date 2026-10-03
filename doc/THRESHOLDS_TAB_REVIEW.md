# Score thresholds tab: scientific-integrity and UI review

Reviewed on NAE1 p.Asp116Gly (the owner's screenshots), 29 September 2026. This replaces the
28 September review of the same tab, whose redesign kept the defects below.

## Findings and fixes

| # | Sev. | Finding | Fix |
|---|---|---|---|
| S1 | Critical | ΔΔG rows wore ACMG codes the engine never applies: FoldX a red **PM1** chip, ThermoMPNN a green **BP3** chip. PM1 is a hotspot/domain criterion (the engine reads UniProt sites); BP3 is an in-frame indel in a repeat. No ACMG/ClinGen rule takes a ΔΔG cut. | Stability rows carry no code: "Not an ACMG input", local marks drawn dashed. |
| S2 | Critical | Gene constraint showed PP2 at missense Z ≥ 2.0 with a "strong ≥ 3.09" tier (PP2 has no Strong) and painted BP1 green for Z < 2 and LOEUF ≥ 0.6. The engine's PP2 is Z ≥ 3.09 AND o/e < 0.6; it never read LOEUF. | One rule function `isPp2Constrained` (server and tab); LOEUF shown as context. |
| S3 | Critical | The hero's "5–4 · Pathogenic concordance" counted 20 correlated, heterogeneous scores (PP3 tools, conservation, stability, two gene-level numbers) as independent votes, disagreed with the engine's 3–1 vote, and never said what the engine recorded. | Removed. The hero reads the engine's computational codes and the vote from `buildPredictorEvidence`. |
| S4 | High | MetaRNN / ClinPred shown as "PP3 / BP4" with no caveat; both use gnomAD AF and are ClinVar-trained, and 0.5 is the authors' cut. | Reused the Predictors model: "Authors' cut" plus caveat chips. |
| S5 | High | RaSP tested at FoldX's 0.5 while every other surface uses 1.0; FoldX 0.5/1.5 credited to Schymkowitz 2005, which publishes no bands (the FoldX FAQ declines to give one). | Cut-points from `engineStatus` descriptors, all drawn as local marks. |
| S6 | High | Stabilising ΔΔG painted benign green and counted "benign/neutral". | Neutral scale; readings "Destabilising", "Mildly destabilising", "Below mark", "Stabilising". |
| S7 | High | Inspector key defined BP3 as "…or structurally neutral substitution" (invented) and labelled REVEL "Conservation". | Rail rebuilt; method notes use the ACMG wording. |
| S8 | High | ThermoMPNN cited as "Pei 2024". | Dieckhaus et al., PNAS 2024. |
| S9 | Medium | The rail's ClinGen point scale showed only the pathogenic side, tinted amber, and did not say the engine classifies by Richards 2015 rules. | Full Tavtigian 2020 scale with class bands, labelled as reference. |
| S10 | Medium | Headers "Benign ≤ / Pathogenic ≥" contradicted by row operators; hard-coded counts ("20 monitored assays", "11 algorithms & LLMs"). | One cut-points column written per row with provenance; counts derived. |
| S11 | Low | `classifier.ts` comment credited its weights to "Table 4 of Richards 2015". | Comment corrected (weights only sort sides). |

**Owner decision (29 Sep 2026):** the engine no longer applies **BP1** automatically. It used to fire
on pLI ≥ 0.9 without missense constraint, but BP1 requires it to be established that truncating
variants cause the gene's disease; pLI measures loss-of-function intolerance, not mechanism. The
tab and rail report BP1 as "not assessed", and flag a payload that still carries an automatic BP1.

UI: the fact strip ran together because `pop-facts`/`pop-fact`/`pop-verdict`/`pop-table` no longer
exist (removed in the Population polish); the count appeared five times; rows were beige boxes with
two columns repeating each other, inside a nested scroller. Rebuilt on self-contained `gt-*` classes:
flat rows, one reading column, no inner scroller, and a **strength ladder** that puts the seven
ClinGen-calibrated tools on one axis of evidence strength (BP4 Very strong −8 … PP3 Strong +4).

## Effect on NAE1 p.Asp116Gly

- Head: engine record **PP3** (the vote 3–1: CADD, MetaRNN, ClinPred vs REVEL; AlphaMissense, BayesDel indeterminate).
- Ladder: REVEL BP4 Supporting; CADD and phyloP PP3 Supporting; AlphaMissense, BayesDel, GERP++ neither; ESM1b no result.
- Disagreement line: REVEL, the calibrated reference, reads BP4; the vote's PP3 rests on CADD plus two AF-using tools.
- No PM1, BP3 or BP1 anywhere; missense Z 1.09 → "PP2 not met".

## Not done / follow-ups

- ThermoMPNN's sign convention was not verified against the paper (PNAS returned 403); the code assumes positive = destabilising.
- The variant header labels LOEUF 0.94 "Moderate constraint"; gnomAD suggests < 0.6 as constrained.
- `THRESHOLDS.misZ` / `THRESHOLDS.loeuf` are still read by the header's constraint bars.

## Sources

- Richards S, et al. Genet Med 2015;17:405–424. doi:10.1038/gim.2015.30
- Pejaver V, et al. Am J Hum Genet 2022;109:2163–2177. doi:10.1016/j.ajhg.2022.10.013
- Bergquist T, et al. Genet Med 2025;27:101402. doi:10.1016/j.gim.2025.101402
- Tavtigian SV, et al. Hum Mutat 2020;41:1734–1737. doi:10.1002/humu.24088
- Dieckhaus H, et al. PNAS 2024;121:e2314853121. doi:10.1073/pnas.2314853121
- Zhou Y, et al. (DDMut) Nucleic Acids Res 2023;51:W122. doi:10.1093/nar/gkad472

---

## Update: merged into Predictors

The Score thresholds tab was removed. It repeated the Predictors tab (same readings, vote, rulers and engine record), so its strength ladder moved there:

- `src/components/evidence/predictors/StrengthLadder.tsx` draws it; `src/shared/ladderEvidence.ts` is its model (formerly `thresholdEvidence.ts`).
- Calibrated tools get a STRENGTH row. Tools with only the authors' cut-point (MetaRNN, ClinPred, popEVE) get a DIRECTION row: a side, one flat tint, never a strength.
- The rule trace (PP2, BP1, engine record), the bands reached and the ClinGen point scale moved into `PredictorsRail`.
- Cut-points in words now sit under each ruler in the readings table.
- Gene-constraint and ΔΔG rows were dropped: constraint is in the header bar, ΔΔG in Energetics. Neither is an in-silico predictor.
- `guidelines` / `thresholds` ids redirect to `predictors` through `normalizeEvidenceTab` (`components/evidence/types.ts`).
