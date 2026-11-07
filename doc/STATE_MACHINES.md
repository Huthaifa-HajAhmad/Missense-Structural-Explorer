# State machines

This file lists the state machines in the app: what states they have, the rules that must always hold,
the allowed moves between states, and the bugs found in them. A "state machine" here means anything with
a status field or a flag that changes over time, such as a job, a lock, a session or a retry counter.
Some are written down as a type or an enum. Others are only implied by several variables or by SQL.

Last reviewed: 2026-11-06, from `main` at `a7a844f`, plus the fixes in the same change as this file.
`server/tests/state-machines-doc.test.ts` fails when a file or function named here no longer exists.

## How each machine was checked

| Mark | Meaning |
| --- | --- |
| **Tested** | A test in the repository drives the machine and checks its rules. |
| **Probed** | A one-off script was run to prove or rule out a finding. It is not kept. |
| **Read** | The code was read closely. Nothing was run against it. |
| **Listed** | The machine exists. Its states are listed from the types only. |

## Findings, ordered by impact

Every fix has a test that failed before the fix and passes after it.

| Issue | What a person saw | Machine | Status |
| --- | --- | --- | --- |
| [1](#issue-1-the-browser-gave-up-on-a-foldx-job-that-went-back-to-the-queue) | "FoldX timed out" while the server was still running the job | Client FoldX poller (14) | Fixed |
| [2](#issue-2-a-cancel-that-reached-the-other-process-did-not-stop-the-work) | A cancelled job kept running; a deploy stalled for up to 15 min | Job queue across two processes (1, 10) | Fixed |
| [3](#issue-3-the-circuit-breaker-let-every-caller-through-after-the-cooldown) | Every request to a host that was still down waited for its own timeout | Circuit breaker (8) | Fixed |
| [4](#issue-4-the-redis-backend-deleted-a-finished-job-before-the-reader-saw-it) | "FoldX job not found" instead of the result (Redis backend only) | Redis job queue (1b) | Fixed |
| [5](#issue-5-the-computer-lifecycle-lost-a-code-kept-a-job-and-took-one-after-disconnect) | A pairing code that stopped working; a job stuck for up to 90 s | Pairing code, computer token, claim (2, 11) | Fixed |
| [6](#issue-6-a-computers-finished-result-was-lost-on-one-network-failure) | Minutes of a computer's work redone by the server | Agent loop, result delivery (2, 12) | Fixed |
| [7](#issue-7-a-stage-that-never-reported-was-shown-as-complete) | An Evidence section marked done with nothing in it, and no retry | Client pipeline stages (15) | Fixed |
| [8](#issue-8-one-stray-failed-promise-could-stop-the-server-and-shutdown-took-requests-it-could-not-serve) | Every request and job ended at once; errors during shutdown | Process lifecycle (10) | Fixed |
| [9](#issue-9-callers-who-could-not-join-a-running-job-each-started-their-own) | A duplicate FoldX run (rare) | Single-flight registry (4) | Fixed |
| [10](#issue-10-a-pre-warm-lock-taken-while-redis-failed-was-never-released) | A variant not pre-warmed for 47 min (rare) | Pre-warm claim (7) | Fixed |
| [11](#issue-11-a-cancelled-computer-job-kept-its-lease) | Nothing visible; untidy final rows | Job queue row (1) | Fixed |
| [12](#issue-12-an-unfinished-analysis-was-stored-as-complete) | An opened variant showed the "in progress" placeholder as a finished analysis | Client pipeline stages (15) | Fixed |
| [13](#issue-13-a-disabled-accounts-reset-link-was-used-up) | A reset link that stopped working after an admin disabled and re-enabled the account | Password reset link (11) | Fixed |
| [14](#issue-14-a-requested-assembly-model-stayed-running-after-the-server-answered) | "Boltz-2 is modelling…" shown for ever on a monomer | Interfaces model request (listed in 16) | Fixed |
| [15](#issue-15-thermompnn-finishing-last-was-left-out-of-the-stability-verdict) | Stability verdict and engine count ignored ThermoMPNN | Remote engine pollers (15) | Fixed |

Checked and left unchanged: [section 17](#17-checked-and-left-unchanged).

---

## 1. Job queue row (`biophysical_jobs.status`)

Code: `server/services/infra/biophysical-queue.ts`, class `SQLiteQueue`. **Tested** by
`biophysical-queue.invariants.test.ts` (one process, random operations, every rule checked after every
step) and `biophysical-queue.handover.invariants.test.ts` (two processes following the deploy's rules).
Both run 5 seeds; set `QUEUE_INVARIANT_SEEDS=60` for a long run. The rules live in
`queue-invariants.fixture.ts`.

States: `queued`, `running`, `completed`, `failed`. `completed` and `failed` are final.

### Rules that must always hold

| # | Rule |
| --- | --- |
| R1 | A `queued` row has no start time, no claim and no lease. |
| R2 | A `running` row has a start time. |
| R3 | A `running` row held by a paired computer (`claimed_by = agent:<id>`) has a lease. A `running` server row has none. |
| R4 | A final row has an end time and no lease. A `completed` row has a result. |
| R5 | A final row never changes state again. Only `pruneHistory` may delete it, after `JOB_RETENTION_DAYS` (14). |
| R6 | In each process, `runningCount` equals the size of `activeJobs` and never goes above the concurrency limit. Across all processes, the running server rows equal the jobs the processes are executing. |
| R7 | A row has an open claim in `agent_claims` exactly when it is `running` on that computer. At most one claim is open per job. |
| R8 | No job runs in two processes at once. A job a process runs whose row was ended elsewhere is stopped within `ENDED_ELSEWHERE_CHECK_MS` (5 s). |

### Moves

| From | To | Trigger | Function |
| --- | --- | --- | --- |
| (none) | `queued` | submit | `addJob` |
| `queued` | `running` | the server picks the job | `processQueue` |
| `queued` | `running` | a paired computer claims it | `claimForAgent` |
| `queued` | `failed` | a learned memory ceiling refuses it | `processQueue` |
| `queued` | `failed` | waited longer than `foldxQueuedLeaseMs` (30 min) | `reapStaleJobs` |
| `queued`, `running` | `failed` | a person or an admin cancels | `cancelFor` → `stopJob` |
| `running` | `completed` | the worker returns | `processQueue` |
| `running` | `completed` | a computer sends a valid result | `completeAgentJob` |
| `running` | `failed` | the worker throws or times out | `processQueue` |
| `running` | `failed` | no end within `foldxReaperLeaseMs` (16 min) | `reapStaleJobs` |
| `running` | `queued` | the process restarted | `recoverInterruptedJobs` |
| `running` | `queued` | the computer gave the job back | `requeueAgentJobToServer` |
| `running` | `queued` | lease ran out, job cap passed, or computer disconnected | `reapAgentLeases` |
| final | deleted | older than the retention period | `pruneHistory` |

Every update names the state it expects, so a move that lost a race changes nothing and is reported as
"not yours". A cancelled server job keeps its slot until its worker stops; the abort makes it stop.
`abortJobsEndedElsewhere` delivers that abort when the cancel arrived through another process.

### 1b. The Redis (BullMQ) backend

Used only when `REDIS_URL` is set; production uses SQLite. **Read**, plus
`biophysical-queue.redis-retention.test.ts`. BullMQ's states (`waiting`, `delayed`, `active`, `completed`,
`failed`) are mapped to the four above by `getJobStatus`. This backend has no owners, watchers, leases,
placements, cancel, job timeout or abort signal: `cancelFor` answers "not found", and `abortJob` only
stops retries. A failed job is retried 3 times with backoff. Finished jobs are kept for the retention
period ([Issue 4](#issue-4-the-redis-backend-deleted-a-finished-job-before-the-reader-saw-it)). A standby
deployment refuses to start on Redis.

## 2. Paired-computer claim and lease (`agent_claims`, `lease_expires_at`)

Code: `biophysical-queue.ts` (`claimForAgent`, `renewAgentLease`, `endClaim`), `services/infra/agent-jobs.ts`,
`routes/agent.ts`. **Tested** (R7, plus `routes/agent.test.ts`).

A claim is open until it gets one outcome:

| Outcome | Trigger |
| --- | --- |
| `completed` | a valid result is accepted |
| `invalid_result` | the result failed validation; the job goes to the server once |
| `requeued`, `cancelled` | the computer reports a failure or an abort |
| `lease_lost` | the lease ran out |
| `over_cap` | the computer held the job past the cap |
| `disconnected` | the owner or the computer disconnected it |
| `cancelled` | a person cancelled the job |

Lease: renewed by each heartbeat (about every 20 s, lease 60 s), never shortened. While the server
finishes a delivered FoldX result it holds the lease for 15 minutes, and the reaper does not apply the job
cap then. A heartbeat or result for a job that is no longer the computer's gets 410 or 409.

Result delivery is safe to repeat: the same computer delivering an accepted result again is told
"accepted" and nothing is applied twice (`completedBy`), and two deliveries in flight at once share one run.

## 3. Placement (`biophysical_jobs.placement`)

Only meaningful while the row is `queued`. Values: empty, `agent:<id>`, `server`.

| From | To | Trigger |
| --- | --- | --- |
| empty | `agent:<id>` | the placement engine chooses the person's computer at submit |
| `agent:<id>` | empty | `releasePlacementsOf`: the computer cannot take it, or sat idle for 2 minutes |
| any | `server` | the computer handed the job back |
| `agent:<id>` | empty | restart recovery (a `server` placement stays) |

`server` is one-way: `claimForAgent` offers only jobs whose placement is empty or its own, so a job is
handed back at most once.

## 4. Single-flight registry (`JobRegistry`)

Code: `services/infra/foldx-job-registry.ts`; used for FoldX and P2Rank. **Tested**
(`foldx-job-registry.test.ts`; a 300-seed random-schedule probe found nothing more).

For one cache key: `idle` → `reserving` (a leader is creating the job, in `pending`) → `registered`
(`active` holds the job id) → `released`. A registered entry is checked against the queue on every read,
so a finished or missing job clears itself.

| From | To | Trigger |
| --- | --- | --- |
| `idle` | `reserving` | the first caller becomes the leader; the reservation is written before the first `await` |
| `reserving` | `registered` | the leader's job is created |
| `reserving` | `idle` | the leader was refused; each waiting caller tries again, one becomes the new leader |
| `registered` | joined | later callers get the job id (`joined: true`) |
| `registered` | `idle` | `release(key, jobId)` for that job, or a read finds the job finished |
| leader's job not joinable | `reserving` again | a caller may not see that job's result; it goes through the single-flight again |

Rule: one job per key and per group of callers that may share a result. The registry is per process.

## 5. Background repair (`BackgroundRepairEntry.state`)

Code: `services/stability/foldx/background-repair.ts`. **Read**; covered by `runner-background-repair.test.ts`.

| From | To | Trigger |
| --- | --- | --- |
| (none) | `waiting` | a job skipped repair and the structure is eligible |
| `waiting` | `running` | a spare core exists, or the FoldX slot was idle for two polls |
| `waiting` | `done` | another job already cached the repaired template |
| `running` | `done` | the repair completed or was reused |
| `running` | `waiting` | preempted fewer than 3 times, or the slot was busy |
| `running`, `waiting` | `gave-up` | failure, 3 preemptions, switched off, or no idle window within 6 h |
| `gave-up` | new entry | a request after the 6-hour cooldown |

Rules: one repair runs at a time; `waiting` and `running` entries are never evicted; a request is decided
under a `deciding` lock taken before the first `await`.

## 6. FoldX job progress

**6a. Phase** (`FOLDX_PHASES`, `src/shared/foldxPhase.ts`): `queued` → `repairing` → `modelling` →
`finalizing`, written by the worker or by the computer's heartbeat. An unknown phase is shown as unknown.
A job that goes back to the queue loses its phase (`clearPhase`). **Read**.

**6b. Companion engines** (RaSP, ProtVar, StabilityOracle; `foldx-queue-job.ts`): each goes absent →
`pending` → `done`, `error` or `unavailable`. On a second run RaSP and ProtVar skip themselves when `done`
or `unavailable`, StabilityOracle when `done`. `startFoldxCompanions` is single-flight per job, and
`mutateJobData` runs the writes for one job one after another. StabilityOracle waits up to 180 s here
(`STABILITY_ORACLE_BACKGROUND_BUDGET_MS`); a wait that runs out ends as `error`, not `unavailable`, because
the model service may be there but busy. The job finishes only after the companions do
(`finishFoldxQueueJob`), so a FoldX failure can report its final status up to 180 s late; the FoldX value
itself is published early, so this is a wait and not a hang. ThermoMPNN is not a companion: the route
submits it (`submitThermoMpnnJob` in `energy-models.ts`) and waits up to 60 s for the local model service. A
wait that runs out, or an answer of "busy", ends as `error`; only an unreachable service ends as `unavailable`.
With a Tamarind key, a timeout or an unreachable service goes on to the cloud; "busy" and "warming up" do not.
**Read**.

## 7. Pre-warm claim

Code: `routes/state.ts` (`inFlightPrewarms`), `services/infra/prewarm-manager.ts`. **Tested**
(`state-prewarm-registry.test.ts`, `state-prewarm-redis-fallback.test.ts`). Off unless
`PREWARM_FOLDX_ENABLED=true`.

absent → `claimed` (token, 47 min) → `released` (by the holder's token only) or `expired`. With Redis
configured, a claim made in SQLite during a failed Redis command still keeps others out and is released
from both stores by its owner.

## 8. Circuit breaker and provider pause

Code: `server/utils/concurrency.ts` (`CircuitBreaker`), `services/infra/http-client.ts`,
`services/infra/provider-pause.ts`. **Tested** (`server/utils/circuit-breaker.test.ts`, `provider-pause.test.ts`).

**8a. Circuit breaker**, one per host. 5 failures open it; cooldown 60 s with ±20 % random spread.

| From | To | Trigger |
| --- | --- | --- |
| `CLOSED` | `OPEN` | 5 failures in a row |
| `OPEN` | `HALF-OPEN` | a caller asks after the cooldown; that caller gets the one trial |
| `HALF-OPEN` | `CLOSED` | the trial succeeds |
| `HALF-OPEN` | `OPEN` | the trial fails |
| `HALF-OPEN` | `HALF-OPEN` | the trial never reported (its caller was aborted); a new trial after one cooldown |

Rules: one trial at a time; other callers fail at once with "temporarily unavailable" while it runs.
`isAvailable()` only looks; `canExecute()` takes the trial. Health probes, caller aborts and timeouts the
caller imposed are not counted as failures.

**8b. Provider pause**, one per host: `ok` ⇄ `paused until T`. A 429, or a 503 with `Retry-After`, sets it
(5 s by default, at most 10 s); a later answer can lengthen it, never shorten it.

## 9. Egress governor and cache fills

**Read**; covered by `egress-governor.test.ts`, `cache-registry.test.ts`.

**Governor** (`services/infra/egress-governor.ts`), per provider and lane: a call is `sent` at once,
or `waiting` → `granted` / `refused` (its deadline or 120 s passed) / `aborted`. Rules: at most
`maxConcurrent` in flight; among waiting people, whoever was served least recently goes next; pre-warm
(`system`) waits until no person waits or 30 s passed; the rate halves on a rate-limit answer (once per
5 s) and rises 5 % after 20 successes; a learned rate is forgotten after an hour. A provider with waiters,
calls in flight or a refill timer is never evicted.

**Cache fill** (`services/infra/cache-registry.ts`): memory hit → database hit → one fill per key for all
callers (`inFlightFills`) → stored, or an expired entry served when a provider limited the fill. A result
built from an expired entry is returned but not stored.

## 10. Deployment role and process lifecycle

Code: `deployment-role.ts`, `deployment-control.ts`, `graceful-shutdown.ts`, `deploy/rollout.py`.
**Tested** (`biophysical-handover.test.ts`, the two-process queue test, `graceful-shutdown.test.ts`).

| Machine | States | Moves |
| --- | --- | --- |
| Role (file `.deployment-role`) | `active`, `paused` | `/internal/deployment/pause` and `/resume`; the file is written first, then the queue changes. A bad file stops start-up. |
| Queue processing | running, paused | `pauseProcessing` stops the timers and reapers; running jobs finish. `resumeProcessing` restarts them. A closed queue cannot resume. |
| Process | serving → closing → exited | `SIGTERM` or `SIGINT`: stop accepting connections, run the hooks (sidecar, background tasks, queue, pools, temp files), close the connections still open, exit 0. A 10 s watchdog forces exit 1. |

Handover (`rollout.py`): start the new generation paused → wait until ready → pause the old one → wait
until it has no requests, jobs or background tasks → resume the new one → stop the old one. Rollback is
the same the other way and never force-stops a busy process. Both processes answer requests during the
drain, which is why R8 matters.

A promise that fails with nobody listening is logged and the process keeps running
(`keepRunningOnUnhandledRejection`). A thrown error still stops it.

## 11. Accounts and credentials

Code: `server/auth/*`, `routes/auth.ts`, `routes/admin.ts`, `routes/agent.ts`. **Tested** for pairing and
computers (`agent.test.ts`, `auth.test.ts`); the rest **Read**.

| Machine | States and moves |
| --- | --- |
| User | `active` ⇄ `disabled`. Disabling removes sessions, revokes computer tokens and cancels the user's jobs. The last active admin cannot be disabled or demoted. |
| Session | valid → deleted (sign-out) / expired (14 days) / idle (24 h) / user disabled. |
| Sign-in throttle | `fresh` → `counting` → `locked` (5 failures for an email, 20 for an address, 15 min) → `fresh`. A success clears the email counter only. |
| Invite | `unused` → `used` / `expired` / `replaced` / withdrawn. Checked before it is used, in one transaction. |
| Password reset link | `unused` → `used` / `expired` / `replaced`. Checked (owner active) in the same query that uses it (`consumePasswordReset`), so a disabled account leaves the link unused. |
| Pairing code | `unused` → `used` / `expired` (10 min) / `replaced`. Checked (owner active, fewer than 10 computers) before it is used (`pairingCodeOwner`, then `consumePairingCode`). |
| Computer token | `active` → `revoked` (by the owner, the computer, or the user being disabled). Revoking hands its running jobs back at once (`handBackJobsOf`), and a claim long poll already waiting answers 401 instead of taking a job. |

## 12. The agent's own loop (on the paired computer)

Code: `server/agent/worker.ts`, `client.ts`, `deliver.ts`. **Tested** (`server/agent/agent.test.ts`,
`deliver.test.ts`).

Connection: `unpaired` → `connected` ⇄ `offline` (backoff 2 s doubling to 60 s); `revoked` on a 401;
`outdated` on a 426. Job: `claiming` → `running` (heartbeats) → `delivering` → back to `claiming`; a 410
or 401 heartbeat aborts the tool. Heartbeats continue while the outcome is delivered. A delivery that
fails on the network or with 429/5xx is tried again after 5 s and 20 s while the job is still the
computer's; any other answer is final, and the lease then returns the job to the server.

## 13. Sidecar supervisor

Code: `server/sidecar-supervisor.ts`. **Read**.

| State | Entered | Left when |
| --- | --- | --- |
| `stopped` | start, or after `stop()` | `start()` |
| `running` | spawned; a 180 s start-up grace begins | the process exits |
| `backoff` | exit while not shutting down | after 2 s × 2^(n−1), at most 60 s |
| `offline` | 10 restarts in a row, or a failed spawn | the health loop sees 3 failed probes with no process and no timer, and respawns |

The restart counter resets after 30 s of stable running or one healthy probe. An unresponsive process
(3 failed probes, one per minute after the grace) is killed and restarted.

## 14. Client FoldX poller (`executeFoldxPipeline`)

Code: `src/services/pipeline/foldxService.ts`. **Tested** (`foldxService.test.ts`).

`submitted` → `queued` ⇄ `running` → `completed` / `failed` / given up. Two budgets: queue wait
(`CLIENT_FOLDX_QUEUE_BUDGET_MS`, 30 min) and execution (`CLIENT_FOLDX_POLL_BUDGET_MS`, 1000 s, longer
than the server's job cap). A return to `queued` starts both again. Three failed polls in a row end the
run. Every write checks that the run is still the active one.

## 15. Client analysis pipeline stages

Code: `src/services/pipeline/workflowOrchestrator.ts`, `resultMerge.ts`, `biophysicalService.ts`.
**Tested** for settling (`resultMerge.test.ts`); the rest **Read**.

Stages: `core`, `coordinates`, `landscape`, `structural`, `multimer`, `ppi`, `narrative`, `literature`.
Outcomes: `running`, `complete`, `degraded`, `error`, `skipped`.

Rules: a stage's patch may not overwrite another stage's evidence (`mergeResultPatch`). When core fails,
stages still `running` become `skipped` and core becomes `error`. A stage that failed after some models
arrived is `degraded`. At the end of a run, `settleUnreportedStages` settles any stage still `running`
(except `coordinates`): `complete` when its evidence arrived, `error` when it did not, and `complete` for a
stage with no evidence field of its own (narrative, literature have their own writers). A cached result
with a `running` or `error` stage is re-run when opened. Responses for an old request are ignored.
A result is never stored or restored with a stage at `running`: `settleStagesForStorage` settles it the
same way, except that `core` is `complete` only when the analysis text is a real answer (not the
"in progress" placeholder), and `error` otherwise.

The useJobPoller hook (`src/hooks/useJobPoller.ts`, **Read**, tested by its own suites) follows remote
engines: `polling` → `listening` (a retryable "unavailable", or 3 failed polls, within 5 min) → `done`,
`error` or `unavailable`, with exactly one final callback. `shouldRunBiophysics` allows a re-run 15 min
after an attempt, unless FoldX cannot run here and no remote engine failed.

## 16. Machines listed only

| Machine | Where | States |
| --- | --- | --- |
| Trace run | `src/types/devConsole.ts` | `running`, `completed`, `failed`, `cancelled` |
| Service fetch | `server/services/orchestration/payload-assembler.ts` | `ok`, `not_found`, `timeout`, `error`, `unsupported-build`, `stand-in` |
| Multimer | `src/shared/contracts.ts` | `success`, `monomeric`, `not-modelled`, `failed`, `not-requested`, `running` |
| Engine and provider state | `src/shared/engineStatus.ts`, `src/shared/providerStatus.ts` | five-state vocabulary |
| Numbering | `server/services/translation/isoform-numbering.ts` | `canonical`, `remapped`, `unverified`, `unsupported` |

---

## Issues

### Issue 1: The browser gave up on a FoldX job that went back to the queue

**Seen:** "FoldX simulation timed out" while the server was still running the job; the result arrived
later, unseen. **Cause:** the execution clock started at the first `running` and never restarted. A job
goes back to the queue whenever a paired computer gives it back, loses its lease, or the server restarts.
A computer may hold a job up to the cap (960 s), so the second run always started with the 1000 s budget
nearly spent. **Fix:** a return to `queued` restarts both budgets. **Test:** `foldxService.test.ts`,
"restarts its clocks when a job goes back to the queue".

### Issue 2: A cancel that reached the other process did not stop the work

**Seen:** during a deploy both processes answer requests. A cancel that reached the process not running
the job ended the row, but the other process kept running FoldX (up to 15 min). The drain waited for it,
and with one FoldX slot the new process could not start anyone's job. **Found by** the two-process random
test. **Fix:** each process checks every 5 s, paused or not, and stops any job whose row was ended
elsewhere (`abortJobsEndedElsewhere`). **Tests:** `biophysical-handover.test.ts`, "stops a running
calculation that was cancelled through the other process"; rule R8 in the two-process test.

### Issue 3: The circuit breaker let every caller through after the cooldown

**Cause:** `canExecute()` returned `true` in every state but `OPEN`, so after the cooldown every caller
went to a host that might still be down, and each waited for its own timeout and retries. `isHostAvailable()`
also changed the state just by asking. **Fix:** one trial in `HALF-OPEN`, replaced after a cooldown if it
never reports; `isAvailable()` answers without taking it. **Test:** `circuit-breaker.test.ts` (4 tests).
**Trade-off:** while the trial runs (up to about 50 s), other callers to that host fail at once. Callers
already treat this error as "provider unavailable" and use their fallback.

### Issue 4: The Redis backend deleted a finished job before the reader saw it

**Cause:** `removeOnComplete: true`, so the next poll got 404 "not found" and the browser reported an
error after three tries. Failed jobs were never removed. **Fix:** both are kept for
`JOB_RETENTION_DAYS`, like the SQLite backend (`jobRetentionMs`). **Test:**
`biophysical-queue.redis-retention.test.ts`.

### Issue 5: The computer lifecycle lost a code, kept a job, and took one after disconnect

* A pairing code was used up before the 10-computer limit was checked, so after "disconnect one first"
  the same code answered "not valid". Now checked first, like invites.
* Disconnecting from the app only revoked the token; a running job waited for its lease (up to 90 s) and
  counted as a lease loss. Both disconnect routes now call `handBackJobsOf`.
* A claim long poll already waiting when the computer was disconnected could still take a job for up to
  25 s. The loop now checks the token each second and answers 401.

**Tests:** three in `routes/agent.test.ts` ("a code refused for too many computers…", "disconnecting a
computer from the app…", "a long poll that is waiting…").

### Issue 6: A computer's finished result was lost on one network failure

**Cause:** the agent sent its result once and stopped heartbeats before sending. A dropped connection
meant the lease ran out and the server ran the whole job again. Retrying was unsafe: the server answered a
repeat with 409 and would have finished the result twice if both arrived together. **Fix:** the server
answers a repeat "accepted" and shares one run between deliveries in flight; the agent keeps heartbeats
and retries network and temporary errors twice. **Tests:** `deliver.test.ts`; `agent.test.ts` (a repeat
is accepted and changes nothing).

### Issue 7: A stage that never reported was shown as complete

**Cause:** at the end of a run every stage still `running` became `complete`, even with no evidence.
**Fix:** `settleUnreportedStages` uses `error` when the evidence never arrived, so the screen offers a
retry and an opened cached result re-runs it. The two copies of the old loop became one function.
**Test:** `resultMerge.test.ts`.

### Issue 8: One stray failed promise could stop the server, and shutdown took requests it could not serve

**Cause:** there was no `unhandledRejection` handler, so Node's default ended the process on any
unhandled failure (`startFoldxCompanions` had one such promise). Shutdown ran its hooks before it stopped
accepting connections, so requests could reach a closed queue, and open event streams held the exit until
the watchdog (exit 1). **Fix:** `keepRunningOnUnhandledRejection` logs and continues; the stray promise is
handled; shutdown stops accepting first, closes open connections after the hooks, and exits 0.
**Tests:** `graceful-shutdown.test.ts`.

### Issue 9: Callers who could not join a running job each started their own

**Cause:** in `JobRegistry.submitOrJoin`, a caller not allowed to see the leader's job (it runs on
someone else's computer) created a job without a reservation; two such callers made two. **Fix:** it goes
through the single-flight again (fewer lines). **Test:** `foldx-job-registry.test.ts`, "callers who may
not join the job that is starting".

### Issue 10: A pre-warm lock taken while Redis failed was never released

**Cause:** a claim fell back to SQLite during one failed Redis command; later Redis calls neither saw it
nor released it. **Fix:** `add` respects a live SQLite claim and `delete` releases both stores.
**Test:** `state-prewarm-redis-fallback.test.ts`.

### Issue 12: An unfinished analysis was stored as complete

**Cause:** the variant cache turned every `running` stage into `complete` when it stored or restored a
result. A write made while core was still running (the Interfaces tab writes the result it shows) saved
the placeholder with `core: complete`, and the next open served it as a finished analysis.
**Fix:** `settleStagesForStorage` (used by `variantCache`) settles by evidence; core needs a real analysis text.
**Test:** `variantCache.test.ts`, "stored stage outcomes".

### Issue 13: A disabled account's reset link was used up

**Cause:** `consumePasswordReset` marked the link used, then the route found the account disabled and refused.
**Fix:** the query only matches links of active accounts. **Test:** `auth.test.ts`.

### Issue 14: A requested assembly model stayed running after the server answered

**Cause:** `buildInterfacesEvidence` showed `running` for a requested model unless the server said `failed`,
so a `monomeric` or `not-modelled` answer (final) never showed. **Fix:** a request only shows `running` while
the server has not answered (`not-requested` or no assembly). **Test:** `interfacesEvidence.test.ts`.

### Issue 15: ThermoMPNN finishing last was left out of the stability verdict

**Cause:** the DynaMut2 and DDMut pollers recompute the consensus when they finish; the ThermoMPNN poller did
not. **Fix:** it uses the same `withStabilityConsensus`. **Test:** `useBiophysicalModeling.test.tsx`.

### Issue 11: A cancelled computer job kept its lease

**Cause:** `stopJob` did not clear `lease_expires_at`. Nothing read it, but a final row should be clean.
**Fix and test:** cleared; rule R4.

---

## 17. Checked and left unchanged

| Item | Finding | Why it stays |
| --- | --- | --- |
| Queued-wait clock after a restart | `recoverInterruptedJobs` does not set `requeued_at`, unlike a hand-back. | **Probed**: an interrupted job is served first and starts within 50 ms, so the stale-queued reaper never sees it. Only a 30 s memory stall could reach it. |
| Redis backend features | No cancel, abort, job timeout, owners or leases; a failed FoldX job is retried 3 times. | Production uses SQLite. Adding them needs a Redis test setup; the gaps are listed in 1b. |
| Breaker trial length | A trial that never reports blocks the host for one more cooldown (60 s). | A shorter lease could let a second trial start beside a slow first one (up to about 50 s). |
| FoldX result cached before the job completes | If a job is cancelled while the server finishes a computer's result, the validated result stays cached. | The entry is keyed by the exact request and carries its provenance, so it is correct to reuse. |
| Registry across processes | The single-flight registry is per process. | Two processes run jobs only during a deploy drain, when the new one is paused. |

## Keeping this file current

When you change a status field, a lock, a retry rule, a timer or a lease: update the section here in the
same change, add the rule to a test, and name functions rather than line numbers.
`server/tests/state-machines-doc.test.ts` checks that every file path and every camelCase name in
backticks still exists.
