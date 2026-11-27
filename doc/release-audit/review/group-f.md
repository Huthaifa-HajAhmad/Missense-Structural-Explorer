# Group F: "So what?" (Insights, Report, Literature, and the Comparison views as the summary layer)

Date: 2026-11-27. Read-only review. No source file, capture or commit was changed. No tests were run, because no code changed. Producer lines were found by reading `src/` and `server/` strings. The app was not run.

## Scope and evidence

- Variants: TP53_R175H, UROD_G318R, SOD1_A5V (run status `ok`) and ABCG1_G358R (status `timeout`, stopped at 360,020 ms with `complete: false`).
- Not reviewed: HBB_E7V (no capture) and GBA1_N409S (not captured).
- Summary screens: `views/view__insights`, `views/view__report`, `views/view__literature`.
- Source screens for the comparison: `tabs/clinical__comparison` (Population), `tabs/predictors__comparison` (predictors), `tabs/splicing__splice-map` (splicing), `views/view__energetics` (stability), `tabs/interfaces__assemblies-models` (assembly), `tabs/alphagenome__understand-the-score` (AlphaGenome).
- Screenshots read: `doc/release-audit/raw/TP53_R175H/views/view__insights.png`, `…/views/view__report.png`, `…/views/view__literature.png`, `doc/release-audit/raw/ABCG1_G358R/views/view__insights.png`.
- Engine record: the `ruleBasedInsights` block of the analysis stream. The stream is NDJSON text, and the final chunk was used (`api/019`, `018`, `016`, `020`).

Terms used below:
- ACMG criteria: the standard evidence codes for classifying a variant (PP3, BP4, PM2, BS1 and so on). They combine into a tier: Benign, Likely benign, VUS (uncertain), Likely pathogenic, Pathogenic.
- ClinVar: a public database of submitted variant classifications. ClinVar is not a criterion in the app's engine.
- VUS: variant of uncertain significance.
- FoldX: a stability model (predicts the change in folding energy, ΔΔG).

## 1. Coherence: criterion → engine list → Insights → Report → source tab

### TP53_R175H (engine: PP3_Moderate, PM2)

| Item | Engine (api) | Insights | Report | Source tab | Match |
|---|---|---|---|---|---|
| PP3 | PP3_Moderate; REVEL 0.922 in the PP3 Moderate band | "PP3 Moderate"; "REVEL 0.922 … gives PP3 Moderate" | "PP3 Moderate counted"; table "REVEL 0.922 PP3 Moderate" | Predictors Comparison: "PP3 Moderate" | Yes |
| PM2 | PM2, Supporting; 0.0006% ≤ 0.01% | "PM2 Supporting" | "PM2 Supporting Met" | Population: "PM2 · Supporting" | Yes |
| Tier | VUS | "Variant of Uncertain Significance (VUS)" | same | none | Yes |
| Stability | not counted; 4 engines | "3 of 4 stability engines predict destabilisation" | "3 of the 4 counted engines are past their destabilizing mark" | Energetics: "3 destabilizing · 1 moderate" | Yes, if "predict destabilisation" means "past the local mark" (see F17) |
| Genome-wide | AlphaGenome `unavailable`; CADD 25.9 (not counted) | "1 genome-wide score (CADD, AlphaGenome) returned; 1 flag" | same | AlphaGenome: "No AVI score for this variant … Key Required / Standby"; Predictors "AlphaGenome AVI · Not available here" | **No (F1)** |
| Splicing | not counted; max Δ 0.01 | "Not counted"; "max Δ 0.01" | "Not counted" | Splice map: "supports BP4" pill | Partly (D3) |
| Population ClinVar | not an engine input | not mentioned | "ClinVar assertion: Pathogenic" in the Population block | Clinical tab: ClinVar has a classification | Shown on Report only (F5) |
| Interface | not an engine input | "Arg175 is at an interface: in all 6 solved structures. Homodimer." | not checked | Interfaces: "at the interface with HLA-A in all 6 solved structures" | **Partial (F8)** |

### UROD_G318R (engine: BP4)

| Item | Engine (api) | Insights | Report | Source tab | Match |
|---|---|---|---|---|---|
| BP4 | BP4; REVEL 0.229 in the BP4 band (Supporting) | "BP4 Supporting"; "The engine counted 1 criterion: BP4." | "BP4 Supporting Met" | Predictors Comparison: "BP4" (strength band: ≤ 0.29) | Yes |
| BS1 | not applied; FAF95 1.618% > 1% | "BS1 is not applied …" | not checked | Population: "BS1 is not applied" | Yes |
| BS2 | not applied; 15 homozygotes | not mentioned | not checked | Population: "BS2 not applied: BS2 needs homozygous …" | **Omitted in Insights (F20)** |
| Stability | 3 of 4 returned; FoldX still running | "0 of 3 stability engines predict destabilisation." (no running note) | "None of the 3 counted engines predicts destabilization. 3 of 4 engines returned a value." (no running note) | Energetics: "Provisional · 1 still running", "Running: FoldX" | **No (F3)** |
| Genome-wide | AlphaGenome `unavailable`; CADD 9.7 | "1 genome-wide score (CADD, AlphaGenome) returned; 0 flag …; 1 read it as tolerated" | same | AlphaGenome: Key Required / Standby | **No (F1)** |
| Splicing | max Δ 0.036 (acceptor gain, −216 bp) | "max Δ 0.04" (rounded) | "max Δ 0.04" | Channel: 0.036 | Yes (rounding, D10) |
| Tier | VUS; "Plausibly benign … BP4" | VUS | VUS | none | Yes |

### SOD1_A5V (engine: PP3_Moderate, PM2)

| Item | Engine (api) | Insights | Report | Source tab | Match |
|---|---|---|---|---|---|
| PP3 | PP3_Moderate; REVEL 0.853 | "PP3 Moderate" | "PP3 Moderate counted" | Predictors: "REVEL 0.853" | Yes |
| PM2 | PM2, Supporting; 0.0002% | "PM2 Supporting" | "PM2 counted" | Population: "PM2 · Supporting" | Yes |
| Stability | 1 destabilizing, 2 moderate; FoldX still running | "1 of 3 stability engines predict destabilisation." | "2 of the 3 counted engines sit in their moderately destabilizing band; StabilityOracle (+0.44) is past the destabilizing mark." | Energetics: "Provisional · 1 still running" | **Partly (F3, F6)** |
| Genome-wide | AlphaGenome `unavailable`; CADD 32.0 (not counted) | "1 genome-wide score (CADD, AlphaGenome) returned; 1 flag" | same | AlphaGenome: Key Required / Standby | **No (F1)** |
| Splicing | max Δ 0.14, between the bands | "sits between the cut-points (max Δ 0.14)" | same | Splice map: "supports neither PP3 nor BP4" | Yes |
| Tier | VUS | VUS | VUS | none | Yes |

### ABCG1_G358R (engine: none; run status `timeout`)

| Item | Engine (api) | Insights | Report | Source tab | Match |
|---|---|---|---|---|---|
| Run status | `timeout` at 360 s; `complete: false` | No run-status line. Shows the VUS headline and "Nothing has been counted yet." | "Ready to export. Nothing needs review." | none | **No (F2)** |
| PM2 | withheld (gnomAD build not served) | "Rarity (PM2) was not computed because no frequency was read." | "PM2 Supporting Withheld" | Population: "Population-frequency evidence was withheld" | Yes |
| BP4 | withheld (splicing not checked) | "No BP4: REVEL 0.092 … BP4 is withheld." | "BP4 Supporting **Not met**" | Predictors: "BP4 is withheld" | **No (F4)** |
| Stability | 4 of 4 returned; 0 destabilizing | "0 of 4 stability engines predict destabilisation." | "StabilityOracle −0.12 Neutral" | Energetics: "4 of 4 methods returned a value" | Yes |
| Genome-wide | CADD no result; AlphaGenome no result | "No genome-wide score (CADD, AlphaGenome) was returned." | same | Predictors: "No result" | Yes |
| Splicing | not queried | "until SpliceAI has answered" | same | Splice map: "Rule not applied" | **Wording (D2)** |
| Evidence areas | 4 of 7 returned | "4 of 7 areas returned a reading." (the three missing areas are not named) | none | none | **Unclear (F2)** |

## 2. Answer to the coverage question: does the app say that its tier covers only the criteria it can compute?

Partly. The app states that only recorded criteria count, and it lists some criteria it cannot compute. It never says that ClinVar and expert-panel classifications are outside the rule set, and the Report puts ClinVar "Pathogenic" next to a VUS tier.

What the user is told, quoted exactly:
- Insights (header): "The classification is computed by rules; the written summary may be AI-generated or rule-based. Neither is a clinical determination. Professional evaluation required."
- Insights (tier): "Not enough evidence either way yet. The engine counted 2 criteria: PP3 Moderate, PM2."
- Insights (footer): "Only recorded criteria enter the classification; no new score is made."
- Report, Classification: "Not enough evidence either way yet. The engine counted 2 criteria: PP3 Moderate, PM2."
- Report, "What would move it": "To reach likely pathogenic the engine needs one of these on top of what it has (1 Moderate, 1 Supporting): 1 Strong; 1 Moderate + 1 Supporting; 2 Moderate."
- Report, "Also checked, no evidence recorded": "PVS1, PS1, PM4, PP2, BP3."
- Report, "Still needed to decide": "Lab evidence (PS3) — The engine cannot compute PS3 and no assay data is held here."
- Report, Population block: "ClinVar assertion: Pathogenic · Condition: Li-Fraumeni syndrome · Review status: reviewed by expert panel."
- Report, Limitations: "Classification. The tier follows the Richards et al. 2015 combining rule, run on the criteria the rule engine recorded. Model proposals and context-only evidence are not counted."

Could a clinician misread it? Yes. On one page the tier says "Not enough evidence either way yet", while the same page says an expert panel classified the variant as Pathogenic. Nothing on the page says that ClinVar is outside the rule set. The Limitations block lists ClinVar only as a data source ("ClinVar - configured provider"), not as something left out of the tier. "Also checked, no evidence recorded: … PS1" reads as if PS1 was examined and found absent, although PS1 concerns the same amino-acid change as an established pathogenic variant, which is the point ClinVar makes. The Insights screen does not mention ClinVar at all.

- Fix (wording, not a new rule): add one sentence to the Classification block of the Report and the Insights tier: "This tier counts only the criteria listed above. It does not use ClinVar, expert-panel rules or the literature. The engine does not compute PS1, PS3, PP1, PS2 or PM1 for this variant." Replace "no evidence recorded" for criteria that were not computed with "not computed".
- SCIENCE — lead to decide: whether PS1 should be read as "not computed" or as "checked, no evidence" for TP53 R175H. Whether the report should show a ClinVar line beside the tier at all is also the lead's decision.

## 3. Findings

### F1. Blocker. AlphaGenome is named as a score that "returned", but AlphaGenome returned nothing (TP53, UROD, SOD1)

- Screens: Insights (Genome-wide scores card) and Report (Genome-wide scores block) on all three runs.
- Evidence: TP53 Insights: "1 genome-wide score (CADD, AlphaGenome) returned; 1 flag the variant and 0 read it as tolerated." The engine record for the same run: `conservationData.alphagenome.status: "unavailable"`, and the AlphaGenome tab says "No AVI score for this variant … AlphaGenome Atlas: Key Required / Standby". The Predictors "Genome-wide models" group shows "AlphaGenome AVI · Not available here". The only score returned was CADD.
- Producer: `src/shared/insightsEvidence.ts:596-603`. The lane lead text names "(CADD, AlphaGenome)" as fixed text, and the count `lm.length` counts CADD alone.
- Why it matters: the summary says a model that did not run did run, and "1 flag" then reads as AlphaGenome's output.
- Fix: build the names from the readings that came back (CADD only), and say "AlphaGenome: not available" when its reading is absent. The Report reads from the same lane, so one change fixes both.

### F2. Blocker. ABCG1: a run that timed out is shown as a finished VUS, and the Report says "Ready to export"

- Screens: ABCG1 Insights (screenshot `doc/release-audit/raw/ABCG1_G358R/views/view__insights.png`) and ABCG1 Report.
- Evidence:
  - Insights headline: "Variant of Uncertain Significance (VUS)". Sub-line: "Nothing has been counted yet. The rule engine recorded no criterion for this variant."
  - Insights "How the case was built": "4 of 7 areas returned a reading." The three missing areas are not named.
  - Report: "Ready to export. Nothing needs review."
  - Capture metadata: `status: "timeout"`, `analysis.complete: false`, `durationMs: 360020`.
- Search result: no timed-out or incomplete text exists in `src/components/insights`, `src/components/report`, or `src/components/ClinicalInsightsCard.tsx`.
- Producers:
  - `src/components/report/rail/ReportReviewStatus.tsx:18` (the "Ready to export" test checks only `block.review`).
  - `src/shared/reportModel.ts:182-184` (the review types are only "evidence-changed", "summary-outdated" and "tier-differs"; none covers an unfinished run).
  - `src/shared/insightsEvidence.ts:672` (the headline comes from the criteria list alone).
- Why it matters: a reader can export a Report for a run that did not finish, with a tier and no sign that three evidence areas are missing.
- Fix: add a review type "run did not finish" and show the names of the areas that did not return. The Insights headline reads "Not classified: the run did not finish" when the run is incomplete. "Ready to export" only when the run completed.

### F3. Blocker. UROD and SOD1: stability is reported as final while FoldX is still running

- Screens: UROD and SOD1 Insights (stability card) and Report (Stability block). Source: Energetics.
- Evidence:
  - Energetics (UROD): "Provisional · 1 still running", "Running: FoldX", "Other results are still being collected."
  - Energetics (SOD1): the same, with "Running: FoldX".
  - Insights (UROD): "0 of 3 stability engines predict destabilisation." Insights (SOD1): "1 of 3 stability engines predict destabilisation."
  - Report (UROD): "Ready to export. Nothing needs review." Report (SOD1): the same.
- Producers: `src/components/EnergeticsView.tsx:178` (the "Provisional · N still running" label is correct on the source tab). The summary count is `src/shared/insightsEvidence.ts:537`. Nothing in the summary lane checks for running engines.
- Why it matters: the summary treats a provisional count as final. A later FoldX result could change the count.
- Fix: the stability lane carries the same "provisional" state as Energetics. The Report review status lists it: "Stability is provisional: FoldX is still running."

### F4. Blocker. ABCG1 Report: BP4 is labelled "Not met", but the engine withheld it

- Screens: ABCG1 Report, criteria table ("BP4 Supporting Not met"). The same Report's text says "No BP4: REVEL 0.092 reads BP4 Moderate, but … BP4 is withheld."
- Evidence: the engine's partial evidence: "No verified GRCh38 nucleotide locus was established, so splicing was not checked and BP4 is withheld" (api, `partialEvidence.unavailable`).
- Problem: "Not met" means "checked, and the rule failed". The app did not check. A clinician reads the table as a finding.
- Producer: `src/shared/insightsEvidence.ts:659-666`. Only PM2 gets the "withheld" state (line 659). BP4 falls through to "not met" when a record exists.
- Fix: extend the "withheld" branch to BP4 when the predictor outcome is blocked or withheld. The predictor logic already makes that distinction (`src/components/inspector/PredictorsRail.tsx:174`).

### F5. Blocker. TP53 Report shows ClinVar "Pathogenic" beside a VUS tier, with no sentence saying ClinVar is not an input

- Screens: TP53 Report (Population block and Classification block), TP53 Insights.
- Evidence: see section 2 for the exact wording. The core contradiction: "Not enough evidence either way yet" (Classification) and "ClinVar assertion: Pathogenic … reviewed by expert panel" (Population) on one page, with no reconciling line.
- Producers: `src/shared/reportDocument.ts:97` (ClinVar fact line), `src/shared/reportCaseBlocks.ts:216` (the Limitations "Classification." sentence), `src/shared/insightsEvidence.ts:672` (the "Not enough evidence either way yet." headline).
- Fix: see section 2 (one added sentence on the tier, and "not computed" in place of "no evidence recorded" for criteria the engine cannot run).
- SCIENCE — lead to decide: PS1 treatment; whether ClinVar should appear beside the tier.

### F6. Important. The "(not counted)" tag is attached to the last name in a list, so it reads as applying to counted evidence

- Screens: TP53 Insights and Report ("Where the evidence agrees": "Computational, Population and Genome-wide scores (not counted) all point to pathogenic." and "Where it pulls apart": "Computational, Population and Genome-wide scores (not counted) lean pathogenic while Splicing (not counted) leans benign.").
- Problem: Computational (PP3) and Population (PM2) are counted. The phrase "(not counted)" appears after the last item, so a reader takes it as applying to all three. The same bug appears on UROD ("Computational, Splicing (not counted) and Genome-wide scores (not counted) all point to benign.") and SOD1.
- Producer: `src/shared/insightsEvidence.ts:614` (the `directionName` helper adds the tag per lane, but the list joiner at lines 618-620 places the last tag where the reader takes it as the list's tag).
- Fix: tag each name, or split the sentence: "Counted: Computational (PP3) and Population (PM2) point to pathogenic. Not counted: Genome-wide scores point to pathogenic."

### F7. Important. "No structured interpretation came back … Re-run the analysis to try again" appears on runs that have a complete rule record

- Screens: TP53, UROD and ABCG1 Insights (the callout at the bottom of the Insights screen).
- Evidence: "No structured interpretation came back. The run returned neither a structured interpretation nor a narrative. Re-run the analysis to try again."
- Problem: the rule-engine record is complete (7 of 7 areas for TP53 and UROD). The callout is about the AI narrative only, and the text tells the user to re-run for no reason. On ABCG1 the re-run advice is also wrong, because the run timed out for a reason that re-running alone may not fix (no exact DNA change).
- Producer: `src/components/ClinicalInsightsCard.tsx:299-304`. The callout fires when `analysisState.result.insights` is absent and no structured analysis is pending. The text picks its second sentence from `analysisState.result.analysis`.
- Fix: say "The AI narrative was not generated. The rule-engine record above is complete." Show "Re-run" only when the run itself did not finish.

### F8. Important. TP53 Insights: the interface is with a partner protein (HLA-A), but the sentence reads as self-contact

- Screen: TP53 Insights, Assembly card: "Arg175 is at an interface: in all 6 solved structures. Homodimer. Contact is not disruption, and the engine does not read assembly."
- Source (Interfaces & PPI, TP53): "Arg175 is at the interface with HLA-A in all 6 solved structures."
- Problem: the summary drops the partner name and places "Homodimer" next to the interface sentence. A reader can take this as an interaction between two TP53 chains.
- Producer: `src/shared/insightsEvidence.ts:355` (the "in all N solved structures" phrase) and the interface sentence around `:575-582`.
- Fix: name the partner: "Arg175 is at the interface with HLA-A (a partner protein) in all 6 solved structures. The TP53 homodimer is listed separately."

### F9. Important. Literature: "Variant-anchored" is given to papers whose title and abstract do not name the variant

- Screen: TP53 Literature. Example: the 2016 paper "Phosphorylation of Def Regulates Nucleolar p53 Turnover…" is tagged "Variant-anchored", with "Not in title/abstract" and "Cited by UniProt variant record".
- Trace on the same screen: "Text check: 1 name p.Arg175His · 20 name only TP53 · 11 neither." These three counts add up to 32, which matches the "All loaded 32" chip. The same trace also says "25 query matches loaded", so the screen gives two different totals (25 and 32). Of the 32 loaded papers, 11 do not name the variant or the gene in the text, and they can still carry the top tier.
- Problem: "Variant-anchored" tells a reader the paper is about this variant. Here, a curated database citation is enough.
- Producer: `src/shared/literatureScreening.ts:331` (a curated "names-variant" source counts as anchored) and `:341` (tier name "Variant-anchored").
- Fix: split the tier. "Cited by UniProt for this variant" is one label, and "Names the variant in text" is another. Only the second one earns "anchored".

### F10. Important (data check). ABCG1 Literature lists a paper dated 2027, after today's date (2026-11-27)

- Screen: ABCG1 Literature, first row: "2027 · Betaine alleviates renal osteodystrophy by stabilizing ABCG1 mRNA …"
- Producer of the year: `src/shared/literatureEvidence.ts:41` (year taken from the citation record). The upstream value comes from Europe PMC.
- Fix: check whether the record's year is an online-first date or a data error, and hide or flag papers dated in the future. This needs a look at the source record before release.

### F11. Important. SCIENCE — lead to decide. "Not enough evidence either way yet" is shown when two counted criteria lean pathogenic (TP53, SOD1)

- Screens: TP53 and SOD1 Insights and Report. Both show two counted pathogenic-direction criteria (PP3 Moderate and PM2 Supporting), the evidence-direction bars lean pathogenic, and the headline says "Not enough evidence either way yet."
- Problem: the headline reads as "no evidence", but the same screen shows evidence leaning pathogenic. The tier itself follows the Richards 2015 rule, so the issue is the wording, not the tier. The headline does not say that the evidence leans pathogenic.
- Producer: `src/shared/insightsEvidence.ts:672` (the headline for any non-empty criteria list).
- SCIENCE — lead to decide: the wording for a VUS that leans pathogenic. Options include "Below the threshold for likely pathogenic" and "Evidence leans pathogenic but is not enough for a classification."

### F12. Important. The AI narrative request is aborted on all four runs, and the screens say "AI not configured"

- Evidence: `failedRequests` in every capture's `meta.json`: `analyze-variant-narrative`, `net::ERR_ABORTED`. The screens say "AI not configured · Connect a Gemini API key in Settings to write a summary of this variant."
- Problem: two different states, a request that was sent and aborted and a key that is not configured, appear as one message. A user who has a key would see "not configured" and try to fix the wrong thing.
- Producers: `src/shared/narrativeFallback.ts:64` ("AI not configured" label) and `src/components/report/reportStatus.ts:104` (the same label on the Report). The request is sent from the narrative pipeline (`src/services/pipeline/narrativeService.ts`); the exact cause of the abort was not traced.
- Fix: separate "not configured" (no key) from "request stopped" (aborted), and show the retry action for the second.

### F13. Important (environment check). A 401 on `numbering-proof` appears in three runs, which puts a "Console 4" badge on every screen

- Evidence: `consoleErrors` and `apiErrors` in TP53, SOD1 and ABCG1 `meta.json`: `GET /api/v1/numbering-proof` returned 401 (Unauthorized). The sidebar shows a "Console" badge with the count 4 on each screen.
- Problem: either the audit server's auth mode is blocking this route, or the route requires a sign-in the app does not send. The badge is a permanent warning users cannot act on.
- Fix: confirm whether the audit container runs in `AUTH_MODE=legacy` for this route. If the route is correct, exclude it from the badge. If not, fix the auth on the route.

### F14. Important (axe, serious). Two buttons fail colour contrast, and they use shared styles

- Report: `button[data-variant="primary"]` (the Download button), producer `src/components/report/rail/ReportExportBar.tsx:23`.
- Literature: `.lit-btn[type="submit"]` (the "Search Europe PMC" button), producer `src/components/literature/LiteratureControls.tsx:120`.
- Fix: fix the button colour tokens once, in the shared stylesheet, and re-test both screens.
- Shared versus specific: both are shared button styles.

### F15. Important (axe, serious). The Insights inspector scroll region cannot be reached by keyboard (all four variants)

- Element: `.inspector-body` on the Insights screen (rule `scrollable-region-focusable`).
- Producer: `src/components/inspector/ViewInspector.tsx:479`.
- Fix: make the region focusable (`tabIndex={0}`) and give it a label. It is a shared inspector, so the fix covers other screens too.

### F16. Moderate (axe). Insights, 3D and Landscape have no level-one heading

- Rule `page-has-heading-one` on `html` (all four variants on the Insights screen; also 3D and Landscape).
- Fix: render the screen title as the page `h1`. Shared page template.

### F17. Polish. Plain-English problems in the summary layer

- The rail heading "Synthesis Provenance" with the sub-line "AI Telemetry & ACMG Rules Trace" (`src/components/inspector/ViewInspector.tsx:96`). Rename to "How this verdict was made".
- "Criteria merge", "Engine record", "Prose source", "Evidence Lineage" (rail titles). Rename to plain words such as "How the verdict was combined".
- Literature: "Screening tier", "Read first", "Read next", "All loaded". Explain "Screening tier" once, or rename it "Sort by relevance".
- Report: "Document ID 6e512b0c2d2451. A canonical content identifier. Export time and file formatting are excluded; it does not prove authorship." Keep the last clause; drop the jargon before it.
- Report: "Interpretation and method 1" and "2". The numbers look like footnotes. Drop them or name them.
- Insights stability card: "predict destabilisation" counts only engines past their local mark. The Energetics tab says "Most methods give a moderately destabilising reading … predict no destabilisation." Use "past the local mark" in the summary, and show the moderate count beside it, so the two screens use the same words.

### F18. Polish. Repetition across the summary screens

- The Compare paragraph ("Where the evidence agrees / differs") is repeated word for word in Insights and in the Report. This is intentional for export, but the Report's "Reads: Insights" footers add no information.
- "Connect a Gemini API key in Settings to write a summary of this variant." appears on Insights (the tab and the rail) and in the Report. Keep it once per screen.
- "Synthesis supports the current deep-model observations. They do not create additional counted ACMG criteria." uses "deep-model", which is not explained. Replace with "These observations do not add criteria."

### F19. Polish (question). The Report shows an "Edit" control next to the tier

- Screen: TP53 Report, Classification block: "Rule-engine classification · Edit · In export".
- Question for the lead: does "Edit" change the wording only, or can a user change the tier? The captures do not show which. If it can change the tier, the export should say that the tier was edited.

### F20. Important. UROD Insights leaves out BS2 (15 homozygotes), although the Population tab gives its reason

- Screens: UROD Insights (Population card) and the UROD Population tab.
- Evidence: Insights says "No frequency criterion applies … so PM2, BS1 and BA1 are all unmet." It does not mention BS2. The Population tab says "BS2 not applied: BS2 needs homozygous or hemizygous individuals documented as unaffected; gnomAD does not phenotype its participants, so the count is shown and not counted; 15 homozygotes observed."
- Problem: BS2 is a benign criterion. A reader who sees "15 homozygotes" on the Population tab and then the Insights sentence has no explanation for why BS2 is not counted. The Report does not show BS2 either.
- Producer: the Population card sentence is built at `src/shared/insightsEvidence.ts:464`, which speaks only about PM2, BS1 and BA1. The BS2 reason text the Population tab shows is at `src/shared/frequencyRule.ts:81`.
- Fix: add one clause to the Insights Population card: "BS2 is not applied because gnomAD does not check whether homozygous people are unaffected (15 observed)." Add the same clause to the Report's Population block.

## 4. Nielsen heuristics on the summary flow (Insights, then Report, then Literature)

Flow evidence: TP53 Insights screenshot, ABCG1 Insights screenshot, TP53 Report screenshot, TP53 Literature screenshot.

| # | Heuristic | Result | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | Fail. A timed-out run and a provisional stability count look final (F2, F3). | ABCG1 Insights screenshot |
| 2 | Match with the real world | Fail. "Synthesis Provenance", "Criteria merge", "Screening tier", "Key Required / Standby". | F17 |
| 3 | User control and freedom | Pass. Export options and the review list allow the user to jump to a section. | TP53 Report screenshot |
| 4 | Consistency and standards | Fail. "(not counted)" placement (F6); "Ready to export" with unfinished inputs (F2, F3); BP4 "Not met" (F4). | Sections 1 and 3 |
| 5 | Error prevention | Fail. A Report can be exported for an incomplete run, and ClinVar beside a VUS has no warning (F2, F5). | TP53 Report screenshot |
| 6 | Recognition over recall | Pass. The tier bar, the evidence-direction bars and the criteria table are on screen. | TP53 Insights screenshot |
| 7 | Flexibility and efficiency | Pass. Export formats and a brief/full toggle. | TP53 Report screenshot |
| 8 | Aesthetic and minimalist design | Fail. The same paragraphs repeat across Insights and Report, and the Gemini line appears more than once (F18). | F18 |
| 9 | Help users recover from errors | Mixed. The AI callout names a setting; the "No structured interpretation" callout says to re-run even when no re-run would help (F7, F12). | F7, F12 |
| 10 | Help and documentation | Pass. "How this interpretation is assembled" and "How to assess a paper's relevance" are present. | TP53 Insights and Literature screenshots |

## 5. Staleness, placeholders and "running" states

- Running or pending states that became final: F2 (ABCG1 timeout), F3 (UROD and SOD1 FoldX still running).
- Placeholders: "AI not configured" and "Connect a Gemini API key" on all four Reports (F12, F18).
- Failed request: `analyze-variant-narrative` aborted on all four runs (F12).
- Data problems: F10 (a 2027 paper date). F13 is an environment question.
- Retired names: none found on the group F screens. I searched the captures for ConSurf, GPN, SaProt, ESM-2, VESM, ESMC, ESM3, DynaMut and DDMut, and found zero hits.
- Contradictions: F1, F4, F5, F6, F7, F8, F11.

## 6. Axe (accessibility scan), group F screens

| Screen | Rule | Impact | Target | Shared or specific |
|---|---|---|---|---|
| Report (TP53, UROD, SOD1, ABCG1) | color-contrast | serious | `button[data-variant="primary"]` | Shared button style (F14) |
| Literature (TP53, UROD, SOD1, ABCG1) | color-contrast | serious | `.lit-btn[type="submit"]` | Shared button style (F14) |
| Insights (all four) | scrollable-region-focusable | serious | `.inspector-body` | Shared inspector (F15) |
| Insights, 3D, Landscape | page-has-heading-one | moderate | `html` | Shared page template (F16) |
| SOD1 console | color-contrast | serious | `span[data-source="structure-3d"]` | Not in group F (3D view) |

Out of group: `aria-prohibited-attr` on `.pop-stars` in the Population tab (all four variants) belongs to group A.

## 7. Ranked top 5

1. **F1 (blocker).** The summary says AlphaGenome returned a score when it did not. Build the names from the readings that came back.
2. **F2 (blocker).** The ABCG1 run timed out, yet the Insights and Report show a finished VUS and "Ready to export." Add an incomplete-run state and list the missing areas.
3. **F5 (blocker, SCIENCE part).** The TP53 Report shows ClinVar "Pathogenic" beside a VUS tier with no sentence explaining that ClinVar is not an input. Add one sentence now; the lead decides on PS1 and on showing ClinVar beside the tier.
4. **F3 (blocker).** UROD and SOD1 report stability as final while FoldX is still running. Carry the provisional state into the summary.
5. **F4 (blocker).** The ABCG1 Report says BP4 "Not met" when the engine withheld it. Extend the withheld state to BP4.

No other blockers. The important items with the largest reader impact, outside the top 5, are F6 ("(not counted)" placed on counted evidence) and F9 ("Variant-anchored" on papers that do not name the variant).
