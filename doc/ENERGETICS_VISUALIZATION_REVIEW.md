# Energetics visualization workspace

9 October 2026. Extends the committed Landscape fixes (PR #87) and shared Structure workspace
(PR #88). No prediction, sign-normalisation, exclusion, consensus or ACMG rule was changed.

## What the researcher sees

- Comparison is the default: a TanStack Charts dot plot on one signed, linear energy axis.
  Each row is a method. Zero is a reference line; negative means more stable folding and positive
  means less stable folding. The axis expands for extreme values instead of clamping them.
- The finding states agreement in plain language. Low template confidence, unrepaired templates
  and excluded estimates remain visible above the chart. Returned values and counted values are
  reported separately; an excluded value still returned.
- Filled dots are counted estimates; hollow dots are excluded estimates. Missing values have no
  point and an inspectable state. Optional dashed guides are each method's app-defined
  destabilising mark, explicitly not a clinical cut-point or an uncertainty interval.
- Hover or keyboard focus previews an exact value. Click, Enter or Space pins a method in the
  persistent inspector. Engine records offers the detailed table and original method rulers.
  The Inspector button also expands a collapsed inspector and moves focus to its selected method.
- Sort, filter and guide controls survive switches between Comparison and Engine records. The
  pinned method survives workspace navigation; a new gene/variant/accession resets it. Selecting a
  method never changes the queried substitution or shared protein-residue selection.
- Both energy units use the same conversion for points, guides and bounds. Display filtering does
  not change agreement or the full-data axis. The figure explains its own limits for newcomers.

## Visualization system and stack decision

**Adopted `@tanstack/charts` 1.1.0 for this production view.** This completes the previously deferred
evaluation with a shipped integration, not a mock chart. React SVG rendering, linear scales,
keyed selection, focus rings, keyboard navigation and responsive sizing work in the preview.

- `components/charts/ChartFrame.tsx`: labelled figure, visible instructions, accessible summary,
  explicit empty state and caption. Use it for future statistical charts.
- `components/charts/chartTheme.ts` and `styles/charts.css`: shared token-based styling. SVG paints
  resolve CSS variables directly, so light/dark changes cannot leave a stale colour snapshot.
- `shared/energeticsComparison.ts`: pure chart data and geometry, reading canonical values and calls
  from `energeticsEvidence.ts`. The library owns plotting; the shared model owns scientific meaning.
- `components/energetics/EnergeticsComparison.tsx`: interaction and display controls only. The
  library is lazy-loaded with the figure; the final production chunk was 110.35 kB
  minified / 37.88 kB gzip, including this component and its chart dependencies.

Recharts remains installed for existing project compatibility; no second chart engine was added
to this view. There is no reason to migrate tested biological schematics solely for stack uniformity.

## Scientific and interaction checks

| Contract | Check |
| --- | --- |
| Normalised signs, true zero versus missing | `energeticsComparison.test.ts` |
| Excluded estimate visible but not counted | Same model suite, plus existing Energetics suites |
| Full domain contains extreme values and guides | Model suite; Extreme browser fixture |
| Unit conversion and distinct guide readout | Model suite; browser unit switch |
| Keyboard pinning through real TanStack renderer | `EnergeticsComparison.test.tsx` |
| Empty/filter state never fabricates zero | Same component suite |
| Table-to-inspector selection, control persistence, query reset | `ExplorationWorkspace.test.tsx` |
| Existing engine calls, provenance and error wording | Existing view, inspector and label-guard suites |

Browser review uses the production `AppViews`, inspector and settings with explicitly labelled
illustrative data at `/tools/energetics-preview/index.html`. Scenarios cover disagreement, a single
estimate, missing results, excluded FoldX and extreme values. Checked light/dark, desktop, 760px
and 390px widths, keyboard selection, tab round trips, units and inspector focus. No new live
provider job is needed for a presentation change; live computation was not rerun.

Final verification: `npm run lint` passed, including TypeScript, architectural boundaries, focus
indicators and verification parity. `npx vitest run --maxWorkers=4` passed: 340 files passed,
2 skipped; 4,332 tests passed, 5 skipped. The first unrestricted run had two unrelated timing
failures; both passed individually and in this complete bounded-worker run. Interrupted runs
were not counted as successful. A final desktop browser check confirmed keyboard pinning and
the matching FoldX inspector using the illustrative fixture.
`npm run build:client` also passed; existing large-chunk warnings remain for other application bundles.

## Sources

- [TanStack React Chart API](https://tanstack.com/charts/latest/docs/framework/react/reference/chart)
- [TanStack focus and selection](https://tanstack.com/charts/latest/docs/reference/focus-and-interaction)
- [DDMut's single-mutation example](https://biosig.lab.uq.edu.au/ddmut/results_prediction/example_single)
  demonstrates the provider's negative-destabilising convention; existing canonical conversion is reused.
- [FoldX RepairPDB documentation](https://foldxsuite.crg.es/command/RepairPDB) supports the unrepaired
  template caution. Existing method provenance and references remain in `ENERGETICS_TAB_REVIEW.md`.

All drawn decision guides come from the existing engine descriptors. No published clinical
calibration or per-variant confidence interval is asserted.
