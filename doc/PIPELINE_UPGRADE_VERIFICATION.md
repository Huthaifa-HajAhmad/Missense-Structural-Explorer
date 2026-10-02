# Pipeline upgrade: behavior, boundaries, and verification

## Runtime contract

Core evidence, structures, energetics, independent enrichment, and optional AI synthesis have separate lifetimes. Opening Report is not a prerequisite for any other tab.

- First real evidence opens the workspace. Intake/core flags, not AI or background solver flags, determine whether submission is busy.
- Landscape, structural models, and multimer requests begin after dispatching core, not after waiting for its response. Structure/pocket work is independent; missing accessions defer structure/FoldX until core supplies a reference.
- A final core response cannot erase earlier landscape, multimer, or deep-model results. A structural-owned rule snapshot survives a later core snapshot, including degraded structural outcomes.
- Every run has a unique identity. Late writes and narrative installs from a superseded run cannot replace the current workspace. Cancelled traces have an ending time and are not provider faults; the first terminal trace outcome wins.
- Failed, running, or refused core is not made reusable by optional prose. Compatible completed core can be reused with an empty narrative. Failed optional prose is discarded separately from completed scientific evidence.

### AI modes

| Mode | Automatic requests | Report control |
| --- | --- | --- |
| Automatic | Initial synthesis; at most one freshness-driven refresh after the initial enrichment cohort settles | Explicit resynthesis |
| On demand | None | Explicit synthesis |
| Off | None | Enable AI synthesis in settings |

Late remote-engine results can make a narrative outdated; they do not start a polling-driven resynthesis loop. Manual and automatic requests share run-scoped flights. The evidence stamp records the actual bounded fast/deep snapshot supplied to synthesis, not merely what was available at core completion.

Deep predictions remain correlated computational observations, not functional assays. The prompt forbids adding counted criteria from them or inferring PS3 from predicted ΔΔG. This work did **not** change deterministic classification cut-points or criterion definitions. Missing model/version provenance is reported as unrecorded, not filled with configured or invented version labels.

## Cache and computation identity

Client interpretation identity includes reference accession, weighting, SaProt checkpoint, submitted/resolved build-coordinate pairs, numbering declaration, direction identity, simulation semantics, and provider capability/endpoint identity. Interpretation mismatch does not automatically discard compatible coordinates. Unknown or mismatched references cannot borrow another isoform's artifacts. Changed simulation semantics discard mutant/paired-WT/energetics/job fields.

- Client direction/endpoint fingerprints avoid storing raw text in the identity record. They are **not encryption or an authorization boundary**. Prompts and generated prose may still contain user-provided text: do not submit patient identifiers.
- Server running-core singleflight is scientific/auth sensitive. Structural-only SaProt checkpoint choice does not split the core flight; it still separates structural cache provenance.
- Unstamped persisted analysis rows are refetched once. Stable custom-provider identity uses HMAC with `CACHE_IDENTITY_SALT`, falling back to `APP_SESSION_SECRET`, then a process-local random key. Rotation invalidates custom-endpoint compatibility; it does not authorize a request.
- Persistence is observed and non-rejecting, but response readiness does not wait for its write.
- Structure references bind exact text and provenance. The bounded server registry and bounded client registry avoid repeatedly uploading trusted structures. A stale reference retries the exact text once; reference-only misses never silently select another UniProt structure.
- Core `esm2` describes VESM; structural `esm2Eval` describes the separate structural ESM-2 evaluation. Their outcomes no longer overwrite one another.

## FoldX conditions: explicit units

The UI collects Celsius and millimolar. FoldX accepts [Kelvin](https://foldxsuite.crg.eu/parameter/temperature) and [Molar](https://foldxsuite.crg.eu/parameter/ionStrength).

```text
UI 25 °C / 150 mM -> submitted 298.15 K / 0.15 M
pH is preserved.
```

Conversion happens once, at the first-party client boundary. The native server API remains Kelvin/Molar for existing callers. Numeric strings are normalized; present invalid values are rejected rather than silently defaulted or clamped. Cache stamps distinguish submitted UI conditions, omitted native defaults, and unusable inputs. Older unit-unversioned artifacts cannot match these stamps.

The UI defaults (pH 7.4, 25 °C, 150 mM) are **not** the native FoldX defaults (pH 7.0, 298 K, 0.05 M). Shared constants and regression tests protect that distinction.

## Speculative warming and cancellation

`PREWARM_FOLDX_ENABLED` is off by default and enabled only by the exact string `true`; test environments never dispatch it. Eligible work requires canonical numbering and declared/default-compatible native conditions. The stream route does not prewarm.

Within one process, prewarm and interactive FoldX submissions use the same cleaned-structure/mutation/condition identity and a pending-submission reservation. A reader can join a prewarm job without owning its cancellation. Claim release is owner-token guarded in memory, SQLite, and Redis. Queue and running phases have separate budgets; no absolute pre-submission watchdog declares legitimate queued work timed out.

**Retained limitation:** the submission reservation and active-job map are process-local. Multiple replicas can still submit duplicate work. Distributed atomic reservation would need a separate shared-store/queue design; it is not claimed here.

RaSP/StabilityOracle worker legs were deliberately retained: removing them from an in-flight prewarm would also remove them from a reader adopting that job. Their speculative cost exists only when warming is explicitly enabled.

## Honest telemetry

- Source/model durations are measured, including failed or budget-expired waits; no fabricated 50 ms model bars.
- Server offsets mark **settlement**. Consumers recover start with `max(0, settlement - duration)`.
- Structural timings have a separate namespace and do not overwrite core timings.
- Fast responses are not presumed cached. Core cache provenance comes from the server; structure spans omit a cache flag unless an API explicitly reports it.
- Coordinate readiness requires actual loaded text. Pocket readiness is not inferred from FoldX. Literature readiness comes from an actual query. Partial energetics remain available while other engines run.

## Source map

```text
src/services/pipeline/workflowOrchestrator.ts      Run/stage lifecycle and independent dispatch
src/services/pipeline/resultMerge.ts               Stage ownership and reusable-core checks
src/services/pipeline/analysisContext.ts            Scientific/capability and unit identity
src/services/pipeline/variantCache.ts               Artifact/interpretation separation
src/shared/biophysicsConditions.ts                  UI/native conversion and validation
src/shared/deepModelEvidence.ts                    Bounded scientific projection
src/shared/narrativeEvidence.ts                    Evidence revision and freshness
src/shared/narrativeResynthesis.ts                 Shared synthesis and stage-owned install
src/shared/workflowStatus.ts                       Evidence-led readiness
server/services/orchestration/core-singleflight.ts Shared in-flight core graph
server/services/orchestration/timeout-scope.ts     Disposable budgets; not cancellation
server/services/infra/foldx-job-registry.ts         Process-local FoldX submit/join reservation
server/services/infra/prewarm-manager.ts           Typed, default-off warming policy
server/services/structure/structure-reference-store.ts Exact text/provenance references
.env.example                                      Optional AI, warming, identity-key configuration
```

## Verification

The integrated `npm run verify` gate passed on the full shared working tree (including the separately uncommitted deployment/console work):

- TypeScript, architectural boundaries, focus indicators, and CI/local gate parity.
- 10 deployment regression tests.
- 3,326 Vitest tests passed; 5 skipped, across 260 passing files and 2 skipped files. Coverage collection passed; this is not a claim of complete coverage.
- Rendered header geometry: 61 assertions. Rendered function-track geometry: 173 assertions.
- Production client, server, both workers, and protobuf artifact builds.

The initial full-suite run caught a stale copy assertion, which was updated to assert that evidence and rule-based classification work without Gemini. A later parallel filesystem fixture race was corrected by isolating each test file's redirected state directory, observing the atomic cache-write boundary instead of sleeping 150 ms, and cleaning only that exact redirected file. Controlled promise tests cover early enrichment, held optional work, completion-order merges, missing-accession deferral, old-run rejection, degraded-cache repair, and real timing/cache provenance.

Commit-isolation verification exported the exact selected index without the unrelated deployment/console redesign: lint/TypeScript and 3,295 tests passed (5 skipped), and the client build passed. The isolated native server bundler compiled but could not write its output into the Windows temporary export directory (Access denied); that isolated artifact write is not claimed as passing. The full shared-workspace production build above did pass.

No live end-to-end provider latency benchmark was performed. Existing outbound PDB singleflight and configured FoldX concurrency were retained; repeated consumers were not assumed to imply repeated downloads or serialized execution. Build output still warns about large client/Molstar chunks and upstream Zod purity annotations. Those warnings do not fail the build and are not claimed resolved by this runtime change.
