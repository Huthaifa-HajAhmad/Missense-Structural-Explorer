# Energetics release report

Date 2026-11-19. Code: branch `fix/energetics-live-findings` (PR #260) at 7583a718; live tests on candidate image
`cand-df6994952474` (df699495; the two later commits change only documents and on-screen note text, covered by
unit tests). Production before this release: `59c3c1e4` (PRs #258, #259). Benchmark: branch `bench/energetics`
at a1064ed7, rules fixed in advance in `BENCHMARK_PROTOCOL.md` (cf907db9). Criteria: `RELEASE_CRITERIA.md`.
Working record and every finding: `STATUS.md`. Text users see for each limitation: `KNOWN_LIMITATIONS.md`.

Verdicts: **pass**, **fail**, **unverified** (not enough evidence either way). DynaMut2 and DDMut were benchmarked
on the protocol's fixed random sample (seed 42: 150 S669 variants, 100 Ssym pairs), because the public academic
server cannot take the full sets; their verdicts hold for that sample.

## A. Each engine

| # | Verdict | Evidence |
| --- | --- | --- |
| A1 | FoldX, RaSP, ThermoMPNN **pass**; StabilityOracle **pass on the final rule, small sample** | Original live series (31 requests, before the structure fix): FoldX, RaSP, ThermoMPNN 31/31; StabilityOracle 27/31 (87%), all 4 misses one structure (9R2Q chain K) that the new rule no longer chooses. With the final rule (selection runs 3 and 4, cache-hit reruns): StabilityOracle 15/15, FoldX, RaSP, ThermoMPNN 15/15. 15/15 cannot prove ≥ 95% (95% lower bound ≈ 78%); confirm on production counts after the release. |
| A2 | **pass** | No failure caused by our side. Provider misses: ProtVar 2/31 (no precomputed score for that residue). DynaMut2 and DDMut 6/6 on the cache-hit reruns; outcomes counted from the audit log (RUNBOOK.md). |
| A3 | **pass** | 49 live runs, every engine final. Longest: FoldX 770 s including queue wait under 5-account load (limit 30 min + 1,000 s); DynaMut2 219 s, DDMut 235 s (limit 5 min, amended by the user). |
| A4 | **pass** | Every reason in `engineStatus.ts`, `generation.ts`, `jobsCopy.ts`, `foldxService.ts` scanned: no provider infrastructure names or file paths. The check found internal names in two engine notes ("sidecar raw isStabilizing", "−pred/2"): fixed (7583a718), with a test. |
| A5 | **pass** for FoldX, ThermoMPNN, StabilityOracle, DynaMut2, DDMut; RaSP **unverified** | Ssym direct correlation positive for every engine; the five large-to-small buried examples have the right sign (StabilityOracle 4/5 on S669, 5/5 on Ssym). RaSP's installed table covers 2 of 342 Ssym variants. |
| A6 | FoldX, ThermoMPNN **pass**; StabilityOracle **fail, accepted as a known limitation**; DynaMut2, DDMut, RaSP **no comparator / unverified** | Pearson r, our 95% interval vs the paper: FoldX S669 [0.20, 0.47] vs 0.22, Ssym direct [0.51, 0.71] vs 0.63; ThermoMPNN S669 [0.27, 0.58] vs 0.43, Ssym direct [0.53, 0.80] vs 0.72; StabilityOracle Ssym direct [0.49, 0.69] below 0.72 (independent evaluation of the released model 0.65; user decision: limitation, stated on screen). DynaMut2 publishes only combined Ssym; DDMut publishes S1304, not direct-only S669 (removed as a comparator in a1064ed7). |
| A7 | FoldX, ThermoMPNN, StabilityOracle **pass**; DynaMut2, DDMut **pass on the sample**; RaSP **unverified** | Held-out S669 ROC AUC lower bound above 0.5 for each; DynaMut2 [0.59, 0.77], DDMut [0.58, 0.78] on the sample. RaSP: 4 held-out variants. |

Two DDMut observations (no comparator, so not verdicts): Ssym direct r 0.83 is far above every other engine and
is probably helped by training overlap (no sampled Ssym pair is held out); its reverse-mutation r is 0.08, the
same weakness as DynaMut2 (0.05; its paper reports this too), while FoldX, ThermoMPNN and StabilityOracle reach
0.38 to 0.60 on the same inputs, so the inputs are not the cause.

## B. The whole panel

| # | Verdict | Evidence |
| --- | --- | --- |
| B1 | **pass** | Same 49 runs as A3; the panel shows the engines that have finished while others run (unit test "a run that is still collecting engines is shown as a snapshot"); in the BioSig outage the other engines finished at their normal times. |
| B2 | **pass** | Labels follow the engine bands, neighbouring-band splits read "Split: moderate to high" / "Split: none to moderate", count of engines shown (#258, unit-tested); FHIT V95A panel matched the server record in the browser, before and after reload. |
| B3 | **pass** | 5 distinct variants on 5 accounts: all computed, each result for its own request, FoldX places 0 to 4 shown, none failed for waiting. Identical variant on 5 accounts: one job, FoldX ran once. |
| B4 | **pass** | Health p95 4 ms, max 183 ms; memory peak 2.27 GB of 5 GB; no restart, no out-of-memory. |
| B5 | **pass, with one gap** | BioSig blocked at submit, BioSig cut while polling, EBI blocked, model server paused 3 min: only the affected engines showed provider errors or "busy", the rest finished, the consensus used them. Gap: StabilityOracle after a model-server pause shows a timeout, retried by rerunning the analysis after 15 min (no button; KNOWN_LIMITATIONS 15). |
| B6 | **pass, with the same gap** | Retry DynaMut2 and Retry ThermoMPNN recovered without a server restart; BioSig values arrived after the cut ended; StabilityOracle rerun gave a value in 2 s. |
| B7 | **pass** | Selenomethionine (FHIT, MSE read as MET), protein–DNA (TP53 on 1TSR, DNA removed), over 1,500 residues (SCN1A, 2,009-residue model, 750 s), several chains (HBB chain B), AlphaFold only (CNNM2), no structure (RYR1, honest 422), protein-only input (no invented build). |

## C. Operations

| # | Verdict | Evidence |
| --- | --- | --- |
| C1 | **pass when PR #260's CI is green** | `tsc` clean; 4,329 front-end tests pass locally; server and e2e suites on PR CI; code map current (lint); `doc/STATE_MACHINES.md` updated with the queue slot, hold and lost-contact changes. Flaky tests not caused by this work are listed in STATUS.md finding 10. |
| C2 | **pass** | `RUNBOOK.md`: health checks, each outside service down, model-server restart, rollback, test container. |
| C3 | **pass** | `KNOWN_LIMITATIONS.md`: 16 limitations, each with the exact on-screen text and its source. FoldX's one-chain limit is now said on screen. |

## Still to do after merge

1. Production check: served revision and rollout journal; open a TP53 variant viewed before, compare 3D view,
   Sources and FoldX before and after reload; stop if an old score appears beside a newly chosen model.
2. After a week of normal use, count StabilityOracle and BioSig outcomes in production (RUNBOOK.md) to settle A1
   for StabilityOracle at a useful sample size.
