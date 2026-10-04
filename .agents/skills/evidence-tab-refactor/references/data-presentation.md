# Data presentation: output delivery, density and interaction

The integrity checklist asks *is it true*. This one asks *does it reach the reader*. The backend may fetch
everything. The screen shows what answers the tab's question, and the rest is one hover or one click away.
Worked example: `doc/FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT.md` (SOD1 p.Ala5Val, 118 features, 81 variants).

## 1. Deliver, don't dump

- **The model aggregates, the component renders.** Counts, densities, clusters, "exact match vs other at
  this position", "nearest of kind X", tidy labels: all computed in `src/shared/<tab>Evidence.ts` (or on the
  server when the shared model would need data it lacks). A component that filters or sorts raw provider
  rows to make a sentence is a defect.
- **Route by meaning, not by source name.** Use the provider's own type field (InterPro entry type, UniProt
  feature type and ligand, ClinVar review status). If the payload lacks that field, add it on the server.
  A hard-coded database list misroutes (PROSITE patterns drawn as domains).
- **Name the query's own record first.** If a source lists the variant itself (UniProt natural variant,
  ClinVar, literature), find the *exact* match, not the first one at the position, and keep its full
  text. Never truncate after the first `;`.
- **Numbering the reader will search by.** When the payload shows a removed initiator Met, a signal
  peptide or a propeptide, show the mature-chain position once, labelled as such, next to the HGVS one.
- **An evidence label means one thing per row kind.** ECO:0000269 on a site is an observation. On a
  variant it is a publication. Use different words when the meaning differs (risk: reading it as PS3).

## 2. Density budget (check on the densest real variant, not the reference one)

Pick the most crowded real case for the tab (for features: a short, saturated protein such as SOD1 or
TP53) and check:

| Check | Pass |
|---|---|
| Marks of one kind in view | ≤ ~30 individually drawn. Above that, aggregate (density bars, bins, a count). |
| Labels dropped | 0 that matter. Labelled: the variant, its same-position records, the densest cluster. Everything else on hover. |
| Visual channels | One per meaning: lane = type, colour = the one finding (clay variant, red disease), shape at most two. Never encode evidence level in 6 px fill. |
| Uninformative marks | Not drawn. A span covering ≥ 80% of the chain, a constant, an all-the-same strip goes in the table or rail. |
| Table rows by default | ≤ ~20 per group. Collapse by entity (one row per residue, listing its substitutions), lead with a summary row, pin the at-variant rows. |
| Repeated text | None: no chip that restates a column ("includes 5" beside "inside"), no rail paragraph that restates the tab. |
| Rail | Rule trace + cut list visible. Method text behind one disclosure. Only the legend entries this variant uses. |

## 3. Interaction (minimum for any tab with a figure)

1. Linked highlight: figure ↔ table row ↔ 3D (hover lights, click selects, selection scrolls into view).
2. A legend that toggles layers, each entry with its count.
3. Zoom by brushing an overview where position matters. Presets stay as buttons.
4. Keyboard: arrows step through marks, Enter opens; hit targets ≥ 24 px (aggregate if marks are denser).
5. Window and selection in URL state.
6. Motion only to show a change of state (≤ 150 ms, respects `prefers-reduced-motion`). No entrance animation.

## 4. Chart libraries

Custom SVG on the tab's own scale is the default for positional or biological drawings (ruler, feature
schematic, lollipop/density). A generic chart kit is acceptable only for a genuinely generic chart (a
histogram, a time series) and only if it can be themed fully through `--cs-*` tokens with glow, gradient
and entrance effects switched off. Evaluated so far:

- **evilcharts** (shadcn + Recharts; Bar/Line/Area/Pie/Radar): no for evidence tabs. Its look breaks
  the token and no-glow rules, and its scale cannot share the residue axis.
- **recharts**: listed in `package.json`, unused in `src/`.
- **@nightingale-elements** (EMBL-EBI feature viewer): the candidate if a protein track library is wanted.
  Not adopted, theming unverified.

## 5. Regression guard

Every fix in a `doc/<TAB>_REVIEW.md` names the test that pins it. Merges have reverted untested fixes
(the header's Missense Z "Tolerant" label: fixed in 93ee30b, reverted in 14f1bf2).

## 6. Worked patterns (Functional domains, SOD1 p.Ala5Val)

Copy these rather than reinventing them; each has a test.

- **Aggregate past a threshold, export the threshold.** `DENSE_ABOVE` / `DENSE_BELOW` and `drawingMode()` in
  `architectureLayout.ts`: the layout, the caption and the legend all ask one function which drawing a window uses.
- **Bar track for a distribution** (81 variants, 58 residues): one bar per residue, height = count, the query's own bar in
  the accent colour, one number above the tallest. Bin residues when a bar would be under ~3px.
- **Lanes by kind** for many point marks: a fixed row order, a fixed shape per row (diamond, circle, tick), no stems,
  labels only where they cannot touch another mark. Two sub-rows when marks are closer than 9px.
- **Fold repeated rows by entity** (`variants-<residue>`): the drawing keeps one mark per record and points each at the
  folded row (`rowKey`), so hover, selection and the URL all use the table's key.
- **Layers as toggles with counts** in the legend; the drawing filters rows through `layerOf()` before layout.
- **Linked hover** by a shared `hoverKey` state (`data-lit` on both sides); selection scrolls the row into view.
- **Brush to zoom** on the axis and the overview; a click on the overview recentres. Leave a frame between pointer
  events in tests, because the drag reads its state from the last render.
- **URL state** per tab (`viewUrlState.ts`): read once, applied to the variant the tab opened on, written on change,
  removed on unmount, validated against the protein length.
- **Name the legacy number** (`processedChain`): context only, never presented as the HGVS name.
- **Check the densest real protein** with a harness case at desktop and phone width, and assert counts from the fixture,
  not from the layout.
