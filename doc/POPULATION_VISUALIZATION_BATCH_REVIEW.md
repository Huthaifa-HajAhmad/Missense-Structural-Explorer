# Population-led visualization batch

14 October 2026. Four Evidence tabs implemented and browser reviewed: **Population Data, Predictors, AlphaGenome and Expression**. This follows the Energetics reference implementation and the reading sequence in [Visual storytelling review](VISUAL_STORYTELLING_REVIEW.md).

## Delivered screens

| Tab | What changed | Scientific boundary retained |
| --- | --- | --- |
| Population Data | Compact finding; logarithmic frequency comparison with frequency and source-specific AC/AN printed beside every plotted cohort; separate labelled engine-input row | AC/AN come from that cohort alone. The ancestry-group maximum does not inherit dataset counts. Zero and unavailable values have no log-axis position; sources are not summed. |
| Predictors | A categorical band matrix replaces slanted axis labels; native scores appear in a separate column. Voting and reference explanations follow the figure. The engine/reference disagreement remains above it. | Positions are published evidence bands, not pooled raw scores. Informational rows remain marked. No thresholds, reference choice, votes or engine criteria changed. |
| AlphaGenome | Compact rank and finding; directly labelled diverging contributions; the largest eight returned contributions appear first, with explicit count, family filter and Show all. Reading guidance follows the chart. | Expansion and filtering never change the full-vector domain or shares. Partial-vector coverage remains visible. A missing contribution is not zero. Signed contributions explain AVI, not biological direction or pathogenicity. |
| Expression | Review context is an expandable control with the selected disease/inheritance visible. Compact coverage finding precedes the tissue explorer. Measured TPM has zero-to-value stems and direct labels. | Adult and pediatric sources remain separate; the full source domain stays fixed through filters. True zero remains plotted. Missing data, sampling limits, provenance and exact source records stay inspectable. |

All four retain the source-record view, pinned-reading inspector and existing allele-scoped state. New labels, stems and separators are decorative; only value points participate in chart keyboard selection. Help controls share the title row at wider sizes. Chart regions scroll horizontally at narrow widths to preserve legible labels and categories; the document itself does not overflow.

## Verification

- `npm run lint` passed, including TypeScript, architectural boundaries, focus indicators and verification parity.
- Full Vitest: **362 files passed, 2 skipped; 4,638 tests passed, 5 skipped**. The interrupted initial full run did not finish and is not counted. The resumed full run completed.
- Initial focused batch: 97 tests passed. Following the final geometry scoping adjustment, the comparison, workspace, context integration and Perturbation regression suites passed all 39 tests.
- `npm run build:client` passed. Existing large-chunk warnings remain.
- Browser checks used the real `AppViews`, Evidence wrapper, current styles and inspector in `tools/evidence-preview`. The fixture selector now exposes Mixed, Partial, Zero and Missing for these first three tabs instead of silently reusing context fixtures.
- Geometry was checked at 1440, 800 and 390 px. No detected document overflow, overlapping SVG labels or labels outside their SVG bounds in the four Mixed screens. Light/dark visuals and narrow layouts were inspected; local horizontal chart scrolling is intentional.
- Population: keyboard pin, exact AC/AN inspector and source-record round trip; Zero leaves all frequencies unplotted, Missing retains provider-error labels.
- Predictors: keyboard-selected REVEL preserves 0.234, BP4, source and engine-use details across the source-record round trip; disagreement remains visible in the summary.
- AlphaGenome: eight/all-18 expansion and family filtering; partial vector displays three returned values, including genuine zero, and states 3 of 18 coverage; all-zero vector draws zeros; missing assessment draws no chart. A test verifies that a pin below the first eight survives collapse/expansion without mutating the scientific model.
- Expression: a zero TPM source-record pin survives return to the chart. Filtering the illustrative pediatric data to cohort 3 leaves the 0–36 TPM scale unchanged while showing the 29 TPM value. Adult/pediatric scales remain independent.

## Reviewed screenshots

All screenshots use **explicitly labelled illustrative data**, not a new live scientific result. The preview includes the production workspace and inspector but omits global navigation/search chrome. They establish rendering and interaction, not biological validity or a human usability study.

- [Population Data, light](C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/53f8dba9-dcef-4409-a197-f9b665bf79ed.png)
- [Predictors, light, REVEL pinned](C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/1d2cddd9-7948-428d-937a-45c23488f1f0.png)
- [AlphaGenome, dark, largest eight](C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/fc81a406-1b90-4b4d-bfa2-9f17cbd4412e.png)
- [Expression, dark, zero measurement pinned](C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/8f6fe1fb-bb35-4d37-866e-18e4609f26fb.png)

Minor final copy clarifies the population caption even when no point exists and includes inheritance in the collapsed Expression review context.

## Scope and remaining work

Existing [Evidence contracts](EVIDENCE_WORKSPACE_REVIEW.md) and [Context contracts](CONTEXT_WORKSPACES_REVIEW.md) remain authoritative. This pass changes presentation and visibility, not scientific rules or backend services. Existing unrelated working-tree changes were preserved. No commit or deployment was performed.

These four count as implemented and browser verified. The complete workspace rollout is still open. Human reader-comprehension validation, broader live-data sampling and the remaining workspace families are not claimed complete.
