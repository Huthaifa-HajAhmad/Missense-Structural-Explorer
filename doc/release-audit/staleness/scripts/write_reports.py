# Writes docs-reconciliation.md (Task B) and retired-names-summary.md (Task A) from the CSV outputs.
import csv, sys
from collections import Counter, OrderedDict
sys.stdout.reconfigure(encoding="utf-8")
STAG = "C:/Users/HSA19/antigravity/release-coherence-audit/doc/release-audit/staleness/"

AREAS = OrderedDict([
 ("Population", "Newest: GNOMAD_CONSTRAINT (pinned data, current). The tab's own audit is EVIDENCE_TABS_FULL_AUDIT (10-27), which replaces the four 10-09 to 10-16 Population reviews."),
 ("Gene–disease", "Newest and authoritative: GENE_DISEASE_REFERENCE_REVIEW (11-27). GENE_DISEASE_PROPOSAL (Rev 4) is the design record. The five 10-06 to 10-16 reviews are superseded."),
 ("Expression", "Newest: EXPRESSION_POLISH_REVIEW (11-04). Design authority: EXPRESSION_AND_MODELS_PROPOSAL (Rev 6, 10-07). The 10-06 to 11-01 reviews are superseded; TISSUE_EXPRESSION_PROPOSAL declares itself superseded."),
 ("Species", "Newest and authoritative: SPECIES_MODELS_TAB_REVIEW (11-27). It has no missing code references. SPECIES_POLISH_REVIEW (11-04) is folded into it."),
 ("Functional domains", "Tab audit: FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT (10-04). Hotspots: FUNCTIONAL_HOTSPOTS_PLAN and HOTSPOT_3D_DECISION (both 10-28). The 09-25 and 09-29 reviews are superseded."),
 ("Predictors", "Newest and authoritative: PRIMARY_PREDICTOR_DECISION (11-24), with the two release notes (11-23, 11-24) and PROTEIN_LANGUAGE_MODELS_DECISION (11-18). The 09-29, 10-29 and 11-01 reviews are superseded. LOCAL_DBNSFP_UPGRADE conflicts with the settled VM-only store."),
 ("AlphaGenome", "Newest and authoritative: ALPHAGENOME_UI_REVIEW (11-01). ALPHAGENOME_TAB_REVIEW (09-28) and the 09-14 RCA are superseded; both cite the removed Perturbation and DynaMut2 code."),
 ("Splicing", "Newest and authoritative: SPLICING_TAB_REVIEW (11-24). SPLICING_WORKSPACE_REVIEW, SPLICING_LAYOUT_REVIEW and the splicing half of MECHANISM_WORKSPACES_REVIEW are superseded. UNMAPPING_DEFECT_SPLICE_AUDIT is a closed RCA."),
 ("Residue shifts / Structure", "Newest: STRUCTURE3D_TAB_REVIEW_2026-11-05 (3D), VERIFIED_RESIDUE_DESIGN (11-24, in progress), RESIDUE_SHIFTS_REVIEW (updated 10-29). The Perturbation documents (PERTURBATION_REVIEW, STRUCTURAL_PERTURBATION_RESOLUTION, MOLECULAR_WORKSPACES_REVIEW) describe a retired tab. Several cite esm3_forge.ts, esmfold.ts and PerturbationTab.tsx, which are gone."),
 ("Interfaces", "Newest and authoritative: INTERFACES_PPI_AUDIT_2026-11-26 and PDB_RESIDUE_COVERAGE_AUDIT (11-26). INTERFACES_PPI_REVIEW (10-04) is folded in. INTERACTIONS_TAB_REVIEW and MULTIMER_TAB_REVIEW say they are superseded because their tabs were merged; the pre-merge audit INTERFACES_AUDIT is too."),
 ("Energetics", "Newest and authoritative: ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN (11-03), with FOLDX_LOCAL_SHELL_BENCH_2026-11-02 and RELEASE_NOTE_FOLDX_REPAIR_MODE (11-05). StabilityOracle docs (11-05, 11-24) are open research. The 10-04 to 10-27 audits are superseded."),
 ("Landscape", "Newest: LANDSCAPE_UI_REVIEW (11-01) and EXPLORATION_WORKSPACE (11-24). RESIDUE_TOLERANCE_DECISION (10-26) is the rejection record for residue-level tolerance scores. LANDSCAPE_TAB_AUDIT (10-15) is superseded."),
 ("Literature", "Authoritative status record: LITERATURE_SCREENING_PROPOSAL (10-04, updated 10-05). The screening review and UI plan are folded into it. The 10-06 to 10-11 Literature reviews are superseded by SYNTHESIS_WORKSPACES_REVIEW (10-18)."),
 ("Report", "Newest and authoritative: SYNTHESIS_WORKSPACES_REVIEW (10-18), which covers Insights, Literature and Report. REPORT_TAB_REVIEW, INSIGHTS_TAB_REVIEW and the two Query/synthesis passes are folded in or superseded."),
 ("workspace-wide", "Reference docs to keep: README (index), PRD, FEATURES, LIMITATIONS, ARCHITECTURE, API, FUTURE_WORK, STATE_MACHINES (infra), TRANSLATIONAL_PHILOSOPHY and TRANSLATIONAL_COVERAGE, VISUALIZATION_SYSTEM, WORKSPACE_REDESIGN, EVIDENCE_TABS_FULL_AUDIT, EVIDENCE_CONTEXT_BASELINE_FIX. Most of the 2026-09 and 10-06 to 10-16 audits are superseded."),
 ("infra", "Keep: ACCOUNTS, DEPLOY, AGENT, COMPUTE_BENCHMARK, RESOLVER_CONCORDANCE, STATE_MACHINES. COMPUTE_ROUTING_PLAN and EGRESS_AUDIT are large and carry retired hosts; fold their live parts into ACCOUNTS and ARCHITECTURE."),
])

CONTRADICTIONS = [
 ("Retired ESM models shown as live (FEATURES.md)",
  "FEATURES.md:134: \"## 9. ESM Representation Models & ESM3 Embedding Shift\"; FEATURES.md:137: \"ESMC-6B & VESM-150M zero-shot sequence constraints: Renders actual, non-fabricated likelihoods\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: \"stop running protein language models on routine analyses. ESM-2 650M, SaProt-35M, VESM-150M, ESMC-6B and the ESM3 embedding reading are no longer computed per variant and no longer shown.\""),
 ("ESM3 colouring still offered (FEATURES.md)",
  "FEATURES.md:41: \"**ESM3 embedding shift**: per-residue cosine distance between wild-type and variant ESM3\"; FEATURES.md:139: \"Generative Local Coordinate Refinement: Leverages ESM3's structural track\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md (same sentence as above): the ESM3 embedding reading is \"no longer shown\"."),
 ("VESM sidecar guard (LIMITATIONS.md)",
  "LIMITATIONS.md:92-95: \"## 8. ESM Model Sequence & Token Constraints ... The local VESM-150M sidecar enforces a strict sequence length guard of 1022 residues\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: \"VESM-150M ... are no longer computed per variant\". The sidecar router it implies (tools/model_server_app/routers/esm3.py, cited in FEATURES.md) is not in the repo."),
 ("VESM required for setup (README.md)",
  "README.md:64: \"*   **Python 3 & uv tool (Required for local VESM sidecar predictions)**\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: VESM-150M is no longer computed. Its own note on tools/model_server_app/models.py:93 says the models were retired."),
 ("Deep-learning sidecars promised a race deadline (ARCHITECTURE.md)",
  "ARCHITECTURE.md:159: \"**Deep Learning Model Sidecars** (`ESM-3`, `ESM-C`, `ESM-2 3B`, `SaProt`): Inside `POST /api/v1/analyze-variant`, deep learning sidecar promises MUST be raced against a **2.5-second fast deadline**\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: the models \"are no longer computed per variant\". ARCHITECTURE.md is dated 11-23, so the section is stale."),
 ("SaProt in the engine readiness list (API.md)",
  "API.md:435: \"Readiness of each engine (FoldX, Box64, RaSP, ThermoMPNN, StabilityOracle, SaProt, JapanFold, P2Rank)\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: SaProt-35M is retired (11-18). API.md is dated 11-24."),
 ("Perturbation tab still in the workspace lists",
  "doc/README.md:65: \"[Residue shifts, Perturbation and Functional domains](MOLECULAR_WORKSPACES_REVIEW.md)\"; .agents/skills/evidence-tab-refactor/SKILL.md:180: \"Residue shifts & pockets, Structural perturbation, Functional domains\"; .agents/skills/verify-missense-resolve/features/evidence.md:20: \"| Structural perturbation | Structural perturbation |\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: \"The Structural perturbation tab goes away.\" The agent skills tell agents to test a tab that no longer exists."),
 ("Perturbation tab still planned or described as live (FUTURE_WORK.md, TRANSLATIONAL_COVERAGE.md, VISUALIZATION_SYSTEM.md)",
  "FUTURE_WORK.md:42: \"Implement a compact 2D pairwise distance change heatmap inside the Perturbation Tab\"; TRANSLATIONAL_COVERAGE.md:33: \"Perturbation model rows | Beside each model | ESM-2, ESM C, VESM and SaProt\"; VISUALIZATION_SYSTEM.md:51 lists Perturbation among the tabs still to do",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: \"The Structural perturbation tab goes away.\""),
 ("Agent engine status lists SaProt (.agents/rules/biophysical-engines.md)",
  ".agents/rules/biophysical-engines.md:53: \"Returns live JSON status for every engine (`foldx_linux_elf`, `foldx_windows`, `box64`, `rasp`, `thermompnn`, `stabilityoracle`, `saprot`, ...)\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md: SaProt is retired (11-18)."),
 ("Production URL: duckdns in the docs vs the workers.dev edge in the owner's notes",
  "README.md:132: \"answers on ports 80 and 443 at `missense-resolve.duckdns.org` ... There is no Cloudflare in front of the site\"; doc/ACCOUNTS.md:9: \"The live site is `https://missense-resolve.duckdns.org`\"; doc/ACCOUNTS.md:202 sets PUBLIC_BASE_URL to the duckdns host",
  "Owner's auto-memory (production-url-workers-edge): \"Production URL is the workers.dev edge — not duckdns\". The memory note is the newer source; confirm before editing the docs."),
 ("Deployment target: single Windows host vs OCI (DEPLOY.md vs README.md)",
  "doc/DEPLOY.md intro: \"deploy the Missense & Fold Explorer application ... as a reliable, secure internal single-tenant lab tool on a Windows host\"; doc/README.md index: \"Setup runbook for a single Windows host using Caddy and PM2\"",
  "README.md:129-131: \"For production environments, the platform runs on an **Oracle Cloud Infrastructure (OCI) Always Free Ampere A1 (ARM64)** instance\""),
 ("DuckDNS allowed in CORS, CSP and the default URL",
  "server/express-config.ts:129-130 allow \"https://*.duckdns.org\" and \"wss://*.duckdns.org\"; server/auth/config.ts:20 sets DEFAULT_PUBLIC_BASE_URL to the duckdns host",
  "Task rule: duckdns is not the user-facing URL; the production URL is the workers.dev edge (owner's memory). The CORS list and default URL should follow the edge host."),
 ("Credential retirement vs the credentials still described (COMPUTE_ROUTING_PLAN.md, EGRESS_AUDIT.md)",
  "doc/COMPUTE_ROUTING_PLAN.md:1452: \"Hugging Face inference: ESM-2, SaProt remote | `x-hf-token` per request\"; doc/EGRESS_AUDIT.md:307: \"### 4.19 GPN-Star (custom endpoint or Hugging Face), 3 rows\"",
  "PROTEIN_LANGUAGE_MODELS_DECISION.md (ESM-2, SaProt retired) and GPN-MSA retirement (2026-11-21, in the owner's notes): Hugging Face and GPN credentials are removed. server/services/external-api/gpn.ts is gone."),
]

def read_decisions():
    out = []
    with open(STAG + "scripts/doc_decisions.tsv", encoding="utf-8") as fh:
        for line in fh:
            area, doc, date, rec, note, n, mp, mi = line.rstrip("\n").split("\t")
            out.append(dict(area=area, doc=doc, date=date, rec=rec, note=note, n=n, mp=mp, mi=mi))
    return out

def fmt_missing(mp, mi):
    p = [x for x in mp.split(";") if x]
    i = [x for x in mi.split(";") if x]
    return f"{len(p)} paths, {len(i)} identifiers" if (p or i) else "none"

def write_docs_md():
    decs = read_decisions()
    counts = Counter(d["rec"].split(" ")[0] for d in decs)
    L = []
    L.append("# Docs reconciliation (Task B)\n")
    L.append("Scope: the 124 top-level `doc/*.md` files, plus the root README and the four overview docs. Method: `scripts/docs_extract.py` reads each doc's first date, its last git commit date, its title, and every backticked path and identifier; it checks paths against the git file list and identifiers (exact-case, whole word) against every word in `src/` and `server/`. Missing items are counted, not all proven gone: some are runtime files (`data/`, FoldX binaries, `deploy/.env.oci`), some are doc-side typos, some are line-numbered paths (`file.ts:123`) that the check reads as missing. Decisions come from reading each doc's status block (`scripts/docs_build.py`).\n")
    L.append(f"Counts: **{counts['KEEP']} KEEP**, **{counts['MERGE']} MERGE**, **{counts['ARCHIVE']} ARCHIVE**. The task said about 90 docs; there are 124 top-level files.\n")
    L.append("Subfolders (listed, not reviewed in depth): `doc/code-map/` (generated tables; `external-apis.csv` lists the DuckDNS hosts), `doc/compute-benchmark/` (1 JSON), `doc/data/` (3 StabilityOracle CSVs), `doc/energetics-release/` (7 release docs, no retired names found), `doc/research/` (8 research files, two of them are revisions of current proposals), `doc/release-audit/` (this audit).\n")
    L.append("## Recommendation per area\n")
    for area, text in AREAS.items():
        L.append(f"### {area}\n")
        L.append(text + "\n")
        L.append("| Doc | Date | Call | Missing refs | Note |")
        L.append("| --- | --- | --- | --- | --- |")
        for d in decs:
            if d["area"] != area:
                continue
            name = d["doc"].replace("doc/", "")
            L.append(f"| {name} | {d['date']} | {d['rec']} | {fmt_missing(d['mp'], d['mi'])} | {d['note']} |")
        L.append("")
    L.append("## Contradictions in the overview docs and the retirements\n")
    L.append("Each row quotes the statement that conflicts, then the source it conflicts with. Task A's retirements are the reference unless noted.\n")
    for i, (title, a, b) in enumerate(CONTRADICTIONS, 1):
        L.append(f"{i}. **{title}**\n   - Says: {a}\n   - Conflicts with: {b}\n")
    L.append("## Archive list\n")
    L.append("ARCHIVE (move to `doc/archive/`):\n")
    L.append(", ".join(d["doc"].replace("doc/", "") for d in decs if d["rec"].startswith("ARCHIVE")) + "\n")
    L.append("MERGE (fold the live facts into the named doc, then archive):\n")
    L.append("; ".join(f"{d['doc'].replace('doc/', '')} into {d['rec'].replace('MERGE INTO ', '')}" for d in decs if d["rec"].startswith("MERGE")) + "\n")
    open(STAG + "docs-reconciliation.md", "w", newline="\n", encoding="utf-8").write("\n".join(L))

def write_retired_md():
    rows = list(csv.DictReader(open(STAG + "retired-names.csv", encoding="utf-8")))
    c = Counter(r["verdict"] for r in rows)
    lu = [r for r in rows if r["verdict"] == "live-use"]
    L = ["# Retired names: live-use summary (Task A)\n"]
    L.append(f"Scan: {len(rows)} case-insensitive, word-bounded hits across `src/`, `server/`, `tests/`, `scripts/`, `tools/`, `public/`, `doc/`, `deploy/`, `.github/`, `.agents/`, the root config files and `README.md`. Verdicts: {c['live-use']} live-use, {c['valid-use']} valid-use, {c['historical-mention']} historical-mention. Full list: `retired-names.csv`.\n")
    L.append("Verdict rules: ESM1b (valid dbNSFP/PP3 score), GBA (valid for myvariant.info and the constraint table, aliased to GBA1), the gnomAD 'Missense Z score' display, and the cleanup of saved retired credentials count as valid-use. Comments, and tests that assert a name stays gone, count as historical-mention. Docs count as live-use only for current docs and agent rules that present a retired feature as live. Other hits are live-use.\n")
    L.append("## Live-use hits in product code and UI (the ones that matter)\n")
    L.append("No live perturbation-tab label remains in product UI. The product-code 'perturbation' hits are comments or the redirect map (src/components/evidence/types.ts:38), and the one live contract field is perturbationScores (contracts.ts:1968).\n")
    L.append("| # | Where | What | Why it is live |")
    L.append("| --- | --- | --- | --- |")
    notes = [
     ("server/auth/config.ts:20", "DEFAULT_PUBLIC_BASE_URL = missense-resolve.duckdns.org", "Default public URL used for invite and reset links. Should be the workers.dev edge (owner's note)."),
     ("server/services/orchestration/payload-assembler.ts:274-280", "declares esm2, esm3Eval, esmcEval and saprotEval provenance", "No server code now writes these fields (grep of server/ shows readers only). The branch only reads older saved payloads. Delete once old analyses are no longer read."),
     ("src/shared/contracts.ts:1957-1968, 2370-2374", "zod schemas for esm2, esm3Eval, esmcEval, saprotEval, perturbationScores", "Schemas still parse stored results. This is the legacy read path. Remove with the saved-analysis migration."),
     ("src/shared/contracts.ts:127, src/services/pipeline/foldxService.ts:410", "vesmModel passed through as provenance", "Field is marked @deprecated (contracts.ts:121), but the energetics provenance still reads it. Older servers stamped VESM_150M_v1 on every run."),
     ("src/shared/providerLimits.ts:40-51", "Hugging Face host labels", "Labels for Hugging Face hosts. The app should no longer call them (GPN-MSA and its HF credential were removed 11-21); check the Python sidecar before deleting."),
     ("src/components/AboutView.tsx:1071", "link to huggingface.co model revisions", "Dead branch: PROVENANCE_MODEL_REVISIONS in src/shared/provenance.ts:53 is an empty object today."),
     ("server/express-config.ts:39, 45, 129-130", "DuckDNS origins allowed by CORS and the CSP connectSrc list", "Accepts the duckdns host and any *.duckdns.org origin. Keep only the edge host and the origin list you actually serve."),
     ("server/agent/setup-page.ts:151", "value=\"https://missense-resolve.duckdns.org\"", "Agent setup page pre-fills the duckdns server address."),
     ("server/services/infra/http-client.ts:64", "User-Agent with duckdns URL", "Outbound identity string; low risk, but it names the old host."),
     ("Caddyfile:16, deploy/rollout.py:127, .github/workflows/cd.yml:96, deploy-drift.yml:62, scripts/canary-check.ts:12, .env.example:52", "duckdns host in ingress, health checks and canary", "Infra still targets duckdns. Change only after the edge host is confirmed."),
     ("tools/pyproject.toml:11, deploy/docker-compose.oci.yml:32-33, scripts/energetics_live/start-test.sh:16", "huggingface_hub dependency and hf_cache volume", "Python sidecar and VM cache still set up for Hugging Face. Remove if no sidecar still uses it."),
     ("src/shared/__tests__/fixtures/gata4Perturbation.ts, slc12a4Perturbation.ts, nae1Result.ts", "fixtures that hold retired-model results", "Test inputs, not product code. Listed in tests-retired-names.csv."),
    ]
    for i, (where, what, why) in enumerate(notes, 1):
        L.append(f"| {i} | {where} | {what} | {why} |")
    L.append("")
    L.append("## Live-use counts by kind\n")
    kinds = Counter(r["kind"] for r in lu)
    L.append(", ".join(f"{k}: {v}" for k, v in kinds.most_common()) + "\n")
    L.append("Doc live-use hits are listed by file in `retired-names.csv` (kind `doc`). The ones that matter are in docs-reconciliation.md, under Contradictions.\n")
    L.append("## Test-only live-use files\n")
    tf = Counter(r["file"] for r in lu if r["kind"] == "test")
    L.append("; ".join(f"{f} ({n})" for f, n in tf.most_common()) + "\n")
    open(STAG + "retired-names-summary.md", "w", newline="\n", encoding="utf-8").write("\n".join(L))

write_docs_md()
write_retired_md()
print("written")
