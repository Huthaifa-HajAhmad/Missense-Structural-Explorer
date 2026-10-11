# Insights and Literature workspace review

Second design pass, 2026-10-11, following `doc/MECHANISM_WORKSPACES_REVIEW.md` and the local evidence skill's `references/second-pass-design.md`. Existing scientific contracts remain in `INSIGHTS_TAB_REVIEW.md`, `LITERATURE_TAB_REVIEW.md`, and `LITERATURE_SCREENING_REVIEW.md`.

## Result

Insights leads with the recorded classification and an interactive evidence-direction figure. Criterion records and the condensed written summary have named views. Selecting an area keeps its reading in the inspector while navigating between views or leaving and returning to Insights. The optional scale and combining-rule explanation no longer displace the figure. The exact strength is written next to each counted code; lengths represent three ordinal groups (Supporting, Moderate, Strong and above), never probabilities or additive votes. Stability remains mechanistic context and has no pathogenic/benign direction.

Literature leads with the query finding and a loaded-set coverage figure. Its three disjoint categories count literal mentions in titles and abstracts, including curated additions, with each denominator shown. Selecting a category changes display filters only. The Reading desk retains the existing attention-tier default and shows up to eight matching papers; Source records exposes all matching loaded papers. Search, refinements, report pins, pagination and the search trace remain available. Citation exports serialize the actual displayed list; the separate shortlist export still covers tiers 1–4 across the loaded set.

Selecting a paper keeps its title, identifier, reading tier, report inclusion, quoted observations, and abstract available in the inspector. A hidden selection carries an explicit notice. “Show selected source record” switches to records, clears display filters and focuses the source; ordinary view switches do not move focus to a reading. Inspector selection and adding a paper to Report are distinct actions. New analysed alleles reset review state.

## Findings and fixes

| Severity | Finding | Fix |
| --- | --- | --- |
| High | Insights inspector built the model with `stability: null`, although the main tab derived the current consensus. | Both consume the same extracted `deriveConsensus` helper and receive the same live stability inputs and evidence-loading state. The inspector also receives the narrative fallback flag. |
| High | Population bars always used Supporting length, including BS1 and BA1. | Resolve the display group from the existing `codeWeight` function; show the exact strength beside the code. Classification and criterion strengths are unchanged. |
| Medium | Full fixed-width inspector squeezed these workspaces into unusable phone columns. | Insights and Literature now opt into the shared responsive workspace layout. |
| Medium | Inline-size containment plus automatic margins collapsed the Insights figure's width. | Give the contained reading surface an explicit full inline size. |
| Medium | Paper identifier copy claimed success without awaiting the clipboard and ignored failures. | Await copying, show success only after it resolves, and display failures inline. |
| Medium | Loading replaced an already available Insights model with a generic spinner. Every analysis error was described as missing API configuration. | Keep partial evidence visible with a pending statement; initial loading uses a layout-shaped skeleton. Print the actual error. |
| Low | The adjacent molecular-chart integration test gave a lazy chart stack only one second to appear during the full suite/build load. | Use a bounded ten-second DOM-query wait for the real chart; retain all keyboard, pin and record assertions. The file passed standalone before this timing correction. |
| Low | Paper-detail IDs stripped punctuation and could collide. | Encode the complete publication identifier. |
| Medium | A recorded computational code with missing voting inputs could claim “Nothing is counted” and disappear from the directional figure. | Preserve the engine record, draw its recorded strength and explicitly say that its voting inputs are unavailable. |
| Low | Multiple cards, uppercase labels and repeated metadata competed with the figures. | Quiet bibliography rows, restrained semantic colors, serif classification/finding display using the existing font, sentence-case figure headings, and disclosures for repeated method details. |

## Verification

The preview renders the actual `AppViews`, shared wrapper, stores, tab components and inspector. Illustrative publications and mocked responses exercise dense (25 records plus 11 more), sparse, missing, degraded, failed-provider and new-allele cases. They are explicitly labelled fixtures, not clinical evidence. NAE1's underlying scientific fixture is reused from `src/shared/__tests__/fixtures/splicingReference.ts`.

`tools/review-preview/check.mjs` checks selection, persistence across remounts, explicit focus transfer, focus retention while typing, loaded-set denominators, bounded reading/export behavior, pagination, state resets, and overflow at 1500, 800 and 390 pixels. Screenshots cover light and dark themes and narrow source records. Browser results and screenshots are written to `scratch/review-preview/`.

Final verification passed 4,563 tests across 358 files, with 5 tests and 2 files skipped. The final focused regression suite also passed all 77 tests, including the adjacent molecular workspace's lazy-chart interaction checks. Lint (architectural boundaries, focus indicators, verify parity and TypeScript) and the production build passed; the build retains its existing large-chunk warning. The expanded browser matrix passed 29 checks with no runtime errors. The in-app browser host was unavailable; the repository's local Playwright/Edge checker performed the rendered review. The interrupted last full-suite run produced no result; only that unfinished check was rerun on continuation. Its successful result is saved in `scratch/review-resumed-tests.log`.

## Limits

- This pass adds no literature quality metric, interpretation of paper conclusions, ACMG criterion, or clinical rule. Existing cut-points and citations are unchanged; see the earlier scientific reviews for primary sources.
- The evidence-direction map uses three ordinal lengths and labels the full recorded strength. Strong, Very strong and Stand-alone share a drawn length. Absence and pending states are named in text and are never treated as benign.
- Paper inspection covers loaded records. A selection absent from a subsequent query is identified as unavailable in that result; the app does not preserve an old abstract as if it belonged to the new search.
- The browser matrix uses fixtures and mocked responses; live retrieval and provider authentication are not verified here.
- Per-run synthesis directions and narrative timing provenance remain the documented upstream follow-ups from the first Insights review.
