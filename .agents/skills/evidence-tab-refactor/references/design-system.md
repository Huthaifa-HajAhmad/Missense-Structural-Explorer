# Design system for evidence tabs

Reuse before inventing. Everything below already exists and is theme-safe.

## Tokens (src/styles/variables.css)
- Colour only through `var(--cs-*)`: `--cs-surface`, `--cs-surface-2`, `--cs-bg-subtle`, `--cs-border`,
  `--cs-border-subtle`, `--cs-text-primary|secondary|muted|accent`, `--cs-text-danger|success|warning`,
  soft pairs `--cs-bg-danger` + `--cs-text-danger-on-soft`, `--cs-bg-success` + `--cs-text-good-on-soft`,
  `--cs-bg-warning` + `--cs-text-warning-on-soft`, brand `--cs-accent-clay`.
- Tints by mixing: `color-mix(in srgb, var(--cs-text-secondary) 9%, transparent)`.
- **Banned in new code:** Tailwind palette colours (`rose-500`, `indigo-400`, `bg-amber-500/10`…),
  hex/rgba literals, inline `style={{ color: … }}` for theming, emoji in headings, `font-black`,
  animated "pulse/ping" loaders as status, glow shadows. These are what the old cards used and they
  break print, dark mode and contrast.
- Radii: `--cs-radius-card` (12) for cards, 10px rail boxes, `--cs-radius-badge` (6) for chips.

## Typography ramp (typography-tables.css) — family and case separate the quiet ranks
| Class | Use |
|---|---|
| `screen-title` + `screen-tab-description` | tab header |
| `figure-headline` | the ONE answer figure (mono, 22px) |
| `detail-prose` | sentences; `<strong>` for the headline clause |
| `eyebrow` (+ lucide icon, clay) | section labels, mono uppercase 10px |
| `card-title` | a card's own header |
| `pop-mono` / `readout*` | any number, code, accession; always `tabular-nums` |
| `ev-tier` (+ `chip-code` for ACMG codes/identifiers, `ev-tier--lg` for a verdict) | chips |
Numbers mono and right-aligned in tables; words sans. Max prose width ~72ch. Sentence case in copy;
uppercase only through `eyebrow`/table heads. UK English.

## Chips: `ev-tier[data-tone]`
`danger` pathogenic/PP3 · `good` benign/BP4 · `neutral` indeterminate or a reading · `muted` absent,
informational, not counted · `warning` caveat · `accent` rule input / unconfirmed (with dashed border).
Verdict chip: solid = engine recorded; dashed accent = supported but unconfirmed. Codes render
through `formatEvidenceCode` ("PP3 Moderate", "BP4 Very Strong").

## Layout primitives (population.css)
- Screen: `pop-screen @container` (flex column, 20px gap).
- Cards: `pop-card`; hero `pop-hero` → `pop-hero__body`, `__top`, `__figure`, `__figure-label`,
  `__finding`; facts `pop-facts` > `pop-fact` (`__label`, `__value`, `__sub`).
- Callouts: `pop-callout[data-tone=warning|neutral]`; banner variant `pop-callout--banner`.
- Sections: `pop-section` with `h2.eyebrow`.
- Tables: `pop-card pop-table-wrap` (scroll shadows) > `table.pop-table`; `pop-group` rowgroup
  headers (`__title`, `__meta`); `pop-subject` (`__name`, `__note`); `pop-num`, `pop-status`,
  `pop-reason`, `pop-dim`; foot `pop-table-foot`.
- Rail: `rail-section`, `rail-steps`/`rail-step` (`__n`, `__label`, `__value`, `__sub`, `__warn`,
  `data-state`), `rail-cuts`/`rail-cut` (`data-active`, `__rule`, `__here`), `rail-notes` (details),
  `rail-kv`/`rail-kv__row`, `rail-kv--sources`, `rail-refs`.
- Predictors additions (predictors.css): `prd-ruler*` (score on its own axis, bands clipped in
  `__bands`, dashed ticks for local marks, hollow marker off-scale), `prd-vote*` (strip of cells by
  call), `prd-caveats`, `prd-info` (24px icon button), `prd-link`.

## Visual grammar
- One scale per score, on its own axis, with the variant as a dot. Bands: PP3 red / BP4 green,
  opacity by strength (0.2 / 0.34 / 0.5 / 0.66), the active band outlined. Never a filled
  "progress bar" for a score that is not a proportion.
- Replace card grids and sub-tabs with one table the reviewer can scan and compare.
- Show uncertainty and absence in words next to the thing, not as a blank or a spinner.
- Container queries (`@container (max-width: …)`) for narrow columns; the table scrolls with
  shadows rather than squashing.
- Focus: every interactive element gets `:focus-visible` outline `2px solid var(--cs-accent-clay)`
  (`npm run lint` checks suppressions). Hit targets ≥ 24px. `aria-label` on rulers
  (`role="img"`) describing value, axis and band; `sr-only` text for colour-only meaning.
- Print: `print-color-adjust: exact` on tinted marks; hide buttons.
