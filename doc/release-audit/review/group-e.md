# Group E: "What do models say?" (In-silico predictors: Comparison, Native score scales, Strength bands, and the Predictors rail)

Date: 2026-11-27. Read-only review. No source file, capture or commit was changed. No tests were run, because no code changed. Producer lines were found by reading `src/` strings. The app was not run.

## Scope and evidence

- Variants: TP53_R175H, UROD_G318R, SOD1_A5V (run status `ok`) and ABCG1_G358R (status `timeout`, kept because its predictor logic is the clearest case of withholding).
- Screens: `tabs/predictors__comparison`, `__native-score-scales`, `__strength-bands`, and the Evidence Lineage rail of each.
- Screenshots read: `doc/release-audit/raw/TP53_R175H/tabs/predictors__comparison.png` and `doc/release-audit/raw/TP53_R175H/tabs/predictors__strength-bands.png`.
- Engine record: `api/019` (TP53), `api/018` (UROD), `api/016` (SOD1), `api/020` (ABCG1), field `ruleBasedInsights`.

Terms used below:
- REVEL, BayesDel, AlphaMissense, ESM1b, CADD, phyloP, GERP++, popEVE: computational models that score how damaging a missense change is.
- PP3 and BP4: ACMG evidence codes. PP3 points to damaging; BP4 points to benign. The strength (Supporting, Moderate, Strong) comes from published bands.
- "Fixed order": the app checks REVEL first, then BayesDel, AlphaMissense and ESM1b. The first tool with a score sets PP3 or BP4. The others are shown but not used.
- VCEP: a ClinGen gene expert panel. Its gene-specific rules can change which score applies.
- O/E: observed over expected variation for a region of the gene (a constraint measure).

## 1. Coherence across the group

| Fact | TP53_R175H | UROD_G318R | SOD1_A5V | ABCG1_G358R |
|---|---|---|---|---|
| Engine record (api) | PP3_Moderate (REVEL 0.922) | BP4 (REVEL 0.229) | PP3_Moderate (REVEL 0.853) | none; BP4 withheld |
| REVEL band shown | PP3 Moderate | BP4 Supporting | PP3 Moderate | BP4 Moderate (0.092), but "No PP3 / BP4" |
| BayesDel noAF | 0.546, "PP3 Strong" | −0.308, "BP4" | 0.420, "PP3 Moderate" | −0.199, "BP4" |
| AlphaMissense | 0.986, "PP3 Moderate" | 0.102, "BP4" | 0.840 (band not read) | 0.153, "BP4" |
| ESM1b | −10.96, "PP3" | −2.15, "BP4 Moderate" | unavailable (api `partialEvidence`) | −3.79, "BP4" |
| CADD | 25.9, "PP3 (not counted)" | 9.7, "BP4 Moderate (not counted)" | 32.0 (api: "not counted") | no result |
| popEVE | −3.658, "Above cut-point" | −2.798 | not read | −3.032 |
| Regional O/E (rail) | 0.89, "not met" | 0.81, "not met" | 0.70 | unverified locus; PP2 not tested |
| Report table role for BayesDel, AlphaMissense, ESM1b | "Calibrated, fixed order" | "Calibrated, fixed order" | "Calibrated, fixed order" | "Calibrated, fixed order" |

What agrees:
- The REVEL score, its band, and the engine record agree across the Comparison, Native and Strength bands screens and the Report, for all three finished runs.
- The O/E values agree between the rail and the header (0.89, 0.81, 0.70).

What does not agree:
- The four predictor sub-tabs and the Report give different status labels for the same tools (E2).
- popEVE is described as having no published cut-point and as having cut-points on the same screen (E6).
- The ABCG1 screen says the first tool with a score sets BP4 and also says BP4 is withheld (E3).

## 2. Findings

### E1. Important. The Comparison dot grid cuts off the PP3 Strong column, so BayesDel shows an empty row (TP53)

- Screen: TP53 `tabs/predictors__comparison`, screenshot `doc/release-audit/raw/TP53_R175H/tabs/predictors__comparison.png`. The columns run from BP4 Very strong to PP3 Moderate. The BayesDel noAF row has no mark.
- Evidence: the text dump lists "PP3 Strong" as a column header, and the Report table says "BayesDel noAF 0.546 PP3 Strong". On `tabs/predictors__strength-bands.png`, the BayesDel dot is in the "Strong +4" column.
- Problem: the chart on the summary screen shows BayesDel as having no call, while the other two screens say PP3 Strong.
- Producer: `src/components/evidence/EvidenceComparison.tsx` (the predictor dot grid, rendered from `src/components/evidence/PredictorsTab.tsx:341`). The column list was not pinned to a line.
- Fix: make every band column visible, or scroll inside the card. Add a test with BayesDel at 0.546 that expects a mark in the PP3 Strong column.

### E2. Important. Each predictor carries a different status label on each sub-tab, and the Report repeats the wrong one

- Comparison sub-tab: an asterisk footnote "* Does not set PP3/BP4 for this variant." is on BayesDel, AlphaMissense, ESM1b, CADD, phyloP and GERP++. REVEL has no asterisk.
- Native score scales: BayesDel, AlphaMissense and ESM1b are tagged only by source ("Pejaver et al. 2022", "Bergquist et al. 2025"). CADD, phyloP and GERP++ are tagged "not counted".
- Strength bands: the same three tools have no tag. REVEL alone is tagged "sets PP3/BP4".
- Report table: every chain member, including BayesDel, AlphaMissense and ESM1b, is labelled "Calibrated, fixed order". The chain stops at REVEL when REVEL has a score.
- Problem: a reader cannot tell which tools are used. "Calibrated, fixed order" sounds like "used", and the Comparison screen says "does not set".
- Producers:
  - `src/components/evidence/EvidenceComparison.tsx:101` (asterisk text).
  - `src/components/evidence/PredictorsTab.tsx:68` ("Context only / never sets PP3 / BP4").
  - `src/shared/predictorEvidence.ts:111` (the "shown but never sets PP3/BP4" comment for chain members).
  - `src/shared/reportEvidenceBlocks.ts:75` (gives every chain member the "Calibrated, fixed order" role).
- Fix: one status per tool, shared by all three sub-tabs and the Report:
  - REVEL: "Sets PP3/BP4".
  - Unused chain member: "Not used: REVEL answered first".
  - CADD, phyloP, GERP++, popEVE: "Context only, not counted".
  Rename the Report column from "Role" to "Status".

### E3. Important. ABCG1: the screen says the first tool with a score sets BP4, and also says BP4 is withheld

- Screen: ABCG1 `tabs/predictors__comparison`. Two sentences on one screen:
  - "Fixed order. The first calibrated tool with a score sets PP3/BP4. REVEL answered."
  - "No PP3 / BP4. No BP4: REVEL 0.092 reads BP4 Moderate, but no verified GRCh38 nucleotide locus was established, so splicing was not checked and BP4 is withheld."
- Problem: the reader cannot tell which rule stopped BP4. The first sentence says REVEL should set it. The second says it was withheld because splicing was not checked.
- Producers:
  - `src/components/evidence/predictors/PredictorFindingRows.tsx:90` ("The first calibrated tool with a score sets PP3/BP4").
  - `src/shared/predictorSummary.ts:110-116` (the sentence variants).
  - `src/components/inspector/PredictorsRail.tsx:174` (the "blocked-spliceai" and "withheld" outcomes that choose the wording).
- Fix: when the outcome is withheld, the headline gives the blocking reason, for example "BP4 withheld: splicing was not checked (no exact DNA change)." Drop the generic "first calibrated tool sets PP3/BP4" sentence in that case.
- SCIENCE — lead to decide: should BP4 be withheld when splicing was never checked, or should REVEL's BP4 stand alone? The current app withholds it. The wording fix works either way.

### E4. Important. The same caveat is repeated several times on each predictor screen

- Counts for TP53 (screen plus rail, measured in the captures):
  - The VCEP note (the GN009 gene-panel rule, quoted in full as "TP53 CSpec GN009 v2.4 requires Align-GVGD class alongside BayesDel noAF ≥ 0.16 / ≤ -0.008 (not computed here); default chain applies.") is mentioned 5 times in the Comparison capture, and 3 times each in the Native score scales and Strength bands captures (counted by the word "GN009", which also covers the shorter restatements).
  - The "never change PP3 / BP4" idea appears in the Comparison card header, the footnote, and the rail tag "Context only / never sets PP3 / BP4". The "Descriptive agreement only" sentence appears twice on the Comparison screen.
  - "These individual readings are not additional engine criteria" and "These readings are not criteria to add together" say the same thing as the "never change" line in the same header.
  - "SpliceAI ≥ 0.20 blocks BP4" appears in rail step 3 of the predictor rail, which is a splicing rule on the predictors tab.
- Producers: `src/components/evidence/PredictorsTab.tsx:341` (the Comparison card description), `:345` and `:347` (the agreement card, rendered once in Comparison and once in the records view), `src/shared/predictorEvidence.ts:702` ("Descriptive agreement only ..."), and `src/components/inspector/PredictorsRail.tsx:299`.
- Problem: the reader meets the same message four or five times before reaching the number. Repetition makes a reader wonder whether the statements differ.
- Fix: state each rule once per screen: the PP3/BP4 call in the card header, and "not counted" in a footnote. The rail shows only the trace. Move the splicing rule to the splicing tab.

### E5. Important. SCIENCE — lead to decide. Two BayesDel thresholds for the same tool on one screen (TP53)

- Comparison header (TP53): "TP53 CSpec GN009 v2.4 requires Align-GVGD class alongside BayesDel noAF ≥ 0.16 / ≤ -0.008 (not computed here); default chain applies."
- Strength bands rail (TP53): "BayesDel noAF 0.546 · PP3 Strong ≥ 0.13". The Native score scales show "PP3 ≥ 0.13 · 0.27 · 0.5".
- Problem: the VCEP cut-point is 0.16, and the displayed PP3 Strong band starts at 0.13. The screen does not say which one the reading uses, and BayesDel is not used in the final call.
- Producers: `src/shared/insilico/vcepDataSpecial.ts:104` (the VCEP note, ≥ 0.16). The 0.13 band comes from the calibrated band table, which I did not pin to a line.
- SCIENCE — lead to decide: which BayesDel cut-point applies to TP53 (the general Pejaver band or the VCEP value), and whether the band shown must match the one the VCEP note names. The UI fix is to show the threshold actually used.

### E6. Important. popEVE is described as having "no published cut-point" and as having cut-points, on the same screen (TP53)

- Native score scales (TP53), Cross-gene severity card: "1 of 1 scored · none has a published cut-point, so none makes a call." The same card says: "Its authors publish cut-points for deleterious changes only" and "At or below −4.617 the authors call the change deleterious, and at or below −5.056 highly deleterious."
- Predictor rail, "Other scores": "No published band: these scores measure different properties", and popEVE is listed under it.
- Problem: the summary line and the explanation contradict each other. A reader cannot tell whether popEVE has a cut-point.
- Producers: `src/shared/predictorEvidence.ts:681` (the summary tail "none has a published cut-point" when no reading has a calibrated call) and `:474` (popEVE's calibrated value is set to null, although the one-sided cut-points exist).
- Fix: say "one-sided cut-points: deleterious only, no benign cut-point" when a reading has deleterious cut-points but no benign ones.

### E7. Important. popEVE "Above cut-point" reads as past the damaging line, but the value is not damaging (TP53)

- Rail (TP53): "popEVE −3.658 · Above cut-point". The deleterious cut-point is −4.617. −3.658 is above that number, which means it is not deleterious.
- Problem: a clinician reads "above cut-point" as "over the line". The meaning is the opposite.
- Producer: `src/shared/predictorEvidence.ts:476` (call label "Above cut-point" for the "vus" signal).
- Fix: "Not deleterious (above −4.617)". The change is two words.

### E8. Important. CADD sits in two groups, and the group name does not match the content

- CADD appears as "not counted" under calibrated comparison (Strength bands and the Comparison "Published bands / not counted" list). It also appears under "GENOME-WIDE MODELS 1 of 2 scored" on the Native score scales.
- The Insights lane is called "Genome-wide scores" and reads "(CADD, AlphaGenome)". The predictor tab calls the group "Genome-wide models" and shows only AlphaGenome AVI as "Not available here" in that group.
- Problem: CADD is both calibrated and not counted, and it is in a "genome-wide" group that the Insights screen names with AlphaGenome. The label does not match the members.
- Producers: `src/shared/predictorEvidence.ts:436-437` (CADD assigned to group "genome"), `:60` (label "Genome-wide models"), and `src/shared/insightsEvidence.ts:588-603` (lane "Genome-wide scores"; the names "(CADD, AlphaGenome)" are fixed text).
- Fix: put CADD in one group, "Published band, not counted". Name the Insights lane by its actual members. Group finding F1 in `group-f.md` covers the summary side.

### E9. Important. PP2 and BP1 sit in the predictor rail, and the header uses a different phrase for the same O/E value

- Rail (TP53), step 4: "Regional constraint → PP2 · Regional O/E 0.89 → not met". Step 5: "BP1 · Not assessed · Needs the gene's curated disease mechanism; pLI is not that fact."
- Header, top bar: "Regional O/E 0.89 · No calibrated band".
- Problem: the predictor tab is for computational models. PP2 and BP1 are gene-level constraint criteria. The header and the rail give different words for the same value ("not met" versus "No calibrated band"). "pLI" is not explained.
- Producers: `src/components/inspector/PredictorsRail.tsx:191` (the "not met" sentence) and `src/components/header/constraintMetrics.ts:432` ("No calibrated band").
- Fix: move the PP2 and BP1 steps to the constraint card. Use "not met" in the header too. Spell out pLI once.
- SCIENCE — lead to decide: the PP2 O/E cut-points cited here come from a 2026 preprint (Chao et al.). Decide whether a preprint should set a displayed criterion. The app's wording is outside this review.

### E10. Polish. The points scale beside the bands invites adding points

- Strength bands screen: "CLINGEN POINTS (REFERENCE)" with points "Supporting 1, Moderate 2, Strong 4, Very strong 8 points (Tavtigian 2020)" and the sentence "The engine classifies with the Richards 2015 combining rules, not by summing points."
- Problem: the same screen shows a points ruler and says not to sum points. A reader may add them.
- Producer: `src/components/inspector/PredictorsRail.tsx:299` (the sentence) and the points ruler on the Strength bands screen.
- Fix: move the points ruler to the method note, or remove it from the predictor screen.

### E11. Polish. Jargon in the Insights sentence that summarises the predictors

- Insights (TP53): "REVEL 0.922, the first calibrated tool with a score, gives PP3 Moderate."
- Producer: `src/shared/insightsEvidence.ts:402`.
- Fix: "REVEL is the first tool in the fixed order that has a score. It gives PP3 Moderate." Also replace "default chain applies" (predictor screen) with "the standard order applies".

### E12. Polish. The rail changes its sentences from variant to variant

- TP53 rail "First with a score": "REVEL 0.922 · PP3 Moderate" plus the VCEP sentence.
- UROD and ABCG1 rail: "Order: REVEL → BayesDel noAF → AlphaMissense → ESM1b. Informational tools are listed but never used."
- Problem: the same slot shows two different sentence types, so a reader cannot compare variants.
- Producer: `src/components/inspector/PredictorsRail.tsx:171`.
- Fix: one template for the chain line, with the variant-specific part added after it.

### E13. Axe (accessibility scan). Moderate, specific to the predictors tab

- `landmark-unique` on the Comparison and Native screens. Two sections share the label "Local informational agreement". Producer: `src/components/evidence/PredictorsTab.tsx:345` and `:347`.
- `heading-order` on the Strength bands screen, at `#prd-rail-trace`. The heading levels skip. Producer: `src/components/inspector/PredictorsRail.tsx:138`.
- Fix: give each section its own label, and keep heading levels in sequence.
- Shared versus specific: both are specific to the predictor tab.

## 3. Nielsen heuristics on the predictor flow (Comparison, then Native scales, then Strength bands, then the rail)

Flow evidence: TP53 Comparison screenshot, TP53 Strength bands screenshot. The Native scales and the ABCG1 and UROD screens are judged from text.

| # | Heuristic | Result | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | Pass. The engine record card shows the result at the top. | Comparison header |
| 2 | Match with the real world | Fail. "Pejaver", "Bergquist", "LLR", "Calibrated, fixed order", "default chain", "pLI", "Tavtigian points". | E2, E9, E10, E11 |
| 3 | User control and freedom | Pass. Pinning and hover work. | Strength bands footer |
| 4 | Consistency and standards | Fail. Four different status labels for the same tool; "not counted" means different things on different screens. | E2, E8 |
| 5 | Error prevention | Fail. The clipped column (E1) and the two BayesDel thresholds (E5) can mislead without a warning. | E1, E5 |
| 6 | Recognition over recall | Pass. The band chart and the colour strip show the thresholds beside each score. | Strength bands screenshot |
| 7 | Flexibility and efficiency | Not applicable. | none |
| 8 | Aesthetic and minimalist design | Fail. The VCEP sentence and the "never change PP3/BP4" line appear several times per screen. | E4 |
| 9 | Help users recover from errors | Not applicable. | none |
| 10 | Help and documentation | Pass. "How PP3/BP4 is decided" and the source list are present. | Strength bands footer |

## 4. Staleness, placeholders and contradictions

- Retired names: none found on the predictor screens. I searched the captures for ConSurf, GPN, SaProt, ESM-2, VESM, ESMC, ESM3, DynaMut and DDMut, and found zero hits. ESM1b is shown with a PP3 band. It is a precomputed field, not a runtime language model, so it is not a retired engine. The lead should confirm this.
- Placeholders: "AlphaGenome AVI · Not available here" appears in three places on each predictor screen. It is accurate, but repeated (see E4).
- "Running" states: none on the predictor screens.
- Contradictions: E3, E5, E6, E8.

## 5. Axe summary for group E screens

- `predictors/comparison`: `landmark-unique`, moderate, on all four variants.
- `predictors/native-score-scales`: `landmark-unique`, moderate, on all four variants.
- `predictors/strength-bands`: `heading-order`, moderate, on all four variants.
- All three are specific to the predictor tab. See E13 for producers.

## 6. Ranked top 5

1. **E2 (important).** The same tool has four different status labels across the predictor sub-tabs and the Report. Use one status per tool.
2. **E3 (important, SCIENCE part).** ABCG1 says BP4 is set by the first tool and also says it is withheld. Name the blocking reason in the headline. Lead to decide whether BP4 should be withheld when splicing was never checked.
3. **E7 (important).** popEVE "Above cut-point" reads as past the damaging line. The value (−3.658) is above −4.617, which means not damaging. Change to "Not deleterious (above −4.617)".
4. **E6 (important).** popEVE is described as having "no published cut-point" and also as having cut-points on the same screen. Fix the summary line.
5. **E5 (important, SCIENCE).** Two BayesDel thresholds (0.16 VCEP, 0.13 band) on one screen. Lead to decide which applies to TP53; the UI must show the threshold used.

Also important but not in the top 5: E1 (the PP3 Strong column is cut off on the Comparison chart).
