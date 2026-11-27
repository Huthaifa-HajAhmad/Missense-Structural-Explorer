# Retired names: live-use summary (Task A)

Scan: 1524 case-insensitive, word-bounded hits across `src/`, `server/`, `tests/`, `scripts/`, `tools/`, `public/`, `doc/`, `deploy/`, `.github/`, `.agents/`, the root config files and `README.md`. Verdicts: 288 live-use, 301 valid-use, 935 historical-mention. Full list: `retired-names.csv`.

Verdict rules: ESM1b (valid dbNSFP/PP3 score), GBA (valid for myvariant.info and the constraint table, aliased to GBA1), the gnomAD 'Missense Z score' display, and the cleanup of saved retired credentials count as valid-use. Comments, and tests that assert a name stays gone, count as historical-mention. Docs count as live-use only for current docs and agent rules that present a retired feature as live. Other hits are live-use.

## Live-use hits in product code and UI (the ones that matter)

No live perturbation-tab label remains in product UI. The product-code 'perturbation' hits are comments or the redirect map (src/components/evidence/types.ts:38), and the one live contract field is perturbationScores (contracts.ts:1968).

| # | Where | What | Why it is live |
| --- | --- | --- | --- |
| 1 | server/auth/config.ts:20 | DEFAULT_PUBLIC_BASE_URL = missense-resolve.duckdns.org | Default public URL used for invite and reset links. Should be the workers.dev edge (owner's note). |
| 2 | server/services/orchestration/payload-assembler.ts:274-280 | declares esm2, esm3Eval, esmcEval and saprotEval provenance | No server code now writes these fields (grep of server/ shows readers only). The branch only reads older saved payloads. Delete once old analyses are no longer read. |
| 3 | src/shared/contracts.ts:1957-1968, 2370-2374 | zod schemas for esm2, esm3Eval, esmcEval, saprotEval, perturbationScores | Schemas still parse stored results. This is the legacy read path. Remove with the saved-analysis migration. |
| 4 | src/shared/contracts.ts:127, src/services/pipeline/foldxService.ts:410 | vesmModel passed through as provenance | Field is marked @deprecated (contracts.ts:121), but the energetics provenance still reads it. Older servers stamped VESM_150M_v1 on every run. |
| 5 | src/shared/providerLimits.ts:40-51 | Hugging Face host labels | Labels for Hugging Face hosts. The app should no longer call them (GPN-MSA and its HF credential were removed 11-21); check the Python sidecar before deleting. |
| 6 | src/components/AboutView.tsx:1071 | link to huggingface.co model revisions | Dead branch: PROVENANCE_MODEL_REVISIONS in src/shared/provenance.ts:53 is an empty object today. |
| 7 | server/express-config.ts:39, 45, 129-130 | DuckDNS origins allowed by CORS and the CSP connectSrc list | Accepts the duckdns host and any *.duckdns.org origin. Keep only the edge host and the origin list you actually serve. |
| 8 | server/agent/setup-page.ts:151 | value="https://missense-resolve.duckdns.org" | Agent setup page pre-fills the duckdns server address. |
| 9 | server/services/infra/http-client.ts:64 | User-Agent with duckdns URL | Outbound identity string; low risk, but it names the old host. |
| 10 | Caddyfile:16, deploy/rollout.py:127, .github/workflows/cd.yml:96, deploy-drift.yml:62, scripts/canary-check.ts:12, .env.example:52 | duckdns host in ingress, health checks and canary | Infra still targets duckdns. Change only after the edge host is confirmed. |
| 11 | tools/pyproject.toml:11, deploy/docker-compose.oci.yml:32-33, scripts/energetics_live/start-test.sh:16 | huggingface_hub dependency and hf_cache volume | Python sidecar and VM cache still set up for Hugging Face. Remove if no sidecar still uses it. |
| 12 | src/shared/__tests__/fixtures/gata4Perturbation.ts, slc12a4Perturbation.ts, nae1Result.ts | fixtures that hold retired-model results | Test inputs, not product code. Listed in tests-retired-names.csv. |

## Live-use counts by kind

doc: 165, test: 86, code: 36, ui-text: 1

Doc live-use hits are listed by file in `retired-names.csv` (kind `doc`). The ones that matter are in docs-reconciliation.md, under Contradictions.

## Test-only live-use files

tests/fixtures/predictor-gata4.json (17); server/services/orchestration/payload-assembler.test.ts (10); src/shared/__tests__/fixtures/gata4Perturbation.ts (6); src/components/inspector/PredictorsRail.test.tsx (5); src/shared/__tests__/fixtures/slc12a4Perturbation.ts (5); server/tests/sidecar-budget.test.ts (5); src/shared/__tests__/deepModelEvidence.test.ts (4); src/context/__tests__/SettingsContext.test.tsx (3); server/services/infra/review-fixes.test.ts (3); server/services/orchestration/analysis-orchestrator.test.ts (3); src/components/inspector/EnergeticsInspector.test.tsx (2); src/components/__tests__/DevConsolePanel.test.tsx (2); src/components/__tests__/PredictorsTab.test.tsx (2); src/services/pipeline/__tests__/biophysicalService.test.ts (2); src/services/pipeline/__tests__/resultMerge.test.ts (2); src/shared/__tests__/energeticsEvidence.test.ts (2); server/services/infra/analysis-db.test.ts (2); tools/test_engine_resilience.py (2); src/api/__tests__/structuralStream.test.ts (1); src/context/__tests__/logSource.test.ts (1); src/shared/__tests__/contracts.test.ts (1); src/shared/__tests__/predictorEvidence.test.ts (1); src/shared/__tests__/fixtures/nae1Result.ts (1); server/routes/auth.test.ts (1); server/routes/variant/analysis.test.ts (1); server/services/orchestration/core-singleflight.test.ts (1); server/services/stability/foldx-queue-job.test.ts (1)
