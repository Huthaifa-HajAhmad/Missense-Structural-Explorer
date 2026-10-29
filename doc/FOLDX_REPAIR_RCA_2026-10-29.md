# FoldX repair RCA and review remediation - 29 October 2026

## Production evidence and root cause

OCI image de06fc966df686d7a9f57e758dec423250d880fa stored GATA4 Ser159Cys with mean 0.5761 kcal/mol, SD 0.0014, chain A residue 159. Repair was skipped for `alphafold-plddt`, not failed. The deliberate AlphaFold bypass, foreground size guard, background exclusions and 24-hour caches explained recurrence. Experimental-template detection fixes did not remove the bypass.

## Preparation policy and evidence limits

The owner requested remediation of the recurrent repair issue and all confirmed review findings. Predicted and experimental templates now follow the same preparation/resource policy, consistent with the FoldX authors' recommendation to repair before modelling: https://foldxsuite.crg.es/command/RepairPDB and https://foldxsuite.crg.eu/documentation. This replaces the previous repository requirement to retain the AlphaFold bypass until an accuracy benchmark. It is an explicitly documented preparation-policy decision, not a claim that repair improves prediction accuracy. Such a claim still requires a multi-protein experimental delta-delta-G benchmark. No benchmark or owner statement is fabricated.

Functional proof from the earlier implementation: native Windows FoldX repaired AlphaFold SOD1 (154 residues) in 105.1 s, then BuildModel x5 completed in 2.9 s with paired WT and mutant outputs (mean 2.1198 kcal/mol). The full suite ran concurrently, so these timings are not OCI performance measurements or prediction-accuracy validation.

## Confirmed review findings and resolutions

1. Background admission was host-blind. It now uses the existing measured native repair curve on native hosts and the measured Box64 envelope on emulated hosts. Missing-residue cost on native hosts retains the conservative Box64 allowance. The running repair's join estimate uses the same host basis. The foreground 400-residue guard and all time caps remain.
2. The shared browser reader discarded every skipped-repair snapshot, affecting unrelated consumers and causing repeated full analyses. It now preserves the whole snapshot, including disclosed provisional results. Only the existing solver retry policy considers a server-issued repair-refresh window, behind the existing attempt cooldown. Disabled/ineligible/abandoned work has no window. No whole-analysis invalidation is driven by the skip flag.
3. A cached repair rejected by BuildModel could wedge a variant for 30 days. Non-abort failures now evict that repair. Ordinary execution/missing-output failures retry once on the cleaned original input within the remaining job budget, with partial output files removed because FoldX appends energy records. Successful fallback says `cached-repair-rejected` and remains cacheable. Timeouts/crashes are not blindly retried; user cancellation does not invalidate a template. Fallback results do not reschedule the rejected repair.
4. The scheduler/repair writer/mutant runner seam now has an integration regression with nondefault pH, temperature, ionic strength and seed. It schedules the real repair function through the scheduler and checks the exact key reused by the mutant runner.
5. The old scientific gate and stale origin-based claims are corrected. `alphafold-plddt` remains readable only as a legacy reason; removing it would break historical payloads. Routing no longer computes or consumes model origin for repair eligibility.
6. The workspace contains unrelated work. A FoldX-only patch is produced against HEAD, excluding PP2/hotspot/expression/interface changes; it is checked against a temporary Git index without staging or committing the shared workspace. The isolated source snapshot passes its own tests and lint. Cache version changes select new namespaces rather than perform an irreversible data migration; the browser purge does deliberately discard old snapshots once. Rollback and cold-cache recomputation still need operational consideration. This artifact is not a claim of an OCI deployment.
7. Repair identity and bounded refresh metadata are declared in the payload schema and survive enrichment. The identity is a cache key, not a credential or caller-controlled resource path.
8. This note is UTF-8 and states the actual coverage and refresh limits below.
9. The estimate test no longer encodes the retired AlphaFold exception, cache-version comments distinguish the changes, cache tests clean up mutant state even on assertion failure, and a bounded 30-second negative repair lookup cache avoids disk I/O on every provisional cache hit. Writes invalidate negative entries immediately.

## Coverage and refresh limits

With default budgets and complete side chains, the Box64 background envelope admits up to 555 residues (556 is ineligible). The native curve admits up to 647 residues. Incomplete residues lower both limits. These are configurable admission estimates, not biological eligibility boundaries or guarantees that FoldX succeeds. A 1,000-residue template is outside the default background cap on either host; it remains disclosed and cached rather than triggering an endless client rerun.

Only scheduled/running/waiting or already repaired background work arms solver refresh: after one minute, within a finite six-hour queue window plus the background execution cap, and no faster than the existing attempt cooldown. A first large-template result can still be unrepaired. A subsequent eligible request rebuilds it once repaired coordinates exist. An already displayed result is not automatically replaced. Disabled work, exhausted windows, genuine errors or a too-large estimate may leave the warning indefinitely; they do not invalidate the entire variant bundle.

## ProtVar verification

Both workstation and OCI returned HTTP 404 for https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/P43694/159. "Not covered" is correct for GATA4 Ser159Cys. Missing remains null, never zero; ProtVar does not add a second FoldX vote. The screenshot's selected ProtVar inspector describes that absent reference, while the warning describes the separate local run. The exact 404 is pinned in a regression test.

## Validation

Earlier implementation: 5,913 tests passed, lint/TypeScript and production build passed; real-binary functional proof above. The review-remediation validation is recorded after its checks finish. OCI has not been changed.

Review recheck: OCI again returned HTTP 404 for P43694/159. A workstation recheck failed TLS certificate verification (self-signed certificate); verification was not bypassed. The earlier workstation 404 is historical evidence, while the repeat OCI 404 is current.

Review-remediation checks so far: 299 focused tests passed in both the shared workspace and the isolated patch snapshot; lint/TypeScript passed in both; the isolated production build passed. A concurrent full run reported 5,927 passing, 7 failing and 5 skipped tests. One FoldX join regression used a wall-clock publication timer and was made deterministic by publishing on the actual repairing phase; its isolated 11-test suite passes. The complete suite is being rerun with four workers and no simultaneous build. Other first-run failures were in biophysics route dispatch, gate-safety, structural prediction and UI coverage tests; they were not silently dismissed or changed.

ProtVar positive control: OCI returned HTTP 200 for BRAF P15056/600 while GATA4 P43694/159 remained 404, supporting variant coverage absence rather than a blanket endpoint outage.

Deployment isolation: the independent patch uses browser namespace `v4.6-foldx-repair-v1`, distinct from the shared branch's combined PP2/FoldX namespace `v4.8`. This prevents different interpretation rules from sharing the same serialized-cache identity when the later combined release ships. Server FoldX cache v4 is the same in both, because its scientific calculation is independent of PP2.

Final shared-workspace full-suite rerun (`vitest run --maxWorkers=4`, no simultaneous build): 5934 passed, 0 failed, 5 skipped. None of the six out-of-scope failures from the overloaded run reproduced. The deterministic FoldX phase test passed. The isolated cache namespace's 17 cache/retry tests also passed.

Final isolated release checks: client rebuild passed with the dedicated `v4.6-foldx-repair-v1` namespace. The server/worker/tool build had already passed with the same production source. The FoldX-only release is retained as a separate local commit on `fix/foldx-repair-review-20261029`; the shared branch and its index are not switched or staged, and nothing is pushed or deployed.
