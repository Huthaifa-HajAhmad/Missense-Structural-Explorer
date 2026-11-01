# Expression UI refinements

## What changed

- **Shared chrome stays put.** The navigation, the review-context control and the panel start at the same height in all four views. The source summary (the "Highest in …" block) now sits inside the panel and shows only in Sampling & coverage, or when a section has nothing to plot.
- **Review context** is one collapsed row: the system count ("All systems", "1 system", "2 systems") and the chosen disease. The chevron is drawn with CSS, not a text character.
- **Toolbar.** Search, system filters, Show all and the record count share one row and one baseline. The count no longer takes its own full-width row.
- **Chart.** Row names have room on the left. The right side only holds the value text ("145.6 TPM"), so it is 112px wide instead of up to 245px. This removes the empty strip and the extra horizontal scroll at 800px.
- **Coding map.** It names the selected annotation transcript (blank names are ignored) without claiming transcript-specific expression. The variant row is highlighted in the exact-value table. On a narrow screen the map scrolls so the variant's region is in view.
- **Provenance** is a two-column table with a collapsed release line per source. Rows are 44px tall. The last row has no bottom rule.
- The reading guide and the search field fill the card. They have no `ch` cap, on purpose.

No measurements, thresholds or classification rules changed.

## Known limits

- The Adult RNA / Pediatric RNA switcher is lower in Sampling & coverage than in Tissue explorer, because Sampling & coverage opens with the summary. The chrome above the panel does not move.
- The Species rail still lists provenance as a stack. Only the Expression rail uses the table.
- The interpretation boundary ("Context only. No ACMG criterion is added or changed.") is in the rail. When the rail is stacked below the content (narrow screens), it is far from the top. It was removed from the compact summary on purpose so each fact appears once.
- The coding map is a fixed 900px wide. It does not stretch on wide screens.

## Verification

- `npm run lint` (boundaries, focus indicators, verify parity, `tsc --noEmit`): passes.
- Vitest, `src/components/evidence`, `src/components/inspector`, `EvidenceContextTabs` and `src/shared/__tests__`: 147 files, 2,133 tests pass (run on the branch rebased onto current `main`). New tests cover the singular and plural system count, the summary's place in the panel, the missing scale caption, the blank-transcript fallback, and the provenance table.
- E2E, `tests/expression-workspace.e2e.ts`: 3 of 3 pass on a fresh Vite server (`APP_URL=http://localhost:3055`). It checks that the navigation, review control and panel tops are identical across the four views at 1440, 800 and 390px, in light and dark.
- Browser measurements at 1753px and 800px on the illustrative "Dense expression" preset: value labels end about 55px from the right edge of the plot, the toolbar is one row, and the pext map starts scrolled to the variant's region (scrollLeft 200 of 200 at 800px).
- The full Vitest suite and the production build were not run for this change. Browser checks use illustrative fixtures, not a live GATA4 analysis.
