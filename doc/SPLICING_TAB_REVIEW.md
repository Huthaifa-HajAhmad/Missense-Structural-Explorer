# RNA splicing tab — scientific-integrity and UI review

Reviewed against NAE1 p.Asp116Gly (NM_003905.4, MANE Select; payload coordinate `16-66823281-A-G`,
GRCh38), 28 September 2026. Branch `splicing-redesign`.

## Decision taken

The tab printed its own "Pathogenic Supporting (PP3)" / "Benign Supporting (BP4)" for splicing,
but the ACMG engine never reads splicing: its PP3/BP4 comes from the missense vote alone. Asked
whether the engine should apply the ClinGen splicing rule, the owner chose **tab only, engine
unchanged**. So:

- no classification changes;
- the tab applies the ClinGen SVI Splicing Subgroup rule (Walker 2023: SpliceAI max Δ ≥ 0.2 → PP3,
  < 0.1 → BP4) and shows the result as *what the splicing rule would support*, drawn dashed and
  labelled "not applied by the engine", beside the engine's real record;
- the tab warns when splicing supports PP3 while the engine recorded BP4, and notes when a BP4 has
  no SpliceAI score behind its splicing side;
- dbscSNV and junction distance become context and make no call.

## Scientific findings

| # | Severity | Finding | Fix |
|---|---|---|---|
| S1 | Critical | The tab and inspector showed a splicing "PP3"/"BP4" verdict that the engine never records — `evaluateSplicePredictor` is not called by `criteria.ts`. The Insights banner went further and said "ACMG PP3 in-silico predictor concordance voting includes this splice disruption signal", which has never been true. | Splicing code drawn dashed as "PP3 · splicing" / "BP4 · splicing" with "not applied by the engine"; engine record read from its criteria list beside it. Insights banner reworded. |
| S2 | High | The splicing rule went pathogenic for any variant ≤ 5 bp from a junction (`isNearSpliceSite`) and for dbscSNV ≥ 0.6. Neither has a published basis: Walker 2023 decides PP3 on a SpliceAI score, distance alone is not PP3 (a canonical ±1/2 change is a PVS1 question — Abou Tayoun 2018), and 0.6 is dbscSNV's authors' cut-point, not a ClinGen band. | `evaluateSplicePredictor` reads SpliceAI only. Proximity and dbscSNV are context. |
| S3 | High | BP4 needed SpliceAI **≤ 0.02** and a junction distance **> 12 bp**, cited to a "ClinGen SVI Recommendation (2019)" that does not exist. Walker 2023 uses **< 0.1**, with no distance condition. A measured 0.05 read as indeterminate; 0.02–0.2 was labelled "Low disruption risk" (green) although 0.1–0.2 supports neither criterion. | `THRESHOLDS.spliceai.splicingPp3 = 0.2`, `splicingBp4Below = 0.1`; the 0.1–0.2 gap is drawn bare. `THRESHOLD_NOTES` and `THRESHOLDS_METADATA` corrected. |
| S4 | High | "Mechanistic etiology" declared "pathogenicity is driven by post-translational protein misfolding" (**Tertiary Structure-Dominant**) whenever FoldX ≥ its strong cut, AlphaMissense ≥ its supporting cut, or REVEL ≥ 0.5 — REVEL's 0.5 is a heatmap colour break, not ACMG evidence. It fired for NAE1 on FoldX 2.62 alone while REVEL 0.231 sat in the BP4 band, and it ran *before* the "no splicing coverage" branch, so an unassessed splicing arm read as "no splicing disruption signal". "Misfolding / Aggregation" was asserted; aggregation is not assessed. Destabilisation is not pathogenicity. | Removed. The tab answers the splicing question only; protein evidence lives on Predictors and Energetics. |
| S5 | High | A missing SpliceAI score read "No precomputed or runtime SpliceAI delta scores exist for this genomic position." SpliceAI scores every SNV in an annotated gene, so for an exonic or intronic variant an absence means the request failed or the coordinate was rejected. For NAE1 it was the latter: the payload coordinate carries the coding-strand alleles of a reverse-strand gene (AlphaGenome: "reference base does not match … T"). | Absence reason says what the absence can and cannot mean. When AlphaGenome reports a reference-base mismatch, the tab says so and that SpliceAI checks the reference base too. The strand fix itself is being made separately in `variantNotation.ts` / `coordinate-resolver.ts`. |
| S6 | Medium | dbscSNV's window was a symmetric "±12 bp consensus flank". Jian 2014 defines −3..+8 at a donor and −12..+2 at an acceptor. An exonic base 5 from an acceptor was "Consensus Flank (≤ 12 bp)" though dbscSNV cannot score it. | `THRESHOLDS.dbscsnv.window`; positions in splice-site numbering; per-side window test. |
| S7 | Medium | A red "±5 bp Critical Junction Zone" was drawn on the schematic as if it were evidence. It is the app's own proximity flag. | Replaced by dbscSNV's real window (dashed) and the canonical dinucleotide (neutral). |
| S8 | Medium | AlphaGenome's splicing value was the signed SHAP contribution ×100 printed as "%", with a "Primary Driver" badge at an app-defined 0.25. | The AlphaGenome tab's own reading (`buildAlphaGenomeEvidence`): the splicing feature's share of total \|SHAP\|, with the signed SHAP beneath, marked informational. |
| S9 | Medium | Citations: the ClinGen splicing source was given as **Pejaver 2022** (the missense calibration); dbscSNV linked PubMed 25313161 (Jian 2014 is 25416802) and `THRESHOLDS_METADATA` called its journal *Hum Mutat* (it is *Nucleic Acids Res*). | Sources are Walker 2023, Jaganathan 2019, Jian 2014 and Abou Tayoun 2018, by DOI. |
| S10 | Medium | The knowledge modal called 0.2–0.5 "moderate probability" and ≥ 0.5 "high probability". Delta scores are changes in probability; 0.2 / 0.5 / 0.8 are the authors' recall–precision operating points. | Rewritten; the authors' points drawn as ticks, never as strengths. |
| S11 | Low | "±12 bp consensus flank" was also implied as SpliceAI's window; SpliceAI's reporting window is `-D` (50 bp in the frozen tables, 500 bp live). | Rail reports the window, masking and source from `provenance`, or "Not stated". |
| S12 | Low | Distance semantics: "25 bp from the acceptor" and "+25 bp (Exonic)" for what is the 26th exonic base. | Position in splice-site numbering (+26) and in words ("the 26th base of exon 6 from its acceptor boundary"). |

### Effect on NAE1 p.Asp116Gly

Classification: unchanged (engine not touched). On screen: the splicing rule reads "Rule not
applied" (no SpliceAI score); the reference-base mismatch is named as the likely cause; the engine's
in-silico code is BP4 from the missense vote (unconfirmed in this payload), with a note that its
splicing side is unchecked; the variant sits at +26 from the exon 6 acceptor, outside dbscSNV's
window; the "Tertiary Structure-Dominant" verdict is gone.

## Functional and UI findings

| # | Finding | Fix |
|---|---|---|
| U1 | `useSettings()` was called after an early `return null` — a rules-of-hooks violation that throws when the result arrives after first render. | Hooks before the guard. |
| U2 | Five KPI cards, a two-column "attribution" card and a schematic repeated the same four numbers three times; the ACMG rule mapping lived only in the inspector. | Three tiers: finding (rule chip, max Δ, sentence, ruler, callouts, fact strip ending in the engine record), one readings table (SpliceAI, its four channels with Δ positions, context rows), and the junction to scale. |
| U3 | Legacy styling: Tailwind indigo/emerald, `animate-pulse` loaders as status, "N/A", "Unannotated", "Unmapped", `font-bold` mono chips. | `splicing.css` (`spl-*`), tokens only; statuses from `ENGINE_STATE_LABELS`; tab, rail and model added to the label guard. |
| U4 | Inspector was a second copy of the tab's content (architecture table, prose, delta bars, rule lists). | `SplicingRail`: rule trace (score → rule → context → engine), SpliceAI bands with this variant's band marked, authors' operating points, method notes, sources from the payload with DOIs. |
| U5 | Schematic at 960×240 in a fixed box; chip text clipped at narrow widths; exon drawn to the edge whatever its length. | 640-wide SVG, capped at 760 px; labels move away from the variant; the exon ends where it ends when inside ±40 bp; off-window variants drawn hollow on the edge. |

## Verification

- `npx tsc --noEmit` clean; `npm run lint` (boundaries, focus indicators, verify parity, tsc) clean.
- Full `npx vitest run`: 207 files passed (2 skipped), 2582 tests passed (5 skipped).
- New: `src/shared/__tests__/splicingEvidence.test.ts` (model contract on NAE1 and edges),
  `src/components/__tests__/SplicingTab.test.tsx` (what the screen and rail may claim).
  Updated: `thresholds.test.ts` and `acmg.test.ts` splicing cases now state the Walker rule;
  `splicingEvidence.transcript.test.ts` reads the new model. Removed:
  `splicingTab.schematic.test.tsx` (it pinned the old ">60 bp scale" chip).
- Rendered with the NAE1 payload and two synthetic ones (scored PP3 vs engine BP4; intronic +5 donor
  with dbscSNV) in light, dark and an ~800 px main column.

## Second pass — layout, consistency, and the splice map (2 October 2026)

Reviewed against SLC12A4 p.Gln867His (NM_005072.5, reverse strand; SpliceAI max Δ 0.001) and two
synthetic payloads (a donor loss on the annotated donor plus a cryptic acceptor gain; a refused
coordinate).

| # | Finding | Fix |
|---|---|---|
| L1 | The hero ruler was capped at 560 px: half the card was empty and 0 / 0.1 / 0.2 were squeezed into 60 px. | Full width. |
| L2 | The table's Source column took all the slack; scores floated mid-card; the four channel rows were four identical dots on a bandless ruler. | Column widths set; channels are one row of four cells (channel, Δ, position, description). |
| L3 | dbscSNV AdaBoost and random forest repeated the same "not covered" reason word for word. | One row when both are absent for the same reason; two rows when scored (the models can disagree). |
| L4 | The same score printed `0.00` in the tab and `0.001` in the rail; 0.0996 would print `0.10` while in BP4. | `formatDelta` everywhere: `< 0.01` for a non-zero score under 0.005, a third decimal only when rounding lands on a cut-point. |
| L5 | The table showed a solid `BP4 (splicing)` chip (reads as recorded) and the hero a clay one beside the red band (reads as pathogenic). | One chip: `BP4 · splicing`, toned by direction, dashed wherever it means "not applied by the engine". |
| L6 | Rail cut-points and Method prose were hand-typed numbers. | Read from `THRESHOLDS`. |
| L7 | The hero repeated dbscSNV (hero cell, table row and junction text) and carried AlphaGenome's attribution, which is not splicing evidence. | Hero facts are Position · SpliceAI source · Engine record. |
| L8 | "Donor gain 0.00 at −360 bp": a location for a score of zero. | A position is shown only for a score ≥ 0.01. |
| L9 | SpliceAI's delta positions are **genomic**; the tab's other positions are transcript-direction. On a reverse-strand gene the table said "at −6 bp" while the position was +6 from the donor. | Converted to transcript direction everywhere; with no strand they stay genomic and say so. |
| L10 | The header chip was a red, pulsing "Splice alert" on the app's own ≤ 5 bp flag. | A neutral "Near splice site" chip in splice-site numbering (`−7 donor`), no pulse; its title says distance is context, not evidence. |
| F1 | A failed SpliceAI request was a bare `null`, so the tab guessed. | `fetchSpliceAiBroadOutcome` classifies it (rate-limited, coordinate-rejected, upstream-error, timeout, network, unreadable, no-transcript) and the payload carries `conservationData.spliceaiFailure`; the tab names the cause and labels the state ("Provider busy", "Coordinate rejected", "Provider error"). A payload from before this field keeps the cautious wording. |

### The splice map

The junction schematic (one junction, ±40 bp, a dot) is replaced by a variant-centred **splice map**:
one axis in bases from the variant, in transcript direction; the exon to its real length with the
annotated donor and acceptor; SpliceAI's four channels as lollipops at their delta positions
(height = score on 0–1, the Walker PP3 line drawn across; gains solid, losses hollow); dbscSNV's
real window; the canonical dinucleotide while the scale is fine enough. It answers what the old
figure could not: whether a predicted change lands **on a real splice site** (a weakened or
strengthened one) **or in open sequence** (a cryptic site). A channel on an annotated site says so in
its table cell. When no channel reaches 0.01 no lane is drawn; the card says so in words.

The model is `SpliceMap` in `splicingEvidence.ts` (pure, tested); `SpliceMap.tsx` only draws it.

Two facts were checked against the live Broad service rather than assumed. BRCA1 exon 3
(ENST00000357654, reverse strand, 54 bp), variant chr17:43115729 (4th exonic base from the donor):
`DP_DG = −3` and `DP_AG = +50`. In genomic coordinates the donor is at the exon's low end and the
acceptor at its high end, and SpliceAI marks the **exonic** base next to each junction. So DP is
genomic (reverse-strand genes flip) and the annotated sites sit at `junction − ½` (donor) and
`junction + ½` (acceptor). `splicingEvidence.test.ts` pins exactly this case.

### Neighbouring exons and the SpliceAI window (same day)

- **Exon list.** `resolveSpliceProximity` now carries `nearbyExons` (the transcript's exons within
  2.5 kb of the variant, transcript-numbered, 1-based inclusive genomic coordinates). The map takes
  every exon's bounds from it, draws the neighbours muted, names the introns between them, and puts
  their annotated sites on the axis, so a delta can land on a neighbour's site (checked: an acceptor
  gain on the upstream exon's acceptor reads "Lands on the annotated acceptor"). Payloads from before
  the field fall back to the nearest exon alone; both paths are tested.
- **SpliceAI window setting** (Settings → Analysis → RNA splicing): ±50 / 200 / **500** / 1000 / 2000,
  persisted like other analysis settings, sent as `x-spliceai-distance`, clamped server-side to the
  service's 50–10,000 range, and passed to the Broad request (it is already part of the cache key).
  A cached analysis whose live SpliceAI score was computed under another window is treated as stale
  and recomputed (`isStaleCachedPayload`); a frozen-table score states no window and is left alone.
  The identity hash is deliberately untouched, so no stored row is invalidated by the new setting.
  The map widens to 1 and 2 kb steps to match.

- **Inline control.** The window is also a control beside the readings on the tab
  (`SpliceWindowControl`), so a reader weighing a splicing call does not leave it for Settings. A choice
  saves the default (same setting) and re-scores only that variant through a new
  `POST /api/v1/spliceai/score` (coordinate, build, window), which returns the fields the analysis
  would have carried (`liveSpliceAiFields`, shared with the pipeline). The control selects the window
  the score was actually computed under, not merely the saved default; a failed re-score keeps the
  score on screen, labelled with its real window, and says why.

### Verification

- `npx tsc --noEmit` and `npm run lint` clean.
- New tests: map geometry and strand flipping (BRCA1 case), failure reasons (client and tab),
  `formatDelta`, merged dbscSNV row, header chip. Updated: the channel-shift test now states the
  transcript-direction rule, and the header test no longer expects an alert.
- Rendered in light, dark and ~1000 px for a zero score, a PP3 case with a donor loss on the
  annotated donor, and a refused coordinate.

## Not done (follow-ups)

- **Engine**: splicing is not an engine input. If that changes, Walker 2023's "PP3 once" rule and
  the missense-BP4 interaction need implementing in `criteria.ts`, not in a surface.
- **Client cache**: a result already held in the browser's own history is not re-fetched when the
  window setting changes; it is recomputed when the server sees it (new analysis or reopen).
- **Strand**: when the resolver leaves the strand unresolved, SpliceAI's positions are not placed on
  the map (they are genomic and the side cannot be known).
- Walker 2023's full text could not be fetched in the first review (PMC captcha, Cell 403, Europe
  PMC rate-limited). Its SpliceAI bands were verified via the ClinGen Criteria Specification
  Registry, which quotes them ("a score equal to or >0.2" / "based on a score <0.1").

## Visualization follow-up — 4 October 2026

Addressed the SOD1 p.Ala5Val screenshots (SpliceAI maximum 0.14, donor gain at variant -2 bp,
variant at donor -59, exon 1 of 5). Classification remains unchanged: the engine still uses
missense predictors; the splicing score supports neither PP3 nor BP4.

| Finding | Resolution |
|---|---|
| Transcript start drawn as an AG acceptor | Shared map model excludes terminal splice sites, including neighbouring exons. The map names transcript start/end and annotated donor/acceptor without asserting sequence motifs. |
| Channel prose asserted an observed biological event | Descriptions explicitly identify model predictions; BP4 wording identifies a score below a threshold rather than claiming no biological change. |
| Mixed coordinate references | Variant marker names its donor/acceptor position; predicted-site labels and details use offsets from the variant in transcript direction. |
| Compressed score lane | 140-unit labelled score lane with full 0–1 range; optional 0–0.3 focus only when every plotted value fits. |
| Reporting window confused with map extent | Reporting window and map zoom are separately labelled; zoom never requests a new score. |
| Off-view predictions drawn as ordinary edge dots | Directional arrows, actual offsets and off-view text; native details retain exact scores and locations. |
| Channels hard to compare and far from map | Four shared 0–1 dot plots appear beside the map, including when geometry is unavailable. |
| Drawing floor implied negligible biological effect | Explicit display filter and optional small non-zero signals; zero is never given a plotted location. |
| Hero crowded by secondary operating points | Hero labels evidence ranges; authors' 0.5/0.8 marks remain in readings and the rail. |
| Accessible inspection | SVG titles plus native keyboard-accessible details; controls have visible focus indicators. |

Added regression coverage for terminal exon boundaries, small-signal invariance, focused score
axes, and off-view arrows. Updated the visualization plan and the local evidence-tab-refactor
skill with reusable coordinate, scale, display-state and accessibility contracts.

Validation: native Windows lint/TypeScript checks pass. Full Vitest suite: 279 files passed,
2 skipped; 3681 tests passed, 5 skipped. Fixture tab and rail reviewed in light/dark themes
and an approximately 800 px main column. The original charting plan was absent; the new plan
records this provenance rather than implying that its earlier contents were recovered.
Final affected-suite rerun: 77 tests passed; production client build passed (dependency annotation
and existing bundle-size warnings only).

## Independent DeepSeek review resolution — 4 October 2026

Reviewed by `opencode-go/deepseek-v4.1-flash` against commit `86cd200`. The first model entry,
`opencode/deepseek-v4.1-flash`, was unavailable. The reviewer independently ran 64 affected tests
and returned request-changes; the findings were checked against the implementation and resolver.

| Finding | Disposition |
|---|---|
| F1: focused axis could clip an unpositioned maximum | The claimed plotted clipping was not reproduced: plotted scores already gate focus. Hardened the gate to include every available score, including the payload maximum. Missing delta positions now have an omission notice and exact-value details. Regression tests cover mixed positioned/unpositioned scores and a re-score that exceeds the focused range. |
| F2: single-exon transcript requires a donor at its end | Rejected the proposed donor: a transcript terminus is not an internal splice junction. The server resolver already labels both ends terminal. Added model tests for single-exon transcripts, including contradictory legacy donor/acceptor labels; the client now normalizes these to terminal geometry without altering the SpliceAI rule or engine. |
| F3: transcript changes discard map view settings | Intentional reset of geometry-specific state, now documented and tested. Same-transcript re-scoring preserves zoom/focus unless scores require the full axis. |
| F4: coordinate wording differs between surfaces | Standardized channel positions to “from the variant”; zero remains unsigned. |
| F5: obsolete channels-row and canonical-mark CSS | Removed both unused selectors. |

The review's proposed single-exon donor must not be restored. No engine criteria or score
thresholds changed. Unknown locations are named as unknown rather than fabricated or hidden.

Resolution validation: lint/TypeScript and production client build passed; full Vitest suite
passed 3688 tests in 279 files (5 tests / 2 files skipped), including 84 affected tests.
The high-score/missing-position case was reviewed in light/dark themes and a narrow main column;
the focused option is disabled and the unpositioned 0.9 score remains in accessible details.

### Sources (existing audit)

- Walker LC, et al. Using the ACMG/AMP framework to capture evidence related to predicted and observed impact on splicing: recommendations from the ClinGen SVI Splicing Subgroup. *Am J Hum Genet* 2023;110:1046–1067. doi:10.1016/j.ajhg.2023.06.002
- ClinGen Criteria Specification Registry, SVI splicing criteria text citing Walker 2023: https://erepo.clinicalgenome.org/cspec/ui/svi/doc/643243096?version=2.0.0
- Jaganathan K, et al. Predicting splicing from primary sequence with deep learning. *Cell* 2019;176:535–548. doi:10.1016/j.cell.2018.12.015 — operating points from the Illumina SpliceAI README: https://github.com/Illumina/SpliceAI
- Jian X, Boerwinkle E, Liu X. In silico prediction of splice-altering single nucleotide variants in the human genome. *Nucleic Acids Res* 2014;42:13534–13544. doi:10.1093/nar/gku1206
- Abou Tayoun AN, et al. Recommendations for interpreting the loss of function PVS1 ACMG/AMP variant criterion. *Hum Mutat* 2018;39:1517–1524. doi:10.1002/humu.23626

## 11 October 2026 workspace follow-up

The map/records workspace, persistent selections, keyboard interaction and second-pass design
are documented in [MECHANISM_WORKSPACES_REVIEW.md](MECHANISM_WORKSPACES_REVIEW.md). This
presentation update retains the scientific contracts above and the existing splice map.
