# Feature map

| Feature | Route | Test file | Status |
| --- | --- | --- | --- |
| [Variant search](search.md) | `/` (Search view) | `tests/search.e2e.ts` | tested |
| [Sidebar navigation](navigation.md) | `/` | `tests/navigation.e2e.ts` | tested |
| [App shell controls](shell.md) | `/` | `tests/shell.e2e.ts`, `tests/tour.e2e.ts` | tested |
| [Analysis pipeline](analysis.md) | `/` (Search → Evidence) | `tests/analysis.e2e.ts` | tested (live) |
| [Evidence tabs and downstream views](evidence.md) | `/` after an analysis | `tests/evidence-real-route.e2e.ts` | mounts tested (live); tab contents untested |
| 3D structure (Mol* viewer) | `/` after an analysis | opens only (evidence-real-route) | content untested |
| Energetics, Landscape, Insights, Report content | `/` after an analysis | opens only (evidence-real-route) | content untested |
| Literature search | `/` after an analysis | opens only (evidence-real-route) | search untested |

The untested rows are the next tests to write: each needs a completed analysis, then
drive the sub-tab and pin one value that comes from the data.
