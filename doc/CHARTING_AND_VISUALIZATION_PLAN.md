# Charting and visualisation plan

## Active direction — 13 October 2026

**Objective:** make each workspace explain its finding through an appropriate figure, with a clear
route to the records behind it. The quality reference is
[Nizam's dashboard walkthrough](https://x.com/nizamdesign/status/2109728308237631619).
Read [the reference analysis and screen specifications](VISUAL_STORYTELLING_REVIEW.md) before implementation.

The previous phases below are retained as history. **They are not the active execution sequence.**
The old Recharts decision, library-first pilot and wrapper-only kickoff are superseded here.
Existing scientific contracts and verified fixes remain authoritative.

Status, 14 October: Energetics plus a four-tab presentation batch (Population Data, Predictors, AlphaGenome, Expression) are implemented and visually checked in the production-component preview. The batch adds source-specific count labels, a predictor band matrix, bounded contribution exploration and directly labelled tissue measurements. See [the batch review](POPULATION_VISUALIZATION_BATCH_REVIEW.md). Remaining workspace families and human reader-comprehension validation are still pending.
Scope assumption: the whole analysis workspace, delivered through one finished reference screen and then coherent families.

### Why the delivery process changes

The original plan primarily optimised chart infrastructure and implementation checks. It did not
specify a compelling complete screen or a test of whether the reader could understand its finding.
Current components provide useful models, interactions and biological maps, but adding a chart beneath
an existing stack of summaries does not by itself deliver the reference's clarity.

Design and verify the reading sequence: **finding → visual explanation → supporting records → next inspection**.
Share figure furniture and selection behaviour; choose the figure's geometry for its scientific question.

### Stack and scope

- Keep React, the existing CSS tokens and typefaces, TanStack Charts already used in production, and
  custom SVG for biological/positional geometry. No new chart dependency is required for this rollout.
- Keep pure shared evidence models and current rule-engine records. Add presentation derivations only
  where needed, with explicit units, contributors, missingness and source identity.
- Preserve existing pins, source-record views, inspector navigation, contextual explanations and
  variant/transcript reset contracts. No wholesale framework rewrite or global cosmetic restyle.
- The visual standard does not authorise new clinical criteria, synthetic probabilities, invented
  uncertainty, pooled raw predictor scores, or unsupported model outputs.

### Milestones and concrete deliverables

| Order | Deliverable | Completion evidence |
| --- | --- | --- |
| 1 | Capture current real-shell screens and assemble representative fixtures: dense, sparse, missing, disagreement, exclusions | Named fixture/data sources, baseline screenshots, current limitations; illustrative fixtures visibly labelled |
| 2 | Finish **Energetics** as the reference screen: compact finding, dominant direct-labelled estimate comparison, visible exceptions and a purposeful drilldown | Production component, model/interaction checks, before/after screenshots, light/dark/narrow review and recorded comprehension assessment |
| 3 | Finish **Predictors**: categorical band comparison first, compact engine finding, voting/reference context and native-score inspection | No summing unlike scores; existing engine parity, selection and source-record tests retained; complete screen visibly reviewed |
| 4 | Carry the pattern into **Population and AlphaGenome** using frequency/coverage comparisons and diverging contributions respectively | Separate figures suited to each question; zero/missing/partial coverage and source identity verified |
| 5 | Refine **molecular and mechanism workspaces**: residue profiles, domains, splicing and interfaces | Geometry and mapping contracts preserved; dense cases aggregated; selected feature/record/inspector linkage checked |
| 6 | Refine **context, Landscape, Insights, Literature, 3D and reports** around their own reading tasks | Cross-view context retained; no invented aggregate certainty; exported figures keep relevant identity, units, sources and caveats |
| 7 | Consolidate only the patterns that succeeded on the finished screens | Updated design references and per-family reviews; every claimed completion links to actual validation evidence |

Milestones are implementation boundaries, not automatic permission prompts. Carry out the authorised
scope, preserve unrelated working-tree changes, and use scientific owner decisions only where an
actual classification rule would change. A visual failure calls for another design iteration, not a
new library by default.

### Acceptance gate for every screen

At a 1440 × 900 viewport in the real shell, the finding and primary figure should be visible together.
The figure must explain the main comparison, label important values and expose the material exception
without requiring hover. On a narrow screen, the figure follows the compact finding and supporting
details follow it. These are local design targets, not scientific thresholds.

Before marking a screen complete, answer and verify:

1. Can the reader state what was found, compared with what, and with which important limitation?
2. Does the figure show that relationship more clearly than the previous screen?
3. Are exact values, missingness, exclusions and source records accessible through working controls?
4. Do pointer/keyboard selection, inspector linkage, navigation persistence and new-variant resets work?
5. Have the actual production wrapper and styles been inspected in both themes, at desktop,
   approximately 800 px main-column width, and 390 px viewport width?
6. Have appropriate automated checks passed, with unrelated failures identified rather than concealed?

Record **scientific correctness**, **interaction verification**, **visual review**, and **reader comprehension**
separately. Automated tests alone cannot mark the last two complete. If the browser cannot render,
record that limitation and leave visual acceptance pending.

### Current-pass record

The video was inspected through one-second snapshots across its 23-second duration. Current source
and saved October 11 screenshots were reviewed; a fresh integrated-browser render timed out and
remained blank. This pass updates the plan and adds `VISUAL_STORYTELLING_REVIEW.md`; it does not claim
production UI changes, a fresh visual pass, or a completed workspace rollout.

**14 October continuation:** the saved operations above were verified rather than repeated. A fresh
Vite preview restored browser access. Energetics now has a compact finding, directly labelled
estimates and stems showing distance from zero; sparse results have qualified headlines. See
[the implementation and verification record](ENERGETICS_VISUALIZATION_REVIEW.md#14-october-2026--visual-storytelling-reference-pass).
This is a first production example of the revised direction, not completion of the whole rollout.

---

## Historical plan and implementation notes — not the active rollout

**11 October 2026 update:** RNA splicing and Interfaces & PPI now use figure/records workspaces,
persistent reading inspectors and purpose-built biological maps. Interfaces adds separate support
comparisons by structural context. No charting dependency was added. See
[the second-pass design and verification record](MECHANISM_WORKSPACES_REVIEW.md).

**9 October 2026 update:** Energetics now uses TanStack Charts 1.1.0 in production, with a shared
figure shell, CSS-token theme and pure evidence-to-chart model. See
[the implementation and verification record](ENERGETICS_VISUALIZATION_REVIEW.md).
This supersedes the generic-chart library choice and pilot sequence below; the original draft
remains as design history. Tested custom biological rulers and schematics remain in use.

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

## Principles

Scientific truth, traceability, legibility and visual polish are the order of priorities.
Use the evidence-tab-refactor skill and its `references/data-visualization.md` checklist.

1. Match charts to the question: score rulers for evidence bands, shared-axis dot plots for
   comparable model channels, and positional maps for locations and transcript annotation.
2. State units, reference frames, score ranges and exact boundary inequalities.
3. Keep attribution, prediction and observation visually and verbally distinct.
4. Treat zoom and local display filters as view state; show reporting windows separately.
5. Preserve out-of-view and small non-zero values in arrows and accessible exact-value details.
6. Render the shared pure evidence model; keep provider calls and engine classification separate
   from visualization controls. Verify display changes cannot alter the evidence outcome.

## RNA splicing — implemented

- Exon termini distinguished from splice junctions; no inferred AG/GT motif labels.
- Four channel dot plots share a linear 0–1 scale beside the positional map.
- Variant-centred transcript-direction positions are labelled separately from donor/acceptor numbering.
- Taller labelled SpliceAI delta lane, full 0–1 range and optional explicit 0–0.3 focus, permitted
  only when all available scores (including unpositioned channels) fit.
- Scores without delta positions remain in exact-value details and have an explicit omission notice.
- Zoom/focus resets when the transcript changes; same-transcript re-scoring retains view settings
  while forcing a full score axis if the focused range cannot contain the new scores.
- Independent map zoom; directional arrows and exact offsets for predictions outside the view.
- Explicit default display filter (delta >= 0.01), optional inspection of smaller non-zero signals.
- Exact-value tooltips with keyboard-accessible native details.
- Hero ruler prioritizes the splicing evidence bands; authors' operating points remain secondary.
- AlphaGenome attribution remains informational. ACMG engine behavior is unchanged.

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
