# Energetics Tab — Audit, Root-Cause Analysis, UI/UX Review, and Remediation Plan

**Scope:** the `Energetics` master view — `src/components/EnergeticsView.tsx` (main column) and
`src/components/inspector/EnergeticsInspector.tsx` (right rail, header "Stability Telemetry /
Engines & Thermodynamic Baseline"), plus everything that feeds them: the six ΔΔG engines, the
status/provenance plumbing, the calibrated-consensus module, and the local data stores.

**Reference observation:** the screen captures a `MACO1 p.Glu433Lys` run (`NM_018202.6`,
`1-25484258-G-A HG38`, `Q8N5G2`) in which **one of six engines produced a number**. FoldX =
Failed, DDMut = Upstream Congested, RaSP = Not in Zenodo DB, ThermoMPNN = In Progress
(indefinitely), StabilityOracle = Standby. The headline verdict is therefore
"1-Method Calibrated Consensus → Low Misfolding Risk (Single-Tool Estimate)", 9% [4–17%].

**Method:** static read of the components, pipeline, routes, queue, and engines; direct read-only
inspection of the shipped SQLite data stores; read-only probes under `scratch/`. No application
file was modified. Every claim below carries a `file:line` reference; where a conclusion is an
inference rather than a direct read, it is labelled **[inferred]**.

---

## 1. Executive summary

Five of six engines are degraded on this screen, and **only one of the five is the upstream
provider's fault**. The rest are local defects: a truncated data index, a permanently absent
sidecar, a watchdog that fires before the work it watches can finish, and a status model with no
terminal state for a failed run.

| Engine | Shown as | Root-cause class | Confidence | One-line cause |
|---|---|---|---|---|
| **RaSP** | Not in Zenodo DB | **Local data defect** | High | Shipped SQLite index holds 6 of the CSV's 1,345 proteins (35,000 of 8.33 M rows); the app prefers the truncated index and never rebuilds it. |
| **StabilityOracle** | Standby / Unavailable | **Environment + design** | High | Hard dependency on a local Python sidecar (`127.0.0.1:8000`) that is not running; the failure returns `null` with no terminal UI state, so it reads "Standby" forever. |
| **FoldX** | Failed / Simulation Failed | **Local orchestration defect** | High | The inner work budget (120 s semaphore + 300 s RepairPDB + 300 s BuildModel + 120 s retry = 840 s) exceeds every outer budget (300 s queue cap, 300 s reaper lease, 300 s client poll, 300 s watchdog), so the watchdog always wins and reports a timeout for work that is still running. |
| **ThermoMPNN** | In Progress | **Local status defect** | High | Status is set optimistically to `pending` before submission resolves, and the FoldX failure path never writes a terminal value back → the row freezes on "Simulating…". |
| **DDMut** | Upstream Congested | **Upstream (partly)** | Medium | BioSig queue saturation is real, but three distinct causes (queue-full, HTTP error, network error) collapse into one opaque `unavailable` state, and the UI names DynaMut2 as offline too even when it succeeded. |
| **DynaMut2** | 0.09 kcal/mol · Neutral | Working — but see §6.1 | — | The only engine that returned a value; it is displayed with two contradictory signs on the same screen. |

**Ranked defects (highest impact first):**

1. **D-1 RaSP index is truncated** — a single interrupted build silently disabled an engine for
   99.55 % of the proteins the shipped data actually covers. Verified by direct DB inspection.
2. **D-2 Every cached visit re-runs FoldX and then overwrites a good result with "timed out"** —
   `needsBiophysicsBackfill` is permanently true while StabilityOracle is down
   (`workflowOrchestrator.ts:238`), so the failure is self-perpetuating on every visit.
3. **D-3 Timeout budget inversion** — the outer watchdog is shorter than the sum of the inner
   stages it supervises, guaranteeing a timeout on any non-trivial protein.
4. **D-4 No terminal state for a failed run** — engines stay "In Progress" forever after the
   parent pipeline fails.
5. **D-5 "Skip Slow Predictors" does not skip anything** — it only relabels the UI and changes the
   method count in the consensus heading.
6. **D-6 Sign contradiction** — the table shows `+0.09`, the breakdown below shows `−0.09`, for the
   same DynaMut2 value.
7. **D-7 Consensus computed twice with different inputs** — client and server can disagree on the
   verdict for the same variant.
8. **D-8 The verdict's credibility is invisible** — a 1-of-6 green "Low Misfolding Risk" badge is
   styled identically to a confident multi-method verdict, and in light mode that headline verdict
   is set in `text-emerald-400` at a measured **1.92:1** contrast (§7.7).
9. **D-9 In-app method documentation contradicts itself on sign convention** — the shared module
   documents RaSP with an *inverted* rule (`≤ −1.0` destabilizing) while the shipped math, the
   tuned thresholds, and the Energetics tab's own copy all use `≥ +1.0` (§6.5). A user can read the
   opposite rule depending on which tab they opened.
10. **D-10 Missing values are coerced to `0`, producing false precision** — `foldxSd ?? 0` makes the
    FoldX row claim "mean ± 0.00 kcal/mol" whenever the ensemble SD is absent (§6.6).
11. **D-11 The tab renders four of the six engines' verdicts through FoldX's thresholds** — RaSP's
    tuned cut is +1.0 but the table applies 1.5/0.5, so the table and the consensus disagree about
    the same number (§6.8).

---

## 2. What this screen is actually telling the user

Decoding the screenshot against the source shows the failure is presented three separate times,
in three different vocabularies, with two of the explanations contradicting each other:

| Layer | FoldX | DDMut | Vocabulary |
|---|---|---|---|
| Engine table (`EnergeticsView.tsx:436-443`) | Failed / *Simulation Failed* | — / *Upstream Congested* | Outcome-adjacent |
| Active Method Diagnostics (`EnergeticsInspector.tsx:70-160`) | *Biophysical Simulation Failed* → "Simulation timed out after 5 minutes." | *ΔΔG Partial (Async Services Offline)* → "…(DynaMut2 / DDMut) are currently offline" | Prose + jargon |
| Stability Engine Telemetry (`EnergeticsInspector.tsx:174-263`) | red dot · "Failed: Simulation timed out after 5 min…" | amber dot · "BioSig Queue / Unavailable" | Infrastructure detail |

Three observations:

* The `Failed: Simulation timed out after 5 min…` string is `foldingError.slice(0, 32) + "..."`
  (`EnergeticsInspector.tsx:201`), and the full string "Simulation timed out after 5 minutes."
  matches the orchestrator watchdog verbatim (`workflowOrchestrator.ts:308`). This pins the FoldX
  failure to the client-side watchdog, **not** to a FoldX process error. (The alternative source,
  `foldxService.ts:171`, reads "**Biophysical** simulation timed out…" and does not match.)
* The diagnostics card claims DynaMut2 **and** DDMut are offline
  (`EnergeticsInspector.tsx:38,90`) while the table directly beside it shows DynaMut2 succeeded.
  `isAsyncOffline` is an OR over both statuses, so one engine's failure produces a false statement
  about the other.
* The consensus block advertises more work than the system is doing: the heading is
  "1-Method Calibrated Consensus" while its badge says "Preliminary — Calculating: ThermoMPNN"
  (`EnergeticsView.tsx:673-677`) — i.e. the UI knows a tool is missing, counts it as absent from
  the consensus, and simultaneously presents the verdict as compute-in-flight rather than degraded.

---

## 3. RCA — data-layer failures

### 3.1 RaSP: the shipped index covers 6 proteins, not the proteome (D-1, P0)

**Verified by direct read-only inspection of the shipped stores:**

| Store | Rows | Distinct proteins | Size |
|---|---|---|---|
| `data/df_rasp_gnomad_clinvar.csv` (source of truth) | 8,770,220 (8,331,709 insertable) | **1,345** | 394.9 MB |
| `data/df_rasp_gnomad_clinvar.sqlite` (what the app reads) | **35,000** | **6** | 3.1 MB |

* The 6 proteins present are `O00159, A4D126, O00141, O00189, O00204, A8MTZ0` — exactly the first
  six accessions in CSV order. 35,000 rows is exactly **7 × 5,000**, the batch size in
  `scripts/build-rasp-sqlite.ts:88`. This is the signature of an **interrupted build that stopped
  on a batch boundary**, not of a parsing bug. **[inferred, strong]**
* Replaying the build script's own row-validation logic over the entire CSV yields
  `skip_unparseable_variant = 438,511`, `skip_too_few_columns = 0`, and no fatal condition — the
  parser is sound. The 438 k skipped rows are the CSV's `S41=`-style wild-type reference rows,
  which are correctly unlookupable as substitutions.
* **1,339 of 1,345 covered proteins (99.55 %) are unreachable at runtime.** PAH (`P00439`) has
  8,460 precomputed rows in the CSV and returns "not in database" in the app. Note that PAH is the
  gene in the most recent entry of `logs/audit.jsonl` — this is not a hypothetical.

**Why it never self-heals.** `energy-models.ts:51-71` accepts the index on a size + non-empty
check, and `lookupPrecomputedRaspScore` prefers SQLite whenever it exists
(`energy-models.ts:182-188`). `initializeRaspDatabase` then returns early at line 145 because
`getRaspSqliteDb()` is truthy — so the 394 MB CSV sitting next to it is **never consulted and never
rebuilt**. The comment at `energy-models.ts:39-45` shows the team already reasoned about a test
clobbering this CSV; the same class of hazard (a partially-written index) has no guard at all.

**The UI then discards the real reason.** The server returns a precise `raspReason`
("Residue position is not present in the pre-computed database",
`energy-models.ts:87`) and the inspector renders it faithfully
(`EnergeticsInspector.tsx:137-147`), but the engine table hard-codes "Not in Zenodo DB" for *any*
null RaSP value (`EnergeticsView.tsx:521-527`). So the same screen offers two explanations for one
missing number, and the table's version leaks infrastructure (Zenodo) instead of stating the
biological fact (not covered). The tooltip compounds this by asserting "not found … for this
protein" when the real cause may be a missing position.

**Diagnostics actively mislead.** The capability probe declares RaSP ready on
`st.size > 1024 * 1024` alone (`capabilities.ts:99-110`) — the truncated 3.1 MB index reports
healthy. `DEPLOYMENT_OCI.md:215` likewise advertises "Indexed lookup across human proteome", and
`stacking_config.json` calls RaSP "pre-computed on Zenodo" with the second-highest weight (1.5).
The dataset's own filename (`df_rasp_gnomad_clinvar`) and the two nearly-empty annotation columns
(ClinVar populated on 0.05 % of rows, gnomAD AF on 2.7 %) suggest it was never the proteome-wide
resource the docs describe.

### 3.2 StabilityOracle: permanently absent dependency presented as "Standby" (P0/P1)

`runStabilityOracleAnalysis` POSTs to `${sidecarBaseUrl}/predict/stabilityoracle`
(`stabilityoracle.ts:50-64`) where the base URL defaults to `http://127.0.0.1:8000`
(`config.ts:52`). **Verified: nothing is listening on 8000.** The connection failure is caught and
returns `null` under an explicit policy comment (`stabilityoracle.ts:80-83`) — a defensible
scientific choice (no synthetic fallback) that is *not* paired with a defensible UI state.

Consequences:
* The engine can never produce a value in this environment, yet it occupies a permanent row in the
  consensus table.
* The UI has no "not configured" state for it. `isStabilityOraclePending` is only true while
  `isFolding` (`EnergeticsView.tsx:434`); otherwise the row falls through to "Standby"
  (`EnergeticsView.tsx:570-575`) and telemetry says "Unavailable (No Heuristics)"
  (`EnergeticsInspector.tsx:217`). "No Heuristics" is a **policy name, not a diagnosis** — a
  clinician cannot act on it.
* `SIDECAR_SECRET` is auto-generated in-process when unset (`config.ts:14-22`), so even if the
  sidecar were started independently it would reject the app's header unless the same secret were
  shared. **[inferred]**

### 3.3 ThermoMPNN and DDMut/DynaMut2 dependencies

* ThermoMPNN resolves local sidecar → Tamarind cloud (`energy-models.ts:298-353`). No
  `TAMARIND_API_KEY` is configured (verified against `.env`), so the local sidecar is the only path
  — the same absent `127.0.0.1:8000`. Note the UI tooltip claims "Local VESM-150M neural sidecar
  model weights are warming up" (`EnergeticsView.tsx:550`), which describes a model that is not
  running at all.
* DDMut/DynaMut2 are genuine third-party submissions (`biosig.lab.uq.edu.au`). The server
  distinguishes a queue timeout ("BioSig server queue congested (>5m wait)",
  `polling.ts:355,414`) from a service failure (`polling.ts:369,428`) and from a network error
  (`polling.ts:396,456`) — but all three are flattened to the single wire value `unavailable`, so
  the client cannot tell them apart and labels all of them "Upstream Congested"
  (`EnergeticsView.tsx:528-541`). **Part of this screen's failure is genuinely upstream; the loss of
  information is local.**

---

## 4. RCA — orchestration failures

### 4.1 The timeout budget is inverted (D-3, P0)

Seven independent deadlines govern one FoldX computation, and the inner ones sum to more than every
outer one:

| Timer | Value | Location |
|---|---|---|
| ~~Route-level abort signal~~ | ~~240 s~~ **dead code** | `generation.ts:343` — declared, never referenced again (verified by grep) |
| Queue job cap (`foldxSec`) | 300 s | `config.ts:35`, `biophysical-queue.ts:192-198` |
| Queue reaper lease | 300 s | `biophysical-queue.ts:256-258` |
| Client poll loop | 300 s | `foldxService.ts:170-172` |
| Orchestrator watchdog | 300 s | `workflowOrchestrator.ts:305-312` |
| Semaphore wait before FoldX starts | 120 s | `foldx/runner.ts:167` |
| FoldX `RepairPDB` subprocess | 300 s | `foldx/runner.ts:327` |
| FoldX `BuildModel` subprocess | 300 s | `foldx/runner.ts:366` |
| FoldX `BuildModel` retry | 120 s | `foldx/runner.ts:424` |
| BioSig remote staleness cutoff | 300 s | `polling.ts:291` |

The FoldX work itself may legitimately consume 120 + 300 + 300 + 120 = **840 s**, while the watchdog
that supervises it fires at **300 s**. The watchdog therefore wins on any protein whose repair +
5-run ensemble exceeds five minutes, and the UI reports a timeout for a job that is still running
in the queue. That is exactly the state on this screen: `foldingStatus = "failed"` +
`foldingError = "Simulation timed out after 5 minutes."` written over a run whose DynaMut2 value
had already arrived.

The 240 s route signal being dead is worse than it looks: **nothing cancels the server-side job.**
The queue owns its own `AbortController` (`biophysical-queue.ts:184`) and passes *that* signal to
`generateMutantPdb` (`server.ts:72-77`); no HTTP route calls `abortJob` for FoldX (the only callers
are the queue's internal timeout/reaper and `prewarm-manager.ts:81`). So when the client watchdog
fires, the client aborts its own fetch, `foldxService` returns silently on `signal.aborted`
(`foldxService.ts:289`), and the server keeps computing — and can later write a **successful**
FoldX result to `logs/foldx_cache` (`runner.ts:129` → `cache.ts:90-117`) that nobody will read.
The client is left holding a "failed" label for a computation that succeeded. **[verified in code]**

One more mismatch: the watchdog timer starts ~1–2 s *before* the `/generate-mutant` POST, while the
queue's 300 s starts only when the job leaves the queue. The two clocks are not aligned, so the
client's timer always wins the tie.

### 4.2 A permanently-true backfill condition re-runs FoldX on every visit (D-2, P0)

```ts
// workflowOrchestrator.ts:238
const needsBiophysicsBackfill =
  !cached.mutantPdb || !cached.foldingEnergetics ||
  cached.foldingEnergetics?.stabilityoracle == null ||   // ← never satisfiable (§3.2)
  cached.foldingStatus === "failed" || cached.foldingStatus === "unavailable";
```

Because StabilityOracle can never return a number in this environment (§3.2), the third clause is
**always true**. Every revisit therefore re-dispatches the full FoldX pipeline with a fresh 300 s
watchdog — which then fires (§4.1) and writes `failed` + the timeout message into live state
(`workflowOrchestrator.ts:305-312`). The cached snapshot itself is not corrupted (`setCachedVariant`
is only called on success paths, `foldxService.ts:142-155`), so the next visit loads good values and
then stamps them with a fresh failure. This is why the screen shows **cached values and a current
failure simultaneously** — DynaMut2 = −0.09 survives from the cached record while FoldX is marked
Failed by the watchdog that just ran. It also means the FoldX pipeline is re-executed on every
single visit, which is a large and pointless compute cost.

### 4.3 Partial results are cached and re-served

`foldx/cache.ts:92` deliberately refuses to cache failed, null-`ddG`, or RepairPDB-failed runs —
good. But the *enriched* payload does legitimately carry `energetics.foldx === null` alongside
populated remote engines (asserted in `foldx.test.ts:328-331`), so the UI must handle
"FoldX absent, others present". The engine table's ordering does handle it
(`EnergeticsView.tsx:513-520` takes `foldingStatus === "failed"` first), but the consensus then
silently drops from a multi-method average to a single-tool estimate with only the "(Single-Tool
Estimate)" suffix to say so (`consensus.ts:216-223`).

---

## 5. RCA — status-model failures

### 5.1 ThermoMPNN's frozen spinner is a provable deadlock (D-4, P1)

The state model is per-engine and has no notion of "the run is over" — and for ThermoMPNN the
non-terminal state is not merely unhandled, it is **unreachable by any recovery path**. Three
defects compound into a cycle with no exit:

1. **Status is written before submission resolves.** `generation.ts:553-554` sets
   `thermompnnStatus = "pending"` and only the `.then`/`.catch` branches assign terminal values
   (`:557-585`).
2. **The response ships on a 1.5 s deadline while the submission allows 15 s.**
   `generation.ts:610-615` races the submission promises against
   `new Promise(r => setTimeout(r, 1500))`, whereas the sidecar call itself permits
   `AbortSignal.timeout(15000)` (`energy-models.ts:305-307`). For a cold sidecar,
   `{thermompnnStatus: "pending", thermompnnJobId: null}` is therefore the **normal** outcome, not
   an edge case.
3. **The client refuses to poll without a job id.** `useJobPoller.ts:52`:
   `if (status !== "pending" || !jobId) return;` — so no job id means no poll.

That third condition closes the loop: SSE cannot rescue it either, because the SSE subscription is
per-job-id (`useJobPoller.ts:63`) and ThermoMPNN updates are only ever broadcast *from inside the
poll handler* (`polling.ts:274-276`). **No job id ⇒ no poll ⇒ no SSE ⇒ never terminal.** There is no
watchdog for the "pending without jobId" state, and the UI has no `pending` terminal branch —
`isThermompnnPending` treats `pending` as running indefinitely (`EnergeticsView.tsx:430-433, 542-569`).

A *started* poll is properly bounded (60 attempts / 10 min → `"unavailable"`,
`useJobPoller.ts:31-32, 119-126`), which is what makes the null-job-id path the decisive defect: the
bounded path is never entered.

**A second, independent route to the same symptom:** the sidecar's HTTP 503 is mapped to `pending`
rather than to an error — `energy-models.ts:333-335` returns
`{status: "pending", error: "ThermoMPNN engine is warming up: …"}` whenever
`localRes.status === 503 || /warming|initializing/i.test(detail)`. But the sidecar raises exactly 503
for a **permanently unloadable checkpoint** (`tools/model_server_app/routers/thermompnn.py:331-336`,
guarded by a `match_ratio < 0.85` weight check at `:291-297`). Because the condition is an `||`, the
detail text is irrelevant: a hard engine failure is rendered as "Initializing" / "warming up"
(`EnergeticsView.tsx:544-551`). The UI's tooltip then claims "Local VESM-150M neural sidecar model
weights are warming up" for a model that will never load.

Net effect: after a FoldX timeout the user sees "Simulating…" / "In Progress" and a consensus badge
promising "Calculating: ThermoMPNN" for a computation with no route to a result. That is the single
most misleading element on the screen.

### 5.2 The same null-job-id race affects DynaMut2 and DDMut

`dynamut2Status = "pending"` (`generation.ts:475`) and `ddmutStatus = "pending"` (`:513`) are
likewise written before their submissions resolve, behind the same 1.5 s race
(`generation.ts:610-615`) while the BioSig submissions allow 30 s × 3 attempts with backoff
(`dynamut.ts:187-193`). So `pending` + `jobId: null` is routine for all three remote engines.

The only channel that ever delivers a late-resolved job id is the FoldX poll
(`foldxService.ts:212-215`) — which dies exactly when FoldX fails, and which deliberately refuses to
propagate non-terminal statuses (`:216-226`, commented "never clobber client's terminal status back
to pending"). Consequence: DDMut/DynaMut2 rows can display "Running NMA…" / "Graph Embedding…"
indefinitely, and the failure mode is coupled to FoldX's health rather than to their own.

### 5.3 Staleness escape uses a timestamp that unrelated writes refresh

`resolveRestoredStatus` repairs an ancient `pending` by downgrading it to `unavailable`
(`workflowOrchestrator.ts:147-152`: `if (status === "pending" && isStale) return "unavailable"`).
But `isStale` is derived from the **bundle-level** `cached.timestamp`, which is refreshed by
unrelated writes — `variantCache.ts:133`, and landscape/multimer writes at
`biophysicalService.ts:142, 196`. A long-dead `pending` status can therefore look fresh and be
re-polled, and the guard silently mislabels a still-running engine as unavailable when the bundle
happens to be old. FoldX has no equivalent staleness escape at all.

### 5.4 "Skip Slow Predictors" does not skip anything (D-5, P0 — honesty)

`onSkipSlowPredictors` is wired to `setSkippedSlowPredictors(true)`
(`EnergeticsView.tsx:167,227-228`) — pure local UI state. Nothing is aborted, cancelled,
deprioritised, or even stopped from being awaited; no request is dropped and the server is not told.
Yet the button's effect is to:

* hide the progress banner (`EnergeticsView.tsx:404`),
* relabel DynaMut2/DDMut rows **"Skipped by User"** (`EnergeticsView.tsx:496-503`) — asserting a
  server-side outcome that did not occur,
* and remove them from `pendingTools` (`EnergeticsView.tsx:661-666`), which changes the
  "N-Method Calibrated Consensus" heading and the preliminary badge.

So a cosmetic toggle can change the reported method count and the verdict's framing with no change
in data. Two users looking at the same variant can see "3-Method" and "1-Method" depending on
whether one clicked a button that did nothing.

### 5.5 Status vocabulary has no shared meaning

Fourteen distinct labels describe the state of six engines
(`Simulation Failed`, `Upstream Congested`, `Not in Zenodo DB`, `In Progress`, `Standby`,
`Not Computed`, `Skipped by User`, `Initializing`, `Unavailable (No Heuristics)`,
`Coverage Limited`, `Not Available`, `API Limit / Failed`, `Offline`, `Idle`). Several are
synonyms for the same technical state; several are wrong for the state they describe:
"Offline" (`EnergeticsInspector.tsx:261`) for a service that is simply not configured;
"API Limit / Failed" for any ThermoMPNN error; "Coverage Limited" for a dataset miss; "No
Heuristics" for a missing dependency. The type union is also looser than the code:
`thermompnnStatus` is typed `"pending" | "unavailable" | "done" | "error" | null` in the view
(`EnergeticsView.tsx:30`) while `dynamut2Status`/`ddmutStatus` omit `"error"` even though
`foldxService.ts:217-222` can write it.

---

## 6. Correctness defects

### 6.1 The same DynaMut2 value is displayed with two opposite signs (D-6, P1)

* Table: DynaMut2 uses `invertSign: true` (`EnergeticsView.tsx:438`), so `−0.09` renders as
  **`0.09 kcal/mol`** with a "Neutral" badge (`EnergeticsView.tsx:463-467`).
* Calibrated Tool Breakdown, a few centimetres below: `formatDdGValue(t.val)` with no inversion →
  **`−0.09 kcal/mol`** (`EnergeticsView.tsx:762`).
* The footnote under the table asserts "positive ΔΔG = destabilizing, negative ΔΔG = stabilizing"
  (`EnergeticsView.tsx:614-616`) without stating that the breakdown panel shows raw native
  convention (where the sign is reversed for DynaMut2/DDMut).

**Which one is right?** The breakdown. `calibrateRawScore("dynamut2", −0.09)` interpolating the
fitted curve (`stacking_config.json:110-120`: `−0.5 → p 0.25`, `0.0 → p 0.05`) gives
p = 0.086, lower = 0.035, upper = 0.167 — i.e. exactly the displayed **9 % [4 %–17 %]**. So the
consensus is computed from the raw signed value and is internally consistent; the table's
unlabelled sign flip is the defect. Note also that the risk badge's thresholds are hard-coded
(1.5 / 0.5 / −0.5, `EnergeticsView.tsx:244-253`) even though `THRESHOLDS` is imported at
`EnergeticsView.tsx:14` and never used — the tuned constants in
`shared/thresholds/constants.ts:86-96` are bypassed.

### 6.2 The consensus is computed twice, from different inputs (D-7, P1)

| | Tool values | Context features | Residue index | pLDDT |
|---|---|---|---|---|
| Server (`energy-models.ts:535-544`) | ✅ | ❌ omitted | ❌ omitted | ❌ omitted |
| Client (`EnergeticsView.tsx:317-319`) | ✅ | ✅ `uniprotFeatures` | ✅ `residueIndex` | ✅ `disruptionPredictor?.plddt` |

`computeCalibratedConsensus` uses `getResidueContext(features, index)` to pick per-protein-class
calibration weights (`consensus.ts:158,183`) and damps structure-dependent tools by pLDDT
(`consensus.ts:160-170`). The server passes neither, so it silently uses the `"unknown"` context and
a pLDDT of 100. The server's `consensusVerdict` (with its "(Preliminary - pending: …)" suffix) is
the one exported for the report/insights surfaces, while the Energetics tab displays its own
recomputation — so **the same variant can carry two different verdicts in two tabs**. The server
result also carries `consensusProbability/ConfMin/ConfMax` (`energy-models.ts:581-583`) that the
Energetics view ignores in favour of its own numbers.

### 6.3 Dead, broken and overridden style classes

* `text-slate-450` (`EnergeticsView.tsx:806`) — Tailwind has no `450` shade, so this is a silent
  no-op; the modal close button gets no hover colour.
* `borderColor: "rgba(255,255,255,0.05)"` (`EnergeticsView.tsx:759`) — a white hairline that is
  invisible in light mode and drawn from a raw value instead of a token.
* `bg-slate-800/80` + `border-slate-700/50` (`EnergeticsView.tsx:692`) — the consensus gauge track is
  hard-coded dark: a black bar in light mode, and at **1.11:1** against `--cs-surface-2` it
  disappears entirely in dark mode.
* **The declared table-header size is dead.** All four `<th>` elements set `text-[11px]`
  (`EnergeticsView.tsx:413-416`), but the row carries `table-header-row` (`:412`) and
  `typography-tables.css` sets `font-size: var(--cs-font-size-table-header) !important` (12px) plus
  `color: … !important` on `.table-header-row th`. Both the utility and the inline
  `style={{ color }}` on each `<th>` are overridden, so declared ≠ rendered.
* **`--cs-radius-lg` is referenced but never defined.** `typography-tables.css:177` uses
  `border-radius: var(--cs-radius-lg) !important` while `variables.css:41-44` defines only
  `--cs-radius-card/input/badge/pill`. An undefined custom property makes the declaration invalid at
  computed-value time, so the radius falls back to `0`.
* `--cs-radius-card/input/badge/pill` are used 21 times across the stylesheet bundle but **zero
  times** in either Energetics file, which use six different literal radii instead (`rounded`,
  `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`).

### 6.4 Layout: the verdict sits outside the scroll region

`EnergeticsView` returns a `h-full flex flex-col` root whose scroll container
(`p-5 flex-grow overflow-y-auto`) closes at line 617. The consensus block (619-772) and the
methodology footnote (774-776) are **siblings after** that container, and the `classCard` passed in
from `AppViews.tsx:443` supplies no padding
(`"h-full flex flex-col border-0 rounded-none shadow-none"`). So the table is inset 20 px while the
consensus card and citation footnote render edge-to-edge, and the verdict is pinned below the
scrolling area rather than being the first thing read. The most important content on the tab is
outside the region the user scrolls and misaligned with everything above it.

### 6.5 The in-app method documentation contradicts itself — and RaSP's copy is wrong (D-9)

There are **two** independent method-documentation tables, and they disagree with each other *and*
with the shipped math:

| Engine | `EnergeticsView.tsx:46-119` | `evidence/MetricExplanations.ts` | Shipped math |
|---|---|---|---|
| DynaMut2 | "ΔΔG **≥ +1.0** … destabilization … **(Normalized:** … positive = destabilizing**)**" (`:59`) | "ΔΔG **≤ −1.0** … destabilization" (`:138`) | raw negative → high p (`stacking_config.json:82-127`) |
| DDMut | "ΔΔG **≥ +1.0** … (Normalized…)" (`:67`) | "ΔΔG **≤ −1.0** …" (`:146`) | raw negative → high p (`:129-174`) |
| RaSP | "ΔΔG **≥ +1.0** …" (`:75`) — correct | "ΔΔG **≤ −1.0** …" (`:151`) — **inverted** | positive → high p (`:176-215`), cut `≥ +1.0` (`constants.ts:130-133`) |
| ThermoMPNN | "≥ +1.0" (`:83`) | "≥ +1.0" (`:199`) | positive (`:217-256`) |
| StabilityOracle | "≥ +1.0" (`:91`) | "≥ +1.0" (`:207`) | positive (`:258-303`) |

So: the Energetics tab's own copy claims values are normalised to positive-is-destabilising, which
is true of the table but **false of the breakdown panel directly beneath it** (§6.1); the shared
Predictors copy states the native convention for DynaMut2/DDMut, which matches the math but
contradicts the Energetics table; and for **RaSP the shared copy is simply wrong** — a user who opens
the RaSP explanation from the Predictors tab reads the opposite of the rule the app applies. Two
near-verbatim copies of the same 9 engine entries, with divergent sign conventions, is a
documentation defect with scientific consequences.

### 6.6 Missing values are coerced to `0`, producing false precision (D-10)

`EnergeticsView.tsx:277-281` coerces absence to zero rather than preserving `null`:

```ts
const foldxSd = foldingEnergetics?.foldxSd ?? 0;
const vdw = foldingEnergetics?.vdw ?? 0;
const electrostatics = foldingEnergetics?.electrostatics ?? 0;
const localSidechainRmsd = foldingEnergetics?.localSidechainRmsd ?? 0.0;
```

The guard at `:454` (`energetics.foldxSd !== null && energetics.foldxSd !== undefined`) can then
**never** fail, so a run with no ensemble SD renders as `2.31 ± 0.00 kcal/mol` — asserting perfect
reproducibility across five stochastic runs from data that is absent. Every other consumer uses
`?? null` (`PerturbationInspector.tsx:150-151`), so this view is the outlier. The same coercion makes
"measured zero" and "not measured" indistinguishable for `vdw`, `electrostatics` and
`stericClashWarning`.

### 6.7 A client-supplied structure is labelled "AlphaFold Prediction"

The provenance badge handles three of the four `StructureProvenance.source` values
(`EnergeticsView.tsx:337-343`): `experimental` → "Experimental Structure", `homolog` →
"Structural Homolog", **everything else** → "AlphaFold Prediction". The contract
(`src/shared/contracts.ts:74`) also defines `client-provided`, and the server sets exactly that when
the PDB came from the client (`generation.ts:391`: `source: resolvedStructure?.provenance.source ??
"client-provided"`). A user-supplied structure is therefore displayed as an AlphaFold prediction —
a provenance claim that is not merely imprecise but factually wrong, on the one field the FoldX
result depends on. It also silently picks the neutral (non-experimental) surface treatment, so the
badge misleads in both text and styling.

### 6.8 FoldX's thresholds are applied to all six engines (D-11)

`getDdGBadge` hard-codes FoldX's cut-points — `> 1.5`, `> 0.5`, `< −0.5` (`EnergeticsView.tsx:244-253`)
— and applies them to every row, although `THRESHOLDS` is imported and unused at `:14`. The tuned
per-engine cuts differ: RaSP, ThermoMPNN and StabilityOracle all use **≥ +1.0**
(`constants.ts:126-137`). So a RaSP ΔΔG of +1.2 renders "Moderately Destabilizing" in the table while
`normalizeDestabilizationMagnitude` classifies it `isDestabilizing: true` (`consensus.ts:33-37`) and
the calibration curve treats it as a ~70 % destabilisation probability — three surfaces, two
different verdicts about one number.

The pLDDT caveat has the same shape: the UI appends "(Speculative)" to **all six** engines when
pLDDT < 70 (`EnergeticsView.tsx:468-474`), while the consensus damps only
`foldx`/`thermompnn`/`stabilityoracle` (`consensus.ts:162-170`). The displayed caveat and the
computed weighting disagree about which numbers are trustworthy.

### 6.9 The explanation modal is a divergent clone that loses scroll

`EnergeticsView.tsx:780-868` reimplements `evidence/MetricExplanationModal.tsx` almost verbatim — but
drops the shared component's `max-h-[60vh] overflow-y-auto` (`MetricExplanationModal.tsx:51`) while
keeping the fixed, centred container. Long `interpretation` strings therefore overflow an element
with no overflow handling and become **unreachable rather than scrollable**. The two copies also
disagree on surfaces: the shared one hardcodes `isDark ? "#1C1A17" : "#FAF9F6"`
(`MetricExplanationModal.tsx:25`) while the clone uses `var(--cs-surface-2)`
(`EnergeticsView.tsx:788`), so the "same" modal has two different backgrounds depending on which tab
opened it.

### 6.10 Failed runs are retained in the client's in-memory cache

`setCachedVariant` writes the in-memory map **before** applying its own guard:

```ts
// src/services/pipeline/variantCache.ts
136:  memoryVariantCache.set(key, updated);   // ← written first
...
187:  if (updated.foldingStatus === "failed" || (updated.foldingEnergetics as any)?.foldxError || isPreliminary) {
188:    return;                                // ← protects sessionStorage only
189:  }
```

`getCachedVariant` reads memory first for 24 h (`variantCache.ts:85-91`), so a `failed` or
`preliminary` bundle the guard was written to exclude survives in memory and is restored on revisit
(`workflowOrchestrator.ts:146` restores `foldingStatus = "failed"`, and the row paints
"Failed / Simulation Failed"). The server-side cache is correctly protected
(`foldx/cache.ts:93-96` refuses non-success; `:49-53, 71-74` ignore `failed` entries) — the
inconsistency is client-side ordering.

### 6.11 Internal error strings are rendered verbatim to clinical users

`EnergeticsInspector.tsx:150-158` prints `{foldingError}` in a monospace block, fed by
`foldxService.ts:290-292`, which passes server messages straight through — HTTP status text,
`Target residue position 433 … is not found in the PDB structure`, `FoldX BuildModel failed (…
RepairPDB)… Verify that wt.pdb is a valid PDB structure`, and circuit-breaker prose. Also
`:193` `title={foldingError}`, `:201` `Failed: ${foldingError.slice(0, 32)}...`, and `:70-79` renders
`{thermompnnError}` raw — which for an unconfigured deployment is literally
"Tamarind Bio API key not configured" (`energy-models.ts:434`).

Server-side the leak goes further than display: `generation.ts:136-140` bakes the failure into the
returned narrative —

```ts
structuralImpact: `structural impact details unavailable. (${err.message || "Failed to connect to Gemini API"}).`
```

— and the surrounding handler caches it via `writeToCache(cacheKey, result)` (`:134`), so a raw
exception message becomes a 24-hour cached clinical narrative.

### 6.12 "Upstream Congested" is a diagnosis the code never establishes

`label: "Upstream Congested"` fires on `ddmutStatus === "unavailable"` alone
(`EnergeticsView.tsx:535-541`), with a tooltip asserting "BioSig DDMut GPU worker queue at Univ. of
Queensland is currently congested (>5m timeout)". The value `unavailable` is produced by at least
six different conditions — submission non-OK, non-JSON response, missing `job_id`, any thrown error
(`dynamut.ts:195-224`), the 5-minute registry staleness cutoff (`polling.ts:291, 355`), an upstream
`ERROR` status (`:425-428`), a network exception (`:453-457`), **and a local circuit breaker**
(`http-client.ts:70, 99, 124`). Only one of those is congestion. Compounding it: the circuit breaker
`new CircuitBreaker(5, 60000)` is registered **per host and shared by both tools**
(`http-client.ts:64-74`), so repeated DDMut failures can open the breaker for DynaMut2 — meaning one
engine's trouble can manufacture the other's "unavailable", and the UI will attribute both to
congestion.

### 6.13 The queue result is enriched twice

`server.ts:149` enriches the job result, and `polling.ts:204` / `:229` enrich it again from
`remoteJobs`. `pendingTools`, `consensusVerdict` and the failure strings can therefore be recomputed
from two different `remoteJobs` snapshots within one run, which is another route to the client and
server disagreeing about the verdict (§6.2).

### 6.14 Dead and hidden surfaces in the failure state

* `foldingError` is destructured and never used (`EnergeticsView.tsx:224`) — the terminal FoldX
  failure is visible only in the inspector, so the main column cannot explain its own red row.
* The entire consensus block is **hidden** when all six engines are null (`EnergeticsView.tsx:620`),
  leaving no explanation on screen at all — the one case where an explanation matters most.
* `isPending: false` is hard-coded for RaSP (`EnergeticsView.tsx:440`), so a genuinely pending RaSP
  can never report progress.
* The progress banner advertises "typical: 45–75s" (`EnergeticsView.tsx:162`) while the client is
  about to declare a 5-minute timeout — the reassurance and the deadline come from unrelated
  constants.

---

---

## 7. UI/UX analysis — organization and polish

### 7.1 The same six engines are listed five times

| # | Surface | Purpose served | Redundancy |
|---|---|---|---|
| 1 | Engine table (`EnergeticsView.tsx:408-613`) | value + coarse risk per method | — |
| 2 | Calibrated Tool Breakdown (`EnergeticsView.tsx:728-769`) | value + calibrated P per method | value duplicated (with the opposite sign — §6.1), P is new |
| 3 | Stability Engine Telemetry (`EnergeticsInspector.tsx:172-263`) | per-engine status detail | **status duplicated from the table's Risk column** |
| 4 | Active Method Diagnostics (`EnergeticsInspector.tsx:61-163`) | long-form failure prose | same failures as the Risk column, in different words |
| 5 | Methodology footnote (`EnergeticsView.tsx:774-776`) | names all six engines | names engines unconditionally, even when none ran |

Quantified:

* **14 distinct display names for 6 engines.** FoldX alone appears as "FoldX (Mean ± SD)" (`:437`),
  "FoldX (Ensemble ddG)" (`:742`), "FoldX 5.0" (`EnergeticsInspector.tsx:191`) and "FoldX ddG"
  (modal, `:48`); RaSP as "RaSP" / "RaSP (Rapid ddG)" / "RaSP (Rapid Stability Prediction)"
  (`:440`, `:746`, `EnergeticsInspector.tsx:247`, `:73`).
* **Two contradictory taxonomies for the same `Type` cell** — the table's text and the modal's
  `category` disagree for 5 of 6 engines (e.g. RaSP "ESM-IF1 Structural Embeddings / MLP" vs
  "Structural Embeddings / MLP Stability Head").
* **~26 name occurrences and 27 numbers for 6 quantities**: 6 ΔΔG in the table (`:596`), the same 6
  again in the breakdown (`:762`), 6 × (P% + interval) (`:763`), plus the consensus p/min/max
  (`:688`, `:713`).
* **Three computed metrics are hidden.** `vdw`, `electrostatics`, `localSidechainRmsd` and
  `stericClashWarning` are computed at `:277-281` and rendered nowhere on this tab (they surface only
  in `PerturbationInspector.tsx:150-151`). The screen shows the same six engines five times and hides
  its own three physics terms.
* **The failure taxonomy is also duplicated in code**: the "is FoldX excluded" rule exists twice
  (`:624-632` and `consensus.ts:140-147`), and `activeToolsCount` is derived independently from the
  number of tools the consensus actually averaged.

Each of 1–3 repeats the same six-row key. A user must scan three places to answer "did FoldX work?"
and reconcile three vocabularies to do it. Consolidating to **one** engine table with columns
`Method · ΔΔG (normalised) · Calibrated P · State`, where the State cell carries the single
canonical label and expands in place to the diagnostics prose, removes ~2/3 of the vertical
content without losing information.

### 7.2 What the user actually has to decide

The tab exists to answer three questions. Current coverage:

1. **"Is this variant destabilising?"** → answered, but only by the consensus block at the bottom,
   outside the scroll region, below a six-row table of failures.
2. **"How much should I trust that?"** → **not answered.** The 90 % conformal interval is present
   (9 % [4 %–17 %]) but coverage is not: nothing says "1 of 6 engines returned a value". The green
   "Low Misfolding Risk" badge is styled at the same visual weight for a 1-tool and a 6-tool
   estimate (`consensus.ts:217-223` appends "(Single-Tool Estimate)" to the *text* only).
   *(Note: the conformal band is derived from the averaged per-tool bands, so with n=1 it is
   artificially narrow — it reflects one model's uncertainty, not the absence of five others.)*
3. **"Which tools are missing, and does it matter scientifically?"** → answered badly: the failure
   classes that matter (RaSP is not a proteome-wide resource; StabilityOracle is not installed;
   DDMut is queue-limited upstream) are rendered as infrastructure vocabulary
   (Zenodo, BioSig, "No Heuristics").

**Recommended target structure for the main column:**

1. **Verdict header** (moved to the top, inside the scroll region): the calibrated probability, the
   conformal band, and an unmissable coverage indicator — `n of 6 engines` with a degraded-state
   treatment (see §7.5).
2. **`Destabilization ≠ Pathogenicity` caveat** — currently in the inspector; it belongs beside the
   verdict, because it is the interpretive frame for the number above it.
3. **Single engine table** — `Method · ΔΔG · Calibrated P · Coverage/State`, each row expandable
   for the method explanation (the existing modal content) and the diagnostics prose.
4. **Structure provenance strip** (already exists, `EnergeticsView.tsx:334-401`) — keep; it is
   genuinely decision-relevant when FoldX is the arbiter.
5. **Methodology footnote** — keep, but merge with the calibration note so the tab has one
   footnote rather than two competing ones (`EnergeticsView.tsx:614-616` and `774-776`).

**Inspector target structure:** `Verdict trust panel` (coverage + what is missing and why, one row
per engine, plain language) → `Structure/provenance & physical reference` (merge the current
"Physical Reference & Baseline" with the structure badge) → `Units`. Delete the duplicated telemetry
list and the duplicated diagnostics alerts once the table's expandable rows carry them.

### 7.3 State labels need to collapse into a taxonomy

An exhaustive enumeration of both files finds **~40 distinct state strings for what is really 7
states × 6 engines** — including 14 synonym strings for "work in flight" alone (`In Progress`,
`Running NMA...`, `Graph Embedding...`, `3D Graphormer...`, `Simulating...`,
`Repacking sidechains...`, `Remote NMA Server...`, `Graph Deep Learning...`,
`ProteinMPNN Embeddings...`, `Warming Up`, `Initializing`, `Preliminary — Calculating`, plus the 4
stepper chips, which use *different* names from the sentence printed directly beneath them —
`EnergeticsView.tsx:147-150` vs `:126-130`).

Specific labels that are **technically wrong for the state they describe**:

| Finding | Evidence |
|---|---|
| A genuine ThermoMPNN **failure** renders as neutral `Standby` (slate) while a benign warm-up renders as amber `Initializing` — severity is inverted | `EnergeticsView.tsx:543-567` vs `:546-551` |
| The same failure is `Standby` (slate) in the table and `API Limit / Failed` (rose) plus a rose card in the inspector | `:554-558` vs `EnergeticsInspector.tsx:261`, `:71-79` |
| ThermoMPNN's *default* state (`null`) reads **`Offline`** — a claim about a server, not "not started" | `EnergeticsInspector.tsx:261` |
| `Structure Graph ML (Ready)` is derived from "a value exists", not from engine readiness | `EnergeticsInspector.tsx:213, 217` |
| `Standby` is assigned six different ways, three of them with **no tooltip at all**, so hover explains nothing | `EnergeticsView.tsx:568, 572-575, 577` |
| `"Not Computed"` is **unreachable** — `getDdGBadge`'s null branch (`:242`) is only called when the value is non-null (`:453`) | `:242` vs `:453` |
| A failed FoldX can render `In Progress`, because the pending branch never consults `foldingStatus === "failed"` (only the else branch does) | `:421` vs `:513` |

Recommended canonical states, with every current label mapped onto one of them:

| Canonical state | Meaning | Current labels to absorb |
|---|---|---|
| **Computed** | value present | — (tables show the value) |
| **Running** | in flight, with elapsed time | In Progress, Simulating…, Repacking sidechains…, Remote NMA Server…, Graph Embedding…, 3D Graphormer…, Warming Up, Initializing, Preliminary — Calculating |
| **Not installed** | dependency absent locally; user-infixable | Standby, Offline, Not Installed (Mount Binary), Unavailable (No Heuristics), Not Available, Idle |
| **Not covered** | dataset miss; not fixable | Not in Zenodo DB, Coverage Limited, Not Computed |
| **Upstream busy** | third-party queue/timeout; retryable | Upstream Congested, BioSig Queue / Unavailable, ΔΔG Partial (Async Services Offline) |
| **Upstream error** | third-party failure; retryable | API Limit / Failed |
| **Failed** | our pipeline failed | Simulation Failed, Biophysical Simulation Failed, Failed: … |
| **Skipped** | user opted out *and it was actually skipped* | Skipped by User (see D-5) |

Three distinctions carry real user value and are currently unexpressible: **fixable by me
(installed) vs not fixable (coverage) vs retry later (upstream)**.

Also unexplained jargon that should move to a single provenance disclosure rather than a status
cell: `Upstream Congested`, `Zenodo`, `BioSig`, `NMA`, `pLDDT`, `Conformal`/`isotonic`,
`3D Graphormer`, `VESM-150M neural sidecar`, `Siamese`, `rotabase.txt` / `molecules/` /
`/app/tools/foldx/` (container paths shown to a clinical user, `EnergeticsInspector.tsx:116`).

### 7.4 Typography and density

**Measured type inventory** (arbitrary-value classes counted per file):

| File | Bracket sizes (occurrences) | Other scale classes |
|---|---|---|
| `EnergeticsView.tsx` | 9px ×8, 10px ×10, 11px ×6, 12px ×3 = **27** | `text-xs` ×6, `text-sm` ×1, `text-base` ×1, `text-lg` ×1 |
| `EnergeticsInspector.tsx` | 9.5px ×3, 10px ×18, 10.5px ×9, 11px ×9 = **39** | `text-xs` ×1 (root) |

* **10 distinct declared sizes** on one screen, **6 of them inside a 3 px band** (9–12 px). Deltas of
  0.5 px are not perceivable, so hierarchy inside that band is carried entirely by colour, case and
  tracking — not size.
* **Every heading is smaller than the text it introduces.** The shared section label is 10px
  (`SectionLabel.tsx:23`) and the body copy under it is 10.5–11px
  (`EnergeticsInspector.tsx:51, 54`). The design system's own tokens for these roles —
  `--cs-font-size-section-label: 13px` and `--cs-font-size-numeric: 13px` (`variables.css:61, 70`) —
  appear in **neither file**. `--cs-text-micro` (10px) and `--cs-text-badge` (11px) are likewise
  bypassed by bracket literals.
* **Line heights are accidental.** There are only 10 explicit declarations, all `leading-relaxed`
  (1.625). `text-xs` sets both size and a 16px line-height, while `text-[9px]` sets only size — so
  9px caveats render on a 16px line box (1.78) next to 12px text at 1.33.
* **Caveats are set in the smallest type on the screen**, roughly inverting epistemic importance:
  the 9px items are the "Preliminary — Calculating…" chip (`:674`), the conformal interval (`:711`),
  "Calibrated Tool Breakdown:" (`:729`), the methodology footnote (`:774`) and all four modal section
  labels; the verdict badge is 10px bold (`:679`).
* **43 raw Tailwind palette classes** in `EnergeticsView.tsx` and **39** in
  `EnergeticsInspector.tsx` (`text-slate-400` ×9, `bg-slate-500/10` ×5, `border-amber-500/20` ×5, …).
  The theme defines semantic equivalents (`--color-cs-text-warning`, `--color-cs-bg-danger`,
  `--color-cs-text-danger`, `variables.css:183-189`) that exist precisely for these states.
  `EnergeticsView.tsx` contains **zero** `dark:` variants.
* Consequence: the same concept ("this engine is degraded") is rendered in at least four different
  amber/slate recipes across the two files, so severity is not comparable at a glance. The amber
  style additionally carries three unrelated meanings — moderate value (`:248`), low pLDDT (`:472`)
  and repair failure (`:479`) — so "Highly Destabilizing (Speculative)" becomes visually identical to
  "Moderately Destabilizing".
* The verdict's severity is chosen by **substring matching the verdict string**
  (`:634-641`: `includes("High")` / `includes("Moderate")` / `includes("Insufficient")`) — a
  stringly-typed rubric, and the single-tool verdict matches no branch, so it silently inherits the
  default emerald.
* **Spacing has no shared grid**: **21 distinct spacing utilities** in the main column and 8 in the
  inspector. The table card uses `p-3`/`px-4` (`:413`) while the card directly below it uses
  `p-3.5`/`space-y-3.5` (`:621`); inspector sections are separated by a 16px parent gap (`:42`) before
  the rule and `pt-3` after it (`:62, 166, 268, 291`).
* The main column nests two independent scrollbars (`:322` + `:330`, plus `ViewInspector.tsx:388`)
  and the inspector reserves 80px of dead space at the bottom (`pb-20`, `ViewInspector.tsx:388`) with
  no fixed footer.
* The ΔΔG column is `text-center` with no `tabular-nums` (`:596`), so decimals do not align down the
  column — while the sibling panel uses `tabular-nums` (`PerturbationInspector.tsx:193`) and the
  house class `.table-numeric` (`typography-tables.css:6-12`, which sets it) is never used here.

### 7.5 The trust gap: coverage must be visual, not textual

The single most important UX defect is that a 1-in-6 estimate is presented in the same green,
same weight, same size as a 6-in-6 estimate. **Proven**: the style rubric at
`EnergeticsView.tsx:634-641` selects emerald as its *default* and only switches on
`includes("Insufficient")`, `includes("High")`, `includes("Moderate")`/`includes("Elevated")` — so
`"Low Misfolding Risk (Single-Tool Estimate)"` and `"Low Misfolding Risk (Neutral Stability)"`
receive the **identical style string** `"bg-emerald-500/10 text-emerald-400 border
border-emerald-500/20"`. The only separating channels are the `text-[10px]` grey
`{activeToolsCount}-Method` prefix (`:671-672`) and the 9px "Preliminary — Calculating" chip
(`:674`) — the sample-size caveat is set smaller and dimmer than the verdict beside it, in 1.92:1
green.

Two secondary weaknesses in the same header: the `n` is derived from `activeToolsCount` (`:632`,
computed from non-null raw values via its own duplicated exclusion logic `:624-632`) rather than
from the number of tools actually averaged (`consensus.ts:176, 190`); and the verdict is recomputed
client-side (`:318`) while the report prints the persisted server verdict — which can differ (§6.2).
The "Preliminary — Calculating" chip is also built **only** from `*Status === "pending"`
(`:661-677`), so terminally *failed* engines are excluded from the caveat: the chip lists what is
still running and stays silent about what has already been lost. The breakdown panel compounds this
by dropping null tools entirely (`:750-751`), so it never says "DDMut: lost upstream".

The fix is cheap because the data already exists and is already computed — the tab simply never
reads it. `evidenceComplete` and `pendingTools` are in the shared contract (`contracts.ts:109-110`)
and are maintained in `useBiophysicalModeling.ts:255-461`, but this screen re-derives its own count
instead. Recommendations:

* Extend `computeCalibratedConsensus` to **return** `availableCount`, `intendedCount`, the
  per-engine inclusion decision with reasons, and an `insufficient` flag — one source of truth
  instead of two derivations (see §6.2).
* Make the coverage indicator **structural**: render the verdict as `n/6` engine chips (filled =
  computed, hollow = missing, colour-coded by *why* it is missing) directly above the probability.
* Give the degraded state a distinct surface treatment — when n ≤ 2, the verdict card should not be
  green at all; use the neutral/warning surface and an explicit label such as
  "Provisional — 1 of 6 engines".
* Widen the displayed interval honestly: state that with n = 1 the conformal band reflects a single
  model, not the ensemble.
* Aggregate the failures into one headline sentence ("5 of 6 engines returned no value: 3 remote
  timeouts, 1 not installed, 1 not in the local database") with the detail behind a single
  disclosure.
* Move the 90 % conformal interval out of 9px into the verdict line, and give the gauge track a
  theme-aware colour (`:692` is invisible in dark).
* Never let the method count change without the data changing (D-5).

### 7.6 Accessibility

| # | Issue | Location | Impact / fix |
|---|---|---|---|
| A1 | No dialog semantics: no `role="dialog"`, `aria-modal`, `aria-labelledby` | `EnergeticsView.tsx:784-792` | Screen readers do not announce the modal; add the roles (or reuse the shared modal and add them once) |
| A2 | No Escape handler — the file contains no `onKeyDown` at all | `:784-868` | Close on `Escape`, restoring focus to the invoking button |
| A3 | No focus trap, no initial focus, no focus restore. The modal is **not portaled** — it renders inside `#energetics-view` (`:322`), so Tab walks out into the table and then the inspector | `:784-868` | Trap focus; use a portal or `<dialog>` |
| A4 | Backdrop click does not close (no handler on the overlay) | `:784` | Add a backdrop `onClick` with `stopPropagation` on the panel |
| A5 | No scroll lock: both background scroll containers stay scrollable | `:330`, `ViewInspector.tsx:388` | `inert`/`overflow:hidden` while open |
| A6 | Method button has `focus:outline-none` with **no** `focus-visible` replacement (WCAG 2.4.7), and no `aria-haspopup`/`aria-expanded`; the accessible name is "engine name + unlabelled icon" | `:584-593`, `:587` | Add a visible focus ring and dialog semantics |
| A7 | `aria-live="polite"` wraps a **per-second** elapsed counter | region `:154`, interval `:137-143`, mutating text `:161-163` | A live region that announces every second for 45–75 s; move the counter out, announce only stage transitions |
| A8 | Gauge is bare `div`s with an absolutely positioned marker and band — no role, no ARIA values | `:692-708` | `role="meter"` + `aria-valuenow/min/max`; a visually-hidden caption for the interval band |
| A9 | Heading skip `h1` → `h4`; section titles are `<span>`s; the inspector's 5 section labels are inlined spans rather than the shared `SectionLabel` (`h3`) | `:324` → `:331`; spans `:671, :729`; `EnergeticsInspector.tsx:45, 63, 167, 269, 292` | Restore heading structure so the panel is navigable by heading |
| A10 | Colour-only encodings: the gauge band; and the amber style is *overwritten* for speculative/low-confidence values, making "Highly Destabilizing (Speculative)" hue-identical to "Moderately Destabilizing" | `:468-481`, `:634-641`, `:694-700` | Render confidence as a separate badge/icon; never overwrite a severity colour |
| A11 | Status distinction by opacity + motion only: `bg-amber-500 animate-ping` (pending) vs `bg-amber-500/70` (unavailable) | `EnergeticsInspector.tsx:224, 235, 257` | Use distinct glyphs, not fill + animation |
| A12 | `reduce-motion` suppresses the only motion cue, collapsing pending and unavailable to near-identical amber | `primitives.css:323-340` | The cue must not be motion-dependent |
| A13 | Table has no `<caption>` and headers lack `scope="col"` | `:410-417` | Add both |
| A14 | ~14 tooltips exist **only** as `title` attributes, and three `Standby` branches have no tooltip at all | tooltips `:494-565`; missing `:568, 572, 577` | Render the reason as visible text; `title` is not keyboard/touch accessible |
| A15 | Close button's accessible name is `×` (`&times;`) with no `aria-label` | `:803-810` | `aria-label="Close method explanation"` |
| A16 | Non-text contrast: 8px status dots ≈2.5:1; `text-white` on `bg-cs-accent-clay` **3.89:1** in both themes | `EnergeticsInspector.tsx:180-190, 213, 224, 235, 246, 257, 302, 313`; `EnergeticsView.tsx:187` | Darken dots; use ink/darker clay on the selected segment |
| A17 | The empty state has no landmark while the populated state does | `:258` vs `:322` | Give both the same `role`/label |

The modal also **loses content**: the shared component it was cloned from has
`max-h-[60vh] overflow-y-auto` (`MetricExplanationModal.tsx:51`); the clone does not, and its wrapper
(`EnergeticsView.tsx:814`) has no max-height inside a fixed centred container (`:784-786`), so long
prose overflows unreachably rather than scrolling.

### 7.7 Dark/light mode

**Two independent defects.**

**(a) The `dark:` variant is not wired to the app's theme toggle.** The app themes by toggling
`.dark` on the root (`SettingsContext.tsx:122-125`) and there is **no `@custom-variant dark`
declaration anywhere** — `src/index.css` imports Tailwind v4 and defines only an `@theme` font block.
In Tailwind v4, `dark:` compiles to `@media (prefers-color-scheme: dark)`, so the app's toggle and
every `dark:` utility are **decoupled**. In `EnergeticsInspector` this affects the diagnostics
headings: `text-rose-900 dark:text-rose-200` (line 72), `text-amber-900 dark:text-amber-200`
(85, 98, 124), `text-rose-900 dark:text-rose-200` (152). A user on a light-preference OS who selects
Dark mode (`Dark mode` is offered in the left rail) gets **dark maroon on a dark surface** for exactly
the alert titles that explain the failures. Fix: add
`@custom-variant dark (&:where(.dark, .dark *));` — or better, replace these pairs with the semantic
`--cs-text-danger` / `--cs-text-warning` tokens that already resolve per theme.

**(b) The most important text is the least legible in light mode.** Contrast computed against the
real surfaces (`--cs-surface #FFFFFF`, `--cs-surface-2 #FAF9F6`; `variables.css:16-17`); WCAG AA for
the 10–11px text used here is 4.5:1. Two entries were recomputed independently during this audit and
matched:

| Colour | Line | Role | Light contrast | Verdict |
|---|---|---|---|---|
| `text-emerald-400` | `:634` | **the headline "Low Misfolding Risk" verdict** | **1.92:1** | worst failure on the screen — the primary verdict is the least legible text |
| `text-amber-400` | `:532, :539, :640` | "Upstream Congested" ×2, moderate verdict | **1.67:1** | fails |
| `text-slate-400` | `:501, :556, :564, :574, :636` | "Skipped by User", "Standby" ×3, "Insufficient…" | 2.56:1 | fails |
| `text-slate-400` | `:198, :592, :720, :763` | ⓘ affordance, empty state, breakdown P%, stage detail | 2.56:1 | fails |
| `text-rose-400` | `:638` | High-risk verdict | 2.69:1 | fails |
| `text-rose-500` | `:518` | "Simulation Failed" | 3.66:1 | fails |
| `text-amber-500` | `:168`; `EnergeticsInspector.tsx:64` | "Skip Slow Predictors"; diagnostics icon | 2.15:1 | fails |
| `bg-slate-800/80` + `border-slate-700/50` | `:692` | gauge track | black bar in light; **1.11:1 in dark** | fails both ways |
| `rgba(255,255,255,0.05)` | `:759` | breakdown row divider | invisible on white | fails light |
| `hover:text-slate-200` | `:806` | modal ✕ hover | ≈1.1:1 on white — the glyph vanishes on hover | fails light |

The three value badges that dominate the table are all below AA at 10px, and `variables.css:101-105`
documents the fix that is not used: `--cs-text-danger` on `--cs-bg-danger` is only 3.95:1, and
`--cs-text-danger-on-soft` (#B91C1C, 5.3:1) exists precisely for that pairing — yet
`EnergeticsView.tsx:245` renders the failing pair. Measured: danger pair 3.95:1 (`:245`), warning
tokens **2.86:1** (`:248`), success tokens **3.02:1** (`:251`).

**(c) Units are not theme-independent, and the reference card is not bound to the result.** The
kcal/kJ toggle (`EnergeticsInspector.tsx:296-319`) updates `settings.energyUnit`, which the main
column honours (`EnergeticsView.tsx:230, 236-238, 458, 762`) — but the reference card directly above
it hardcodes `± 1.2 kcal/mol (ProTherm)` (`EnergeticsInspector.tsx:285`) with no unit binding, so
selecting kJ/mol leaves one kcal/mol value on screen. The same card's `298.15 K`, `pH 7.0` and the
uncertainty figure are hardcoded strings (`:277, 281, 285`) presented under a heading that implies
they describe the current run; they are read from no result and carry no provenance link.

---

## 8. Plan

Sequenced so that each phase is independently shippable and verifiable. "Verified" means the stated
check was actually run during this audit; "to verify" means the acceptance test to run after the fix.

### Phase 0 — make the tab tell the truth (P0, no scientific risk)

| # | Change | Files | Acceptance |
|---|---|---|---|
| 0.1 | **Relabel the skip control.** Either wire it to a real abort (cancel in-flight DDMut/DynaMut2 requests and mark them `Skipped` server-side) or rename it to "Hide pending engines" and remove the false "Skipped by User" state and its effect on `pendingTools`. | `EnergeticsView.tsx:122,167,496-503,661-666` | Clicking it never changes the "N-Method" count or the consensus framing. |
| 0.2 | **One formatting function for ΔΔG.** Centralise sign handling + unit conversion + native-convention note; render the same string in the table and the breakdown. | `EnergeticsView.tsx:233-239,463-467,762` | Table and breakdown show the same sign for DynaMut2/DDMut. |
| 0.3 | **Stop asserting an engine is offline when it is not.** Derive statuses per engine; the diagnostics card must name only engines actually in that state. | `EnergeticsInspector.tsx:38,83-93` | With DynaMut2 = done and DDMut = unavailable, only DDMut is named. |
| 0.4 | **Use the real RaSP reason.** Replace the hard-coded "Not in Zenodo DB" with the server's `raspReason`, mapped to the canonical state (§7.3). | `EnergeticsView.tsx:521-527` | Table and inspector agree on why RaSP is absent. |
| 0.5 | **Fix the broken style classes.** Remove `text-slate-450`; replace `rgba(255,255,255,0.05)` and `bg-slate-800/80` with tokens. | `EnergeticsView.tsx:692,759,806` | Gauge and dividers legible in both themes. |
| 0.6 | **Add `@custom-variant dark`** (or replace `dark:` colour pairs with semantic tokens). | `src/index.css`, `EnergeticsInspector.tsx:72,85,98,124,152` | Diagnostics headings readable in app-dark/OS-light and app-light/OS-dark. |
| 0.7 | **Move the verdict inside the scroll region** and align its padding with the table. | `EnergeticsView.tsx:617-776` | Verdict and footnote share the table's 20 px inset. |
| 0.8 | **Stop coercing absent to zero.** Restore `?? null` for `foldxSd`, `vdw`, `electrostatics`, `localSidechainRmsd` and render "± n/a" when unknown. | `EnergeticsView.tsx:277-281,454-461` | A run without an ensemble SD never displays "± 0.00". |
| 0.9 | **Fix the provenance label.** Handle `client-provided` explicitly instead of labelling it "AlphaFold Prediction". | `EnergeticsView.tsx:337-343`, `contracts.ts:74` | A user-supplied PDB is labelled as such. |
| 0.10 | **Stop rendering raw exception text to clinical users.** Map internal errors to plain-language reasons; keep the raw text behind a developer/console disclosure. | `EnergeticsInspector.tsx:70-79,150-158,193,201`, `foldxService.ts:290-292` | No HTTP status text, container path or provider key name is visible in the tab. |
| 0.11 | **Stop caching error text into the clinical narrative.** | `generation.ts:134-140` | A failed narrative is not persisted as a 24 h cached result containing an exception message. |
| 0.12 | **Reuse the shared explanation modal** instead of the clone (this also restores scrolling for long prose and picks up the shared dialog semantics in one change). | `EnergeticsView.tsx:780-868` → `evidence/MetricExplanationModal.tsx` | Long method descriptions scroll; one modal implementation remains. |

### Phase 1 — restore the data layer (P0)

| # | Change | Files | Acceptance |
|---|---|---|---|
| 1.1 | **Rebuild the RaSP index** from the bundled CSV. Verified feasible: the shipped CSV contains 8,770,220 rows / 1,345 proteins and the build script's parser accepts 8,331,709 of them with zero malformed-column rows. Expect an index of ~8.3 M rows (materially larger than today's 3.1 MB — budget the deploy artifact). | `npm run migrate:rasp` → `scripts/build-rasp-sqlite.ts` | `SELECT COUNT(DISTINCT uniprot_id)` = 1,345; PAH `P00439` lookups return values. |
| 1.2 | **Add a completeness invariant** so a partial index can never be used silently: record expected row/protein counts in a metadata table during the build and verify them at load; on mismatch, fall back to the CSV or disable the engine with an explicit reason. | `scripts/build-rasp-sqlite.ts`, `energy-models.ts:51-71,144-188` | A deliberately truncated index is detected and reported, not served. |
| 1.3 | **Make the capability probe report coverage, not file size.** | `server/routes/capabilities.ts:99-110` | Health output distinguishes "index present" from "index complete". |
| 1.4 | **State coverage honestly in the UI and docs.** RaSP is a 1,345-protein resource; say so. | `EnergeticsView.tsx` tooltip, `DEPLOYMENT_OCI.md:215`, `stacking_config.json:18`, `doc/FEATURES.md:71` | No surface claims proteome-wide coverage. |
| 1.5 | **Add an integrity test** for the build (no test currently catches truncation; `energy-models.test.ts` uses a 5-row fixture). | `scripts/__tests__/build-rasp-sqlite.test.ts` | A fixture CSV of N rows yields exactly N index rows and N proteins. |

### Phase 2 — fix the orchestration (P0)

| # | Change | Files | Acceptance |
|---|---|---|---|
| 2.1 | **Re-base the backfill condition.** Do not treat a permanently-unavailable engine as a cache miss: trigger a re-run only on missing `mutantPdb`, missing `foldingEnergetics`, or an explicitly retryable failure — and exclude engines known to be unconfigured. | `workflowOrchestrator.ts:238` | Revisiting a variant with a good cached snapshot issues **zero** FoldX requests. |
| 2.2 | **Make the budgets nest.** Define one source of truth (e.g. `CONFIG.timeouts.foldxStageMs = 300 s`, `foldxTotalMs = 1200 s`) and assert `semaphore + Σ stages + retry ≤ queue cap < client poll ≤ watchdog`. Today the inner worst case (840 s) exceeds every outer budget (300 s), so a *successful* long run is structurally guaranteed to be reported as failed. | `config.ts:32-42`, `foldx/runner.ts:167,327,366,424`, `biophysical-queue.ts:192,256`, `workflowOrchestrator.ts:305`, `foldxService.ts:170` | Unit test asserting the ordering; a 6-minute FoldX run completes instead of being reported as a timeout. |
| 2.3 | **Persist partial results on timeout.** When the watchdog fires, reconcile with the queue job instead of discarding: if the job later completes, publish the result; if it fails, record the *real* error. | `workflowOrchestrator.ts:305-312`, `foldxService.ts:288-298` | A timed-out run that later succeeds updates the tab without a manual retry. |
| 2.4 | **Report the true failure cause.** Distinguish the queue cap from the watchdog and from the poll budget in the message shown to the user. | `biophysical-queue.ts:192`, `workflowOrchestrator.ts:308`, `foldxService.ts:171` | The displayed message names the budget that actually expired. |
| 2.5 | **Either wire or delete the dead 240 s signal** at `generation.ts:343`, and decide explicitly whether a client abort should cancel the server job (today nothing does). | `generation.ts:343`, `biophysical-queue.ts:184`, `server.ts:72-77` | No dead `anySignal`; the cancellation contract is stated and tested. |
| 2.6 | **Fix the client cache write ordering** so failed/preliminary bundles are not retained in memory. | `variantCache.ts:136` vs `:187`, `:85-91` | A `failed` bundle is never returned by `getCachedVariant` — asserted by a test. |
| 2.7 | **Close the null-job-id hole.** Either always mint a client-side pollable job handle, or treat `pending` without a job id as a terminal `unavailable` after a bounded wait. | `generation.ts:610-615`, `useJobPoller.ts:52`, `EnergeticsView.tsx:430-433` | No engine can enter `pending` without a route to a terminal state. |

### Phase 3 — fix the state model (P1)

| # | Change | Files | Acceptance |
|---|---|---|---|
| 3.1 | **Adopt the canonical state taxonomy (§7.3)** with a single mapping table, and make every surface render from it. | `EnergeticsView.tsx`, `EnergeticsInspector.tsx`, `src/types.ts`, `src/services/pipeline/types.ts` | Every label in §7.3 maps to exactly one canonical state; a test asserts the mapping is total. |
| 3.2 | **Guarantee terminal states.** When the parent run ends for any reason, every engine resolves to a terminal state in the same commit; never derive a remote engine's spinner from `isFolding`. | `EnergeticsView.tsx:430-433`, `foldxService.ts:217-226`, `workflowOrchestrator.ts` | Killing the FoldX job leaves no engine in "Running"; asserted by a component test. |
| 3.3 | **Surface "not configured" up front.** Read the capability probe before the run and mark StabilityOracle/ThermoMPNN as *Not installed* with a one-line remedy, instead of "Standby"/warming-up copy. | `EnergeticsInspector.tsx:217,250-262`, `EnergeticsView.tsx:542-569` | With the sidecar down, the tab states "sidecar not running" before any spinner appears. |
| 3.4 | **Keep upstream causes distinct** on the wire (queue-full vs service error vs network) so the client can say "retry later" vs "provider error". | `polling.ts:353-456`, `EnergeticsView.tsx:528-541` | The three causes render as three distinct states. |
| 3.5 | **Stop losing money on a dead engine.** Decide StabilityOracle's fate: either ship the sidecar (and document the `SIDECAR_SECRET` handshake) or remove it from the consensus and the table. | `stabilityoracle.ts`, `stacking_config.json:258`, `doc/DEPLOYMENT_OCI.md` | The engine's weight is only counted when it can actually run. |
| 3.6 | **Give each engine its own timestamp** instead of reusing the bundle-level `cached.timestamp` for staleness. | `workflowOrchestrator.ts:147-152`, `variantCache.ts:133` | A long-dead `pending` is not resurrected by an unrelated landscape/multimer write. |

### Phase 3b — correct the failure semantics (P1)

| # | Change | Files | Acceptance |
|---|---|---|---|
| 3.7 | **Stop fabricating "Upstream Congested".** Map the real cause (submission failure / stale registry / upstream error / network / **local circuit breaker**) and say only what is known. | `EnergeticsView.tsx:528-541`, `dynamut.ts:195-224`, `polling.ts:291-457`, `http-client.ts:64-124` | A breaker-open or a 30 s submission error no longer claims the remote queue is congested. |
| 3.8 | **Re-scope the circuit breaker** (or surface it): it is per-host and shared by DynaMut2 and DDMut, so one tool's failures can present as the other's outage. | `http-client.ts:64-74` | A DDMut-induced open breaker does not mark DynaMut2 unavailable silently. |
| 3.9 | **One enrichment pass.** Enrich the queue result once. | `server.ts:149`, `polling.ts:204,229` | `pendingTools`/`consensusVerdict` are computed from a single `remoteJobs` snapshot. |

### Phase 4 — make the science consistent (P1)

| # | Change | Files | Acceptance |
|---|---|---|---|
| 4.1 | **One consensus implementation.** Either pass `uniprotFeatures`/`residueIndex`/`plddt` to the server call, or drop the server's computation and have the client be the single authority; delete the unused duplicate fields. | `energy-models.ts:535-544`, `EnergeticsView.tsx:317-319` | Server and client verdicts are identical for the same inputs; a test covers both call sites. |
| 4.2 | **Make coverage load-bearing in the verdict** (§7.5): n-of-6 chips, provisional treatment when n ≤ 2, honest interval framing. | `EnergeticsView.tsx:644-724`, `consensus.ts:216-223` | A 1-tool verdict is visually unmistakable from a 6-tool verdict. |
| 4.3 | **Use the tuned thresholds, per engine.** Replace the hard-coded 1.5/0.5/−0.5 badge cut-points with each engine's own cut from `THRESHOLDS` (already imported and unused); scope the "(Speculative)" caveat to the three engines the consensus actually damps. | `EnergeticsView.tsx:14,244-253,468-474`, `constants.ts:86-137`, `consensus.ts:162-170` | A +1.2 RaSP value is classified the same way in the table, the badge and the consensus. |
| 4.4 | **One source of truth for method documentation.** Delete the private `METRIC_EXPLANATIONS` copy and fix the sign conventions in the shared module — including the **inverted RaSP rule**. | `EnergeticsView.tsx:46-119`, `evidence/MetricExplanations.ts:134-160` | Each engine is documented with one sign convention, matching the shipped math. |

### Phase 5 — organize and polish (P2)

| # | Change | Acceptance |
|---|---|---|
| 5.1 | Collapse the five engine listings into one table with expandable rows (§7.1); delete the Calibrated Tool Breakdown, the duplicated telemetry list, the unconditional engine roster in the footnote, and the 4-chip stepper; give the three hidden physics terms (`vdw`, `electrostatics`, `localSidechainRmsd`) a home or drop them. | Six engines appear once, under one name each. |
| 5.2 | Rebuild the main column in the order in §7.2 (verdict → caveat → engines → provenance → collapsed diagnostics → collapsed methodology) and the inspector in the "Inspector target structure" order in the same section. | Verdict is the first thing read; caveats are no longer in the other column. |
| 5.3 | Consolidate to a 3–4 step type scale using `--font-size-cs-micro` / `--font-size-cs-label`; remove the 82 raw palette classes; drop the per-second `aria-live` region; make spacing a scale rather than 21 ad-hoc utilities; use the house `.table-numeric` (tabular figures) for the ΔΔG column. | ≤ 4 font sizes per file; no non-token colour for semantic states; decimals align. |
| 5.4 | Accessibility pass per §7.6 (A1–A17). | Keyboard-only walkthrough of the tab completes without a mouse; axe/pa11y reports no dialog, focus or contrast violations. |
| 5.5 | **Fix the light-mode contrast of the verdict and badges** — the headline verdict is 1.92:1, the three value badges 2.86–3.95:1; use `--cs-text-danger-on-soft` for the danger pairing as `variables.css:101-105` already intends, and give the gauge track a theme-aware colour. | All text ≥ 4.5:1 in both themes. |
| 5.6 | Add the missing tests: no component test exists for `EnergeticsView` or `EnergeticsInspector`, and none for the RaSP build. | Coverage for: label→state mapping, sign formatting, terminal states, index integrity, cache ordering. |
| 5.7 | Truth-up the documentation (`FEATURES.md:71-72`, `DEPLOYMENT_OCI.md:212-215`, `LIMITATIONS.md`, `stacking_config.json:18`) on engine coverage and prerequisites. | Docs match measured behaviour. |

### Suggested order of attack

`0.1 → 0.3 → 2.1 → 1.1 → 2.2 → 2.7 → 3.2 → 4.1 → 0.2 → rest`

Rationale: 0.1/0.3 remove the two false statements on screen immediately; 2.1 stops the
self-inflicted FoldX re-run; 1.1 restores a real engine (the largest single gain in method count);
2.2 removes the timeout that is masking everything else; 2.7 closes the deadlock that freezes the
remaining engines; 3.2 prevents the next freeze; 4.1 makes the number trustworthy; 0.2 removes the
visible contradiction.

### What must not be done

* Do not raise the watchdog as a stand-alone fix — without 2.1, every visit still re-runs FoldX, and
  without 2.2 the stage sum still exceeds any single budget.
* Do not add synthetic fallbacks for StabilityOracle/RaSP — `stabilityoracle.ts:81` and
  `propensities.ts:32` encode a deliberate No-Heuristics Policy; the fix is honest absence, not
  invention.
* Do not "fix" the RaSP index by deleting it — the CSV is present, complete, and rebuildable.
* Do not start the Python sidecar as the fix for "Standby" without also giving the tab a
  not-configured state (3.3); otherwise the same silent `null` will reappear the first time the
  sidecar is down.

---

## 9. Implementation status

The first increment was the **honesty layer** — it changed what the tab *says* before it changed what
the engines *do*. Later phases then touched the engines themselves.

> **Correction (post-change review, §11).** This lead paragraph previously read *"It changes what the
> tab says, not what the engines do … The server-side causes (D-1, D-2, D-3) are untouched."* That
> was **false and stale**, contradicted by this section's own rows: the RaSP index **was** rebuilt
> (D-1), the backfill gate **was** re-based (D-2) and the FoldX budgets **were** re-nested (D-3).
>
> What is still true after the corrections: StabilityOracle remains absent in this environment (no
> sidecar), and **no FoldX run has been observed completing here** — `logs/foldx_cache` is empty, so
> the new budget is permissive rather than proven sufficient. "RaSP is still uncovered" holds only
> for the reference variant: MACO1 (`Q8N5G2`) has no rows in the index, while RaSP as an engine now
> covers 1,345 proteins. §11 also records the defects this section's claims did not survive.

### The canonical contract

New: **`src/shared/engineStatus.ts`** — one pure module that owns

* the six-engine registry (one display name, taxonomy, native sign convention and per-engine
  cut-points each);
* **9 canonical states** replacing the ~40 ad-hoc strings, with a total label/tone map;
* **one** ΔΔG formatter and **one** sign normaliser (positive = destabilizing, always) — **for the
  surfaces that use them. This is a target, not the state:** `src/components/EvidenceDashboardCard.tsx`
  still holds a private formatter that prints `"N/A"` where the canonical one prints `"—"`. Recorded as
  an open item (§11.6 P4), not claimed as done.
* `resolveEngineOutcome` / `buildEngineOutcomes` — the single place pipeline facts become
  user-facing state, shared by both surfaces;
* `summarizeCoverage` / `describeCoverage` — the n-of-6 fact, computed once;
* `describeProvenance` — all four `StructureProvenance.source` values;
* `findLegacyLabels` — the migration scanner the guard test runs.

Both Energetics surfaces now build their rows, badges and verdicts from it. **Not "exclusively"** —
the view still synthesises a few status-adjacent strings of its own ("Low template confidence
(pLDDT …)", "Repair phase failed", "Calculating: …") and the server keeps its own engine counter.
Stated as a target that is a rule to converge on; stated as a fact it was false, and a reviewer
caught it.

### Defects closed

| Defect | What changed | Pinned by |
|---|---|---|
| **D-6** sign contradiction | one formatter; the table and breakdown can no longer disagree | `EnergeticsView` › "never prints one value with two opposite signs" |
| **D-5** "skip" changed the method count | renamed **Hide pending engines**; presentation only, cannot affect coverage | `engineStatus` › "never lets the user's hide choice change the count" |
| **D-8** credibility invisible | engine count in the headline + `describeCoverage` line; a sub-3-engine verdict renders provisional (dashed, warning-toned) | `EnergeticsView` › "states coverage next to the verdict" |
| **D-4** stalled engine shown as running | new `no-result` state; `pending` without an active run no longer reads as progress | `EnergeticsView` › "does not freeze a stalled engine as running" |
| **D-10** false `± 0.00` precision | absence preserved as `null`, never coerced to zero | `EnergeticsView` › "does not claim a spread that was never measured" |
| **D-11** FoldX's cuts applied to all six | each engine classified on its own tuned cut | `EnergeticsView` › "applies each engine's own cut-points" |
| **D-9** RaSP documented with an inverted rule | corrected, and now enforced as an invariant against the registry | guard › "documents %s consistently with its %s convention" |
| **6.7** client-supplied structure called a prediction | `describeProvenance` handles all four sources | `engineStatus` › "does not mislabel a client-supplied structure" |
| **6.12** fabricated "Upstream Congested" | plain-language reasons; a local circuit-breaker or submission error no longer claims remote congestion | `EnergeticsView` › "explains each degraded engine in plain language" |
| **6.14** hidden explanation / dead prop | the consensus block always renders; `foldingError` is finally consumed | `EnergeticsView` › "renders without crashing" |
| **6.11** raw provider errors shown to clinicians | moved behind a "Technical detail" disclosure in the inspector | — (partial: view tooltips still carry them) |
| **7.7** badge/gauge contrast | semantic tokens (`--cs-text-danger-on-soft`, theme-aware gauge); the 1.92:1 `text-emerald-400` verdict is gone | — (partial: raw palette classes reduced, not eliminated) |
| **7.6** accessibility | `role="meter"` + ARIA on the gauge, focus-visible on method buttons, `aria-pressed` on the unit toggle, non-colour status text | — (the modal's dialog semantics remain open) |

Net effect on the two components at the first commit: **−14 lines** (`EnergeticsView` +319/−315,
`EnergeticsInspector` +175/−193) while adding the above. The earlier figure of −33 was wrong.

### Phase 2 — orchestration and state hygiene (landed)

| Item | What changed |
|---|---|
| **2.1 / D-2** | The backfill gate is no longer permanently true. It was `foldingEnergetics.stabilityoracle == null`, which can never be satisfied without the Python sidecar, so **every visit re-ran the full FoldX pipeline** and the watchdog then stamped a fresh failure onto a good cached snapshot. Replaced with three rules: re-run only what a retry can fix; a *structurally* unavailable engine (missing binary, failed repair, absent sidecar, uncovered dataset) is not evidence of an incomplete snapshot; and retries are rate-limited by `BIOPHYSICS_RETRY_COOLDOWN_MS` (15 min), since there is still no negative caching or circuit breaker. |
| **2.2 / D-3** | The FoldX budgets now **nest**. They were all 300 s while the work they supervise can take 840 s, so the outermost timer always fired first and a *successful* run was reported as a timeout — while the server kept computing and wrote a result no client would read. One source of truth in `server/config.ts` (job cap 900 s, reaper lease 960 s, stage budgets), the client budgets in `src/shared/timeouts.ts` — a **queue** budget (1800 s, at least the server's queued lease) and an **execution** budget (1000 s, above the job cap, restarted when the server first reports `running`), plus per-request ceilings on the submit and each poll. There is deliberately **no absolute watchdog**: armed before submission it cannot tell a queued job from a running one, so it *was* the defect rather than the guard. *(An earlier revision of this row listed "watchdog 1020 s"; no such constant exists, and the row contradicted §11.8 in this same document.)* The timeout message is derived from its budget instead of hardcoding "5 minutes". |
| **2.2 guard** | `server/tests/foldx-timeout-budget.test.ts` asserts the ordering and that no numeric stage timeout can reappear next to a `CONFIG` lookup. This is what makes the defect non-recurring: nothing failed when the numbers drifted apart. |
| **2.7 / D-4** | An engine reported `pending` with **no job id** can never resolve — `useJobPoller` needs an id to start, and the SSE channel for these engines is only emitted from that poller's own handler. The end of the FoldX run is the last moment anything could settle it, so `foldxService` now settles exactly those engines — at all three terminal branches **and, since the
second fix round, on every error exit** (the helper had been defined *inside* the `try`, so the `catch`
could not reach it, which is why the exits that actually leave `pending` with a null id never settled
anything) — and deliberately leaves engines **with** an id to their live poller. |
| **5.3 / 3.6** | The `isStale` heuristic is gone. It judged a restored `pending` using `cached.timestamp`, a whole-bundle marker that *any* write refreshes (landscape, pockets, multimer), so the same status could be judged fresh or stale depending on whether something unrelated had touched the bundle. The rule is now evidence-based: a pending engine is recoverable **iff** there is a job id to poll. Found by the Phase 2 guard test itself. |
| **regression** | Fixed a defect introduced by the Phase 1 change: `unavailable` was mapped to "Provider busy" for *every* engine, so ThermoMPNN's missing sidecar told the user to retry a service that will never be there. Absence is now attributed per engine (`upstream` / `coverage` / `install`). |

### Phase 1 — the RaSP data layer (landed)

| Item | What changed |
|---|---|
| **1.1 / D-1** | **The index was rebuilt.** It held 35,000 rows / 6 proteins; it now holds **8,331,709 rows across 1,345 proteins** (725.7 MB, built in 35.6 s). The build output matched an independent census of the CSV exactly (8,331,709 insertable, 438,511 skipped wild-type reference rows, 1,345 proteins), and the acceptance check passes: PAH `P00439 Arg408His` — previously unreachable — now returns 1.7098, while MACO1 (`Q8N5G2`) and BRAF (`P15056`) still correctly report "not covered". |
| **1.2** | The index now carries its own completeness record (`rasp_index_meta`: schema version, rows, proteins, source, build time), and the loader **refuses an index that contradicts it** instead of accepting anything over 1 KB with at least one row. That size-and-nonempty check is what let a 6-protein prefix serve "no precomputed profile" for 1,339 covered proteins in silence. |
| **1.2 guard** | The rule lives in `src/shared/raspIndex.ts` as a pure function, so the loader, the build script and the diagnostics route cannot disagree about what "complete" means. `raspIndex.test.ts` pins every way a plausible-looking-but-wrong index must be rejected. |
| **1.2 safety** | The build **never writes in place**: it stages to `<index>.building`, counts what landed, writes and re-reads the metadata, and only then swaps. A failed or interrupted build leaves the previous index untouched and removes its staging file — the original truncation becomes impossible rather than merely unlikely. `build-rasp-sqlite.test.ts` proves this with a sentinel file. |
| **1.2 self-heal** | Because the loader now *rejects* an unverified index, `initializeRaspDatabase`'s existing "CSV present → rebuild" branch finally becomes reachable, so a truncated or legacy index repairs itself instead of being served forever. |
| **1.3** | `GET /api/v1/capabilities` reports real coverage (`indexedVariants`, `indexedProteins`, `indexBuiltAt`, `indexSchemaVersion`, and an `unavailableReason` when it fails), read from the same contract. It previously declared RaSP "ready" from file size alone — the diagnostics screen was corroborating the very bug it exists to reveal. |
| **1.4** | Coverage claims corrected in `DEPLOYMENT_OCI.md` and `stacking_config.json`: RaSP is a 1,345-protein curated set, not the human proteome. |

### Phase 4 — verdict integrity (partial)

| Item | What changed |
|---|---|
| **new finding** | `SplicingTab` gated its protein-arm evidence on `consensusVerdict === "destabilizing"` — a string `computeCalibratedConsensus` **can never return** (it returns "… Misfolding Risk (…)" or "Insufficient Biophysical Data"). The clause was therefore dead, and because it sat in an OR-chain deciding whether the protein arm carries destabilization evidence, a variant whose only evidence was a strongly destabilizing prediction (DynaMut2/DDMut/RaSP/ThermoMPNN/StabilityOracle — FoldX absent or weak, AlphaMissense and REVEL low) was rendered **"Thermodynamically Tolerated"** and "Basal Conformation": the opposite of its evidence, on a clinical surface, with no test coverage. |
| **fix** | That clause now reads every engine through the canonical contract (`buildEngineOutcomes`) so each is judged on its own calibrated cut-points — consistent with the rest of the app, and with no string involved. |
| **4.3 groundwork** | The verdict is now a **closed set** (`CONSENSUS_VERDICTS`) rather than free text, with `isConsensusVerdictFragment()` for the legitimate `includes("High")`-style inspections. The five assignment sites use the constants. |
| **guard** | `consensusVerdict.guard.test.ts` scans all of `src/` and fails on any comparison of the verdict against a literal that is not a fragment of a real verdict. Negative-controlled: it flags the original lowercase `"destabilizing"` and passes the fix. The subtlety that made the bug invisible is pinned in the test — `"Destabilizing"` (capital) *is* a valid fragment because it appears in the high verdict, and the comparison was case-sensitive. |

**4.1 is now scoped, not done.** The divergence is real and *displayed*: the server computes the
consensus with no residue context (`uniprotFeatures`/`residueIndex` omitted) and a default pLDDT of
100, so structure-dependent engines are never damped; the client recomputes with the real values.
Both are rendered — the client's on the Energetics tab, the server's in the report
(`provenance.ts:99`) and the clinical insights card (`ClinicalInsightsCard.tsx:312`). In
low-pLDDT cases the **report is systematically more confident than the tab**. Making them agree
requires threading `uniprotFeatures`/`residueIndex`/`pLDDT` from the client through the
`/generate-mutant` request, the queue job payload and the worker into `enrichBiophysicalResult` —
five files across a queued-job contract with existing tests, which is why it is a phase of its own
rather than a patch.

### Not done

**Partial-result persistence (2.3)**, client cache ordering (2.6), the state-model phases (3.x), the
single-consensus consolidation (4.1), and the Phase 5 UI/UX reorganization.

**FoldX will now be given long enough to finish, but the environment may still not produce a
value** — `logs/foldx_cache` is empty, so there is no local evidence that this binary completes a
5-run ensemble within the new budget. The difference is that a failure will now be a real failure
rather than a timer firing early.

**RaSP's own coverage is still limited to 1,345 proteins.** Its `clinvar_significance` and
`gnomad_af` columns are also ~99.9 % and ~97 % empty in the source CSV, so the bundled file is a
score-only subset; obtaining a proteome-wide snapshot is a data-sourcing question, not a code one.

### Verification

| Layer | Result |
|---|---|
| `npx tsc --noEmit` | **clean, whole repository (0 errors)** |
| `node scripts/check-boundaries.ts` | 0 violations |
| `npx vitest run` | **120 files passed, 2 skipped; 1221 tests passed, 5 skipped; 0 failures** |
| New tests (Phases 1–4) | `engineStatus` (37), `energeticsLabels.guard` (16), `EnergeticsView` (12), `foldx-timeout-budget` (6), `raspIndex` (6), `build-rasp-sqlite` (6), `consensusVerdict.guard` (6) |
| Sandbox harnesses | `scratch/verify-engine-status.mjs`, `verify-guard.mjs`, `verify-rasp-index.mjs`, `verify-verdict-guard.mjs`, `verify-verdict-negative-control.mjs` |

Two of my own instruments were wrong on the first attempt this session, and both were caught by
running them rather than by reading them: the assertion harness reported a false failure because
`process.exitCode` is `undefined` by default (so `!== 0` held with zero failures), and the verdict
guard's negative control initially omitted the gate that the guard itself applies, which made a
correct fix look like a violation. A guard that cannot fail, or that cries wolf, is worse than none —
so every scanner added here carries a negative control.

`vitest` cannot start under the confined file sandbox (`esbuild` opens a named pipe for its child
process → `spawn EPERM`), so the harnesses above are the subprocess-free equivalent used during
development; the vitest runs were performed with wider permissions.

### Rules for the next agent

1. **Do not add a status string to a component.** Call `buildEngineOutcomes` /
   `resolveEngineOutcome` and render `label` + `reason`. *(Stated absolutely, but shipped code still
   synthesises adjacent strings — "Repair phase failed", "Low template confidence (pLDDT …)",
   "Calculating: …" — so the rule is the target, not yet the state. See §11.)*
2. **Do not format a ΔΔG by hand.** `formatDdg` / `formatDdgPair` / `classifyRawDdg` only. Pass
   `classifyRawDdg` the *raw* provider value; pass `formatDdg` the *canonical* one. *(True for the
   guarded pair; a second formatter survives in `EvidenceDashboardCard.tsx`, which prints `"N/A"`
   where the canonical one prints `"—"` — §11.)*
3. **Do not count engines.** `summarizeCoverage` is the only counter. *(The server still keeps its
   own `pendingTools`/`evidenceComplete` counter, so this is also a target rather than a fact.)*
4. **`src/components/__tests__/energeticsLabels.guard.test.ts`** fails the build if a legacy label
   literal returns or a guarded surface stops importing the canonical module. *(This previously named
   a non-existent `engineStatus.guard.test.ts`, which would have sent the next agent looking for a
   guard that was never written.)* If it fails, migrate the code — do not widen the allow-list.
   `src/shared/__tests__/consensusVerdict.guard.test.ts` is the companion guard for verdict literals.

---

## 10. Remaining work — the road ahead

Written after re-verifying the tree rather than from memory. Where an item is listed as PARTIAL,
the residue is named specifically, because "mostly done" is how a phase silently never finishes.

### 10.1 Correcting the record

| Phase | Status | Residue |
|---|---|---|
| **0** — make the tab tell the truth | **PARTIAL** | 0.1 ✅, 0.2 ✅, 0.3 ✅, 0.4 ✅, 0.8 ✅, 0.9 ✅, **0.6 ✅ (fixed by another contributor in commit `0d03e83`, which added `@custom-variant dark` to `src/index.css:21` with a comment matching this audit's §7.7 analysis)** · **0.5 PARTIAL** (`text-slate-450` still in the modal; 6 raw palette classes remain in `EnergeticsView`) · **0.7 NOT DONE** (verified: the scroll container closes at `EnergeticsView.tsx:586` and the consensus block begins at `:588`, still outside it and still without the container's `px-5`, so the verdict is pinned below the scroll area and misaligned with the table) · **0.10 PARTIAL** (inspector details are behind a disclosure; the view's `title` attributes still carry raw server text) · **0.11, 0.12 NOT DONE** |
| **1** — RaSP data layer | **DONE** | 1.1–1.5 complete, plus an atomic build and a self-healing loader that were not in the original plan |
| **2** — orchestration | **PARTIAL** | 2.1 ✅ (with a cooldown), 2.2 ✅ (with an invariant test), 2.7 ✅ · **2.4 PARTIAL** (messages are derived from their budgets, but the three budgets still surface as two strings) · **2.3, 2.5, 2.6 NOT DONE** |
| **3** — state model | **PARTIAL** | 3.2 ✅, 3.6 ✅ (the job-id rule replaced the bundle-timestamp heuristic), 3.7 ✅ · **3.1 PARTIAL** (the UI taxonomy is canonical, but `src/services/pipeline/types.ts` and `useBiophysicalModeling` still use the old unions) · **3.3, 3.4, 3.5, 3.8, 3.9 NOT DONE** |
| **4** — science | **PARTIAL** | 4.2 ✅, 4.3 ✅, plus two unplanned wins (verdict is now a closed set with a guard; `SplicingTab`'s dead clause fixed) · **4.1 NOT DONE but scoped**, **4.4 NOT DONE** |
| **5** — organize and polish | **NOT STARTED** | 5.5 and 5.6 have partial credit: the verdict and badges are token-based now, and seven test files exist where there were none |

### 10.2 The tracks, in dependency order

**Track A — finish the honesty layer (small, unblocks the UI work)**
| Item | Why it matters | Size/risk |
|---|---|---|
| **0.7** move the verdict inside the scroll region and give it the container's padding | The tab's most important content is outside the region the user scrolls and misaligned with everything above it — verified still true | S / low |
| **0.5 residue** delete `text-slate-450`; convert the last 6 palette classes | `text-slate-450` is not a Tailwind colour, so it silently does nothing | S / low |
| **0.12** use the shared explanation modal | Removes a divergent clone and restores scroll for long prose | S / low |
| **0.10 residue** move the view's raw error text behind the same disclosure the inspector now uses | A clinical reader should not see HTTP text in a tooltip | S / low |
| ~~0.6 `@custom-variant dark`~~ | **DONE** — fixed by another contributor (`0d03e83`); see §10.1 | — |

**Note on concurrent work.** Four commits landed on `main` during the session in which this
document was written (`1579c3c`, `e6925be`, `0d03e83`, `bbcdfed`), authored by another contributor
and touching the header, workspace-search and health-probe surfaces. One of them closed item 0.6
above. None touched the Energetics files, so this document's findings for that tab remain current —
but the plan should be re-checked against `git log` before starting a phase, because the residue
list above can shrink without this document being edited.

**Track B — verdict integrity (the highest remaining correctness value)**
| Item | Why it matters | Size/risk |
|---|---|---|
| **4.1** one consensus computation | The server computes with no residue context and a default pLDDT of 100; the client uses the real values. **Both are displayed**, so in low-pLDDT cases the report is systematically more confident than the tab. Fix = thread `uniprotFeatures`/`residueIndex`/`pLDDT` through the request → queue payload → worker → `enrichBiophysicalResult`, or make exactly one side authoritative | M–L / **medium-high** (queued-job contract, 5 files, existing tests) |
| **4.4** one source for method documentation | Two explanation tables for the same six engines already disagreed once (RaSP's sign was inverted). `MetricExplanations.ts:150` is corrected; the duplication is not removed | S–M / low |

**Track C — complete the state model**
| Item | Why it matters | Size/risk |
|---|---|---|
| **3.4** keep upstream causes distinct on the wire (queue-full vs service error vs network vs local breaker) | All four collapse into `unavailable`, so the UI still cannot say "retry later" vs "provider error" honestly | M / medium |
| **3.3** surface "cannot run here" before the run | The tab currently tells the user ThermoMPNN/StabilityOracle are unavailable only *after* they wait. Needs `capabilities` → component plumbing | M / medium |
| **2.4** distinguish the budget that actually expired | Two of the three FoldX budgets still produce near-identical text | S / low |
| **3.9** one enrichment pass | `pendingTools`/`consensusVerdict` are computed twice from possibly different snapshots | S / medium |
| **3.1 residue** align the service/store unions with the canonical states | The canonical taxonomy is the UI's; the transport types still admit `"error"` in some places and not others | S–M / low |

**Track D — reliability residue**
| Item | Why it matters | Size/risk |
|---|---|---|
| **2.3** persist/reconcile a result that finishes after the watchdog | A run that succeeds late currently produces a value nobody reads | M / medium |
| **2.5** decide the dead 240 s signal: wire it or delete it | Today nothing cancels a server job when the client gives up, and the signal that was meant to is unreferenced | S / low |
| **2.6** decide the client cache-ordering question | Phase 2's cooldown and the new staleness rule removed most of its harm. Remaining effect: a `failed`/`preliminary` bundle stays in memory for 24 h. Dropping it would also discard good artefacts that arrived alongside the failure (e.g. a working DynaMut2 value) — so this is a *decision*, not a fix | S / low, needs a call |
| **3.8** re-scope the shared host circuit breaker | It is per-host and shared by DynaMut2 and DDMut, so one engine's failures can present as the other's outage | S–M / medium |

**Track E — Phase 5: organize and polish (all of it)**
The five-surfaces-to-one-table collapse (5.1), the column/inspector reorder (5.2), the type-scale and
token consolidation (5.3), the accessibility pass A1–A17 (5.4), the light-mode contrast sweep (5.5),
the remaining test gaps including the first `EnergeticsInspector` test (5.6), and the last doc
truth-up for `FEATURES.md`/`LIMITATIONS.md` (5.7). Track E is where the largest *perceived* quality
gain remains, and it is low-risk because it is presentation-only — but it should follow Track A so it
is not reworking the same files twice.

**Track F — blocked or evidence-gated (cannot be closed by code alone)**
- **FoldX ensemble size.** The budgets now allow a run to finish, but `logs/foldx_cache` is empty, so
  there is no local evidence this binary completes a 5-run ensemble in 1020 s. Until one real run is
  observed, "make `--numberOfRuns` size-dependent" is a guess. *Needs: one observed run.*
- **RaSP coverage.** The index is now correct for the bundled data (1,345 proteins). Going
  proteome-wide is data sourcing, not code. *Needs: an answer on whether a larger snapshot exists.*
- **StabilityOracle.** Either ship the Python sidecar (and document the `SIDECAR_SECRET` handshake)
  or remove the engine from the registry. *Needs: a product decision.*
- **0.11 narrative error caching.** `generation.ts` still bakes an exception message into a cached
  24 h clinical narrative. *Independent of Energetics; belongs with the narrative work.*

**Track G — small hygiene found along the way**
- `data/df_rasp_gnomad_clinvar.index.json` is **tracked by git** and is a stale byte-offset sidecar
  listing three proteins, one of which (`P02340`) does not exist in the real CSV. It is misleading
  documentation of how RaSP resolves lookups; delete or regenerate it.
- `stacking_config.json` still carries a weight rationale for an engine that cannot run here (1.8 for
  StabilityOracle). Harmless (a weight only applies when a value exists) but confusing.

### 10.3 Recommended next item

**0.7 + Track A in one pass, then 4.1.**

Rationale: Track A is small, presentation-only, and touches the same two files that Phase 5 will
reorganise — doing it first avoids reworking them twice, and the users of this tab currently scroll
past their own verdict to reach a table of failures. 4.1 is then the last *correctness* item with a
user-visible consequence (two surfaces disagreeing about the same variant), and it is the largest
remaining piece of plumbing, so it deserves a clear run rather than being squeezed between smaller
items.

Order: `0.7 → 0.5 residue → 0.10 residue → 0.12 → 4.4 → 4.1 → 3.4 → 3.3 → Track D → Track E`

### 10.4 Decisions needed from the owner

1. **StabilityOracle** — ship the sidecar or drop the engine? (It cannot run here, which costs a row
   in every table and one of six consensus slots.)
2. **Is a proteome-wide RaSP snapshot available?** If yes, the bundled 1,345-protein subset is
   replaceable; if no, the docs and UI should say "curated set" permanently (they now do).
3. **Should a client abort cancel the server-side job?** Today it cannot, so an abandoned run keeps
   burning CPU and its result is orphaned. The longer watchdog makes the window larger.
4. **`evidenceComplete` as the verdict gate?** The contract already carries it and the cache already
   treats `false` as preliminary. Wiring the verdict to it is a product call: it would suppress
   confident verdicts more often.

### 10.5 What not to do

- Do not raise or lower a timeout without re-running `foldx-timeout-budget.test.ts`; the ordering is
  the fix.
- Do not reintroduce a status string in a component — `energeticsLabels.guard.test.ts` will fail, and
  that is the point.
- Do not compare the consensus verdict to a literal that is not a fragment of a real verdict —
  `consensusVerdict.guard.test.ts` will fail. Prefer the probability against a threshold constant.
- Do not "fix" RaSP by deleting the index: it now verifies itself and repairs from the CSV.
- Do not add a synthetic fallback for an engine that cannot run. The No-Heuristics Policy is
  deliberate; the fix is honest absence.

---

## 11. Post-change review — findings and fix order

### 11.1 The panel

Five independent adversarial reviewers ran read-only against one revision, on non-overlapping
dimensions: **logic/correctness**, **reliability/failure-paths**, **test & guardrail quality**,
**contracts/DX/AX/documentation-truth**, and **UI-UX/accessibility regression** (the last diffed
against `git show HEAD:` to find dropped information). All five hit the same sandbox restriction on
`vitest`, and all five worked around it by executing the real modules under Node's type-stripping
loader instead — so the pure-logic findings are *executed*, and the React-rendering findings are
explicitly labelled static.

A cross-reviewer column appears below because **independent agreement is the strongest evidence
available here**: where two reviewers found the same defect from different angles, it is almost
certainly real. All findings listed as CONFIRMED were additionally re-verified by hand while
merging.

### 11.2 Claims in §9 that did not survive

| Claim | Verdict | Correction |
|---|---|---|
| "It changes what the tab says, not what the engines do"; "D-1, D-2, D-3 are untouched" | **FALSE** | Rebuilt index (D-1), re-based backfill (D-2), re-nested budgets (D-3). Fixed in the §9 lead. |
| "The verdict is now a **closed set** rather than free text" | **FALSE** | The server appends `" (Preliminary - pending: …)"`, and `CalibratedConsensusResult.consensusVerdict` is typed `string`. Closed only for the internal computation, not on the wire. |
| "Negative-controlled: it flags the original lowercase `destabilizing`" | **PARTIAL** | The negative control is unit assertions on the helper; the *scanner* was never run over the original content. Its only anti-vacuity guard is `files.length > 50`. |
| "`build-rasp-sqlite.test.ts` proves this with a sentinel file" | **OVERSTATED** | The sentinel test throws at the missing-CSV precondition, *before* staging is created. A non-atomic build passes all six tests. |
| "the five assignment sites use the constants" | **FALSE** | Seven. |
| 6.14 row pinned by "renders without crashing" | **WRONG PIN** | The claim is true; the cited test asserts only that text is non-empty. |
| Rules 1 and 3 stated absolutely | **TARGET, NOT FACT** | The view still synthesises adjacent strings; the server still keeps its own engine counter. Reworded. |
| Rule 4 names `engineStatus.guard.test.ts` | **FALSE** | No such file. Corrected to `energeticsLabels.guard.test.ts` + `consensusVerdict.guard.test.ts`. |
| `classifyDdg` → `classifyRawDdg` (planned as a rename) | **FALSE PREMISE** | `classifyDdg` never existed at HEAD; `classifyRawDdg` is new. No migration was needed. |
| "RaSP is still uncovered" | **PARTIAL** | True only for the reference variant; the engine now covers 1,345 proteins. |

### 11.3 Defects introduced by this change set

| # | Sev | Location | Defect | Cross-reviewer |
|---|---|---|---|---|
| A1 | **blocker** | `SplicingTab.tsx:98` + `engineStatus.ts:571` | `risk` is computed **regardless of exclusion**, and the panel that suppresses the value (`foldxVal = null` → "FoldX ΔΔG: —") now uses that risk to assert "Structural Destabilization". One panel contradicts itself; the Energetics tab can say "Low Misfolding Risk" in the same run. | R1-F1 |
| A2 | **blocker** | `config.ts:69` vs `timeouts.ts:28` | The nesting invariant omits **queue wait**: poll budget 1000 s < possible 1800 s queue lease. Under concurrency the client abandons jobs the server completes — the exact defect Phase 2 claimed to fix. | R2-F1 |
| A3 | **blocker** | `engineStatus.ts:483-486,692` | Any non-empty `raspReason` → "No precomputed RaSP profile exists for this protein", including *"the index file is not present"*. Presents an operator fault as a dataset property, violating the module's own rule 4. | R1-F6 + R4-F1 |
| A4 | major | `engineStatus.ts:678,685,702` | `runActive = isFolding && noValue(...)` mislabels a **live poller**: `isFolding` clears when the FoldX leg ends while `useJobPoller` runs up to 10 min more, so a congested engine reads "No result — the run ended". | R1-F3 |
| A5 | major | `workflowOrchestrator.ts:287` + `variantCache.ts:195` | The cooldown write is **memory-only** for failed/preliminary bundles (the early return skips sessionStorage) — a reload re-runs the full FoldX job immediately. | R2-F2 + R3-F7 |
| A6 | major | `foldxService.ts:321-328` | `settleUnreachableRemoteEngines` reads a **lagging** server snapshot (the job-data update is fire-and-forget, ~1.5 s behind), so it can mark an engine unavailable while its remote job is genuinely in flight, discarding the result. | R2-F3 |
| A7 | major | `EnergeticsInspector.tsx:83-84` vs `EnergeticsView.tsx:300` | The two surfaces are **not fed the same facts** — `foldingDdG` reaches only the view, so a bundle with `foldingDdG` set and `energetics.foldx` null renders "Computed + value" in the table and "No result" in telemetry. Falsifies the contract's central promise. | R4-F5 (+ R5-F10 on `hidePending`) |
| A8 | major | `energy-models.ts:233,237-241` | The boot rebuild **caches RaSP negatives with no TTL and never clears them**, so after a successful self-heal RaSP stays silently missing for the process lifetime. | R2-F5 |
| A9 | major | `build-rasp-sqlite.ts:240-241` + `energy-models.ts:130` | `rmSync` then `renameSync` opens a window with **no index at all**; a kill inside it, or an ENOENT on reload, latches `raspSqliteChecked` so RaSP stays dead for the process. `db.close()` also exists only on the success path. | R2-F7 + R4-F7 |
| A10 | minor | `EnergeticsView.tsx:604-615` | The provisional treatment has a hole: `includes("High")` is tested **before** `coverage.insufficient`, so a 2-engine High verdict renders solid danger. | R4-F9 |
| A11 | minor | `engineStatus.ts:325` | Comment said "8 canonical states"; there are 9. **Fixed.** | R4-F17 |
| A12 | minor | `capabilities.ts:106` | Reports coverage but **not** through the `RASP_SQLITE_PATH` indirection, so diagnostics and the loader can describe different files; and it re-counts 8.3 M rows per call (**0.42 s** measured, ×3 reviewers, unauthenticated). | R2-F6 + R3-F11 + R4-F6 |

### 11.4 Tests that do not pin what they claim

Original list (the first panel's findings). **Status is tracked below the list — do not read the list
as current.** Several items have since been fixed, and two claims in the list itself turned out to be
wrong.

Tautological or unreachable-assertion: `EnergeticsView.test.tsx` "provisional" (satisfied by the
verdict string itself — deleting `|| coverage.insufficient` passes), "per-engine cut-points"
(satisfied by "…(Destabilizing Consensus)" — blanking the Risk column passes), "ensemble spread"
(asserts a fixture-only shape the server never emits, because `enrichBiophysicalResult` drops
`foldxSd`/`foldxMean`), and "renders without crashing". Unguarded guarantees: the cooldown **write**,
the RaSP **rejection/rebuild** path, the build's **atomicity**, `capabilities`' new fields, and the
entire `EnergeticsInspector` (368 changed lines, no test). Guard holes: the verdict guard's
`line.includes("consensusVerdict")` gate (defeated by a rename, a destructure, `switch/case`, or the
`computeConsensusVerdict` wrapper) and its fragment rule (accepts `=== "High Misfolding Risk"`);
the label guard covers 2 of 4 status surfaces and cannot see JSX text; and none of the five sandbox
harnesses sets a non-zero exit code.

#### 11.4.1 Status — this is the current state, and it is NOT "closed"

Reopened deliberately. An earlier revision of §11.8 implied these were dealt with; the tests reviewer
showed otherwise, and two of the list's own claims were false.

**CLOSED, with mutation checks:**

| Item | Evidence |
|---|---|
| "provisional" assertion | Now asserts `badge.className` contains `border-dashed` — the words were satisfied by the verdict string itself. |
| "per-engine cut-points" | Now scoped with `within(screen.getByRole("row", { name: /RaSP/ }))` — the page-level assertion was satisfied by the verdict text. |
| RaSP rejection/rebuild | Real behavioural tests through the real loader: absent→present and truncated→rebuilt with **no restart or reset**, plus the converse pinning that a genuine coverage miss *is* still cached. |
| The cooldown write | Rewritten to call the **real** reader/writer. The previous version hand-copied the loader's predicate — a reviewer sabotaged `getCachedVariant` to `return null` and all five tests still passed. |
| The build's atomicity | The sentinel test failed at a precondition, so a direct-write build passed it. Now a late failure is forced **at the swap** and the test requires `renameSync` to have been **called**; reinstating the removed `rmSync` makes it fail. |
| The verdict guard's gate | Narrowed to require a comparison operator, after it accused an ordinary object literal. **Still bypassable by a rename or `switch`/`case`** — covered instead by the literal union in `consensus.ts`, which makes an impossible comparison a compile error. |
| The label guard's surfaces | `SplicingTab.tsx` added; both `"N/A"` literals and `"Standby / Unconfigured"` migrated. The scanner is now string-aware (it was blind to a label sharing a line with a URL). |

**STILL OPEN:**

| Item | Why it matters |
|---|---|
| "ensemble spread" | Still asserts a shape the server cannot produce: `enrichBiophysicalResult` computes `foldxSd` and omits it from the returned `energetics`, so the ± branch of `formatDdgPair` is production-dead. The test grants confidence in a feature that never renders. |
| `capabilities`' new fields | Still no test fails without the fix. |
| `EnergeticsInspector` | Still has **no test file at all**. |
| Label guard: JSX text, single quotes, backticks | Only double-quoted literals are flagged; JSX text nodes are invisible. |
| Harness exit codes | All five `scratch/verify-*.mjs` still exit 0 regardless of the assertions inside them. |
| Two vacuous assertions in `engineStatus.test.ts` | One compares `formatDdg` with itself; the "labels are disjoint" check can never match, because the scanner requires quoted text and `join("\n")` produces none. |
| The fragment rule | `isConsensusVerdictFragment` still accepts a full verdict and any substring, so the guard cannot catch its own motivating bug. |

*(The two false claims in the original list: the assertions it said were satisfied by the verdict text
**had** been fixed at `8d61ef8`, and the `EnergeticsInspector` line count was for a different diff.)*

### 11.5 Pre-existing defects the review surfaced

The verdict is computed **twice from different engine sets** — the poller routes recompute from five
engines (no ThermoMPNN, no `foldxBinaryMissing`) and overwrite the stored value: screen
"Elevated…(Single-Tool)", export "Insufficient Biophysical Data" (R1-F8 — sharper than §6.2, which
blamed only pLDDT/context). `foldxSd`/`foldxMean` are dropped by `enrichBiophysicalResult`, making
the spread feature production-dead (R1-F9). `isFolding` can stick `true` after an abort plus a cached
search, pinning every engine at "running" and suppressing the FoldX diagnosis (R1-F4). The prewarm
FoldX job is invisible to `activeFoldxJobs`, so one variant can run **two** concurrent FoldX jobs,
and its 240 s abort makes prewarming useless for slow structures (R2-F4). `unavailable` is one
literal for four causes, so "never submitted" reads as "provider did not answer in time", and
`upstream-error` is unreachable for DynaMut2/DDMut (R1-F5 + R4-F8). StabilityOracle has no cause
channel, so `not-installed` and `failed` are unreachable and its dedicated reason is dead code
(R1-F7). A **second ΔΔG formatter** survives in `EvidenceDashboardCard.tsx` (prints `"N/A"` where the
canonical one prints `"—"`), so the module's "THE formatter" claim is untrue repo-wide (R4-F11). The
boundary checker **does not scan `scripts/`**, and `energy-models.ts:235` already imports from it —
a live violation reported clean (R4-Q4). §7.5's recommendation to unify the two coverage counters was
**dropped from the plan**; it is restored inline here as an open item (R4-F22): have
`computeCalibratedConsensus` return the engine count it actually averaged, so the headline count and
the average cannot diverge as engines are added. **Status: open.**

### 11.6 Fix order

Every P0 item must land with a test that **fails first** on the current code.

| # | Item | Why first |
|---|---|---|
| **P0-1** | Queue-wait budget (A2) — make the client budget cover queue + execution, or restart it when the job reports `running`; derive the leases from `foldxSec` | This is a false headline claim, not just a bug: a queued run is still mis-reported as a timeout |
| **P0-2** | Exclusion vs risk (A1) — decide the semantics, then make `risk` respect `contributesToConsensus` (or stop suppressing the value) and add a `SplicingTab` test | A clinical surface contradicts itself in one panel |
| **P0-3** | `raspReason` classification (A3) — distinguish "index unavailable" from "no profile for this protein" | Presents an operator fault as biology; the exact class this work exists to remove |
| **P0-4** | `runActive` for remote engines (A4) — a `pending` status is only reachable when a route to a result exists | A live engine reads as finished for ten minutes |
| **P0-5** | One verdict, one call site (11.5) — stop the poller routes recomputing from five engines; type the verdict as a union and carry the suffix explicitly | The screen and the exported report can disagree |
| **P1-1** | RaSP durability (A8, A9): drop the `rmSync` for atomic replace, close before swapping, do not latch on ENOENT, clear the negative cache after a rebuild, close on failure paths | The self-heal can leave RaSP silently dead for the process |
| **P1-2** | `/capabilities` (A12): read `RASP_SQLITE_PATH`, use the cached handle, memoise the verdict | 0.42 s of event-loop block per unauthenticated request |
| **P1-3** | Prewarm dedupe + its budget; backfill-dispatch watchdog and `.catch` | Duplicate jobs; an unbounded spinner |
| **P1-4** | `isFolding` reset on abort / cache-hit paths | A stuck flag poisons every later run in the session |
| **P1-5** | Cross-surface facts (A7): pass `foldingDdG` **and** `hidePending` to both builders | The contract's promise is only as good as its inputs |
| **P2** | Test hardening: A1/A2-style row-scoped and style-based assertions; the verdict union type; extend the label guard to `SplicingTab` + JSX text + single quotes; scan `server/` too; non-zero exit codes on the harnesses; end-to-end RaSP rejection and atomicity tests | Otherwise the P0/P1 fixes are unguarded |
| **P3** | R5's information-loss regressions (pLDDT card suppressed when all engines computed; FoldX binary/repair notices dropped) and the measured contrast failures (warn 2.86:1, gauge trough 1.05:1 light, muted dot 1.24:1, 9px dark text 3.97:1) | Real regressions against HEAD, presentation-only |
| **P4** | §8/§10 residue, the restored coverage-counter unification, dead exports (`getRiskBand`, `RISK_BAND_IDS`, `KJ_PER_KCAL`, `formatSignedDdg`, `convertEnergy`), the second formatter, the `scripts/` boundary gap, and the stale untracked `*EnergeticsView.md` agent docs | Hygiene; keeps the contract honest |

### 11.7 What the reviews could not settle

Whether `isFolding` is set by any path outside those traced; how often the remote engines outlive the
FoldX leg (the severity of A4); whether `energetics.foldxMean` is ever populated by a second
producer; the cold-cache cost of `/capabilities`; Windows `MoveFileEx` behaviour while SQLite holds
the target open (A9); production `BIOPHYSICAL_CONCURRENCY`, which sets A2's trigger threshold;
whether any deployment runs `migrate:rasp` against a live server; and — unchanged from §9 —
**whether this FoldX binary completes a 5-run ensemble at all**, since `logs/foldx_cache` is still
empty.

### 11.8 Fix-pass status

**Fixed and verified** (each with a test that fails without the fix):

| Item | Fix | Test |
|---|---|---|
| **A2** queue-wait hole | The client now budgets the two phases of a job separately: `CLIENT_FOLDX_QUEUE_BUDGET_MS` (≥ the server's queued lease) while queued, and `CLIENT_FOLDX_POLL_BUDGET_MS` (> the job cap) once the server reports `running`, with the clock restarting at that point. The absolute watchdog is **gone** — armed before submission it cannot tell the phases apart, so it *was* the defect. Submit and per-poll requests also gained ceilings they never had. | `foldx-timeout-budget.test.ts` — queue budget vs queued lease, execution budget vs job cap, no exported watchdog constant, and a behavioural guard that `foldxService` consults the queue budget and restarts on `running`. |
| **A1** exclusion vs risk | `resolveEngineOutcome` now derives the exclusion itself (from `excludeFromConsensus` **or** a repair-failed / missing-binary problem) and returns `risk: null` for an excluded value, so the resolver and the builder agree and no surface can derive a risk band from a value the app has discarded. The view renders the exclusion as `Not counted` with its reason instead of leaving it invisible. | `engineStatus.test.ts` (excluded value ⇒ no band, no credit) + `EnergeticsView.test.tsx` ("says why a value is shown but not counted"). |
| **A3** RaSP reason masking | The server's reasons are *classified*: the one coverage sentence (`Residue position is not present…`) is coverage; every store fault (unavailable, missing, unreadable, truncated, mismatch, query error) is a deployment problem. The coverage copy no longer asserts a fact about the protein. | `engineStatus.test.ts` — all six real reasons, plus the trap that broke the first attempt (`/not present/` matches the coverage sentence). |
| **A4** live poller read as finished | Activity for the three remote engines is derived from a surviving `pending` (which by the settle rule implies a live poller) rather than from `isFolding`, which clears when the *FoldX* leg ends. | `engineStatus.test.ts` + `EnergeticsView.test.tsx` (live pending ⇒ Running; done-with-no-value ⇒ still No result). |
| **A12 / P1-2** `/capabilities` | The route resolves the index through `RASP_SQLITE_PATH` (it previously joined `process.cwd()` itself, so it described a different file than the loader — the developer's real index under test) and no longer re-counts 8.3 M rows per call: the **loader** verifies once, expensively, and the route reports the index's own record plus an `indexCountsVerified` flag so a recorded figure is never presented as a checked one. | Caught by an existing test: the count took **> 5 s** cold and timed out `public-endpoints.test.ts`. |
| **R3 F1/F2** tautological tests | The provisional claim is now asserted on the badge's `border-dashed` class (the words were satisfied by the verdict string itself), and the per-engine cut-point claim is scoped to RaSP's own row via `within(getByRole("row"))`. | both fail if the styling or the Risk column is removed. |
| **P0-5** two verdicts | The two remote-engine poll routes no longer compute or return a consensus. They recomputed it from a **five-engine subset** (no ThermoMPNN, no `foldxBinaryMissing`) and returned it over the enriched payload, which the client merged into its cache — so the exported verdict could disagree with the one on screen. The single computation is `enrichBiophysicalResult`, where all six engines are visible; the three dead imports that suggested otherwise are gone. Provisionality moved out of the verdict string into the `evidenceComplete`/`pendingTools` fields it already had, so the wire value is a closed-set verdict rather than free text. | New `server/tests/consensus-single-source.test.ts` pins one computation site, requires all six engines plus both FoldX flags there, and forbids the free-text suffix. |

The verdict is also now a **literal union type** (`ConsensusVerdict`), so an impossible comparison is a
TypeScript error rather than something a regex must catch — proven by a `@ts-expect-error` probe that
fails if the union ever widens back to `string`.

| **A8** RaSP stays silent after repair | A lookup that missed because the **store** was unusable was memoised in an LRU with no TTL, so a run that happened while the index was missing or mid-rebuild kept returning that miss for the life of the process — RaSP (a weight-1.5 engine) silently absent from those variants, with no log line, even after a correct index was in place. A store failure is a fact about the *deployment*, not the variant, so it is no longer cached; the cache is also cleared when a rebuild succeeds, and a genuine coverage miss is still cached (pinned, so the fix cannot be "solved" by disabling the cache). | `energy-models.test.ts` — "does not memoise a store-unavailable miss" plus its converse. |
| **A9** index can vanish, or stay dead | Three separate ways RaSP could be lost for the life of a process: (a) the swap did `rmSync(target)` **then** `renameSync`, so a kill or a failed rename inside that window left **no index at all** — worse than the truncated index this work set out to fix; (b) the loader latched a one-shot `checked` boolean, conflating "this file is bad" with "there is no usable file", so a rejected index stayed rejected even after a correct one appeared; (c) `db.close()` existed only on the build's success path, leaking a handle and — on Windows, where an open SQLite file commonly refuses deletion — blocking the staging cleanup. Fixed by renaming straight over the target (atomic on POSIX, `MoveFileExW(REPLACE_EXISTING)` on Windows), caching the verdict against the file's **identity** (`ino:size:mtimeMs`, so a replacement is always re-verified and a stale descriptor is never served), and closing in a `finally`. | `energy-models.test.ts` — absent→present and truncated→rebuilt with **no restart or reset**; `build-rasp-sqlite.test.ts` — a failure *after every row is written* leaves the target byte-identical, rebuilding over an existing index really replaces it, and the handle is released on the failure path. |

**Still open from the review** — see §11.9.

### 11.9 Second fix pass

| Item | Fix | Test |
|---|---|---|
| **A10** provisional hole | The badge tested `includes("High")` **before** `coverage.insufficient`, so a two-engine "High Misfolding Risk (Destabilizing Consensus)" — reachable, since only a single engine is remapped to the `*Single` verdicts — rendered as solid danger. Provisional now wins over the verdict text. | `EnergeticsView.test.tsx` asserts the dashed style. |
| **A5** cooldown lost on reload | The retry cooldown was written through `setCachedVariant`, whose persistence filter refuses failed/preliminary bundles — exactly the state that triggers a retry — so it reached memory only and pressing F5 re-dispatched the whole run. A `persistAttemptTimestamp` option writes **only** the cooldown metadata (plus the `timestamp` the loader requires, without which the record is discarded on read). | New `src/services/pipeline/__tests__/variantCache.test.ts` — the guarantee R3 found unasserted. |
| **A7** surfaces fed different facts | `EnergeticsInspector` never received `foldingDdG`, so on a bundle where it is set but `energetics.foldx` is absent, the table showed a value and telemetry showed "No result" for one run. It now takes the same fallback. | **no test** — see §11.4.1 |
| **R5 F3** pLDDT card suppressed | The low-confidence card sat **inside** `diagnostics.length > 0`, so on a run where every engine returned a value — the good case — a low-pLDDT template produced an empty array and the warning vanished. The more complete the run, the less the panel said about its reliability. It is now outside that gate. | **no test** — see §11.4.1 |
| **R5 F4/F5** FoldX notices | The generic state reasons said nothing actionable for a missing binary, and the repair-failed caveat was unreachable whenever a value existed (the value took the `computed` branch, whose reason is empty). Both now have their own copy. | `engineStatus.test.ts` |
| **P1-3** backfill rejection | The background dispatch was a floating promise with no watchdog and no `.catch`, so a rejection left the spinner up with no deadline and no message. | **no test** — see §11.4.1 |
| **P2** guard coverage | `SplicingTab.tsx` was added to `GUARDED_SURFACES` — which immediately surfaced **two more** `"N/A"` literals it had been hiding, now `"—"`. The guard also strips comments before scanning, after it flagged its own documentation for the fourth time. | `energeticsLabels.guard.test.ts` |

**Still open, and why** — none of these are silent data loss; each is either cosmetic, needs a shared
file another contributor is editing, or is a genuine refactor:

* **A6** (`settleUnreachableRemoteEngines` reads a ~1.5 s stale snapshot and can mark an engine
  `unavailable` while its remote job is in flight). The correct fix is a *submission-settled* marker
  flowing from `generation.ts` through the poll response, so the client can distinguish "never
  attempted" from "id not yet known". That is a wire change and was not worth half-doing.
* **hidePending** (A7's other half): `hidePendingEngines` is view-local `useState`, so sharing it with
  the inspector means lifting it to a store or context. Cosmetic divergence ("Running" vs "Skipped by
  User"), presentation-only by construction.
* **P1-3** prewarm dedupe (two concurrent FoldX jobs for one variant) and **P1-4** (`isFolding` stuck
  after an abort, because `abortAllPendingRequests` bumps the request id so the run's `finally` treats
  itself as superseded). Both need plumbing through hook interfaces.
* **R5 F7/F8/F9** contrast (warning badge 2.86:1, gauge trough 1.05:1 light, muted dot 1.24:1, band
  1.51:1, 9px dark text 3.97:1). These are token values in `src/styles/variables.css`, which another
  contributor has uncommitted changes in — editing it would sweep their work into my commit. Deferred
  deliberately rather than risk that.
* **§4.1** server/client verdict *context* divergence (no residue features server-side; pLDDT
  defaulted to 100). Same class as P0-5, smaller blast radius.

---

## Appendix A — Evidence log (read-only)

```
# RaSP: shipped index vs. its own source data
node scratch/probe-rasp-gap.mjs
  CSV distinct proteins: 1345        CSV total rows: 8770220
  SQLite distinct proteins: 6        SQLite total rows: 35000
  proteins in CSV but MISSING from SQLite index: 1339 of 1345
  P00439: csv=8460 sqlite=0   <-- data present but unreachable
  P01112: csv=3420 sqlite=0   <-- data present but unreachable
  Q8N5G2 (this variant's protein): csv=0 sqlite=0

# RaSP: is the parser at fault, or was the build interrupted?
node scratch/validate-rasp-parse.mjs
  rows_insertable=8331709   skip_too_few_columns=0   skip_unparseable_variant=438511
  null_or_nan_score=0       would_be_batches_of_5000=1666
  (438,511 skipped rows are `S41=`-style wild-type reference rows)

# Environment: no local ML sidecar, no Tamarind key
GET http://127.0.0.1:8000/health -> connection refused
.env: GEMINI_API_KEY, OCR_API_KEY, APP_API_TOKEN, APP_SESSION_SECRET,
      GENOS_EMAIL, GENOS_ACCESS_KEY   (no TAMARIND_API_KEY, no SIDECAR_SECRET)

# Consensus arithmetic check for the observed DynaMut2 = -0.09
stacking_config.json dynamut2 bins: raw -0.5 -> p 0.25 ; raw 0.0 -> p 0.05
  interpolate at -0.09 -> p 0.086, lower 0.035, upper 0.167
  => 9% [4%-17%]  ==  the value rendered on screen

# FoldX has never completed successfully in this workspace
logs/foldx_cache -> 0 files

# The 240 s route abort is dead code (corrects an earlier reading of the timeout budget)
grep combinedSignal server/routes/biophysics/generation.ts
  L121, L132  -> the Gemini handler's own signal (used)
  L343        -> declared for /generate-mutant and never referenced again

# The poller refuses to run without a job id (the ThermoMPNN deadlock)
useJobPoller.ts:52  if (status !== "pending" || !jobId) return;
useJobPoller.ts:63  new EventSource(`/api/v1/jobs/events?jobs=${jobId}`)

# Client cache writes before its own guard (failed bundles retained in memory)
variantCache.ts:136 memoryVariantCache.set(key, updated);
variantCache.ts:187 if (updated.foldingStatus === "failed" || ... ) { return; }

# Overridden / undefined CSS
typography-tables.css  .table-header-row th { font-size: ... !important; color: ... !important }
                       .table-container-card  { border-radius: var(--cs-radius-lg) !important }  # never defined
variables.css:41-44    --cs-radius-card/input/badge/pill  (no --cs-radius-lg)

# Measured light-mode contrast (two entries recomputed independently and matched)
text-emerald-400 on #FFFFFF -> 1.92:1
text-amber-400   on #FFFFFF -> 1.67:1
```

* `scratch/probe-stability-data.mjs`, `probe-rasp-coverage.mjs`, `probe-rasp-gap.mjs`,
  `validate-rasp-parse.mjs` — diagnostic probes; none touch application files or the real index.
* `scratch/rebuild-rasp-test.ts` — an attempt to rebuild the index into a scratch path. It could not
  run: `tsx` spawns `esbuild` over piped stdio, which the file sandbox denies with `spawn EPERM`.
  This is a sandbox boundary, **not** an application defect. Rebuild feasibility was instead
  established by replaying the build script's parsing logic in plain Node (above). **The rebuild
  itself remains unverified end-to-end** — treat 1.1 as "verified feasible, not yet verified
  complete", and expect a materially larger deploy artifact than today's 3.1 MB.
* Not modified: no source, config, or data file was changed. `data/df_rasp_gnomad_clinvar.sqlite`
  is untouched.
* Related stale artifact: `data/df_rasp_gnomad_clinvar.index.json` (36 bytes) lists three proteins
  (`P00439`, `P01112`, `P02340`) from the old byte-offset sidecar — and `P02340` does not exist in
  the real CSV. It is the same class of artifact as the truncated SQLite.

### Provenance of this audit

Two independent deep-dives were run against the same workspace and merged here, with every
load-bearing claim re-checked by direct inspection before inclusion:

* **Server/pipeline RCA** — engine serving paths, timeout layers, status propagation, caching, and
  environment forensics. Its findings established the ThermoMPNN null-job-id deadlock, the sidecar
  503→`pending` mislabelling, the client cache write-ordering bug, and the dead 240 s signal; the
  last of these **corrected** an earlier draft claim of this document (the route abort was listed as
  an active budget; it is not).
* **UI/UX audit** — information architecture, state vocabulary, typography, consistency, theming
  and accessibility. Its contrast figures were spot-checked by independent computation of the WCAG
  contrast ratio for `text-emerald-400` (1.92:1) and `text-amber-400` (1.67:1) on white; both
  matched. Its other quantitative claims (`.table-header-row` `!important`, undefined
  `--cs-radius-lg`, the `foldxSd ?? 0` coercion, the `foldingError` dead prop, the inverted RaSP
  sign in `MetricExplanations.ts`) were each re-verified against the source during merge.
* Direct inspection during this session confirmed: the RaSP 6-of-1,345-protein gap, the CSV's
  8,770,220 rows / 8,331,709 insertable rows, the empty `logs/foldx_cache`, the absent sidecar on
  port 8000, the missing `TAMARIND_API_KEY`, and the 9 % [4 %–17 %] consensus arithmetic.

## Appendix B — Open questions for the owner

1. **Is StabilityOracle intended to ship?** If yes, the sidecar must be provisioned and
   `SIDECAR_SECRET` shared; if no, its 1.8 consensus weight should not be in the stacking config.
2. **Is RaSP meant to be a 1,345-protein resource?** The filename and empty ClinVar/gnomAD columns
   suggest a subset; if a proteome-wide snapshot was intended, the bundled CSV is the wrong file.
3. **Should the Energetics tab surface a verdict at all when n = 1?** The current behaviour (green
   "Low Misfolding Risk") is the strongest candidate for a deliberate product decision rather than a
   bug fix.
4. **Can the FoldX budget be met on this hardware?** If 5-run BuildModel on a ~430-residue protein
   cannot finish in a reasonable window on Windows, the ensemble size (currently
   `--numberOfRuns=5`, `foldx/runner.ts:363`) may need to be configurable by protein size. This is
   the one question that determines whether the fix is "raise the budget" or "shrink the work" —
   and `logs/foldx_cache` being empty means there is no local evidence either way yet.
5. **Should a client abort cancel the server job?** Today nothing does (`generation.ts:343` is dead
   code), so a "cancelled" run keeps burning CPU and can write a result nobody reads. Cancelling
   frees capacity; not cancelling preserves a result that a later revisit could collect. The current
   behaviour is accidental rather than chosen.
6. **Is `evidenceComplete` the right gate for the verdict?** The contract already carries it
   (`contracts.ts:109`), and the cache already treats `false` as "preliminary". Wiring the tab's
   verdict to it (rather than re-deriving a count from raw values) would make the UI and the
   persistence layer agree on one definition of "complete" — but it also means a single missing
   engine permanently suppresses a confident verdict, so this is a product decision, not a fix.
7. **Should the diagnostics surface expose engine coverage?** `capabilities.ts` already probes every
   engine; if it reported completeness (not just file presence) the Energetics tab could mark RaSP
   and StabilityOracle as unavailable *before* a run rather than after five minutes of failure.
