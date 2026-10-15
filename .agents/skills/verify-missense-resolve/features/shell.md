# App shell controls

## Sub-features
Theme toggle, sidebar collapse, settings dialog, command palette (Ctrl K), onboarding tour.

## How to get to it (user POV)
Header bar controls. The tour shows on a first visit only.

## Driving it with e2e
`tests/shell.e2e.ts` (tour skipped) and `tests/tour.e2e.ts` (tour left on, pins
`[data-testid="onboarding-tour"]`).

## Proof
The toggle label flips between "Switch to dark mode" and "Switch to light mode"; the
settings button opens a `dialog`; collapse swaps to `Expand sidebar (...)`.

## Charters
```
shell-palette|web||open the command palette, run each listed view and a variant query from it; focus should return to the page
shell-theme|web||toggle the theme on every view; no text may become unreadable and no chart may keep the old palette
```

## Gotchas
The tour scrim blocks every pointer event; any test but the tour test must skip it.
