# Molecular Evidence workspaces

2026-10-10. Follow-up to the Landscape, 3D, Energetics and six completed Evidence workspaces.
Scope: Residue shifts & pockets, Structural perturbation and Functional domains, including their
linked inspectors. Builds on `RESIDUE_SHIFTS_REVIEW.md`, `PERTURBATION_REVIEW.md` and
`FUNCTIONAL_DOMAINS_TAB_REVIEW.md`; does not replace their scientific audits.

## Researcher-facing questions

| Workspace | First view | Inspectable detail |
|---|---|---|
| Residue shifts & pockets | What changes in the side chain? Four property comparisons retain their own published scales, open reference markers and filled variant markers. | Native values, scale source, burial and pocket context. |
| Structural perturbation | What does each model prefer at this position? Compare direction across models, then one model's amino-acid distribution on a 0–100% probability axis. | Exact returned probability, actual served model, model-specific caveats and source records. |
| Functional domains | Which annotations cover this position? Independently selectable, separated domain tracks retain residue coordinates. | Bounds, source signatures, evidence codes and PM1 trace. |

Comparison and Source records are separate views inside the existing two-pane workspace. Pins and
view choices survive navigation and reset for a different analyzed allele, including a substitution
at the same residue. Source records retain exact values. Presentation models are shared by tab and
inspector in `src/shared/molecularWorkspace.ts`.

## Findings and decisions

| Severity | Finding | Resolution |
|---|---|---|
| High | Overlapping and nested signatures occupied the same domain track and obscured one another. | Pack complete signatures into separate lanes. Keep all segments of a discontinuous signature on one lane, preserve their actual intervals, and extend the variant stem through the stack. |
| High | The finding and inspector trace described only the first covering domain. | Count and describe multiple covering annotations. Explicitly state that overlapping signatures are not independent evidence or physical layers. |
| Medium | Domain boxes lacked a direct path to their evidence. | Click, Enter/Space and arrow navigation use the same record keys as the table and inspector. Small boxes get a minimum pointer target; complete names and source bounds remain in a disclosure. |
| Medium | Zoom relied on pointer dragging. | Add validated numeric bounds, an off-window variant notice and a return-to-variant action. Touch scrolling does not initiate a brush. |
| Medium | Dense records competed with the primary visual message. | Default to the figure; Source records shows covering and selected rows plus a bounded set of nearby rows, with explicit expansion. |
| Medium | Perturbation records did not link to a shared reading inspector. | Plot one returned model distribution at a time, preserve exact probabilities, and synchronize the displayed model with existing rail consumers. |
| Low | A narrow property track extended past its column. | Reserve endpoint-marker space inside the available width. |

No engine criteria, thresholds, weights, votes or classification changed. Domain membership alone
does not establish PM1; the existing evaluator and recorded engine result still decide the trace.
No common scale is invented for different models' raw ΔLLRs. Amino-acid probabilities are not
disease probabilities, and missing outputs are not plotted as zero.

## Reference cases and limitations

- NAE1 p.Asp116Gly uses the existing recorded fixtures. The overlap scenario deliberately adds
  three **illustrative** signatures, including a discontinuous signature. These are geometry test
  data, not new annotations of NAE1. The preview labels all examples as illustrative.
- Dense SOD1 p.Ala5Val retains aggregation of disease-variant counts and the existing annotation
  density rules. Domain packing does not hide provider signatures; exceptionally many nested
  matches can require a tall drawing. Full source names remain available outside the figure.
- Empty results and NAE1 p.Asp116Ala exercise availability and allele reset behavior.
- Small probability charts retain a readable minimum width and horizontal scrolling. They never
  crop or change the underlying 0–100% axis to exaggerate a small variant probability.
- Browser verification uses fixture data with live API requests disabled. This pass does not
  validate provider uptime, refresh provider annotations or add new biological evidence.

## Verification

- Full Vitest: **355 files passed, 2 skipped; 4,529 tests passed, 5 skipped**, with two workers.
  An earlier run coincided with a workspace merge and worker startup timeouts; that result was
  discarded and the complete suite rerun on the restored current source.
- Follow-up interaction/model/overlap checks: **27 passed** after model-selection synchronization.
- TypeScript and `npm run lint`: passed, including architectural boundaries, focus indicators
  and verification parity. Production build passed.
- Integrated Chromium geometry harness: **241/241 assertions passed** in the earlier focused run.
  The final run passed all 230 non-focus assertions; 11 `:focus-visible` assertions could not be
  reproduced while the browser document reported `hasFocus() === false`. A keyboard walk still
  reached the new domain controls and their computed outline was present, but this does not replace
  a final focused-browser accessibility check. Additional pure geometry tests cover nested and
  discontinuous overlaps at 300, 720 and 1200 px, clipping and source identity.
- Browser inspection: light/dark, 1500, 800 and 390 px; dense SOD1, overlap fixture, missing states,
  exact-value inspection, domain selection, keyboard controls and responsive property scales.
- Regression tests cover pin/window/layer persistence, same-position allele reset, record focus
  handoff, invalid numeric windows, unchanged PM1 and actual probability-chart keyboard selection.

## 2026-10-10 follow-up — independent verification and fixes

A senior read-only review of `53051d6` returned **approve with changes** (no blockers). Its findings were
re-checked against the code, and this section records what was fixed, what was left, and the
environment caveats that make "the suite is green" a moving target here.

Fixed:

- **Below-backbone stems floated 9px under the backbone** (`architectureLayout.ts`). The lane fix moved
  every stem to `lowerBackbone + 15`; a pin with no domain box over it now leaves the backbone's own
  edge instead. The geometry harness's stem check only forbade starting *above* the backbone, which is
  why 241/241 passed with the gap present; it now also fails a floating stem when no box and no drawn
  lower layer is present. New unit tests cover the covered, uncovered and real-fixture cases.
- **Focus could leave the tablist** (`FunctionTab.tsx`). The row-focus effect depended on
  `workspace.view`, so a keyboard switch to Source records pulled focus into the table. Focus is now
  given only after the explicit "View selected record" action.
- **The perturbation caption fired on the normal path** (`EvidenceComparison.tsx`). Selecting a model
  in the strip pins the model id (an inspector row, not a chart dot); "outside this probability chart"
  now appears only for a probability reading this chart does not plot.
- **Mojibake in the residue-detail loading status** (`ResidueDetail.tsx`).
- **A false trace sentence** (`functionEvidence.ts`): "No site or region does" is no longer reachable
  when a broad span covers the residue; the trace names that span instead.
- **Keyboard parity in the schematic** (`DomainArchitecture.tsx`): every selectable mark now carries
  button semantics through one shared helper, ←/→ move DOM focus onto the stepped mark, and the
  disulfide bracket is in the stepping order. Marks stay out of the tab order (`tabIndex={-1}`); the
  annotation table remains the full keyboard path, per the visualization contract.
- **Smaller items**: `aria-describedby` on the window inputs, the drawing label now states the shown
  window, hover-lit and selected domains are visually distinct, the `<div>` inside the property button
  is valid `<span>`, `MAX_DOMAIN_LANES` sits at its use, citation links go through `safeExternalHref`,
  and a tautological test was replaced with one that can fail.

Left as-is, deliberately: the `!workspace.enabled` fallbacks are dead inside the app but are the
standalone component and test path, and removing them is a refactor, not a fix; `buildFunctionEvidence`
still runs in the tab and the rail (different components, one pure model).

Verification on this working tree: `npm run lint` passed (boundaries, focus indicators, verify parity,
`tsc`); the focused molecular files pass (106 tests) and `architectureLayout` alone passes 17; the
integrated Chromium harness passes **241/241**, now including the strengthened stem assertion.

Working-tree caveat: the full suite currently reports one failure,
`src/shared/__tests__/attributions.test.ts`, because a **different concurrent agent** left an
uncommitted edit to `server/services/llm/gemini.ts` that adds an `ai.google.dev` URL the disclosure
list does not yet carry. That is not from `53051d6`, and this pass did not touch it. The same shared
checkout is also the most likely cause of the review's "branch switched to main" incident: no recorded
command in the review thread switched branches, but another thread was editing the same files.

## Senior-review resolution (2026-10-11)

The senior review of this refactor (and of the snapshot-retry fix) reported three major findings in
the Functional domains drawing, verified against the code and fixed on the current branch:

| Severity | Finding | Resolution |
|---|---|---|
| Major | Nearby, non-overlapping domains (CBS domains of CNNM2, SLC12A4, ankyrin repeats) were stacked onto separate lanes by a 12px/4px **pixel-gap** test, and lane assignment changed between zoom windows. | Lane assignment now happens in residue space over the whole signature set: two signatures share a lane exactly when their residue intervals never intersect. The 8-lane gap repack is gone; tracks no longer re-flow while zooming. |
| Major | Below-backbone stems started at the bottom of the **lowest** lane, floating up to 84px under the box that actually covered the residue (an existing test locked this in). | The stem leaves the bottom edge of the covering box in that box's own lane; the old test was rewritten to plate the covering-box rule, both directions. |
| Major | A broad fold-level match (97% coverage — the class the rail declares "not counted as the residue's domain") inflated the "overlapping domain annotations" count in the finding lead and trace. | The count uses specific coverage only; a lone broad fold now gets its own lead naming the fold as broad coverage, and the caveat and fact row state the fold's span without counting it. |

The reviewer's lower-confidence candidates folded into these: the "one domain inflates the layout"
observation is the first row's behaviour; the 24px minimum-slot and hit-area concerns only affected
lane packing through the removed pixel pass. Two cosmetic items were recorded, not fixed, as
draw-visual polish: the overview strip overprints overlapping domains, and a disulfide bracket can
disconnect when an anchor cysteine is zoomed out. The guide texts that claimed overlap semantics
are now accurate for real overlaps only. The snapshot-retry review items (failure-time clock,
header wording, default-clock test, comment and cleanup nits) were addressed in the
`snapshotInstall` commit on the same branch.

## Sources

The established audits retain the citations for existing residue scales, model interpretation and
PM1. This pass introduces no scientific cut-point. InterPro documentation supports the distinction
between overlapping source annotations and a biological consensus:

- [InterPro visualization guide](https://www.ebi.ac.uk/training/online/courses/interpro-quick-tour/visualising-interpro-data/).
- [Overlapping homologous superfamilies](https://www.ebi.ac.uk/training/online/courses/interpro-functional-and-structural-analysis/what-is-an-interpro-entry/overlapping-homologous-superfamilies/).
- Richards et al., ACMG/AMP interpretation framework: DOI [10.1038/gim.2015.30](https://doi.org/10.1038/gim.2015.30), as cited by the existing Functional domains audit. No change to its application here.
