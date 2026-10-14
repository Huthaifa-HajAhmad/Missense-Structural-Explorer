# Evidence workspaces: Population, Predictors and AlphaGenome

9 October 2026. Continues the Landscape, Structure and Energetics visualization work.
The earlier reviews are treated as resolved. This pass changes presentation and interaction;
it does not change provider requests, prediction values, cut-points, votes or ACMG rules.

## Experience

All three tabs opt into the shared rounded two-pane frame. Main-pane pills switch between
the comparison and source records. Clicking or keyboard-selecting a value pins its exact
reading in the inspector above the existing rule trace, methods and sources. Source-record
names select the same keys. Open inspector expands a collapsed rail and transfers focus;
on narrow screens the panes stack, while wide figures and tables scroll within their cards.

Tab view, pinned key, feature filter and expanded record groups survive navigation. State
is scoped to the analysed variant, accession, transcript and genomic allele/build; a changed
scope resets it synchronously without remounting the other workspace canvases. Hover is
temporary and cannot change the pin or the queried substitution.

| Tab | Primary figure | Interpretation preserved |
| --- | --- | --- |
| Population | Source frequencies on a log axis, labelled consistently in percent | The engine input is a separate row, never another cohort. It cannot inherit a source's counts. Reported zero, confirmed absence, partial counts and provider failure remain distinct. |
| Predictors | Published strength categories with one dot per calibrated reading | Raw scores are not normalised onto a common scale. Tools without published bands stay outside the plot. Informational plotted tools carry an asterisk. Vote and calibrated-reference disagreement remain visible. |
| AlphaGenome | Signed contributions, ordered by absolute magnitude, with feature-family filtering | Sign describes movement of the raw AVI score, not biological direction or pathogenicity. Filtering changes neither domain nor contribution shares. Missing and zero remain distinct. |

AlphaGenome adds a compact, expandable three-step guide and a glossary for AVI, Phred,
SHAP and contribution shares. The reading inspector explains each selected feature and
the limits of its interpretation. Atlas links retain their existing GRCh38 checks.

## Findings addressed while presenting the new charts

| Finding | Change | Regression check |
| --- | --- | --- |
| Mixed percentage/fraction labels obscure a log comparison | Every frequency-chart tick and readout uses percent; inspector retains the supplied fraction | `src/test/evidenceComparison.test.ts` |
| A ladder row without any published band could appear at “Neither” | Such rows are inspectable outside the calibrated plot | Same model suite |
| AlphaGenome shares were described as percentages “of the score” | Wording now names reported absolute attribution magnitude | Model and AlphaGenome tab suites |
| An empty/partial attribution vector could read as a complete all-zero vector | Finding explicitly reports missing coverage; an empty vector gets its own statement | Model suite; `EvidenceTabs.integration.test.tsx` |
| Source records asserted returned contributions sum to the raw score even with partial coverage | Show the reported raw score separately; report attribution coverage | Existing AlphaGenome tab/rail suites |
| Small non-zero contributions rounded to zero in a compact readout | Scientific notation below 0.001; inspector retains all supplied digits | Model suite |
| Contribution stems and pin rings created duplicate keyboard targets, including a stem midpoint | Only value dots own interaction; other geometry uses TanStack `decorative` | Real-renderer keyboard test; browser Splicing → RNA-seq navigation |

## Architecture

- `src/shared/evidenceComparison.ts`: typed, pure adapters over the existing frequency,
  predictor/ladder and AlphaGenome evidence models. No new scientific classification.
- `EvidenceComparison.tsx`: lazy-loaded TanStack figure using the existing `ChartFrame`
  and token theme. No additional chart dependency.
- `EvidenceWorkspace.tsx`: scoped display state, main-pane navigation, record selection
  and inspector focus requests. No provider data is stored here.
- `EvidenceReadingInspector.tsx`: selected reading above each existing tab-specific trace.
- `src/styles/evidence-workspace.css`: shared presentation under `evw-`; tab styles retain
  ownership of their existing figures, tables and traces.

## Verification

- `npm run lint`: architectural boundaries, focus indicators, verify parity and TypeScript.
- Full bounded-worker Vitest run: 344 files passed, 2 skipped; 4,386 tests passed, 5 skipped.
- Production client build passed; existing large-chunk warnings remain. The Evidence
  comparison is a separate lazy-loaded chunk and shares the installed chart runtime.
- Real-renderer tests cover keyboard pinning, filtered-out pins, zero versus missing,
  record/chart round trips, per-tab state and variant resets. Integration tests render
  each production tab with its real inspector.
- Browser review uses the real `AppViews` and inspector with labelled illustrative data:
  full/partial attributions, zero, missing providers and a new variant; light/dark;
  desktop, 800px and 390px; keyboard and record selection; filter/view persistence;
  inspector collapse/reopen and focus. No page overflow in the three record views at 390px.

Live scientific services were not rerun. The preview blocks `/api/` calls, including calls
from other mounted workspaces; their blocked-request console messages are expected.
The fixture's illustrative values are not clinical evidence or a validated provider response.

## Sources and retained scientific contracts

- AlphaGenome Atlas methods: Cheng, Taylor et al. (2026, preprint),
  [doi:10.64898/2026.09.16.26363192](https://doi.org/10.64898/2026.09.16.26363192).
- Existing population decisions and sources: [Population review](POPULATION_FREQUENCIES_REVIEW.md).
- Existing predictor calibration decisions and source DOIs: [Predictors review](PREDICTORS_TAB_REVIEW.md).
- Existing AVI provenance and reference-frame decisions: [AlphaGenome review](ALPHAGENOME_TAB_REVIEW.md).
- Installed TanStack Charts 1.1.0 documentation, `docs/concepts/marks-and-layering.md`,
  supports decorative geometry without duplicate interaction targets.

Gene–disease, Expression & Models and the remaining Evidence tabs are outside this batch.

Subsequent presentation pass, 14 October: Population Data, Predictors and AlphaGenome were revisited together with Expression. See [the population-led batch review](POPULATION_VISUALIZATION_BATCH_REVIEW.md) for direct labels, categorical bands, bounded contribution exploration and current verification. The scientific contracts above still apply.
