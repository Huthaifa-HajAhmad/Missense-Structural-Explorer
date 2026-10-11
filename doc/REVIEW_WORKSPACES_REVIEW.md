# Insights and Literature workspace review

Second design pass, 2026-10-11, following the local evidence skill's `references/second-pass-design.md`. Existing scientific contracts remain in `INSIGHTS_TAB_REVIEW.md`, `LITERATURE_TAB_REVIEW.md`, and `LITERATURE_SCREENING_REVIEW.md`. The senior review and subsequent corrections are recorded in `REVIEW_WORKSPACES_SENIOR_CODE_REVIEW.md`.

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

The original implementation passed 4,563 tests and 29 browser checks before senior review. Those checks missed the scrolling and suffix-strength defects identified in the review. The reviewed changes and fixes were subsequently isolated onto the current `origin/main` baseline (`0bfa87b`) without copying unrelated concurrent work.

Verification of the corrected workspaces:

- **47 browser checks passed**, with no runtime errors. The matrix includes real wheel reachability for the map, guide and summary at all three widths; narrow primary panes expanding into page scrolling; registered focus targets; visible 44px review actions; closed disclosures in print; suffixed strength labels; and unsupported notation. The in-app browser host was unavailable, so the repository's local Playwright/Edge checker performed the rendered review.
- All three required geometry suites passed: **116 header, 241 functional-track and 34 landscape assertions**.
- The focused workspace/security regressions passed **18 tests**. Additional loaded-set helper tests and existing component/model assertions are included in the full suite. Download tests read the actual BibTeX, RIS and CSV blob contents.
- Lint passed architectural boundaries, focus indicators, verify parity and TypeScript. Deployment tests passed **15** cases; evidence-context import tests passed **4**. The production audit gate passed with no critical advisories; it still reports existing moderate/high advisories.
- The first full latest-main run passed **4,726 tests**, with one existing structural-disruption test timing out and five tests skipped. The isolated worktree initially lacked the original Python environment. After linking that existing environment, all five structural-disruption tests passed without changing their assertions or timeout. A full coverage run follows this check; the PR validation record contains its final result and the clean-clone CI outcome.
- The client production build passed. Windows denied the native esbuild executable's output writes in the isolated worktree. The same server, worker, admin and benchmark bundles compiled successfully through esbuild's `write:false` API and were written by Node; required runtime data was copied. PR CI runs the standard full build on Linux. The client retains its existing large-chunk warning.

Three independent senior reviewers and a bounded follow-up closure reviewer used `opencode-go/deepseek-v4.1-flash`. The closure review found no confirmed remaining blocker. Its narrow-scroll hypothesis was resolved by the expanded browser assertions; the generic error icon and provider-settings action were separately checked in `ClinicalInsightsCard.tsx`. Raw logs and screenshots remain local under `scratch/`.

## Limits

- This pass adds no literature quality metric, interpretation of paper conclusions, ACMG criterion, or clinical rule. Existing cut-points and citations are unchanged; see the earlier scientific reviews for primary sources.
- The evidence-direction map uses three ordinal lengths and labels the full recorded strength. Strong, Very strong and Stand-alone share a drawn length. Absence and pending states are named in text and are never treated as benign.
- Paper inspection covers loaded records. A selection absent from a subsequent query is identified as unavailable in that result; the app does not preserve an old abstract as if it belonged to the new search.
- The browser matrix uses fixtures and mocked responses; live retrieval and provider authentication are not verified here.
- Per-run synthesis directions and narrative timing provenance remain the documented upstream follow-ups from the first Insights review.
