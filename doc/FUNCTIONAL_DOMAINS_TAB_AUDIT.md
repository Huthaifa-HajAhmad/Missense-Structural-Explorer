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
  geometry: 70 assertions over four cases, all passing.
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
