# Variant search

## Sub-features
- Gene symbol and protein/cDNA notation fields, genomic coordinates, UniProt accession override.
- Notation and coordinate example chips.
- Benchmark controls (PAH, FGFR3, GBA1, CNNM2) on first run; recent analyses afterward.
- Services / Pipeline switcher beside the form.

## How to get to it (user POV)
Open `/`; Search is the landing view. No account.

## Driving it with e2e
`tests/search.e2e.ts`. Locators: `textbox "Gene symbol"`, `textbox /^Protein or cDNA
notation/`, `button "Clear query fields"`, `button "Analyse variant"`, `button "Load
benchmark PAH p.Arg408Trp"`, `tab "Pipeline"`. Call `skipTour(browser)` first.

## Proof
Typing enables Clear and Clear empties the field; an example chip fills the notation
field; a benchmark fills both fields without starting a run.

## Charters
```
search-empty|web||submit the query with every field empty and with whitespace only; the app should say what is missing, not run
search-notation|web||enter malformed protein notation (p.Arg, 408Trp, p.Arg408Xyz) and a gene/notation mismatch; the error should name the field
search-coords|web||enter genomic coordinates in each documented format plus one off-by-one; the build choice should be honoured
```

## Gotchas
Loading a benchmark only fills the form; `Analyse variant` starts the run. Service tiles
may read offline or fallback; that is upstream health.
