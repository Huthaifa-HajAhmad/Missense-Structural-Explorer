# Variant header geometry check

`npm run test:geometry`

The global variant header lives or dies by measured geometry: the three metric rows
are independent grids that must share column edges, the value marker must not paint
over the threshold numeral that names it, the fixed-width columns must not clip, and
the source strip must line up with the rows it labels.

**jsdom cannot check any of that** — it has no layout engine, no container-query
evaluation and no font metrics. That is why the layout rules in the two header
commits were previously verified only by eye, and why an entire restructure could
land with the suite still green.

This harness bundles the real component with the real stylesheet and webfonts,
renders it at six widths (1000 / 860 / 560 / 375, light and dark), measures the live
boxes, and exits non-zero if any assertion fails.

## What it asserts

| Assertion | Catches |
| --- | --- |
| Line-1 column edges identical across metric rows | A content-sized (`auto` / `max-content`) grid track silently desynchronising the rails down the group |
| No element's content exceeds its box | A fixed column plus `white-space: nowrap` clipping or overlapping its neighbour. The 4px `.vh-icon-btn::after` hit-area halo is excluded as a known artefact |
| The 11px value marker clears every axis numeral | The marker covering the threshold number it labels — e.g. Z = 3.13 sitting on the "3.09" ClinGen cutoff |
| Labels, verdicts and footnotes are not ellipsised | A long verdict or RMC block/p-value being truncated without a guard |
| Metric group wraps under the identity below 909px, beside it above | The flex-basis wrap point regressing |
| Source strip shares the left edge with the metric rows | A `flex-direction: row` flip that forgets to reset the base `justify-content: center`, centring the strip |
| Every micro-text selector clears WCAG AA (4.5:1) in **both** themes | The dark-mode muted token regression (3.97:1 → 6.59:1), composited from real computed colours |

## Mutation-tested

The assertions were verified to fail against the pre-fix CSS:

- restoring `.vh-axis-label { top: 7px }` → 5 failures, `marker vs "3.09" 11x1.5px`
- dropping `justify-content: flex-start` from the `≤600px` branch → the strip is
  `179.6px` right of the row labels at 560px

## Requirements

A Chromium-based browser. Discovery order: `$GEOMETRY_BROWSER`, `$CHROME_PATH`, then
the usual Edge/Chrome install paths on Windows, macOS and Linux. If none is found the
check exits 2 with that message. On a GitHub `ubuntu-latest` runner
`/usr/bin/google-chrome` is preinstalled, so the script is CI-ready as-is — it is not
wired into `.github/workflows/ci.yml` yet, and each run needs ~15s (one vite build
plus one headless render).

## Not covered

Highlighting is not part of this: text selection, focus-visible outlines, tooltip
positioning and the sticky behaviour of the header all need a real interaction, not a
static render.
