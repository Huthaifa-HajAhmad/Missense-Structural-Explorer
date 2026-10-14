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

## 14 October 2026 — visual storytelling reference pass

The prior implementation delivered a working comparison, but its header and finding pushed the lower
methods below the first desktop viewport. Values required interaction. This pass implements the first
reference improvement from `VISUAL_STORYTELLING_REVIEW.md`, retaining the existing shared evidence,
canonical signs, units, local guides, inclusion rules and inspector.

| Presentation finding | Change | Validation |
| --- | --- | --- |
| Finding furniture displaced the explanatory comparison | Compact two-column finding at wide widths; stacked on narrow widths; help beside the workspace title | Before/after browser inspection of real AppViews at 1440 × 900; all six points and the axis now visible together |
| Individual values were hidden behind hover/pinning | Persistent text labels from `signedDdg`, with units on the shared axis; subdued zero-to-value stems | `energeticsComparison.test.ts` verifies zero, sign and conversion; `EnergeticsComparison.test.tsx` verifies visible labels before interaction |
| New geometry could create duplicate keyboard positions | Decorative labels, stems and pin rings; value dots remain selection targets | Real-renderer Home/Enter/ArrowRight test reaches the next estimate, not the same estimate's annotation |
| Promoting a direction chip could overstate sparse evidence | Shared presentation headline qualifies zero, one and two usable estimates before giving direction | Model test includes returned-but-excluded FoldX and true zero; single/missing browser fixtures |

No new scientific model, metric, threshold or rule was added. The existing ΔΔG explanation remains
reachable beside the header, and all values still refer to the queried substitution. Cross-method
spread is not drawn as an error bar. The large heading for insufficient evidence is presentation-only;
it does not modify the existing engine agreement or source-record call.

Validation:

- `npm run lint`: passed, including TypeScript, boundaries, focus indicators and verification parity.
- Full `npx vitest run --maxWorkers=4`: 362 files passed, 2 skipped; 4,636 tests passed, 5 skipped.
  The final sparse-headline refinement followed that run; the four relevant suites were then rerun:
  53 tests passed. Logs: ignored `scratch/visual-story-vitest.log`.
- `npm run build:client`: passed; existing large-chunk warnings remain. Log:
  ignored `scratch/visual-story-build.log`.
- Fresh shared-browser preview at `/tools/energetics-preview/index.html`: light/dark, desktop 1440 × 900,
  800 px and 390 px viewport widths; disagreement, single, missing, excluded and extreme fixtures;
  kcal/mol and kJ/mol; keyboard pinning, source-record round trip, inspector parity and retained filtering.
- At 390 px, DOM geometry checks found no overlapping SVG text, no labels outside the SVG and no
  document-width overflow for the extreme fixture. The full chart follows the finding on a phone;
  it is not all visible in the first phone viewport.

Screenshot artifacts inspected during this pass:

- Before: `C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/2287aea2-3a5c-49f9-aba1-1dd7ac37f421.png`.
- After, FoldX selected: `C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/6f1ec694-6fea-46d4-954d-91d6d82e5709.png`.
- 800 px dark: `C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/c9c8ab1a-fd00-4189-8d2b-ba4aa098e4d3.png`.
- 390 px dark: `C:/Users/HSA19/.synara-beta/codex-home-overlay/generated_images/browser-proof/c758914d9c6237f5e854db00/7c0e1017-0433-4396-b8f9-c1e5407bb6ef.png`.

Limitations: fixtures are explicitly illustrative and provider calls remain blocked. This harness
renders production AppViews, styles and inspector, but not the global search/navigation shell. Human
reader comprehension has not been tested. The wider workspace rollout and any full-shell layout
acceptance remain open; this pass does not claim parity with the reference video across the app.
