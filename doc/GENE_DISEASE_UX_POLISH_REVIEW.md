# Gene–disease review workflow polish

16 October 2026. Implements the screenshot audit against `VISUALIZATION_SYSTEM.md` and
`TRANSLATIONAL_PHILOSOPHY.md`. This is a presentation and interaction change; provider requests,
assertion categories, matching rules, dosage comparisons and ACMG decisions are unchanged.

## Decisions

- Lead with the finding and keep the disease selector available. Differing submissions are named
  explicitly rather than leading with a submitter count. Each original submission remains visible.
- Retain comparison/source-record navigation and validity/dosage source selection. These are
  distinct operations with existing persistence contracts; replacing them was unnecessary risk.
- Put scope metadata after the figure. Make selection guidance, the rail review trace and full
  classification definitions disclosures. Show source availability and provenance before the
  reference definitions. The selected-reading inspector retains its exact record and limitations.
- Explain mechanism availability in the pure evidence model. An undetermined matching G2P record
  with missing dosage must not become a claim that no mechanism record exists.
- Hide search, zero-record counts and selection instructions when there is no source record to
  explore. A successful empty read offers no failure-style retry. Errors retain Try again;
  missing installations retain Check again.
- Preserve hidden pins. Show pinned record returns to their source, clears display filters,
  expands the source bound and explicitly focuses the selected control. Ordinary view changes
  continue to preserve focus rather than moving it implicitly.
- Consolidate Gene–disease figure styles in `gene-disease.css`, after shared workspace primitives.
  The rendered check exposed an older shared grid rule overriding the intended finding layout;
  leaving competing copies would have made subsequent agent and developer edits fragile.

## Reproducible verification

- `src/shared/__tests__/geneDiseaseEvidence.test.ts`: undetermined mechanism with absent dosage;
  missing snapshot versus successful lookup with no matching mechanism; original scientific rules.
- `src/components/evidence/__tests__/ContextSourceState.test.tsx`: running, failed, unavailable
  installation and successful empty source actions.
- `src/components/evidence/__tests__/ContextWorkspace.integration.test.tsx`: empty selection,
  hidden-pin recovery and focus, persisted trace disclosure, existing cross-tab record contracts.
- `tests/gene-disease-workspace.e2e.ts`: real AppViews components and styles; four assertions in
  the first desktop viewport; light/dark at 1440, 800 and 390 px; no document overflow; keyboard
  selection, dosage absence, source-record round trip, mechanism trace and clearing disease choice.
- Preview: `tools/evidence-preview/index.html`, Gene-disease, Differing assertions. This is a
  reusable, explicitly illustrative fixture; its records are not clinical evidence. API calls are
  disabled. The preview contains the production evidence wrapper and inspector, but omits global
  navigation/search chrome; it does not establish live-provider or full-shell acceptance.

Final results:

- Lint, boundary/focus/verification-parity checks and TypeScript passed.
- Six focused test files passed: 75 tests.
- Client production build passed; existing large-chunk advisory remains.
- App smoke passed. Final Gene–disease e2e passed with retries disabled, including the desktop
  four-row viewport assertion and light/dark responsive checks. Inspected desktop light, phone
  dark and selected-record dark screenshots. Proof: `.e2e/proof/gene-disease-polish-final/`.
- Full suite: 406 files passed, 2 skipped, 1 failed; 5,108 tests passed, 5 skipped, 1 failed.
  The unrelated `server/services/infra/admission.test.ts` peak-memory telemetry test received null
  instead of a numeric RSS measurement. Its isolated rerun passed, together with the model
  tests (39 tests). No server code or assertion was changed. The full suite was not repeated
  after the final CSS adjustments and added recovery-action tests; focused tests and browser
  verification cover the final changes. Do not describe the full-suite run as clean.
- `git diff --check` passed.

Initial browser runs caught a test option-label mismatch and a real CSS composition defect;
neither was bypassed by relaxing the viewport requirement. Existing Population/shared-shell
working-tree edits were preserved. No commit or deployment was performed.

## Boundaries

The categorical visualization upgrade remains in place. No new chart library, clinical scoring,
provider or global restyle was introduced. This does not claim a human comprehension study or a
live NAE1 reanalysis. Long mechanism matching notes and source-record tables remain accessible;
further editorial compression should preserve their source-specific qualifications.
