# RNA splicing workspace

Date: 2026-10-11. Branch: `feat/splicing-workspace`, based on `53051d6`.

RNA splicing now uses the shared Evidence workspace. The Splice map and Source records views
share a pinned reading with the channel comparison, predicted-site table and inspector. View,
selection and map controls survive navigation and reset for a different analyzed allele.

The map itself has been redrawn with an annotated-transcript track above a separate prediction
track. Both use the same horizontal coordinates. Larger exon blocks, aligned coordinate guides,
backed channel labels and selected-marker outlines make the relation between structure and
predicted effects easier to follow. The map precedes the channel comparison. Below-floor channels
remain separate from the positional axis. The full 0–1 delta scale remains the default; focusing
the scale is explicit and cannot hide a score above its upper bound.

The splicing inspector has its own reading layout: a prominent exact score, paired genomic and
transcript offsets, grouped provenance and an interpretation disclosure. Its rule trace uses a
lighter timeline with the engine record visually separated. Threshold rows fit the rail, and
source metadata uses stacked labels so long provider and transcript names remain readable.

## Findings and decisions

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| Medium | SpliceMap.tsx; splicing.css | Structure, predictions and labels competed in one drawing. | Separate, aligned tracks; explicit headings; larger marks; backed labels; neutral below-floor channel buttons. | Clear hierarchy and readable selection without changing the scientific axes. |
| Medium | SplicingTab.tsx; SplicingRail.tsx | Selecting a plotted channel did not expose its complete source record. | Linked map, table and inspector pins, with keyboard selection and exact values. | A visual reading can be traced to the returned score and provenance. |
| Medium | SplicingReadingInspector.tsx; SplicingRail.tsx; splicing.css | Uniform fact rows buried the exact score and paired offsets; fixed-width threshold columns crowded the rail. | A distinct score hierarchy, paired coordinate readings, grouped provenance, interpretation disclosure and fluid threshold rows. | Make the selected reading and its origin easier to scan at desktop and narrow widths. |
| High | SpliceWindowControl.tsx | An in-flight request could outlive its allele; a saved default could look like score provenance. | Scope requests to allele, coordinate and assembly; verify the returned reporting window; preserve the prior payload on failure; leave unknown provenance unselected. | Prevent stale results or preferences from being presented as the current source evidence. |
| Medium | splicingWorkspace.ts | Rounded visual values and display filters were insufficient for exact inspection. | Preserve all four channels, including zero, missing scores and missing positions; expose genomic and strand-aware transcript offsets separately. | Missing is distinct from zero; display filters do not change source records. |
| Low | splicing.css | Narrow layouts compressed numeric context and chart targets. | Keep the position numeral intact and give the map and records independent horizontal scrolling. | Preserve legibility and pointer targets without page overflow. |

No rule-engine criteria, strengths, thresholds, weights or classifications changed. Existing
SpliceAI PP3/BP4 support remains distinct from the engine's recorded missense vote. The new
adapter consumes `buildSplicingEvidence`; it does not replace its evaluator or geometry.

## Reference cases

The preview uses a recorded NAE1-shaped payload with **illustrative** SpliceAI channels and
geometry. These are presentation fixtures, not new biological evidence. Reverse-strand offset
`+25 bp` in genomic coordinates becomes `−25 bp` in transcript direction; unresolved strand
retains the genomic offset and explicitly refuses transcript orientation. Zero, missing scores,
missing positions, small signals and a same-residue alternate allele have distinct cases.

The inspector retains reporting window, masking, prediction annotation set and geometry
transcript. Positional coincidence within 1 bp is context, not experimental confirmation;
the prediction annotation set and resolver transcript may differ. dbscSNV and AlphaGenome
remain context readings, not extra independent splice votes.

## Verification

- Full Vitest with coverage: 357 files passed, 2 skipped; 4,543 tests passed, 5 skipped.
  The completed suite was rerun after the map drawing changed and exited 0. Coverage:
  statements 79.70%, branches 72.98%, functions 82.04%, lines 81.16%.
- Focused splicing interaction, model and window tests: 55 passed after the inspector redesign
  and final reporting-window correction. These include mismatched response/provenance windows,
  precomputed-source provenance, late responses and linked map/inspector behavior.
- `npm run lint` passed, including TypeScript, architectural boundaries, focus-indicator checks
  and verification parity. Deployment Python tests (10) and evidence-context import tests (4) passed.
- Client production build passed. The native esbuild CLI reported `Access is denied` when writing
  server outputs in this worktree. Equivalent server, worker and admin bundles compile through
  esbuild's `write: false` API and Node filesystem writes; no permissions or build scripts changed.
- Browser inspection: light and dark, 1500 px desktop, 800 px and 390 px. Checked selected map
  labels, linked inspector/table, keyboard arrow navigation, exact values, zero and missing states,
  unresolved strand and intentional inner scrolling with no document overflow.
- The browser initially lacked document focus. After control returned, `document.hasFocus()` and
  `:focus-visible` were both true: map arrow navigation and the inspector Clear pin button each
  displayed a 2 px focus outline. Narrow inspector reveal, keyboard focus, clear-pin and empty
  states were also inspected. Automated browser geometry CLI checks were not run because they
  launch a second browser, which the integrated browser tool prohibits.

## Limits and follow-ups

Live API calls are blocked by the illustrative preview. Successful re-scoring, failure retention
and stale-response rejection are verified by interaction tests, not a live provider request.
The work is isolated in `Missense-Splicing-Workspace`; unrelated functional-domain findings and
`architectureLayout.ts` were not changed. Recheck shared-style integration when merging into the
actively edited main workspace.

## Review resolution (2026-10-11, senior reviewers)

The three senior reviews produced a ranked list of findings; every addressed item is recorded here.

| Severity | Finding | Resolution |
|---|---|---|
| Major | The workspace mode hid the "Splice readings" table (dbscSNV and AlphaGenome rows, cut-point rulers, About buttons, PP3/BP4 legend) from the real app, because the app always enables the workspace. | The table now renders in the Splice map view whenever the workspace is enabled, and in legacy mode as before; the Source records view keeps exact values and the inspector. The window control stays mounted in the workspace tools row in the map view (the readings table's own control is legacy-only), so the re-score instance does not unmount. |
| Major | Zero and below-floor channels showed their raw delta offset as a location ("−100 bp · transcript"). | Records and the inspector now state "No meaningful position"; the raw offset survives only as a labelled provenance fact ("Raw genomic offset (not a position)"), so nothing on screen asserts a place where none exists. |
| Minor | The map and records duplicated the annotated-site rule, so they could disagree. | The coincidence test moved to `annotatedSpliceSite` in `splicingEvidence.ts`; the map, records and inspector all derive from it. |
| Minor | Predictions implied they belong to the displayed transcript; the caveat sat in collapsed notes. | The map's control row states that predictions are scored against SpliceAI's own annotation, which may differ from the shown transcript. Root fix: the Broad re-score now carries the service's own `transcriptId` in provenance (server), surfaced as "Prediction transcript" in the records' provenance. |
| Minor | The re-score's window check compared the response against the request, mostly a tautology. | `spliceai_broad.ts` no longer falls back to the requested distance: provenance `distanceBp` now means the provider stated the window, so checking the returned provenance is a real cross-check. |
| Minor | Every map mark was a tab stop, arrows also re-pinned, `aria-pressed` promised a toggle, and decorative SVG text reached screen readers. | Roving tabindex with one tab stop on the pinned mark (or the first drawn), arrows move focus only, and all decorative `<text>` elements are `aria-hidden`. Pin buttons keep the workspace-wide selection convention (pin via control, release via the inspector's Clear pin), so `aria-pressed` marks which control owns the pin; that convention was kept deliberately across the nine workspace tabs. |

The identity-key mismatch the review flagged as uncertain proved to be the same unmount issue
recorded under the first row: it is now impossible for the view switch to drop an in-flight
re-score, and the allele/locus/assembly guard is unchanged. The lane/stem and broad-count findings
of the molecular review are addressed on the main checkout (residue-space lane packing,
covering-box stems, broad matches excluded from the count); see `MOLECULAR_WORKSPACES_REVIEW.md`
and the review-resolution commits on the current branch.

UI polish review: **Approve** for the inspected rendering and interactions. Live-provider behavior
and the automated geometry CLI remain **Not verified**, as described above.

## Sources

- [SpliceAI reference implementation and reporting/masking options](https://github.com/Illumina/SpliceAI).
- Jaganathan et al. (2019), DOI [10.1016/j.cell.2018.12.015](https://doi.org/10.1016/j.cell.2018.12.015).
- Walker et al. (2023), DOI [10.1016/j.ajhg.2023.06.002](https://doi.org/10.1016/j.ajhg.2023.06.002).
- [ClinGen SVI Splicing Subgroup response to feedback](https://www.clinicalgenome.org/docs/clingen-svi-splicing-subgroup-response-to-feedback/), March 2024.
- Jian et al. (2014), DOI [10.1093/nar/gku1206](https://doi.org/10.1093/nar/gku1206).
- Existing scientific audit: [SPLICING_TAB_REVIEW.md](SPLICING_TAB_REVIEW.md).
