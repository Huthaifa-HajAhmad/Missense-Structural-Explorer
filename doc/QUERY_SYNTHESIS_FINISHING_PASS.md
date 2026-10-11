# Query and synthesis finishing pass

2026-10-11. Bounded implementation following the query-page discussion and the four findings in `REVIEW_WORKSPACES_SENIOR_CODE_REVIEW.md`.

## Design constraint

The owner explicitly values equal panel heights and aligned edges. The existing full-height service/pipeline rail, stretching query form, recent-analysis tray and open AI writing surface remain. The proposed compact service rail and collapsed AI field were not adopted after that clarification.

Within that frame, gene and protein/cDNA notation now share one route; coordinates have their own alternative route. An intrinsic grid stacks them when their available width is insufficient. UniProt is an optional Protein reference disclosure, automatically shown for populated references, including history selections. Clearing a reference leaves the disclosure open and retains focus. One example is visible per route; every existing accepted example remains available under More formats. Input parsing, required-field derivation, assembly annotations, submission, pipeline state and history behavior are unchanged.

## Findings addressed

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| High | `src/styles/workspace.css:28` | The shared pane hid Insights overflow. | The pane containing Insights scrolls vertically on desktop; the outer layout retains scrolling on narrow screens. | Reachability: the complete reading must be accessible by wheel, not just programmatic focus. |
| Medium | `src/components/insights/InsightsScreen.tsx:135`, `src/components/inspector/InsightsInspector.tsx:98` | The consumers removed the suffix from only one side of a criterion lookup. | Both match the full recorded criterion code. | Consistency: dedicated strength labels agree with the records view for PP3_Moderate and PP3_Strong. |
| Medium | `src/components/LiteratureView.tsx:497` | Unsupported notation offered an active zero-match variant filter. | That group is omitted, the unavailable check is stated, and remaining groups describe gene mentions only. | Meaning: an unsupported check is not an observed absence. |
| Medium | `src/shared/insightsEvidence.ts:612` | PM2's glossary described Moderate strength. | It describes Supporting, matching the existing engine and record. | Consistency: presentation agrees with the implemented rule; no classification rule changed. |
| Low | `src/components/VariantSearchPanel.tsx:1215` | Required inputs and optional references carried similar weight; all examples were exposed at once. | Coherent alternative routes, optional reference disclosure and progressively revealed examples. | Hierarchy: the first action is clearer while the owner's aligned panel geometry remains. |

## Verification

- 177 focused tests passed across 11 files: query parsing, examples, build selection/mismatch, pipeline, Insights, Literature, Report and inspector provenance.
- Added regressions for map/inspector/record strength parity, PM2 glossary parity, unsupported literature notation, example disclosure and populated-reference editing. The preexisting AI-field test now checks that field's visibility rather than forbidding every disclosure on the page.
- `npm run lint` passed, including architectural boundaries, focus indicators, verify parity and TypeScript.
- Production build passed, with the existing large-chunk warning. The final reference-disclosure adjustment is also covered by the client build and focused tests.
- Scoped `npm run review:preview` inspected the review target selection; this was a diff preview, not a model-generated approval.
- Added a real-wheel desktop scrolling check to `tools/review-preview/check.mjs`.

## Browser verification, 2026-10-11

The Synara browser became available and was used against this repository's Vite server on port 5187. Port 5173 belonged to another application. The labelled fixture harness in `scratch/query-synthesis-browser/` renders the actual AppViews, query form, stores, synthesis tabs and inspectors, with illustrative provider responses and the application's real input styling.

- At 1500 × 1100, Query's two outer columns both started at 192.25px and ended at 1031.25px: exactly matching edges and 839px heights. The left column includes the recent-analysis tray, as in the original layout.
- Query, Insights and Literature fit at 390px without page overflow. Query also fit at 800px and retained its two intrinsic input-route columns where space allowed. Literature source records fit at 800px.
- A real wheel scroll reached the bottom of desktop Insights: client height 1006px, content height 2041px, scrollTop 1035px, computed vertical overflow `auto`. The final “Still needed to decide” section was visible.
- Additional protein and coordinate examples were opened and applied. Selecting GRCh37 rewrote the coordinate notation to explicitly state that build; the coordinate route released the gene and protein fields' required state.
- Protein reference supports native Enter toggling and Tab into its input. Typing and clearing a reference kept the field open. The Services/Pipeline tabs supported arrow-key selection and focus.
- PP3_Moderate and PP3_Strong displayed the correct strength in the map, selected inspector and criterion records. PM2's opened guide described Supporting.
- Unsupported cDNA notation omitted the variant-mention filter and explicitly stated that the check was unavailable. Gene filtering retained matching loaded papers. The reading desk showed eight rows; Source records showed all 25 loaded rows.
- Light and dark rendered surfaces were visually inspected. Report's heading and page fit were also checked at 390px.

No application corrections were needed after the rendered checks. Live provider retrieval/authentication and animation replay at 10% speed were not exercised. The preview's mocked states are not clinical evidence.

Code, component and rendered layout checks: **Approve**.
