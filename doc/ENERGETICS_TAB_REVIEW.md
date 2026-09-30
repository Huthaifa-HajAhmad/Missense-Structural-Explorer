# Energetics tab — scientific-integrity audit and redesign

Scope: the Energetics master view (`src/components/EnergeticsView.tsx`), its inspector rail
(`src/components/inspector/EnergeticsInspector.tsx`), the server paths that feed them
(`server/routes/biophysics/generation.ts`, `server.ts` queue worker, `server/services/stability/*`),
the client pipeline (`src/services/pipeline/foldxService.ts`), and every copy of the same claims
(report, text export, method table, attributions, provenance manifest).

Reference variant: **NAE1 p.Asp116Gly** (NM_003905.4, Q13564, 16-66823281-T-C), experimental
structure 1YOV:A. On screen before: FoldX +2.62 "± 0.00" (template not repaired, large structure);
DynaMut2 and DDMut "No result"; RaSP "Not covered"; ThermoMPNN −0.36; StabilityOracle −0.06; headline
"Calibrated probability of destabilization 24%, 90% conformal prediction interval [20%–29%]",
verdict "Moderate Misfolding Risk (Conflicting Stability)".

## Findings

| # | Severity | What was wrong | Evidence | Fix |
|---|---|---|---|---|
| 1 | High | The headline "calibrated probability", the "90% conformal prediction interval" and the per-engine "P: 91% [81–97%]" rows came from curves typed by hand. Nothing was fitted. | `tools/train_stacker.py`: `download_datasets()` is `pass`; homology filtering is a "simulation" that returns its input; `compute_venn_abers_bounds` is `pass`; the bins are literals under "We define realistic bin configurations". `stacking_config.json` also carries AUCs and a `fitted_date` with no fitting code behind them. | Removed from the tab, rail, report and text export. The finding now counts how many engines pass their own mark and gives their median ΔΔG and range. |
| 2 | High | DDMut and DynaMut2 read "No result" on every revisit, even after the endpoints were fixed. | On a FoldX cache hit, `/generate-mutant` responds after a 1.5 s race. A BioSig submission (whole-structure upload; DDMut also staggered 350 ms and followed through a redirect) almost never returns in that window, so the response said `pending` with no job id. The id arrived later with no queue job to carry it. `settleUnreachableRemoteEngines` then cleared both statuses, which resolve to `no-result`. | The cache-hit response now carries a `remoteSubmissionToken`. `GET /api/v1/remote-submissions/:token` holds for up to 75 s and returns the job ids. The client collects them before settling, so the ordinary pollers start. Tests: `server/routes/biophysics.test.ts`, `foldxService.test.ts`. |
| 3 | High | RaSP almost never showed a value, and "Not covered" was asserted without a lookup. | The queue worker looks RaSP up after FoldX has written its cache entry (`runner.ts` caches `rasp: null`), and the cache-hit path never called `runRaspLocal`. So every revisit served `rasp: null` with no reason, and `resolveEngineOutcome` turned that silence into "Not covered". | The cache-hit path now runs the indexed lookup, and persists only a real score. A RaSP null with no lookup reason is now "No result"; only the lookup's own miss is "Not covered". |
| 4 | High | RaSP coverage was described as proteome-wide (see follow-up 3: the proteome set can now be ingested). | `df_rasp_gnomad_clinvar.csv` (Zenodo 10.5281/zenodo.6835877) is the authors' experimental-structure set: 1,345 distinct UniProt accessions (counted in `ENERGETICS_AUDIT_AND_PLAN.md` §3.1). The 23,391-protein AlphaFold predictions are a separate download (authors' repository README). | The "not covered" reason, the engine summary, the method note and the attribution now state the 1,345-protein coverage. |
| 5 | High | RaSP was described as "ESM-IF1 embeddings + MLP trained on ~350k experimental datapoints, r ≈ 0.57 on S461". | RaSP is a self-supervised 3D CNN with a supervised head trained on Rosetta `cartesian_ddg` values (Blaabjerg 2023). The r value had no source. | Corrected in `MetricExplanations`, `attributions`, `engineStatus`; added a "Rosetta surrogate" caveat chip on RaSP values. |
| 6 | Medium | Wrong citations: DDMut on `10.1093/nar/gkac394` (2022), ThermoMPNN on a vendor docs page as "Pei et al.", StabilityOracle on this repository as "StabilityOracle Consortium". | DDMut is Zhou et al. NAR 51:W122 (2023), 10.1093/nar/gkad472. ThermoMPNN is Dieckhaus et al. PNAS 2024, 10.1073/pnas.2314853121. Stability Oracle is Diaz et al. Nat Commun 2024, 10.1038/s41467-024-49780-2. | Fixed in the shared table and attributions. The tab's duplicate table is deleted (the info buttons open the shared `ModelKnowledgeModal`); `methodCitations.test.ts` now asserts that no copy exists. |
| 7 | Medium | "Engine-specific calibrated cut-points" in the table foot. | Every ΔΔG mark is local: THRESHOLD_NOTES already said FoldX publishes none; the ±1.0 for the learned engines has no published source. | Marks are drawn dashed on each ruler, labelled "local", and listed in the rail with that wording. |
| 8 | Medium | The report and plain-text export printed "P = 88%, 95% CI: [+1.20 kcal/mol, +2.50 kcal/mol]": probability bounds formatted as energies, under "Calibrated Thermodynamic Consensus". | `ReportBlocks.tsx`, `reportStatus.ts`. | Both now print the tab's agreement sentence (`energeticsAgreementText`), marked "not an ACMG input". |
| 9 | Medium | The report and export printed DynaMut2 and DDMut in their native sign under "Positive ΔΔG indicates destabilisation". | Both tools report negative = destabilizing (Rodrigues 2021; Zhou 2023). | Normalized through `toCanonicalDdg` on both surfaces; the test now expects −1.40 for a native +1.40. |
| 10 | Medium | The rail printed 298.15 K, pH 7.0 and "±1.20 kcal/mol (ProTherm)" for every run, plus "RaSP snapshot" and "Embedding model: VESM_150M_v1", which the server stamps on every run whether or not either was used. | `EnergeticsInspector.tsx` constants; `generation.ts` hard-codes both provenance strings. | Removed. The rail's sources come from the payload, and a dataset is named only when its engine returned a value. The error note now cites DDMut's own RMSE (1.84 kcal/mol on SM420, Zhou 2023). |
| 11 | Medium | The provenance manifest claimed `stackerCalibration: "v1.2 (Calibrated Multi-Model Logistic Stacking)"`. | See finding 1. | Removed from `provenance.ts` and the About page labels. |
| 12 | Low | FoldX "± 0.00 kcal/mol" read as an error bar. | It is the spread across 5 BuildModel runs on one template. | Stated as "Mean of 5 BuildModel runs; run-to-run spread 0.00 kcal/mol, not an error bar." |
| 13 | Low | An AlphaFold pLDDT caveat was applied to experimental structures. | pLDDT describes an AlphaFold model. | Applied only when the template is AlphaFold or its source is unknown. |
| 14 | Low | An unrepaired FoldX template was a footnote. | The FoldX authors recommend RepairPDB before BuildModel. | "Unrepaired template" caveat chip on the row; the summary names it when the destabilizing engine carries it. |

ΔΔG feeds no ACMG criterion (`server/services/prediction/acmg/` reads none of it), so no finding
changed a classification and no owner decision was needed. The screen now says "Not an ACMG input".

## Effect on the reference variant

| | Before | After |
|---|---|---|
| Headline | "24%" calibrated probability, [20%–29%] interval | −0.06 kcal/mol, median of 3 engines (range −0.36 to +2.62) |
| Verdict | Moderate Misfolding Risk (Conflicting Stability) | **Engines disagree**: FoldX (+2.62) is past its destabilizing mark; the other 2 are not. FoldX ran on an unrepaired template. |
| DynaMut2 / DDMut | No result (the job ids were lost) | Running, then their value (ids collected through the token) |
| RaSP | Not covered (never looked up) | Looked up on every cache hit; "Not covered" only when the index says so, with the 1,345-protein coverage stated |

## Design

- The tab follows the three-tier shape: a finding card (agreement chip, median figure, one sentence, an engine tally by call, the destabilization ≠ pathogenicity principle, and a fact strip ending in the engine record), then one readings table. Each engine's canonical ΔΔG sits on a shared −3 to +5 kcal/mol axis with its own dashed local marks; an engine without a value spans its reason across the row.
- The rail is an Evidence Lineage trace: structure → engines → marks → summary → engine record. It lists each engine's mark beside this variant's value, the engines without a value (raw server text behind "Technical detail"), method notes, sources, DOIs and the unit switch.
- One model (`src/shared/energeticsEvidence.ts`) feeds the tab, the rail, the report and the export. Styles are in `src/styles/energetics.css` (`nrg-*`, tokens only). Checked in light, dark and an 820 px viewport.
- The existing product vocabulary is US "destabilizing" (`engineStatus` labels, the guard tests). The new copy keeps it, so one screen does not mix spellings.

## Verification

- `npm run lint` (boundaries, focus indicators, verify parity, tsc): passes.
- Full `npx vitest run`: see the commit message for the numbers.
- New tests: `src/shared/__tests__/energeticsEvidence.test.ts` (the NAE1 contract); rewritten `EnergeticsView.test.tsx` and `EnergeticsInspector.test.tsx`; RaSP no-lookup cases in `engineStatus.test.ts`; token and RaSP cache-hit tests in `server/routes/biophysics.test.ts`; token collection in `foldxService.test.ts`.
- Not verified live: BioSig and Zenodo are blocked by this environment's egress policy, so the BioSig fix is tested with mocked submissions and has not been tried against the real servers.

## Follow-ups (second pass)

1. **Done: retired `computeCalibratedConsensus`, `stacking_config.json` and `train_stacker.py`.** The consensus is now `computeStabilityConsensus` (`src/shared/thresholds/consensus.ts`). It is a thin, server-safe wrapper over the tab's own rule in `energeticsEvidence.ts`, with a closed verdict set: "Destabilizing (Engines Agree)", "Engines Disagree", "No Destabilization Predicted", the single-engine variants, "Moderately Destabilizing (Engines Agree)" and "Insufficient Biophysical Data".
   - The server stores the verdict plus `consensusEnginesCounted`, `consensusEnginesDestabilizing` and `consensusMedianDdg`, and no longer emits a probability.
   - The client hook recomputes the verdict whenever a remote engine arrives. Before, the stored verdict froze at FoldX commit.
   - The JSON export carries the agreement fields and a `canonicalDdg` block in one sign convention. The raw per-engine keys are unchanged for existing readers.
   - The old probability fields stay optional and `@deprecated` in the schema, so cached payloads still parse.
   - A fix found in passing: engines that all sat in the moderate band used to read "Engines Disagree"; they now read "Moderately Destabilizing (Engines Agree)".
2. **Done: removed the Insights "Predictor Local Calibration & Uncertainty" panel.** Its per-context AUCs (`protein_class_calibration.json`, `uncertainty.ts`) had no source. `doc/CALIBRATED_STACKING.md` now records the retirement, and what a real calibration would need.
3. **Done in code, data pending: RaSP proteome coverage.** The builder ingests the authors' proteome-wide PRISM files with `npm run migrate:rasp -- --proteome <dir>`. Rows are tagged by source, and the AlphaFold (UniProt-numbered) row is preferred at lookup. Index schema v3 still reads v2. Coverage now comes from the index's own record. The download host (sid.erda.dk) is blocked in this build environment, so an operator must fetch the zip; see `doc/RASP_DATA.md`. The ingester was built from the authors' writer code (`rasp_to_prism` → PrismData) and tested on files in that format, but not yet on the real download.
4. **Done: provenance stamps.** `generation.ts` no longer writes `raspDatasetSnapshot` or `vesmModel` on every run. `energetics.raspSource` names the table that actually served a value.

## Sources

- Schymkowitz J et al. The FoldX web server. Nucleic Acids Res 2005. doi:10.1093/nar/gki387
- Rodrigues CHM, Pires DEV, Ascher DB. DynaMut2. Protein Sci 2021;30:60–69. doi:10.1002/pro.3942
- Zhou Y, Pan Q, Pires DEV, Rodrigues CHM, Ascher DB. DDMut. Nucleic Acids Res 2023;51:W122–W128. doi:10.1093/nar/gkad472
- Dieckhaus H, Brocidiacono M, Randolph NZ, Kuhlman B. ThermoMPNN. PNAS 2024;121:e2314853121. doi:10.1073/pnas.2314853121
- Diaz DJ et al. Stability Oracle. Nat Commun 2024;15:6170. doi:10.1038/s41467-024-49780-2
- Blaabjerg LM et al. Rapid protein stability prediction using deep learning representations (RaSP). eLife 2023;12:e82593. doi:10.7554/eLife.82593; data doi:10.5281/zenodo.6835877
