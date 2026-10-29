# RNA splicing and Interfaces & PPI workspaces

11 October 2026. Second presentation pass, building on the existing splice map, interface tracks
and audited evidence models. Read alongside [the splicing audit](SPLICING_TAB_REVIEW.md) and
[the interface audit](INTERFACES_PPI_REVIEW.md). This review covers the shared workspace design;
concurrent scientific/code fixes have their own history.

## What changed

Both tabs now use the application's two-pane Evidence workspace. A figure or source-record
selection pins the same reading in the inspector. View, filters and selection survive tab navigation
and reset for another analysed allele. An explicit **Show selected reading** action reveals and
focuses a record; ordinary view changes do not steal keyboard focus.

| Tab | Primary view | Detail and interaction |
|---|---|---|
| RNA splicing | Existing transcript-direction splice map, with more space for the figure and less repeated header detail. | Map and Source records views; keyboard-selectable predicted sites; persistent map window, score-axis choice and small-signal display. Exact scores, positions, transcript and source appear in the inspector. |
| Interfaces & PPI | Interface atlas with protein reference, selectable annotation/contact layers and whole-protein or residue-neighbourhood views. | Separate Partners and Source records views; persistent search, tiers and folds; selectable tracks and support comparisons. Native, fibril and outside-assembly contacts retain separate denominators. |

Interfaces now uses a bounded support comparison below the map: at most six partner pairs per
structural context, with full totals and a route to records. Each row shows its own numerator and
denominator. The 0–100% axis describes returned-structure support, not binding strength or
independent experimental replication. The assembly illustration is a composition ledger with
explicit qualifications; its chain arrangement does not imply molecular geometry or contact edges.

## Findings and decisions

| Finding | Resolution |
|---|---|
| Basic cards and dense records competed with the biological question. | Lead with the positional figure; move exact records into a named view and repeated facts into disclosures. Keep the finding visible. |
| Chart and table selections had no persistent shared reading. | Add stable keys and pure presentation models in `shared/mechanismWorkspace.ts`; both rails render those readings above their existing traces. |
| Filtering could silently separate a pin from its visible source. | Preserve the pin, explain the current display restriction, and provide an explicit reveal action. |
| Assembly composition could be mistaken for physical arrangement. | Replace the spatial cartoon with labelled chain membership and a schematic qualification. |
| Interface support from different structural contexts could be compared without seeing denominators. | Separate contexts, retain exact k/n, and explain that structures are not independent experiments. |
| Residue numbers alone could imply a verified isoform mapping. | Display a recorded report-to-canonical remap when present; otherwise explicitly disclose the absent mapping record and the limits of matching numbers. |
| An invalid restored splice zoom could produce an unusable axis. | Accept only supported map windows; fall back to automatic bounds. |
| Adjacent donor/acceptor annotation labels overlapped at broad map windows. | Place nearby labels on opposite sides of their stems; verify their rendered bounds. |

No engine criteria, thresholds, source values, votes or classification were changed by this
presentation pass. Display controls do not trigger re-scoring. A missing score remains missing;
the full score range stays available, and an unpositioned high score prevents a misleading focused
axis. An unresolved strand does not acquire invented predicted-site positions.

## Design philosophy for subsequent passes

Treat each tab as a scientific atlas: a clear finding, a useful figure, and a traceable record.
The second pass should improve the reading task, not merely add wrappers around the old table.
Use typography, alignment, restrained surfaces and whitespace to establish hierarchy. Neutral
evidence stays neutral; colour retains its scientific or interaction meaning. Keep domain-specific
figures while sharing navigation, persistent selections and inspector behaviour across tabs.

Every visual relationship must be earned by the payload. Membership permits a composition
schematic; spatial placement requires coordinates. A shared percentage axis still requires each
row's denominator. A window is a display choice, never a new provider reporting window.

The local [Evidence refactor skill](../.agents/skills/evidence-tab-refactor/SKILL.md) now records
this approach and links the current workspace reviews instead of prescribing the original
single-table layout for every tab.

## Verification

- `npm run lint` passed: boundaries, focus indicators, verify parity and TypeScript.
- New model and integration coverage: 10 passing tests for denominator/source identity,
  view-filter invariants, missing values, remapping disclosure, persistent selection and reset,
  explicit focus transfer, keyboard selection and the splice-axis guard.
- The related existing splicing/interface suites passed in the implementation pass.
- Browser fixture matrix: 21 checks passed, zero page errors. Reviewed both themes and 1500,
  800 and 390 px viewports; no document-level horizontal overflow. Wide figures scroll inside
  their panels. Checked selected-record focus, hidden layers, search remount, map persistence,
  unresolved strand, missing scores, high unpositioned scores, allele reset and label overlap.
  Source-record views and Partners also pass the 390 px overflow check.
- The updated local skill passes its frontmatter/scaffold validator.
- Full vitest rerun: **4,552 passed, 5 skipped** (357 passing files, 2 skipped files).
  The first run identified a separate attribution-test false positive: a Gemini documentation URL
  in a source comment was treated as an outbound data endpoint. Added a documented exception
  to the existing allowlist; its 12 focused tests and the full rerun pass. No transmission
  disclosure or runtime request behaviour changed.
- `npm run build` passed for client, server, workers, admin utility and copied runtime assets.
- `git diff --check` passed; review-document relative links resolve.

The repeatable fixture preview is [tools/mechanism-preview](../tools/mechanism-preview/README.md).
SOD1 and SLC12A4 use recorded reference payloads. Splicing edge cases are explicitly illustrative.
The preview blocks application API calls; this verifies rendering and interaction, not fresh
provider responses or new model computations.

## Interfaces & PPI, third pass (2026-10-29)

The assembly card and the sequence atlas, after the Hotspots work (doc/FUNCTIONAL_HOTSPOTS_PLAN.md §0):

- **Assembly card is always visible.** The collapsed disclosure left a card reading only "ASSEMBLY / Heterodimer". It now
  shows the label, the SUBUNIT qualifier as a chip, the chains, and the caption. A connector between two chains is drawn
  only where PDBe-KB measured a native, non-fibril, non-crystal interface for that pair, and reads "Ala5 not at it, in 118
  solved structures" or "Ala5 at it: 3 of 142 solved structures"; a chain with no solved pair gets no connector and a
  sentence saying the composition is from UniProt's SUBUNIT text. SUBUNIT text cannot place chains, so none is guessed.
- **One domain model for two tabs.** The Domains lane draws what the Functional domains map draws (`drawnDomains`: InterPro
  domain boxes when InterPro answered, else UniProt's), so NAE1's atlas shows the THIF fold the map shows instead of only a
  17-residue region. A UniProt Region that is also a mapped binding site (same bounds and note) is drawn once, in the
  sites lane.
- **Names that fit, callouts that do not.** The 6 % length rule is a measured fit: a name sits inside its range only when its
  rendered width plus padding fits, otherwise it is a callout under the lane (placed by `assignLanes`), so no box is an
  unlabelled rectangle. With no layout (a hidden tab) nothing is drawn until a width exists. Each domain and site lane ends
  in exact containment ("In domain", "At site", "Outside"), never an inferred nearness.
- **Per-residue native support is shared.** `nativeInterfaceSupport` reads the stored assembly for every residue with the
  same partner filter and labels as the tab, and says "not read" for a stale or absent assembly. The Hotspots table uses it.
- **Removed** the dead `.ifc-diagram*` and disclosure CSS.

Not changed: callout row height is still a constant (`CALLOUT_ROW_PX = 15`) mirrored in CSS, so a type-size change would
need both edited together.

## Remaining limits

- A full sequence-identity/isoform equivalence check (S15) is still open. Displaying the existing
  numbering record is not a substitute for that check.
- Interface tracks are not wired to 3D contact highlighting; that requires verified mapping to
  the displayed structure.
- Outside-deposited-assembly classification retains the conservative proxy and provider-failure
  qualifications documented in the interface audit.

## Scientific references

The prior audits remain authoritative for calibrated boundaries and source contracts. This pass
retains them; it does not introduce new scientific operating points. Relevant primary references:
[SpliceAI source documentation](https://github.com/Illumina/SpliceAI),
[ClinGen splicing recommendations](https://doi.org/10.1016/j.ajhg.2023.06.002),
[STRING's score definitions](https://string-db.org/help/faq/),
[PDBe-KB](https://doi.org/10.1093/bioinformatics/btab424), and
[DDMut-PPI](https://doi.org/10.1093/nar/gkae412).
