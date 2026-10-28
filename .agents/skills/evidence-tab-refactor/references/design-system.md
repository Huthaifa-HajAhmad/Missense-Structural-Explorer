# Design system for evidence tabs

Reuse the tokens and global type classes; copy layout values into your own prefixed classes.

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
Numbers mono and right-aligned in tables; words sans. Prose fills its card — no `ch` max-width cap
(a `72ch` cap left paragraphs stopping short of the card's right edge on wide windows; it was removed
across the tabs). Sentence case in copy; uppercase only through `eyebrow`/table heads. UK English.

## Chips: `ev-tier[data-tone]`
`danger` pathogenic/PP3 · `good` benign/BP4 · `neutral` indeterminate or a reading · `muted` absent,
informational, not counted · `warning` caveat · `accent` rule input / unconfirmed (with dashed border).
Verdict chip: solid = engine recorded; dashed accent = supported but unconfirmed. Codes render
through `formatEvidenceCode` ("PP3 Moderate", "BP4 Very Strong").

## House voice (current, from the Population polish)
- Roots (`.<prefix>-screen`, `.<prefix>-rail`) reset to `--cs-font-sans`, 13px prose, secondary ink.
- ONE uppercase label style: 11px sans 600, 0.07em tracking, muted — section eyebrows and column
  heads only. Field names 12px sans muted, sentence case. Data 13px mono 500 tabular, ink.
- Hero figure in sans semibold at display size; mono only for figures inside tables and codes.
- Red/green only for ACMG codes and the band a reading sits in; amber for a run fault; clay for
  "the value the rule used" and links.
- Rail: sections separated by hairlines, only the rule trace framed; cut-point rows plain, active
  row marked by weight and "this variant", not a fill. Size the code column for the longest code.

## Cards, rows and empty states (from the Population Data table/ClinVar polish)
The first Population revision boxed every row as a tinted, dashed pill inside a tinted card; it read
as a placeholder. The standard now:
- **One tint per card.** `--cs-surface` for the card body; `--cs-surface-2` only for its head bar
  (column heads, 40px, the one uppercase label voice) and its foot bar (caption, muted). Rows are
  never tinted and never boxed.
- **Rows are flat**, separated by a `--cs-border-subtle` hairline (`tr + tr > * { border-top }`),
  padding 11px 16px (10px 16px for compact lists), every row on the card's 16px left edge.
  The row the rule read gets a 6% `--cs-accent-clay` wash, not a border or a pill.
- **Dashed borders mean "unconfirmed"** (the dashed accent chip, a local cut-point). Never use them
  to draw an empty state or an absent row.
- **Absent rows**: name in primary ink (13px), reason as a muted 12px caption in its own column
  (name column ~160px), a state chip only when the state is not a plain "no result".
- **Empty state = a statement on the card**, not a box: either a summary line (hollow 8px muted ring
  + bold primary sentence, hairline below) above the per-source list, or a bold primary title with
  the reason as secondary prose under it (max ~60ch). Title from the availability state
  ("No classification" for no-result, else the `ENGINE_STATE_LABELS` label).
- **Column heads line up with what is under them.** An empty-state head uses the list's grid tracks;
  never a lone column label over nothing.
- **Key/value blocks** (e.g. ClinVar Classification/Review/Condition): flat `dl` rows, 84px muted
  12px field column, hairlines between, no per-row boxes.
- **Neutral marks stay neutral.** Review stars use `--cs-text-secondary` (filled) over `--cs-border`
  (empty): gold/amber would collide with the run-fault colour.

## Layout vocabulary (copy the values into your own prefix — do not reference these classes)
The names below are Population's and Predictors' own classes; read them as templates.
- Screen: `pop-screen @container` (flex column, 24px gap; every Evidence screen root uses 24px).
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

## Second-pass workspace hierarchy

Use the current figure/records/inspector pattern described in
[second-pass-design.md](second-pass-design.md) for already-audited tabs. The card and table
values above remain useful, but do not require all records below the figure or a permanent
four-cell fact strip. Let the main scientific figure lead; disclosures hold repeated detail.
