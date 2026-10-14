# Evidence visualization contracts

Use these alongside the scientific-integrity checklist. A chart must make values easier to
interpret without adding biological certainty that the payload does not carry.

- Name every axis and its reference frame. Genomic coordinates, transcript-direction offsets
  from a variant, and splice-site numbering are different quantities. Label each explicitly.
- An exon boundary is not automatically a splice junction. First/last exon termini must be
  distinguished from acceptors/donors, including neighbouring exons. Do not print sequence
  motifs unless the actual sequence supports them.
- Compare like quantities on shared linear scales. Four SpliceAI channels can share 0–1 dot
  plots. Attribution shares, prediction deltas and experimental measurements remain separate.
- Keep the full score range available. A focused axis must state its bounds and cannot silently
  clip a score. Keep quantitative markers at their true positions; use arrows and exact values
  for off-view positional data.
- Separate reporting windows (which can require re-scoring) from map zoom and display filters.
  View controls must not change scientific calls, stored scores or provider settings.
- State local drawing floors as display filters, with their numeric bounds. Preserve small
  non-zero values in readable details; zero and missing remain distinct states.
- Label supported/indeterminate regions with their exact inequalities. Authors' operating
  points are secondary context, never extra evidence strengths.
- Channel names describe the prediction being measured, not a confirmed biological event.
  Positional coincidence with annotation is context, not validation of transcript consequences.
- Put the values and their positional map together. Hover information needs a keyboard-accessible
  equivalent, such as native details containing exact scores, offsets and annotation matches.
- Keep geometry and interpretation in the shared pure model; presentation owns zoom, focus and
  visibility. Test biological boundaries, strand conversion, off-view behavior and the invariant
  that display changes do not change evidence or engine records.

Prefer the host's collaborative preview tools when available. Use a fixture harness with current
styles and the real evidence wrapper; check light/dark themes and an approximately 800 px main
column. Remove temporary harness files after review.

For assembly composition, interface support denominators and persistent map controls, also
read [second-pass-design.md](second-pass-design.md). Preserve reusable preview harnesses under
`tools/`; only disposable screenshots, logs and browser profiles belong in scratch space.
