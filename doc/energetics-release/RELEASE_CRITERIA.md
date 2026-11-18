# Energetics release criteria

Approved by the user on 2026-11-18, before any release evidence was gathered. A6 was amended the same
day (also approved): the comparator is the statistic the paper published, on the same subset. Each
criterion ends as pass, fail, or unverified, with its evidence, in the release report.

Terms: a run is **eligible** when the input is inside what the engine says it covers (RaSP: proteins in
its table). A run is **honest** when it ends in one of the 11 states in `src/shared/engineStatus.ts` with a
reason specific to that run, and the server record, the screen and `doc/STATE_MACHINES.md` agree.
Success is counted as a finite value per eligible request, per engine (not as a completed queue row).

## A. Each engine

| # | Criterion | Pass if |
| --- | --- | --- |
| A1 | Success rate, own engines (FoldX, RaSP, ThermoMPNN, StabilityOracle) | ≥ 95% of eligible runs computed; RaSP 100% (table lookup). |
| A2 | Success rate, outside services (DynaMut2, DDMut, ProtVar) | No failures caused by our side; provider failures are counted and reported but do not fail the release. |
| A3 | Every run reaches a final state | No run stays running past its limit: FoldX 30 min queue + 1,000 s run; StabilityOracle 180 s; ThermoMPNN 150 s; BioSig and ProtVar 180 s. |
| A4 | Honest failure messages | 100% of runs without a value are honest; no internal names (BioSig, Zenodo, file paths) in messages. |
| A5 | Sign and units | On Ssym, positive always means destabilizing in kcal/mol; a negative direct-mutation correlation for any engine blocks the release. |
| A6 | Accuracy matches the paper | Our statistic, of the type the paper published and on the same subset, has a 95% bootstrap interval containing the published figure or lying above it. Clearly lower is treated as an integration bug and blocks the release. No published figure: "no comparator". |
| A7 | Signal on held-out proteins | Lower bound of the 95% interval of ROC AUC (measured ≥ 1.0 kcal/mol) above 0.5. Failing engines get a warning on the panel or leave the consensus (user decides). Too few variants: unverified. |

## B. The whole panel

| # | Criterion | Pass if |
| --- | --- | --- |
| B1 | Panel finishes | Every engine reaches a final state within the longest single limit; one slow engine never holds back the consensus. |
| B2 | Consensus is honest | The label matches the engine bands it uses; the panel shows how many engines counted; even neighbouring-band splits use "Split: moderate to high" / "Split: none to moderate". |
| B3 | Several users at once | 5 different variants started together all finish and each result belongs to the right request; FoldX jobs waiting show their place in line and none fails for waiting; identical variants share one FoldX run. |
| B4 | Server stays responsive | During B3 the health check answers within 1 s for 95% of requests; no out-of-memory, no restart. |
| B5 | Outside service down | With BioSig, ProtVar or the model server cut off, affected engines show "Provider error" or "Provider busy" within their limit, other engines are unaffected, and the consensus uses the engines that finished. |
| B6 | Recovery | Once the service is back, retrying a single engine works without restarting the server. |
| B7 | Hard cases | Selenomethionine structure, protein–DNA complex, structure over 1,500 residues, several chains, AlphaFold-only protein and protein-only input each end with a value or an honest limitation. |

## C. Operations

| # | Criterion | Pass if |
| --- | --- | --- |
| C1 | Docs and tests | `tsc` clean, all tests pass with skips explained, `doc/STATE_MACHINES.md` and the code map current. |
| C2 | Runbook | One page: how to see engine health, what to do when each outside service is down, how to restart the model server, how to roll back a deploy. |
| C3 | Known limitations | Every remaining limitation has the exact text users see. |

Outage and load tests run in a separate test container on the VM, not in production (user decision).
