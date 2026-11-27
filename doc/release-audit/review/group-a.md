# Group A review: "Is it rare / is the gene linked?"

Date: 2026-11-27. Reviewer: release audit (read-only on source; no commits).
Tabs: **Population data** (`clinical`: Comparison and Clinical assertion subtabs) and **Gene–disease** (`gene-disease`, including the Gene dosage block).

## What I used

- Captures (production, `doc/release-audit/raw/`): `TP53_R175H`, `UROD_G318R`, `SOD1_A5V` (all `status: ok`). Read every text file of the group for these three. Viewed the screenshots: UROD `clinical__comparison.png`, TP53 `gene-disease__no-subtabs.png`, SOD1 `clinical__clinical-assertion.png`.
- `ABCG1_G358R` has `status: timeout`, so it is not in the ok set. I read its text as the worst state seen (A17) and did not use it for axe counts.
- Code: `src/` located by grep. Line numbers are from the working tree on this branch.
- Tests run (no source change): `npx vitest run src/components/__tests__/ClinicalTab.test.tsx` gave **34 passed, 0 failed**. The e2e proof (`tests/proof/urod-population.e2e.ts`) needs the live server and was **not run**.

Technical terms used below: **FAF95** = the 95% lower confidence limit of an allele frequency (the number the benign rules read). **grpmax** = the highest frequency across gnomAD's ancestry groups. **AC / AN** = allele count / alleles assessed. **BA1, BS1, BS2, PM2, PP2** = ACMG evidence codes (BA1 and BS1 are benign frequency codes; BS2 is "healthy homozygotes"; PM2 is "absent or very rare"). **GenCC** = a gene–disease validity catalogue. **MONDO ID** = a disease identifier. **ClinGen dosage** = whether losing or gaining one gene copy causes disease.

## The flow in one line

A clinician opens **Population data** to see whether the variant is too common to cause disease, then **Gene–disease** to see whether the gene is linked to a disease. The two answers depend on each other: the PM2 rule on Population cites a GenCC inheritance that is only readable on Gene–disease after a disease is picked (A5).

## 1. Coherence across the two tabs

| Fact | Population (`clinical__*`) | Gene–disease (`gene-disease__*`) | Verdict |
|---|---|---|---|
| Gene and transcript | Header `TP53 p.Arg175His`, rail `ENST00000269305`, `NM_000546.6` | Header only | Consistent |
| Frequency value | `1.62%` on screen and rail (UROD) | none | Consistent |
| Criterion state for "not counted" | "No criterion" (pill), "None recorded" (rail step 4) | none | **Different words for one state** (A6) |
| BS1 outcome | Screen: "BS1 is not applied" / rail step 2: "BA1/BS1 read FAF95" | none | **Contradiction** (A1) |
| Disease name | ClinVar: "Familial porphyria cutanea tarda, not provided, not specified" | Dosage: "Familial Porphyria Cutanea Tarda" | Casing differs; placeholder text leaks (A12) |
| Dates | "Last evaluated 6 Sept 2024" / "3 Feb 2026" | "2021-11-10", "Export of 2026-10-04", "Retrieved 2026-10-08" | **Three date styles** (A8) |
| Source names | "gnomAD", "All of Us", "NCBI ClinVar" | rail "GenCC validity", "Gene2Phenotype mechanism", "ClinGen dosage"; rail heading "Sources & availability" with chip "Available" | Heading and chip differ from the sister rails "Source availability"/"Read" (A9) |
| Rail title | "Evidence Lineage" | "Evidence inspector" | **Different** (A9) |
| Context-only boundary | none | dosage footnote "No ACMG criterion is added." | Consistent in meaning |

## 2. Nielsen heuristics (numbering: 1 visibility, 2 real-world match, 3 user control, 4 consistency, 5 error prevention, 6 recognition over recall, 7 flexibility, 8 minimal design, 9 error recovery, 10 help)

- **H1 visibility:** Gene–disease shows no validity answer until a disease is picked (A4). The "8 available" diseases are hidden in a select box. The Population dot and PM2 inheritance source are not visible on the screen (A16, A5).
- **H2 real-world match:** "not provided" is shown as part of a disease name (A12). The rail says "fired" and "ceiling consulted" (A13). "grpmax" is never explained (A13). The population intro lists ClinVar as a frequency source, which is not what the tab shows (A11).
- **H4 consistency:** the same state has five wordings on Population (A6). Dates have three styles (A8). The sister rails use different headings and chips (A9).
- **H5 error prevention:** the dosage row says "Disease not matched to the selection" when nothing is selected (A3).
- **H6 recognition:** the rule trace makes the reader hold the cut-points in mind (A7). Diseases are hidden in a select box (A4).
- **H8 minimal design:** the BS2 reason appears twice on one screen (A7). The cut-points table appears on screen and in the rail (A7). The dosage sentence appears in the caption and the rail list (A7).
- **H9 error recovery:** the ABCG1 run states the same "not queried" reason three times and gives no single fix (A17).
- **H10 help:** Population has a book icon at top right; Gene–disease has "Reference & methods" in the rail; the other tabs use "How to read this evidence" at the foot of the body. Three places for help (A19).

## 3. Staleness

Checked against the current rules (BS1 is not applied to UROD, because the engine has no disease-specific maximum credible allele frequency; the reason text is in `src/shared/frequencyRule.ts:78-81`).

- **Confirmed stale (blocker):** `tests/proof/urod-population.e2e.ts:20-24` expects the verdict chip to read `BS1` and the headline `1.62%`.
- **Confirmed stale:** `src/components/__tests__/ClinicalTab.test.tsx:509` sets `ruleBasedInsights: { acmgCriteria: [{ code: "BS1" }, ...] }` and expects `verdict-chip` "BS1" (line 518). The unit file passes (34 of 34), because the fixture sets the outcome itself. The unit test does not check what the engine decides (A2).
- **Confirmed stale docs:** `doc/EVIDENCE_TABS_FULL_AUDIT.md:21` ("The engine now records **BS1** on FAF95 1.62%"), `:31` (row D3 "BA1/BS1 read FAF95"), `:95` ("It shows BS1"), `:116` and `:119` ("read `BS1`"). `doc/LIMITATIONS.md:80` says "BS1 maps benign frequency thresholds" (A2).
- **Doc contradicts the app on BS2:** `doc/EVIDENCE_TABS_FULL_AUDIT.md:38-41` says 15 healthy UROD homozygotes "is legitimate BS2 evidence" and "The rail now says so". The live screen says "BS2 not applicable" and the count is "not counted" (A20, SCIENCE).
- **Retired sources:** none in group A UI text (searched `src/` for ConSurf, ESM-2, GPN; none in the population, gene–disease, or shared files).
- **Coming soon / placeholders:** none in group A. "Choose a disease and inheritance" is a real picker label, not a placeholder.

## 4. axe violations

| Tab (subtab) | Rule | Impact | Nodes | Variants | Shared? |
|---|---|---|---|---|---|
| `clinical/clinical-assertion` | `aria-prohibited-attr` ("Elements must only use permitted ARIA attributes") | serious | 1 (`.pop-stars`) | TP53, UROD, SOD1 (3 of 3) | Tab-specific: one component, `ClinicalTab.tsx:202` |
| `clinical/comparison` | none | — | 0 | all 3 | — |
| `gene-disease/no-subtabs` | none | — | 0 | all 3 | — |

Manual check not covered by axe: the clinical status dot on the Clinical assertion tab (A16).

## 5. Variants that show the tabs at their worst

- **UROD G318R** (`status: ok`): worst for accuracy. Population says BS1 is not applied, the rail says BS1 read FAF95, and the lineage row says "1 benign" beside "No criterion" (A1, A10).
- **TP53 R175H** (expected to pass cleanly): not clean. The dosage row claims a mismatch with no disease chosen (A3); the rail still says BA1/BS1 read FAF95 (A1).
- **SOD1 A5V** (`status: ok`): clean on criteria; shows the ClinVar "not provided" placeholder inside the condition (A12) and the star rating with no legend (A15).
- **ABCG1 G358R** (timeout; worst state seen): the population criterion is withheld and the same reason repeats three times (A17).

## Findings

Severity: **blocker** = fix before release; **important** = fix in this release if possible; **polish** = small fix. SCIENCE items: the lead decides; this review does not propose engine changes.

### A1. BS1 is "not applied" on screen but "read FAF95" in the rail. Severity: blocker
- **Screens:** `clinical__comparison.txt/.png` (UROD). Same wording on TP53 and SOD1 rails.
- **Evidence:** screen: "BS1 is not applied: BS1 needs a condition-specific maximum credible allele frequency…" and "No criterion". Rail step 2: "1.62% · BA1/BS1 read FAF95". Rail step 4: "Engine criterion: None recorded". Rail row: "ACMG rules 0 pathogenic · 1 benign".
- **Where:** `src/components/inspector/PopulationRail.tsx:183` (the text "BA1/BS1 read FAF95" is written for every variant, whatever BS1 did); `:219` ("None recorded"); `:353` (the count row, A10). Same string in `src/shared/evidenceComparison.ts:68` for the candidate case.
- **Heuristics:** H1, H4.
- **Fix:** derive the rail step from the engine's decision. When BS1 is not applied, say "BA1 read FAF95 · BS1 shown as a reference only". Use "No criterion" (the screen's word) in step 4. The rule outcome itself is SCIENCE (A20); the wording fix is not.

### A2. Tests and docs still say UROD gets BS1; the unit test passes only because its fixture sets BS1. Severity: blocker (release gate)
- **Screens:** not on screen; affects the release gate.
- **Evidence:** `tests/proof/urod-population.e2e.ts:20-24` (expects `verdict-chip` "BS1"); `src/components/__tests__/ClinicalTab.test.tsx:509, 513-518` (fixture + expectation; 34/34 pass on 2026-11-27); `doc/EVIDENCE_TABS_FULL_AUDIT.md:21, 31, 95, 116, 119`; `doc/LIMITATIONS.md:80`.
- **Where:** the test fixture hard-codes the engine's answer, so it cannot catch engine drift.
- **Heuristics:** not a Nielsen issue; a staleness and test-quality issue.
- **Fix:** after the lead decides BS1 (A20), (a) build the UROD fixture through the real rule code (`src/shared/frequencyEvidence.ts`) rather than writing the outcome by hand; (b) change the e2e expectation to "No criterion" plus the BS1 reference text; (c) correct the doc rows; (d) add one assertion that fails when the screen says "not applied" and a chip says BS1.

### A3. Dosage says "Disease not matched to the selection" when no disease is chosen. Severity: blocker
- **Screens:** `gene-disease__no-subtabs.txt/.png` (TP53 and UROD). Under "Li-Fraumeni syndrome / MONDO:0018875": "Disease not matched to the selection: no MONDO ID on one side." The picker reads "Choose a disease and inheritance". The section subtitle says "independent of disease selection".
- **Where:** `src/shared/dosageSensitivity.ts:109` (`!score.diseaseId || selectedMondo.size === 0 ? 'unscoped' : …`; the scope type is at `:94-95`): an empty selection is treated as "unscoped", which prints the mismatch sentence (`:69`). Caption text `src/components/evidence/GeneDiseaseTab.tsx:45` says "independent of disease selection", which contradicts it.
- **Heuristics:** H5 (error prevention), H2 (the message describes a selection that does not exist).
- **Fix:** at `dosageSensitivity.ts:109`, return a separate state for "no disease chosen" and show no scope note for it. Keep "unscoped" only for "a disease is chosen but has no MONDO ID". Add a unit test for the empty selection.

### A4. Gene–disease gives no validity answer until a disease is picked; the disease list is hidden. Severity: important
- **Screens:** `gene-disease__no-subtabs.png` (TP53: "8 available"; UROD: "4 available"). The body is the picker and the dosage table. The rail says "Choose a disease in the workspace to review its validity, mechanism and variant context." The rail's "GenCC validity: Available" has no matching body content.
- **Where:** `src/components/evidence/DiseaseContextPicker.tsx:55` (placeholder "Choose a disease and inheritance"); `src/shared/geneDiseaseEvidence.ts:195` ("Choose a disease and inheritance to inspect its mechanism."); `src/components/evidence/GeneDiseaseTab.tsx` (no empty-state card in the body).
- **Heuristics:** H1, H6 (the reader must open a select to see what exists).
- **Fix (bold):** on load, list the GenCC diseases for the gene as a table (name, inheritance, validity), and show the dosage block after it. The disease picker then becomes "open one of these". The user has already said the tab's question is "is the gene linked": answering it needs the list visible. Alternative if the table is too large: a one-line summary in the body ("GenCC lists 8 diseases for TP53; choose one to read validity").

### A5. PM2 uses a GenCC inheritance, but the population tab does not say which disease it came from. Severity: important (wording) / SCIENCE (rule)
- **Screens:** `clinical__comparison.txt` (TP53: "lower ceiling: curated GenCC inheritance includes Autosomal dominant"; SOD1: "...Autosomal dominant, Autosomal recessive").
- **Where:** the ceiling row sits in `src/components/inspector/PopulationRail.tsx` (the ceiling step is at line 208; the exact source string was not traced). The disease sharing sentence in `DiseaseContextPicker.tsx:39` lists "Gene–disease, Expression and Species & models", not Population.
- **Heuristics:** H6, H4.
- **Fix:** name the source and disease on the ceiling line ("GenCC, Li-Fraumeni syndrome: autosomal dominant"). Add Population to the sharing sentence if the PM2 inheritance follows the picked disease; otherwise say it is gene-level.
- **SCIENCE — lead to decide:** should PM2's inheritance follow the disease chosen on Gene–disease, or the gene's GenCC record as a whole? The screens do not say which is used.

### A6. Five wordings for "a criterion was not counted" on one tab. Severity: important
- **Screens:** `clinical__comparison.txt` for all three variants.
- **Evidence:** "No criterion" (pill); "None recorded" (rail step 4); "BS2 not applicable" (heading) then "— not applied: BS2 needs…" (body); "No BS2" (a branch of the same label); "BS1 is not applied"; "(not reached)" for PM2 ceiling; "(reference only, not counted)" in the cut-points table.
- **Where:** `src/components/evidence/ClinicalTab.tsx:477` and `:614` ("BS2 not applicable" and "No BS2" branches); `src/components/inspector/PopulationRail.tsx:219` ("None recorded"); `src/shared/frequencyRule.ts:78-81` (reason constants); `src/shared/candidateFrequencyEvidence.ts:176` and `src/shared/frequencyEvidence.ts:774` (BS1 text).
- **Heuristics:** H4, H2.
- **Fix:** one vocabulary: "Applied", "Not applied: <reason>", "Not met", "No criterion". Replace "not applicable" everywhere (the word "not applicable" does not say whether the rule was checked). Use the same strings on screen and in the rail, from the constants in `frequencyRule.ts`.

### A7. The same sentences appear twice on one screen. Severity: important (minimal design)
- **Screens:** UROD `clinical__comparison.txt`: the BS2 reason appears in the body under the heading and again in the rail step 4 ("BS2 not applied: BS2 needs…"); "the count is shown and not counted" appears twice. The cut-points table appears in the rail; the "Rule thresholds" disclosure repeats the same thresholds on screen. Gene–disease: the dosage sentence "Dosage is whole-gene copy-number evidence… No ACMG criterion is added." is in the caption (`GeneDiseaseReadings.tsx:81`) and the rail list (`GeneDiseaseRail.tsx:70`), and the rail's "Review overview" repeats "Gene dosage can be reviewed independently."
- **Heuristics:** H8.
- **Fix:** each reason once. Screen: a short line. Rail: the full reason. Delete the rail list items that repeat the screen caption, and make the thresholds disclosure the only copy of the cut-point table (or the rail's copy the only one).

### A8. Dates appear in three styles, and one missing-value word is lowercase. Severity: important
- **Screens:** TP53 `clinical__comparison.txt`: "Last evaluated 6 Sept 2024". SOD1: "3 Feb 2026". TP53 gene-disease: table date "2021-11-10" and caption "last evaluated 2021-11-10". Rail: "Export of 2026-10-04", "Retrieved 2026-10-08". ABCG1 (timeout run): "Source table retrieved 2026-11-27."
- **Where:** `src/components/evidence/population/populationFormat.ts:51` (`formatClinicalDate`, used at `ClinicalTab.tsx:296` and `PopulationRail.tsx:143`); `src/components/evidence/GeneDiseaseReadings.tsx:81` (raw `dosage.evaluatedAt`); `src/components/inspector/GeneDiseaseRail.tsx` (provenance); `src/components/evidence/GeneDiseaseTab.tsx:50` (`.slice(0, 10)`); missing value `ClinicalTab.tsx:683` ("not reported", lower case) vs `HpaCard.tsx:30` ("Not reported") vs `reportDocument.ts:100` ("Not recorded").
- **Heuristics:** H4.
- **Fix:** one display formatter for dates on the screen ("2 Nov 2021"). Keep ISO strings only in provenance tables if a machine-readable form is needed. One missing-value word ("Not reported") everywhere.

### A9. The sister rails use different headings, chips and titles for the same thing. Severity: important
- **Screens:** Gene–disease rail: heading "Sources & availability", chip "Available". Expression rail (`expression-models__*`): "SOURCE AVAILABILITY", chip "Read". Species rail: "Sources read", chip "Read". Rail title: "Evidence inspector" on Gene–disease vs "Evidence Lineage" on Population, Expression and Species.
- **Where:** `src/components/inspector/GeneDiseaseRail.tsx:46` and `:49`; `src/components/inspector/EvidenceContextRail.tsx:69` (`species ? 'Sources read' : 'Source availability'`) and `:36` (`'Read'`); `src/components/inspector/ViewInspector.tsx:387` (special-cases Gene–disease to "Evidence inspector").
- **Heuristics:** H4.
- **Fix:** one heading ("Sources") and one chip set ("Available", "Not available", "Not read yet") from one shared component. One rail title for all evidence tabs; delete the special case at `ViewInspector.tsx:387`.

### A10. The "ACMG rules" count on the Population rail counts every tab, not this tab. Severity: important
- **Screens:** UROD rail: "ACMG rules 0 pathogenic · 1 benign" beside "Engine criterion: None recorded" and "No criterion" on screen. SOD1: "2 pathogenic · 0 benign" while the population screen has only PM2.
- **Where:** `src/components/inspector/PopulationRail.tsx:353` (`pathCount` and `benCount` come from the whole result).
- **Heuristics:** H1, H2 (the reader cannot tell which benign rule the "1" is).
- **Fix:** list the codes ("1 benign: BP4, from predictors") or move this row to Insights, where every criterion is listed.

### A11. The population intro names ClinVar as a frequency source; no ClinVar frequency is shown. Severity: important (accuracy)
- **Screens:** all three `clinical__comparison.txt`: "How often this allele has been seen in gnomAD, All of Us and ClinVar submissions — and which ACMG frequency criterion that supports." The frequency rows are gnomAD exomes, gnomAD genomes and All of Us (SOD1: "No frequency returned" for genomes). No ClinVar count appears.
- **Where:** `src/components/evidence/ClinicalTab.tsx:373`.
- **Heuristics:** H2.
- **Fix:** "How often this allele is seen in gnomAD and All of Us, and which ACMG frequency criterion that supports. ClinVar's classification is on the next subtab."

### A12. ClinVar's placeholder "not provided" is shown inside the disease name. Severity: important
- **Screens:** SOD1 `clinical__clinical-assertion.txt`: "Condition: SOD1-related disorder, not provided, Amyotrophic lateral sclerosis type 1". UROD: "Familial porphyria cutanea tarda, not provided, not specified". The Gene–disease dosage name for the same UROD disease is "Familial Porphyria Cutanea Tarda".
- **Where:** `src/components/evidence/ClinicalTab.tsx:673-674` renders `cv?.trait` as-is. `src/shared/variantLocus.ts:40` and `:62` already filter these placeholders for the Gene–disease locus card.
- **Heuristics:** H2.
- **Fix:** reuse the `variantLocus.ts` filter here: show the named conditions, and put "ClinVar names no condition for N entries" as a note. Keep one casing for disease names.

### A13. Rail jargon: "fired", "ceiling consulted", "grpmax" not explained. Severity: polish
- **Screens:** UROD rail step 3: "The benign cut-points fired before the ceiling was consulted." Rail step 2: "Highest of gnomAD's grpmax groups…" (the term is not glossed).
- **Where:** `src/components/inspector/PopulationRail.tsx:208`.
- **Heuristics:** H2, H10.
- **Fix:** "A benign rule decided this first, so the PM2 ceiling was not checked." Gloss grpmax once: "highest frequency across ancestry groups (grpmax)."

### A14. One chart mixes number formats. Severity: polish
- **Screens:** TP53 `clinical__comparison.txt`: "0.001426%" next to "4.10e-4%" and "5.93e-4%" in the same plot. UROD: "0.06376%", "0.4872%", "1.618%". Rail shows the same kind of values as "5.93e-6".
- **Where:** the plot labels in `src/components/evidence/population/FrequencyScale.tsx` (formatter not traced); the rail uses `src/shared/frequencyFormat.ts:20-26`, which switches style at fixed cut-offs.
- **Heuristics:** H4.
- **Fix:** one formatter for the plot labels and the rail (`formatAlleleFrequency`).

### A15. Serious axe violation on the star rating; the stars have no legend. Severity: important (axe is serious)
- **Screens:** `clinical__clinical-assertion` on TP53, UROD and SOD1. Axe: `aria-prohibited-attr`, serious, 1 node, `.pop-stars`. Screenshot: "★★☆☆" next to "criteria provided, multiple submitters, no conflicts" with no key.
- **Where:** `src/components/evidence/ClinicalTab.tsx:202` (`<span className="pop-stars" aria-label=…>`: an `aria-label` on an element with no role).
- **Heuristics:** H1 (stars without a key), H4.
- **Fix:** add `role="img"` to the span (keeps the label). Either add a key ("4 stars = expert panel") or drop the stars, since the words already say the review level.

### A16. The red status dot on a subtab label has no words on screen. Severity: important
- **Screens:** UROD `clinical__comparison.png`: a red dot after "Clinical assertion" (the ClinVar record disagrees with the population result). The same mechanism puts dots on "Protein measurements" and "Expression at variant" (group C).
- **Where:** the dot is defined in `src/components/evidence/EvidenceWorkspace.tsx:45` ("the tab then gets a dot"); rendered at `src/components/ui/WorkspaceTabs.tsx:32-36`. The sentence is in a `title` tooltip and in an `sr-only` span that is also `aria-hidden` (`WorkspaceTabs.tsx:36`). The population mark is set at `ClinicalTab.tsx:377` (`clinvarMark`).
- **Heuristics:** H1, H2.
- **Fix:** show the mark sentence as visible words on the label ("Clinical assertion · conflicting classifications"), or add a line under the tabs. Remove `aria-hidden` from the `sr-only` copy and check with a screen reader (I have not tested that).

### A17. ABCG1 (timeout run, worst state seen): the same reason appears three times. Severity: important
- **Screens:** `ABCG1_G358R/tabs/clinical__comparison.txt`. Intro: "Population-frequency evidence was withheld: gnomAD r4 was not queried: … no allele was selected or inferred." Then the same sentence under "gnomAD exomes" and under "gnomAD genomes". The state words in one screen are: "withheld", "No criterion", "No reading", "No frequency returned", and (in `meta.json`) "Population evidence not assessed". The run status is `timeout`, so re-run before filing this one.
- **Heuristics:** H8, H4, H9.
- **Fix:** state the reason once above the rows. Per-source rows say "Not queried: see above". Use one state word ("Not assessed") everywhere. Keep the "Provide nucleotide allele" action next to the reason.

### A18. Dosage empty states use different words. Severity: polish
- **Screens:** TP53 dosage: "0: No evidence available. Nothing curated; not a finding of tolerance." ABCG1 dosage: "ClinGen dosage · No result. No ClinGen dosage curation is listed… This does not mean copy-number changes are tolerated."
- **Where:** `src/shared/dosageSensitivity.ts:57-58` (code labels); `src/shared/geneDiseaseEvidence.ts:132` (`ENGINE_STATE_LABELS['no-result']`).
- **Heuristics:** H4.
- **Fix:** keep the two meanings (ClinGen scored "0" versus nothing listed), but use one label pattern for both: "Scored 0: no evidence" and "Not listed by ClinGen".

### A19. Help lives in three places. Severity: polish
- **Screens:** Population: book icon top right. Gene–disease: "Reference & methods" in the rail. Other evidence tabs: "How to read this evidence" at the foot of the body.
- **Heuristics:** H10.
- **Fix:** one help entry point per tab, in the same place.

### A20. BS2 for UROD: the doc says it is legitimate, the app says it is not counted. Severity: SCIENCE — lead to decide
- **Screens:** UROD `clinical__comparison.txt`: "BS2 not applicable — not applied: BS2 needs homozygous or hemizygous individuals documented as unaffected; gnomAD does not phenotype its participants".
- **Evidence:** `doc/EVIDENCE_TABS_FULL_AUDIT.md:38-41` ("15 healthy gnomAD homozygotes is legitimate BS2 evidence here… The rail now says so").
- **Question for the lead:** is BS2 counted for UROD (where the doc argues yes) or not (where the engine and reason text say no)? The UI wording and the doc must match whichever is chosen. The reason text is `src/shared/frequencyRule.ts:81`.

## Top 5 (ranked, group A)

1. **A1 (blocker):** UROD rail says BS1 "read FAF95" while the screen says BS1 is not applied (`PopulationRail.tsx:183, 219`).
2. **A2 (blocker):** the e2e proof and unit fixture expect BS1; the unit test passes only because the fixture sets it (`tests/proof/urod-population.e2e.ts:20-24`; `ClinicalTab.test.tsx:509, 518`).
3. **A3 (blocker):** dosage says "not matched to the selection" when no disease is chosen (`dosageSensitivity.ts:109`).
4. **A4 (important):** Gene–disease shows no validity content until a disease is picked; list the diseases on load (`DiseaseContextPicker.tsx:55`, `GeneDiseaseTab.tsx`).
5. **A6 (important):** one vocabulary for "not counted" criteria instead of five wordings (`ClinicalTab.tsx:477, 614`; `PopulationRail.tsx:219`).

Next in line: A8 (dates), A9 (rail headings), A11 (ClinVar in the intro), A12 (placeholder in disease name), A15 (axe).
