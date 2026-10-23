# Workspace redesign follow-through

The supplied references establish a quiet canvas, distinct working surfaces, readable navigation, restrained accent colour, and clear separation between page context and actions. Apply that grammar to the existing scientific workspace while preserving evidence semantics and its light/dark tokens.

## Current grammar

The Search page ("Analyse a variant.") is the reference every view follows.

- **Page heading**: a serif title with a clay full stop (`<span aria-hidden="true">.</span>`, so the accessible name has no trailing punctuation), a one-line lede, and page-wide actions beside it. Search, About and Console use it.
- **Panels**: bordered, `--cs-workbench-radius`, a header strip carrying a mono index (`.workbench-index`, `01`, `02`) and a 13px/600 title, then the body.
- **Tabs**: ruled underline tabs (`.workspace-tabs`, from `components/ui/WorkspaceTabs.tsx`). Plain labels sit on the section's hairline, and the selected one is inked with a 2px clay rule on that hairline. There's no fill, box or pill, and the weight doesn't change with selection. A row that hosts tabs aligns to its end and draws the hairline itself (`.evw-navigation`, `.review-navigation`); never pad between the tabs and that line. The Console stream tabs (`.cx-tab`) follow the same rule.
- **Header actions**: bare glyphs. A fill appears only on hover or press, and keyboard focus draws one clay outline.
- **Sidebar**: an index rail. Labelled zones are numbered by a CSS counter (`01 Evidence & modelling`), sub-pages hang off square tree connectors, and the current page is a cursor: a clay bar plus a faint tint, not a raised chip. A nested current page is marked by its clay connector. The About workspace map numbers zones the same way: Search and the pinned tools are unnumbered.
- **Forms**: fields wear the composer's box (`.qe-input`, `.qe-select`). Field states are a toned 6px dot plus quiet text (`.qe__kind`). Only a warning gets a soft amber chip.

## Shared surface hierarchy

There are two tones, with the Search composer as the reference. Every panel body is the bright surface. Every panel head or foot strip (section headings, card heads, table heads, readouts) wears `--cs-workbench-header-surface`, which is also available as the `bg-cs-workbench-header-surface` utility.

- `--cs-panel-body`: the body of every panel, primary or context (inspector, Search monitor, Console detail).
- `--cs-workspace-card`: raised selected readings inside a panel.

A context panel is told apart by its position and its header strip, not by a darker body. The former `--cs-workspace-context` token filled whole panels with `--cs-surface-2`, a third sand tone outside the grammar, and is retired. `--cs-surface-2` remains for small insets: chips, pressed states, code.

Dividers between items that can wrap (the parse ticket cells, the empty-state topic column) are drawn as leading and top box-shadows clipped by their container. A wrapped item then gets a row rule, never an orphan vertical line.

## Regression checks

- `tests/workbench-consistency.e2e.ts` walks 16 populated workspaces in both themes. It asserts that every inspector body equals the primary panel body and that its `.inspector-heading` exists and wears the wash. Fixtures are illustrative, not evidence of live provider correctness.
- `tests/shell-surfaces.e2e.ts` pins the sidebar contract (one current page, a cursor tint rather than a chip, a legible tree) and the stacked Literature panels.
- `tests/workspace-utilities.e2e.ts` covers Console streams at 390 × 667 and 844 × 390, header-action focus in both themes, and every tour step at short and narrow sizes.
- Unit tests pin the parsed-field grammar (`VariantSearchPanel.queryForm.test.tsx`) and the Console's heading structure and `/` shortcut (`DevConsolePanel.test.tsx`).

## Further design opportunities

- Prioritize header controls when long variant identifiers, notices, and account controls compete for space.
- Offer a compact/comfortable density preference consistently across data-heavy workspaces.
- Keep source labels, unavailable-state explanations, and inspector selection feedback consistent as new evidence views are added.
