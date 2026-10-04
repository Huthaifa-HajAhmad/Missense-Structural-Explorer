# Charting and visualization plan

This file establishes the visualization contract after the RNA splicing review on 4 October 2026.
The previously referenced file was absent from this checkout; this is a new plan, not a recovered
copy of its earlier contents.

## Principles

Scientific truth, traceability, legibility and visual polish are the order of priorities.
Use the evidence-tab-refactor skill and its `references/data-visualization.md` checklist.

1. Match charts to the question: score rulers for evidence bands, shared-axis dot plots for
   comparable model channels, and positional maps for locations and transcript annotation.
2. State units, reference frames, score ranges and exact boundary inequalities.
3. Keep attribution, prediction and observation visually and verbally distinct.
4. Treat zoom and local display filters as view state; show reporting windows separately.
5. Preserve out-of-view and small non-zero values in arrows and accessible exact-value details.
6. Render the shared pure evidence model; keep provider calls and engine classification separate
   from visualization controls. Verify display changes cannot alter the evidence outcome.

## RNA splicing — implemented

- Exon termini distinguished from splice junctions; no inferred AG/GT motif labels.
- Four channel dot plots share a linear 0–1 scale beside the positional map.
- Variant-centred transcript-direction positions are labelled separately from donor/acceptor numbering.
- Taller labelled SpliceAI delta lane, full 0–1 range and optional explicit 0–0.3 focus.
- Independent map zoom; directional arrows and exact offsets for predictions outside the view.
- Explicit default display filter (delta >= 0.01), optional inspection of smaller non-zero signals.
- Exact-value tooltips with keyboard-accessible native details.
- Hero ruler prioritizes the splicing evidence bands; authors' operating points remain secondary.
- AlphaGenome attribution remains informational. ACMG engine behavior is unchanged.

## Future tab reviews

Apply these contracts to each tab during its own evidence audit. Choose a chart only when it
answers a concrete comparison or location question; do not introduce charts for absent values
or combine incompatible scores into a composite visual.
