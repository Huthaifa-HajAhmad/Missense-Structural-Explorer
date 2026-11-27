# Task B: builds docs.csv (required columns) and the per-area decision table for docs-reconciliation.md.
# Decisions are hand-made from reading each doc's status block; the reconciliation note explains them.
import csv, re, sys
sys.stdout.reconfigure(encoding="utf-8")
STAG = "C:/Users/HSA19/antigravity/release-coherence-audit/doc/release-audit/staleness/"
ROOT = "C:/Users/HSA19/antigravity/release-coherence-audit/"
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
TEXT_DATE = re.compile(r"\b(20\d\d-\d\d-\d\d)\b|\b(\d{1,2} (?:%s) 20\d\d)\b" % MONTHS)

# name -> (area, recommendation, note)
D = {
 # Population
 "GNOMAD_CONSTRAINT": ("Population", "KEEP", "Current reference for the pinned gnomAD snapshot; no missing refs."),
 "POPULATION_FREQUENCIES_REVIEW": ("Population", "ARCHIVE", "Bound to revision 1a61b2f; superseded by EVIDENCE_TABS_FULL_AUDIT (10-27), which audits the Population tab end to end."),
 "POPULATION_VISUALIZATION_BATCH_REVIEW": ("Population", "ARCHIVE", "Superseded by EVIDENCE_TOPIC_VIEWS_REVIEW (10-16) and EVIDENCE_TABS_FULL_AUDIT (10-27)."),
 "POPULATION_UX_POLISH_REVIEW": ("Population", "ARCHIVE", "Superseded by EVIDENCE_TABS_FULL_AUDIT (10-27)."),
 "POST_REVIEW_FINDINGS_FIXES": ("Population", "ARCHIVE", "Follow-up to the 10-09 multi-dimensional review; findings resolved and recorded in later audits."),
 # Gene-disease
 "GENE_DISEASE_REFERENCE_REVIEW": ("Gene–disease", "KEEP", "Newest Gene–disease review (11-27); authoritative for validity classes and the Reference panel."),
 "GENE_DISEASE_PROPOSAL": ("Gene–disease", "KEEP", "Design record (Rev 4, implemented); companion of EXPRESSION_AND_MODELS_PROPOSAL."),
 "GENE_DISEASE_EXTERNAL_AUDIT": ("Gene–disease", "ARCHIVE", "Audit of Rev 2.1 proposals; its findings are folded into Rev 4 and EXPRESSION Rev 6."),
 "GENE_DISEASE_REVIEW": ("Gene–disease", "ARCHIVE", "Superseded by GENE_DISEASE_REFERENCE_REVIEW (11-27). Missing identifier DosageSensitivityCard."),
 "GENE_DISEASE_DOSAGE_RECOVERY_REVIEW": ("Gene–disease", "ARCHIVE", "Superseded by GENE_DISEASE_REFERENCE_REVIEW (11-27); cites admission.test.ts at a line number."),
 "GENE_DISEASE_SENIOR_CODE_REVIEW": ("Gene–disease", "ARCHIVE", "Subagent code review (10-16); superseded by GENE_DISEASE_REFERENCE_REVIEW. Contains a local file:/// link."),
 "GENE_DISEASE_UX_POLISH_REVIEW": ("Gene–disease", "ARCHIVE", "Says it supersedes the earlier pill navigation; superseded by GENE_DISEASE_REFERENCE_REVIEW. No H1 title."),
 # Expression
 "EXPRESSION_AND_MODELS_PROPOSAL": ("Expression", "KEEP", "Rev 6 is the implementation authority for Expression and Species; supersedes TISSUE_EXPRESSION_PROPOSAL."),
 "EXPRESSION_POLISH_REVIEW": ("Expression", "KEEP", "Newest Expression review (11-04); the reference for the current pext/source-tab presentation."),
 "EXPRESSION_UI_REVIEW": ("Expression", "ARCHIVE", "Superseded by EXPRESSION_POLISH_REVIEW (11-04)."),
 "EXPRESSION_UX_POLISH_REVIEW": ("Expression", "ARCHIVE", "Superseded by EXPRESSION_POLISH_REVIEW (11-04)."),
 "EXPRESSION_MODELS_TAB_REVIEW": ("Expression", "ARCHIVE", "Rebuild record (10-07); superseded by EXPRESSION_POLISH_REVIEW (11-04)."),
 "EXPRESSION_MODELS_EXTERNAL_AUDIT": ("Expression", "ARCHIVE", "Audit of Rev 2.1 proposals (10-06); findings folded into Rev 6. Missing pext.py (a script name)."),
 "TISSUE_EXPRESSION_PROPOSAL": ("Expression", "ARCHIVE", "Self-declared superseded (10-05) and kept as the v1 research appendix."),
 "CONTEXT_WORKSPACES_REVIEW": ("Expression", "ARCHIVE", "Covers Gene–disease, Expression and Species in one pass (10-10); superseded per area. Cites the removed perturbationReadings."),
 # Species
 "SPECIES_MODELS_TAB_REVIEW": ("Species", "KEEP", "Newest Species review (11-27); authoritative for the Species & models tab."),
 "SPECIES_POLISH_REVIEW": ("Species", "MERGE INTO SPECIES_MODELS_TAB_REVIEW", "Short presentation pass (11-04); its facts belong with the current Species review."),
 # Functional domains
 "FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT": ("Functional domains", "KEEP", "Newest Functional-domains audit (10-04). Missing variantDensity and a constraintMetrics line ref."),
 "FUNCTIONAL_DOMAINS_TAB_REVIEW": ("Functional domains", "ARCHIVE", "Superseded by FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT. Missing domainRowKey and FeaturePalette files."),
 "FUNCTIONAL_DOMAINS_TAB_AUDIT": ("Functional domains", "ARCHIVE", "Oldest Functional-domains audit (09-25); superseded. Cites FeaturePaletteLegend.tsx, ResidueEnvironmentPanel.tsx and featurePalette.ts, which are gone."),
 "FUNCTIONAL_HOTSPOTS_PLAN": ("Functional domains", "KEEP", "Build record for the Hotspots subtab (10-28, updated 11-26). Two line-number refs need checking."),
 "HOTSPOT_3D_DECISION": ("Functional domains", "KEEP", "Decision record: 3D proximity is a non-voting suggestion."),
 # Predictors
 "PRIMARY_PREDICTOR_DECISION": ("Predictors", "KEEP", "Authoritative PP3/BP4 policy (11-24)."),
 "RELEASE_NOTE_PRIMARY_PREDICTOR": ("Predictors", "KEEP", "Release note for the policy above (11-24)."),
 "RELEASE_NOTE_PREDICTOR_SCALE_FIXES": ("Predictors", "KEEP", "Release note: popEVE leaves the vote (11-23)."),
 "PROTEIN_LANGUAGE_MODELS_DECISION": ("Predictors", "KEEP", "Retirement record for the runtime protein language models (11-18). Tests cite it."),
 "IN_SILICO_PRUNING_PLAN": ("Predictors", "KEEP", "Live plan (11-24); Phase 6 still open. Merge into PRIMARY_PREDICTOR_DECISION when closed."),
 "PREDICTORS_INFORMATIONAL_UI_REVIEW": ("Predictors", "ARCHIVE", "Superseded by PRIMARY_PREDICTOR_DECISION and the release notes. Cites preferenceCaveat and preferenceSummary, which no longer exist."),
 "PREDICTORS_TAB_REVIEW": ("Predictors", "ARCHIVE", "Self-declared historical baseline (09-28); superseded by the 11-24 decision."),
 "PREDICTORS_AVAILABILITY_REVIEW": ("Predictors", "ARCHIVE", "One-off provider check (10-29); the popEVE rule now sits in RELEASE_NOTE_PREDICTOR_SCALE_FIXES."),
 "LOCAL_DBNSFP_UPGRADE": ("Predictors", "MERGE INTO ARCHITECTURE", "Old strategy (07-22). Says local dbNSFP is deferred, which conflicts with the settled VM-only store; keep only the storage facts."),
 "CALIBRATED_STACKING": ("Predictors", "ARCHIVE", "Self-declared retired page."),
 "RASP_DATA": ("Energetics", "KEEP", "Data reference for the RaSP lookup; the sqlite file is a runtime file, not in the repo."),
 # Landscape
 "RESIDUE_TOLERANCE_DECISION": ("Landscape", "KEEP", "Rejection record for MetaDome, MTR3D-AF2, CCR and in-house tolerance (10-26). The fixed-plan files it cites live outside the repo."),
 "LANDSCAPE_TAB_AUDIT": ("Landscape", "ARCHIVE", "Audit and redesign proposal (10-15); superseded by LANDSCAPE_UI_REVIEW (11-01)."),
 "LANDSCAPE_UI_REVIEW": ("Landscape", "KEEP", "Newest Landscape review (11-01). Missing ExplorationWorkspace and RetryDynamut2.test.tsx refs; fix."),
 "EXPLORATION_WORKSPACE": ("Landscape", "KEEP", "Current shared Landscape and 3D layout (11-24)."),
 # Literature
 "LITERATURE_SCREENING_PROPOSAL": ("Literature", "KEEP", "Design and status record for the screening roadmap (10-04, updated 10-05)."),
 "LITERATURE_SCREENING_REVIEW": ("Literature", "MERGE INTO LITERATURE_SCREENING_PROPOSAL", "Phase review (10-05) whose status belongs in the proposal."),
 "LITERATURE_SCREENING_UI_PLAN": ("Literature", "MERGE INTO LITERATURE_SCREENING_PROPOSAL", "Companion UI plan (10-05); implemented, so fold the status into the proposal."),
 "LITERATURE_TAB_REVIEW": ("Literature", "MERGE INTO SYNTHESIS_WORKSPACES_REVIEW", "Points to the 10-11 pass; the 10-18 synthesis review is newer."),
 "LITERATURE_UPGRADE_PLAN": ("Literature", "ARCHIVE", "Owner decisions of 10-06 for disease and phenotype context; the Gene–disease proposal covers the same ground."),
 "REVIEW_WORKSPACES_REVIEW": ("Literature", "ARCHIVE", "Superseded by SYNTHESIS_WORKSPACES_REVIEW (10-18)."),
 "REVIEW_WORKSPACES_SENIOR_CODE_REVIEW": ("Literature", "ARCHIVE", "Its four findings were handled in QUERY_SYNTHESIS_REVIEW_RESOLUTION (10-12)."),
 "QUERY_SYNTHESIS_FINISHING_PASS": ("Literature", "MERGE INTO SYNTHESIS_WORKSPACES_REVIEW", "Bounded pass (10-11); its facts belong with the synthesis review."),
 "QUERY_SYNTHESIS_REVIEW_RESOLUTION": ("Literature", "MERGE INTO SYNTHESIS_WORKSPACES_REVIEW", "Resolution record (10-12) for the 10-11 review."),
 # Report / synthesis
 "SYNTHESIS_WORKSPACES_REVIEW": ("Report", "KEEP", "Newest review of Insights, Literature and Report ownership (10-18, touched 11-24)."),
 "REPORT_TAB_REVIEW": ("Report", "MERGE INTO SYNTHESIS_WORKSPACES_REVIEW", "Report-tab review (10-07/08); the 10-18 synthesis review covers Report."),
 "INSIGHTS_TAB_REVIEW": ("Report", "ARCHIVE", "Superseded by SYNTHESIS_WORKSPACES_REVIEW (10-18)."),
 # Residue shifts / structure
 "STRUCTURE3D_TAB_REVIEW_2026-11-05": ("Residue shifts / Structure", "KEEP", "Newest 3D Structure review (11-05, status 11-08)."),
 "STRUCTURE_3D_REVIEW": ("Residue shifts / Structure", "ARCHIVE", "Superseded by STRUCTURE3D_TAB_REVIEW_2026-11-05. Cites esm3_forge.ts and esmfold files that were removed."),
 "RESIDUE_SHIFTS_REVIEW": ("Residue shifts / Structure", "KEEP", "Latest Residue Shifts & Pockets review (updated 10-29). Missing PropertyScaleReference identifier; fix."),
 "RESIDUE_SHIFT_REVIEW_RESOLUTION": ("Residue shifts / Structure", "ARCHIVE", "Resolution record (09-25) for an earlier review; 37 of its identifiers no longer exist."),
 "MOLECULAR_WORKSPACES_REVIEW": ("Residue shifts / Structure", "ARCHIVE", "Describes the Perturbation workspace as live (10-10). Its Perturbation half is retired."),
 "PERTURBATION_REVIEW": ("Residue shifts / Structure", "ARCHIVE", "Retired Structural perturbation tab (09-29); cites removed esm2/esm3/esmc files."),
 "STRUCTURAL_PERTURBATION_RESOLUTION": ("Residue shifts / Structure", "MERGE INTO PROTEIN_LANGUAGE_MODELS_DECISION", "Provider decision record (10-29 to 11-18); fold the decision into the retirement record, then archive."),
 "DENOVO_FOLD_NOTICE_RCA": ("Residue shifts / Structure", "MERGE INTO ARCHITECTURE", "Implemented notice (11-21). Cites server/services/structure/esmfold.ts, which is gone; keep the behaviour, drop the file refs."),
 "VERIFIED_RESIDUE_DESIGN": ("Residue shifts / Structure", "KEEP", "Approved design (11-24), in progress."),
 # Interfaces
 "INTERFACES_PPI_AUDIT_2026-11-26": ("Interfaces", "KEEP", "Newest Interfaces & PPI audit (11-26). Missing app.js and partners.ts refs; check."),
 "PDB_RESIDUE_COVERAGE_AUDIT": ("Interfaces", "KEEP", "Newest PDB coverage audit (11-26); covers the counts outside Interfaces."),
 "INTERFACES_PPI_REVIEW": ("Interfaces", "ARCHIVE", "SOD1 audit (10-04); superseded by the ABCG1 audit (11-26)."),
 "INTERFACES_AUDIT": ("Interfaces", "ARCHIVE", "Pre-merge audit (10-02); the tabs it audits were merged. Missing interactionsEvidence.ts and multimerEvidence.ts."),
 "INTERACTIONS_TAB_REVIEW": ("Interfaces", "ARCHIVE", "Self-declared superseded; the tab no longer exists."),
 "MULTIMER_TAB_REVIEW": ("Interfaces", "ARCHIVE", "Self-declared superseded; the tab no longer exists."),
 "multimer_modeling_proposal": ("Interfaces", "MERGE INTO FUTURE_WORK", "Quaternary-modelling design (08-14) is future work; cites a retired sidecar router."),
 # Energetics
 "ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN": ("Energetics", "KEEP", "Current Energetics plan (v2, 11-03). Missing EnergeticsVerdictCard.tsx and tools/foldx refs; fix."),
 "FOLDX_LOCAL_SHELL_BENCH_2026-11-02": ("Energetics", "KEEP", "Benchmark record behind FoldX repair mode (11-05)."),
 "RELEASE_NOTE_FOLDX_REPAIR_MODE": ("Energetics", "KEEP", "Release note for repair mode and cache v5 (11-05)."),
 "FOLDX_REPAIR_RCA_2026-10-29": ("Energetics", "MERGE INTO ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN", "RCA (10-29); its outcome belongs in the plan."),
 "ENERGETICS_AUDIT_AND_PLAN": ("Energetics", "ARCHIVE", "Oldest Energetics audit (10-04); superseded by the 11-03 plan. Title has a mojibake encoding error."),
 "ENERGETICS_TAB_REVIEW": ("Energetics", "ARCHIVE", "Superseded by the 11-03 plan and FOLDX_LOCAL_SHELL_BENCH_2026-11-02."),
 "ENERGETICS_LANDSCAPE_AUDIT_2026-10-27": ("Energetics", "ARCHIVE", "Superseded by the 11-03 plan; the Landscape items are in LANDSCAPE_UI_REVIEW."),
 "ENERGETICS_VISUALIZATION_REVIEW": ("Energetics", "ARCHIVE", "Visual review (10-09); superseded by later Energetics records."),
 "STABILITY_ORACLE_COMPARISON_PROTOCOL": ("Energetics", "KEEP", "Pre-registered protocol (11-24); open decision."),
 "STABILITY_ORACLE_INPUTS_RESEARCH": ("Energetics", "KEEP", "Input-rebuild research record (11-05)."),
 # Splicing
 "SPLICING_TAB_REVIEW": ("Splicing", "KEEP", "Newest Splicing audit (11-24). Missing splicingTab.schematic.test.tsx ref; check the test's name."),
 "SPLICING_LAYOUT_REVIEW": ("Splicing", "MERGE INTO SPLICING_TAB_REVIEW", "Layout correction (10-29); fold into the splicing review."),
 "SPLICING_WORKSPACE_REVIEW": ("Splicing", "ARCHIVE", "Superseded by SPLICING_TAB_REVIEW (11-24)."),
 "UNMAPPING_DEFECT_SPLICE_AUDIT": ("Splicing", "ARCHIVE", "RCA of the ACOT9 unmapped-splice bug (09-23); historical. Cites removed identifiers."),
 "MECHANISM_WORKSPACES_REVIEW": ("Splicing", "ARCHIVE", "Second pass for Splicing and Interfaces (10-11); superseded per area by SPLICING_TAB_REVIEW and INTERFACES_PPI_AUDIT_2026-11-26."),
 # AlphaGenome
 "ALPHAGENOME_UI_REVIEW": ("AlphaGenome", "KEEP", "Newest AlphaGenome record (11-01)."),
 "ALPHAGENOME_TAB_REVIEW": ("AlphaGenome", "ARCHIVE", "Superseded by ALPHAGENOME_UI_REVIEW (11-01)."),
 "ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT": ("AlphaGenome", "ARCHIVE", "Oldest AlphaGenome RCA (09-23). Cites PerturbationTab.tsx and DynaMut2/DDMut statuses, both gone."),
 # Workspace-wide
 "README": ("workspace-wide", "KEEP", "Doc index. Fix: 'Perturbation' label (line 65), and the infrastructure overview is out of date."),
 "PRD": ("workspace-wide", "KEEP", "Product intent (08-04). No retired names; refresh when the product goal changes."),
 "FEATURES": ("workspace-wide", "KEEP", "User feature catalogue. Fix section 9 and the ESM3 colouring lines (retired 11-18)."),
 "LIMITATIONS": ("workspace-wide", "KEEP", "Limits. Fix section 8 (local VESM-150M sidecar guard). PP2 and PP3 text is current."),
 "ARCHITECTURE": ("workspace-wide", "KEEP", "Architecture. Fix line 159 (ESM sidecars racing a 2.5 s deadline). Missing data/ and template refs are runtime or placeholders."),
 "API": ("workspace-wide", "KEEP", "API reference (11-24). Fix the SaProt engine readiness row (line 435)."),
 "FUTURE_WORK": ("workspace-wide", "KEEP", "Roadmap. Remove the Perturbation Tab and ESM items (lines 42, 54, 92, 96); absorb the multimer proposal."),
 "TRANSLATIONAL_PHILOSOPHY": ("workspace-wide", "KEEP", "Active product standard (10-13). Its link to PERTURBATION_REVIEW points at a retired doc; retarget it."),
 "TRANSLATIONAL_COVERAGE": ("workspace-wide", "KEEP", "Coverage table (11-24). Remove the Perturbation, ESM, ConSurf and VESM rows (lines 29-35, 61, 119)."),
 "VISUALIZATION_SYSTEM": ("workspace-wide", "KEEP", "Visual system reading order (10-14). Line 51 lists Perturbation as a pending tab; update."),
 "WORKSPACE_REDESIGN": ("workspace-wide", "KEEP", "Workspace follow-through (11-05); no missing refs."),
 "EVIDENCE_TABS_FULL_AUDIT": ("workspace-wide", "KEEP", "Newest audit across all Evidence tabs (10-27). Missing ContextualCoverage and humaniseAnyRefusal; check."),
 "EVIDENCE_CONTEXT_BASELINE_FIX": ("workspace-wide", "KEEP", "Latest Evidence-context record (10-06); supersedes the implementation audit."),
 "EVIDENCE_CONTEXT_REVIEW": ("workspace-wide", "MERGE INTO EVIDENCE_CONTEXT_BASELINE_FIX", "Implementation record (10-06); fold its live facts into the baseline record."),
 "EVIDENCE_CONTEXT_IMPLEMENTATION_AUDIT": ("workspace-wide", "ARCHIVE", "Its own text says the baseline audit supersedes its auth and export decisions."),
 "EVIDENCE_TOPIC_VIEWS_REVIEW": ("workspace-wide", "ARCHIVE", "Superseded by EVIDENCE_TABS_FULL_AUDIT (10-27)."),
 "EVIDENCE_WORKSPACE_REVIEW": ("workspace-wide", "ARCHIVE", "Superseded by EVIDENCE_TOPIC_VIEWS_REVIEW and EVIDENCE_TABS_FULL_AUDIT."),
 "CONTEXT_MOLECULAR_VISUALIZATION_REVIEW": ("workspace-wide", "MERGE INTO VISUALIZATION_SYSTEM", "Figure presentation review (10-14); fold into the visual system doc."),
 "CHARTING_AND_VISUALIZATION_PLAN": ("workspace-wide", "ARCHIVE", "Charting plan (10-04/10-13); cites a missing CHARTING_INVENTORY.md and a removed perturbation folder."),
 "VISUAL_STORYTELLING_REVIEW": ("workspace-wide", "MERGE INTO VISUALIZATION_SYSTEM", "Storytelling review (10-13); fold the live rules into the visual system doc."),
 "INSPECTOR_UI_UX_AUDIT": ("workspace-wide", "ARCHIVE", "Oldest inspector audit (09-27); 33 missing paths and 39 missing identifiers."),
 "INDEPENDENT_AUDIT_RESPONSE": ("workspace-wide", "ARCHIVE", "Answer to the 09-30 external audit; cites INDEPENDENT_AUDIT_REPORT.md, which is not in the repo."),
 "REVIEW_2026-10-29": ("workspace-wide", "ARCHIVE", "Four-lane review of the 10-29 working tree; findings were applied or superseded. Missing tests/proof and evidence-context paths."),
 "VARIANT_QUERY_AND_PIPELINE_AUDIT_PLAN": ("workspace-wide", "ARCHIVE", "Execution blueprint (10-17) with 70 missing identifiers; the work it planned is done."),
 # Infra
 "ACCOUNTS": ("infra", "KEEP", "Owner runbook (11-24). Its live-site URL is duckdns; check against the workers.dev edge."),
 "DEPLOY": ("infra", "KEEP", "Deployment runbook (11-24). Its intro says 'single Windows host', README says OCI; reconcile."),
 "AGENT": ("infra", "KEEP", "Lending compute to your own jobs; current policy."),
 "COMPUTE_BENCHMARK": ("infra", "KEEP", "Measurement record linked from ACCOUNTS."),
 "RESOLVER_CONCORDANCE": ("infra", "KEEP", "Study behind the coordinate-resolver ladder (10-17)."),
 "COMPUTE_ROUTING_PLAN": ("infra", "MERGE INTO ACCOUNTS", "Plan (10-13, updated 10-29, 140 KB) for accounts and routing. Still-true rules go to ACCOUNTS; the Biohub, HF, GPN, ESM and DuckDNS parts are stale."),
 "EGRESS_AUDIT": ("infra", "MERGE INTO ARCHITECTURE", "Outbound-call audit (10-09, updated 11-24). Rows for Biohub, HF, GPN, ConSurf and ESM hosts are stale; keep a current host table in ARCHITECTURE."),
 "STREAM_AND_FOLDX_LATENCY_RCA": ("infra", "ARCHIVE", "Latency RCA (09-28), implemented; historical."),
 "PIPELINE_PROGRESS_AUDIT": ("infra", "MERGE INTO ARCHITECTURE", "Pipeline audit (10-22); fold the pipeline facts into ARCHITECTURE."),
 "PIPELINE_UPGRADE_VERIFICATION": ("infra", "ARCHIVE", "Verification record (10-02) for an earlier pipeline upgrade."),
 "STATE_MACHINES": ("infra", "KEEP", "Required by AGENTS.md; updated 11-26. Line 261 ('VESM is loaded') needs updating."),
 "THRESHOLDS_TAB_REVIEW": ("Predictors", "KEEP", "Only review of the Score thresholds tab (09-29, after the 09-28 review it replaces). Its isPp2Constrained spelling does not match the code (isPP2Constrained)."),
}
# Docs with no entry get a default based on their name.
DEFAULT = ("workspace-wide", "ARCHIVE", "No decision recorded; review.")

rows = list(csv.DictReader(open(STAG + "doc-extract.csv", encoding="utf-8")))
out, missing_decision = [], []
for r in rows:
    name = r["doc"][4:-3]  # strip "doc/" and ".md"
    text_path = ROOT + r["doc"]
    txt = open(text_path, encoding="utf-8", errors="replace").read()
    m = TEXT_DATE.search(txt)
    date = (m.group(1) or m.group(2)) if m else r["date_git"]
    if not m:
        date = r["date_git"] + " (git)"
    area, rec, note = D.get(name, (None, None, None))
    if area is None:
        missing_decision.append(name)
        area, rec, note = DEFAULT
    out.append({"doc": r["doc"], "date": date, "area": area, "refs": "", "missing_paths": r["missing_paths"],
                "missing_identifiers": r["missing_ids"], "rec": rec, "note": note, "n_refs": int(r["n_paths"]) + int(r["n_ids"]),
                "title": r["title"]})

with open(STAG + "docs.csv", "w", newline="\n", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["doc", "date", "area", "refs", "missing_paths", "missing_identifiers"])
    for o in out:
        w.writerow([o["doc"], o["date"], o["area"], o["n_refs"], o["missing_paths"], o["missing_identifiers"]])

from collections import Counter
print(len(out), "docs; no decision for:", missing_decision)
print(Counter(o["rec"].split(" ")[0] for o in out))
with open(STAG + "scripts/doc_decisions.tsv", "w", newline="\n", encoding="utf-8") as fh:
    for o in out:
        fh.write("\t".join([o["area"], o["doc"], o["date"], o["rec"], o["note"], str(o["n_refs"]), o["missing_paths"], o["missing_identifiers"]]) + "\n")
