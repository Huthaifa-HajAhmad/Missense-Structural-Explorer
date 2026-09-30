# Report tab (Synthesis): review

Reference variant: NAE1 p.Asp116Gly (Q13564). The Report is rebuilt as an editable document built from blocks. It reads
the Insights consolidator (`buildInsightsEvidence`: finding, criteria with state, lanes, gap sentence, narrative facts)
and builds no verdict logic of its own. It adds no science and no combined score.

## Findings and what changed

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Critical | The Report counted model proposals as applied criteria ("2 criteria applied") beside an engine tier that used one. | The classification block lists the engine's criteria with strength and state; model proposals appear once as "Not counted". Test: NAE1 counts PP3 only. |
| 2 | High (decision) | Criteria printed with no strength. The engine weights every `PM*` as Moderate; ClinGen SVI's 2020 position on PM2 (Supporting) is **from memory, not verified** (web access was blocked). | The table prints the engine's strength as it is. PM2 strength is **not changed** here: it changes verdicts and belongs in its own PR. |
| 3 | High | The narrative was the body of the page with no authorship marker; a degraded run printed rule-based prose unlabelled. | Written summary is its own last block, with an authorship chip (AI-written, rule-based, not generated), the model name from the payload, and "not verified against the evidence above" plus what the model was and was not shown. |
| 4 | High | Claims the app cannot back: "Validated Biomolecular Protocol", "Compliance: ACMG / AMP / ClinGen", "Protocol v2.5". | Removed. Title "Variant evidence report", chip "Research use", a test forbids those words. |
| 5 | High | "MANE Select" printed as a literal when no transcript resolved. | The row is omitted. One builder feeds every export, so the two Copy buttons agree. |
| 6 | High | The document date was the render time. | The date is stamped at export and never on screen. |
| 7 | High | The masthead had no genomic coordinate or build and no weighting or data-source versions. | Identity block carries the coordinate and build from the payload; the method block carries weighting and the pinned data-source versions. |
| 8 | High | Exclusions did not hold in the JSON and 2 of 5 toggles never reached the copied text. | Every format renders the same included blocks. A left-out block is hidden everywhere and named in the footer; if its criterion is still counted, the block and the footer say so. |
| 9 | Medium | "SHA-256" was a hash of the input payload, recomputed on every change. | A short checksum of the exported text, printed as "Document ID", with what it does and does not prove. Not a cryptographic digest. |
| 10 | Medium | "6 of 7 sources" mixed states and left nine tabs out of the universe. | Removed. Each block states its own availability. |
| 11 | Medium | The bibliography was the top 8 of a gene-level search. | Only papers pinned from the Literature tab ("Add to report") are cited. |
| 12 | Medium | Structure section had no quality facts. | Method, chain and resolution are printed when the payload has them, and the block says when it does not. |
| 13 | Medium | Nine evidence tabs were missing from the report. | One block per Insights lane plus predictors table, stability table, structure, still-needed and literature. |
| 14 | Medium | The rail's "reconciled with rule-based ACMG criteria" wording. | Already reworded by the Insights change; the rail states that the prose is not checked. |
| 15 | Low | The headline fell back to ClinVar's classification. | Only the engine's tier is shown as the classification. |

## What the tab is now

1. One document model, `src/shared/reportDocument.ts` (pure), rendered five ways by `reportRender.ts`: screen, self-contained
   html, print (hidden frame, "Save as PDF"), plain text, JSON. `useReportDocument` and the store's copy handler call the same
   `reportInputFromRun`.
2. Sixteen blocks; **every block can be included, left out and edited**, including identity, classification and the limitations.
   Only prose is editable; tables, the tier and the criteria are not, so editing cannot change the classification.
3. An edited block is marked, reversible, and flagged if the evidence changes underneath it (the draft it was based on differs).
4. Drafts (ticks, edits, document fields, pinned papers) are kept in this browser per variant. They are a convenience, not a record.
5. The rail is the builder: presets (One page, Full) that only tick boxes, the block list, export, document fields (no patient
   identifiers), the written-summary control, trace, sources.
6. Exports shipped: html, PDF via the print dialog, copy as text, document JSON, evidence bundle JSON (payload and provenance
   manifest). No new dependency.

## Decisions taken (defaults, all reversible)

- The written summary stays, included, last, and labelled.
- Named "Variant evidence report" with a "Research use" chip; the nav label stays "Report".
- All blocks are optional; the footer names anything left out.
- One Re-synthesize control stays in the rail's Written summary section until it is decided where the narrative is regenerated.

## Not done, follow-ups

- **PM2 strength**: verify the ClinGen SVI position, then a separate PR (changes verdicts).
- **Word export** (`docx`, lazy-loaded) and **PowerPoint export** (`pptxgenjs`, lazy-loaded, about six slides). Both libraries were
  generated and re-read in Node only; how Word and PowerPoint lay the files out was not seen, and browser use is unchecked.
- **One-click PDF** needs a second renderer or a headless browser on the server; the print dialog is what ships.
- **Curator's classification** beside the engine's (author-asserted PS3, PP1, PS2, re-tiered with the same combining function).
- **Save and reopen a draft file**, a **references list** built from the methods papers behind the thresholds used, and figures
  as inline SVG for the exported formats.
- The run does not record the directions the narrative was written with, or a "written before X arrived" flag; the Report prints
  nothing where the payload has nothing.
- Screenshots and layout were checked in light, dark and about 800px in Chromium; the printed and saved-HTML output was not
  viewed in other browsers.

## Sources

- Richards S, et al. 2015. ACMG/AMP variant interpretation standards. Genet Med 17:405-424. doi:10.1038/gim.2015.30
- Pejaver V, et al. 2022. Calibration of computational tools for missense variant pathogenicity classification and ClinGen
  recommendations for PP3/BP4 criteria. Am J Hum Genet 109:2163-2177. doi:10.1016/j.ajhg.2022.10.013
