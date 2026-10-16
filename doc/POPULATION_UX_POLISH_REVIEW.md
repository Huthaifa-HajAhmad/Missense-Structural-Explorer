# Population Data and workspace navigation polish

15 October 2026. Implements the screenshot audit and removal of Open inspector across tabs. Scientific classification, cut-points and provider requests are unchanged.

## Changes

- `EvidenceWorkspace` and `ReviewWorkspace` no longer render Open inspector. The inspector shell retains collapse/expand; source selection and view changes retain existing pin/focus contracts.
- Shared `WorkspaceTabs` styling uses clay-tinted selection, a visible selected border, theme tokens, 44px targets, hover/press feedback and reduced-motion-aware transitions. Keyboard and ARIA behavior is unchanged; consumers need no per-tab copies.
- Population source coverage replaces the empty chart when no positive frequencies can be plotted. Selectable rows share stable keys with source records and the inspector. Confirmed absence, measured zero, unavailable frequency and provider error remain distinct; supplied counts remain visible. Positive readings retain the upgraded chart.
- Comparison includes a separate ClinVar summary from the existing evidence model.
- Source-record thresholds are behind a labelled disclosure. Absence and zero no longer receive quantitative markers on the log ruler.
- PM2 badges expose Supporting strength. Main finding, ruler and rail describe the pLI branch as a local frequency ceiling rather than a disease-inheritance assignment.
- The unselected reading inspector has a compact prompt. Selected and unavailable pins retain their distinct states and clear action.

## Regression contracts and verification

`EvidenceTabs.integration.test.tsx` covers absent/zero/error coverage, record pins across views, no zero/absence ruler marker, and rail expansion without duplicate navigation actions. ClinicalTab and inspector expectations now require Supporting and local-ceiling wording. Existing model tests retain source-specific AC/AN and a separate engine input.

`tests/population-workspace.e2e.ts` drives production components with labelled illustrative fixtures: keyboard tab switching, pins, rail collapse/expand, no Open inspector action, and absence/zero/error/measured views. It checks no document overflow at 1440/800/390px in both themes. The preview exposes an explicit Absent fixture.

- `npm run lint`: passed, including TypeScript, boundaries, focus and verification parity.
- Full Vitest: **407 files passed, 2 skipped; 5,104 tests passed, 5 skipped**.
- `npm run build:client`: passed; dependency annotation and large-chunk warnings remain.
- App e2e smoke: passed.
- Population e2e: clean final run passed with retries disabled. An initial wrong collapse-button locator was corrected before that run.
- Screenshots inspected: desktop light/dark, narrow dark, measured comparison and expanded source-record ruler. Final artifacts: `.e2e/proof/population-polish-final/`.
- `git diff --check`: passed.

T3 preview snapshots timed out twice; browser verification used the repository e2e workflow. Fixtures validate presentation and interaction, not live services. The supplied NAE1 screenshots motivated the audit; verification reproduces their absence state with illustrative data, not a fresh NAE1 analysis. No human comprehension study, commit or deployment is claimed.

## References and maintenance

- ClinGen SVI PM2 recommendation (2020): https://www.clinicalgenome.org/site/assets/files/5182/pm2_-_svi_recommendation_-_approved_sept2020.pdf
- gnomAD constraint: https://gnomad.broadinstitute.org/news/2024-03-gnomad-v4-0-gene-constraint/
- Existing scientific contracts: `POPULATION_FREQUENCIES_REVIEW.md`; architecture: `VISUALIZATION_SYSTEM.md`.

Keep absence outside quantitative geometry, status in shared models, and tab styling/semantics shared. No new metric or explanation entry point was added.
