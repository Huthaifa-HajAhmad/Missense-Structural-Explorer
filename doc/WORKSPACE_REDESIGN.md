# Workspace redesign follow-through

The supplied references establish a quiet canvas, distinct working surfaces, readable navigation, restrained accent colour, and clear separation between page context and actions. Apply that grammar to the existing scientific workspace while preserving evidence semantics and its light/dark tokens.

## This pass

- Sidebar: readable sentence-case group labels, larger navigation labels, tighter row rhythm, and a sans-serif wordmark.
- Header: consistent search-field geometry and visible utility-button surfaces.
- Console: a page title and purpose before the controls, a contained workspace surface, and more space for metrics.
- About: simplified hero surface and reduced excess spacing; removed the decorative accent stripe and animated logo.
- Command palette: larger search and result rows, sentence-case group headings, and more usable list height.
- Tour: clearer heading hierarchy, more comfortable content spacing, and a distinct action footer.

## Shared surface hierarchy

Three semantic tokens express two surface roles without changing scientific colours:

- `--cs-workspace-primary`: the primary analysis surface.
- `--cs-workspace-context`: the recessed inspector, Search monitor, Console detail panel, and empty-state guidance.
- `--cs-workspace-card`: raised selected readings inside the context surface.

The tokens reference the existing accessible light/dark palette. Figure headers use the shared header wash. Sidebar edge, brand, group, and footer separators establish navigation boundaries without adding a heavy frame. Status, selection, and scientific chart colours retain their existing meanings.

## Review fixes

- Header actions use an explicit class shared by ordinary buttons, Jobs, and Account triggers. A real focus-visible outline remains independent of decorative shadows.
- Compact Console layouts scroll the workspace and reserve usable log/inspector height instead of collapsing the log to zero.
- Every tour card mode is constrained to the viewport. The content scrolls while the footer retains its height.
- Browser regression checks cover both themes, signed-in header actions with stubbed account responses, all Console streams at 390 × 667 and 844 × 390, and every tour step at 667 × 400 and 390 × 667.
- The populated fixture walkthrough checks primary/context separation across 16 workspaces in both themes. Fixtures are illustrative, not evidence of live provider correctness.

## Further design opportunities

- Prioritize header controls when long variant identifiers, notices, and account controls compete for space.
- Offer a compact/comfortable density preference consistently across data-heavy workspaces.
- Keep source labels, unavailable-state explanations, and inspector selection feedback consistent as new evidence views are added.
