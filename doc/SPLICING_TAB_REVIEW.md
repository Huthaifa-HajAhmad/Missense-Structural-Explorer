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

## Not done (follow-ups)

- **Engine**: splicing is not an engine input. If that changes, Walker 2023's "PP3 once" rule and
  the missense-BP4 interaction need implementing in `criteria.ts`, not in a surface.
- **Payload**: SpliceAI failures are swallowed as `null`; the server should record why (rate limit,
  reference mismatch, timeout) so the tab can say "Provider error" rather than infer it.
- **Header chip**: `VariantHeader` still shows "Splice site · N bp" from `isNearSpliceSite` (≤ 5 bp,
  app-defined). It asserts nothing wrong but uses a local proximity flag.
- Walker 2023's full text could not be fetched in this review (PMC captcha, Cell 403, Europe PMC
  rate-limited). Its SpliceAI bands were verified via the ClinGen Criteria Specification Registry,
  which quotes them ("a score equal to or >0.2" / "based on a score <0.1").

## Sources

- Walker LC, et al. Using the ACMG/AMP framework to capture evidence related to predicted and observed impact on splicing: recommendations from the ClinGen SVI Splicing Subgroup. *Am J Hum Genet* 2023;110:1046–1067. doi:10.1016/j.ajhg.2023.06.002
- ClinGen Criteria Specification Registry, SVI splicing criteria text citing Walker 2023: https://erepo.clinicalgenome.org/cspec/ui/svi/doc/643243096?version=2.0.0
- Jaganathan K, et al. Predicting splicing from primary sequence with deep learning. *Cell* 2019;176:535–548. doi:10.1016/j.cell.2018.12.015 — operating points from the Illumina SpliceAI README: https://github.com/Illumina/SpliceAI
- Jian X, Boerwinkle E, Liu X. In silico prediction of splice-altering single nucleotide variants in the human genome. *Nucleic Acids Res* 2014;42:13534–13544. doi:10.1093/nar/gku1206
- Abou Tayoun AN, et al. Recommendations for interpreting the loss of function PVS1 ACMG/AMP variant criterion. *Hum Mutat* 2018;39:1517–1524. doi:10.1002/humu.23626
