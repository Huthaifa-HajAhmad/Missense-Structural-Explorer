# State vocabulary (W2, deliverable 3)

Method: keyword search over `src/components`, `src/shared` and `src/hooks` (non-test). Hits were kept when the word sat in a string literal or JSX text. Code identifiers (for example `loading`, `error`, `pending` as property names) were counted separately and not listed.

## 1. Canonical vocabularies

There is no single "five-state" list. Three label sets exist, and one comment is out of date.

| Set | Definition | Labels (user-visible) | Used for |
|---|---|---|---|
| Engine / computation | `src/shared/engineStatus.ts:349-361` (`EngineState`), labels at `:380-392` (`ENGINE_STATE_LABELS`) | Computed, Running, Not available here, Not covered, Provider busy, Provider error, Failed, Cancelled, No result, Paused, Hidden | A computed value or an engine run for one variant. `engineStatus.ts:25` says no surface formats ΔΔG itself. |
| Provider / service health | `src/shared/providerStatus.ts:22-42` (`PROVIDER_STATE_LABELS`) | Connected, Configured, Degraded, Unreachable, Not configured, Checking, Out of date | A health probe or a setup check. Its own comment (`:5-12`) says it must not describe a computation. |
| Evidence availability (per row) | `src/shared/evidenceAvailability.ts:60-66` (`EvidenceAvailabilityState`) | available, pending, not-covered, not-configured, upstream-error, no-result (keys; labels come from the engine set; `not-configured` maps to "Not available here", `:69-71`) | One evidence row on a tab. |
| Criterion state | `src/shared/insightsEvidence.ts:133` (`CriterionState`) | met, not met, withheld, not recorded | The ACMG criterion row in Insights. |

Out of date: `src/shared/interfaces/format.ts:54` says "A lookup's outcome as one availability state, in the five-state vocabulary." The function at `:55-66` returns six states: `pending`, `ok`, `empty`, `failed`, `skipped`, `unknown`.

"not evaluated" is not in any canonical set and has zero hits in `src/components` or `src/shared`. The criterion-state union above has no such value.

## 2. Words used outside the canonical sets

Each row is one word with its meaning in the app, its hit count (string-literal hits, tests excluded), and the places it appears. The "conflict" column says what canonical word it competes with.

| Word | Hits | Where (file:line) | Conflict |
|---|---:|---|---|
| Not reported | 62 in 30 files | `evidence/ClinicalTab.tsx:668` (ClinVar status fallback); `inspector/LandscapeLocalContext.tsx:52` (O/E); `literature/MechanismPanel.tsx:15` (constraint values); `evidence/StructureTab.tsx:247,305,321`; `evidence/HpaCard.tsx:27-31`; `evidence/PextCard.tsx:46,65`; `evidence/expression/ExpressionRecords.tsx:17-18`; `inspector/EnergeticsRuleTrace.tsx:60`; `molstar/StructurePocketPanel.tsx:65,72,86` | "Not recorded" (reportDocument, reportCaseBlocks), "Not measured", "No result" for the same absent value |
| Not recorded | 8 | `shared/reportDocument.ts:98-100` (ClinVar status, "Not recorded"); `shared/reportCaseBlocks.ts:100` (criterion row), `:222-223` (run id, gnomAD dataset); `shared/evidenceComparison.ts:127` (engine record); `inspector/NarrativeProvenanceRow.tsx:113` (inference model) | "Not reported" (ClinicalTab:668); also a canonical criterion-state word (insightsEvidence:133) used for a non-criterion value |
| Not measured | 18 in 15 files | `inspector/StructureInspector.tsx:74`; `evidence/function/HotspotsView.tsx:177`; `evidence/interfaces/BindingCard.tsx:14`; `header/constraintMetrics.ts:241,323`; `shared/burialEvidence.ts:141,160`; `shared/interfaces/finding.ts:145`; `shared/interfaces/trace.ts:70,130`; `shared/interfaces/types.ts:78`; `shared/interfaces/verdict.ts:115`; `shared/molecularWorkspace.ts:74`; `shared/packingEvidence.ts:224,253`; `shared/residueContextEvidence.ts:420,448`; `shared/mechanismWorkspace.ts:110` | "Not available"; "Not reported" |
| Not available | 12 in 9 files | `shared/molecularWorkspace.ts:73` (pLDDT null); `shared/expressionTabEvidence.ts:108`; `shared/literatureEvidence.ts:582`; `shared/literatureSummary.ts:50`; `shared/mechanismWorkspace.ts:111`; `telemetry/sidecarCard.ts:26,45`; `settings/sections/AccountSection.tsx:46`. (Canonical "Not available here" is `engineStatus.ts:383`, a different phrase.) | "Not available here" (engine label, same meaning for not-installed); "Not reported" |
| No result | 22 in 14 files | Canonical label `engineStatus.ts:389`. Non-canonical uses: `shared/expressionTabEvidence.ts:109,122,131`; `shared/splicingWorkspace.ts:62,69`; `shared/molecularWorkspace.ts:133,135,139`; `shared/mechanismWorkspace.ts:96,97,101,109`; `header/constraintMetrics.ts:486`; `shared/candidateScores.ts:138` | "Not reported", "No record", "No reading" for the same absent value |
| No reading | 14 in 9 files | `evidence/CandidateAlleles.tsx:14`; `evidence/ClinicalTab.tsx:257,588-589`; `inspector/EvidenceReadingInspector.tsx:19`; `inspector/SplicingReadingInspector.tsx:22`; `shared/candidateFrequencyEvidence.ts:82-83`; `shared/evidenceComparison.ts:70`; `shared/reportEvidenceBlocks.ts:34,47`; `report/exportPptx.ts:141` | "No result", "Not reported" |
| No record | 4 in 4 files | `evidence/ContextExplorer.tsx:117`; `shared/evidenceStageStatus.ts:18`; `evidence/CandidateAlleles.tsx:96`; `inspector/PopulationRail.tsx:186` ("0 — no record"); `shared/evidenceComparison.ts:71` ("No variant record returned") | "Not observed"; "Not reported" |
| Not observed | 4 in 4 files | `evidence/ClinicalTab.tsx:254`; `evidence/population/FrequencyScale.tsx:162`; `shared/evidenceComparison.ts:120` ("Not observed"); `shared/reportEvidenceBlocks.ts:99` | "No record" (gnomAD, same meaning) |
| Not counted | 15 in 11 files | `LiteratureView.tsx:174`; `insights/InsightsEvidenceMap.tsx:44`; `inspector/EnergeticsInspector.tsx:80`; `shared/deepModelEvidence.ts:89`; `shared/energeticsEvidence.ts:114`, `:572` (engine label for an excluded value); `shared/reportCaseBlocks.ts:101` (proposals); `shared/reportEvidenceBlocks.ts:31,110` | "Hidden" (engine skipped, `engineStatus.ts:391`); "Withheld" (criterion) |
| No data | 3 in 1 file | `header/constraintMetrics.ts:237,319,415` | "No result"; "Not reported" |
| Not applicable | 4 in 4 files | `inspector/EvidenceContextRail.tsx:34-35` ("Not applicable — gene not resolved", "Not applicable — no mouse ortholog"); `inspector/StructureInspector.tsx:74`; `shared/molecularWorkspace.ts:37` ("Not applicable") | "Not covered" (engine not-covered); "Not available here" |
| not-applicable (key) | 3 | `shared/interfaces/types.ts:47` (`ModelState`); `evidence/InterfacesTab.tsx:76`; `inspector/StructureInspector.tsx:74` (reading state) | key only; UI shows "Not applicable" or "Not modelled" |
| Not modelled | 15 in 12 files | `evidence/function/HotspotsView.tsx:227`; `evidence/interfaces/InterfaceOverview.tsx:18`; `evidence/interfaces/InterfaceTrack.tsx:177`; `evidence/interfaces/SolvedRows.tsx:80`; `shared/hotspotEvidence.ts:201`; `shared/interfaces/finding.ts:127` ("Not modelled"); `shared/interfaces/trace.ts:67`; `shared/interfaces/verdict.ts:96`; `shared/mechanismWorkspace.ts:62,64`; `shared/molecularWorkspace.ts:76` | Domain term for structure coverage (a residue no solved structure models). Not in any state set. |
| Not computed | 2 | `shared/hotspotEvidence.ts:426`; `shared/structure3dEvidence.ts:1217` | "Not run"; "No result" |
| Not run | 6 in 5 files | `telemetry/sidecarCard.ts:76`; `shared/interfaces/binding.ts:62`; `shared/interfaces/complexModel.ts:36`; `shared/interfaces/trace.ts:88,130`; `shared/workflowStatus.ts:58` | "Not computed"; "Not requested"; "Pending" |
| Not assessed | 1 (UI) | `inspector/PredictorsRail.tsx:202` (UI text); key `not-assessed` at `shared/functionEvidence.ts:113` (`Pm1Verdict`) and `evidence/function/FunctionTab.tsx:67` | "Not evaluated" (absent from app); "not recorded" |
| Pending | 83 hits in 27 files (strings) | `VariantSearchPanel.tsx:591` (UI text); `energetics/ProgressPanel.tsx:59,157`; key `pending` in `EvidenceAvailabilityState` (`evidenceAvailability.ts:62`) | canonical display label is "Running" (`engineStatus.ts:382`); `interfaces/format.ts:61` shows "Running" for pending |
| Running | 50 in 18 files | canonical label `engineStatus.ts:382`; uses as UI text: `evidence/PredictorsTab.tsx:195`, `evidence/SplicingTab.tsx:280`, `evidence/StructureTab.tsx:155,330`, `inspector/EvidenceContextRail.tsx:29`, `insights/InsightsEvidenceMap.tsx:42`, `inspector/EnergeticsRuleTrace.tsx:104`, `energetics/RetryThermompnn.tsx:125`, `VariantSearchPanel.tsx:590`, `shared/workflowStatus.ts:281`, `shared/jobsCopy.ts:91,220` | "Pending", "Checking", "Still being computed" (SplicingTab:264), "Searching PDB" (StructureInspector:196) |
| Checking | 19 in 11 files | canonical provider label `providerStatus.ts:39`; used for a data load in `evidence/GeneDiseaseTab.tsx:48` ("Checking ClinGen dosage curation…") and `shared/literatureEvidence.ts:529` | "Running" (engine); "Searching" |
| Searching | (phrase) | `inspector/StructureInspector.tsx:196,200` ("Searching PDB"; "Searching the PDB for entries…") | "Running"; "Checking" |
| Still being computed | (phrase) | `evidence/SplicingTab.tsx:264` | "Running" |
| is still loading / loading (phrases) | (phrase) | `LiteratureView.tsx:153` ("is still loading"); `inspector/StructureInspector.tsx:182` ("are loading"); `inspector/FunctionRail.tsx:112` ("Reading the hot-spot sources…") | "Running" |
| Unavailable | 16 in 9 files | UI text: `MasterSidebar.tsx:184`; `VariantSearchPanel.tsx:594`; `shared/narrativeResynthesis.ts:352`. State key in ≥6 unions: `residueShiftEvidence.ts:729-736` (`PocketStatus`), `structure3dEvidence.ts:161` (`ReferenceState`), `interfaces/types.ts:169` (`BindingState`), `curatedLiterature.ts:15`, `literatureSummary.ts:7`, `evidenceAvailability.ts:145` | "Provider error" (upstream-error); "Not configured"; "Not covered" |
| Withheld | 11 in 8 files | UI: `evidence/ClinicalTab.tsx:93`; `inspector/PopulationRail.tsx:222`; `evidence/function/HotspotsView.tsx:315`; `shared/molecularWorkspace.ts:54`; `shared/reportCaseBlocks.ts:100` | canonical criterion-state key `withheld` (`insightsEvidence.ts:133`) is the same word; the engine "Hidden" is the user-hidden state |
| Hidden | 9 in 4 files | canonical engine label for `skipped` (`engineStatus.ts:391`); also `engineStatus.ts:573` | **conflict**: `interfaces/format.ts:65` maps `skipped` to "Not covered" (`ENGINE_STATE_LABELS["not-covered"]`) |
| Not covered | 10 in 5 files | canonical engine label `engineStatus.ts:384`; `evidence/ExpressionModelsTab.tsx:69` | see the Hidden conflict above |
| Provider error | 11 in 8 files | canonical engine label `engineStatus.ts:386`; `shared/expressionTabEvidence.ts:106,122,131`; `evidence/function/HotspotsView.tsx:73`; `shared/hotspotEvidence.ts:142` | "Unavailable" (narrative); "Failed" |
| Failed | 101 in 32 files | canonical engine label `engineStatus.ts:387` (for a run that failed); UI text: `shared/narrativeFallback.ts:137`; `shared/reportEvidenceBlocks.ts:142`; `hooks/useApiConnections.ts:168`; `shared/jobsCopy.ts:95` | "Provider error" (for an upstream failure) |
| Degraded | 28 in 13 files | canonical provider label `providerStatus.ts:33`; UI: `components/console/consoleUtils.ts:49`; `components/DevConsolePanel.tsx:349,355`; `components/VariantSearchPanel.tsx:592` | none; the console is a separate surface |
| Unreachable | 3 | canonical provider label `providerStatus.ts:35` | "Provider error" (engine) for the same meaning |
| Not configured | 1 | canonical provider label `providerStatus.ts:37` | "Not available here" (engine label for the same `not-configured` key, `evidenceAvailability.ts:66-68`); see conflicts |
| Out of date | 1 | canonical provider label `providerStatus.ts:41` | none |
| Empty | 41 in 16 files | UI text in `shared/*`, e.g. `inspector/EvidenceContextRail.tsx`; no canonical word | "No result"; "No record" |
| Loading | 411 in 69 files (mostly identifiers) | no canonical label; UI text: `FunctionRail.tsx:112`, `StructureInspector.tsx:182`, `GeneDiseaseTab.tsx:48` | "Running"; "Checking" |

## 3. Same meaning, different words (absent value)

The one state "the source returned no value" has at least seven wordings across the app: "Not reported" (62 hits), "Not recorded" (8), "Not measured" (18), "Not available" (12), "No result" (22), "No reading" (14), "No record" (4), "Not observed" (4), "No data" (3). The canonical set has only "No result" (`engineStatus.ts:389`). The value in the table decides the word.

Where it matters most (same quantity, different words):

- ClinVar review status: "Not reported" in the Population tab (`ClinicalTab.tsx:668`) and "Not recorded" in the report (`reportDocument.ts:99`).
- gnomAD AF with no record: "No record" (`CandidateAlleles.tsx:96`), "Not observed" (`evidenceComparison.ts:120`), and "No variant record returned" (`evidenceComparison.ts:71`), each for the same case.
- Engine value excluded: "Not counted" (`energeticsEvidence.ts:114`) and "Hidden" (`engineStatus.ts:391`) for different cases, but the report (`reportCaseBlocks.ts:101`) uses "Not counted" for a proposal the engine cannot compute.

## 4. Same word, different meaning or different label

- **Skipped**: `engineStatus.ts:391` labels `skipped` "Hidden" (the user hid it). `interfaces/format.ts:65` labels `skipped` "Not covered" (the source did not cover it). Same key, two labels.
- **Not configured**: provider rail "Not configured" (`providerStatus.ts:37`); the evidence row for the same key "Not available here" (`engineStatus.ts:383`, via `evidenceAvailability.ts:66-68`).
- **Pending**: "Running" is the canonical label (`engineStatus.ts:382`) but "Pending" appears as UI text (`VariantSearchPanel.tsx:591`, `ProgressPanel.tsx:59,157`).
- **Criterion met/not met**: canonical `met`, `not met`, `withheld`, `not recorded` (`insightsEvidence.ts:133`). The report (`reportCaseBlocks.ts:100`) shows "Met", "Withheld", "Not met", "Not recorded" (title case). The insights table shows lowercase "not met" (`InsightsScreen.tsx:109`, `data-state="not met"`). The PM1 union uses hyphens: `not-met`, `withheld-cap`, `withheld-weighting`, `not-assessed` (`functionEvidence.ts:113`).
- **Key spelling**: `LoadState` uses `not-found` (`expressionTabEvidence.ts:29`) where the canonical no-result key is `no-result`. `PocketStatus` uses underscores (`none_detected`, `fallback_engine`; `residueShiftEvidence.ts:729-736`) where the others use hyphens.
- **Failed on the interfaces path**: `interfaces/format.ts:64` maps `failed` and `error` to "Provider error" (`ENGINE_STATE_LABELS["upstream-error"]`), not to "Failed" (`engineStatus.ts:387`). Unknown input falls to "No result" (`format.ts:66`).

## 5. Criterion codes used as text

`formatEvidenceCode` (`src/shared/thresholds/calibration.ts:142-144`) converts `PP3_Moderate` to "PP3 Moderate" and `VeryStrong` to "Very Strong". Places that do not use it, and type their own labels:

- `components/inspector/PredictorsRail.tsx:191`: "PP2 Moderate" / "PP2 Supporting" (literal).
- `shared/hotspotEvidence.ts:318` and `:328`: "PP2 Moderate" / "PP2 Supporting" (literal).
- `components/header/constraintMetrics.ts:430-432`: "PP2 Moderate band" / "PP2 Supporting band" (literal).
- `shared/reportCaseBlocks.ts:100-101`: criterion state words, not codes (see §4).

`formatEvidenceCode` is used in 4 more places than the list above (see `facts.csv`, criterion-label rows).

## 6. Not found

- "not evaluated": 0 hits in `src/components` and `src/shared` (also 0 in `src/hooks`).
- "not-evaluated" as a key: none.
- "Not found" as a UI string: 4 hits in 3 files, all code-level (not a state label).
