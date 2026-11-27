# Group D: "Does it affect RNA?" (RNA splicing and AlphaGenome)

Date: 2026-11-27. Read-only review. No source file, capture or commit was changed. No tests were run, because no code changed. Producer lines were found by reading `src/` strings. The app was not run.

## Scope and evidence

- Variants with a finished run (`meta.json` status `ok`): TP53_R175H, UROD_G318R, SOD1_A5V.
- ABCG1_G358R has status `timeout` (stopped at 360 s). It is kept because it tests a variant whose exact DNA change could not be pinned.
- Not reviewed: HBB_E7V (only a start line in `run.log`) and GBA1_N409S (not captured).
- Screens: `tabs/splicing__splice-map`, `__channel-details`, `__score-scales`, and `tabs/alphagenome__understand-the-score`, `__rank-composition`, with their rails.
- Screenshots read: `doc/release-audit/raw/TP53_R175H/tabs/splicing__splice-map.png`, `doc/release-audit/raw/ABCG1_G358R/tabs/splicing__splice-map.png`, `doc/release-audit/raw/TP53_R175H/tabs/alphagenome__understand-the-score.png`.
- Raw engine data: `api/` stream files (`019`, `018`, `016`, `020`). The fields checked were `ruleBasedInsights`, `serviceStatus` and `conservationData.alphagenome`.

Terms used below:
- SpliceAI: a model that predicts whether a DNA change alters how pre-mRNA is cut and joined (splicing).
- max Δ: the largest predicted change in splice-site likelihood, from 0 to 1.
- BP4 and PP3: ACMG evidence codes. BP4 points to benign; PP3 points to damaging. The splicing bands (ClinGen, Walker 2023) are: a max Δ of 0.10 or less supports BP4, 0.20 or more gives PP3, and anything between counts as neither.
- AVI: AlphaGenome's variant impact score.
- Unpinned allele: the app could not turn the protein change into one exact DNA change, so DNA-level models cannot run.

## 1. Coherence across the group

| Fact | TP53_R175H | UROD_G318R | SOD1_A5V | ABCG1_G358R |
|---|---|---|---|---|
| SpliceAI max Δ on the splicing tab | 0.01 (donor gain, −11 bp) | 0.036 at −216 bp (Insights shows 0.04) | 0.14 (donor gain, −2 bp) | none ("No result") |
| Splicing band on the splicing tab | "supports BP4" (green pill) | not read | "supports neither PP3 nor BP4" | "Rule not applied" |
| Insights splicing card | "No predicted effect on splicing (max Δ 0.01)." Not counted | "(max Δ 0.04)." Not counted | "sits between the cut-points (max Δ 0.14)." Not counted | "No splicing score was returned. The engine withholds missense BP4 until SpliceAI has answered." |
| Report splicing block | Not counted; "clearing the missense BP4 gate" | Not counted | Not counted | Same sentence as Insights |
| Population tab allele status | Ok | Ok | Ok | "no unique nucleotide allele" |
| AlphaGenome tab | "No AVI score for this variant" (Key Required / Standby) | same | same | "The Atlas returned nothing (No result)." |
| API `conservationData.alphagenome.status` | unavailable | unavailable | unavailable | (no alphagenome block) |

What agrees:
- For the three finished runs, the splicing numbers match between the tab, Insights and the Report.
- On ABCG1, the Population tab and the splicing screen both say no unique allele was found, and both give the same reason.

What does not agree:
- The ABCG1 splicing rail gives a different reason from the screen (D1).
- ABCG1 Insights says "until SpliceAI has answered", which describes a pending check (D2).
- The AlphaGenome tab is correct that no score exists, but the Insights and Report summaries say AlphaGenome "returned" a score (see F1 in `group-f.md`).

## 2. Findings

### D1. Blocker. ABCG1: one missing splicing score, two different reasons on one screen

- Screens: ABCG1 `tabs/splicing__splice-map` (screen and Evidence Lineage rail, RULE TRACE step 1), `tabs/splicing__channel-details`, and the Insights splicing card.
- Evidence, exact text:
  - Screen: "Splice-junction geometry was not queried: the lookup did not establish a unique nucleotide allele from complete evidence."
  - Rail step 1: "Neither the live Broad lookup nor the precomputed tables returned a score for this coordinate."
  - Channel rows: "No result", "Not reported", "No score returned".
  - Source row on the same screen: "Junction geometry NM_016818.3 (ENST00000398449.8)". This shows a geometry as a source, although the screen says geometry was not queried.
- Producers:
  - `src/shared/splicingEvidence.ts:860` (the "for this coordinate" branch, used in the rail).
  - `src/shared/locusResolution.ts:215` and `:230-236` (the "was not queried" refusal text used on the screen).
- Why it matters: "the lookup ran and returned nothing" can be read as "SpliceAI checked and saw no effect". In fact, no check was possible because no exact DNA change exists. Population and the screen give the true reason; the rail does not.
- Fix:
  1. When no exact DNA change exists, the rail and the channel rows use the same refusal reason as the screen and Population.
  2. The "for this coordinate" branch (`splicingEvidence.ts:860`) runs only when a coordinate exists.
  3. Hide the "Junction geometry" source row when geometry was not queried.
  4. Add one fixture test for ABCG1 that checks the rail, screen, Population and Insights share one reason string.

### D2. Important. "Until SpliceAI has answered" describes a finished, unchecked state as pending

- Screens: ABCG1 Insights (splicing card) and ABCG1 Report (RNA splicing block).
- Evidence: "The engine withholds missense BP4 until SpliceAI has answered; no separate splicing-only code is added while pending or unscored." The splicing screen says "Rule not applied" and "No PP3 / BP4".
- Problem: the run has ended (status `timeout`), and no splicing check was made. The sentence tells the reader an answer may still come.
- Producer: `src/shared/insightsEvidence.ts:491`.
- Fix: for the not-checked state, say "No splicing check was made, because no exact DNA change was established. BP4 is withheld for that reason." Keep the word "pending" only for a live request, which is already handled on the AlphaGenome tab (`AlphaGenomeTab.tsx:458`).
- SCIENCE — lead to decide: should missense BP4 be withheld when splicing was never checked? The current app withholds it. The wording fix above works either way.

### D3. Important. TP53 splicing card says splicing "supports BP4", but the engine records no splicing BP4

- Screen: TP53 `tabs/splicing__splice-map`. The card shows a green pill "BP4 · splicing" (seen in the screenshot). Text: "SpliceAI's score is below the splicing BP4 threshold — a max Δ of 0.01 (donor gain at −11 bp) is at or below 0.10, which supports BP4 for splicing impact."
- Same screen: rail step 4 says "splicing BP4 alone is not recorded for missense variants." The Engine record card says "PP3 Moderate". Insights says the splicing lane is "Not counted" and "leans benign". The Report says "clearing the missense BP4 gate".
- Problem: the card says "supports BP4", the rail says BP4 is not recorded, and the summaries say not counted. A clinician reads three different answers.
- Producers: `src/shared/splicingEvidence.ts:1086-1087` (the "supports BP4 for splicing impact" sentence) and `src/components/evidence/SplicingTab.tsx:70` (the "not recorded" sentence).
- Fix: the card says "Splicing adds no PP3 (below 0.20). Splicing BP4 is not counted for missense variants." The pill says "Not counted", the same word Insights uses.
- SCIENCE — lead to decide: should a splicing-only BP4 ever be recorded for a missense variant? The app's current rule says no. The wording fix assumes that rule stays.

### D4. Important. The splicing tab's "Engine record: PP3 Moderate" line reads as if splicing produced it

- Screen: TP53 and SOD1 `tabs/splicing__splice-map`, Engine record card. It reads "PP3 Moderate" with the sub-line "Primary missense predictor · SpliceAI ≥ 0.20 blocks BP4".
- Problem: the PP3 comes from REVEL, a missense predictor. On the splicing tab it looks like a splicing result. For TP53 the splicing lane adds nothing.
- Producer: `src/components/evidence/SplicingTab.tsx:506`.
- Fix: label the line "Missense PP3 (from REVEL): PP3 Moderate. Splicing adds none." Link it to the In-silico predictors tab.

### D5. Important. ABCG1 AlphaGenome says "No cause was recorded for this absence", but the cause is known

- Screen: ABCG1 `tabs/alphagenome__understand-the-score`. Text: "The Atlas returned nothing (No result). No cause was recorded for this absence."
- Problem: the same run's Population tab and splicing screen say the exact DNA change was never established. "The Atlas returned nothing" also implies a request was sent. For this variant, no request was sent.
- Producer: `src/components/evidence/AlphaGenomeTab.tsx:465-472`. The fallback "No cause was recorded" is used when no reason is passed in. ABCG1 passes none.
- Fix: pass the locus-resolution reason (the same one Population uses, from `src/shared/locusResolution.ts`) into the AlphaGenome availability state. Show the "Provide nucleotide allele" action there too. The top bar already shows it.

### D6. Important. "Key Required / Standby" is internal jargon and does not say what to do

- Screens: TP53, UROD and SOD1 `tabs/alphagenome__understand-the-score` (the message appears on the screen and again in rail step 1), and their `tabs/splicing__score-scales` ("AlphaGenome Atlas: Key Required / Standby").
- Evidence: "AlphaGenome Atlas: Key Required / Standby Add or check the AlphaGenome credential in Settings, then re-evaluate."
- Problem: "Key" and "Standby" are service-state words. A clinician cannot tell whether this is a bug, a setup step, or an outage. The action text is good, but the label hides it.
- Producer: the message comes from the server (`api` field `conservationData.alphagenome.message`) and is passed through the client mapping in `src/shared/evidenceAvailability.ts:121`.
- Fix: "AlphaGenome is not set up. Add the access key in Settings, then re-evaluate." Show this once per screen.
- Question for the lead: is AlphaGenome supposed to be configured on the audit server? If not, every AlphaGenome "not available" line is an environment gap, not a product gap. This should be settled before the release gate uses these captures.

### D7. Important. Two distances, two reference points, no labels

- Screen: TP53 `tabs/splicing__splice-map` and `__channel-details`.
- Evidence: the Position card says "−36 from the donor" and "The 36th base of exon 5 from its donor boundary." The channel rows say "−11 bp · transcript". The table header in the map says "Bases from the variant, transcript direction". The channel caption says "Channel offsets are measured from the variant."
- Problem: the same screen measures distance from the donor edge in one place and from the variant in another. Both use a minus sign. A reader cannot tell which number is the distance to the splice site.
- Producers: `src/components/evidence/SplicingTab.tsx:484-488` (Position card) and `src/components/evidence/splicing/SpliceMap.tsx:146` (table header). The channel caption is at `src/components/evidence/splicing/SplicingRecords.tsx:9`.
- Fix: use one reference point on the page. Name it in the Position card, for example "36 bases from the donor edge of exon 5 (variant is at −36)".

### D8. Polish. A 18-row "Not attributed" table and "NOT PLOTTED 18" appear when there is no AlphaGenome score

- Screens: TP53, UROD and SOD1 `tabs/alphagenome__understand-the-score`, "What contributes to this score?" card.
- Evidence: "No AlphaGenome assessment was made for this variant, so there is nothing to plot." Under it, 18 rows say "Not attributed", and the Input type filter ("All inputs", "Predicted molecular effects", and so on) controls an empty chart.
- Producer: `src/components/evidence/AlphaGenomeTab.tsx:175` (the "Not attributed" rows).
- Fix: when there is no score, show one line and hide the rows and the filter.

### D9. Polish. Two window controls with different defaults on the splice map

- Screen: TP53 `tabs/splicing__splice-map`. The reporting window is "±500" (selected). The map view says "Auto (±50 bp)". The checkbox reads "Show non-zero signals below 0.01", and the note reads "Display filter: Δ ≥ 0.01 · scores remain in the readings".
- Problem: two window controls, two defaults, and the word "readings" is not explained.
- Producer: `src/components/evidence/SplicingTab.tsx:557-558`.
- Fix: keep one window control. Replace the filter note with "Scores below 0.01 are hidden. They are still listed in the readings below."

### D10. Polish. Rounding differs across screens

- TP53 channel details shows donor gain "0.011"; the splice map and Insights show "0.01".
- UROD channel details shows acceptor gain "0.036"; the Insights text says "max Δ 0.04".
- Fix: one rule. Use two decimals in summaries, three in the channel table, and say "rounded" once.

### D11. Important (repetition). The same ClinGen rule sentence repeats on every splicing sub-tab

- Count, TP53: the phrase "SpliceAI ≥ 0.20 blocks BP4" appears twice in each of the three splicing sub-tab captures (`splice-map`, `channel-details`, `score-scales`), once on the screen and once in the rail. The Walker rule sentence ("reads ≥ 0.20 as PP3 ... and ≤ 0.10 as clearing the missense BP4 gate") appears once in Insights and once in the Report.
- Problem: the same rule is stated six or more times for one variant. Each copy is worded a little differently, which invites a reader to wonder if they differ.
- Fix: state the rule once on the splicing tab (the "How to read this tab" block), and let the other screens link to it.

## 3. Nielsen heuristics on the RNA flow (open splicing tab, read band, read channels, read source)

Flow evidence: TP53 `splice-map` screenshot, ABCG1 `splice-map` screenshot, TP53 AlphaGenome screenshot.

| # | Heuristic | Result | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | Pass for ABCG1 ("Rule not applied" pill). Weak on ABCG1 rail and the "until SpliceAI has answered" line. | D1, D2 |
| 2 | Match with the real world | Fail. "Broad Lookup · live", "precomputed tables", "masked scores", "Display floor", "Key Required / Standby", "Atlas", "Phred", "SHAP". | D6, D9 |
| 3 | User control and freedom | Pass. Window buttons work. | none |
| 4 | Consistency | Fail. Green "supports BP4" pill versus "splicing BP4 alone is not recorded" on the same screen; two window controls; two reference points. | D3, D7, D9 |
| 5 | Error prevention | Not applicable here. | none |
| 6 | Recognition over recall | Pass. Band bars and the rule trace are visible on screen. | none |
| 7 | Flexibility and efficiency | Pass. Reporting windows from ±50 to ±2000. | none |
| 8 | Aesthetic and minimalist design | Fail on AlphaGenome when there is no score: 18 "Not attributed" rows. | D8 |
| 9 | Help users recover from errors | Mixed. AlphaGenome offers "Open connection settings" and "Re-evaluate", which is good. ABCG1 splicing shows no action on its own screen; the fix ("Provide nucleotide allele") is only in the top bar. | D5, D1 |
| 10 | Help and documentation | Pass. "How to read this tab" and full source citations are present. | none |

## 4. Staleness, placeholders and "running" states

- No retired engine names found on the group D screens. Searched captures for ConSurf, GPN, SaProt, ESM-2, VESM, ESMC, ESM3, DynaMut and DDMut: zero hits.
- "Running" wording: D2 (ABCG1, "until SpliceAI has answered"). The AlphaGenome pending text (`AlphaGenomeTab.tsx:458`) is correct, because it is used only when a request is live. No run in the captures is stuck on a splicing or AlphaGenome spinner.
- Placeholders: the AlphaGenome "Key Required / Standby" line is the only placeholder on these screens (D6).
- Contradictions: D1, D3, D5.

## 5. axe (accessibility scan), group D screens

- Splicing (`splice-map`, `channel-details`, `score-scales`) and AlphaGenome (`understand-the-score`, `rank-composition`): zero violations on all four variants (5 screens × 4 variants).
- Shared versus specific: nothing to report for group D.

## 6. Ranked top 5

1. **D1 (blocker).** ABCG1 gives two reasons for the same missing score. Fix the rail, the channel rows and the source row so they match Population and the screen.
2. **D3 (important, SCIENCE part).** TP53 "supports BP4" pill conflicts with "not recorded" and "Not counted". Decide whether splicing BP4 can ever count for missense; fix the wording either way.
3. **D2 (important).** "Until SpliceAI has answered" tells the reader a finished, unchecked state may still change.
4. **D5 (important).** ABCG1 AlphaGenome says "No cause was recorded" when the cause is known and the other tabs state it.
5. **D6 (important).** "Key Required / Standby" is jargon with no action. Also decide whether AlphaGenome should be configured on the audit server before these captures are used at the gate.
