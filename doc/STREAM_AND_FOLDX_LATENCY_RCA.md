# Progressive Streaming & FoldX Latency — RCA and the Changes That Followed

**Status:** implemented. Every claim below was measured against this tree before the fix and is
pinned by a test after it.
**Scope:** two reports from a live run — (1) fetched data did not populate "first get, first show",
it appeared to wait or block; (2) the 3D repacking (FoldX) always finishes last and stays spinning.

---

## 1. First get, first show: three independent defects

### 1.1 A re-query inherited the request its own abort had just killed

`getDeduplicatedPromise` keyed in-flight requests by `biophysical_<gene>_<variant>_<uniprot>` — no
run identity, no signal — while `useAnalysisPipeline.executeAnalysis` aborts the previous run and
*synchronously* starts the next one. For any repeated query (a preset clicked twice, Search pressed
again, a history row re-opened) the aborted run's entry was still in the table, so run 2 was handed
run 1's doomed promise.

Measured (real function, fake client):

```
REQUESTS ISSUED BY THE CLIENT: 1
RUN 2 OUTCOME: rejected: Biophysical analysis stream aborted by client.
RUN 2's OWN SIGNAL ABORTED? false
```

**Fix.** Entries carry the signal they were created under; an aborted entry is evicted eagerly on
`abort` and defensively on lookup, and settlement deletes only its own entry.
`src/variantAnalysisUtils.ts`, with every pipeline call site (`biophysicalService`, `structureService`)
passing its run's signal. Tests: `src/__tests__/deduplicatedPromise.test.ts`.

### 1.2 The first chunk was discarded; nothing could paint before the structure resolved

`onChunk` merged into `prev.result` and returned `prev` untouched when there was none — while
`result` was created only by the structure warm-up. The fast triage payload (ClinVar + predictors,
the two most expensive round trips in the run) was fetched, delivered and thrown away.

Measured (structure fetch held open):

```
EVENTS: structure-fetch-started -> chunk1-arrives
RESULT AFTER CHUNK1: null (nothing rendered)
RESULT AFTER STRUCTURE RESOLVED: {"clinvar":null,"predictorData":null}
```

**Fix.** The first chunk that carries data seeds the placeholder itself, so the shell renders with
real evidence and `baseParams` is built once, before the pipeline's network calls (it was declared
after the chunk handler's closure, which alone would have been a TDZ hazard).
`src/services/pipeline/workflowOrchestrator.ts`. Test:
`src/services/pipeline/__tests__/progressiveFirstPaint.test.ts` — which also asserts the mirror
error: no placeholder is created *before* the first chunk, because an empty dashboard that claims
evidence is arriving is its own lie.

### 1.3 The "progressive" stream was two chunks, and the client's patience was shorter than the server's own budget

`streamCoreAnalysis` emitted chunk 1 and then chunk 2 only after **all eleven** remaining sources had
settled in one `Promise.all` — i.e. after the slowest. Each is raced against
`CONFIG.timeouts.coreAnalysisMs` = 45 s, while the client aborted the body after 30 s of silence.

Measured (real client function, one chunk then silence):

```
CHUNKS RECEIVED BEFORE THE GAP: [{"clinvar":{"classification":"Pathogenic"}}]
OUTCOME AFTER 31s OF SILENCE: rejected: Streaming connection stalled: no data received for 30s.
```

This hazard class was already recorded as **M4** in `UNMAPPING_DEFECT_SPLICE_AUDIT.md`; that audit
narrowed one contributor instead of reconciling the two clocks.

**Fix — two halves, because either alone is insufficient.**

* The server now emits **one preview per settled source** (`fetchCoreVariantData(..., onPartial)`),
  and each preview carries the **full running status map** — all ten sources, unsettled ones as
  `"pending"`. That totality is not decoration: a map that merely omits a source is indistinguishable
  downstream from one that measured it as empty, and `frequencyEvidence` renders `pending` as "still
  running" while `not_found` reads as a confirmed rarity (PM2 ceiling). Each status is derived by ONE
  function that the final payload also uses, so a preview and its payload can never describe the same
  source differently.
* The stream **heartbeats** every `STREAM_HEARTBEAT_MS` (5 s) from the moment it opens — including
  during the fast triage, which is the run's first silence. The client ignores heartbeats in the data
  path and keeps its silence bound for what it can actually detect: a dead transport.

Budgets are now related by construction, not by careful editing:
`server/tests/stream-heartbeat-budget.test.ts` fails if fewer than three heartbeats fit inside
`CLIENT_STREAM_IDLE_BUDGET_MS`, or if the heartbeat stops being emitted/cleared.
Client behaviour: `src/api/__tests__/streamHeartbeat.test.ts`.

> **Correction (found in review, see §4).** The running-map paragraph above was FALSE when this
> document was first written: `partialStatus` started as `{}` and gained keys only as sources settled,
> so every unsettled source was *absent* rather than `pending` — and the test that "pinned" it fed the
> `"pending"` string in as fixture data, so it passed against the defect. The map is seeded with all
> ten `pending` markers now, and the assertion runs against the real emitter.

> `application/x-ndjson` is **not** compressible, so the global `compression()` middleware does not
> buffer these frames — verified, because it was the first hypothesis and it was wrong.

---

## 2. The 3D repacking: it is `RepairPDB`, and it was ~98% of the wait

Measured from this repository's own leftover job directories (same mutation `SA489C`, same position):

| structure | residues | RepairPDB | BuildModel ×5 | total |
| --- | --- | --- | --- | --- |
| `temp_jobs/test-rca` (AlphaFold) | 875 | skipped (`>400`) | **5.1 s** | 5.1 s |
| `temp_jobs/test-rca-6n7e` (experimental) | 305 | **205.4 s** | **2.2 s** | ≈208 s |

Timestamps: `individual_list.txt` 13:36:27.752 → `wt_Repair.fxout` 13:39:53.134 → `wt_1_*.pdb`
13:39:55.325. **The "repacking" the reader waits on is the wild-type template repair; computing the
mutant takes two seconds.**

### 2.1 Why it always finished last

FoldX is the only engine behind a second round trip and a local CPU-bound binary:
Stage 3 → `POST /generate-mutant` → `resolveStructure` (PDBe → AlphaFold → BLAST) → queue →
semaphore → `RepairPDB` → `BuildModel ×5` → poll every 2–5 s. The other five engines are one round
trip each plus a poller.

### 2.2 Why it looked stuck rather than slow

There was **no progress channel at all**. The only surface was a local stopwatch that advanced
through hardcoded stages at 12 s / 40 s / 75 s and then sat on *"Finalizing — Aggregating calibrated
multi-tool consensus"* for the rest of the run — five of six minutes, while the machine was
repacking a structure. Meanwhile the client was polling a job record that already knew.

**Fix.** The worker reports its real phase (`queued → repairing → modelling → finalizing`) through
the job record; the route exposes it with the job's `startedAt`/`createdAt`/`queuedAhead`; the client
validates and stores it as ONE object; the UI renders it verbatim and says *"not reported by the
compute server yet"* rather than guessing. Vocabulary and honesty rules live in
`src/shared/foldxPhase.ts` (no surface may invent a status string — the same discipline as
`engineStatus.ts`).

### 2.3 The cost was also non-deterministic, and the repair was never reused

* `shouldRepair = residueCount ≤ 400 && !isAlphaFold` — so the flip in §2's table was a **40×**
  wall-clock difference for the same query, decided by which tier won a race.
* The FoldX cache key contains the **mutation**, so the repaired template was recomputed for every
  variant on the same structure, then deleted with the job directory. A ten-variant sweep of one
  gene paid ~205 s ten times for one structure.
* Each tier flip also changed the PDB hash → a full FoldX cache miss.

**Fixes.**

1. **Repaired templates are cached** by `(pdbHash, FoldX environment, seed)` — repair does not depend
   on the substitution, and the runner already pins the RNG (`--timeSeedRotabase=false`, fixed seed),
   so the transform is deterministic. `server/services/stability/foldx/cache.ts`,
   `getRepairCacheKey`/`getRepairedStructureFromCache`/`writeRepairedStructureToCache`; the runner
   reuses the cached text instead of re-running the binary.
2. **The tier choice is memoised** per `(accession, position)` in L1 plus the persistent L2
   `external_cache` (6 h), so a transient Tier 1 failure cannot change the template — and therefore
   the cost and the cache key — from one run to the next. A total failure is never memoised, and a
   memoised tier whose coordinates have genuinely disappeared re-resolves instead of returning null.
   `server/services/structure/structure-resolver.ts`.

> **Deliberately NOT done:** the un-repaired path is not promoted, and the repair size guard is
> unchanged. Where repair *is* skipped, the payload now says so and why
> (`foldxRepairSkipped` + `foldxRepairSkippedReason`: `large-structure` | `alphafold-plddt`), and
> reuse is disclosed (`foldxRepairCached`) — a ΔΔG on an un-repaired template is a weaker claim, so
> its absence from the run belongs on the row rather than in a log line. The consensus arithmetic is
> untouched: this changes what is *said*, not what is *counted*.

> **Correction (found in review, see §4).** That disclosure was INERT when this document was first
> written. `enrichBiophysicalResult` rebuilds `energetics` from a whitelist, and the three new fields
> were not in it — so they were written by the runner, dropped by the response builder, and no surface
> could ever render them (proven by executing the builder: `foldxRepairSkipped present: false`). The
> same whitelist was dropping `foldxSd`/`foldxMean`, i.e. the ensemble spread the UI prints as `±`.
> All five now travel, and `enrichBiophysicalResult`'s disclosure behaviour is pinned by test.

---

## 3. Invariants a future change must keep

| Invariant | Pinned by |
| --- | --- |
| An aborted request is never inherited by the run that replaced it | `src/__tests__/deduplicatedPromise.test.ts` |
| Data that arrives first is visible first; no empty shell before it | `src/services/pipeline/__tests__/progressiveFirstPaint.test.ts` |
| A preview is emitted while another source is STILL IN FLIGHT | `server/services/external-api/core-data-fetcher.test.ts` (gated provider) |
| The running map is total: every unsettled source is `pending`, never absent | `server/services/external-api/core-data-fetcher.test.ts` |
| An outage is never reported as a measured absence | `server/services/external-api/core-data-fetcher.test.ts` + the forwarded triage status |
| ≥3 heartbeats fit in the client's silence bound; heartbeats are cleared | `server/tests/stream-heartbeat-budget.test.ts` |
| Heartbeats never enter the payload | `src/api/__tests__/streamHeartbeat.test.ts` |
| One preview per settled source, exactly one final frame, last; newline-delimited; no `_internal` leak | `server/services/orchestration/analysis-orchestrator.test.ts`, `server/routes/variant/analysis.test.ts` |
| Repair is keyed by structure, not mutation; a bad entry is a miss | `server/services/stability/foldx/repair-cache.test.ts` |
| Repair is actually REUSED for a second variant, and the phases are reported in order | `server/services/stability/foldx/runner-repair-cache.test.ts` |
| The disclosure fields survive the response builder | `server/services/stability/energy-models.test.ts` |
| The tier choice is stable, persisted (not L1-only), and a total failure is not memoised | `server/services/structure/structure-resolver.test.ts` |
| Progress is reported, never inferred; unknown renders as unknown; job age needs no cross-clock maths | `src/shared/__tests__/foldxPhase.test.ts`, `src/components/__tests__/EnergeticsView.test.tsx` |
| The submit→poll→terminal progress chain, and dropping an unknown phase | `src/services/pipeline/__tests__/foldxService.test.ts` |
| A new run clears the previous run's progress before claiming the request | `src/hooks/__tests__/useAnalysisPipeline.test.tsx` |
| The job record carries phase and execution start; two writers cannot lose each other's update | `server/services/infra/biophysical-queue.test.ts` |
| FoldX budgets still nest | `server/tests/foldx-timeout-budget.test.ts` (unchanged) |

---

## 4. The review round (four independent senior reviewers)

Four read-only reviews ran against the change set — server data integrity, concurrency/lifecycle, UI
honesty & contracts, and test integrity — each told to falsify the claims above rather than to agree
with them. Their verified findings, and what was done:

| # | Severity | Finding (all verified by the reviewer) | Resolution |
| --- | --- | --- | --- |
| 1 | **HIGH** | The disclosure fields never reached the client: `enrichBiophysicalResult`'s whitelist dropped `foldxRepairSkipped`/`…Reason`/`foldxRepairCached`, and also `foldxSd`/`foldxMean` (proven by executing the builder) | Fields added; behaviour pinned by test |
| 2 | **HIGH** | On the stream path a ClinVar/predictor OUTAGE was written as `not_found` — the triage catches the provider error, so the fetcher's error flags were unreachable — and the previews published that mid-run, overriding chunk 1's honest `timeout`. `clinvarPresence` narrates `not_found` as "ClinVar holds no submission" | The triage's own status is forwarded and outranks the local derivation; both routes now agree |
| 3 | **HIGH** | The running-map claim was false (see the corrections above), and the test that "pinned" it fed in the `pending` markers itself | Map seeded total; the assertion now drives the real emitter |
| 4 | MEDIUM | The streamed final frame leaked `_internal.pdbMapping` to the browser (the non-streaming route strips it; the client's schema is `.passthrough()`, so it survived into the store) | Stripped on the wire in both streaming frames; persistence unchanged |
| 5 | MEDIUM | Polling destroyed the honest `queued` phase ~2 s in: nothing ever wrote `queued` to the job row, so the first poll blanked the stage for the whole wait | The route reports `queued` whenever the queue says so |
| 6 | MEDIUM | Joining an already-RUNNING job returned a hardcoded `phase:"queued"` plus a queue position belonging to no wait | The joined job's real status/phase/elapsed are reported |
| 7 | MEDIUM | A restart re-queued jobs but left the phase they died in (`repairing`) on the record | Cleared on requeue AND gated on `status === "running"` (two independent guards) |
| 8 | MEDIUM | An aborted run could still write its phase over its replacement's (guard before an `await`, write after it) | Re-checked after the body read |
| 9 | MEDIUM | `workflowStatus` and `StructureInspector` still INVENTED a stage ("Repacking mutant side-chains…", "Modelling…") for an unreported phase, contradicting the banner in the same frame | Both now state that the stage has not been reported |
| 10 | MEDIUM | Removing the 45 s gate on "Hide pending engines" let a reader hide the only progress surface at t≈1 s with nothing to reveal, one-way (the button lives inside what it hides) | Offered only once an engine has settled, with the irreversibility stated |
| 11 | MEDIUM | `getQueuePosition` counted only `queued`/strictly-older rows: same-millisecond jobs both read "Next in line", and a running job ahead was not counted | Counted by `rowid` tie-break, and running jobs count |
| 12 | MEDIUM | Two writers read-modify-write the same job `data` blob across awaits; one update was silently lost | Per-job serialised writes (`mutateJobData`); **this also caught a bug in the fix itself** — an async mutator's promise was being written as `{}`, discarding the whole blob |
| 13 | MEDIUM | The resolver memo's L1 had no TTL (`ttlDesc: "6h"` labelled a cache that never expired) and a stale L2 entry was never invalidated | L1 TTL added; the corrected choice is written back to L2 |
| 14 | MEDIUM | Reading the repaired file instead of renaming it left `wt_Repair.pdb` in the job directory during BuildModel — an unverified change to FoldX's input/output naming | Unlinked after the read (behaviour pinned by the runner test) |
| 15 | LOW | `reportedAt` was documented as the server clock but held the client's; elapsed mixed two clocks on a remote compute host | Replaced by a server-measured `elapsedMs` duration + a client `receivedAt` |
| 16 | LOW | The repair-skip note was *replaced* by the low-pLDDT note — and AlphaFold templates (the likeliest low-pLDDT case) set exactly that skip reason | Caveats are composed, not substituted |
| 17 | LOW | The phase vocabulary was restated as a literal `z.enum`, so a new phase would fail validation and downgrade the client to the unvalidated payload | The schema is built from `FOLDX_PHASES` |
| 18 | LOW | Coverage gaps: nothing pinned the runner-level repair reuse, the worker phase chain, the banner, the progress plumbing, or the route framing — and two source-scan guards were satisfied by comments | All added, including a runner test that drives the real repair path with a faked process boundary; scans now strip comments |

Two notes on the reviewers' own limits, recorded because they matter for trust: no reviewer ran a
browser, and none exercised the BullMQ/Redis-backed queue (no Redis instance was available) — that
path's write serialisation is reasoned about rather than executed, and it is dormant in the shipped
SQLite-backed deployment.
