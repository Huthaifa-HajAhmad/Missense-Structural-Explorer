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

## PM2 strength: decision record

Question: the engine weights `PM2` as Moderate. ClinGen SVI's 2020 recommendation, as I recall it, is to apply PM2 at Supporting.
I could not open clinicalgenome.org or PubMed from the build environment, so the recommendation was unverified at the time.
**Verified 2026-09-30** (ClinGen SVI Recommendation for PM2, Version 1.0, approved September 2020): PM2 is reduced from Moderate to Supporting. The engine change is still deliberately not made; see `INDEPENDENT_AUDIT_RESPONSE.md`, decision D1.

What I could check is what a change would do. I ran the engine's own `classifyVariant` on every combination of the other eleven
codes it can emit (2,048), once with PM2 at Moderate and once with a Supporting-weight code in its place. **110 of the 2,048
combinations change tier, all toward less pathogenic** (for example PVS1+PM2: Likely pathogenic to Uncertain; PM1+PM4+PM2: Likely
pathogenic to Uncertain; PVS1+PM1+PM2: Pathogenic to Likely pathogenic). A variant that only has PM2 and PP3 (the NAE1 case) does not change.

**Decision reversed 2026-09-30: PM2 is now applied at Supporting** (see the "Resolution" block below).

Original decision (kept for the record): **no change to the engine in this work.** The Report prints the engine's strength as it is, so the document is honest about
what was counted. To close it, someone opens the SVI PM2 recommendation (ClinGen, 2020), and if it says Supporting the engine change
is small: emit `PM2` at Supporting weight in `criteria.ts`/`classifier.ts` and update the affected tests; it needs its own PR because it
re-tiers about 5% of the code combinations.

### Resolution (2026-09-30)

The SVI recommendation was verified (Version 1.0, approved September 2020: PM2 is reduced from Moderate to Supporting) and adopted, together with
the combination that recommendation adds: 1 Very strong + 1 Supporting = Likely pathogenic. Without that rule, lowering PM2 would demote every null
variant whose only other evidence is rarity.

- `codeWeight("PM2")` is Supporting; the code stays `PM2` on the wire. Every surface reads the strength from `codeWeight`, so the Insights lane, the Report
  table and the criteria list print "Supporting". The PM2 reason text says so.
- Re-tiering, measured with the engine's own `classifyVariant` over every subset of the 13 criteria codes it can emit (8,192 sets; the 110-of-2,048 figure
  above was taken under the earlier PVS1 combining rule and is superseded): **220 change tier.** 188 involve PM2 and move toward less pathogenic
  (e.g. PS1 + PM2: Likely pathogenic to Uncertain; PM1 + PM2 + PM4: Likely pathogenic to Uncertain). 32 move toward more pathogenic through the new PVS1 + Supporting
  rule (e.g. PVS1 + PP3: Uncertain to Likely pathogenic). NAE1 (PM2 + PP3) is unchanged.
- The three golden canary variants (PS1 + PM1 + PM2 + PP2 + PP3) are now Likely pathogenic, not Pathogenic: the same evidence is 1 Strong + 1 Moderate + 3 Supporting.
- Stored client bundles are discarded (`CACHE_VERSION` v4.3) so no surface replays a verdict from the old weights.
- No Richards-Moderate toggle was added. It would make the same evidence carry two tiers depending on a setting that is not recorded in the report.

## Sources

- Richards S, et al. 2015. ACMG/AMP variant interpretation standards. Genet Med 17:405-424. doi:10.1038/gim.2015.30
- Pejaver V, et al. 2022. Calibration of computational tools for missense variant pathogenicity classification and ClinGen
  recommendations for PP3/BP4 criteria. Am J Hum Genet 109:2163-2177. doi:10.1016/j.ajhg.2022.10.013
