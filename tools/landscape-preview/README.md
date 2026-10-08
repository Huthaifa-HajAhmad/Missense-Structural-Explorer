# Landscape visual review

With the repository Vite development server running, open `/tools/landscape-preview/index.html`.
This renders the production Landscape and resizable inspector components, with explicitly labelled SOD1 test fixtures. Some fixture values are stand-ins; this page is not scientific evidence and never runs a live analysis.

Check the whole-protein, focus-residue, agreement and nucleotide tabs; filter and select plotted residues; adjust score ranges with the keyboard; resize/collapse the inspector; switch theme; and inspect narrow viewport stacking. The nucleotide view intentionally exercises the unresolved-coordinate state.

The reusable `WorkspaceTabs` and `VisualizationPanel` components establish navigation and figure framing. Biological score interpretation remains in `shared/landscapeEvidence` and the existing threshold models. The pilot retains SVG rendering; it does not add a chart-engine dependency.

Append `?fixture=long` for a clearly labelled synthetic 1,500-residue density fixture. This exercises dense ClinVar/gnomAD tracks, independent class count scales, three-letter metadata, and disagreeing query/table AlphaMissense values (0.108 vs 0.179). Its sequence, records, domains, and scores are layout stand-ins; they are not ATP7A evidence.
