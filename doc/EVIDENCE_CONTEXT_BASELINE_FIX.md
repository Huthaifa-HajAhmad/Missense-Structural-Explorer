# Deployed baseline audit — 2026-10-06

The deployed RGS9 example exposed a missed integration requirement: public variant analysis
worked without keys, but all three new reference-evidence reads required credentials.
Direct deployed requests returned HTTP 401, which the client incorrectly called a provider
error. Fixture reviews and authenticated route tests did not exercise that user journey.

| Finding | Correction |
|---|---|
| Keyless reads rejected; disease selector empty and disabled | Allow only the three existing context GET routes through auth middleware; retain rate limiting, symbol validation and authentication for writes/other paths. Test the actual router without credentials. |
| Gemini authentication could delay otherwise public evidence | Skip session renewal for those public GETs; regression test uses an expired session. |
| HTTP rejection, timeout and response-validation failure all looked like provider errors | Preserve a safe, specific transport failure message. Source-level errors and missing installations remain distinct. |
| All expression measurements hidden by default | Show six highest measured medians for each source immediately, with full tables expandable. Ordering is descriptive, with tissue/cohort and sampling counts retained. |
| Export and repeated caveat UI unwanted | Remove both export controls and their component, the context badge, and the gene–disease navigation footer. Scientific boundaries remain in the evidence model and inspector. |

Local browser verification uses real requests, installed GenCC/G2P/dGTEx snapshots and live
adult GTEx, without credentials: RGS9 returns two disease choices, 54 adult tissues and
125 pediatric tissue/cohort observations. Disease selection works and is reflected in
the inspector. Light/dark and 820/1280 pixel review use a temporary reference harness;
no variant analysis is run. This does not establish production snapshot installation.

Production needs two separate actions: deploy the corrected code and install the operator's
validated source artifacts in the mounted data directory. A code merge alone cannot install
ignored snapshots. Run the existing import/install procedure in
[the runbook](EVIDENCE_CONTEXT_IMPLEMENTATION_AUDIT.md#production-runbook), then:

```powershell
node scripts/check-evidence-context.mjs https://missense-resolve.duckdns.org RGS9
```

The smoke check requires usable evidence and provenance from all sources, including G2P,
and reports HTTP errors separately from missing source states. It never installs or updates
data. Production installation remains unverified until this check passes on the deployed
revision. HPO suggestions, animal models, complementary atlases and report integration
remain the previously agreed next slices. ACMG logic is unchanged.

Validation: lint/typechecking and the full JavaScript suite passed (4,020 tests, five skipped).
Production client compilation passed. The native esbuild CLI could not write output files
in this Windows worktree (“Access is denied”); the identical server/worker bundle options
compiled successfully using esbuild's in-memory output and Node file writes. This is a
local build-environment limitation; normal CI build verification is still required.
