# Functional Domains tab — audit and fixes

Scope: `src/components/evidence/FunctionInteractionsTabs.tsx` → `FunctionTab` (sidebar: *Evidence →
Functional Domains*).

Reported items: **focus ring on lollipop and domains**, **lollipops offset from backbone**,
**variant location callout overlaps**, **inventory functionality**.

Revision this document describes: commit `c458600`, specifically
`src/components/evidence/FunctionInteractionsTabs.tsx` at SHA-256
`64A15E0C15AB0CCFFDE54F3A50C92947998E9699567F49CE7E7AFEBBB8797B05` and
`tools/function-track-geometry/main.tsx` at SHA-256
`34CF85FFBE6222F2E9674AD00DE85FC6AD607328C10E352C60D41CA3F9325EAC`. The commit's blobs were compared
against those working files with `git rev-parse HEAD:<path>` vs `git hash-object <path>`, so the
evidence below belongs to the committed content and not to a later edit. The tree also carried
unrelated uncommitted work by other agents (see *Verification* for why a snapshot, not a file list,
is the honest way to say this).

## Evidence

Two layers, and they are not interchangeable:

- **Measured in a browser.** `tools/function-track-geometry` (`npm run test:geometry:function-track`)
  renders the real component with the real stylesheet in headless Chromium and measures live SVG
  geometry: 70 assertions over four cases, all passing. (The counts in this section are the first
  round's, taken on the revision named above; the harness has since grown to **137 assertions over
  six cases** — see *Second review round* at the end.)
- **Read from source.** The "was" column below, and any statement about which Tailwind class applied
  to what. Where a claim is derived by reading rather than measuring, it says so.

## The four reports

### 1. Focus ring on lollipop and domains

Three decorations, all painted only in states a click produces, all ring-shaped:

| Where | Was | Now |
| --- | --- | --- |
| Selected curated site | `<circle r=8.5 fill=none stroke=#f59e0b animate-pulse>` — a literal ring around the pinhead | gone; selection is the larger solid pin (in amber-700, a shade no category owns), the amber stem and the inspector bar |
| Domain containing the variant | `stroke-emerald-300` on that block ("single clean focus border" in the old comment) | gone; one stroke for every block, containment is the brighter fill plus the `Inside (40/62 aa)` badge |
| Selected domain | `stroke-amber-400 stroke-[2.5]` on the clicked block | gone; brighter fill only |
| Selected domain *card* | `ring-2 ring-amber-500/30` | border/background; the `Selected` badge was already there |

The selection colour change matters on its own: the disulfide pin is `#f59e0b` (amber-500) and the
selected fill was *also* `#f59e0b`, so selecting one was colour-identical to leaving it alone.
Under reduced motion the removed `animate-pulse` was not motion but a static ring
(`src/styles/primitives.css` pins animations to their end frame), so those users lost a cue that
only the size change now replaces.

### 2. Lollipops offset from the backbone

Two causes, and only the second is visible in a render (12× crop of the harness output):

- every stem was drawn from a hand-written `y1=48` while the rail spans `y=44..50`, so each stem
  started **2 units inside** the rail — measured `Δ-2`;
- the domain band is painted *over* the rail, so inside a domain the visible backbone is gone: the
  stem began **13 units inside the band** (`Δ-13`), detached from anything, and drew straight
  **through the domain label's glyphs**.

Fix: a lane table (`TRACK`) is the single source of truth for the track, and each stem anchors on
the bottom edge of the surface that covers its residue — `BAND_BOTTOM` (61) inside a domain,
`RAIL_BOTTOM` (50) outside one. The ruler's interior ticks and mid label, the callout lane and the
pill width now derive from the same table, so the seven values that used to be scattered are gone
(the callout lane and the ruler ticks were still literals in the first revision of this fix; review
caught that the "every lane derives from the table" claim was not yet true).

### 3. Variant location callout overlaps

The pill was not the problem — its text measures 64.65 units inside a 98-unit pill (an earlier
revision of this document quoted 75.8, a measurement taken before the redundant `▼` prefix was
removed from the label). The overlap was the **marker**: a 15-unit `animate-ping` beacon plus a 4-unit
dot painted at `cy=47` — the rail's centreline — while the domain label's baseline is `y=50` in the
band it sits on. On CNNM2 the label therefore rendered as **"CBS•1"**, visible in the harness PNG.

Fix: nothing is painted inside the band. The pill keeps its own lane, and an amber caret in the
free lane above the band lands its tip on the band's top edge (or continues to the rail when the
variant is between domains). The connector line is drawn only when the pill had to be clamped away
from the residue's x, where it is the only thing tying the callout to the caret — otherwise it was
a 4-unit stub that read as a stray dash. The `▼` glyph was dropped from the label because the caret
now carries it.

### 4. Inventory functionality

| Finding | Fix |
| --- | --- |
| The Disulfide chip rendered only when non-zero while `0 Active Sites` was always shown, so the row's grammar changed with the data | every category always renders with its count |
| Clicking a zero-count chip dimmed the whole track (pins to `0.2`, domains to `0.35`) and could only produce an empty result; `disabled` + `title` also put the explanation out of reach of the keyboard | zero-count categories are rendered as informational spans (like the Regions chip), with the count visible and a `title` explaining why there is nothing to filter |
| Count and filter were two independent predicates (count via `isXxxSite`, dimming re-derived inline) | one `INVENTORY_MATCHERS` record; counts and filters read it |
| Adding a category meant editing five places with nothing forcing agreement | the matcher record is `satisfies Record<InventoryCategory, …>`, so a missing matcher is a compile error, and `has`/`counts` are built from that one record |
| No state exposed: a screen reader could not tell which filter was on | `aria-pressed` on selectable chips, `role="group"` on the row |
| With no chip selected, a variant inside a domain reported *"No catalytic active site… is recorded directly at Ser489"* while the flank gauge said *"Within CBS 1"* and the Domain chip found `1 match` | domains are part of the default set; the heading is *"Direct Curated Annotations"* (a domain is not a "site") |
| 2 curated `Region` annotations were fetched and then dropped from every surface, silently | a muted `N Regions (not plotted)` chip discloses them, at zero as well |
| UniProt `Site`, `Motif`, `Repeat`, `Zinc finger`, `Coiled coil`, `Compositional bias`, `Mutagenesis` were **plotted as lollipops but matched no chip**, so every filter faded them with no chip to restore them | a seventh `Other Sites` category, counted and filterable like the rest |
| A category that lost all its features while selected left an un-un-pressable filter (`disabled` chip, dimmed track) | a reset effect clears a selected category that has become zero-count |
| Raw internal ids leaked into copy: "No **ptm** annotation…", "Filtered by **domain**" | the chip label is rendered |

## Fixed because review found it, not because it was reported

**No visible keyboard focus in the track (critical).** All three SVG interactive groups carried
`focus-visible:outline-none` with no compensating style anywhere, and no repo-wide fallback applies
to `g[role=button]` — so a sighted keyboard user could tab through three domains, every pin and the
"jump to variant" chip with no indication of where they were, and pressing Enter on a domain
produced only a shade change of green. The first revision of *this document* claimed the keyboard
affordance "is not lost", which was exactly backwards. Now: `outline-hidden` (which keeps the
forced-colors ring) plus an explicit `group-focus-visible` stroke on the band, the pin and the jump
chip — and assertion 7b measures it, which the harness previously did not.

**Two interactive-control defects in the same tab.** The InterPro link sat *inside* a
`role="button"` card (a control inside a control: ambiguous name and role for assistive tech, two
overlapping tab stops); the card's activation target is now a real `<button>` around its header,
with the link as a sibling. And both flank cards stayed focusable with no-op handlers when there was
no nearest feature; interactivity is now attached only when there is something to inspect.

**Non-text contrast.** The pins are the only encoding of a site's category, and in light mode they
measured 2.1–2.7:1 against the track surface. Category colours now sit one step darker and the
harness *measures* every ratio rather than trusting the palette: transmembrane 3.50:1, PTM 3.89:1,
active 4.46:1, binding 5.11:1, disulfide 3.03:1 (the tightest), other 7.20:1, variant caret 4.78:1.

**A false negative while the payload is in flight.** `uniprotFeatures` is null during the PDB
warmup, and stays null on a UniProt timeout. The tab rendered the empty track, six zero chips and
the sentence *"No domain, catalytic active site, … contains wild-type residue Ser489"* — a false
claim about a protein with three domains, one of which contains 489. The clause "No domain …" was
added by the fix for report 4, which made the pre-existing false negative stronger. Now the
inventory and every absence claim are gated on the payload having arrived, with a status line
("Retrieving curated domain and site annotations…" / "unavailable for this run"), and the flank
cards no longer claim a terminus when nothing was retrieved.

**Three divergent definitions of "this residue is inside a domain".** `coversResidue`,
`siteStemAnchors` and the marker each derived it differently, so a feature with a non-finite `end`
could count as containing the residue in the read-out while the picture anchored its stem to the
rail; dropping the finite guard also let a numeric-string `start` match. One `coversResidue` now
serves the band highlight, the stem anchor, the marker, the flank gauge and the read-out.

## Deliberately not changed

- **Regions are not plotted as lollipops.** They are residue *spans* rather than point sites;
  plotting them on a curated-site rail would misrepresent them. Disclosed instead of silent.
- **Regions stay out of the default match set and the flank vectors.** A spanning region would
  dominate "nearest upstream/downstream", where naming the nearest domain boundary is more useful.
- **Tier staggering still only compares each site with its immediate predecessor.** Three sites
  within 14 units of each other can share a tier, and tier 2 (`y=102`) sits 5 units above the ruler
  at the hit area's `r=11`. With real annotation sets this does not trigger — zooming *spreads* sites
  apart rather than crowding them — and a proper fix is an interval-packing pass, not a tweak.
- **WCAG 2.5.8 at narrow widths.** The lollipop hit areas are r=11 SVG units: ~28 CSS px at a 1010px
  container but ~14 CSS px at the `min-w-[500px]` floor, below the 24px minimum. Enlarging the radius
  is not the fix (at 875 aa adjacent pins are ~25 units apart, so r>12 makes neighbouring targets
  overlap and steal clicks); the real fix is a list of large-target controls beside the track.
  Documented in the harness README as a known gap, with the assertion stated in the units it is
  actually measured in.
- **The duplicated upstream/downstream flank handlers** (~60 near-identical lines for click and
  keydown) are untouched: behaviour-preserving extraction, out of scope. Their interactivity is now
  conditional, which is the only part that affected behaviour.
- **The InterPro link nested inside a `role="button"` card** and the two flank cards that stay
  focusable when nothing is nearest: both fixed (see above).

## Behaviour changes beyond the four reports

Listed because a reviewer had to derive them from the diff: pinhead hover growth restored
(`group-hover:[r:5px]`, which replaced a dead `group-hover:r-[5px]`); stem hover slate-300 →
slate-500/400; selected stem and pin amber-400/500 → amber-600/700; domain hover moved from
`:hover` to `group-hover` with `transition-all` → `transition-colors`; the site `<title>` moved to
be the first child (SVG 2 prefers it there); malformed features no longer match `coversResidue`; the
unrequested `dark:stroke-emerald-900/70` on every domain outline is reverted to the original single
light value; the pin hit area grew from ~18px to ≥22 units to clear WCAG 2.5.8.

## Verification

| Layer | Result |
| --- | --- |
| `npm run test:geometry:function-track` | **92/92 pass** on the revision above (5 cases, including a 3.5× zoomed window) |
| Same harness, defects reintroduced (three batches) | **25/70**, **21/70** and **7/92** fail, each named in the failure text |
| Truncated run (a check threw mid-run) | runner printed `incomplete run — 13 assertions, expected 70` and exited 1 |
| `tsc --noEmit` | clean |
| `npx tsx scripts/check-boundaries.ts` | 0 violations |
| `npm test` | **exit 0** — `Test Files 158 passed \| 2 skipped`, `Tests 1810 passed \| 5 skipped` |

### App-wide keyboard-focus inventory

The defect fixed here is a shared pattern, so it was inventoried across `src/` before deciding what
to touch. 63 outline suppressions; after checking each candidate by hand (the heuristic's false
positives were comments, container elements that are not focusable, `tabIndex={-1}` wrappers, and
elements whose replacement is a `:focus` box-shadow or `focus:bg-*` rather than a ring), **five real
offenders** remain, all with no visible focus indicator at all:

| File | Element |
| --- | --- |
| `src/components/DevConsolePanel.tsx:517` | `<select aria-label="Filter by error impact">` |
| `src/components/DevConsolePanel.tsx:534` | `<select aria-label="Filter by subsystem">` |
| `src/components/DevConsolePanel.tsx:642` | `<select aria-label="Trace session">` |
| `src/components/modals/HowToInspectModal.tsx:46` | modal close button (`✕`) |
| `src/components/modals/StructuralLegendModal.tsx:51` | modal close button (`✕`) |

Not fixed here: they are outside this tab, and the house idiom for the replacement is
`focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50`
(`ClinicalReportBar.tsx`, `ReportInspector.tsx`, `ReportBlocks.tsx`, `LiteratureView.tsx`).


The one suite failure is `server/routes/capabilities.test.ts > GET /capabilities — RaSP readiness >
does not call an uncounted index ready` (`expected 'unavailable' to be 'unverified'`) — a
server-side RaSP index-count concern. It cannot be caused by this change, whose surface is one
client component, one tools harness, two docs, one `package.json` script line and one CI job.

**Why the numbers above are dated, not durable.** They were taken on a working tree that other
agents were committing to *during* this session. An earlier run of this table reported
`1774 passed / 2 failed`, both in `AlphaGenomeTab.test.tsx`; that file and its test were then
rewritten and committed by another agent (`f85ae7c`), and the server-side RaSP failure above was
subsequently fixed by a third party too — the suite now exits 0. Do not read a file list or a bare
count here as current; re-run the command. (The same mistake appeared as a list of "other people's
uncommitted files", which was wrong within the hour.)


Not verified in this environment (sandbox blocks the piped child processes they need): the
`check-boundaries` and `npm test` runs, which were executed with an explicit escalation; and the
harness itself, which cannot run without one.

---

# Second review round

Reported items, in the reporter's words: **"black rings are unnecessary"**, **"the length badge next
to uniprot and interpro badge is discrepant!"**, **"the bottom section box: direct annotation … needs
polish and feature highlight in the seq tract"**, **"audit the feature and palette legend in the
inspector!"**, and **"What else?"**

Revision this section describes: the working tree at `HEAD` `f2ae4a7` (another agent's commit; this
work is uncommitted), with

| Path | SHA-256 |
| --- | --- |
| `src/components/evidence/FunctionInteractionsTabs.tsx` | `33D42FD7C1B060439FD9D78FCBDB951A42B4C0357F82E63762793586FDF5CC65` |
| `src/shared/featurePalette.ts` (new) | `5171FD160D2F096A2EDF277B80480381753A0B7E0029C3BD2250A7B62D4C3D9F` |
| `src/components/inspector/FeaturePaletteLegend.tsx` (new) | `8D7ADB647ECE54FB000930BD58300F610E0F28E00B3EAD1E1D0012CA1A1A2C5D` |
| `src/components/inspector/EvidenceInspector.tsx` | `A235529E564FD61BE82E04E29AB6280CB8D24395AE08BA1E716A89BEECCE2013` |
| `src/styles/typography-tables.css` | `31BD3EBB6A61832865A0C2C8DA7E62659DDD5FAC32E2A65F8E68074ACDDEC13E` |
| `tools/function-track-geometry/main.tsx` | `120DC52E71DDCC83F0BEAB6F4EDF8081E7FB265F950CF359395DDA7C5D6FF9CB` |
| `tools/function-track-geometry/check.mjs` | `33B5F163EF954B0619742C28B68CE8B7D1901ADD7C78DEAC0DE300EAA193C25F` |

The reports were all about one protein, **GZF1 / Q9H116 (711 aa), p.Arg591Trp**, whose shape is the
opposite of the CNNM2 case the first round was fixed against. Its record was fetched from
`https://rest.uniprot.org/uniprotkb/Q9H116`: 1 Domain (BTB, 31–103), 10 Zinc finger, 5 Compositional
bias, 2 Region (disordered), 1 Modified residue (phosphoserine 613), 2 Mutagenesis.

## 1. "Black rings are unnecessary"

The dark shapes were the **"Other Sites" pins**: 17 of them, in slate-600 (`#475569`), with a 1.5-unit
white stroke on a 3.5-unit radius disc — a dark core inside a pale rim, which is what reads as a
"ring" at this size.

The count was **not** a bug. 10 zinc fingers + 5 compositional-bias segments + 2 mutagenesis = 17, and
the screenshot's "17 Other Sites" is exactly right; the first reading of it as a discrepancy came from
a partial UniProt field list that had not requested `ft_compbias`. What the count *did* reveal is the
real defect: **15 of those 17 are spans**, not point annotations — a C2H2 zinc finger is 23–24
residues, a low-complexity segment 10–16 — and all of them were drawn as lollipops at their first
residue, which asserts that a 24-residue finger sits at one residue while putting fifteen near-black
dots on the track.

Fix — geometry, not colour:

- `featureGeometryFor(type)` in the new `featurePalette.ts` classifies each curated annotation as
  `band` (domains), `span` (transmembrane, region, zinc finger, repeat, coiled coil, compositional
  bias, motif, DNA binding) or `point` (everything else).
- Spans are drawn as thin bars in a **span lane** between the domain band and the site rail
  (`TRACK.spanLaneTop` 62, `spanHeight` 3.5, three tiers), packed by interval so nested spans — five
  low-complexity segments inside GZF1's two disordered regions — never hide one another.
- A span containing the variant gets an amber underline, because the bar alone cannot say "the
  variant is in here" once several bars share the window.
- Point pins keep the lollipop language. On GZF1 that is 3 pins instead of 17 dark dots; on CNNM2 it
  is 1 (the phosphoserine), because its three transmembrane helices became bars — the cyan pins in
  the first screenshot are now cyan bars in a lane.

Consequence for the chip row: `N Regions (not plotted)` became **`N Spans (span lane)`** — regions are
spans, and they are now plotted, so the old wording was both misleading and obsolete.

## 2. "The length badge … is discrepant"

The **value** was right: UniProt Q9H116 is 711 aa and the badge said 711 aa. The **chip** was the
problem. "Length: 711 aa" was `text-[9.5px] px-2 py-0.5 rounded` in muted grey on `--cs-surface-2`
while the neighbouring provenance chip used `.badge-data-source` — `2.5px 7px` padding,
`--cs-radius-badge`, `--cs-font-size-badge`, and a hard-coded blue. Side by side, two chips in one row
had different padding, radius, type size and colour language.

Fix: `.badge-metric` in `typography-tables.css` shares the provenance badge's box metrics exactly —
same padding, radius and font tokens, so the pair cannot present two different chip heights — and
differs only in tone, because one is a measurement and the other is a source.

## 3. The direct-curated-annotations box

The cards were read-only text: the box named the feature sitting at the variant while the track above
it showed the same feature with no way to connect the two. Each card is now a `<button>` that selects
its feature (the track's existing selection language: amber stroke on the bar, brightened band,
enlarged amber pin, inspector bar), with `aria-pressed`, a hover/focus affordance ("Highlight in the
track" / "Selected — highlighted in the track"), and the geometry made explicit — `Span 575–597
(23 aa)` versus `Residue 613` — so a span is not presented as a point in prose either.

## 4. The legend audit

The inspector's "Feature Types & Palette" legend is a hand-written list claiming to describe a track
painted from a different one. Audited line by line:

| Legend row | Legend swatch | Painted by the track |
| --- | --- | --- |
| Domains | indigo-500 | emerald gradient (`#059669`→`#047857`) — **wrong** |
| Active / Catalytic | rose-500 | rose-600 — close (500 vs 600) |
| Binding Sites | amber-500 | purple-600 — **wrong** |
| PTM Anchors | emerald-500 | sky-600 — **wrong** |
| Disulfide Bridges | cyan-500 | amber-600 — **wrong** |
| Transmembrane | *absent* | cyan-600 |
| Other Sites | *absent* | slate-600 |
| Span bars | *absent* | the category's own colour — and the row added for it below was **wrong too** |

Fix: one palette module, two consumers.

- `src/shared/featurePalette.ts` owns the kind keys, labels, chip classes, colours and predicates;
  the track paints from it and the legend renders from it.
- `FeaturePaletteLegend.tsx` renders the seven colour rows plus **two shape rows** (Point site, Span).
  The shape rows are deliberately monochrome: a span bar is painted in its *category's* colour, so a
  coloured swatch there would invent a fifth palette entry — which the first attempt at this fix did,
  in slate-400, while CNNM2's transmembrane bars are cyan.
- The "other" predicate is a true complement (`chain` and `region` excluded), not a catch-all: the
  first version made it match everything, which would have made that chip count the whole protein and
  its filter dim nothing.

## 5. "What else?" — found while auditing, not reported

- **The component kept a second copy of the category taxonomy.** Six predicates (`isActiveSite`,
  `isBindingSite`, `isPtmSite`, `isDisulfideSite`, `isTransmembraneSite`, `isRegionFeature`) and the
  six group lists built from them were computed on every render and **never consumed** — the palette
  had replaced them. Removed: exactly the drift hazard the legend audit was about.
- **A type assertion hid a real crash.** `INVENTORY_MATCHERS` was built with
  `Object.fromEntries(...) as Record<InventoryCategory, …>`, which suppressed a genuine
  argument-type mismatch (feature objects passed where type strings were expected). It threw at
  render time — the harness's new crash handler reported `Uncaught TypeError: (type || "").toLowerCase
  is not a function` instead of an empty report. The cast and the duplicate construction are gone.
- **The harness could not report a render-time crash.** A thrown render left `#geometry-result`
  empty, which the runner can only print as "no report" — no message, no stack. `window.onerror` /
  `unhandledrejection` now publish the exception into the same sink.
- **The harness screenshot was unusable.** The assertion report grew taller than the window, so the
  cases it exists to show fell below the fold; the report box is now capped and scrollable, and
  `TRACK_SHOT` captures every case.
- **Vocabulary.** "band row" (for the span lane) is gone; the chip says "span lane".

## Verification

| Layer | Result |
| --- | --- |
| `npm run test:geometry:function-track` | **137/137 pass** (6 cases, including the new real-GZF1 case and the legend) |
| Same harness, 7 defects reintroduced in 4 batches | **31/137**, **8/137**, **7/137** and **1/137** red; each named in the failure text. The unmutated revision is 137/137 |
| `tsc --noEmit` | clean |
| `npx tsx scripts/check-boundaries.ts` | 0 violations |
| `npm test` | **1 failed \| 163 passed \| 2 skipped** (166 files), **1 failed \| 1913 passed \| 5 skipped** (1919 tests) |

The single suite failure is `server/routes/capabilities.test.ts > GET /capabilities — RaSP readiness >
does not call an uncounted index ready` (`expected 'unavailable' to be 'unverified'`) — the
server-side RaSP index-count concern already documented in the first round's table, in a file this
change does not touch.

**One of the new guards was vacuous when first written, and the mutation run is what exposed it.** The
"a span containing the variant is underlined" check read *which* bars claim containment off the
rendered `aria-label` and then asked whether those same shapes were underlined — so forcing
`isEnclosing` to `false` made the expected set empty and the check passed. It now takes both the
expected span count and the expected enclosing count from the fixture.

**Not verified: what the render looks like.** Everything above is live geometry and computed colour.
Whether the span lane *reads* well — 3.5-unit bars, up to three tiers, a 13 px-wide shortest bar at
this container width — is a judgement about a picture. A vision-capable model was called to review
`tools/function-track-geometry/function-track.png` and returned nothing usable (the first call's
answer contained a GZF1 section it had no image for, and the retry returned `null`), so **the render
has not been visually reviewed by the agent that wrote it.** The screenshot is written by
`TRACK_SHOT=1` and the numbers above are the whole of the evidence.

---

# Third round — the open items, worked

Scope agreed by interview: the three guards that were missing, point-pin tiering by interval packing,
the WCAG 2.5.8 fix, wider interaction coverage, the stale cross-reference, and the pre-existing RaSP
test failure. **Regions stay as they are** (neutral colour, no category of their own, out of the
default match set and the flank vectors) — chosen explicitly when the scope list and the dedicated
question disagreed.

Revision: working tree at `HEAD` `4373d4d`, with `FunctionInteractionsTabs.tsx` at
`10053360FF60AD004591A1A2C00035E62A087806DF59D46EF3AE84A2BB57E8FC`,
`tools/function-track-geometry/{main.tsx,check.mjs,mutations.mjs}` modified, and `featurePalette.ts` /
`FeaturePaletteLegend.tsx` unchanged since `0250f18`.

## 1. Pin tiering is now interval packing

`siteTiers` assigned a tier by comparing each site with its **immediate predecessor** and cycling
`(curTier + 1) % 3`. That is not a packing rule: it never asks whether the tier it wraps onto is free.
It is now first-fit packing over the actual occupancy — each pin takes the lowest tier whose rightmost
pin is at least `TRACK.pinSeparation` (14 units) away — with a defined overflow policy: when all three
tiers are occupied the pin joins the tier whose rightmost pin is furthest left, the same policy the
span lane uses.

**What this does not claim.** The old rule passes the new guard too. A cluster dense enough for the
cyclic rule to collide is also dense enough to exhaust three tiers, where *any* assignment overlaps, so
the guard (`pins sharing a tier are not drawn on top of each other`) is a **regression guard**: what
fails it is ignoring tiers altogether. Packing is better because it is correct by construction and
because overflow has a stated behaviour, not because it separates more pins. Three tiers is a layout
budget; for a cluster that cannot be separated the answer is the control list below, not more tiers.

## 2. WCAG 2.5.8: the track's shapes as full-size controls

The pins are r=11 user units — about 28 CSS px at a 1010px container, but about 14 CSS px at the
container's `min-w-[500px]` floor, under the 24px minimum — and enlarging them is not available: at
875 aa adjacent pins are ~25 units apart, so r>12 makes neighbouring targets overlap and steal each
other's clicks. The fix the README has pointed at since the first round is now in place: a `<details>`
below the track listing **every annotation the track draws** (domains, span bars and pins alike) as a
full-width button at least 28px tall, keyboard-reachable through a real `summary` element, selecting
through the same `handleFeatureSelect` path the SVG uses. The `crowded` fixture exists partly for this:
six point sites inside eleven residues is a cluster no pointer can resolve on the track.

## 3. The three guards that were missing

| Guard | Was | Now |
| --- | --- | --- |
| Span-bar contrast | `checkNonTextContrast` sampled pins and the caret only. Span bars were compared with the *legend* but never with the surface, and on CNNM2 a transmembrane helix is a bar and nothing else | bars are sampled too; the assertion is `pin, span bar and caret colours clear 3:1`. Mutation: painting the bars slate-200 fails it with `span Curated span: Region Dis 1.17:1` — naming a span, which is what proves the sample is live |
| Badge box parity | the length chip and the provenance chip were fixed by sharing `.badge-metric`, with nothing measuring it | nine properties compared (height in CSS px, four paddings, radius, border width, font size, font weight). Mutated twice: restoring the old inline classes fails as `metric chip MISSING`; keeping the class and overriding the box fails as `height 17.5px vs 23.5px; paddingTop 1px vs 2.5px; fontSize 9px vs 11px` |
| Annotation row → track | the cards became interactive in the second round and nothing asserted it | activating a row must grow the matching pin head, change its fill, report `aria-pressed`, and clear again on the second click. Mutation: an inert row fails with `pressed=false, pin r 3.5→3.5, fill unchanged` |

## 4. Wider interaction coverage

Two cases added, and the fixture/expectation plumbing consolidated into one `payloadFor(kind)`
(the payload and its hand-counted expectations used to be selected by separate ternary chains in three
places, so a fourth fixture had to be added in all three or silently fall through to CNNM2):

- `crowded` — six point sites inside eleven residues, the only fixture where the tier assignment has
  anything to do and the only one that reaches the overflow branch.
- `zoomed2` — 2× from the N-terminus at p.Ala300Val, a genuinely different window (1–438) from
  `zoomed`'s focused 364–613.
- **Pan**, which the first revision of this round documented as uncovered and then covered: the
  scrubber is asserted to move the window *and* keep its width, driving the controlled range input
  through the native value setter and then putting it back. Both conjuncts are mutation-proven
  (`pan-ignored`, `pan-also-zooms`).

**A false claim this round shipped, and how it was caught.** The first revision of `zoomed2` also
clicked "Focus Variant", on the assumption that the two zoom-in clicks would set the scale. It does
not: `focusOnVariant` sets `min(5, max(2.5, seqLength / 250))` — 3.5× for these 875 residues —
discarding the clicks, so both zoom cases measured the *same* window (364–613). The README and commit
`3620ec6` said "a second window width" in good faith and it was wrong; the harness output for the two
cases is what exposed it, and the case now sets `focusVariant: false`. The lesson is cheap to state and
worth keeping: two cases producing identical measurements is a signal to read the measurements, not to
trust that two cases are two conditions.

## 5. The two items that were already done by other agents

- **The RaSP failure is fixed, not by me.** `7d1ab34 test(capabilities): arrange the RaSP index the
  readiness cases assert on` (three hours after the vitest run that reported it red) builds the missing
  index in the test instead of relying on a sibling suite's leftover — the assertion stays strict. The
  full suite in this round confirms it is green. Nothing here touches it.
- **The stale cross-reference is fixed, not by me.** `doc/RESIDUE_SHIFT_REVIEW_RESOLUTION.md` no longer
  calls this work "uncommitted and unverified"; a later commit names `0250f18` and says both
  workstreams landed on `main`. Nothing was left to correct.

## Verification

| Layer | Result |
| --- | --- |
| `npm run test:geometry:function-track` | **215/215 pass** (8 cases: + `crowded`, + `zoomed2`, + pan, + 4 checks per case) |
| Same harness, 8 defects reintroduced in 4 runs | **34/213** red for the five independent defects in one run; **8/213** for the badge-box override alone; **2/215** for each pan mutation. Restored files byte-identical (SHA-256) |
| `tsc --noEmit` | clean |
| `npx tsx scripts/check-boundaries.ts` | 0 violations |
| `npm test` | **2 failed \| 164 passed \| 2 skipped** (167 files), **2 failed \| 1930 passed \| 5 skipped** (1937 tests) |

**The two suite failures are not this surface, and are not a pre-existing defect either.** They are in
`src/components/evidence/__tests__/describeStructureSource.test.ts`, an **untracked** file in another
agent's in-flight working set at the time of the run: the test imports `describeStructureSource` from
`ResidueEnvironmentPanel.tsx` (also modified and uncommitted by them) and expects it to name an
AlphaFold model or an RCSB structure, while the implementation still returns the generic
`"the structure used for this analysis"`. The RaSP failure this round was asked to take *is* green. The
suite is therefore red, and attributing that correctly matters more than reporting a number.

**Still not verified: what the render looks like.** The control list adds 8–21 rows per case and the
`crowded` case adds nine overlapping pin pairs' worth of geometry; that they *read* well is a judgement
about a picture. No vision-capable review was obtained, so the numbers above remain the whole of the
evidence, and `function-track.png` is written by `TRACK_SHOT=1` for a human to look at.

---

# Fourth round — the coverage gaps, the derived count, and the region colour

Scope agreed by interview: close the three coverage gaps, derive the harness's expected count, consolidate
the two annotation lists, add legend assertions, extract the duplicated flank handlers, pin the
"Focus Variant" behaviour, give regions their own colour and legend row, add the house focus indicator to
five app-wide offenders, and fix the failing `describeStructureSource` test.

**Delivered in this round: the three coverage gaps, the derived count, the legend assertions, the
focus-variant pin, and the region colour.** The other three — consolidation, the flank-handler extraction,
and the app-wide focus offenders — are recorded below as not done, with the reason.

## 1. The coverage gaps, closed

| Gap | Was | Now |
| --- | --- | --- |
| Annotation-row wiring | asserted for the first row that mapped to a **pin** | asserted for one row of each kind: the pin head grows and changes colour, the domain band shows the highlight gradient while pressed, the span bar takes the amber selection stroke — each with the row's `aria-pressed` and the toggle-back |
| Pan | one position (0.9) | swept at 0.7 / 0.8 / 0.95 of the scrubber's range, each holding the width constant, the later two requiring rightward movement, then reset. The direction claim starts at the second position because where a case *starts* is "Focus Variant"'s doing (pan ≈ 0.58 for `zoomed`, 0 for `zoomed2`) |
| Pin-tier overflow policy | implied by "no two pins overlap" | the harness re-implements first-fit packing over the fixture's residues and the printed ruler and asserts the rendered tiers *are* that packing. `crowded` exercises it: six pins in eleven residues come out `[0, 1, 2, 0, 1, 2]` |

**These three checks failed their own first run, and all four failures were the checks' fault.** The
domain band is already on the highlight gradient when the variant sits inside it, so "the fill changed"
was the wrong claim for `tm`, `zoomed2` and `coverage`; and the row lookup matched on the start residue
alone, which is ambiguous on GZF1, where a disordered region and a low-complexity segment both begin at
residue 153 — it clicked one row and measured the other bar. Both were fixed by making the assertion
narrower and the lookup exact. Recorded because "the new guard failed" and "the app is broken" are
different findings and the first run did not distinguish them.

## 2. The expected count is derived, and each family is verified

`expectedCheckCount()` used to be `cases × 26 + zoomed + legend + self` — arithmetic that had to be
re-derived whenever an assertion moved (twice in two rounds) and that could only fail with a bare count.
Now `FAMILY_SIZE` declares each family's size, the count sums the families the plan says will run per case,
and `family()` checks every declaration against what the function actually returned. A family that is
declared but not wired into `runFamily` is a compile error, via a `never` assignment in that switch's
default branch.

The plan (`planFamilies`) is also the single place that decides which checks a case runs, so the
duplicated zoomed / non-zoomed branches in the runner are gone: one loop, one context, one dispatch.

## 3. The legend, measured where it is rendered

Two assertions added, and the first one had to be:

- **swatch contrast against the legend's own panel.** The palette was validated against the *track*
  surface (#FAF9F6); the legend sits on a card. Measured on the panel: domain 3.58:1, active 4.46, binding
  5.11, ptm 3.89, disulfide 3.03 (tightest), transmembrane 3.50, region 4.56, other 7.20 — all clear 3:1,
  and the ratios differ from the track's, which is the point of measuring.
- **swatch-vs-swatch distinguishability**, CIE76 ΔE\*ab with a floor of 12. The closest pair is
  `region`/`other` at **21.2**, which is the separation the new stone-vs-slate choice was made for.

## 4. Disordered regions get a colour, and still no chip

`featurePalette` gains a `region` kind (stone-500, `chipped: false`) and an optional `chipped` flag.
`FEATURE_KINDS` feeds the legend (eight rows now) while `CHIPPED_KINDS` feeds the chip row and the
inventory counts, so adding a kind for the legend's sake cannot silently add a filter. The harness's own
oracle gained a `region` branch for the same reason — otherwise the legend's colour check would have
looked for the region swatch among the "other" bars and found nothing.

## 5. "Focus Variant", pinned

`focusOnVariant` sets `min(5, max(2.5, seqLength / 250))` — 3.5× here — and discards the reader's zoom.
The interview decided that is intended, so it is now asserted rather than merely documented. The check
zooms *out* first: the `zoomed` case's own clicks already land on 3.5×, so without stepping away,
"jumps to the working zoom" and "keeps whatever you had" would be indistinguishable — which is exactly
how the previous round shipped a `zoomed2` that measured the same window as `zoomed`.

## 6. The two items that needed nothing

- **`describeStructureSource`**: its owner completed the implementation (`ResidueEnvironmentPanel.tsx`,
  committed) and the file, by then tracked, passes 6/6. Nothing was changed here.
- **The full suite is green**: 165 passed / 2 skipped files, 1934 passed / 5 skipped tests, exit 0 — the
  RaSP failure from the previous round and both `describeStructureSource` failures are gone.

## Not done in this round

- **Consolidating the two annotation lists.** The direction chosen was to keep the accessible control list
  as the single surface and fold the "Direct Curated Annotations at Position N" cards into it as an "at
  this position" filter. Not started: it removes a surface the harness reads (`checkPositionReadOut`
  targets the card heading) and the audit trail for that heading, so it wants its own round rather than
  being bolted onto this one.
- **Extracting the duplicated flank click/keydown handlers.** A behaviour-preserving refactor with no
  user-visible effect, and the lowest-value item on the list.
- **The five app-wide focus-indicator offenders** (three `DevConsolePanel` selects, two modal close
  buttons). Outside this tab, and not started in this round.

## Verification

| Layer | Result |
| --- | --- |
| `npm run test:geometry:function-track` | **246/246 pass** (8 cases; the expected count is now derived from the plan and each family's declared size) |
| Same harness, 3 defects reintroduced | **17/246** red for the batch (domain band 5, span bar 8, focus variant 1 plus a pan knock-on); the focus mutation alone, retuned to a single effect, **2/246**. Restored files byte-identical (SHA-256) |
| `tsc --noEmit` | clean |
| `npx tsx scripts/check-boundaries.ts` | 0 violations |
| `npm test` | **165 passed \| 2 skipped** (167 files), **1934 passed \| 5 skipped** (1939 tests), exit 0 |

**Still not verified: what the render looks like** — unchanged from the previous round, and the new
legend row and the control list's three-shape wiring are the parts a reader would notice. The interview
answer was that the reviewer will screenshot the app themselves.

---

# Fifth round — the three remaining items

The three items the fourth round left open: consolidating the two annotation lists, extracting the
duplicated flank handlers, and the five app-wide focus-indicator offenders. All three are done.

## 1. One annotation list instead of two

The tab carried both a control list of every drawn annotation and a card list of the annotations at the
variant residue — the same features, the same selection behaviour, saying the same things one surface
apart. The card list is gone and the control list now answers its question directly:

- a toggle, **"Direct Curated Annotations at Position \<pos\> (n)"**, narrows the rows to those covering
  the residue (9 → 1 on the CBS 1 case) and restores them on release;
- rows that cover the residue carry an **`at <pos>`** marker, because containment is not selection;
- the **absence sentence** moved with the framing, still gated on the payload having arrived — the
  round-one rule that a tab mid-retrieval must not claim a protein with three domains has none — along
  with the **"Filtered by \<chip\> (n matches)"** copy;
- the heading string was kept verbatim on purpose: `checkPositionReadOut` reads it, so the harness check
  survived the consolidation unchanged and now also asserts the filter.

Dropped, not moved: the card list's **"Nearest functional anchors"** row, which repeated the flank cards
directly above it. Also removed: the now-unused `ShieldCheck` import.

## 2. The flank handlers, four copies to one

`onClick` and `onKeyDown` each carried a full copy of the same 17-line selection body, for each of the two
flank cards — four copies, so a behaviour fix had to be made in all four or in none. `selectFlank(flank)`
is now the single implementation; the keyboard path is the same call plus `preventDefault` on the
activating key, which is the only difference that was ever real. Behaviour-preserving: `tsc`, the geometry
harness and the full suite are unchanged and green.

Honest scope: the flank cards' click behaviour is still **not asserted** by anything — the harness
measures the SVG track and the annotation list's rows, not those two cards. That was true before this
extraction too; the extraction did not weaken it, but it did not fix it either.

## 3. The five focus offenders, and an inventory that cannot rot

Three `DevConsolePanel` selects and the two modal close buttons suppressed the focus outline with nothing
replacing it. All five now use the house idiom —
`rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50`.

The hand-kept inventory in the first round's audit table is replaced by `scripts/check-focus-indicators.mjs`,
wired into `npm run lint`. It flags a `focus:outline-none` only when no `focus:` / `focus-visible:` ring,
border, background or shadow appears in the same string literal, because nine such suppressions are
correct (the literature search fields, the perturbation model cards, the view-resize handle, the
AlphaGenome search). It reports what it scanned — "9 outline suppression(s), every one with a replacement"
— and refuses to report success when it finds no source files at all.

Proven by reverting one fix: the check exits 1 naming
`src/components/modals/HowToInspectModal.tsx:46` and the exact className, then passes again once restored.
Its limit is stated rather than hidden: it is a text audit, so a companion declared in a *different*
attribute would be reported as missing.

## Verification

| Layer | Result |
| --- | --- |
| `npm run test:geometry:function-track` | **246/246 pass** (8 cases; the count did not move, because the new filter assertion was folded into the existing position-read-out family) |
| That harness, filter made inert | **1/246** red: `9 rows → 9 at position (marked 1); pressed=false` |
| `npx tsx scripts/check-boundaries.ts` | 0 violations |
| `node scripts/check-focus-indicators.mjs` | passes at 9 suppressions; fails naming the file and line when one fix is reverted |
| `tsc --noEmit` | clean |
| `npm test` | **165 passed \| 2 skipped** (167 files), **1934 passed \| 5 skipped** (1939 tests), exit 0 |

**Still not verified: what the render looks like.** The consolidation changes the tab's default shape —
one disclosure instead of a card list — so it is exactly the kind of change that wants a person to look at
it. The reviewer's answer remains that they will screenshot the app.




