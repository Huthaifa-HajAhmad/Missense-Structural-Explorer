# Landscape tab geometry check

`npm run test:geometry:landscape` builds this directory with Vite, renders the real
`LandscapeInspector` (the tab's inspector rail) and `LandscapeFocus` (the focus grid) in headless
Chromium with the SOD1 p.Ala5Val fixture, and reads back assertions the page computed from live
layout and CSS geometry. jsdom has no layout engine, no computed colour and no focus visibility,
so none of this can be asserted in vitest.

## Cases

| Case | Fixture | Why |
| --- | --- | --- |
| `rail-wide` | SOD1 P00441 p.Ala5Val, 360px rail, tabs walked | The rail's first-sight contract: the four pill tabs (one `aria-selected`, ≥24px), the 'Reads as' lead box before the verdict, key/value context, the six substitution letters at residue 5 (REVEL 0.76–0.87, AlphaMissense 0.26–0.97) — the chips that used to overlap — 24px targets, contrast, no overflow |
| `rail-dark` | same, `.dark` | Chip and pill contrast against the dark theme |
| `tab` | same, 1010px focus grid + overview strip | One tab stop per roving grid, Tab lands on the queried cell, the phyloP track is keyboard-reachable, every cell ≥24px tall (route A), the grid stays ≤ ~800px, and the ClinVar P/LP token is its own colour, ≥3:1 and far from the PP3 red |

The fixture (`src/shared/__tests__/fixtures/sod1Landscape.ts`) carries the real live numbers from
the audit screenshots on residue 5 and the window's real AlphaMissense means; its REVEL and
conservation stand-ins are marked as such.

## Assertions

- **tabs**: four pills, exactly one `aria-selected`, panels wired; pill targets ≥ 24px.
- **summary**: the 'Reads as' lead box precedes the per-tool verdict; the verdict carries both tools'
  score and band ("The queried variant", REVEL 0.853 · PP3 Moderate, AlphaMissense 0.840 · PP3);
  context reads as key/value rows with the query marked "(queried)".
- **chips**: no two substitution letters overlap; every chip sits inside its strip (the old strip
  placed letters at their raw score, so S/V collided at 0.88/0.95).
- **targets**: letter chips, rail pills and scatter hit circles are ≥ 24px (WCAG 2.5.8); every
  focus-grid cell is ≥ 24px tall (route A — all pointers, no `pointer: coarse` fallback).
- **keyboard**: every scatter point is focusable; exactly one tab stop per roving grid; Tab lands on
  the queried heatmap cell; the phyloP track is reachable.
- **nucleotides**: the queried codon's three reference bases are drawn under its residue.
- **overflow**: the rail does not scroll sideways at 360px.
- **contrast**: chip letters reach 4.5:1 on their chip, light and dark.
- **clinvar**: the `--ls-clinvar-plp` token reaches 3:1 on the card and sits ≥ 60 RGB-units away from
  the PP3 band red, light and dark.

Each case declares its assertion count; the run fails if a case produced a different number, or if
the total differs from `EXPECTED_ASSERTIONS` in `check.mjs` (35 = 13 + 13 + 7 case assertions plus
the two harness checks).

## Running locally

`npm run test:geometry:landscape`. Set `GEOMETRY_BROWSER=/path/to/chrome` if discovery fails,
`LAND_SHOT=1` for a screenshot. The browser must be focused for the focus-visibility behaviour; all
assertions used here are computed from attributes and geometry, not `:focus-visible`.
