# Species and models presentation fixes

Review context follows the Expression disclosure, with separate system count and disease name. Removed the repeated interpretation sentence and moved partial phenotype coverage into the explorer notice.

Mouse screens show the returned top-level IMPC categories beside each local system grouping. These are broad categories, not detailed measurements. The existing provider response does not contain procedure, allele, sex or age details. Curated phenotype annotations are a separate source and cannot replace those measurements.

Alignment summary and records have separate surfaces. The curated phenotype introduction separates its label, disease and interpretation limit. Species rows distinguish displayed terms from summary totals. A positive summary total with no resolved terms now opens an explanation rather than an empty area.

No classification rules or data retrieval changed.

Validation: 67 focused tests passed, including the context workspace integration checks. The browser proof passed in light and dark themes at 1440px and 800px. Initial lint passed. The full Vitest run was stopped after failures outside this change and heavy machine slowdown; it did not pass.

## Senior review verification and fixes

Confirmed and fixed the literal question-mark separator, untested category contents, text chevrons, duplicate summary CSS, singular summary wording, repeated coverage notices, alignment source-message placement, inconsistent missing-category wording, all-source error headline, repeated incomplete symbols, and disabled-workspace review rendering. The mouse category unit test covers significant, non-significant, mixed and unreported states. Phenotype tests now live in their own file and cover one and many unresolved summaries. The browser proof explicitly selects Mixed, checks its disease, seeds an illustrative unresolved zebrafish record, opens it, and checks that the explanation is visible. The screen note is shown once rather than repeated in table captions and footer.

Attribution checks: ContextExplorer tab styling, the shared record-toolbar CSS, Expression assertions, and the Gene-disease pin test rewrite predate this thread. They are excluded from this PR and left untouched in the shared checkout. The pin-test change replaces a restore action with a persistent-inspector behavior check; this thread does not change that product behavior or claim to restore its coverage.

Current validation on the isolated PR tree: all 42 focused tests passed; lint (including TypeScript) passed; the browser proof passed for the unresolved zebrafish disclosure and phenotype views at 1440px and 800px in light and dark themes. Screenshots were inspected. The browser proof now reselects and asserts the Species view before every responsive capture, preventing a reset to another tab from passing unnoticed. The full suite is recorded separately in the PR validation notes.
