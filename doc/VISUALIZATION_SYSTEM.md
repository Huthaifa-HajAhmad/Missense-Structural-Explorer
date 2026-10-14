# Scientific visualization system

## Reading sequence

Every workspace should let a reader move from **finding → figure → exact record → next inspection**. Put a concise, data-derived finding above the main visual. Keep disagreements, missing coverage and interpretation limits visible. Secondary methods, configuration and long records belong beside or below the figure, or in labelled disclosures.

The reference is a complete result screen, not a chart library demo. Choose the visual for the scientific question; do not make every source look like the same dashboard.

## Responsibilities

| Layer | Owns | Must not do |
| --- | --- | --- |
| Shared evidence models (`src/shared`) | Returned values, provenance, availability, engine records, scientific interpretation | Infer new clinical decisions from presentation filters |
| Presentation models (`evidenceComparison`, `energeticsComparison`, context and molecular workspace models) | Display coordinates, canonical labels, complete-data domains and inspectable row keys | Pool unlike scales, invent uncertainty or replace missing values with zero |
| Figure components | Geometry, direct labels, legends, bounded exploration, keyboard interaction | Reclassify evidence or recompute denominators from visible rows |
| Workspace state | View, pin, display filters and disclosure state, scoped to the analyzed allele | Change the scientific rule or silently discard a hidden pin |
| Inspector and source records | Exact selected record, meaning, source and limitations | Substitute a different source for the plotted value |

`ChartFrame` supplies accessible titles, summaries, empty states and figure captions. TanStack Charts handles quantitative axes and interaction. Use purpose-built SVG/HTML for categorical matrices, sequences, domains and biological topology. Shared furniture does not require identical geometry.

## Figure vocabulary

- Population: positive allele frequencies on a logarithmic axis; direct frequency and matching AC/AN labels. Distinguish the engine input from cohorts. Zero, confirmed absence and unavailable sources retain separate states.
- Predictors: categorical published evidence bands with native scores shown separately. Tool agreement is not a sum of independent evidence.
- Energetics: signed estimates on common canonical units, explicit zero and directly labelled endpoints. A zero-to-value stem is not a confidence interval.
- AlphaGenome: signed raw-score contributions, ordered by magnitude, with explicit attribution coverage. A bounded overview may expand to all contributions; shares and domains still use the complete supplied vector.
- Expression: measured medians compared within a single source and unit. Adult and pediatric sources have separate views and fixed source domains. Sampling age is not disease onset.
- Assertions: categorical source-by-assertion matrices. Counts describe returned records, not consensus or evidence strength.
- Model preferences: keep one model's 0–100% probability axis. The overview includes its six highest probabilities plus the reference and variant, with access to every returned residue. Do not renormalise the displayed subset. Print probabilities beside the marks, including very small values.
- Protein annotations: retain residue coordinates and separate overlapping source tracks. State the question above the map and preserve the existing PM1 finding and annotation provenance.
- Species and biological structures: aligned site maps, orthology relationships, residue tracks and contact geometry where supplied. Whole-protein identity, site conservation and phenotype observations remain distinct.

## Interaction and visual contracts

1. Give each record a stable source key. A chart point and its source-record row select that same key.
2. Only meaningful data targets own selection. Labels, stems and pin rings are decorative; they must not create duplicate keyboard stops or false quantitative positions.
3. Preserve a pin across filters and views. If it is hidden by a bound or filter, say so and provide the route to reveal it. Reset on the existing analyzed-allele identity boundary.
4. Print important values directly. Units and categorical meanings must be visible without a tooltip. Exact precision and provenance remain in the inspector.
5. Bound dense displays explicitly. Show the number visible and the number available. Expansion affects visibility only; it never changes the scientific denominator, scale or conclusion.
6. Use existing color tokens in both themes. Direction or state must also be expressed in position, shape or words. A legend cannot repair an unsupported biological inference.
7. Scope CSS to the workspace or shared component. Use flexible layouts and container queries. On small screens, a labelled scrollable figure is preferable to unreadable text; the document must not overflow.

## Definition of done

Inspect the production components with the current styles, including their inspector. Exercise dense, sparse, conflicting, zero, missing and excluded cases relevant to the source. Check light/dark and desktop, intermediate and phone widths. Verify label collisions, clipping, keyboard pins, record round trips and filter invariants.

Run repository lint/type checks and appropriate scientific/interaction regressions; run the full suite for a coherent batch. Record build results and browser evidence in a review document. Label illustrative fixtures explicitly and distinguish fixture checks from live scientific validation. Human comprehension testing is a separate acceptance step and must not be claimed from agent screenshot inspection.

## Implementation status

Energetics and the Population Data / Predictors / AlphaGenome / Expression batch are implemented and browser reviewed. The next five tabs—Gene–disease, Species & models, Residue shifts & pockets, Structural perturbation and Functional domains—are covered by the [context and molecular batch review](CONTEXT_MOLECULAR_VISUALIZATION_REVIEW.md). RNA splicing retains the [workspace pass on main](SPLICING_WORKSPACE_REVIEW.md). Interfaces & PPI and the explanation drawers are proposed separately in [PR #130](https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer/pull/130).

See [the active rollout](CHARTING_AND_VISUALIZATION_PLAN.md), [reference analysis](VISUAL_STORYTELLING_REVIEW.md), and [four-tab review](POPULATION_VISUALIZATION_BATCH_REVIEW.md). Broader Landscape, Insights, Literature, 3D and report refinement remains a separate rollout step. Existing scientific reviews remain authoritative; human reader-comprehension validation is still pending.
