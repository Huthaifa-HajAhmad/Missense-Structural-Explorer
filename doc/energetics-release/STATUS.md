# Energetics release: status and evidence (working record)

Updated 2026-11-18. Branch `fix/energetics-live-findings` (PR not yet opened). Production runs `59c3c1e4`
(PRs #258 and #259). Every result below is from the test container `energetics-test` on the VM (same
image family as production, AUTH_MODE=accounts, fresh data, 5 test accounts, 5 GB memory limit; prod: 10 GB),
unless it says production.

## Evidence locations

| What | Where |
| --- | --- |
| Production record pulls (jobs, telemetry, audit) | session scratchpad `vm/` (not kept); summary in the release report |
| Live harness, load, outage, retry scripts | `scripts/energetics_live/` (run.mjs, health.mjs, load.sh, outage.sh, retry.mjs, setup-users.mjs) |
| Live raw results | VM `/home/ubuntu/energetics-test/run/*.jsonl`, `*-health.json`, `*-stats.txt` |
| Benchmark rules fixed before results | `doc/energetics-release/BENCHMARK_PROTOCOL.md` (commit cf907db9) |
| Benchmark scripts and results | branch `bench/energetics`, worktree `C:\Users\HSA19\.t3\worktrees\Missense-Structural-Explorer\t3-33d0bea1-ce4bdf017d5a8d6f` (uncommitted; runs in progress) |

## Fixed on this branch (tested)

| Commit | Fix | Live check |
| --- | --- | --- |
| 2bb705c2 | Queue starts FoldX only when a FoldX slot is free; slot frees at FoldX end, not after companions; FoldX queue position counts FoldX work only. 422 NO_STRUCTURE with a careful message. | 3/5 FoldX failures before; 0 failures in 5-account load (positions 0-4 shown, last result 770 s) |
| 27deacd6 | StabilityOracle "rejected this query" reads as "cannot score this structure; retrying will not change that". | Seen in the browser on TP53 R175H (9R2Q:K) |
| a6d4ca7e | A StabilityOracle timeout allows the 15-min re-run; a rejection does not. | Server rerun gave SO 0.12 in 2 s |
| 76aabe94 | Queue memory check reads kernel *available* memory (not free incl. file cache). | Stall ("117 MB free", 3.4 GB reclaimable) ended on swap; 0 stalls since |

## Verified behaviour (test container)

- Hard cases: SeMet (MSE kept as MET with SD; FHIT V95A all 7 engines), protein–DNA (TP53 R273H on 1TSR; FoldX on 585 protein residues, DNA removed), >1,500 residues (SCN1A R1648H on the 2,009-residue AlphaFold model, FoldX +4.24, 750 s), multi-chain (HBB E7V, chain B only), AlphaFold-only (CNNM2 E357Q), no structure (RYR1 R614C, 422 honest message), protein-only input (no invented build).
- Load: 5 distinct variants / 5 accounts: all computed; health p95 4 ms, max 183 ms, 0 failures; memory peak 2.27 GB; no restarts. Identical variant / 5 accounts: one job, FoldX ran once, all accounts read it.
- Outages: BioSig blocked at submit (other engines fine; panel retry recovered DynaMut2); BioSig cut while polling 150 s (listening, values arrived after restore); EBI blocked (ProtVar error only); model server paused 3 min (ThermoMPNN busy, SO timeout; ThermoMPNN retry recovered; supervisor 2/3 strikes, no restart).
- Browser: FHIT V95A panel = record, identical after reload.

| (next) | Energetics sidebar status no longer reads "Unavailable · Query failed" when only the core evidence query failed but engines answered. | Seen live after the 82 s outage (panel 5 of 6, sidebar "Unavailable"); unit-tested |

## Decisions by the user (2026-11-18)

- Structure choice: rank chains that cover the variant by local quality (resolution, complete side chains near the variant), deterministic tie-break.
- Queue hold: the panel says the queue is held and why, instead of promising a start time.
- Gene label: show UniProt's primary gene name (TP53, not P53), in this release.
- DynaMut2/DDMut outcomes: the audit log is the record (STATE_MACHINES 6c); the runbook gives the counting query.

## Open findings (each must end fixed, decided, or as a known limitation)

1. **Client FoldX poller ended a run after 3 network errors (~15 s).** Panel showed "Failed / Failed to fetch" while the server completed FoldX (+15.4); a reload inside the 15-min pause then showed all engines "ended without returning a value" (no server call). Fixed (e74461c0) and verified live: the test container was restarted for 82 s while the browser polled CNNM2 E357A; the panel showed FoldX +0.40, equal to the server record (0.3992).
2. **Structure choice ranks coverage first.** TP53 R175H got 8UTS:K, later 9R2Q:K (3.2 Å cryo-EM, 165 of 200 residues missing side chains, repair skipped) → FoldX +15.6 / +15.4. Needs the user's decision.
3. **"Next in line · starts in under a minute" shown while the queue was stalled.** Root cause fixed (item 76aabe94); wording during a genuine stall still promises a start. Decide: expose the stall, or known limitation.
4. **Gene shown as "P53" for TP53** (UniProt entry name, not the gene symbol). Outside Energetics.
5. **StabilityOracle +1 kcal/mol mark vs compressed values** (benchmark: mean +0.5 where lab mean +2.0). Pending decision with final benchmark.
6. **StabilityOracle A6 on Ssym**: 0.64 vs published 0.72; independent reproduction of the released model gives 0.65. Decide: known limitation text.
7. **DynaMut2/DDMut outcomes not kept in the job row** (audit log only, documented in STATE_MACHINES 6c). Decide whether that is enough.
8. **One FoldX failure in production telemetry** (601 s, `result:failed`, row purged): not reproduced; known limitation unless it recurs.
9. **Flaky tests** (not caused by this work, all pass alone): e2e Services badge timing; under full-suite load coordinate-resolver "misses its window", code-map, dbnsfp_local, analysis-db worker pool, ContextualCoverage render; admission peak-memory on Windows.
