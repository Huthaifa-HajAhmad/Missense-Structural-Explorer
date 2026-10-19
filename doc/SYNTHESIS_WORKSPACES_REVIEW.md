# Synthesis workspaces: ownership and integrity

18 October 2026. Scope: Insights, Literature, Report, their shared presentation models and
inspection/export contracts. The existing Evidence workspaces already give Comparison and named
detail views distinct ownership; this pass applies that principle to synthesis. No classification
rule, threshold, tool vote or evidence strength changed.

## View ownership

- Insights: Evidence map owns the directional comparison and agreement/difference reading.
  Criterion records owns the engine audit, uncounted model proposals and glossary.
  Evidence gaps owns hypothetical additions and missing evidence. Written summary remains a
  labelled excerpt with a route to the full report.
- Literature: Reading desk is the only bibliography. Eight matching papers are initially shown;
  an explicit expand/collapse action exposes all loaded matches in place. Mention coverage owns
  the disjoint literal-mention figure and abstract-availability counts. Selecting a group opens
  its matching papers. Exact records remain inspectable; selection is separate from report inclusion.
- Report: Full document remains an export preview. Interpretation and Evidence readings select
  document sections, not independent analyses. Narrative & notes owns editable prose; Citations &
  methods owns pinned publications and provenance. Screen filters never alter export inclusion.

## Findings and fixes

| Severity | Finding | Resolution and regression evidence |
| --- | --- | --- |
| High | The synthesis headline/table could read an older merged narrative list while the map read the raw engine list, allowing different counts on one screen. | Prefer the available raw record, including an empty list. Preserve the recorded verdict. `insightsEvidence.test.ts` covers omitted PM2 and empty raw records. Report and inspector consume the same model. |
| High | A recorded predictor criterion opposing the current vote could be described as the current plurality call. | Explicitly identify disagreement and recommend refreshing the analysis. Preserve the recorded code; no engine change. Model regression covers an opposed vote. |
| Medium | Supported but unrecorded population evidence was described as all frequency criteria being unmet. | Distinguish support from recording, identify known weighting suppression, and draw the uncounted direction with the existing dashed convention. |
| High | Browser print from a filtered Report view silently omitted included sections outside that view. | The print override now shares Tailwind's base layer, so its important hidden rule cannot win. Browser check verifies classification prints from Citations & methods. |
| Medium | Literature's two views duplicated the same bibliography and controls; only the row limit differed. | One expandable reading desk; independent Mention coverage. `ReviewWorkspaces.test.tsx` covers ownership, bounded exports, all-paper expansion and explicit reveal focus. |
| Medium | Mention counts did not disclose how many loaded records lacked abstracts. | Add a pure text-coverage model and labelled denominators, explaining title-only screening. `reviewPresentation.test.ts` covers missing abstracts. |
| Medium | “Nothing conflicts” sounded conclusive despite missing inputs. | Qualify the statement to available readings. Missing evidence remains explicit. |
| Low | Gaps, hypothetical additions and model proposals prolonged the comparison view. | Give gaps their own tab and put proposals with the criterion audit, explicitly uncounted. Component/browser ownership regressions. |
| Low | Report combined narrative editing with sources and methods. | Split into two descriptive views using the same group map as the contents rail. `ClinicalReportBar.test.tsx` verifies grouping and unchanged inclusion. |
| Low | Literature finding text pointed to a control “below” that is now in another view. | Name Reading desk explicitly. |

## Verification

- `npm run lint`: boundaries, focus indicators, verify parity and TypeScript passed.
- Full Vitest run: 426 files passed, 2 skipped; 5,422 tests passed, 5 skipped.
  Subsequent focused tests passed after the final copy, ownership and print fixes (89 tests),
  with a final 44-test model/workspace run after the population-direction and focus changes.
- `tools/review-preview/check.mjs`: 63 browser checks passed, no runtime errors. Includes
  persistence, selection/reveal, bounded lists, pagination, provider-error and empty states,
  widths of 1500/800/390 px, light/dark screenshots, new-allele reset and full-document printing.
- Native application smoke: `npx e2e run tests/smoke.e2e.ts --output .e2e/proof/synthesis-smoke`
  passed. Browser fixtures render actual AppViews, stores, primary panes and inspectors.
- Inspected rendered screens through T3 preview and saved fixture screenshots under
  `scratch/review-preview/`. Test logs are `scratch/synthesis-vitest.log` and
  `scratch/synthesis-focused.log`.

## Reference case and limits

NAE1 p.Asp116Gly remains VUS for the reference record containing PP3. A regression fixture with
raw PP3 + PM2 and a stale merged PP3 list now consistently displays both raw criteria. This is
a record-presentation correction, not a newly applied criterion.

Dense literature uses explicitly illustrative publications (25 loaded, then 36), with sparse,
missing, degraded and failed-provider fixtures. It does not validate live retrieval or paper
conclusions. This pass does not revalidate every underlying scientific threshold; prior domain
audits remain authoritative. Literature screening is still a literal and lexical aid, not a
quality assessment. The report retains its existing documented evidence-coverage limits.

Unrelated concurrent working-tree edits were preserved. No deployment or commit was requested.

## Primary references

- Richards et al., 2015, DOI [10.1038/gim.2015.30](https://doi.org/10.1038/gim.2015.30):
  terminology and combining framework; no new combination rule introduced here.
- [Europe PMC REST service](https://europepmc.org/RestfulWebService): retrieval and metadata
  scope. Loaded records, total query matches and available abstracts remain distinct.

The raw engine record is the authority for what this run counted; neither a publication mention
nor a model-authored narrative is promoted into a recorded criterion by these changes.


## Senior-review findings addressed

- Empty Mention coverage now transfers focus to the persistent Reading desk tab when its
  action removes the focused button. Coverage rows use ordinary action-button semantics;
  they navigate to matching papers rather than claiming a toggle state.
- All paper-export handlers reject requests from coverage. The shortlist button is disabled
  there with an explanatory message. On the desk its intentionally broader scope is explicit:
  all loaded Read first/Read next papers, including papers outside display filters.
- Agreement and disagreement sentences label every uncounted contributor in the sentence.
  The map caption describes available readings rather than claiming all are recorded criteria.
- Abstract coverage tests now include mixed nonempty, whitespace-only and empty abstracts,
  zero loaded records, and the rendered availability block.
- Collapse labels use READING_DESK_LIMIT; report group labels match their tabs. Printing the
  coverage view retains its mention figure and abstract counts.
- The reported researchGuides.ts Source records phrase describes Energetics, not synthesis;
  it remains outside this change. Unrelated scratch artifacts are left untouched as requested.

Focused regression suite: 60 tests passed. Lint (including TypeScript) passed. The browser checker
accepts REVIEW_PREVIEW_SCOPE=synthesis to exercise this thread's surfaces without the independent
Query checks. The default still runs those checks; the current Search work renamed a control used
by their existing locator, so the unscoped run timed out there. No Search implementation or test
assertions were changed to mask that failure.
