# Expression workspace UX polish

16 October 2026. Implements the six-screenshot audit against `VISUALIZATION_SYSTEM.md`,
`TRANSLATIONAL_PHILOSOPHY.md` and the October 15–16 Population/Gene–disease presentation work.
The existing TanStack visualization upgrade remains in place. Provider calculations, source
values, source domains and ACMG rules are unchanged.

## Findings resolved

| Finding | Change | Regression evidence |
| --- | --- | --- |
| Show all expanded the count but the chart independently kept only 20 records | Chart consumes the bounded page directly; expansion exposes all matching readings | ContextWorkspace integration and Expression e2e: 54th tissue appears |
| Pediatric view retained an adult-derived headline and trace | `expressionWorkspaceFinding` supplies both surfaces with an active-source finding; public cohort and selected-system scope are explicit | Model tests cover zero, errors, unavailable snapshot, absent gene and uncovered scope; integration checks rail parity |
| Hidden pins beyond the initial bound had no direct recovery | Show pinned record opens the exact source-record view, clears filters, expands records and focuses the selected record | Integration and e2e: recover tissue 54 after collapse |
| Unavailable pediatric source showed search and cohort controls | Hide exploration controls and counts when the source has no records; preserve the source status and existing retry action | Integration and e2e unavailable-source assertions |
| Source records repeated GTEx and the TPM definition per row | Source/release and units appear once; rows show tissue, exact median, RNA sample count and pediatric cohort/donor count | Existing measured-zero assertion now checks numeric zero and its unit-bearing column; browser record inspection |
| Summary and rail displaced the figure | Compact source-aware finding, smaller navigation spacing, sentence-case selected-reading titles, collapsed review context and coverage limitations | Light/dark screenshots at 1440, 800 and 390 px; first four chart rows fit the desktop fixture viewport |
| Selected-system filter had no useful action without a selection | Disabled empty-system filter with Choose systems opening and focusing review choices; removing the last system cannot trap the view | Integration checks focus and restores 20 of 54 records |

## UX, DX and AX decisions

- Preserve the existing figure/source-record navigation, stable source keys, pins and allele reset.
- Retain adult/pediatric separation, complete-source domains, exact medians, measured zero and missingness.
- Keep the interpretation boundary visible. Disputed disease assertions remain visible outside the
  collapsed rail trace. No expression value is promoted to a variant-effect measurement.
- Use one pure active-source finding model for the tab and rail, rather than two sets of status prose.
- Give the Expression record table its own small component and scoped stylesheet rules; shared
  explorer changes are restricted to Expression behavior and reuse the established recovery action.
- Extend the reusable preview with Dense expression and Pediatric unavailable, documented in its
  README. The latter returns its own illustrative response when the hook rechecks installation.
  All other live services remain disabled. No new dependency or browser framework was introduced.
- Preserve unrelated Population, Gene–disease, Energetics and shared-shell work in this checkout.

## Verification

- Final `npm run lint`: passed, including architectural boundaries, focus audit, verification parity
  and TypeScript. Two test typing errors found in the final check were corrected without changing
  their behavioral expectations.
- Full Vitest rerun: **409 files passed, 2 skipped; 5,118 tests passed, 5 skipped**.
  The initial run failed one old table assertion expecting repeated inline TPM; the corrected
  regression verifies both numeric zero and the Median TPM column. The full rerun passed.
- Six focused suites passed 56 tests; the additional last-system-removal regression then passed in
  the 11-test context integration suite and is included in the full rerun.
- Client production build passed; existing large-chunk advisory remains.
- App smoke passed: `.e2e/proof/expression-smoke/`.
- Expression e2e passed with retries disabled: `.e2e/proof/expression-polish-final/`.
  Covers 54-record expansion, keyboard activation, exact source-record pin recovery/focus,
  unavailable pediatric controls, a cohort-filtered 29 TPM reading on the unchanged 0–36 domain,
  source-record inspection, light/dark and 1440/800/390 px without document overflow.
- Inspected desktop light, phone dark, unavailable pediatric and selected pediatric-record images.
  The first e2e attempt stopped at a cohort selector that used an ID rather than the runner's
  expected visible label; the corrected run passed without relaxing the scientific assertions.
- `git diff --check`: passed.

## Limits

The preview uses real AppViews components, evidence wrapper and current styles, with explicitly
illustrative data and no global navigation/search chrome. It is not a live NAE1 reanalysis,
provider-uptime check, full-shell acceptance or human comprehension study. Preview console logs
include blocked background API requests and the existing competing Vite HMR-port warning.
No commit, deployment, source installation or scientific rule change was performed.

Existing scientific reviews remain authoritative: `EXPRESSION_MODELS_TAB_REVIEW.md`,
`CONTEXT_WORKSPACES_REVIEW.md` and `POPULATION_VISUALIZATION_BATCH_REVIEW.md`.
