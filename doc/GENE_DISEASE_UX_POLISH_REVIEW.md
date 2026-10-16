# Gene-disease workspace: navigation and inspector contract

16 October 2026. This follow-up supersedes the earlier two-row pill navigation and
review-trace composition. It changes presentation and interaction only. Scientific models,
provider requests, assertion identities, matching rules and ACMG decisions are unchanged.

## UI ownership

- `GeneDiseaseTab` owns one evidence-category tablist: Validity, Dosage, Mechanism,
  Variant context. The selected category uses the existing allele-scoped `section` state.
- Comparison / Records are labelled presentation buttons inside Validity, using the existing
  `view` state. Changing representation never changes category. Other categories do not expose
  an irrelevant representation control. Returning to Validity retains its representation.
- Validity findings stay inside Validity. Mechanism and variant context have explicit sections.
  `GeneDiseaseReadings.section` limits records to the active category. Standalone rendering
  without a workspace provider retains all sections as a readable document.
- Disease selection is always explicit. A single available disease is named with inheritance
  and identifier before the review action. No disease-dependent navigation appears until selection;
  gene-level dosage remains available. Missing/error source responses retain their distinct actions.
  Starting a review from no disease opens Validity and focuses its tab; changing an existing disease
  preserves the active section.
- Submitter names and categorical marks both pin the same original record, idempotently.
  Clear pin is the release action. The selected row is highlighted in both representations.
- A pin remains visible in the inspector across category changes. Show pinned record opens its
  source records, clears filters and focuses the corresponding named control. Presentation state
  and source-record identity remain separate; selecting another allele resets workspace state.

## Inspector ownership

- `GeneDiseaseRail` uses the read-only workspace model; it does not create an API client or
  fetch sources. The main workspace owns source retries.
- `EvidenceReadingInspector` accepts an optional workspace-owned empty state and guide visibility.
  The Gene-disease empty state is a review overview, replaced by selected-record facts and notes.
  Other inspectors retain their existing defaults.
- Sources & availability contains exactly one entry per provider. Status, release/retrieval
  information, terms, safe source URL and fingerprint live together. Available means source data
  was returned, not that the user reviewed it. Missing, empty and failed responses stay distinct.
- Reference & methods consolidates classification definitions, matching scope, freshness policy
  and interpretation boundaries. Its disclosure uses the existing persisted expansion state.
- The general research guide remains available from the page header. Record-specific scientific
  qualifications remain beside the selected reading; no second general-guide button is added there.

## Verification and reproduction

- `npm run lint`: architecture, focus indicators, verification parity and TypeScript.
- Seven focused test files: 86 passing tests, including the shared scientific model, source-state
  distinctions, explicit single-disease selection, category/presentation independence, pin persistence
  and keyboard recovery, consolidated sources, and unaffected context inspectors.
- `npm run build:client`: passed; Vite still reports the existing large-chunk advisory.
- `npx e2e run tests/gene-disease-workspace.e2e.ts --output .e2e/proof/gene-disease-navigation-final --trace on`:
  production AppViews and inspector, light/dark at 1440/800/390 px, document overflow checks,
  all four categories, keyboard pin/recovery, reference disclosure, deselection and single-disease choice.
- Preview: `/tools/evidence-preview/index.html`, Evidence = Gene-disease, Example = Differing assertions
  or Single disease. Fixtures are explicitly illustrative, with live provider calls disabled.

This proof covers production components in the preview wrapper. It does not claim a fresh live
NAE1 analysis, full-shell acceptance or a full-suite run. Unrelated working-tree edits are preserved.
