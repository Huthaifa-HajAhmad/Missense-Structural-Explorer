# Charting and visualisation plan

Status: draft, 2026-10-04. Written to start a new thread; it is self-contained.
Origin: the Functional domains audit (`doc/FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT.md`, section D) and the follow-up
comparison of evilcharts, Amicro, shadcn chart (Recharts) and Vega-Lite.

## Decision already taken

| Need | Choice |
|---|---|
| Score rulers (predictors, ΔΔG, splice, perturbation, interfaces), feature schematic, splice map, assembly diagram, landscape strip | **Keep custom SVG.** Cut-point provenance and the shared residue axis are the point, and they are tested |
| Generic statistical charts | **Recharts through the shadcn chart pattern** (`ChartContainer`, `ChartConfig`, `accessibilityLayer`). Recharts 3.10.1 is installed and imported nowhere today, so no new runtime |
| Shared maths (ticks, scales, binning, colour ramps) | **d3-scale / d3-array / d3-shape** as pure helpers; rendering stays ours |
| Report export, agent-authored figures | **Vega-Lite, as a gated pilot only** (Phase 5) |
| evilcharts, Amicro, Nightingale | Not adopted (reasons in the audit doc) |

The rule that matters more than the library: **each tab builds its chart data as a typed model in
`src/shared/<tab>Evidence.ts` and the component only renders it.** Then the library is swappable and an agent can test a
figure without a browser.

## Goals

1. UX: generic charts get hover, keyboard access and a text alternative without hand-rolled SVG per tab.
2. DX: one themed wrapper, one set of tick/scale helpers, fewer hand-written axes.
3. AX: figure data is a pure, unit-tested model; the wrapper's props are small and typed; a new chart is a model
   plus a ten-line component.

Non-goals: rewriting rulers or schematics; changing any threshold, rule or clinical wording; adding a chart where a
number or a sentence is clearer.

## Phase 0: inventory and gate (no code in `src/`)

Write `doc/CHARTING_INVENTORY.md`: every figure in the app, its file, whether it is generic or domain-specific, its
data model location, its a11y state, and its test. Known starting list:

- Generic candidates: `src/components/LandscapeAgreementPlot.tsx` (162 lines, hand-built scatter with PP3/BP4 bands);
  the 20-residue distribution in `src/components/evidence/perturbation/ResidueDetail.tsx`; the profile line in
  `src/components/sequence/DensityTrack.tsx`; Population ancestry frequencies; any literature-by-year or predictor-spread
  figure found while inventorying.
- Domain-specific, keep: `ScoreRuler` (predictors), `DdgRuler`, `SpliceRuler`/`SpliceMap`, the perturbation and interfaces
  `Rulers`, `InterfaceTrack`, `LandscapeOverview`, `AssemblyDiagram`, `DomainArchitecture`.

Gate: for each generic candidate state what a library version would gain (hover, keyboard, a11y, fewer lines) and what it
could lose (exact band edges, per-point click, performance at about 3,000 residues). Proceed only where the gain is clear.

## Phase 1: the wrapper (`src/components/charts/`)

- `ChartFrame.tsx`: the shadcn `ChartContainer` pattern, reduced to what this app uses. Colours resolve only through
  `--cs-*` tokens (map `--chart-N` onto them in one place); no gradients, glow, entrance animation or Tailwind palette
  colours (design-system rules); `accessibilityLayer` on; a required `summary` prop that becomes the text alternative;
  a required empty-state string (absence is a state, not a blank plot).
- Dark mode: tokens switch with the theme, so nothing in the wrapper reads a theme flag.
- Tests: jsdom render with a fixed size (Recharts needs a sized container; mock `ResizeObserver` as the repo already does
  elsewhere), summary text present, empty state shown, no hard-coded colour in the rendered markup.
- Add the wrapper's folder to `scripts/check-boundaries.ts` if it needs a rule; run `npm run lint`.

## Phase 2: first chart, the 20-residue distribution

Why first: it is a plain bar chart, so Recharts clearly helps and nothing about it needs a custom axis.

- Model: move the distribution into `src/shared/perturbationEvidence.ts` (or the existing model) as
  `{ residue, prob, isNative, isMutant }[]` with the native and the variant marked; the component only maps it to bars.
- Keep the existing wording rules from the file header (the model's own odds, the native's rank, no band labels).
- Acceptance: same numbers on screen as today for the NAE1 reference variant; keyboard focus reaches the bars; a text
  summary names the native, the variant and the top residue; tests on the model and on the component.

## Phase 3: pilot, the Landscape agreement scatter

Honest note: the current plot is already decent (typed model, null points counted and omitted, dashed calibrated edges,
per-point titles). Replace it only if the library version wins on the gate below; otherwise keep it and record why.

- Use `ScatterChart` with `ReferenceArea` for the agreement corners and `ReferenceLine` for the calibrated Supporting
  edges, read from `PP3_BP4_CALIBRATION` (one source of truth; no copied numbers).
- Must keep: a distinct mark for the queried variant (diamond, clay), click-to-select a residue, selected-residue ring,
  the legend counts, "without both scores" counted not plotted.
- Gate: keyboard selection of a point works; 3,000 points render without jank (measure); the band edges are exactly the
  calibrated values; fewer lines than the 162 it replaces. If any fails, stop and keep the custom plot.

## Phase 4: shared maths with d3 modules

- Declare `d3-scale`, `d3-array`, `d3-shape` in `package.json` (they are transitive today via Recharts; do not rely on that).
- Replace `niceStep` (`architectureLayout.ts`) and `niceTicks` (`InterfaceTrack.tsx`) with one `src/shared/ticks.ts`
  built on `d3-scale`'s tick generator, keeping the output identical for the existing cases (add tests that pin today's
  ticks first, then change the implementation).
- Use `d3-array` bins for the variant bar track binning only if it removes code without changing the 219 geometry
  assertions.

## Phase 5: Vega-Lite pilot for Report export (optional, gated)

Only if the Report needs figures that cannot be drawn from the existing SVG components.

- Conditions: lazy-loaded chunk (vega-lite is about 85 KB gzipped, plus Vega); `vega-interpreter` so it runs under the
  production CSP (`script-src` has `'wasm-unsafe-eval'` only; see `server/express-config.ts`); headless render to SVG
  (`View.toSVG()`) in Node; a theme bridge that resolves tokens to concrete colours because the canvas renderer cannot
  read `var(--cs-*)` (the SVG renderer's behaviour is untested: test it first).
- Deliverable: one figure in the Report produced from a JSON spec, with a unit test that renders the spec headless and
  asserts the mark count. If the bridge or CSP work is larger than the benefit, drop this phase.

## Phase 6: skill and docs

- Add a "Charts" section to `.agents/skills/evidence-tab-refactor/references/design-system.md`: when to use the wrapper,
  when to stay custom, the model-first rule, the token-only rule.
- Update `references/data-presentation.md` section 4 (chart libraries) with the outcome.
- Record the result of each gate in `doc/CHARTING_INVENTORY.md`.
- Remove `recharts` from `package.json` if, after Phase 3, nothing uses it.

## Verification for every phase

`npx tsc --noEmit`, `npm run lint`, the full `npx vitest run`, and for any drawing that is not a Recharts chart the
geometry harness (`npm run test:geometry:function-track`; see `tools/function-track-geometry/README.md` for the
browser pitfalls). Render the touched tab in light, dark and about 800px and read the screenshot.

## Working notes for the new thread

- Do not commit unless asked; other agents leave uncommitted work in this tree (FoldX, energetics, tissue expression).
- Edit files with line endings preserved (`newline=''` in Python). The working tree is mixed LF/CRLF and git normalises
  to LF; the geometry mutations match on `\n`.
- Write patch scripts to a file with the Write tool rather than bash heredocs: apostrophes in a heredoc broke the shell
  several times.
- `fetchWithRetry(url, opts, retries, delay)`: `retries` is the attempt count, so `0` makes no attempt.
- Do not delete `scratch/`; it is gitignored dev scratch.
- Rules to keep: sentence case, UK English, `--cs-*` tokens only, no emoji, no glow or pulse, absence is a state,
  one source of truth per number (`src/shared/thresholds/`).

## Kickoff prompt for the new thread

> Read `doc/CHARTING_AND_VISUALIZATION_PLAN.md` and `doc/FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT.md` section D, then do
> Phase 0 and Phase 1. Stop after Phase 1 and show me the inventory and the wrapper before starting Phase 2.
