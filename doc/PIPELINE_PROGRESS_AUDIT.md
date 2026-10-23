# Pipeline progress audit

Date: 2026-10-22. Scope: intake, concurrent client branches, shared server core fetch, streamed delivery, evidence context prefetch, partial-result merges, readiness, optional synthesis, cache reuse and finalization.

## Finding

The pipeline already executes substantial work concurrently, but concurrency did not guarantee early visibility. The main stream buffered every completed source behind ClinVar plus the entire predictor result. Independently, gene-context prefetch existed only inside the Evidence view. Staying on Search therefore postponed those requests; Expression and Species & models were explicitly loaded on tab entry.

A screenshot of the final status cannot establish individual source timings. These findings come from control-flow inspection and controlled unresolved-promise regression tests, not an inferred latency measurement of the supplied IL10RB run.

## Changes made

- `analysis-orchestrator.ts`: publish each cumulative core snapshot immediately, including resolved variant identity and the full source-status map. An early UniProt result no longer waits for ClinVar or predictors. Suppress a later triage snapshot once a core snapshot has arrived, preventing status regression. Race initial triage against the bounded shared core completion, so an unresolved upstream promise cannot hold the stream open beyond that completion. Preserve ordered indices, one final authoritative frame, heartbeat behavior and cache provenance.
- `core-singleflight.ts`: retain one latest cumulative snapshot and synchronously replay it to a late subscriber before future updates. No duplicate provider work and no history replay that could regress statuses.
- `App.tsx` / `EvidenceContextPrefetch.tsx`: mount context prefetch independently of the selected view. Warm disease, dosage, human expression and model-organism context after the existing short priority delay. Existing per-gene caches, in-flight deduplication, validation and timeouts remain in charge of these reads.
- Sidebar and splicing evidence: use source/stage status rather than a missing numeric value or the global loading flag to infer work in progress. Explicitly settled failures no longer look like still-running SpliceAI. Population and functional-domain requests now get loading indicators too.
- Evidence progress description: disclose that partial evidence is available while remaining sources load.
- Workflow finalization: completion of awaited enrichment must not mark an independent coordinate fetch complete or clear the pocket request's loading flag. Those requests own their completion.

## Dependency analysis

1. Intake must resolve a defensible gene/protein/variant identity before scientific work. Genomic build and allele verification are real dependencies and must not be skipped for speed.
2. After intake, coordinates, energetic jobs, the evidence stream, landscape, structural assessments, assembly and interaction requests can begin independently. The client already launches these branches without awaiting core completion.
3. Within core, ClinVar, UniProt features, STRING, PDB mapping and ESM-2 can answer independently. Population frequency, constraint and allele-specific predictors depend on verified locus information. Speculative locus execution has identity reconciliation and must preserve it.
4. Each core source publishes a cumulative snapshot. Pending means not yet assessed, not a negative finding; errors/timeouts must never become absence evidence. Final payload assembly and rule-based interpretation remain authoritative.
5. Gene-context requests are separate from core. Their own statuses and caches should be assessed independently of the parent Evidence badge.
6. Optional narrative starts after core and may refresh once after enrichment. Navigation and evidence export already have independent readiness. Energetic polling continues on its own lifecycle.
7. Coordinate and pocket work may outlive the awaited enrichment cohort. Completion of one cohort cannot settle these tasks.

## Follow-up (same day): per-model conservation and usable-vs-settled

- `conservation-orchestrator.ts`: the composite no longer joins its models with `Promise.all`. Base dbNSFP, ConSurf, locus/refusals, PopEVE, GPN-Star (Tabix and HF), AlphaGenome, live SpliceAI and splice geometry each settle independently and publish a cumulative snapshot carrying `modelStatus` (`pending`/`settled`/`timeout`). A field whose primary source has not answered is withheld even when its fallback is in hand (a frozen dbNSFP SpliceAI never flashes before the live score replaces it). The final return carries no `modelStatus` and is computed by the same merge as before.
- `core-data-fetcher.ts`: snapshots are forwarded while `conservationData` stays `pending`. Under applied locus speculation, snapshots of the speculative run wait for confirmation and are dropped if it is discarded. The provisional ACMG verdict ignores a pending composite (the engine reads the ensemble without a status gate, so a REVEL-only snapshot would have voted as the whole ensemble). On budget expiry the answered models are kept, unanswered ones marked `timeout`, and the status stays `timeout`; previously one slow model discarded REVEL, BayesDel and a SpliceAI score already in hand.
- Client: `conservationProgress.ts` resolves per-model state. Splicing shows a streamed SpliceAI score but holds the PP3/BP4 rule until geometry and dbscSNV settle, and names a SpliceAI timeout. AlphaGenome shows "Scoring this variant" instead of "No AVI score" while in flight.
- `evidenceTabProgress.ts`: one per-tab answer for sidebar indicators, Evidence row and search rail, now including Gene–disease, Expression and Species & models. The Evidence row reads "Usable now · Still loading: …" until every tab settles, then "complete".
- Other defects found and fixed: the partial-evidence description rendered a literal "?" instead of "·". AlphaGenome "Re-evaluate" re-ran core without build, coordinates or ACMG weighting, then replaced the whole conservation composite and the verdict. It now sends the run's identity and replaces only the AlphaGenome reading and its refusal. The SpliceAI window control and AlphaGenome re-evaluation are locked while the composite streams, so a later snapshot cannot overwrite the user's re-score.

## Review follow-up

- PP3/BP4 are withheld whenever a voting model of a salvaged composite (dbNSFP ensemble, PopEVE, AlphaGenome) did not answer (`acmg/criteria.ts`), so a timeout verdict is never computed from a known-incomplete ensemble. The self-healer now settles only the models its Genos row supplied and keeps the composite `timeout` otherwise.
- Tab re-scores (SpliceAI window, AlphaGenome re-evaluate) stay locked until the core stage is terminal, because the final core payload replaces `conservationData` after the composite settles. Re-evaluate forwards `numberingBasis` and replaces only the AlphaGenome reading.
- The Evidence row names only tabs backed by the analysis run. Optional gene-context tabs (disease, expression, models; some with 2-minute timeouts) keep their own indicator and do not hold "usable". Prefetch still adds automatic egress for those requests.
- `spliceaiDistance` is part of the shared in-flight run key. A failed composite with nothing salvaged reads as "not assessed". The splicing rule now waits only for SpliceAI, its sole input.
- Known and deliberate: under applied speculative-locus mode, a budget expiry before the speculation is confirmed salvages nothing, because an unconfirmed locus could describe a different allele. This path has no dedicated test.

## Remaining architectural limitations and recommended next design

These are deliberately distinguished from the delivery defects corrected above:

- Context prefetch now creates more automatic network work (the same requests previously triggered by visiting tabs). It shares in-flight work and remains bounded by existing endpoint timeouts, but has no cross-provider concurrency scheduler. Measure provider pressure before increasing the fan-out further.
- Core budgets bound response latency but do not necessarily cancel every underlying provider computation. Shared work should continue while other subscribers need it; last-subscriber cancellation requires explicit ownership rather than aborting all callers together.
- Some workflow cleanup still settles awaited stages generically. Prefer task-owned terminal states throughout, with explicit degraded/error outcomes, rather than inferring success from promise settlement.
- Evidence delivery timings are recorded, but no fresh cold-run latency distribution was measured in this audit. Measure time to first usable result, each tab's first usable/settled time, and final settlement separately. Whole-analysis duration hides the inconvenience the user reported.

The target architecture is a dependency-aware task registry with independent publication and task-owned state transitions. A workspace can be usable while incomplete; failure of one source must leave successful evidence available. Status should distinguish queued, running, available-but-enriching, complete, unavailable, failed and cancelled without deriving scientific claims from empty fields.

## Verification

- Controlled stream regression: hold ClinVar unresolved, publish UniProt, assert the preview is immediately visible, then complete core and assert exactly one final frame.
- Shared-run regression: a late subscriber immediately receives already-computed evidence without another provider fetch.
- Workflow regression: hold coordinate fetching unresolved while other work finishes; coordinates remain running until their actual result arrives.
- Prefetch regression: human and model context loads without opening a tab; remounting joins pending reads.
- Splicing regressions: settled conservation failure overrides global loading; explicit pending overrides an absent global flag.
- Focused pipeline, status and context suites passed; repository lint (boundaries, focus checks, verification parity and TypeScript) passed.
- Browser smoke passed. Real-route PAH benchmark test passed through every Evidence tab. This verifies navigation/rendering, not a cold-provider performance guarantee. Browser artifacts: `.e2e/proof/pipeline-smoke/` and `.e2e/proof/pipeline-evidence/`.
