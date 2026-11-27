# Docs reconciliation (Task B)

Scope: the 124 top-level `doc/*.md` files, plus the root README and the four overview docs. Method: `scripts/docs_extract.py` reads each doc's first date, its last git commit date, its title, and every backticked path and identifier; it checks paths against the git file list and identifiers (exact-case, whole word) against every word in `src/` and `server/`. Missing items are counted, not all proven gone: some are runtime files (`data/`, FoldX binaries, `deploy/.env.oci`), some are doc-side typos, some are line-numbered paths (`file.ts:123`) that the check reads as missing. Decisions come from reading each doc's status block (`scripts/docs_build.py`).

Counts: **52 KEEP**, **19 MERGE**, **53 ARCHIVE**. The task said about 90 docs; there are 124 top-level files.

Subfolders (listed, not reviewed in depth): `doc/code-map/` (generated tables; `external-apis.csv` lists the DuckDNS hosts), `doc/compute-benchmark/` (1 JSON), `doc/data/` (3 StabilityOracle CSVs), `doc/energetics-release/` (7 release docs, no retired names found), `doc/research/` (8 research files, two of them are revisions of current proposals), `doc/release-audit/` (this audit).

## Recommendation per area

### Population

Newest: GNOMAD_CONSTRAINT (pinned data, current). The tab's own audit is EVIDENCE_TABS_FULL_AUDIT (10-27), which replaces the four 10-09 to 10-16 Population reviews.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| GNOMAD_CONSTRAINT.md | 2026-10-29 (git) | KEEP | none | Current reference for the pinned gnomAD snapshot; no missing refs. |
| POPULATION_FREQUENCIES_REVIEW.md | 9 October 2026 | ARCHIVE | 0 paths, 4 identifiers | Bound to revision 1a61b2f; superseded by EVIDENCE_TABS_FULL_AUDIT (10-27), which audits the Population tab end to end. |
| POPULATION_UX_POLISH_REVIEW.md | 15 October 2026 | ARCHIVE | none | Superseded by EVIDENCE_TABS_FULL_AUDIT (10-27). |
| POPULATION_VISUALIZATION_BATCH_REVIEW.md | 14 October 2026 | ARCHIVE | none | Superseded by EVIDENCE_TOPIC_VIEWS_REVIEW (10-16) and EVIDENCE_TABS_FULL_AUDIT (10-27). |
| POST_REVIEW_FINDINGS_FIXES.md | 16 October 2026 | ARCHIVE | none | Follow-up to the 10-09 multi-dimensional review; findings resolved and recorded in later audits. |

### Gene–disease

Newest and authoritative: GENE_DISEASE_REFERENCE_REVIEW (11-27). GENE_DISEASE_PROPOSAL (Rev 4) is the design record. The five 10-06 to 10-16 reviews are superseded.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| GENE_DISEASE_DOSAGE_RECOVERY_REVIEW.md | 16 October 2026 | ARCHIVE | 1 paths, 0 identifiers | Superseded by GENE_DISEASE_REFERENCE_REVIEW (11-27); cites admission.test.ts at a line number. |
| GENE_DISEASE_EXTERNAL_AUDIT.md | 2026-10-06 | ARCHIVE | 2 paths, 2 identifiers | Audit of Rev 2.1 proposals; its findings are folded into Rev 4 and EXPRESSION Rev 6. |
| GENE_DISEASE_PROPOSAL.md | 2026-10-06 | KEEP | none | Design record (Rev 4, implemented); companion of EXPRESSION_AND_MODELS_PROPOSAL. |
| GENE_DISEASE_REFERENCE_REVIEW.md | 27 November 2026 | KEEP | none | Newest Gene–disease review (11-27); authoritative for validity classes and the Reference panel. |
| GENE_DISEASE_REVIEW.md | 2026-10-07 | ARCHIVE | 0 paths, 1 identifiers | Superseded by GENE_DISEASE_REFERENCE_REVIEW (11-27). Missing identifier DosageSensitivityCard. |
| GENE_DISEASE_SENIOR_CODE_REVIEW.md | 16 October 2026 | ARCHIVE | none | Subagent code review (10-16); superseded by GENE_DISEASE_REFERENCE_REVIEW. Contains a local file:/// link. |
| GENE_DISEASE_UX_POLISH_REVIEW.md | 16 October 2026 | ARCHIVE | none | Says it supersedes the earlier pill navigation; superseded by GENE_DISEASE_REFERENCE_REVIEW. No H1 title. |

### Expression

Newest: EXPRESSION_POLISH_REVIEW (11-04). Design authority: EXPRESSION_AND_MODELS_PROPOSAL (Rev 6, 10-07). The 10-06 to 11-01 reviews are superseded; TISSUE_EXPRESSION_PROPOSAL declares itself superseded.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| CONTEXT_WORKSPACES_REVIEW.md | 10 October 2026 | ARCHIVE | 1 paths, 1 identifiers | Covers Gene–disease, Expression and Species in one pass (10-10); superseded per area. Cites the removed perturbationReadings. |
| EXPRESSION_AND_MODELS_PROPOSAL.md | 2026-10-07 | KEEP | none | Rev 6 is the implementation authority for Expression and Species; supersedes TISSUE_EXPRESSION_PROPOSAL. |
| EXPRESSION_MODELS_EXTERNAL_AUDIT.md | 2026-10-06 | ARCHIVE | 1 paths, 9 identifiers | Audit of Rev 2.1 proposals (10-06); findings folded into Rev 6. Missing pext.py (a script name). |
| EXPRESSION_MODELS_TAB_REVIEW.md | 2026-10-07 | ARCHIVE | none | Rebuild record (10-07); superseded by EXPRESSION_POLISH_REVIEW (11-04). |
| EXPRESSION_POLISH_REVIEW.md | 2026-11-04 | KEEP | none | Newest Expression review (11-04); the reference for the current pext/source-tab presentation. |
| EXPRESSION_UI_REVIEW.md | 2026-11-01 (git) | ARCHIVE | 0 paths, 1 identifiers | Superseded by EXPRESSION_POLISH_REVIEW (11-04). |
| EXPRESSION_UX_POLISH_REVIEW.md | 16 October 2026 | ARCHIVE | none | Superseded by EXPRESSION_POLISH_REVIEW (11-04). |
| TISSUE_EXPRESSION_PROPOSAL.md | 2026-10-05 | ARCHIVE | 6 paths, 0 identifiers | Self-declared superseded (10-05) and kept as the v1 research appendix. |

### Species

Newest and authoritative: SPECIES_MODELS_TAB_REVIEW (11-27). It has no missing code references. SPECIES_POLISH_REVIEW (11-04) is folded into it.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| SPECIES_MODELS_TAB_REVIEW.md | 10 October 2026 | KEEP | none | Newest Species review (11-27); authoritative for the Species & models tab. |
| SPECIES_POLISH_REVIEW.md | 2026-11-04 (git) | MERGE INTO SPECIES_MODELS_TAB_REVIEW | none | Short presentation pass (11-04); its facts belong with the current Species review. |

### Functional domains

Tab audit: FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT (10-04). Hotspots: FUNCTIONAL_HOTSPOTS_PLAN and HOTSPOT_3D_DECISION (both 10-28). The 09-25 and 09-29 reviews are superseded.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT.md | 2026-10-04 | KEEP | 1 paths, 1 identifiers | Newest Functional-domains audit (10-04). Missing variantDensity and a constraintMetrics line ref. |
| FUNCTIONAL_DOMAINS_TAB_AUDIT.md | 2026-09-25 (git) | ARCHIVE | 12 paths, 23 identifiers | Oldest Functional-domains audit (09-25); superseded. Cites FeaturePaletteLegend.tsx, ResidueEnvironmentPanel.tsx and featurePalette.ts, which are gone. |
| FUNCTIONAL_DOMAINS_TAB_REVIEW.md | 2026-09-29 | ARCHIVE | 3 paths, 2 identifiers | Superseded by FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT. Missing domainRowKey and FeaturePalette files. |
| FUNCTIONAL_HOTSPOTS_PLAN.md | 2026-10-28 | KEEP | 2 paths, 0 identifiers | Build record for the Hotspots subtab (10-28, updated 11-26). Two line-number refs need checking. |
| HOTSPOT_3D_DECISION.md | 2026-10-28 | KEEP | none | Decision record: 3D proximity is a non-voting suggestion. |

### Predictors

Newest and authoritative: PRIMARY_PREDICTOR_DECISION (11-24), with the two release notes (11-23, 11-24) and PROTEIN_LANGUAGE_MODELS_DECISION (11-18). The 09-29, 10-29 and 11-01 reviews are superseded. LOCAL_DBNSFP_UPGRADE conflicts with the settled VM-only store.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| CALIBRATED_STACKING.md | 2026-09-29 (git) | ARCHIVE | 3 paths, 0 identifiers | Self-declared retired page. |
| IN_SILICO_PRUNING_PLAN.md | 2026-11-24 | KEEP | 6 paths, 3 identifiers | Live plan (11-24); Phase 6 still open. Merge into PRIMARY_PREDICTOR_DECISION when closed. |
| LOCAL_DBNSFP_UPGRADE.md | 2026-07-22 (git) | MERGE INTO ARCHITECTURE | 1 paths, 0 identifiers | Old strategy (07-22). Says local dbNSFP is deferred, which conflicts with the settled VM-only store; keep only the storage facts. |
| PREDICTORS_AVAILABILITY_REVIEW.md | 29 October 2026 | ARCHIVE | none | One-off provider check (10-29); the popEVE rule now sits in RELEASE_NOTE_PREDICTOR_SCALE_FIXES. |
| PREDICTORS_INFORMATIONAL_UI_REVIEW.md | 1 November 2026 | ARCHIVE | 0 paths, 2 identifiers | Superseded by PRIMARY_PREDICTOR_DECISION and the release notes. Cites preferenceCaveat and preferenceSummary, which no longer exist. |
| PREDICTORS_TAB_REVIEW.md | 28 September 2026 | ARCHIVE | 1 paths, 2 identifiers | Self-declared historical baseline (09-28); superseded by the 11-24 decision. |
| PRIMARY_PREDICTOR_DECISION.md | 2026-11-24 | KEEP | 3 paths, 0 identifiers | Authoritative PP3/BP4 policy (11-24). |
| PROTEIN_LANGUAGE_MODELS_DECISION.md | 2026-11-18 | KEEP | 2 paths, 0 identifiers | Retirement record for the runtime protein language models (11-18). Tests cite it. |
| RELEASE_NOTE_PREDICTOR_SCALE_FIXES.md | 2026-11-23 (git) | KEEP | none | Release note: popEVE leaves the vote (11-23). |
| RELEASE_NOTE_PRIMARY_PREDICTOR.md | 2026-11-24 | KEEP | none | Release note for the policy above (11-24). |
| THRESHOLDS_TAB_REVIEW.md | 29 September 2026 | KEEP | 1 paths, 1 identifiers | Only review of the Score thresholds tab (09-29, after the 09-28 review it replaces). Its isPp2Constrained spelling does not match the code (isPP2Constrained). |

### AlphaGenome

Newest and authoritative: ALPHAGENOME_UI_REVIEW (11-01). ALPHAGENOME_TAB_REVIEW (09-28) and the 09-14 RCA are superseded; both cite the removed Perturbation and DynaMut2 code.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT.md | 2026-09-14 | ARCHIVE | 19 paths, 7 identifiers | Oldest AlphaGenome RCA (09-23). Cites PerturbationTab.tsx and DynaMut2/DDMut statuses, both gone. |
| ALPHAGENOME_TAB_REVIEW.md | 28 September 2026 | ARCHIVE | none | Superseded by ALPHAGENOME_UI_REVIEW (11-01). |
| ALPHAGENOME_UI_REVIEW.md | 2026-11-01 (git) | KEEP | none | Newest AlphaGenome record (11-01). |

### Splicing

Newest and authoritative: SPLICING_TAB_REVIEW (11-24). SPLICING_WORKSPACE_REVIEW, SPLICING_LAYOUT_REVIEW and the splicing half of MECHANISM_WORKSPACES_REVIEW are superseded. UNMAPPING_DEFECT_SPLICE_AUDIT is a closed RCA.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| MECHANISM_WORKSPACES_REVIEW.md | 11 October 2026 | ARCHIVE | none | Second pass for Splicing and Interfaces (10-11); superseded per area by SPLICING_TAB_REVIEW and INTERFACES_PPI_AUDIT_2026-11-26. |
| SPLICING_LAYOUT_REVIEW.md | 2026-10-29 (git) | MERGE INTO SPLICING_TAB_REVIEW | none | Layout correction (10-29); fold into the splicing review. |
| SPLICING_TAB_REVIEW.md | 28 September 2026 | KEEP | 1 paths, 0 identifiers | Newest Splicing audit (11-24). Missing splicingTab.schematic.test.tsx ref; check the test's name. |
| SPLICING_WORKSPACE_REVIEW.md | 2026-10-11 | ARCHIVE | none | Superseded by SPLICING_TAB_REVIEW (11-24). |
| UNMAPPING_DEFECT_SPLICE_AUDIT.md | 2026-09-19 | ARCHIVE | 6 paths, 7 identifiers | RCA of the ACOT9 unmapped-splice bug (09-23); historical. Cites removed identifiers. |

### Residue shifts / Structure

Newest: STRUCTURE3D_TAB_REVIEW_2026-11-05 (3D), VERIFIED_RESIDUE_DESIGN (11-24, in progress), RESIDUE_SHIFTS_REVIEW (updated 10-29). The Perturbation documents (PERTURBATION_REVIEW, STRUCTURAL_PERTURBATION_RESOLUTION, MOLECULAR_WORKSPACES_REVIEW) describe a retired tab. Several cite esm3_forge.ts, esmfold.ts and PerturbationTab.tsx, which are gone.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| DENOVO_FOLD_NOTICE_RCA.md | 2026-11-21 | MERGE INTO ARCHITECTURE | 9 paths, 7 identifiers | Implemented notice (11-21). Cites server/services/structure/esmfold.ts, which is gone; keep the behaviour, drop the file refs. |
| MOLECULAR_WORKSPACES_REVIEW.md | 2026-10-10 | ARCHIVE | 1 paths, 1 identifiers | Describes the Perturbation workspace as live (10-10). Its Perturbation half is retired. |
| PERTURBATION_REVIEW.md | 2026-09-29 | ARCHIVE | 14 paths, 8 identifiers | Retired Structural perturbation tab (09-29); cites removed esm2/esm3/esmc files. |
| RESIDUE_SHIFTS_REVIEW.md | 2026-09-29 | KEEP | 0 paths, 1 identifiers | Latest Residue Shifts & Pockets review (updated 10-29). Missing PropertyScaleReference identifier; fix. |
| RESIDUE_SHIFT_REVIEW_RESOLUTION.md | 2026-09-25 (git) | ARCHIVE | 8 paths, 4 identifiers | Resolution record (09-25) for an earlier review; 37 of its identifiers no longer exist. |
| STRUCTURAL_PERTURBATION_RESOLUTION.md | 2026-10-29 | MERGE INTO PROTEIN_LANGUAGE_MODELS_DECISION | 2 paths, 8 identifiers | Provider decision record (10-29 to 11-18); fold the decision into the retirement record, then archive. |
| STRUCTURE3D_TAB_REVIEW_2026-11-05.md | 2026-11-05 | KEEP | 28 paths, 2 identifiers | Newest 3D Structure review (11-05, status 11-08). |
| STRUCTURE_3D_REVIEW.md | 29 September 2026 | ARCHIVE | 3 paths, 12 identifiers | Superseded by STRUCTURE3D_TAB_REVIEW_2026-11-05. Cites esm3_forge.ts and esmfold files that were removed. |
| VERIFIED_RESIDUE_DESIGN.md | 2026-11-24 | KEEP | 0 paths, 3 identifiers | Approved design (11-24), in progress. |

### Interfaces

Newest and authoritative: INTERFACES_PPI_AUDIT_2026-11-26 and PDB_RESIDUE_COVERAGE_AUDIT (11-26). INTERFACES_PPI_REVIEW (10-04) is folded in. INTERACTIONS_TAB_REVIEW and MULTIMER_TAB_REVIEW say they are superseded because their tabs were merged; the pre-merge audit INTERFACES_AUDIT is too.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| INTERACTIONS_TAB_REVIEW.md | 2026-10-03 (git) | ARCHIVE | 1 paths, 1 identifiers | Self-declared superseded; the tab no longer exists. |
| INTERFACES_AUDIT.md | 2026-10-02 | ARCHIVE | 2 paths, 3 identifiers | Pre-merge audit (10-02); the tabs it audits were merged. Missing interactionsEvidence.ts and multimerEvidence.ts. |
| INTERFACES_PPI_AUDIT_2026-11-26.md | 2026-11-26 | KEEP | 2 paths, 3 identifiers | Newest Interfaces & PPI audit (11-26). Missing app.js and partners.ts refs; check. |
| INTERFACES_PPI_REVIEW.md | 2026-10-04 | ARCHIVE | none | SOD1 audit (10-04); superseded by the ABCG1 audit (11-26). |
| MULTIMER_TAB_REVIEW.md | 2026-10-03 (git) | ARCHIVE | none | Self-declared superseded; the tab no longer exists. |
| PDB_RESIDUE_COVERAGE_AUDIT.md | 2026-11-26 | KEEP | 15 paths, 0 identifiers | Newest PDB coverage audit (11-26); covers the counts outside Interfaces. |
| multimer_modeling_proposal.md | 2026-08-14 (git) | MERGE INTO FUTURE_WORK | 1 paths, 1 identifiers | Quaternary-modelling design (08-14) is future work; cites a retired sidecar router. |

### Energetics

Newest and authoritative: ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN (11-03), with FOLDX_LOCAL_SHELL_BENCH_2026-11-02 and RELEASE_NOTE_FOLDX_REPAIR_MODE (11-05). StabilityOracle docs (11-05, 11-24) are open research. The 10-04 to 10-27 audits are superseded.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| ENERGETICS_AUDIT_AND_PLAN.md | 2026-10-04 | ARCHIVE | 25 paths, 28 identifiers | Oldest Energetics audit (10-04); superseded by the 11-03 plan. Title has a mojibake encoding error. |
| ENERGETICS_LANDSCAPE_AUDIT_2026-10-27.md | 2026-10-27 | ARCHIVE | 1 paths, 1 identifiers | Superseded by the 11-03 plan; the Landscape items are in LANDSCAPE_UI_REVIEW. |
| ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN.md | 2026-11-03 | KEEP | 2 paths, 1 identifiers | Current Energetics plan (v2, 11-03). Missing EnergeticsVerdictCard.tsx and tools/foldx refs; fix. |
| ENERGETICS_TAB_REVIEW.md | 2026-10-16 (git) | ARCHIVE | 7 paths, 2 identifiers | Superseded by the 11-03 plan and FOLDX_LOCAL_SHELL_BENCH_2026-11-02. |
| ENERGETICS_VISUALIZATION_REVIEW.md | 9 October 2026 | ARCHIVE | none | Visual review (10-09); superseded by later Energetics records. |
| FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md | 2026-11-02 | KEEP | 2 paths, 3 identifiers | Benchmark record behind FoldX repair mode (11-05). |
| FOLDX_REPAIR_RCA_2026-10-29.md | 29 October 2026 | MERGE INTO ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN | none | RCA (10-29); its outcome belongs in the plan. |
| RASP_DATA.md | 2026-09-29 (git) | KEEP | 2 paths, 0 identifiers | Data reference for the RaSP lookup; the sqlite file is a runtime file, not in the repo. |
| RELEASE_NOTE_FOLDX_REPAIR_MODE.md | 2026-11-05 (git) | KEEP | none | Release note for repair mode and cache v5 (11-05). |
| STABILITY_ORACLE_COMPARISON_PROTOCOL.md | 2026-11-24 | KEEP | 1 paths, 0 identifiers | Pre-registered protocol (11-24); open decision. |
| STABILITY_ORACLE_INPUTS_RESEARCH.md | 2026-11-05 | KEEP | 1 paths, 0 identifiers | Input-rebuild research record (11-05). |

### Landscape

Newest: LANDSCAPE_UI_REVIEW (11-01) and EXPLORATION_WORKSPACE (11-24). RESIDUE_TOLERANCE_DECISION (10-26) is the rejection record for residue-level tolerance scores. LANDSCAPE_TAB_AUDIT (10-15) is superseded.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| EXPLORATION_WORKSPACE.md | 2026-11-24 (git) | KEEP | none | Current shared Landscape and 3D layout (11-24). |
| LANDSCAPE_TAB_AUDIT.md | 29 September 2026 | ARCHIVE | 5 paths, 11 identifiers | Audit and redesign proposal (10-15); superseded by LANDSCAPE_UI_REVIEW (11-01). |
| LANDSCAPE_UI_REVIEW.md | 1 November 2026 | KEEP | 1 paths, 1 identifiers | Newest Landscape review (11-01). Missing ExplorationWorkspace and RetryDynamut2.test.tsx refs; fix. |
| RESIDUE_TOLERANCE_DECISION.md | 2026-10-26 | KEEP | 5 paths, 0 identifiers | Rejection record for MetaDome, MTR3D-AF2, CCR and in-house tolerance (10-26). The fixed-plan files it cites live outside the repo. |

### Literature

Authoritative status record: LITERATURE_SCREENING_PROPOSAL (10-04, updated 10-05). The screening review and UI plan are folded into it. The 10-06 to 10-11 Literature reviews are superseded by SYNTHESIS_WORKSPACES_REVIEW (10-18).

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| LITERATURE_SCREENING_PROPOSAL.md | 2026-10-04 | KEEP | 8 paths, 0 identifiers | Design and status record for the screening roadmap (10-04, updated 10-05). |
| LITERATURE_SCREENING_REVIEW.md | 2026-10-05 | MERGE INTO LITERATURE_SCREENING_PROPOSAL | 1 paths, 1 identifiers | Phase review (10-05) whose status belongs in the proposal. |
| LITERATURE_SCREENING_UI_PLAN.md | 2026-10-05 | MERGE INTO LITERATURE_SCREENING_PROPOSAL | none | Companion UI plan (10-05); implemented, so fold the status into the proposal. |
| LITERATURE_TAB_REVIEW.md | 2026-10-11 | MERGE INTO SYNTHESIS_WORKSPACES_REVIEW | none | Points to the 10-11 pass; the 10-18 synthesis review is newer. |
| LITERATURE_UPGRADE_PLAN.md | 2026-10-06 | ARCHIVE | none | Owner decisions of 10-06 for disease and phenotype context; the Gene–disease proposal covers the same ground. |
| QUERY_SYNTHESIS_FINISHING_PASS.md | 2026-10-11 | MERGE INTO SYNTHESIS_WORKSPACES_REVIEW | 6 paths, 0 identifiers | Bounded pass (10-11); its facts belong with the synthesis review. |
| QUERY_SYNTHESIS_REVIEW_RESOLUTION.md | 2026-10-12 | MERGE INTO SYNTHESIS_WORKSPACES_REVIEW | none | Resolution record (10-12) for the 10-11 review. |
| REVIEW_WORKSPACES_REVIEW.md | 2026-10-11 | ARCHIVE | none | Superseded by SYNTHESIS_WORKSPACES_REVIEW (10-18). |
| REVIEW_WORKSPACES_SENIOR_CODE_REVIEW.md | 2026-10-11 | ARCHIVE | 12 paths, 0 identifiers | Its four findings were handled in QUERY_SYNTHESIS_REVIEW_RESOLUTION (10-12). |

### Report

Newest and authoritative: SYNTHESIS_WORKSPACES_REVIEW (10-18), which covers Insights, Literature and Report. REPORT_TAB_REVIEW, INSIGHTS_TAB_REVIEW and the two Query/synthesis passes are folded in or superseded.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| INSIGHTS_TAB_REVIEW.md | 2026-10-11 | ARCHIVE | none | Superseded by SYNTHESIS_WORKSPACES_REVIEW (10-18). |
| REPORT_TAB_REVIEW.md | 7 October 2026 | MERGE INTO SYNTHESIS_WORKSPACES_REVIEW | none | Report-tab review (10-07/08); the 10-18 synthesis review covers Report. |
| SYNTHESIS_WORKSPACES_REVIEW.md | 18 October 2026 | KEEP | none | Newest review of Insights, Literature and Report ownership (10-18, touched 11-24). |

### workspace-wide

Reference docs to keep: README (index), PRD, FEATURES, LIMITATIONS, ARCHITECTURE, API, FUTURE_WORK, STATE_MACHINES (infra), TRANSLATIONAL_PHILOSOPHY and TRANSLATIONAL_COVERAGE, VISUALIZATION_SYSTEM, WORKSPACE_REDESIGN, EVIDENCE_TABS_FULL_AUDIT, EVIDENCE_CONTEXT_BASELINE_FIX. Most of the 2026-09 and 10-06 to 10-16 audits are superseded.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| API.md | 2026-11-24 (git) | KEEP | none | API reference (11-24). Fix the SaProt engine readiness row (line 435). |
| ARCHITECTURE.md | 2026-11-23 (git) | KEEP | 3 paths, 0 identifiers | Architecture. Fix line 159 (ESM sidecars racing a 2.5 s deadline). Missing data/ and template refs are runtime or placeholders. |
| CHARTING_AND_VISUALIZATION_PLAN.md | 13 October 2026 | ARCHIVE | 5 paths, 6 identifiers | Charting plan (10-04/10-13); cites a missing CHARTING_INVENTORY.md and a removed perturbation folder. |
| CONTEXT_MOLECULAR_VISUALIZATION_REVIEW.md | 14 October 2026 | MERGE INTO VISUALIZATION_SYSTEM | none | Figure presentation review (10-14); fold into the visual system doc. |
| EVIDENCE_CONTEXT_BASELINE_FIX.md | 2026-10-06 | KEEP | none | Latest Evidence-context record (10-06); supersedes the implementation audit. |
| EVIDENCE_CONTEXT_IMPLEMENTATION_AUDIT.md | 2026-10-06 | ARCHIVE | none | Its own text says the baseline audit supersedes its auth and export decisions. |
| EVIDENCE_CONTEXT_REVIEW.md | 2026-10-06 | MERGE INTO EVIDENCE_CONTEXT_BASELINE_FIX | 4 paths, 0 identifiers | Implementation record (10-06); fold its live facts into the baseline record. |
| EVIDENCE_TABS_FULL_AUDIT.md | 2026-10-27 | KEEP | 0 paths, 2 identifiers | Newest audit across all Evidence tabs (10-27). Missing ContextualCoverage and humaniseAnyRefusal; check. |
| EVIDENCE_TOPIC_VIEWS_REVIEW.md | 16 October 2026 | ARCHIVE | none | Superseded by EVIDENCE_TABS_FULL_AUDIT (10-27). |
| EVIDENCE_WORKSPACE_REVIEW.md | 9 October 2026 | ARCHIVE | none | Superseded by EVIDENCE_TOPIC_VIEWS_REVIEW and EVIDENCE_TABS_FULL_AUDIT. |
| FEATURES.md | 2026-11-24 (git) | KEEP | 1 paths, 0 identifiers | User feature catalogue. Fix section 9 and the ESM3 colouring lines (retired 11-18). |
| FUTURE_WORK.md | 2026-11-24 (git) | KEEP | 0 paths, 4 identifiers | Roadmap. Remove the Perturbation Tab and ESM items (lines 42, 54, 92, 96); absorb the multimer proposal. |
| INDEPENDENT_AUDIT_RESPONSE.md | 2026-09-30 | ARCHIVE | 1 paths, 2 identifiers | Answer to the 09-30 external audit; cites INDEPENDENT_AUDIT_REPORT.md, which is not in the repo. |
| INSPECTOR_UI_UX_AUDIT.md | 2026-09-27 (git) | ARCHIVE | 4 paths, 7 identifiers | Oldest inspector audit (09-27); 33 missing paths and 39 missing identifiers. |
| LIMITATIONS.md | 2026-11-24 | KEEP | 2 paths, 0 identifiers | Limits. Fix section 8 (local VESM-150M sidecar guard). PP2 and PP3 text is current. |
| PRD.md | 2026-08-04 (git) | KEEP | none | Product intent (08-04). No retired names; refresh when the product goal changes. |
| README.md | 2026-09-30 | KEEP | none | Doc index. Fix: 'Perturbation' label (line 65), and the infrastructure overview is out of date. |
| REVIEW_2026-10-29.md | 2026-10-29 | ARCHIVE | 2 paths, 1 identifiers | Four-lane review of the 10-29 working tree; findings were applied or superseded. Missing tests/proof and evidence-context paths. |
| TRANSLATIONAL_COVERAGE.md | 30 October 2026 | KEEP | none | Coverage table (11-24). Remove the Perturbation, ESM, ConSurf and VESM rows (lines 29-35, 61, 119). |
| TRANSLATIONAL_PHILOSOPHY.md | 13 October 2026 | KEEP | 1 paths, 0 identifiers | Active product standard (10-13). Its link to PERTURBATION_REVIEW points at a retired doc; retarget it. |
| VARIANT_QUERY_AND_PIPELINE_AUDIT_PLAN.md | 2026-10-16 | ARCHIVE | 12 paths, 13 identifiers | Execution blueprint (10-17) with 70 missing identifiers; the work it planned is done. |
| VISUALIZATION_SYSTEM.md | 2026-10-14 (git) | KEEP | none | Visual system reading order (10-14). Line 51 lists Perturbation as a pending tab; update. |
| VISUAL_STORYTELLING_REVIEW.md | 13 October 2026 | MERGE INTO VISUALIZATION_SYSTEM | 0 paths, 2 identifiers | Storytelling review (10-13); fold the live rules into the visual system doc. |
| WORKSPACE_REDESIGN.md | 2026-11-05 (git) | KEEP | none | Workspace follow-through (11-05); no missing refs. |

### infra

Keep: ACCOUNTS, DEPLOY, AGENT, COMPUTE_BENCHMARK, RESOLVER_CONCORDANCE, STATE_MACHINES. COMPUTE_ROUTING_PLAN and EGRESS_AUDIT are large and carry retired hosts; fold their live parts into ACCOUNTS and ARCHITECTURE.

| Doc | Date | Call | Missing refs | Note |
| --- | --- | --- | --- | --- |
| ACCOUNTS.md | 2026-12-31 | KEEP | 6 paths, 0 identifiers | Owner runbook (11-24). Its live-site URL is duckdns; check against the workers.dev edge. |
| AGENT.md | 2026-10-12 (git) | KEEP | 5 paths, 0 identifiers | Lending compute to your own jobs; current policy. |
| COMPUTE_BENCHMARK.md | 2026-10-11 | KEEP | none | Measurement record linked from ACCOUNTS. |
| COMPUTE_ROUTING_PLAN.md | 2026-10-13 | MERGE INTO ACCOUNTS | 31 paths, 5 identifiers | Plan (10-13, updated 10-29, 140 KB) for accounts and routing. Still-true rules go to ACCOUNTS; the Biohub, HF, GPN, ESM and DuckDNS parts are stale. |
| DEPLOY.md | 2026-11-24 (git) | KEEP | 4 paths, 0 identifiers | Deployment runbook (11-24). Its intro says 'single Windows host', README says OCI; reconcile. |
| EGRESS_AUDIT.md | 2026-10-09 | MERGE INTO ARCHITECTURE | 46 paths, 13 identifiers | Outbound-call audit (10-09, updated 11-24). Rows for Biohub, HF, GPN, ConSurf and ESM hosts are stale; keep a current host table in ARCHITECTURE. |
| PIPELINE_PROGRESS_AUDIT.md | 2026-10-22 | MERGE INTO ARCHITECTURE | none | Pipeline audit (10-22); fold the pipeline facts into ARCHITECTURE. |
| PIPELINE_UPGRADE_VERIFICATION.md | 2026-10-02 (git) | ARCHIVE | none | Verification record (10-02) for an earlier pipeline upgrade. |
| RESOLVER_CONCORDANCE.md | 2026-10-17 | KEEP | none | Study behind the coordinate-resolver ladder (10-17). |
| STATE_MACHINES.md | 2026-11-06 | KEEP | 1 paths, 0 identifiers | Required by AGENTS.md; updated 11-26. Line 261 ('VESM is loaded') needs updating. |
| STREAM_AND_FOLDX_LATENCY_RCA.md | 2026-09-28 (git) | ARCHIVE | 0 paths, 1 identifiers | Latency RCA (09-28), implemented; historical. |

## Contradictions in the overview docs and the retirements

Each row quotes the statement that conflicts, then the source it conflicts with. Task A's retirements are the reference unless noted.

1. **Retired ESM models shown as live (FEATURES.md)**
   - Says: FEATURES.md:134: "## 9. ESM Representation Models & ESM3 Embedding Shift"; FEATURES.md:137: "ESMC-6B & VESM-150M zero-shot sequence constraints: Renders actual, non-fabricated likelihoods"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: "stop running protein language models on routine analyses. ESM-2 650M, SaProt-35M, VESM-150M, ESMC-6B and the ESM3 embedding reading are no longer computed per variant and no longer shown."

2. **ESM3 colouring still offered (FEATURES.md)**
   - Says: FEATURES.md:41: "**ESM3 embedding shift**: per-residue cosine distance between wild-type and variant ESM3"; FEATURES.md:139: "Generative Local Coordinate Refinement: Leverages ESM3's structural track"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md (same sentence as above): the ESM3 embedding reading is "no longer shown".

3. **VESM sidecar guard (LIMITATIONS.md)**
   - Says: LIMITATIONS.md:92-95: "## 8. ESM Model Sequence & Token Constraints ... The local VESM-150M sidecar enforces a strict sequence length guard of 1022 residues"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: "VESM-150M ... are no longer computed per variant". The sidecar router it implies (tools/model_server_app/routers/esm3.py, cited in FEATURES.md) is not in the repo.

4. **VESM required for setup (README.md)**
   - Says: README.md:64: "*   **Python 3 & uv tool (Required for local VESM sidecar predictions)**"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: VESM-150M is no longer computed. Its own note on tools/model_server_app/models.py:93 says the models were retired.

5. **Deep-learning sidecars promised a race deadline (ARCHITECTURE.md)**
   - Says: ARCHITECTURE.md:159: "**Deep Learning Model Sidecars** (`ESM-3`, `ESM-C`, `ESM-2 3B`, `SaProt`): Inside `POST /api/v1/analyze-variant`, deep learning sidecar promises MUST be raced against a **2.5-second fast deadline**"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: the models "are no longer computed per variant". ARCHITECTURE.md is dated 11-23, so the section is stale.

6. **SaProt in the engine readiness list (API.md)**
   - Says: API.md:435: "Readiness of each engine (FoldX, Box64, RaSP, ThermoMPNN, StabilityOracle, SaProt, JapanFold, P2Rank)"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: SaProt-35M is retired (11-18). API.md is dated 11-24.

7. **Perturbation tab still in the workspace lists**
   - Says: doc/README.md:65: "[Residue shifts, Perturbation and Functional domains](MOLECULAR_WORKSPACES_REVIEW.md)"; .agents/skills/evidence-tab-refactor/SKILL.md:180: "Residue shifts & pockets, Structural perturbation, Functional domains"; .agents/skills/verify-missense-resolve/features/evidence.md:20: "| Structural perturbation | Structural perturbation |"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: "The Structural perturbation tab goes away." The agent skills tell agents to test a tab that no longer exists.

8. **Perturbation tab still planned or described as live (FUTURE_WORK.md, TRANSLATIONAL_COVERAGE.md, VISUALIZATION_SYSTEM.md)**
   - Says: FUTURE_WORK.md:42: "Implement a compact 2D pairwise distance change heatmap inside the Perturbation Tab"; TRANSLATIONAL_COVERAGE.md:33: "Perturbation model rows | Beside each model | ESM-2, ESM C, VESM and SaProt"; VISUALIZATION_SYSTEM.md:51 lists Perturbation among the tabs still to do
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: "The Structural perturbation tab goes away."

9. **Agent engine status lists SaProt (.agents/rules/biophysical-engines.md)**
   - Says: .agents/rules/biophysical-engines.md:53: "Returns live JSON status for every engine (`foldx_linux_elf`, `foldx_windows`, `box64`, `rasp`, `thermompnn`, `stabilityoracle`, `saprot`, ...)"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md: SaProt is retired (11-18).

10. **Production URL: duckdns in the docs vs the workers.dev edge in the owner's notes**
   - Says: README.md:132: "answers on ports 80 and 443 at `missense-resolve.duckdns.org` ... There is no Cloudflare in front of the site"; doc/ACCOUNTS.md:9: "The live site is `https://missense-resolve.duckdns.org`"; doc/ACCOUNTS.md:202 sets PUBLIC_BASE_URL to the duckdns host
   - Conflicts with: Owner's auto-memory (production-url-workers-edge): "Production URL is the workers.dev edge — not duckdns". The memory note is the newer source; confirm before editing the docs.

11. **Deployment target: single Windows host vs OCI (DEPLOY.md vs README.md)**
   - Says: doc/DEPLOY.md intro: "deploy the Missense & Fold Explorer application ... as a reliable, secure internal single-tenant lab tool on a Windows host"; doc/README.md index: "Setup runbook for a single Windows host using Caddy and PM2"
   - Conflicts with: README.md:129-131: "For production environments, the platform runs on an **Oracle Cloud Infrastructure (OCI) Always Free Ampere A1 (ARM64)** instance"

12. **DuckDNS allowed in CORS, CSP and the default URL**
   - Says: server/express-config.ts:129-130 allow "https://*.duckdns.org" and "wss://*.duckdns.org"; server/auth/config.ts:20 sets DEFAULT_PUBLIC_BASE_URL to the duckdns host
   - Conflicts with: Task rule: duckdns is not the user-facing URL; the production URL is the workers.dev edge (owner's memory). The CORS list and default URL should follow the edge host.

13. **Credential retirement vs the credentials still described (COMPUTE_ROUTING_PLAN.md, EGRESS_AUDIT.md)**
   - Says: doc/COMPUTE_ROUTING_PLAN.md:1452: "Hugging Face inference: ESM-2, SaProt remote | `x-hf-token` per request"; doc/EGRESS_AUDIT.md:307: "### 4.19 GPN-Star (custom endpoint or Hugging Face), 3 rows"
   - Conflicts with: PROTEIN_LANGUAGE_MODELS_DECISION.md (ESM-2, SaProt retired) and GPN-MSA retirement (2026-11-21, in the owner's notes): Hugging Face and GPN credentials are removed. server/services/external-api/gpn.ts is gone.

## Archive list

ARCHIVE (move to `doc/archive/`):

ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT.md, ALPHAGENOME_TAB_REVIEW.md, CALIBRATED_STACKING.md, CHARTING_AND_VISUALIZATION_PLAN.md, CONTEXT_WORKSPACES_REVIEW.md, ENERGETICS_AUDIT_AND_PLAN.md, ENERGETICS_LANDSCAPE_AUDIT_2026-10-27.md, ENERGETICS_TAB_REVIEW.md, ENERGETICS_VISUALIZATION_REVIEW.md, EVIDENCE_CONTEXT_IMPLEMENTATION_AUDIT.md, EVIDENCE_TOPIC_VIEWS_REVIEW.md, EVIDENCE_WORKSPACE_REVIEW.md, EXPRESSION_MODELS_EXTERNAL_AUDIT.md, EXPRESSION_MODELS_TAB_REVIEW.md, EXPRESSION_UI_REVIEW.md, EXPRESSION_UX_POLISH_REVIEW.md, FUNCTIONAL_DOMAINS_TAB_AUDIT.md, FUNCTIONAL_DOMAINS_TAB_REVIEW.md, GENE_DISEASE_DOSAGE_RECOVERY_REVIEW.md, GENE_DISEASE_EXTERNAL_AUDIT.md, GENE_DISEASE_REVIEW.md, GENE_DISEASE_SENIOR_CODE_REVIEW.md, GENE_DISEASE_UX_POLISH_REVIEW.md, INDEPENDENT_AUDIT_RESPONSE.md, INSIGHTS_TAB_REVIEW.md, INSPECTOR_UI_UX_AUDIT.md, INTERACTIONS_TAB_REVIEW.md, INTERFACES_AUDIT.md, INTERFACES_PPI_REVIEW.md, LANDSCAPE_TAB_AUDIT.md, LITERATURE_UPGRADE_PLAN.md, MECHANISM_WORKSPACES_REVIEW.md, MOLECULAR_WORKSPACES_REVIEW.md, MULTIMER_TAB_REVIEW.md, PERTURBATION_REVIEW.md, PIPELINE_UPGRADE_VERIFICATION.md, POPULATION_FREQUENCIES_REVIEW.md, POPULATION_UX_POLISH_REVIEW.md, POPULATION_VISUALIZATION_BATCH_REVIEW.md, POST_REVIEW_FINDINGS_FIXES.md, PREDICTORS_AVAILABILITY_REVIEW.md, PREDICTORS_INFORMATIONAL_UI_REVIEW.md, PREDICTORS_TAB_REVIEW.md, RESIDUE_SHIFT_REVIEW_RESOLUTION.md, REVIEW_2026-10-29.md, REVIEW_WORKSPACES_REVIEW.md, REVIEW_WORKSPACES_SENIOR_CODE_REVIEW.md, SPLICING_WORKSPACE_REVIEW.md, STREAM_AND_FOLDX_LATENCY_RCA.md, STRUCTURE_3D_REVIEW.md, TISSUE_EXPRESSION_PROPOSAL.md, UNMAPPING_DEFECT_SPLICE_AUDIT.md, VARIANT_QUERY_AND_PIPELINE_AUDIT_PLAN.md

MERGE (fold the live facts into the named doc, then archive):

COMPUTE_ROUTING_PLAN.md into ACCOUNTS; CONTEXT_MOLECULAR_VISUALIZATION_REVIEW.md into VISUALIZATION_SYSTEM; DENOVO_FOLD_NOTICE_RCA.md into ARCHITECTURE; EGRESS_AUDIT.md into ARCHITECTURE; EVIDENCE_CONTEXT_REVIEW.md into EVIDENCE_CONTEXT_BASELINE_FIX; FOLDX_REPAIR_RCA_2026-10-29.md into ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN; LITERATURE_SCREENING_REVIEW.md into LITERATURE_SCREENING_PROPOSAL; LITERATURE_SCREENING_UI_PLAN.md into LITERATURE_SCREENING_PROPOSAL; LITERATURE_TAB_REVIEW.md into SYNTHESIS_WORKSPACES_REVIEW; LOCAL_DBNSFP_UPGRADE.md into ARCHITECTURE; PIPELINE_PROGRESS_AUDIT.md into ARCHITECTURE; QUERY_SYNTHESIS_FINISHING_PASS.md into SYNTHESIS_WORKSPACES_REVIEW; QUERY_SYNTHESIS_REVIEW_RESOLUTION.md into SYNTHESIS_WORKSPACES_REVIEW; REPORT_TAB_REVIEW.md into SYNTHESIS_WORKSPACES_REVIEW; SPECIES_POLISH_REVIEW.md into SPECIES_MODELS_TAB_REVIEW; SPLICING_LAYOUT_REVIEW.md into SPLICING_TAB_REVIEW; STRUCTURAL_PERTURBATION_RESOLUTION.md into PROTEIN_LANGUAGE_MODELS_DECISION; VISUAL_STORYTELLING_REVIEW.md into VISUALIZATION_SYSTEM; multimer_modeling_proposal.md into FUTURE_WORK
