# Visual storytelling review

13 October 2026. Scope: the analysis workspace and its visualisation plan.
This records the design diagnosis and implementation specification. The 14 October continuation below records the first production improvement; the wider rollout remains planned.

## What was inspected

- [Nizam's reference video](https://x.com/nizamdesign/status/2109728308237631619): the downloaded 23.133-second clip, sampled once per second across its duration. The contact sheets cover the distinct screens and transitions; this was frame inspection, not an audio review.
- Current `CHARTING_AND_VISUALIZATION_PLAN.md`, the translational philosophy, workspace review documents, and production components listed below.
- Saved workspace screenshots from 11 October: `scratch/mechanism-splice-light.png` and `scratch/review-preview/insights-1500-light.png`. These illustrate the earlier rendered composition; they do not certify the current working tree.
- Fresh integrated-browser navigation timed out and its screenshot remained blank. No fresh visual verification is claimed. The current working tree already contained extensive changes; this pass changes planning documents only.

## What makes the reference work

The reference gives each screen a job and connects the screens into an investigation. It uses different figures because the questions differ. The approximate times below identify sampled frames, not exact edit boundaries.

| Time | Screen | How it communicates | Transfer to this workspace |
| --- | --- | --- | --- |
| 0–2 s | Overview | A prominent result, recent history and a target-to-actual breakdown make the shortfall visible together | Lead with the run's finding and the evidence explaining it; show a trend only if actual repeated measurements exist |
| 3–4 s | Jobs | A distribution locates the selected job within the whole, then a table identifies individual jobs | Place a selected residue or variant within an actually available reference distribution, with the denominator and selection visible |
| 6–7 s | Job detail | Aligned estimate/actual bars reveal which categories differ; the result and event sequence provide context | Use paired native/alternate measurements where units and reference frames match; distinguish measurements from predictions |
| 8–9 s | Where the profit went | A large sequential breakdown names each contribution and its magnitude | Use a contribution breakdown only for a genuinely additive quantity. Clinical evidence and correlated predictor scores cannot become a disease-risk waterfall |
| 11–12 s | Leakage | A matrix locates concentrations by two categories; a small set of findings points into the records | Use a matrix only when two meaningful categorical dimensions and comparable values are supplied; identify the strongest supported pattern |
| 13–14 s | Why labour is leaking | A selected path narrows the population; estimated and actual distributions expose the mismatch | Retain the selected evidence context while drilling into its comparison and source records |
| 15–17 s | Update estimate | The action is attached to a specific, visible finding and states its consequence | Offer inspect, compare, reveal source, or retry when those actions are supported. A presentation control cannot change a clinical rule |
| 19–22 s | Forecast | Observations, projections and possible changes have distinct encodings | Separate observations, predictions and uncertainty. No forecast, confidence band or counterfactual without a model and payload supporting it |

The transferable quality is the reading sequence: **finding → visual explanation → supporting records → useful next inspection**. Soft surfaces, typography, alignment and restrained colour reinforce that sequence.

## Why the current plan did not ensure that result

| Finding | Evidence in this repository | Consequence | Correction |
| --- | --- | --- | --- |
| Technical delivery is the main acceptance target | Original goals emphasise wrappers, fewer hand-written axes, library accessibility and small chart components | A technically sound chart can pass while the screen still fails to explain the result | Define and inspect complete screens before abstracting components |
| The active direction is ambiguous | October updates adopt TanStack while the historical decision table and phases still prescribe Recharts; the old kickoff stops at a wrapper | A new implementation can follow obsolete instructions and never reach a finished result screen | Put one active rollout at the top and explicitly mark the old sequence as history |
| The main figure competes with preceding summary furniture | `PredictorsTab.tsx` renders the full finding, `VoteRow` and `ReferenceRow` before `EvidenceComparison` | The explanatory comparison has lower visual priority than its supporting detail | Compact finding above the figure; place the voting/reference comparison beside or immediately below it |
| Distinct questions share too much geometry | `EvidenceComparison.tsx` shares the linear dot-row structure across several evidence families, with tab-specific branches and rotated predictor labels | Consistency of implementation does not guarantee an appropriate visual form or a clear first glance | Share selection, accessibility and figure furniture; choose geometry per scientific question |
| Important values depend on exploration | Generic chart values appear primarily in the hover/pin readout and inspector | A static first view often communicates less than the reference video | Directly label the selected reading, important endpoints and supported exceptions; preserve exact values in records |
| Passing tests can be mistaken for passing design | Existing reviews document substantial integrity and interaction checks, but the plan has no explicit comprehension acceptance test | Completion can mean that the chart works, rather than that the reader understands it | Require a visual review and a reader paraphrase independently of automated correctness checks |

These findings do not mean all existing figures are poor. The custom biological maps, shared evidence models, source linkage and selection contracts are useful foundations. Improve the compositions that use them.

## The reference screen to build first: Energetics

Question: **How much do the methods predict folding stability will change, and where do they disagree?**

Use the existing `buildEnergeticsEvidence` and `buildEnergeticsComparison` data. Keep the production sign convention, inclusion/exclusion decisions, method identity and selection state.

Reading order:

1. Variant identity and a short finding derived from the actual returned data. Disagreement must be visible in the title when present. Missing or single-estimate states get their own honest finding.
2. A dominant horizontal comparison with a labelled zero reference, common ΔΔG units, readable method names and directly labelled values. Included and excluded estimates remain distinguishable by shape and words. Sorting changes display order only.
3. Beside it at a wide width, a compact explanation of the selected method and its basis. Before selection, show a short, data-derived description of the comparison; do not imply a method has been selected. On narrow screens this follows the figure.
4. Below the figure, only supported observations: the displayed endpoints, coverage and material exclusions. A range describes cross-method spread, never confidence. Do not add repeated metric cards merely to fill space.
5. A clear route to the exact engine record and structural basis, using existing navigation. Detailed methods and provenance remain available through the current inspector and explanation drawers.

Composition target at a 1440 × 900 viewport with the real application shell: identity and finding occupy a compact header; the comparison is the largest content region in the first viewport; a reader can see its values and the material qualification without opening anything. This is a design acceptance target, not a new scientific threshold.

The first screenshot must answer: which methods reported, which direction their values point, what differs, and what the reader can inspect next. A pretty chart that cannot answer these has not passed.

## Figure assignments across the workspace

These are design assignments, conditional on the data actually available. They are not permission to manufacture inputs.

| Surface | Reader's question | Primary visual treatment | Main boundary |
| --- | --- | --- | --- |
| Insights | What supports the recorded result, and what remains unresolved? | Evidence-family board separating recorded criteria, contextual findings and unavailable evidence; visible routes into each finding | No pooled numerical disease score; lengths must not imply additive clinical evidence |
| Energetics | How large is the predicted stability change, and where do methods disagree? | Direct-labelled common-axis estimate comparison | Cross-method spread is not uncertainty or independent replication |
| Predictors | Which published evidence categories do the tools reach? | Categorical band matrix with horizontal labels, selected native score, and distinct voting/reference context | Keep unlike raw scales separate; no averaged predictor confidence |
| Population | Where has the allele been observed, and with what coverage? | Source comparison with frequency and assessed-allele denominators; log scale explicitly labelled | Zero, confirmed absence and failed lookup remain distinct; cohorts are not summed |
| AlphaGenome | Which returned inputs contribute to this model score? | Ranked diverging contribution bars, direct values, family filters and visible coverage | Contributions explain the model score, not a proven tissue mechanism or disease probability |
| RNA splicing | Which predicted signal occurs where relative to the transcript? | Compact shared-scale channel comparison linked to the positional transcript map | Transcript frame and unpositioned/off-view signals remain explicit |
| Residue shifts / structural perturbation | Where does the model differ, and what kind of difference is it? | Positional profile with the queried residue; native/alternate comparison only for compatible measurements | Embedding change, coordinate movement and model confidence are separate quantities |
| Functional domains | What annotated context contains or neighbours this residue? | Biological tracks and variant-density view with linked annotation records | Dense records need aggregation; shared coordinates require verified mapping |
| Interfaces & PPI | What structural or interaction support exists for this site? | Context-separated interface map and support comparison with denominators | Assembly membership cannot invent a contact; returned structures are not independent experiments |
| Expression | Where is this gene expressed in the returned dataset? | Ranked horizontal comparisons or small multiples within a consistent assay/unit | Do not join unlike assay scales or infer tissue-specific disease causation |
| Gene–disease / species & models | Which assertions or model observations support this context? | Evidence matrix or grouped comparisons where comparable fields exist; concise records otherwise | Assertion strength, phenotype observation and sequence similarity are not interchangeable |
| Landscape | How does the selected residue compare with the returned landscape? | Overview distribution/profile and linked detail; preserve valid agreement scatter | Show missing coverage and distinguish queried from explored residue |
| Literature | Which papers bear on this variant, and what do they contribute? | Evidence-role and screening summaries linked to papers; timeline only when dates answer a real question | Paper counts are not evidence strength; duplicate publications must not imply independent support |
| 3D / reports | Where is the finding, and can it be communicated faithfully? | Linked structural selection; exported annotated figure with identity, scale, provenance and material caveat | Do not strip qualifications from exports or infer unsupported geometry |

## What a finished screen must pass

The numerical layout targets below are local design goals, not scientific claims. Judge them with dense, sparse, missing, conflicting and excluded-result cases.

- **Comprehension:** a reviewer can state the finding, comparator, important exception and next inspection after a brief first look. Record what they said; do not claim a user study from an agent's screenshot inspection.
- **Composition:** one dominant explanatory figure; relevant identity and finding visible with it; no stack of repeated summaries above it. Show the primary figure in the first desktop viewport and promptly after the finding on narrow screens.
- **Readability:** horizontal category labels; units and reference frames visible; direct labels for the query and important comparisons. Small text and dense rows cannot be the only way to understand the result.
- **Hierarchy:** clear title, figure labels and secondary provenance; quantitative marks carry the emphasis; colour has a stable semantic meaning. Reuse the house typefaces and tokens before proposing a global restyle.
- **Interaction:** selected figure, record and inspector agree; keyboard and pointer both work; filters explain hidden selections; returning to the workspace preserves the correct context.
- **Integrity:** display changes cannot alter evidence or engine records. Missing is not zero. Any aggregate identifies contributors and exclusions. Sources and material qualifications remain visible where needed.
- **Responsive rendering:** inspect the real shell in light/dark at 1440 × 900, an approximately 800 px main column, and a 390 px viewport. Label collisions, clipped controls and required horizontal scrolling must be assessed, not assumed away.
- **Verification:** run checks appropriate to the implementation and existing repository requirements. Save before/after screenshots and the exercised fixture identities. Tests passing and visual quality passing are separate status fields.

## Delivery and completion status

This pass completes the reference analysis, diagnosis and replacement execution plan. It does not complete a production redesign. The first implementation milestone is one fully reviewed Energetics screen, followed by Predictors and the remaining families in the active plan. Do not mark the workspace rollout complete after a wrapper, a library migration, a plan, or an isolated chart screenshot.

### 14 October continuation: first production improvement

After verifying the saved plan and untouched production code, the Energetics comparison was improved:

- The header and finding occupy less vertical space. In the 1440 × 900 production `AppViews` preview, all six estimates and the axis now fit in the first viewport; previously the lower estimates and axis were below it.
- Every returned estimate has a direct, unit-converted value label. A subdued stem links zero to the estimate, making its size and direction visible without interaction.
- Single, two-estimate and no-usable-estimate states qualify the prominent heading; an excluded returned value does not count as usable evidence.
- New stems, text and pin rings are decorative. They do not create additional keyboard selection positions. The existing source-record/inspector link remains intact.

Fresh browser checks now cover light and dark themes, 1440, 800 and 390 px viewport widths, missing/single/excluded/extreme fixtures, both units, keyboard pinning and the record/comparison round trip. The narrow extreme-value chart had no detected text overlaps, clipped labels or document overflow. These are labelled illustrative fixtures, not a new scientific service run. The preview renders the real workspace and inspector but omits the application's global navigation/search chrome.

Lint/TypeScript passed. The full suite passed 4,636 tests with 5 skipped; the final sparse-heading refinement was followed by 53 passing focused tests. The production client build passed with existing large-chunk warnings. See `ENERGETICS_VISUALIZATION_REVIEW.md` for the evidence and limits. No human reader-comprehension assessment has been performed, and the other workspace families have not been redesigned in this pass.

### 14 October continuation: population-led four-tab batch

Population Data, Predictors, AlphaGenome and Expression now have compact findings and directly labelled figures appropriate to their questions. The predictor comparison uses categorical bands; AlphaGenome opens with eight contributions and an explicit expansion control; population frequencies carry their own cohort counts; Expression brings measured TPM forward and retains the review context in a disclosure. Exact records, pins, missingness and scientific rules remain intact.

The [batch review](POPULATION_VISUALIZATION_BATCH_REVIEW.md) records browser evidence, screenshots, 4,638 passing full-suite tests, focused regressions and production-build verification. These four are implementation-complete and browser reviewed. The remaining families and human comprehension assessment are still pending.
