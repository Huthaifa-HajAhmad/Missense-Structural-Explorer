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

- StabilityOracle mark: one +0.2 kcal/mol destabilising mark (chosen on S669, checked on Ssym direct: sensitivity 0.57, specificity 0.88, accuracy 0.74 vs 0.60 at +1.0); no moderate band.
- StabilityOracle A6 (Ssym direct r 0.64, CI 0.49-0.69, below the paper's 0.72; independent reproduction 0.65): known limitation, stated in the method note.

## Structure selection validation (rule in STRUCTURE_SELECTION_RULE.md)

Empty caches, candidates bf48966d and 88a7b30b. Pass conditions fixed in advance; FoldX values are not one.

| Variant | Chosen template | Notes |
| --- | --- | --- |
| FHIT V95A | 1FIT A (1.85 Å, target and neighbourhood complete) | 4 engineered chains refused |
| HBB E7V | 1IRD B (1.25 Å, complete) | whole chain repaired |
| CNNM2 E357Q | AlphaFold v6 | no experimental chain |
| SCN1A R1648H | 7DTD A (3.3 Å, complete) | the only covering chain, now checked |
| TP53 R175H, R273H | AlphaFold v6 | none of the 12 examined chains is a wild-type, usable chain (the 30 best-resolved are engineered); before: 9R2Q K, 165/200 residues incomplete, repair skipped |

Replayed after the review corrections (candidate df699495, memo key `select-v4`, fresh container): all six
cases chose the same template as above and every engine request returned 200 with a FoldX value.

Cold structure choice adds 2 to 4 s to submission. Order invariance is unit-tested (best-chain.test.ts).

## Findings and how each ended

1. **FoldX poller gave up after ~15 s of network trouble** (false "Failed", empty panel after reload). Fixed (e74461c0, 29d91e73); verified live with an 82 s restart (panel FoldX +0.40 = server 0.3992).
2. **Structure choice ranked coverage first** (TP53 9R2Q:K, repair skipped, FoldX +15). Decided (local-quality rule) and fixed (1132d7fe, f88caa24, 88a7b30b, and the batch, duplicate and incomplete-check fixes after review 3); validated above.
3. **Start time promised while the queue was stalled.** Decided (say the queue is held) and fixed (8d8b7fc2, 29d91e73); unit-tested; the hold message itself was not reproduced live (the memory fix 76aabe94 removed the stall).
4. **Gene shown as "P53"** (UniProt entry name). Decided and fixed (89eac3f5).
5. **StabilityOracle +1.0 mark flagged 10% of destabilizing variants.** Decided: +0.2 (bf48966d).
6. **StabilityOracle A6 on Ssym** (0.64 vs 0.72). Decided: known limitation, stated in the method note without a causal claim.
7. **DynaMut2/DDMut outcomes not in the job row.** Decided: the audit log is the record; counting command in RUNBOOK.md.
8. **One production FoldX failure** (601 s, `result:failed`, row purged): not reproduced in any live run; known limitation.
9. **Criterion A3 for BioSig.** Decided (2026-11-19): 5 minutes, the server's polling window; a 200 s DDMut answer was observed.
10. **Flaky tests** (not caused by this work, all pass alone): coordinate-resolver "misses its window", code-map, dbnsfp_local, analysis-db worker pool and ContextualCoverage under full-suite load; admission peak-memory on Windows. The e2e Services-badge test was fixed (39a23fd0): it now waits for the first reading.
