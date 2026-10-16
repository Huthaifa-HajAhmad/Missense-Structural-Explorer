# Sidebar navigation

## Sub-features
- Search, Evidence, 3D structure, Energetics, Landscape, Insights, Literature, Report.
- Console and About in the footer. Evidence expands into 11 sub-tabs after an analysis.

## How to get to it (user POV)
The left rail, `navigation "Primary navigation"`. Evidence sub-tabs and the status badges
(Complete / In progress / On demand) appear only after an analysis.

## Driving it with e2e
`tests/navigation.e2e.ts` taps each rail button by `^`-anchored name (the accessible name
includes the sublabel and status) and pins the landing heading.

## Proof
Each view's heading: `3D structure`, `Energetics`, `Residue landscape`, `Insights`,
`Literature`, `No report yet`, `About Missense & Fold`.

## Charters
```
nav-views|web||visit every rail view before any analysis and again after one; no view should show a raw error or an empty frame with no explanation
nav-resize|web||collapse, expand, and resize the sidebar at narrow and wide viewports; every item stays reachable by keyboard
```

## Gotchas
Evidence has no heading before an analysis, so it is not in the navigation test. Views
load lazily; the first open of a view can take a few seconds.
