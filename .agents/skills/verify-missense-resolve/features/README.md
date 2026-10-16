# Feature map

| Feature | Route | Test file | Status |
| --- | --- | --- | --- |
| [Variant search](search.md) | `/` (Search view) | `tests/search.e2e.ts` | tested |
| [Sidebar navigation](navigation.md) | `/` | `tests/navigation.e2e.ts` | tested |
| [App shell controls](shell.md) | `/` | `tests/shell.e2e.ts`, `tests/tour.e2e.ts` | tested |
| [Analysis pipeline](analysis.md) | `/` (Search → Evidence) | `tests/analysis.e2e.ts` | tested (live) |
| Evidence tab contents (11 tabs) | `/` after an analysis | none | untested |
| 3D structure (Mol* viewer) | `/` after an analysis | none | untested |
| Energetics, Landscape, Insights, Report content | `/` after an analysis | none | untested |
| Literature search | `/` after an analysis | none | untested |

The untested rows are the next tests to write: each needs a completed analysis, then
drive the sub-tab and pin one value that comes from the data.
