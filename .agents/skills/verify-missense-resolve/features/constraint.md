# Gene constraint strip, reading cards and inspector view

## Sub-features
The context strip under the top bar (`GENE CONSTRAINT gnomAD v4.1.2` + three readings), a
card per reading, and the inspector rail's Gene constraint view. There is no "Details"
dropdown any more.

## How to get to it (user POV)
Run any analysis; the strip shows on every analysis view. Click a reading (or Tab onto it:
keyboard focus opens the card too, a pointer focus does not). The card's
"Open in inspector" swaps the right rail to Gene constraint; "Back to <page>" or Escape
returns it, and navigating to another page or tab returns it as well.

## Driving it with e2e
`tests/constraint-inspector.e2e.ts` (tags `live`, `constraint`).
- Chips: `button` named from their text (`/^LOEUF/`, `/^Regional O\/E/`); DOM hook
  `[data-constraint-chip="missense-z|loeuf|regional-oe"]`, `aria-expanded` while the card
  is open, `data-inspected="true"` while the rail shows that reading.
- Card: `[data-testid="constraint-card"]` with `data-metric`; action button "Open in inspector".
- Inspector view: `region` "Gene constraint reference ranges"
  (`[data-testid="constraint-inspector"]`, `data-focus=<key>`); rows `#constraint-metric-<key>`;
  the rail body carries `data-inspector-mode="gene-constraint"` (else `"page"`).
- State: `useVariantAnalysisStore.getState().constraintFocus` (null = the page's own rail).

## Proof
Card under its own chip (left within 40px, top below the chip); inspector region visible
with "Where the cut-points come from"; Back removes it and clears `data-inspected`.

## Gotchas
The card is placed from the chip's position and closes on window resize or a sideways
scroll of the chip row instead of drifting. Regional O/E carries its own release tag
(`v4.1.1`); the group label is the gene metrics' release.
A press on the card's own text keeps it open: the card is `tabindex="-1"` so Chromium focuses
it instead of blurring the chip to `<body>` (the e2e pins this with a real press).
The chip's accessible name is its label, value, verdict and release tag; the reference-range
sentence and the facts live in the card (opened on keyboard focus, so a screen-reader user reaches
them by moving focus) and in the inspector. The chip no longer carries a hover tooltip or a hidden
detail span. That was deliberate: one place per fact.
