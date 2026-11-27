# Final verdicts for the retired-name hits (Task A). Rules are per term and per file;
# comments always count as historical; guard tests that assert a name stays gone count as historical.
import csv, re, sys
from collections import Counter
sys.stdout.reconfigure(encoding="utf-8")

rows = list(csv.DictReader(open("retired-candidates.csv", encoding="utf-8")))

CURRENT_DOCS = {
    "README.md", "doc/README.md", "doc/FEATURES.md", "doc/LIMITATIONS.md", "doc/PRD.md",
    "doc/ARCHITECTURE.md", "doc/API.md", "doc/DEPLOY.md", "doc/ACCOUNTS.md", "doc/FUTURE_WORK.md",
    "doc/VISUALIZATION_SYSTEM.md", "doc/STATE_MACHINES.md", "doc/GNOMAD_CONSTRAINT.md", "doc/AGENT.md",
    "doc/EGRESS_AUDIT.md", "doc/TRANSLATIONAL_PHILOSOPHY.md", "doc/TRANSLATIONAL_COVERAGE.md",
    "doc/CALIBRATED_STACKING.md", "doc/COMPUTE_ROUTING_PLAN.md", "doc/RASP_DATA.md", "doc/LOCAL_DBNSFP_UPGRADE.md",
    "doc/RESOLVER_CONCORDANCE.md", "doc/VERIFIED_RESIDUE_DESIGN.md", "doc/WORKSPACE_REDESIGN.md",
}
ABSENT_RX = re.compile(r"retir|removed|no longer|dropped|replaced|used to|was |were |never|not |must not|rejected|historic|before 20", re.I)
COMMENT_RX = re.compile(r"^\s*(//|\*|/\*|#|<!--|\{/\*)")

# Whole-file verdicts (non-doc files). Value = verdict.
FILE_VERDICT = {
    # Cleanup of saved retired credentials: valid, removes the old secrets.
    "src/context/SettingsContext.tsx": "valid-use",
    "server/auth/store.ts": "valid-use",
    "server/auth/retired-secrets.test.ts": "valid-use",
    # Tolerant read of stored analyses and the legacy GBA alias.
    "src/shared/contracts.ts#1567": "valid-use",
    "src/variantAnalysisUtils.ts": "valid-use",
    "server/services/infra/gene-symbols.ts": "valid-use",
    "server/services/infra/gene-symbols.test.ts": "valid-use",
    "server/services/external-api/clinvar.test.ts": "valid-use",
    "server/services/external-api/gnomad-gene-constraint.test.ts": "valid-use",
    "server/services/external-api/string.test.ts": "valid-use",
    "server/services/prediction/predictors/vep-orchestrator.test.ts": "valid-use",
    "server/invariants.test.ts": "valid-use",
    "server/services/prediction/predictors/conservation-streaming.test.ts": "valid-use",
    "src/services/pipeline/__tests__/narrativeService.test.ts#legacy": "valid-use",
    # Unrelated senses of the same word (gnomAD Z display, lockfile hashes, package names, benchmark-free UI).
    "src/components/header/constraintMetrics.ts": "valid-use",
    "src/components/__tests__/VariantHeader.test.tsx": "valid-use",
    "src/shared/spatialClustering.ts": "valid-use",
    "tools/agent-tooling/package-lock.json": "valid-use",
    "tools/agent-tooling/cli.cjs": "valid-use",
    "src/components/evidence/ModelPhenotypesCard.tsx": "valid-use",
    "src/components/evidence/types.ts": "valid-use",
    "src/components/evidence/__tests__/normalizeEvidenceTab.test.ts": "valid-use",
}
# Retired research scripts kept as a record (not imported by the app).
HISTORICAL_PREFIX = ("scripts/tolerance_benchmark/", "scripts/perturbation_benchmark/", "scripts/primary_predictor_benchmark/")

# Current docs / agent rules / generated tables: lines saying a name is live are "live-use".
CURRENT_DOCS |= {"doc/COMPUTE_ROUTING_PLAN.md", "doc/EGRESS_AUDIT.md", "doc/TRANSLATIONAL_COVERAGE.md"}
LIVE_DOC_PREFIX = (".agents/", "doc/code-map/")

# Hand-checked lines that look live but are CSS or doc comments, or guard tests that assert a name stays gone.
HAND_HISTORICAL = {
    "src/styles/evidence.css:105", "src/styles/evidence.css:244", "src/styles/packing.css:6",
    "tools/model_server_app/models.py:93",
    "src/hooks/__tests__/useCredentialUseNotice.test.ts:23",
    "src/shared/__tests__/redactSecrets.test.ts:16", "src/shared/__tests__/redactSecrets.test.ts:21",
    "server/services/infra/provider-pause.test.ts:223", "server/routes/capabilities-egress.test.ts:59",
    "server/services/orchestration/core-identity.test.ts:98", "server/services/orchestration/core-identity.test.ts:99",
    "server/routes/credentials.http.test.ts:124", "server/routes/public-endpoints.test.ts:161",
    "server/services/prediction/acmg/pp3-bp4-language-models.test.ts",
}

def verdict(r):
    term, rel, kind, snip, line = r["term"], r["file"], r["kind"], r["snippet"], r["line"]
    if f"{rel}:{line}" in HAND_HISTORICAL or rel in HAND_HISTORICAL:
        return "historical-mention"
    if term == "ESM1b":
        return "valid-use"
    if kind == "doc":
        if rel in CURRENT_DOCS or rel.startswith(LIVE_DOC_PREFIX):
            return "historical-mention" if ABSENT_RX.search(snip) else "live-use"
        return "historical-mention"
    if term == "ESM1b":
        return "valid-use"
    if term == "GBA":
        return "valid-use"
    if term == "gene-Z":
        return "valid-use"
    if rel.startswith(HISTORICAL_PREFIX):
        return "historical-mention"
    if rel in FILE_VERDICT:
        return FILE_VERDICT[rel]
    if rel == "src/shared/contracts.ts" and line == "1567":
        return "valid-use"
    if rel == "src/services/pipeline/__tests__/narrativeService.test.ts" and line in {"341", "622"}:
        return "valid-use"
    if term in {"MetaDome", "MTR3D", "CCR", "residue-tolerance"}:
        return "historical-mention"
    if kind == "comment" or COMMENT_RX.search(snip):
        return "historical-mention"
    if kind == "test" and (ABSENT_RX.search(snip) or re.search(r"not\.|toBeNull|toBeUndefined|toBe\(false\)|retire", snip, re.I)):
        return "historical-mention"
    if term in {"HuggingFace", "biohub", "GPN"} and re.search(r"deleted|purge|strip|delete|retired|refus|not accepted|400|tolerant|legacy|unknown", snip, re.I) and kind != "ui-text":
        return "historical-mention" if kind == "test" else "valid-use"
    if rel.startswith("tools/agent-tooling/") or rel.endswith(".lock") or "package-lock" in rel:
        return "valid-use"
    return "live-use"

out = []
for r in rows:
    v = verdict(r)
    if r["term"] == "duckdns" and r["kind"] == "comment":
        v = "historical-mention"
    out.append([r["term"], r["file"], r["line"], r["kind"], r["snippet"][:200], v])

with open("retired-names.csv", "w", newline="\n", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["name", "file", "line", "kind", "snippet", "verdict"])
    w.writerows(out)

print(len(out), "rows")
print(Counter(o[5] for o in out))
print(Counter((o[5], o[3]) for o in out if o[5] == "live-use"))
