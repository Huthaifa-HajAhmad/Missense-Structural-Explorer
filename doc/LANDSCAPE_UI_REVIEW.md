# Landscape presentation review

The requested pass simplifies the Landscape tab and its residue inspector.

- Suppressed the repeated selection and 3D navigation row in the Landscape workspace. The inspector retains selection details.
- Moved the reading guide to the opposite side of the heading.
- Replaced repeated full warning cards with one icon-led disclosure above the heading, retaining every caution.
- Consolidated overview footer qualifications and aligned the focus action at the far edge.
- Kept the empty UniProt annotation message in the consolidated footer so absence stays explicit.
- Made the band legend distribute across the available width.
- Corrected the inspector's misleading reference to a missing-data caution when the issue is score disagreement.
- Allowed score rows to wrap in narrow inspectors.

No thresholds, source values, or rule-engine behavior changed.

Validation: lint and TypeScript passed. All 34 Landscape browser geometry checks passed, including light/dark inspector cases, contrast, letter collisions, keyboard access and narrow overflow. Screenshot inspected from tools/landscape-geometry/landscape-geometry.png. The harness uses SOD1 fixtures, not the screenshot's live GATA4 result.

Follow-up: verify the full heading and caution disclosure in the live GATA4 workspace; the existing geometry harness covers the figure and inspector rather than the complete application heading. A future improvement is to replace long regional-constraint provenance in the inspector with a short reading and expandable source details.


## Regional source disclosure
The regional O/E row now keeps the ratio and residue range visible. Source and transcript information stays in a closed, keyboard-accessible Source details disclosure, together with a reminder that regional O/E does not score the selected substitution. No source text is shortened or discarded. Inspector tests check the default closed state, expansion and retained source text.


## Selection and context interaction pass
- Substitution fill marks the substitution the reading above is on (the picked letter, or the queried variant before any pick); the query keeps its clay outline. Each letter exposes `aria-current` to assistive technology (it is a single choice, so it is not a toggle).
- Score disagreements expand in the inspector with the complete shared-model caution.
- The queried ClinVar record stays visible; other substitution records expand separately.
- Independent lane toggles use checked rectangular controls rather than the summary controls' pills.


Validation for the interaction pass: 113 Landscape tests passed across eight files. All 34 browser layout assertions passed in the geometry harness. The final lint run passed the boundary, focus and parity checks, then TypeScript failed on an unrelated concurrent change: src/components/energetics/RetryDynamut2.tsx:39, parameter previous implicitly has an any type. That file was not changed in this pass.

Live GATA4 p.Ser159Cys was submitted through the query form on port 3917. The analysis resolved to UniProt P43694, but reported Landscape query failed (and degraded gnomAD service). Preview then reported an HTTP transport failure and the page reloaded into a blank loading state. The complete populated GATA4 workspace could not be verified in this run; fixture validation must not be described as live-data verification.


## Verification resumed 1 November 2026
- The unrelated RetryDynamut2 type error has been corrected in the shared workspace. Current lint and TypeScript checks pass.
- All 120 targeted tests pass across nine files, including the shared ExplorationWorkspace navigation tests.
- The Landscape geometry harness passes all 34 assertions.
- The full suite completed: 6,086 passed, two failed, five skipped. Failures are outside this pass: coordinate-resolver provider timeout handling, and the energeticsComparison large-template repair warning expectation. Neither file was changed here.
- The real GATA4 p.Ser159Cys workspace loaded after a slow initial module load. Confirmed the reading guide at the opposite edge and the independent ClinVar toggle changing its pressed state. Expanded the saved collapsed inspector and confirmed residue S159 plus its explicit unloaded-score message.
- Inspected light and dark layouts at desktop and narrower widths; canvas, toolbar and inspector had no horizontal overflow at 1753px and 1000px.
- Live score/context requests did not populate in this run; the server reported a 429 rate limit and upstream timeout. Populated disagreement and ClinVar disclosures remain fixture-verified, not live-verified.


## Code-review follow-up (1 November 2026)
Fixed from the review of this pass:
- The selected lane and the agreement filters had no fill: they used `--cs-accent-clay-soft`, which is not defined anywhere. Both now use a landscape-local `--ls-clay-soft`.
- Warning text (data-cautions notice, score-disagreement note) used `--cs-text-warning`, about 3:1 on light surfaces. It now uses `--cs-text-warning-on-soft` (6.7:1).
- The notice summary said "Data cautions ? review..." (a literal question mark). It now reads "Data cautions (N) — review before comparing scores" and shows how many cautions it holds.
- The overview footer is split into an action row and a notes list, so absence notes no longer run together. "No UniProt domain or region annotated" is only claimed when the UniProt features actually loaded; otherwise the tab says the annotation was not loaded.
- Population and clinical context (ClinVar, gnomAD, regional O/E) now also shows on residues that have no score record.
- Inspector wording: em dash in the disagreement summary, en dash in residue ranges, "other" only when the queried record is already on screen, and no `role="note"` on the disclosure.
- Accessibility: lane switches with nothing to draw are `aria-disabled` (still focusable, reason in the title) instead of `disabled`; the legend is a labelled group; the queried-chip cue is a border (shadows vanish in forced-colours mode); the notice uses the same native disclosure marker as the others; context disclosures are 28px tall like the rest.
- The colour key keeps readable band widths and spreads to both edges.
- Duplicate CSS overrides were merged into their original rules; dead rules (`.ls-finding__caution`, `data-active` on lane switches) and stale comments were removed.

Decisions kept on purpose:
- The full score-disagreement text appears both in the tab's caution notice and in the inspector. Both are collapsed by default and both are built from the same shared-model string, so they cannot drift. The inspector copy was an explicit request (open the warning where the reader is).
- Not changed here because they belong to the Structure work in the same tree: the hidden `WorkspaceSelection` mount in the Landscape workspace (`AppViews.tsx`) and the `ExplorationWorkspace` navigation test. Remove the mount, the component and the test's "Inspect in 3D" step together with that change.

Verification: Landscape unit tests pass (inspector, toolbar, tab, presentation, shared model). The geometry harness now runs 38 assertions: the original 34 plus lane fill, lane height, legend width and warning-text contrast. The harness still does not mount the full `SequenceVisualizer`; the notice's position and collapsed state are covered by `landscapeTab.test.tsx` instead. `tsc` currently reports errors in other agents' files (`EnergeticsComparison.tsx`, `RetryDynamut2.test.tsx`), none in Landscape files.
