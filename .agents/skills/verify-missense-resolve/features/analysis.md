# Analysis pipeline

## Sub-features
Variant resolution, evidence stages, structure/energetics stages, header "Copy link".

## How to get to it (user POV)
Search → load a benchmark or fill the form → `Analyse variant`. Stages report in
independently; the rail shows each view's status.

## Driving it with e2e
`tests/analysis.e2e.ts`, tag `live`. Loads PAH p.Arg408Trp, taps Analyse variant, waits
for `button /^Evidence .*Complete$/` (up to 120 s) and the header `Copy link to PAH
p.Arg408Trp`, then checks the Population data, In-silico predictors, and Interfaces & PPI
sub-tabs.

## Proof
The header names the variant, the Evidence rail item reads Complete, and the sub-tabs are
listed. Server side, `.e2e/logs/app.log` shows the stage requests and no crash.

## Charters
```
analysis-benchmarks|web||run each of the four benchmark controls to completion; every rail item should settle to Complete or a stated reason
analysis-cancel|web||start an analysis then change the query or leave the view mid-run; stale results must not appear under the new variant
```

## Gotchas
Depends on live upstream APIs, so a stage can end as partial. Results may be served from
the server cache and finish in seconds on a second run. If the server process dies mid-analysis
every later request is `ERR_CONNECTION_RESET` (see SKILL.md Gotchas).
