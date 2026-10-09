# Shared exploration workspace

Landscape and 3D Structure share a spacious two-pane layout. Main-pane pills navigate views or
model families; the inspector follows the selected residue. The queried substitution remains the
reference for variant measurements.

## Reuse

| Responsibility | Source |
| --- | --- |
| Pane geometry, gutters, rounding, narrow stacking | `components/ui/WorkspaceLayout.tsx`, `styles/workspace.css` |
| Keyboard pill navigation | `components/ui/WorkspaceTabs.tsx` |
| Pinned position and cross-view navigation | `components/ui/WorkspaceSelection.tsx` |
| Coordinate identity, modes, scientific interpretation | `shared/structure3dEvidence.ts`, `lib/useStructure3dEvidence.ts` |
| Indexed coordinates, guarded picks, selected-residue facts | `shared/structureSelection.ts` |
| View coordination and memoised coordinate index | `components/AppViews.tsx` |

Report also uses the frame (`kind="report"`): a heading, view pills for the document's parts
(`REPORT_GROUPS` in `shared/reportDocument.ts`, chosen view in `reportView` so the rail's contents list
can bring a block's part on screen), one panel per block and a rail led by a review-status box. It
has no residue selection, so it does not use `WorkspaceSelection`.

Population, Predictors and AlphaGenome now opt in with `kind="evidence"`. Their per-variant
display state lives in `EvidenceWorkspaceProvider`: view, pinned reading, feature filter and
expanded record groups. These selections do not change the protein residue or queried variant.
See [the Evidence workspace review](EVIDENCE_WORKSPACE_REVIEW.md) for figure and inspector contracts.

Paths above are relative to `src/`. `WorkspaceLayout` opts in with `kind="landscape"` or
`kind="structure"`; existing views retain their layout until deliberately migrated. Keep biological
rules out of shared UI components. No new runtime dependency or chart engine was introduced.

## Selection contract

- `selectedResidueIndex` is the pinned protein position. Hover uses `hoveredResidueIndex` and never
  overwrites it. Navigation clears transient hover.
- A residue selected outside Landscape updates its residue selection and clears stale nucleotide
  selection. A same-position Landscape substitution selection stays intact.
- A structure pick requires verified UniProt numbering, the existing variant-site identity check,
  a unique first-model protein Cα, matching chain/residue identity, and no insertion code. Author
  numbering and ambiguous chains cannot silently overwrite protein selection.
- Missing coordinates retain the pinned position and produce an explicit inspector state. They
  cannot produce a selected-residue highlight or a fabricated zero measurement.
- Selected-residue pLDDT/B-factor comes from the primary canvas coordinates and their provenance.
  Variant-site metrics continue to refer to the queried substitution and their existing source.
- The WebGL viewer mounts on first visit and stays mounted. Its last model family is retained
  while hidden. Landscape stays mounted, retaining its subview and focus window.

## Verification

`ExplorationWorkspace.test.tsx` checks deferred mounting, canvas identity, family/tab persistence,
selection reconciliation, hover/nucleotide reset, return-to-variant and focus hand-off.
`structureSelection.test.ts` checks ambiguous chains, insertion codes, first-model scope, the pick
guard (`linkedPickPosition`: inactive, unverified, superposed-model and foreign-chain picks),
missing values, zero and channel semantics. Pick provenance comes from `useMolstarPlugin`;
indexing lives in `coordinateText.ts`.
The existing Structure and Landscape suites continue to protect scientific presentation.

The labelled production-component fixture is documented in `tools/exploration-preview/README.md`.
It supports visual review without credentials, API calls or expensive folding jobs. Live analysis
and experimental coordinate retrieval are separate integration checks.
