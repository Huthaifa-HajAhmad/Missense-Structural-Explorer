# Predictors informational presentation review

The screenshot's MetaRNN, popEVE, ESM1b and Eigen dashes are missing readings in the supplied result, not benign calls. The comparison now prints source availability labels and separates voting tools from the three informational families. This does not establish whether an upstream database has a score for GATA4 p.Ser159Cys; a fresh provider lookup is outside this presentation change.

The comparison and native-scale views share the same structured informational summary with the inspector. Published bands, sequence preferences, other scores and missing readings have separate headings and selectable records. Family explanations also print availability rather than a dash.

No thresholds, engine criteria, voting membership or scientific classifications changed. Existing calibration sources and caveats remain in the shared evidence model.

Validation: npm run lint passed; full Vitest run passed (466 files, 6,064 tests; 2 files and 5 tests skipped). Focused predictor checks passed (63 tests). The browser check passed at 1440px and 800px in light and dark themes; screenshots are under .e2e/proof/predictor-polish-final. Screens use illustrative fixtures, not a fresh GATA4 provider response.


## Live retrieval follow-up (1 November 2026)

Confirmed GRCh38 8-11708788-C-G for GATA4 p.Ser159Cys through the live public dbNSFP API. It returned MetaRNN 0.73214996, ESM1b -5.5976105 and Eigen phred 4.822350978851318. The local saved analysis already contains these three readings; the screenshot predates that result. No parser correction was needed for them.

The displayed UniProt P43694 sequence maps to RefSeq NP_002043.2. Its published popEVE file contains S159C = -3.376. The public API's MANE row has no popEVE score; a different transcript row contains it, so taking an arbitrary transcript row is not a suitable fix.

The saved analysis records a slow predictor lookup (about 44 seconds) and a popEVE timeout. The progressive pipeline previously started the online fallback only within the base lookup, after predictor resolution. It now starts the protein-file lookup independently and publishes a returned score before the genomic and base lookups finish. The base lookup skips its duplicate online request when the progressive caller owns enrichment. A regression test keeps predictor resolution pending and confirms that popEVE survives expiry of the partial result.

A live run through the app's actual queryDbnsfpOrg and fetchPopEVEScoreOnline functions, followed by buildPredictorEvidence, returned all four numerical readings. Saved analyses were inspected read-only; none was overwritten. Existing completed analyses need a new analysis to acquire the score. No voting rule, threshold or tool membership changed.

Sources: https://query.dbnsfp.org/api/query (POST, variants: ["8-11708788-C-G"], genome_build: "hg38"); https://rest.uniprot.org/uniprotkb/P43694.json?fields=xref_refseq,cc_alternative_products; https://data.evemodel.org/popeve/v1.1/mutations/NP_002043.2.csv.


## Complete screen and cache recovery (1 November 2026)

The missing-score defect also affected restores: browser bundles could replay interrupted predictor lookups, and the server checked missing scores only inside its `available === true` branch. A shared, typed `hasInterruptedPredictorReadings` check now rejects interrupted base/popEVE results when their corresponding readings are absent. It retains completed provider misses. Browser restores keep structural artifacts while requesting fresh analysis; the server applies the same decision to persisted rows.

The app's normal refresh path completed during the browser verification. A read-only inspection of its persisted GATA4 result confirmed `available: true`, MetaRNN 0.73214996, ESM1b -5.5976105, Eigen phred 4.822350978851318, popEVE -3.376, and no pending model status. These are retrieved values, not constants added to the UI.

Presentation: the Comparison view and inspector share separate published-band, sequence-preference, other-score and unavailable sections. Score columns align; the inspector uses one column. Native score scales provides model-family groups, clickable source readings, explicit missing-result states and collapsible explanations. Tool membership and numerical thresholds are unchanged.

Browser proof `tests/proof/predictor-gata4.e2e.ts` takes a provider/saved-result snapshot from the committed, redacted fixture `tests/fixtures/predictor-gata4.json`, checks all four numerical readings, pins each from the actual table into the inspector, switches through Native score scales, Strength bands and Comparison, and captures 1440px/800px light/dark layouts. The live capture remains under `.e2e/` as regenerable evidence, but is no longer required to run the proof; this proof is explicitly opted into with E2E_PROOF=1. Results: `.e2e/proof/gata4-complete`.

Validation for this pass: full Vitest suite passed (467 files, 6,096 tests; 2 files and 5 tests skipped). Focused cache/server/UI checks passed (76 tests after final edits). Final lint and type checks passed after concurrent shared-file edits settled.

The dedicated `tools/predictor-proof` preview accepts a predictor-proof snapshot from session storage, validates its metadata and predictor/conservation fields once, and restores it after development-server reloads. This avoids silently replacing GATA4 with the default illustrative GZF1 example during concurrent work. It does not run in the product application.

The final dedicated browser proof passed with the actual saved GATA4 result at both widths and in both themes. All four readings and inspector selections passed.

## Review follow-up (2 November 2026)

The read-only review of this work surfaced four classes of defect; each is now fixed in the Predictors surface only.

1. **A timeout is not a completed miss.** `buildPredictorEvidence` now reads `conservationData.modelStatus` and labels an interrupted base, popEVE, ConSurf, GPN-Star or AlphaGenome reading **Timed out**, with the retry action and a reason that names the analysis budget. The table, the shared informational summary and the inspector all read that one availability object. A settled provider miss stays **No result**.
2. **The committed proof must run on a clean checkout.** The GATA4 input moved from the gitignored `.e2e/proof/gata4-input/result.json` to `tests/fixtures/predictor-gata4.json`; the live capture remains as local evidence. No score is invented by the test.
3. **Cache recovery must not break biophysics persistence.** The client bundle still drops an interrupted `analysisResult` so the core re-runs, but `useBiophysicalModeling` now persists a completed job when the result is absent instead of silently skipping it. A unit truth table locks the recovery predicate's base/popEVE, pending/timeout, completed-miss and legacy-payload cases.
4. **Presentation and traceability.** The shared summary uses named fields (`descriptive`, `preferenceSummary`, `preferenceCaveat`) instead of array indices; the Comparison card hides per-reading scores because its own unplotted list already carries them; codes are formatted once; headings now sit at h2/h3/h4 by surface; the family guide is open by default and uses the house disclosure chrome; CSS duplicates and the dead `prd-context-card` class are gone; the inspector's summary keeps one column and no double padding.

One pipeline detail from the review is also closed: the dbNSFP.org base path no longer issues a duplicate online popEVE request when the progressive caller owns enrichment. The online-first popEVE precedence is retained deliberately (it is what lets a returned protein-file score publish before the slow predictor resolves) and is now stated in the code comment rather than implied.

Validation after the review fixes: `npm run lint` passed; full Vitest suite passed (470 files, 6,140 tests; 2 files and 5 tests skipped); the GATA4 proof passed against the committed fixture at 1440px and 800px in light and dark themes, with the final screenshots under `.e2e/proof/predictor-gata4-review-final`.
