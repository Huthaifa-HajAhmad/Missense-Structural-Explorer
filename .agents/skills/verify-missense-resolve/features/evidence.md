# Evidence tabs and downstream views

Route `/` after an analysis. Tests: `tests/evidence-real-route.e2e.ts` (tags `live`, `evidence`).

Run a benchmark from Search (`Run benchmark PAH p.Arg408Trp`), wait for the sidebar's
`Evidence ... Complete` button, then drive the sidebar. This is the real route; the
`evidence-preview` harness used by the workspace tests mounts fixtures instead.

| Sidebar button | Workspace heading | Guide button |
| --- | --- | --- |
| Population data | Population Data | About Population data |
| Gene-disease | Gene-disease | per `EVIDENCE_GUIDES` |
| Expression | Expression | per `EVIDENCE_GUIDES` |
| Species & models | Species & models | per `EVIDENCE_GUIDES` |
| Functional domains | Functional domains | per `EVIDENCE_GUIDES` |
| In-silico predictors | Predictors | per `EVIDENCE_GUIDES` |
| AlphaGenome | AlphaGenome | per `EVIDENCE_GUIDES` |
| RNA splicing | RNA splicing | per `EVIDENCE_GUIDES` |
| Residue shifts & pockets | Residue shifts and pockets | per `EVIDENCE_GUIDES` |
| Structural perturbation | Structural perturbation | per `EVIDENCE_GUIDES` |
| Interfaces & PPI | Interfaces & PPI | per `EVIDENCE_GUIDES` |

The Evidence card renders `About <guide title>` on every tab, so a tab that mounts another tab's
body fails the guide check. The "Active variant" group in the header exists only on Evidence.

Pinned: each tab mounts and titles itself; 3D structure, Energetics, Landscape, Insights and
Literature open on their heading; Report is not the "No report yet" empty state.
Not pinned: any upstream value (gnomAD counts, ClinVar status, predictor scores), because the run
is live. The next tests to write drive one tab's controls and pin a value from a fixture.
