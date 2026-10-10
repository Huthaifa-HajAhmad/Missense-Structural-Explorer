# AlphaGenome tab — scientific-integrity and UI review

Reviewed against GZF1 p.Arg591Trp (NM_022482.5, 20-23369727-C-T, GRCh38), 28 September 2026.
Branch `predictors-redesign` (uncommitted). Reference for what the AVI is: Cheng J, Taylor KR, et al.
*AlphaGenome Atlas: in silico mutagenesis of the entire human genome…* medRxiv 2026,
doi:10.64898/2026.09.16.26363192.

## What the AVI is (per the Atlas preprint)

- A supervised neural network over 18 features: ten AlphaGenome modalities (each the per-variant
  maximum predicted effect across biosamples), AlphaMissense, three VEP protein-termination
  indicators, Cactus 241-way and PhastCons 470-way conservation, and two indel indicators.
- Trained on **proxy labels from gnomAD rarity**: FAF95 grpmax < 0.1% ("impactful") vs ≥ 0.1%
  ("neutral"). Not trained on pathogenicity.
- Reported as a Phred **rank against all ~9 billion possible hg38 SNVs** (10 = top 10%, 20 = top 1%).
- SHAP by expected-gradients approximation; the 18 contributions sum to the raw score.
- Authors: a research tool, "not sufficient evidence on their own"; prefer ranking over hard cut-offs.

## Scientific findings

| # | Severity | Finding | Fix |
|---|---|---|---|
| A1 | Critical | "ClinGen SVI Evidence · PP3 (Moderate Pathogenic) · 4.33:1 Odds of Pathogenicity · Calibrated against ClinGen SVI framework" — shown from `acmgStrength`, an app-defined banding of the rank. No ClinGen calibration of the AVI exists; the engine stopped counting it in the Predictors redesign, but this card still asserted it. | Card removed. The tab never reads `acmgStrength`; it carries a standing "Not counted for ACMG" chip and a caveat. |
| A2 | High | "Calibrated AVI Phred … / 50.0" and "Scaled −10 log10(P_benign) empirical odds". The Phred is −10·log10 of the tail quantile among all possible SNVs — a rank, not P(benign), and not capped at 50 (the client floor allows 70). The gauge drew BP4/PP3 ticks at 8/15/25/35. | Replaced by a decade ruler (top 10% … 0.001%) with no evidence bands; headline is the rank in words ("Top 0.23% of all ~9 billion possible hg38 SNVs"). |
| A3 | High | "Reference track schema": ten rows of invented magnitudes (e.g. "−84% ChIP Peak Disruption", HepG2) in a filterable mono data grid. Labelled illustrative, but presented with every affordance of a measurement. | Removed. The Atlas links go to the real track predictions. |
| A4 | High | The model's training target (gnomAD rarity) was stated nowhere. The score therefore overlaps with PM2/BS1 and is partly circular with the population evidence. | Stated in the finding caveat and the rail's Method. |
| A5 | High | AlphaMissense described as "Protein-level structural perturbation … embeddings", assay "DeepMind AlphaFold Structural Model", and in the Coding-vs-splicing card as "3D amino acid fold, hydrophobic packing and local steric contacts". AlphaMissense is a pathogenicity predictor fed in as one feature. | Described as such; its group note says it is already counted on the Predictors tab, and when it dominates the finding says the AVI is not independent of it. |
| A6 | Medium | "68.6% Rel" = SHAP × 100, labelled as a relative share. | Share is now \|contribution\| / Σ\|contributions\| (GZF1 AlphaMissense: 88% on the six attributed features in the screenshot payload). |
| A7 | Medium | "9,440 tracks / biosamples", "3B Bases", PRO-cap as "elongation", PhastCons 470 as "multi-vertebrate", edu drawer asserting a "calibrated gradient boosted ensemble". None sourced; several wrong. | Feature text rewritten from the preprint (PRO-cap = initiation; 470-way mammals; neural network; ~9 billion SNVs). |
| A8 | Medium | Atlas deep links built from `gnomadVariantId` regardless of build: a GRCh37 input opened a different locus in the GRCh38-only Atlas. | Links built from the coordinate the Atlas was actually queried with (`atlasUrl`), else a GRCh38-tagged or verified-lifted coordinate; otherwise a gene search with the reason stated. |
| A9 | Medium | "Leading mechanism" with a 0.25 \|SHAP\| floor in raw-score units — an unsourced cut on a scale whose units are the model's own. | Replaced by the largest contribution and the dominant group by share; conservation-dominated scores say they name no molecular route. |
| A10 | Low | Rail listed the five PP3/BP4 bands for the AVI and described the invented table; the fallback branch also rendered "placeholder, not a measurement" telemetry under it. | New `AlphaGenomeRail`; fallback excludes this tab. |

## UI / UX

- Same three-tier shape as Population Data and Predictors: finding → table → rail.
- **Finding:** status chip, "Not counted for ACMG" chip, the rank as the headline in words, a decade
  ruler, one composition sentence, one caveat, and a four-fact strip (rank, largest contribution,
  splicing feature with a link to the Splicing tab, ACMG use). When there is no score, the reason and
  the one remedy that can fix it sit in the same card, as buttons.
- **What the score is made of:** one table for all 18 features, grouped as the Atlas groups them, with
  a signed value, a diverging bar (side = direction, not hue) and share. Rows under 2% of the total
  fold behind one row per group that says how many it holds.
- **Atlas:** the queried GRCh38 variant with Copy, and three links as a list.
- **Rail:** four-step trace from coordinate to Phred with the arithmetic shown, a Phred-to-rank table
  with this variant's row marked, Method notes, Connection (key state + Test connection, moved out of
  the column), Sources with DOIs.
- No red or green on the screen — nothing on it is an ACMG call. Tokens only; checked in light, dark
  and at a narrow column.
- Removed: four equal-weight KPI cards, the ClinGen card, Coding-vs-splicing duplicate cards, the
  18-card grid with per-feature hex colours, sort toggle, education drawer, the reference table and
  its tissue filters, three launcher cards.

## Files

- `src/shared/alphagenomeEvidence.ts` (new) — single reading shared by tab and rail.
- `src/components/evidence/AlphaGenomeTab.tsx` — rewritten (1,621 → ~420 lines).
- `src/components/inspector/AlphaGenomeRail.tsx` (new); `EvidenceInspector.tsx` wires it in.
- `src/components/inspector/ViewInspector.tsx` — rail subtitle "AlphaGenome variant impact (AVI)".
- `src/styles/alphagenome.css` (new, `ag-` prefix), imported from `components.css`.
- Tests: `AlphaGenomeTab.test.tsx` (21), `AlphaGenomeRail.test.tsx` (3).

## Not changed (follow-ups)

- `alphagenome-client.ts` still emits `acmgStrength`, and `GenomicSaturationHeatmap` still shades by
  `THRESHOLDS.alphagenome` bands. Recommend dropping the field and shading the heatmap by rank.
- `ConnectionsSection.tsx` still advertises "18-modality SHAP attributions, and Atlas track predictions".
- `MetricExplanations.ts` says "quantile among scored variants"; the preprint's reference set is all
  possible hg38 SNVs.

## Second pass — 29 September 2026 (NAE1 p.Asp116Gly, 16-66823281-T-C)

The owner asked for a clear message for a researcher reading a new score, and for the blank space
and inconsistencies to go. Checked against the preprint again (SHAP values "sum to the raw AVI score
(i.e., before PHRED scaling)"; Phred from the rank over all SNVs).

| # | Severity | Finding | Fix |
|---|---|---|---|
| B1 | High | The sequence view's saturation heatmap still coloured AVI Phred as "ClinGen" PP3 Strong/Moderate/Supporting and BP4 (legend "ClinGen Phred", tier counts, hover "Tier: PP3_Moderate"), and the Landscape inspector showed the payload's `acmgStrength` in a red/amber/green chip — contradicting this tab. Follow-up A-list item left open. | Both now read `aviRankBand` (rank decades: top 10% / 1% / 0.1% / 0.01%) on one clay ramp, with "not an ACMG band" in the legend; density guides at Phred 10/20/30. `acmgStrength` is no longer read anywhere on screen. |
| B2 | High (message) | "Top 0.35%" is a rank among ~9 billion possible SNVs, most non-coding, and much of it comes from inputs the Predictors tab already shows. NAE1: conservation 51% + AlphaMissense 26% = 77%; AlphaGenome's own predictions 23%. The finding only warned about overlap when AlphaMissense was the largest group, so this score never said it. | The model splits the score by origin (`origins`, `newShare`, `largestMolecular`); the finding leads with it ("Mostly evidence this workspace already reads. 77% … AlphaGenome's own molecular predictions add 23%, led by splicing (+0.176)"), a 100% bar shows it, and the table is banded "New from AlphaGenome" / "Already read elsewhere". The foot says missense changes tend to rank high genome-wide, partly because AlphaMissense is an input (inferred: the preprint reports no per-consequence distribution). |
| B3 | Medium | Rail: "two conservation scores, both already read on the Predictors tab". Predictors reads phyloP and GERP, not Cactus 241-way or PhastCons 470-way. | "…two conservation scores (Cactus 241-way, PhastCons 470-way) that measure the same thing as phyloP and GERP there." Same wording in the table's conservation rows. |
| B4 | Medium | "Top x% of scored variants" (Predictors row and knowledge text), "quantile among scored variants" (MetricExplanations, evaluator comment, Predictors rail). The reference set is all possible hg38 SNVs. | Corrected in each copy. Settings no longer says "18-modality" (10 modalities among 18 features). |
| B5 | Low | A green `good`-tone "Computed" chip (green = benign in this app) on a screen that makes no call. | Removed; the headline shows a score was computed. Absence keeps its state chip. |
| B6 | Low | The model and rail attributed to the authors "not sufficient evidence on their own" and "advise ranking over hard thresholds"; neither sentence could be found in the preprint text. | Removed; the rail states the app's own position (no ClinGen calibration, counted toward nothing). |

**UI.** Description no longer capped at 72ch (it wrapped at a third of the column). Every card has
the approved head/foot bars; the finding's caveat is its foot, not a tinted box. "Not counted for
ACMG" said once (head chip) plus the "Engine record" fact; Phred and quantile said once in the column.
The ruler spans the column with no progress-bar fill, and its last label reads "top 0.001%". The
table has fixed columns (feature 320px, bar, value, share); the zero line sits where the data puts
it, so positive-only bars use the full width. Atlas card carries the coordinate and Copy in its head.
The rail's Connection section (browser key state and "Test connection") is removed at the owner's
request: it tested the channel, not this variant, and connections belong in Settings.

**Verification.** `npm run lint` clean; vitest 2,585 passed, 5 skipped; rendered light, dark, 820px and the
no-score state with the NAE1 payload.

**Still open.** `alphagenome-client.ts` still emits `acmgStrength` and `THRESHOLDS.alphagenome` still
holds the app-defined bands (now read by no screen). The Predictors row still shows the payload's
`topModality`, which can differ from this tab's largest contribution; left for after PR #2 lands.
A per-exon comparator (this change's rank among all SNVs in its exon, from the saturation route) was
proposed as an on-request button and not built.


## 9 October 2026 ? visualization workspace

This tab now uses the shared comparison/source-record workspace and a pinned-reading
inspector. Scientific rules are unchanged. The implementation, presentation corrections,
reference contracts and validation are recorded in [Evidence workspace review](EVIDENCE_WORKSPACE_REVIEW.md).
