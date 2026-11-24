# Report tab geometry check

`npm run test:geometry:report` builds this directory with Vite, renders the real `ClinicalReportBar`
(the report screen) and `ReportInspector` (the builder rail) in headless Chromium inside the app's own
workspace classes, and reads back assertions the page computed from live layout. jsdom has no layout
engine, so none of this can be asserted in vitest.

## Cases

| Case | Frame | Why |
| --- | --- | --- |
| `wide` | 1440 × 760 workspace, 380px rail, light theme | The screen and the rail together: edges, the pinned export bar after the rail is scrolled, contents rows |
| `dark` | same, dark theme | The same 21 assertions against the dark tokens, including contrast |
| `narrow` | the screen alone at 560px | The container-query layout: identity facts in one column, tier labels fitting |

The fixture is NAE1 p.Asp116Gly (one engine-counted PP3, a model-only PS3, an uncertain tier). It stands in
for shape, not for biology.

## Assertions

- **heading**: one `h1` with the title, no label above it, no chip that never changes.
- **cards**: the export switch is last in the header; every title starts on the same left edge as its body text.
- **classification**: the tier scale starts on the verdict's edge and ends inside the card padding.
- **page and rail**: nothing scrolls sideways; buttons are at least 32px tall; tabs at least 44px.
- **export bar**: after the rail is scrolled 400px, nothing shows above the bar and the bar is pinned to the top.
- **contents**: criterion codes stay on one line and use the code face (and nothing else does); a section with
  nothing to export has no tick; jump buttons are at least 28px.
- **contrast**: note-strip and contents notes are at least 4.5:1 in both themes.

The theme is chosen through `SettingsProvider` (the saved `theme` value), because the provider owns the `dark`
class on `<html>` and removes any class set directly. Each case also asserts which theme it measured.

## Running it

`REPORT_SHOT=1` also writes `report-geometry.png` next to `dist/`. Set `GEOMETRY_BROWSER` to a Chromium
browser if none is found. On a machine where Edge dumps no DOM, point it at Playwright's headless shell.
Exit codes: 0 all passed, 1 an assertion failed or the run was incomplete, 2 the build or browser failed.
