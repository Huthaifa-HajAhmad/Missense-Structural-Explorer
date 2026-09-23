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
| `coverage` | **Synthetic** payload with one feature of every type the server keeps, so all seven chips are exercised |

The CNNM2 payload is transcribed field by field from
`https://rest.uniprot.org/uniprotkb/Q9H8M5` (features, sequence length) and
`https://rest.uniprot.org/uniprotkb/Q9H8M5?fields=xref_interpro` (the one InterPro id the
domain-name join matches: `IPR002550`, EntryName `CNNM`). Two corrections came from review: an
earlier revision carried `IPR082550`, which is **not** in the record at all (it had been misread
off a screenshot), and `serviceStatus: "success"`, which is not in the server's vocabulary
(`"ok" | "not_found" | "timeout" | "error" | "unsupported-build"`).

`EXPECTED_CNNM2_COUNTS` / `EXPECTED_COVERAGE_COUNTS` are written by hand from that fetch. Deriving
them from the fixture object would let a wrong fixture silently redefine the expectation — that
mistake is exactly how the `IPR082550` error survived a green run.

## What it asserts (92 assertions over five cases)

| Assertion | Catches |
| --- | --- |
| Every stem starts on the edge it hangs from | The `y1=48` anchor: a stem attached to nothing (`Δ-13` inside a band, `Δ-2` outside) |
| No stem crosses a domain label | A stem starting inside the band, cutting through the label's glyphs |
| Pinheads centred on their stems; clear of the rail; stems pointing down | Drift between stem, pin and tier lanes |
| Pin hit areas centred and ≥22 units across | A target too small to hit (see the gap below) |
| **Residue→x mapping matches the printed ruler** | Any coordinate error that moves every shape together (off-by-one, `end` used for `start`). Binds band edges and stems to the ruler's own endpoints, and counts the rendered bands and pins |
| **Zooming narrows the window and keeps the track consistent** | A broken zoom/pan path. Asserts the window narrows, the variant is inside it, something is still visible, and every off-window shape is inside a clipped group |
| **Pin and caret colours clear 3:1 on the light track** | A category colour too faint to read as a category (WCAG 1.4.11). Colours are painted into a canvas and read back, so `oklch()` and any future syntax convert themselves |
| Callout pill clears every domain block and stays inside the rail; its text fits inside it | A callout painted over the band, or off the end of the track |
| **Every** shape the callout paints clears domain labels, and reaches no more than 1 unit into the band | The rail beacon that occluded the domain label. Zero-width shapes (the connector line) are measured too, via stroke-inflated boxes |
| Selecting a site paints no hollow ring | The pulsing amber selection ring on a clicked lollipop |
| Selecting a domain gives no block its own stroke | The "focus border" on the selected / variant-containing domain |
| **Keyboard focus is visible on every track shape** | `focus-visible:outline-none` with nothing replacing it — invisible focus for keyboard users |
| Inventory lists every category with the right count | A zero-count chip hidden while other zero-count chips are shown |
| Zero-count categories are not offered as filters | A chip that can only empty the track |
| **Every** filterable chip dims exactly what it excludes | A filter whose count and filter disagree. The expected pins come from the harness's own oracle over the fixture types, not from the app's predicate |
| Unplotted region annotations are disclosed, even at zero | Curated annotations fetched and then silently dropped |
| The default read-out agrees with the Domain filter | "No direct annotations at 489" by default vs "1 match" under the Domain chip |
| The run produced its full assertion set | A missing host, a renamed selector or a truncated virtual-time budget — see below |

### Motion is frozen before anything renders

The app animates opacity and uses `transition-all`, and SVG geometry properties (`cx`, `x`, `r`) are
animatable — so measuring two macrotasks after a click reads a **mid-transition** value. The first
zoomed run produced a false "pinhead is 544 units from its stem" failure for exactly that reason
(the pin was still gliding from its 1× position while the stem had already jumped). The harness
injects `transition: none !important; animation: none !important` at startup, so every measurement is
of the settled target state — which is the state the assertions are about.

## Mutation-tested

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

**The runner cannot report success for a run that measured nothing.** `check.mjs` requires the
report to contain the expected number of assertions (92). This was a real hole: `every()` over an
empty array is `true`, so a report of zero checks printed "all 0 assertions passed" and exited 0.
It was exercised for real when a thrown check truncated a run — the runner printed
`incomplete run — 13 assertions, expected 70` and exited 1 — and again when a mutation made one
case contribute one assertion fewer.

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
