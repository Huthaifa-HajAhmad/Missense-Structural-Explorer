# Functional Domains sequence-track geometry check

`npm run test:geometry:function-track`

The Functional Domains track is a hand-laid SVG: a backbone rail, a domain band painted over it,
lollipop stems hung from a shared edge, a variant callout, and a row of inventory chips that double
as filters. Every defect it exists to catch is a *measured* fact:

- a stem anchored at a hand-written `y=48` while the rail's bottom edge is `y=50`, so each lollipop
  began inside the domain band and drew straight through the domain label's ink;
- a variant marker painted at the domain label's own baseline, so on CNNM2 p.Ser489Cys the callout
  read **"CBS•1"**;
- stroked rings left on a clicked lollipop and on a clicked domain block, indistinguishable from a
  focus ring;
- inventory chips whose count and whose filter were two different predicates, and a default
  read-out that contradicted the Domain chip about the same residue;
- fifteen of GZF1's seventeen curated "Other Sites" were *spans* — 23-residue zinc fingers and
  low-complexity segments — drawn as near-black lollipop pins at their first residue, which asserted
  that a 23-residue annotation sits at a single residue and left the track buried in dark dots;
- and the inspector's palette legend, which exists to describe the track, advertised four colours the
  track never painted (indigo domains, amber binding sites, emerald PTMs, cyan disulfides), had no
  entry for transmembrane regions or the remaining curated sites, and then advertised a fifth
  invented colour for spans — whose bars are in fact painted in their category's colour;
- and — found by review, not by this harness — `focus-visible:outline-none` on all three SVG groups
  with nothing replacing it, i.e. **no visible keyboard focus anywhere in the track**. That is now
  what check 7b measures.

**jsdom cannot check any of that** — no layout engine, no `getBBox()`, no computed style, no
`:focus-visible`. So this harness renders the real component with the real stylesheet in headless
Chromium, drives it (clicks every filter chip, focuses every shape) and measures the live SVG.

## What it renders

| Case | Payload |
| --- | --- |
| `cbs1` | **Real** CNNM2 / Q9H8M5 (875 aa), p.Ser489Cys — inside CBS 1 (450–511) |
| `tm` | Real CNNM2, p.Ala300Val — inside the CNNM transmembrane domain (251–431) |
| `gap` | Real CNNM2, p.Gly440Arg — between domains |
| `zoomed` | Real CNNM2, zoomed to 3.5× and centred on the variant — clipped bands |
| `gzf1` | **Real** GZF1 / Q9H116 (711 aa), p.Arg591Trp — the span-heavy shape: 1 domain, 10 zinc fingers, 5 low-complexity segments, 2 disordered regions, 1 phosphoserine, 2 mutagenesis points |
| `coverage` | **Synthetic** payload with one feature of every type the server keeps, so all seven chips are exercised |

The page also renders the inspector's `FeaturePaletteLegend` once, in `#legend-probe`, outside every
case host — one legend serves the whole page, so it is asserted once rather than six times.

The GZF1 payload is transcribed from `https://rest.uniprot.org/uniprotkb/Q9H116`, and it is the case
that made the geometry split necessary: 17 of its 20 curated annotations are spans. Counting what the
server keeps for it — 10 `Zinc finger` + 5 `Compositional bias` + 2 `Mutagenesis` = **17** — is how
the screenshot's "17 Other Sites" was confirmed correct rather than a bug, and how the fact that
fifteen of those seventeen are *not* point annotations came to light.

The CNNM2 payload is transcribed field by field from
`https://rest.uniprot.org/uniprotkb/Q9H8M5` (features, sequence length) and
`https://rest.uniprot.org/uniprotkb/Q9H8M5?fields=xref_interpro` (the one InterPro id the
domain-name join matches: `IPR002550`, EntryName `CNNM`). Two corrections came from review: an
earlier revision carried `IPR082550`, which is **not** in the record at all (it had been misread
off a screenshot), and `serviceStatus: "success"`, which is not in the server's vocabulary
(`"ok" | "not_found" | "timeout" | "error" | "unsupported-build"`).

`EXPECTED_CNNM2_COUNTS` / `EXPECTED_GZF1_COUNTS` / `EXPECTED_COVERAGE_COUNTS` are written by hand from
those fetches. Deriving them from the fixture object would let a wrong fixture silently redefine the
expectation — that mistake is exactly how the `IPR082550` error survived a green run.

## What it asserts (137 assertions over six cases)

| Assertion | Catches |
| --- | --- |
| Every stem starts on the edge it hangs from | The `y1=48` anchor: a stem attached to nothing (`Δ-13` inside a band, `Δ-2` outside) |
| No stem crosses a domain label | A stem starting inside the band, cutting through the label's glyphs |
| Pinheads centred on their stems; clear of the rail; stems pointing down | Drift between stem, pin and tier lanes |
| Pin hit areas centred and ≥22 units across | A target too small to hit (see the gap below) |
| **Residue→x mapping matches the printed ruler** | Any coordinate error that moves every shape together (off-by-one, `end` used for `start`). Binds band edges and stems to the ruler's own endpoints, and counts the rendered bands, pins *and* span bars |
| **Zooming narrows the window and keeps the track consistent** | A broken zoom/pan path. Asserts the window narrows, the variant is inside it, something is still visible (band, span or pin), and every off-window shape is inside a clipped group |
| **Pin and caret colours clear 3:1 on the light track** | A category colour too faint to read as a category (WCAG 1.4.11). Colours are painted into a canvas and read back, so `oklch()` and any future syntax convert themselves |
| **A span is drawn as a bar, a point annotation as a pin** | Spans plotted as point lollipops — the 15 near-black dots on GZF1, and the silent claim that a 23-residue zinc finger sits at one residue |
| **Span bars stay inside the span lane** | A bar escaping into the band, the rail or the ruler |
| **Overlapping spans are packed onto separate tiers** | Two bars on one tier overlapping in x, so a nested low-complexity segment hides the region containing it |
| **A span containing the variant is underlined** | The variant's span losing its marker when several bars share the window. The expected count comes from the fixture, never from the render's own claim — see the vacuity note below |
| Callout pill clears every domain block and stays inside the rail; its text fits inside it | A callout painted over the band, or off the end of the track |
| **Every** shape the callout paints clears domain labels, and reaches no more than 1 unit into the band | The rail beacon that occluded the domain label. Zero-width shapes (the connector line) are measured too, via stroke-inflated boxes |
| Selecting a site paints no hollow ring | The pulsing amber selection ring on a clicked lollipop |
| Selecting a domain gives no block its own stroke | The "focus border" on the selected / variant-containing domain |
| **Keyboard focus is visible on every track shape** | `focus-visible:outline-none` with nothing replacing it — invisible focus for keyboard users |
| Inventory lists every category with the right count | A zero-count chip hidden while other zero-count chips are shown |
| Zero-count categories are not offered as filters | A chip that can only empty the track |
| **Every** filterable chip dims exactly what it excludes | A filter whose count and filter disagree. The expected pins come from the harness's own oracle over the fixture types, not from the app's predicate |
| The plotted span count is disclosed, even at zero | Curated annotations fetched, drawn, and then unaccounted for in the chip row |
| The default read-out agrees with the Domain filter | "No direct annotations at 489" by default vs "1 match" under the Domain chip |
| **Legend lists every category, and nothing else** | A legend row for something the track cannot paint (a resurrected "Spans" colour swatch is caught here as an unexpected kind) |
| **Every legend swatch matches the colour the track paints for that category** | The legend drifting from the track: the four wrong swatches it shipped with, and any future hand-written one. Pins and bars must match the swatch exactly; a domain band is a gradient, so the swatch must be one of its stops |
| **The legend's shape rows cover the geometries a site can have** | A legend that names kinds only, leaving "why is this one a bar?" unanswerable |
| The run produced its full assertion set | A missing host, a renamed selector or a truncated virtual-time budget — see below |

### Motion is frozen before anything renders

The app animates opacity and uses `transition-all`, and SVG geometry properties (`cx`, `x`, `r`) are
animatable — so measuring two macrotasks after a click reads a **mid-transition** value. The first
zoomed run produced a false "pinhead is 544 units from its stem" failure for exactly that reason
(the pin was still gliding from its 1× position while the stem had already jumped). The harness
injects `transition: none !important; animation: none !important` at startup, so every measurement is
of the settled target state — which is the state the assertions are about.

## Mutation-tested

`mutations.mjs` in this directory reintroduces every defect listed below into the real component,
palette and legend — `node tools/function-track-geometry/mutations.mjs apply <id>` — and restores
them from a hash-verified backup. The tables here are its output, not a recollection. Apply them in
**small groups**: one mutation can hide another's guard, which is exactly what happened on the first
attempt (see the span-lane table).

Each guard was verified to fail against the defect it pins, in two batch runs (25 and 21 of 70
red). Per-defect attribution comes from the failure *text*, which names the shape and the numbers:

| Reintroduced defect | Assertion that caught it |
| --- | --- |
| Selection ring on the clicked pin | `selecting a site paints no ring around the pinhead` — `Functional site: Modifie r=8.5` |
| Per-state stroke on the selected block | `selecting a domain does not give its block a ring` — `non-uniform: CNNM transmemb=…/2.5px \| CBS 1=…/1px` |
| Focus indicator removed from the band | `keyboard focus is visible on track shapes` |
| Rail beacon restored | `variant marker clears domain labels and blocks` |
| Residue→x off by one (`residue` for `residue - 1`) | `residue→x mapping matches the printed ruler` — `site 251 at x=236.76, ruler says 235.95` |
| A domain band dropped from the render | same check — `rendered 2 domain bands, fixture has 3` |
| Disulfide chip hidden at zero | `inventory lists every category with the right count` — `missing chips: disulfide` |
| Zero-count chip made clickable again | `a zero-count category is not offered as a filter` |
| Stems back to `y1=48` | `every lollipop stem starts on the edge it hangs from` and `no stem crosses a domain label` |
| A pin colour back to sky-500 | `pin and caret colours clear 3:1 on the light track` — `Functional site: Modified 2.63:1 (< 3:1)` |
| "Focus Variant" no longer centres the window | `zooming narrows the window and keeps the track consistent`, plus the count self-check |

Each mutation was applied to the real component, the harness re-run, the failure text read, and the
component restored from a hash-verified backup.

### Second round: the span lane and the legend

Six defects, four runs (batches are named because a mutation can *mask* another — the first attempt
applied all six at once and the "spans drawn as pins" mutation zeroed the bar count, which silenced
the tiering and underline guards behind it, so those three were re-run alone):

| Reintroduced defect | Batch | Assertions that failed | Failure text (abridged) |
| --- | --- | --- | --- |
| Every span drawn as a pin | 1 | `spans are bars and point sites are pins`, `the plotted span count is disclosed`, `residue→x mapping` (per case) | `rendered 0 span bars / 6 pins; fixture expects 5 / 1`; `"0 Spans (span lane)" (expected 5)` |
| All spans packed onto one tier | 2 | `overlapping spans are packed onto separate tiers` (gzf1) | `Curated span: Regi overlaps Curated span: Comp on one tier` ×5 |
| Span lane moved below the site rail | 2 | `span bars stay inside the span lane` (all six cases) | `Curated span: Region Dis y=100..103.5; …` |
| The enclosing span loses its underline | 2 | `a span containing the variant is underlined` (gzf1) | `0 bar(s) claim to contain the variant, the fixture has 1 that do; 0 underlined` |
| PTM swatch replaced with a too-light colour | 1, 3 | `pin and caret colours clear 3:1` (all six cases) | `Functional site: Modified 1.58:1 (< 3:1)` |
| Legend swatch hand-written instead of read from the palette | 4 | `every swatch matches the colour the track paints` | `ptm: track painted rgb(2, 132, 199) (pin @130) but the legend says rgb(125, 211, 252)` |
| A coloured "Spans" swatch restored to the legend | 1, 3 | `legend lists every category the track can paint, and nothing else` | `8 swatch(es) […, spans]; missing none; unexpected spans` |

Runs: 31 of 137 red (all six), 8 of 137 (the three the first batch masked), 7 of 137 (legend kind
plus palette contrast), 1 of 137 (the hand-written swatch alone). The unmutated revision is 137/137.

**A vacuity this found in its own new guard.** The underline check first read *which* spans claim to
contain the variant off the rendered `aria-label` and then asked whether those same shapes were
underlined — so an implementation that stopped claiming containment produced an empty set and the
check passed. Mutation 4 is what exposed it: with `isEnclosing` forced false, the guard was green.
It now takes the expected count from the fixture and fails on both a missing and a spurious claim.

**What the legend mutation does *not* prove.** Mutating the *palette* colour (PTM → sky-300) moves
the track and the legend together, so the colour-equality check stays green by construction — the
contrast assertion is what catches that. The equality check catches *disagreement* between the
legend and the track, which is the defect it was written for and the only one of the two that the
palette cannot see.

**The runner cannot report success for a run that measured nothing.** `check.mjs` requires the
report to contain the expected number of assertions (137). This was a real hole: `every()` over an
empty array is `true`, so a report of zero checks printed "all 0 assertions passed" and exited 0.
It was exercised for real when a thrown check truncated a run — the runner printed
`incomplete run — 13 assertions, expected 70` and exited 1 — and again when a mutation made one
case contribute one assertion fewer.

**Honest scope of that claim.** Two assertion families (pin centring / rail clearance, and callout
pill geometry) are *regression* guards, not reproducers: their maths is numerically identical to the
pre-fix code, so they could not have failed before the fix. An earlier revision of this README
claimed "all twelve families were verified to fail against the pre-fix code", which was false.

**One guard was dead when it was first written.** The site-ring check dispatched a click and read
the DOM in the same task, before React had re-rendered, so it measured the *unselected* track — the
recorded mutation run shows it passing while the ring was present. Both ring checks now `await` a
flush first and positively assert the selection took effect before looking for the decoration, and
they fail closed ("could not confirm the selection took effect") rather than passing vacuously.
Reviewer-found; the fix is why the mutation table above can list it.

## Not covered

- **The mouse half of the focus contract.** That a mouse click does not match `:focus-visible` (and
  therefore cannot resurrect the click-time ring a keyboard indicator would otherwise paint) is
  argued from the CSS spec and Chrome's behaviour, **not measured**: untrusted events cannot set the
  input modality, so the harness proves the keyboard half (focus → indicator painted) and the click
  half only for the click handlers themselves.
- **Zoom/pan beyond one window.** The `zoomed` case covers 3.5× centred on the variant; other zoom
  levels and pan positions, and tier staggering under them, are untested. The mapping check does not
  run at zoom (a clipped band legitimately has a different extent than its residue range); the zoom
  case asserts clipping and visibility instead.
- **WCAG 2.5.8 on a narrow viewport.** The hit-radius assertion is in SVG units (r=11 → 22 units):
  ~28 CSS px at the harness's 1010px width, but ~14 CSS px at the container's `min-w-[500px]`, below
  the 24px minimum. Documented as a known gap; the real fix is an HTML list of large-target controls
  beside the track, since at 875 aa adjacent pins are ~25 units apart and r>12 would make
  neighbouring targets overlap.
- Hover (`:hover` cannot be forced), real pointer input, `<title>` tooltips, and the HTML card list
  (only the SVG track is measured).
- **The legend is asserted, but only in the three ways above.** The harness mounts
  `FeaturePaletteLegend` directly — not the whole inspector with its prop graph — and checks its
  keys, its swatch colours against the painted track, and its shape rows. It does not check the
  legend's layout, its contrast against its own panel, or whether two swatches are distinguishable
  *from each other* at 10 px. It is also measured against the `coverage` case alone, the only fixture
  with a feature in every category.
- **No screenshot judgement.** Everything here is geometry and computed colour: whether the span lane
  *looks* right — 3.5-unit bars, up to three tiers — is a question about a picture, and the harness
  cannot answer it. A vision-model read of `function-track.png` was attempted while writing this and
  returned nothing usable, so the span-lane render has **not** been visually reviewed by the agent
  that wrote it; the numbers above are the whole of the evidence.
- **Screen pixels.** Measurements are SVG user units, not CSS px.
- The dimming oracle reads settled computed opacity through the ancestor chain, not a screenshot.

## Requirements

A Chromium-based browser, discovered via `$GEOMETRY_BROWSER`, `$CHROME_PATH`, then the usual
Edge/Chrome paths; if none is found the check exits `2` immediately, before the build. Exit codes:
**2** = environment or build problem, **1** = a failed or incomplete assertion set, **0** = pass.

`TRACK_SHOT=1` additionally writes `function-track.png` next to this file (gitignored) — the render
the assertions were measured against.

## CI

Wired into `.github/workflows/ci.yml` as the `geometry` job, next to `npm run test:geometry` (the
variant-header harness). `ubuntu-latest` ships Chrome, which both runners discover at
`/usr/bin/google-chrome`. `cd.yml` gates on this workflow's overall conclusion, so a geometry failure
blocks a deploy; on failure the job uploads both harnesses' `dist/` folders (self-contained pages)
plus the screenshot.
