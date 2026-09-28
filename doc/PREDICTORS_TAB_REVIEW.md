# Predictors tab — scientific-integrity and UI review

Reviewed against GZF1 p.Arg591Trp (NM_022482.5, 20-23369727-C-T, GRCh38), 28 September 2026.
Branch `predictors-redesign`.

## Decision taken

Asked whether to replace the PP3/BP4 vote with a single ClinGen-calibrated tool, the owner chose
**keep the vote, fix its inputs**. So the engine still counts calls from several tools, but:

- every tool that votes is called against a published cut-point, and the UI says whose;
- the AlphaGenome AVI no longer votes or sets strength;
- PP3/BP4 stay at Supporting strength (the strength an uncalibrated count can carry);
- the tab shows the calibrated single-tool reading ClinGen recommends (REVEL, else BayesDel) beside
  the vote, and says so when the two disagree.

## Scientific findings

| # | Severity | Finding | Fix |
|---|---|---|---|
| S1 | Critical | The engine raised PP3 to **Moderate** (AVI ≥ 25) or **Strong** (≥ 35), and BP4 to Moderate (≤ 5), from the AlphaGenome AVI alone. The AVI "Phred" is −10·log10(1 − q), a rank among scored variants (`cdfToPhred`), with no ClinGen calibration. For GZF1 it produced **PP3_Moderate**, and nothing on the tab reported that the strength came from one composite. | Escalation removed (`criteria.ts`). PP3/BP4 recorded at Supporting. |
| S2 | Critical | AlphaGenome voted as a full member, yet AlphaMissense is one of the AVI's 18 input features. For GZF1 the AVI's largest feature *was* AlphaMissense (+0.69), so AlphaMissense was counted twice. | AVI is informational (`concordance.ts`), with "Rank, not probability" and "Contains AlphaMissense" caveats. |
| S3 | High | Cut-points labelled "ClinGen-calibrated" were not ClinGen's: REVEL ≥ 0.75 called "Strong" (Pejaver 2022: Strong ≥ 0.932, 0.75 is Moderate), benign ≤ 0.15 (published: ≤ 0.290); CADD ≥ 25 "Strong" (CADD reaches Moderate at most, ≥ 28.1; BP4 ≤ 22.7); BayesDel benign ≤ −0.0404 (published ≤ −0.18). | New `thresholds/calibration.ts` transcribes Pejaver 2022 Table 2 and Bergquist 2025 Table 1; evaluators read it. |
| S4 | High | AlphaMissense 0.983 / 0.063 credited to "Pejaver 2022", which predates AlphaMissense. The vote used the authors' class, so any score > 0.564 voted pathogenic; ClinGen's calibrated PP3 band starts at 0.792 (Bergquist 2025). | Score is called on the Bergquist bands; the class is shown as a note, never promoted to a call. |
| S5 | High | popEVE voted pathogenic at ≤ −2.0 and benign at ≥ −1.0 — neither published. The authors' cut-points are ≤ −4.617 and ≤ −5.056, both deleterious; no benign cut exists. GZF1's −3.931 was a "Deleterious" vote. Citation was EVE (Frazer 2021), not popEVE (Orenbuch 2025, Nat Genet). | Evaluator uses −4.617 only; never benign. Citation fixed. |
| S6 | High | The popEVE card's bar passed its two cut-points swapped, so the "Deleterious" score was painted green. | Cards replaced by `ScoreRuler`, which draws only what the model gives it. |
| S7 | High | Tab verdict used a strict **majority** of voters; the engine applies PP3 on a **plurality** (P > B). The two could disagree on screen. | One function, `insilicoVoteOutcome`, used by the engine and the tab. The tab reads the engine's recorded code and draws an unrecorded one dashed. |
| S8 | High | Evidence Lineage rail claimed scores were "calibrated against local odds of pathogenicity" and that "consensus voting prevents circular double-counting" — the opposite of what a vote of correlated tools does. Model registry was four hard-coded strings, one for SpliceAI (not on this tab). | New `PredictorsRail`: rule trace, REVEL bands with this variant's band marked, method notes, sources read from the payload, DOIs. |
| S9 | Medium | Eigen (≥ 4.0) and DANN (≥ 0.96, benign ≤ 0.5) voted on cut-points with no source. | Both informational. |
| S10 | Medium | MetaRNN and ClinPred take gnomAD AF as a feature and are trained on ClinVar, so their votes overlap with PM2/BS1 and are partly circular. Not disclosed. | Still vote (authors' 0.5 cut) with "Uses gnomAD AF" and "ClinVar-trained" caveats. |
| S11 | Medium | The `esmcEval` score was always labelled "VESM-150M / EvolutionaryScale". It is ESMC when the JapanFold tier answers and VESM (Ntranos lab, not EvolutionaryScale) otherwise; SaProt can also be served by a fallback. | Row name and note come from `provenance` / `fallbackReason`. |
| S12 | Medium | GERP++ and phyloP badged "Deleterious". They measure conservation. GERP++ has no PP3 band at all. | Conservation group, "not counted", calibrated bands shown. |
| S13 | Medium | ESM-1b voted (informationally) on −7.5 / −5.0; ClinGen's bands are PP3 ≤ −10.7, BP4 ≥ −6.3 (Bergquist 2025). ESM-1b had no card at all. | Calibrated call shown; row added. |
| S14 | Low | Threshold Guide rows for REVEL, AlphaMissense, CADD, BayesDel, popEVE, ESM1b, Eigen, DANN, GERP++ and phyloP carried their own hand-written numbers. | Rows read `calibration.ts` (`calibratedRow`). |
| S15 | Low | Knowledge-modal text repeated the wrong cut-points and citations (REVEL, AM, CADD, BayesDel, popEVE, AlphaGenome, VESM, ESM-2). | Rewritten with sources. |

### Effect on GZF1 p.Arg591Trp

Voting tools now: CADD 29.5 (PP3 Moderate band), AlphaMissense 0.835 (PP3), MetaRNN 0.767 and
ClinPred 0.998 (authors' cut) → pathogenic; REVEL 0.234 (BP4 band) → benign; BayesDel 0.092 and
popEVE −3.931 → indeterminate. **4–1 → PP3 (Supporting)**, down from PP3_Moderate. The tab flags that
REVEL, the calibrated reference, sits in the BP4 band. A cached payload still showing PP3_Moderate is
labelled in the rail as classified by an earlier engine.

## UI / UX

- One screen shape shared with Population Data: finding card → readings table → rail.
- Finding: engine chip, pathogenic–benign count as the headline figure, one sentence, a vote strip
  of every voting tool coloured by call, the calibrated-reference callout, and a four-fact strip.
- Readings: all 18 tools in one table (was 4 sub-tabs, one family visible at a time), grouped by
  role, each with score, a ruler on its own axis with cut-points drawn by provenance (ClinGen bands
  graded by strength; authors' ticks; local marks dashed; none), and its call.
- Absence uses the engine-status vocabulary; pending rows say "Running"; connection problems keep
  their Settings action.
- Tokens only; checked in light and dark and at a narrow column.
- Typography follows the existing ramp: mono for figures and codes, sans for prose, `.eyebrow` labels.

## Not changed (follow-ups)

- `alphagenome-client.ts` still emits `acmgStrength` (PP3_Strong…BP4_Moderate) from the same
  uncalibrated rank, and the AlphaGenome tab and genomic heatmap still display it. Recommend
  replacing it with the percentile.
- The heatmaps' REVEL/CADD/AlphaMissense colour breaks (`THRESHOLDS.revel` etc.) are unchanged; their
  comments now say they are display breaks, not evidence.
- ClinGen's PP3 + PM1 ≤ Strong cap is described in the rail but not enforced by the engine.
- A single pre-specified calibrated tool for PP3/BP4 remains the ClinGen recommendation.

## Sources

- Pejaver V, et al. Am J Hum Genet 2022;109:2163–2177. doi:10.1016/j.ajhg.2022.10.013
- Bergquist T, et al. Genet Med 2025;27:101402. doi:10.1016/j.gim.2025.101402
- Orenbuch R, et al. Proteome-wide model for human disease genetics. Nat Genet 2025;57:3165–3174. doi:10.1038/s41588-025-02400-1
- Avsec Ž, et al. AlphaGenome. bioRxiv 2025. doi:10.1101/2025.06.25.661532
- Dinh T, et al. Compressing the collective knowledge of ESM into a single protein language model. Nat Methods 2026. doi:10.1038/s41592-026-03050-9
