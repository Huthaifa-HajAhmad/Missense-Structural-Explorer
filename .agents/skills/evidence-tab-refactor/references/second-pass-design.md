# Second-pass evidence design

Use when a tab has already been audited or when several tabs are being upgraded together.
Read the current review before changing the evidence contract. A second look should improve
how a researcher reads and explores the evidence, not just repackage a table in new cards.

## Scientific atlas, shared workspace

- Establish the question and primary figure first. Retain a compact finding and its necessary
  qualifications; put repeated metadata behind a disclosure when it pushes the figure away.
- Share navigation, stable reading keys, pins and focus behaviour through `EvidenceWorkspace`.
  Keep a domain-specific figure: a transcript map and a protein interface map need different axes.
- Source records and the inspector preserve exact values, native units, original annotation bounds,
  availability and source. A view filter changes visibility, never evidence or the engine result.
- Persistent pins survive navigation. A filter may hide the source, but must explain that state.
  Provide an explicit reveal action rather than stealing focus when switching views.
- Use a bounded initial view for dense evidence, showing totals and access to the full records.
  Derive grouping, ratios and source identity in pure shared presentation models.

## Visual relationships need evidence

- Assembly membership supports a labelled composition schematic. Do not arrange chains into a
  putative interface, draw contact edges or place the variant in space without supporting geometry.
- Keep native, fibril and outside-deposited-assembly support separate. Show each partner pair's
  denominator beside any percentage mark. Returned structures are not independent experiments.
- Show existing numbering-remap provenance when supplied. Otherwise say the mapping is unverified;
  identical residue numbers are not proof of isoform identity. Do not claim a fresh sequence check.
- Keep a full score axis available. Include unpositioned scores in any focused-axis guard. A small
  drawing floor needs a label and a way to inspect the exact value; missing never becomes zero.
- Validate restored numeric view controls. Reset transcript-specific state when transcript changes;
  keep display windows distinct from provider reporting windows that would require re-scoring.

## Taste and review

Use a restrained hierarchy: readable figure titles, aligned labels, neutral quantitative marks,
quiet surfaces and deliberate whitespace. Reserve semantic colours for their established meaning.
Prefer an informative comparison or positional map to a decorative illustration.

Render the actual wrapper and inspector with current styles in both themes. Review a dense case,
a sparse case and missing/unpositioned data at wide, intermediate and phone widths. Check label
collisions using browser geometry, not just a screenshot. Check keyboard selection, explicit
focus transfer, hidden pins, tab remount and new-allele reset. Keep a repeatable preview if it
exercises durable contracts; record its fixtures and limitations in the review.

Reference implementation: `doc/MECHANISM_WORKSPACES_REVIEW.md`,
`src/shared/mechanismWorkspace.ts`, and `tools/mechanism-preview/`.
