# Insights and Literature: senior code review

2026-10-11. Three independent OpenCode reviewer agents used `opencode-go/deepseek-v4.1-flash`: Insights correctness and scientific integrity; Literature retrieval and data integrity; shared architecture, accessibility, security, performance and validation. The lead validated their findings against the saved code and performed targeted reproductions.

**Verdict: changes requested.** Two refactor defects are confirmed: P1 desktop scrolling and P2 recorded-strength lookup. One P3 coverage defect is also confirmed. A preexisting P2 glossary contradiction remains inside the refactored Insights surface. No classification-engine change, new injection vulnerability, or provider/state-reset failure was established.

## Scope and method

The review covered the 30-file Insights/Literature scope, including new untracked components/helpers/styles/tests, changed application integration, the preview harness, and review documentation. Reviewers compared scoped diffs against HEAD and read the current files and relevant dependencies. Earlier Interfaces/Splicing work and unrelated dirty files were excluded. The original snapshot, full file list and hashes are in `scratch/senior-review-snapshot.json`; the reviewed diff is in `scratch/senior-review-scope.diff`.

All three agents completed successfully. Their reports are preserved unedited:

- [Insights reviewer](../scratch/senior-review-insights-report.md), session `ses_ed3cbadfbffezKwt5lgTAamLV1`.
- [Literature reviewer](../scratch/senior-review-literature-report.md), session `ses_ed3cbadf5ffediQSkiwyzd0bfB`.
- [Shared-platform reviewer](../scratch/senior-review-platform-report.md), session `ses_ed3cbadffffe3QJ6P9jq2EXL2V`.

The lead checked the hashes after completion: **all 30 scoped files were unchanged**. This pass produced findings and review artifacts; it did not fix application code or alter tests.

## Confirmed refactor defects

### F1 — P1: desktop Insights cannot scroll to its lower sections

**Locations:** `src/components/AppViews.tsx:399`, `src/components/ui/WorkspaceLayout.tsx:7`, `src/styles/workspace.css:27`, `src/styles/insights.css:2`.

Giving Insights `kind="review"` adds `exploration-workspace`. Its more-specific primary-pane rule applies `overflow: hidden`, replacing the previous vertical scroller. Literature has its own `.lit-view` scroller; Insights' `.ins-shell` and `.ins-screen` grow with their content and supply none. At widths above the shared 1000px mobile stacking breakpoint, the lower evidence areas and decision guidance are clipped. Wheel scrolling cannot reach them. Keyboard focus or programmatic scrolling can move a hidden-overflow pane, which does not restore normal pointer scrolling.

Both the Insights and platform reviewers found this independently. The lead reproduced it with the real AppViews fixture in local Edge at **1500 × 1100**:

| Measurement | Result |
| --- | --- |
| Primary pane client height | 1006px |
| Primary pane content height | 2041px |
| Primary pane computed vertical overflow | `hidden` |
| “Still needed to decide” starts at | 1825px below the viewport origin |
| Scroll position before / after a 2400px wheel gesture | 0 / 0 |

The original 29-check browser matrix asserted horizontal fit, selection and focus, but never vertical reachability. Its passing result therefore did not cover this defect.

**Suggested correction:** restore vertical scrolling on the Insights reading surface or on a deliberately scoped review primary pane; retain the existing mobile stacking behavior. Avoid an unconstrained nested scroller. Add a rendered check that a real wheel gesture reaches the final evidence section on desktop, and that records and summary remain reachable at desktop and narrow widths.

**Reproduction:** `scratch/senior-review-scroll-check.mjs`, [measured result](../scratch/senior-review-scroll-reproduction.json), [screenshot](../scratch/senior-review-scroll-reproduction.png).

### F2 — P2: strength-suffixed criteria get a false inspector strength

**Locations:** `src/components/insights/InsightsScreen.tsx:135`, `src/components/inspector/InsightsInspector.tsx:98`, `src/shared/insightsEvidence.ts:542`.

The criterion rows retain the full recorded code, for example `PP3_Moderate`. The map and inspector strip the lane's suffix and compare `PP3` to that full row key. The lookup fails. The dedicated strength label disappears from the map; the inspector states **“Recorded strength: Not weighted.”** The criteria table and the bar length correctly use Moderate. The formatted code chip still includes its suffix, so the strongest contradiction is the inspector's explicit statement.

All three reviewers found this independently. The lead reproduced these joins with the real evidence builder:

| Recorded code | Actual strength | Bar group | Dedicated map label | Inspector label |
| --- | --- | --- | --- | --- |
| `PP3_Moderate` | Moderate | Moderate | Missing | Not weighted |
| `PP3_Strong` | Strong | Strong and above | Missing | Not weighted |
| `BS1` | Strong | Strong and above | Strong | Strong |

This is reachable for supported cached/earlier-engine records with suffixed computational codes. The current live engine generally emits bare PP3/BP4, so the review does not claim every live analysis is affected.

**Suggested correction:** resolve both consumers against the same recorded criterion identity, comparing exact codes or consistently canonicalizing both sides. Preserve the full recorded strength. Add a component regression using `PP3_Moderate` and assert the selected inspector states Moderate and the map's dedicated strength label agrees with the records view.

**Reproduction:** [evidence-builder result](../scratch/senior-review-strength-reproduction.json). Its PM2 case inspects the row join only; that fixture does not establish a suffixed population lane.

### F3 — P3: unsupported variant notation is presented as a zero-match coverage group

**Locations:** `src/components/LiteratureView.tsx:497`, `src/shared/reviewPresentation.ts:5`, `src/shared/literatureEvidence.ts:321`.

When `parseVariantForms` returns null, no variant-notation match is performed. The new coverage figure nevertheless offers **“Names the variant — 0 / N”** as an active filter. Selecting it always empties the table. The existing finding correctly explains that protein notation is unavailable, and the existing refinement controls omit that group, so the new figure contradicts those states.

The lead reproduced this with a loaded illustrative paper whose title and abstract explicitly contain `NAE1 c.123A>G`: forms are null, coverage reports zero variant matches, and the variant filter returns zero papers. That zero represents an unsupported check, not an observed absence.

**Suggested correction:** omit or explicitly mark the variant group unavailable when forms are null, matching the existing refinement behavior. Add a regression for unsupported notation with loaded papers.

**Reproduction:** [unsupported-notation result](../scratch/senior-review-unsupported-notation-reproduction.json).

## Confirmed preexisting defect in the reviewed surface

### F4 — P2: PM2's glossary strength contradicts the engine and records table

**Locations:** `src/shared/insightsEvidence.ts:612` versus `src/shared/insightsEvidence.ts:539` and `src/shared/acmgClassifier.ts`.

The guide still calls PM2 **Moderate**, while the current engine weighting and the criterion records call it **Supporting**. The refactor now places both in the Criterion records view. A comparison against HEAD confirms the wrong glossary string predates this change; it is not a newly introduced regression.

**Suggested correction:** align the glossary with the existing rule's Supporting strength, preferably deriving or validating strength words against the shared source. This changes presentation only, not the classifier. Add an assertion that the guide and recorded/default strength agree.

## Coverage and validation gaps

| Dimension | Review outcome |
| --- | --- |
| Scientific integrity and strength semantics | F2 and F4; no change to what the engine classifies was established. Stability remains mechanistic context rather than a pathogenic vote. |
| Functional correctness and responsive layout | F1; ordinary selection, filtering, pagination and empty/error paths otherwise trace correctly. |
| State, React lifecycle and architecture | Provider nesting, allele scope, remount persistence and memoized provider values show no confirmed defect. |
| Literature provenance and denominators | Loaded-set counts, curated inclusion, literal mentions and query-membership distinctions are preserved; F3 concerns unsupported checks. |
| Exports, report pins and clipboard | Desk exports consume the displayed list; shortlist exports retain the full loaded tiers 1–4 set. Pinning remains separate from inspection. Clipboard failures are awaited and reported. |
| Accessibility | Normal tab keyboard navigation, explicit focus, table labels and selected-state announcements are present. F1 prevents normal pointer access to lower content. |
| Security | Citation links use the existing safe-link path; new links retain opener protections and React text escaping. Existing export escaping remains. No new exploit was established. |
| Performance | No new asymptotic hotspot or rendering loop was established; coverage adds three linear passes over loaded papers. |
| Tests and preview | Added interaction assertions are meaningful. The lazy-chart wait retains behavior assertions. The suite misses vertical reachability and suffix-label parity. |
| Maintainability and documentation | Shared extraction preserves existing imports. The review documentation's exact-strength claim is contradicted by F2. |

Completed verification from implementation was reviewed as context: **4563 tests passed**, 5 skipped; 358 passing files, 2 skipped; lint and production build passed; 29 fixture browser checks passed. Broad checks were not repeated. The lead ran only the targeted browser scrolling and evidence-builder reproductions justified by new findings.

Prioritize regressions for F1–F3 and glossary parity for F4. Additional useful coverage includes actual downloaded BibTeX/RIS/CSV contents for the eight-paper desk versus the full shortlist, selected-source absence after a new query, and clipboard success as well as failure. These are validation gaps, not proof of additional defects.

## Triage of remaining reviewer comments

- **Loaded versus query-loaded counts:** not retained as a correctness defect. The existing fact subline explicitly names curated additions outside the query, and the coverage note explicitly includes them. Renaming “Loaded here” could improve clarity.
- **Pending reveal when a target disappears:** remains an unconfirmed race hypothesis. Normal hidden-selection reveal is covered and works; a missing DOM target cannot be consumed immediately because filters are cleared in a subsequent effect. Any hardening should preserve that behavior.
- **Print disclosures:** closed method/search-fact disclosures may disappear in browser print. The Report is the documented export surface; no required print contract for these tab disclosures was established. Treat as a product-intent follow-up.
- **Literal inspector IDs, 36px text actions and API-settings error action:** maintenance/usability suggestions, not established regressions. The IDs currently agree, and the target-size observation alone does not establish an accessibility violation.
- **Curated provider URLs:** direct `sourceUrl` links predate this refactor. Client scheme-validation parity and producer guarantees deserve a separate bounded security follow-up; this review did not establish an exploitable producer path.
- **Moved-helper comments:** `insightsSnapshot.ts` still names the former helper location; re-export compatibility remains intact. Documentation follow-up only.

The reviewers did not audit live provider authentication, every server route or unrelated concurrent changes. Browser reproduction used labelled fixtures, not clinical evidence. The report records defects and limits; it does not imply a complete security or scientific sign-off.

## Resolution

The subsequent Query and synthesis finishing pass resolved F1–F4 and added regression coverage. Desktop wheel scrolling, recorded strengths, PM2 guidance, and unsupported-notation coverage were verified in the integrated browser. See [implementation and verification](QUERY_SYNTHESIS_FINISHING_PASS.md). The original review above is retained as the historical findings.
