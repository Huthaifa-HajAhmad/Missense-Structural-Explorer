# Release Coherence Audit (2026-11-27)

Branch: `audit/release-coherence` (branched from `origin/main` `b740430e`, production image `oci-b740430e`).
Audit workspace: `doc/release-audit/`.

## 1. Scope and Coverage

To prepare Missense & Fold for multi-user production release, we audited the workspace in coherent cross-tab groups rather than one tab at a time:

| Group | Surfaces audited | Review file |
|---|---|---|
| (a) Population & gene | Population data, Gene–disease, Dosage | `doc/release-audit/review/group-a.md` |
| (b) Structure & mechanism | 3D structure, Residue shifts & pockets, Energetics, Interfaces & PPI, Functional domains, Hotspots, Landscape | `doc/release-audit/review/group-b.md` |
| (c) Expression & species | Expression, pext, Species & models | `doc/release-audit/review/group-c.md` |
| (d) Splicing & genome | RNA splicing, AlphaGenome | `doc/release-audit/review/group-d.md` |
| (e) Predictors | In-silico predictors | `doc/release-audit/review/group-e.md` |
| (f) Synthesis | Insights, Report, Comparison, Summary & notes | `doc/release-audit/review/group-f.md` |

### Panel capture vs. review coverage (kept separate)

- **Panel defined (`doc/release-audit/panel.json`)**: 14 variants — 6 regression variants (`UROD_G318R`, `ABCG1_G358R`, `SOD1_A5V`, `HBB_E7V`, `GBA1_N409S`, `TP53_R175H`) and 8 ClinGen VCEP expert-panel cases (`PAH_R261L`, `TP53_K132N`, `TP53_P295S`, `MYH7_R787H`, `PTEN_A79T`, `LDLR_T726I`, `GCK_R377H`, `BRCA2_N277K`).
- **Signed-in captures (`doc/release-audit/raw/`)**: all 14 variants captured against production image `oci-b740430e` in `AUTH_MODE=accounts` with zero 401 errors (12 `ok`, 2 harness timeouts at 720 s on `ABCG1_G358R` and `TP53_K132N` caused by `capture.mjs` waiting for an `"Evidence ... Complete"` label while population evidence was legitimately withheld for unresolved alleles — both final API streams returned HTTP 200; see `doc/release-audit/clingen/capture-diagnostics.md`).
- **Cross-tab fact matrix (`doc/release-audit/fact-matrix/README.md`)**: computed across all 14 captured variants (37 screens each).
- **ClinGen expert-panel comparison (`doc/release-audit/clingen/comparison.md`)**: all 8 VCEP variants compared against `raw/erepo/erepo.tsv` (snapshot 2026-11-27), with allele, condition, VCEP assertion link/dates, and verified per-criterion reasons recorded for all 17 non-agree rows. **Independently verified (PASSED)** by Codex 6.2 Astra in `doc/release-audit/review/advisor-rereview.md` (all 8 cases and 43 rows confirmed against `erepo.tsv` and captured streams; PTEN internal source caveat where the BS2 narrative also mentions BS1 is recorded).
- **Post-fix live browser, export, and accessibility replay**: completed locally against the fixed branch (`PORT=3917`, `AUTH_MODE=legacy`) across `TP53 p.Lys132Asn`, `NM_000546.6:c.396G>C`, `ABCG1 p.Gly358Arg` (all 4 export formats in default, edited, and excluded-classification modes), `TP53 p.Arg175His`, `SOD1 p.Ala5Val`, and `UROD 1-45015346-G-A` (`tests/proof/urod-population.e2e.ts`).

## 2. Root Causes Fixed Across the Workspace

Fixes were landed centrally against shared models and formatters rather than patched sentence-by-sentence, then reviewed independently across multiple passes by **Codex 6.2 Astra** (`doc/release-audit/review/advisor-codex.md`, `doc/release-audit/review/advisor-fixes-review.md`, `doc/release-audit/review/advisor-rereview.md`, and `doc/release-audit/review/advisor-final-signoff.md`).

### T1 / T5 — Run state, gaps, and export integrity
- **Three-state run status (`running` / `gaps` / `complete`)**: unified in `src/shared/insightsEvidence.ts` (`runStatusOf`) and threaded to navigation (`src/shared/workflowStatus.ts`), `InsightsScreen`, `ReportReviewStatus`, and all four report exports. Partial results lacking `ruleBasedInsights` now route through `insightsEvidenceFor` + `runStatusOf` (`degraded` with named gaps) instead of falling through to `complete` (`advisor-rereview.md` Finding #4). `useReportDocument` and `searchSlice` now include `isClinicalLoading` alongside `isBiophysicalLoading`.
- **Mandatory export completeness & gaps**: run status and named gaps are carried as mandatory document metadata (`reportModel.ts` / `reportDocument.ts`) and rendered in plain text, HTML, Word (`.docx`), and on the PowerPoint (`.pptx`) title slide itself — surviving edited or excluded classification sections. `ReportReviewStatus.tsx` also keeps named gaps visible even when an individual section (such as an outdated written summary) is flagged for review.
- **No premature settled verdicts**: Energetics hides median ΔΔG in navigation and rule trace while FoldX or another counting engine is running (`ev.provisional`); Protein function only reads `"Still running"` while a live fetch is in flight; unnamed running work uses a readable fallback instead of an empty list.
- **Stopped narrative requests**: distinguished from missing API keys (`NarrativeProvenanceRow.tsx`, `reportStatus.ts`).

### S1 / ClinVar scope, PS1 allele binding & summary alignment
- **Exact automated tier headline**: Insights and Report state the automated tier with counted criteria and strengths (no `"leans pathogenic"`).
- **Accurate ClinVar scope (`advisor-rereview.md` Finding #3)**: `RULE_ENGINE_SCOPE` / `TIER_SCOPE_SENTENCE` states that ClinVar clinical assertions are not counted as `PP5`/`BP6`, while noting ClinVar is checked for same-amino-acid `PS1` comparators, conservative weighting, and fallback allele frequency when gnomAD has no reading. Insights displays the ClinVar assertion separately with its condition and source beside the automated tier.
- **Owner-approved PS1 allele-binding & upgrade fix (`advisor-rereview.md` Findings #1–#2)**:
  - `server/services/external-api/clinvar.ts` requires a verified query nucleotide allele (`alleleCoordinate` or an explicit `c.` coding notation) before setting `hasOtherPathogenicVariantSameAA` (`PS1`).
  - Transcript-qualified DNA queries without a genomic coordinate (e.g., `NM_000546.6:c.396G>C`) now match by exact transcript version + coding notation (handling ClinVar's `(GENE)` title insertion), refuse index-0 fallback on no match, and require a verified matching versioned transcript accession (`NM_...\.v`) or distinct canonical SPDIs for `PS1` comparators.
  - Pre-upgrade cached PS1 is retired on upgrade: ClinVar external cache keys bumped `allele1` → `allele2` (`server/services/infra/cache-keys.ts`), and `recordsUnverifiedPs1` (`src/shared/clinvarPs1.ts`) invalidates pre-fix saved analyses in both `analysis-orchestrator.ts` and `storedAnalysis.ts`.
- **Shared formatters**: consolidated pLDDT (`src/shared/plddtFormat.ts`), population (`src/shared/populationFormat.ts`), edge (`src/shared/edgeFormat.ts`), and `criterionStateLabel` helpers across tabs, rails, and exports.

### S2 / B5 — Interfaces partner grouping, peptide separation & coverage integrity
- **One row per human partner protein**: merged multi-accession human partners (e.g., `HLA-A` across four UniProt accessions) with deduplicated PDB entry sets across `observed.ts`, `partnerRows.ts`, `finding.ts`, and `stored.ts` (`nativeInterfaceSupport`), eliminating headline-vs-row contradictions.
- **Separate `context: "peptide"` class**: short-peptide PDB entries (observed query span ≤ 30 aa on proteins ≥ 100 aa, e.g. TP53 peptides on MHC/HLA-A) are classified apart from native whole-protein interfaces (`fibril → crystal → peptide → native`) on server (`pdbe-interfaces.ts`, `multimer.ts`), excluded from native counts and DDMut-PPI wild types (`ppi.ts`), exposed in their own UI section and map layer (`InterfacesTab`, `InterfacesRail`, `mechanismWorkspace.ts`), and disclosed in Insights/Report Assembly summaries. Removed duplicate `"peptide"` support group in `InterfaceOverview.tsx` caught during live `TP53 p.Arg175His` replay.
- **Saved-cache & missing-coverage protection (`advisor-rereview.md` Finding #6)**: `peptideChecked: true` is now set and cached only when PDBe `unipdb` returns both the query length and observed ranges for every biological native entry (`pdbe-interfaces.ts`; `clearPdbeInterfaceCache()` also clears `pdbe-coverage`). Pre-split cached payloads (reproduced against saved `TP53_R175H`) and coverage-unverified responses are withheld from native counts (`isStaleAssembly`, `readObserved`), and `ppi.ts` refuses DDMut-PPI scoring (and Boltz-2 fallback) on solved interface entries lacking verified coverage.

### S3 / Energetics & pLDDT
- **Very-low AlphaFold confidence withholding**: when the stability template is AlphaFold and pLDDT is strictly `< 50` (pinned at `49.9` withheld, `50` and `50.1` not withheld using `STRUCTURE_COLOUR_BANDS.plddt`), the combined stability direction headline is withheld while individual estimates remain visible; threaded into Insights, Insights rail (`InsightsInspector` reuses `stabilityInputFor`), and Report.
- **SOD1 empty-method fix (B3)**, **moderate stability count in Insights (F17)**, **4-engine denominator** (ProtVar kept as cross-check only, B14), **kJ/mol unit threading** across Energetics, Packing, Interfaces, Report, and copy-as-text (B16).

### S4 / S5 / T6 / F9 / F14 — Predictors, PM1, Landscape, Population, Expression, Species, Splicing, Literature, Accessibility
- **ABCG1 mismatched-transcript regional O/E (T6)**: `withholdRegionalWhenRunDid` removes regional O/E intervals on both `LandscapeInspector` and `SequenceVisualizer` overview bars for `unverified-locus` and `transcript-mismatch`; fixed the React `"Maximum update depth exceeded"` retry loop in `SequenceVisualizer`.
- **Expert-panel PM1 propagation & unknown-state preservation (`advisor-rereview.md` Finding #5)**: `ExpertPm1Status` (`expertPm1StatusOf` in `hotspotEvidence.ts`) and `expertPm1Specified` are threaded to Function, Insights, Insights rail, Report (`useReportDocument`), copy-as-text (`searchSlice`), and navigation (`workflowStatus.ts`, `MasterSidebar.tsx`, `VariantSearchPanel.tsx`), keeping Protein function pending while CSpec loads and noting when CSpec is unavailable instead of flipping PM1 to `"not met"`.
- **Predictors & splicing**: TP53 general BayesDel bands vs. counted REVEL vs. uncomputed Align-GVGD kept distinct; `predictorUseLabel` unified across Predictors, Comparison, and Report; shared SpliceAI missing-DNA refusal string across Splicing and Insights.
- **Population & gene–disease**: UROD withheld `BS1` and `BS2` wording aligned across tab, rail, Insights, docs, and proof test; single `%` unit on allele-frequency chart ticks and axis title (A14); empty disease selection distinct from mismatch (A3); curated diseases listed on open (A4); ClinGen dosage unlisted `"No result"` distinct from scored-0 `"No evidence available"` (A18).
- **Expression & species**: `EvidenceContextRail` Reading step follows the open sub-tab (protein on Protein measurements, pext on Expression at variant, RNA only on RNA sub-tabs); HPA RNA card renamed `"Human Protein Atlas (RNA)"` (C3); duplicate disease-onset caveats removed (C5); Sampling & coverage duplicated controls removed (C9); mouse-screen mixed significance and unresolved phenotype counts separated cleanly (C1, C2).
- **Literature & WCAG AA contrast (F9, F14)**: curated-only Literature citations without quote-backed variant mention now display `"Curated variant citation · <provider>"` instead of `"Variant-anchored"` (`literatureScreening.ts`); added `--cs-btn-primary-bg: #A24E33` and `--cs-btn-primary-ink: #FFFFFF` tokens in `variables.css` and applied them to `.lit-btn` and `.rpt-btn[data-variant="primary"]` (measured **5.72:1** live).
- **AlphaGenome & configuration**: unified setup sentence (`Settings → Connections`) across client, `alphagenome-bridge.ts`, and `service-adapters.ts` (D6); updated default `PUBLIC_BASE_URL` to the Cloudflare Worker (`missense-resolve-edge.pedigreepro.workers.dev`) in `server/auth/config.ts`, `.env.example`, `README.md`, and `doc/ACCOUNTS.md`; updated stale docs (`LIMITATIONS.md`, `FEATURES.md`, `ARCHITECTURE.md`, `API.md`, `EVIDENCE_TABS_FULL_AUDIT.md`, `STATE_MACHINES.md`).

## 3. Remaining Follow-Ups (Tracked, Non-Blocking)

1. **ClinGen `TP53_P295S` & `PTEN_A79T` source-record ambiguities:**
   - In `raw/erepo/erepo.tsv`, `TP53 P295S` records `BP4` in the structured code column while its narrative describes `BP4_Moderate` twice; `PTEN A79T` mentions `BS1` inside its `BS2` narrative while omitting `BS1` from the structured met column. Both are preserved accurately in `doc/release-audit/clingen/comparison.md`.
2. **Condition/inheritance/version-matched expert-panel `PM1` storage:**
   - Currently `expertPm1Specified` checks whether any released specification for the gene defines a PM1 rule and reads from loaded hotspot context rather than storing a condition/inheritance/version-matched applicability record in the core run payload. Follow-up: persist condition-matched PM1 rule metadata on the core run payload.
3. **Bulk doc archiving (`doc/release-audit/staleness/archive-list.txt`, 53 files):**
   - Deferred to a dedicated cleanup commit/PR so this release-coherence code diff remains clean and reviewable.

## 4. Verification Summary

### Static, unit, and integration suite
- `npm run map`: up to date (`doc/code-map/*.csv`).
- `npm run lint` (`check-boundaries`, `check-focus-indicators`, `check-verify-parity`, `code-map --check`, type-aware Oxlint across 1,586 files, `tsc --noEmit`): **0 warnings, 0 errors**.
- `npx vitest run`: full suite verified across **598 test files (596 active + 2 skipped)**, **7,506+ tests**, with all re-review regression suites (`clinvar-allele.test.ts` incl. populated `allele1` SQLite upgrade check, `clinvarPs1.test.ts`, `pdbe-interfaces.test.ts`, `ppi.test.ts`, `workflowStatus*.test.ts`, `ReportReviewStatus.test.tsx`, `InterfacesTab.test.tsx`, `LiteratureView.test.tsx`, `surfaceRamp.test.ts`, `MasterSidebar.test.tsx`, `VariantSearchPanel.pipeline.test.tsx`) passing after the final edits.

### Live browser, export, and accessibility replay (`PORT=3917`, `AUTH_MODE=legacy`)
- `npx e2e run tests/smoke.e2e.ts tests/chip-contrast.e2e.ts`: **3/3 passed** (app shell renders; all status chip tones ≥ 4.5:1 AA contrast in light and dark themes; dashed chips preserve ink).
- `E2E_PROOF=1 npx e2e run tests/proof/urod-population.e2e.ts`: **1/1 passed** (`UROD 1-45015346-G-A`: `No criterion`, `BS1 is not applied`, `1.62%` FAF95, aligned-ortholog text on Species & models).
- Live Release Gate replay (`TP53 p.Lys132Asn`, `NM_000546.6:c.396G>C`, `ABCG1 p.Gly358Arg`, `TP53 p.Arg175His`, `SOD1 p.Ala5Val`):
  - **`TP53 p.Lys132Asn` (protein-only)**: `VUS` — **`PS1` withheld**; ClinVar (`634773`) shown separately with `"Not counted as PP5/BP6"`.
  - **`NM_000546.6:c.396G>C` (verified coding allele)**: bound exact **ClinVar `376624` (`Pathogenic`, `Li-Fraumeni syndrome`)**; `"Automated tier: likely pathogenic. Counted: PS1 Strong, PP3 Moderate, PM2 Supporting."`
  - **`ABCG1 p.Gly358Arg`**: Landscape `0` update-depth errors & regional O/E withheld; Energetics withholds stability headline at `pLDDT 27.2`; Report nav & Review status rail both surface all 5 named gaps (`Population`, `Splicing`, `Genome-wide scores`, `PM2`, `BP4`); Download button contrast **5.72:1**; all 4 export formats (`.txt`, `.html`, `.docx`, `.pptx` Slide 1) preserve mandatory completeness and named gaps across **default**, **edited classification**, and **excluded classification** modes.
  - **`TP53 p.Arg175His`**: zero React console errors; Interfaces separates peptide-only structures from native counts (`2 of 83` homodimer structures); Function/Insights/Report align on PM1; Insights separates automated tier from ClinVar; Gene–disease lists curated diseases on open without false mismatch; Literature shows `"Curated variant citation"` (zero `"Variant-anchored"` on curated-only rows) and **5.72:1** `"Search Europe PMC"` button contrast; `.inspector-body` has `tabindex="0"`.
  - **`SOD1 p.Ala5Val`**: Energetics has no empty running-method list; Interfaces separates amyloid fibrils (`0 of 115` native solved structures).

## 5. Pre-Release Gate Status

| Gate | Status | Notes |
|---|---|---|
| 1. PS1 live replay (`TP53 p.Lys132Asn` vs `NM_000546.6:c.396G>C`) | **PASSED (local live)** | Verified live against NCBI ClinVar; re-verify once deployed to prod if desired. |
| 2. Live browser & 4-format export replay (`ABCG1`, `TP53`, `SOD1`, `UROD`, empty disease) | **PASSED (local live)** | All 4 formats verified in default, edited, and excluded-classification modes; 2 UI bugs caught & fixed during replay. |
| 3. Independent ClinGen comparison review (`comparison.md`) | **PASSED** | Independently signed off by Codex 6.2 Astra (`advisor-rereview.md`). |
| 4. Independent code sign-off (`advisor-final-signoff.md`) | **CLEAR FOR MERGE** | Codex 6.2 Astra cleared all 6 re-review blockers (#1–#6). |
| 5. Audit VM cleanup (`coherence-audit` on `92.5.173.166`) | **DONE** | Removed container `coherence-audit` and `/home/ubuntu/coherence-audit` (`missense-resolve-blue` remains healthy). |
| 6. Independent human review & live Worker smoke check | **OPEN (human)** | Teammate visual inspection of exported `.docx`/`.pptx`/`.html`/`.txt` files + live Worker invite/reset link smoke test after deploy. |
