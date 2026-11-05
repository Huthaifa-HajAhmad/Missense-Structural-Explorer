# FoldX local-shell repair: measured against full repair — and a review of the remediation plan

**Date:** 2026-11-02
**Related:** [`doc/ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/ENERGETICS_REPRODUCIBILITY_AND_FOLDX_REPAIR_PLAN.md), [`doc/FOLDX_REPAIR_RCA_2026-10-29.md`](file:///C:/Users/HSA19/antigravity/Missense-Structural-Explorer/doc/FOLDX_REPAIR_RCA_2026-10-29.md)

The plan's Part B rests on one claim: a mutation-centred `RepairPDB` restricted with
`--mutate-residues-file` reproduces full-chain `RepairPDB`'s ΔΔG "in a fraction of the time".
Its only evidence was **timing** (one 5-residue shell, 1.38 s). No ΔΔG was ever compared.
This document measures it, on the two proteins that matter — the 875-residue diagnostic template
and the GATA4 case that produced the three conflicting screenshots.

---

## 1. Setup

| Item | Value |
| :--- | :--- |
| Binary | `tools/foldx/foldx_1_20270131.exe` (FoldX 5.1), native Windows x64 — no Box64 |
| Templates | CNNM2 AlphaFold 875 aa (chain A, 0 incomplete) · GATA4 AlphaFold 442 aa (chain A, AF-P43694-F1 v6) |
| Substitutions | `SA489C` (matches the production cache for the 875 template) · `SA159C` (GATA4 p.Ser159Cys) |
| Commands | `RepairPDB [--mutate-residues-file=shell.txt]` → `BuildModel --numberOfRuns=5` |
| Flags | `--timeSeedRotabase=false` (exactly as `runner.ts` invokes it); GATA4 also at the shipped `pH 7.4 / 298.15 K / 0.15 M` |
| Shell definition | every residue with a heavy atom within *r* Å of any target heavy atom, plus ±1 sequence neighbour |
| Driver | `logs/foldx_bench/{bench.py,gata4_run.py,gata4_sweep.py}`; raw JSON alongside |

---

## 2. Results

### 2.1 CNNM2 875 aa, p.Ser489Cys

| Template state | Shell residues | `RepairPDB` | Residues moved >0.05 Å | ΔΔG (5 runs) | SD | FoldX band |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| No repair | — | — | — | **+1.061** | 0.003 | moderate |
| Local shell 8 Å | 20 | 6.5 s | 24 | +0.393 | 0.000 | neutral |
| Local shell 12 Å | 42 | 9.5 s | 41 | +0.420 | 0.010 | neutral |
| Local shell 15 Å | 62 | 11.1 s | 58 | +0.441 | 0.019 | neutral |
| Local shell 15 Å, shipped pH/T/ion | 62 | 16.6 s | — | +0.423 | 0.018 | neutral |
| Local shell 20 Å | 99 | 54.4 s | 100 | +0.433 | 0.018 | neutral |
| **Full-chain `RepairPDB`** | 875 | **284.1 s** | **589** (mean 0.35 Å; Cα RMSD 0.000) | **+1.175** | 0.023 | moderate |

Production cross-check: the cache entry for this exact template/variant (`logs/foldx_cache/8f2ae45c…`,
unrepaired) holds `+1.0596` with raw runs `[1.06034, 1.05935, 1.05904, 1.05948]`; this workstation
produced `[1.0603, 1.0594, 1.0590, 1.0595, 1.0669]` — identical to 1e-4.

**Local shell is 0.73 kcal/mol away from full repair, in the opposite direction, and it crosses the
0.5 kcal/mol band on its own.** Raising the radius does not converge to the full value.

### 2.2 GATA4 442 aa, p.Ser159Cys — the case that produced the screenshots

| Template state | Shell residues | `RepairPDB` | ΔΔG (5 runs) | SD | FoldX band |
| :--- | ---: | ---: | ---: | ---: | :--- |
| No repair | — | — | **+0.5761** | 0.0014 | moderate |
| Local shell 10 Å | 7 | 0.9 s | +0.6263 | 0.0014 | moderate |
| Local shell 15 Å | 11 | 0.9 s | +0.6023 | 0.0013 | moderate |
| Local shell 20 Å | 13 | 1.0 s | +0.6023 | 0.0013 | moderate |
| Local shell 25 Å | 18 | 1.5 s | +0.6023 | 0.0013 | moderate |
| Local shell 30 Å | 23 | 1.6 s | +0.6013 | 0.0013 | moderate |
| **Full-chain `RepairPDB`** | 442 | **89.0 s** | **+0.1276** | 0.0045 | neutral |

Cross-checks against production, to four decimals:

* unrepaired `+0.5761` = the plan's Screen 1 (`+0.58`);
* full repair `+0.1276`, runs `[0.1199, 0.1283, 0.1319, 0.1293, 0.1289]` = the cache entry
  `1e56c2f3…` (`0.1276 ± 0.0045`) and the plan's Screen 2 (`+0.13`).

**The proposed fix fails on the very variant it was designed for.** A 15 Å shell holds only
**11 residues** here, because Ser159 sits in a low-confidence disordered segment (pLDDT 43.3;
mean 44.8 over the shell), where FoldX's own neighbours within 15 Å are few. Repacking that shell
moves the tail but leaves ΔΔG at **+0.60** — statistically the unrepaired answer — while full
repair reaches **+0.13**. The shell path therefore reports "moderately destabilizing" where truth is
"no destabilization": the exact band flip P0-1 claims to eliminate.

### 2.3 Determinism of the engine

Same repaired template (CNNM2 15 Å shell), three consecutive independent `BuildModel` runs:
`0.4406 ± 0.0187` every time, with identical constituent run energies. A fourth earlier run gave the
same. **FoldX is reproducible to all four reported decimals; the inputs are not.**

### 2.4 Parameters

Shipped pH / temperature / ionic strength vs FoldX defaults moved CNNM2 by **0.017 kcal/mol**
(0.441 → 0.423): real, but an order of magnitude below the template-state effect (0.65–0.73).
These conditions appear in the cache key but **not in the stored payload**.

---

## 3. What this establishes

1. **The three screenshots are fully explained by template state.** `+0.58` is the unrepaired
   GATA4 structure, `+0.13` is the fully repaired one. Nothing is stochastic.
2. **The plan's central claim is false as stated.** Local-shell repair is not a cheaper full repair;
   it is a *different estimator*. Its offset is 0.73 kcal/mol on CNNM2 (opposite sign to full repair)
   and 0.47 kcal/mol on GATA4 — above the 0.5 mark that separates "neutral" from "moderately
   destabilizing", so it changes verdicts.
3. **Increasing the shell radius does not help.** CNNM2: 0.393 → 0.433 across 8→20 Å.
   GATA4: 0.626 → 0.601 across 10→30 Å. Both are stable, precise, and biased.
4. **The shell collapses where it is most needed.** The plan assumes a 15 Å shell contains 25–65
   residues; in a disordered segment it contains 7–11, and the method then silently reproduces the
   unrepaired value while wearing a "repaired" label.
5. **`--mutate-residues-file` bounds optimisation, not relaxation.** Residues outside the listed set
   still moved, up to 5.7 Å (3D neighbours of the shell on CNNM2). The flag is a cost control.
6. **Shell cost is superlinear.** CNNM2: 15 Å/62 res = 11.1 s; 20 Å/99 res = 54.4 s. The plan's
   "~25–65 residues ⇒ 3–8 s" is optimistic at the top of the range.
7. **The cost model is badly miscalibrated at both ends.** `nativeFoldxRepairPriorMs`
   (49 s @154 aa, exponent 2.1) predicts 449 s at GATA4's 442 aa; measured 89 s. It predicts 852 s
   at 600 aa, where the plan asserts "~150 s". The plan's Tier 3 numbers cannot be reconciled with
   either the model or the hardware.
8. **Template extent moves ΔΔG more than repair does.** The cache holds CNNM2 p.Ser489Cys twice:
   +1.0596 on the 875-residue chain and +0.0323 on a 431–823 construct (`76a6585b`) — a >1 kcal/mol
   spread from structure choice alone. No part of the plan addresses this.

---

## 4. Review of the plan

### 4.1 Holds up

| Claim | Status |
| :--- | :--- |
| Two-phase repair makes Run 1 (unrepaired) and Run 2 (repaired) different answers | **Confirmed and quantified** — `runner.ts` L537/L575–592, `cache.ts` L56–61; 0.45 kcal/mol on GATA4 (measured both ends). |
| `buildEnergeticsEvidence` has no running-engine gate | **Confirmed** — `energeticsEvidence.ts` L583–601 counts only present readings. |
| `StabilityOracle` becomes `No result` on FoldX cache hits | **Symptom confirmed** — companions write only to the job record (`foldx-queue-job.ts` L50–193); only ThermoMPNN has a cache backfill. |
| Duplicated status prefix / `.;` join | **Confirmed** — `EnergeticsComparison.tsx` L82, `EnergeticsInspector.tsx` L277. |
| StabilityOracle SASA is a heuristic proxy | **Confirmed** — `stabilityoracle.py` L201–215. |

### 4.2 Does not hold up

| Claim | Problem |
| :--- | :--- |
| "Local-shell repair matches full-template `RepairPDB`" | Refuted by measurement: 0.73 (CNNM2) and 0.47 (GATA4) kcal/mol apart, both band-relevant. |
| `raceTimeout(stabilityoracleTask, 2000)`; `stabilityoracleTask` attached on cache hits | **These symbols do not exist anywhere in the repository**, and the cache-hit branch (`generation.ts` L473 → L528) returns the stored payload without touching companions. P0-2 as written cannot be implemented. |
| Line references (§2, §3) | Most point at unrelated code — e.g. `generation.ts#L318-L355` is structure resolution. The plan was written against an older tree. |
| Cache: `getLocalRepairCacheKey(wtHash, chain, pos)` + "upgrade only if \|ΔΔG_full − ΔΔG_local\| > 0.10" | **Self-defeating.** Answers become cache-warmth dependent again; 0.10 is far below both the 0.47/0.73 offsets and GATA4's 0.45 repair step; a background worker cannot evaluate a per-variant difference. |
| Tier 3 host-aware thresholds (233 Box64 / 600 native) | Same variant, different template, different ΔΔG depending on which machine served it — the opposite of reproducibility. The 600 aa/150 s figure contradicts the repo's own cost model (852 s). |
| ±0.15 kcal/mol straddle guard | Smaller than FoldX's accuracy (RMSE about 2 on S669, section 9.3) and than the 0.45 repair step. It would almost never fire where it matters. |
| P1-1 "feed true Å² SASA" | The value is a per-atom channel written to `pp_tensor[0, i, 1]` and capped at 30 (`stabilityoracle.py` L228). Unnormalised Shrake–Rupley Å² changes the input distribution of a fixed checkpoint — a new model-input drift, the same class of defect being fixed. |
| Tier 2 "strip + splice back" | Untested complexity, aimed at templates that (GATA4: 442 aa) do not need it, layered on a repair path already shown not to be equivalent. |

---

## 5. Reproducibility verdict for the pipeline as designed

**Not reproducible today — and FoldX is not the reason.** The same variant can be served from
(a) unrepaired vs repaired template, (b) different structure extent (1 kcal/mol), (c) a partial
engine panel, (d) missing companions after a cache hit, and (e) three caches with different TTLs and
namespaces. The plan closes (c) and (d) and part of (e); with Tier 1 it makes (a) converge only by
substituting a third, differently-biased template — and only on hosts where the shell path is chosen.

---

## 6. What would actually make it reproducible

1. **Put template state in the identity of the result.** Add `repairMode`
   (`none` / `full` / `shell:<r>:<version>`) to the mutant cache key and bump
   `FOLDX_CACHE_VERSION`; a background repair then writes under a *different* key instead of
   superseding a served answer.
2. **Persist companions atomically with the FoldX block** (`stabilityoracle`, `rasp`, `protvar`,
   `thermompnn`, statuses, `complete` flag) under a new payload schema version, and serve that block
   on cache hits.
3. **One repair policy per deployment.** Either always full repair (queue and block, or an explicit
   "repair pending" state the verdict does not consume), or always the shell variant — the same one
   at every size — with its offset characterised on ≥10 variants before it feeds a verdict.
   Never mix, never let host class decide.
4. **No headline over a partial panel.** Compute the consensus only from a snapshot marked complete.
5. **Record conditions and provenance with the value** (pH, temperature, ionic strength, repair mode,
   binary version, template source and extent) — today only the cache key carries them.
6. **Express cut-points as intervals** (per-run SD and ≥0.5 kcal/mol accuracy), not a ±0.15 guard.

## 7. What to keep from Part B

> **Superseded in part by §9.** The flag to keep is the *complement* form,
> `--fix-residues-file`, not `--mutate-residues-file`: the latter switches FoldX onto a simplified
> code path. See §9 and §9.1 for the corrected claim and its held-out limits.

`--mutate-residues-file` is a genuine discovery and worth having: it turns a 284 s repair into
11 s and is stable across radii. Its correct role is **making a large template affordable**, not
**reproducing full repair**. If adopted, it must be the single repair definition for large templates,
disclosed in the payload (`template: "local shell, r=15 Å, 62 residues"`), and never presented as
equivalent to `RepairPDB`.

## 8. Verdict

**Revise before implementing.** Part A (Bugs 3–5, the companion persistence, the SASA scale check)
is sound and low-risk once P0-2 is rewritten against the code that exists. Part B's headline
mechanism (`--mutate-residues-file`) is refuted by direct measurement; its successor
(`--fix-residues-file`, §9) is a real 10–26× speed-up but, on held-out sites (§9.1), is a distinct
estimator rather than a cheaper `RepairPDB`.

---

## 9. Follow-Up Diagnostic & Breakthrough (2026-11-02): Why `--mutate-residues-file` Failed and How `--fix-residues-file` Solves It

To determine *why* `--mutate-residues-file` failed to converge even at `r = 30 Å` on GATA4 (`+0.6013` vs. full repair `+0.1276`), we ran a controlled experiment passing **all 442 residues of GATA4** to `--mutate-residues-file` (`logs/foldx_bench/gata4/test_all_mutate_flag`):

1. **`--mutate-residues-file` is a different algorithm inside FoldX 5.1, even when given 100% of the protein:**
   - Passing all 442 residues via `--mutate-residues-file` completed in `48.16 s` (vs. `89.0 s` for standard `RepairPDB`) and produced coordinates around `Ser159` that matched the broken `shell_15` structure (`0.0010 Å` difference at `Ser159`, `0.137 Å` at `Tyr158`) while diverging by **`2.20 Å`** from standard `RepairPDB` at `Tyr158` and **`1.98 Å`** at `Tyr162`.
   - Thus, `--mutate-residues-file` switches FoldX 5.1 into a simplified single-pass code branch (`Checking if there are specific residues to repair`) rather than standard multi-pass `RepairPDB`.

2. **`--fix-residues-file` (passing the complement set) stays on the true `RepairPDB` code path:**
   - When we instead pass the *complement* (all residues outside the target neighborhood) to **`--fix-residues-file=fix.txt`** (with no `--mutate-residues-file`), FoldX executes its standard `RepairPDB` optimization on the unfixed neighborhood.
   - To also prevent **shell collapse in disordered segments** (`GATA4 p.Ser159Cys`, `pLDDT 43.3`, where the $15\text{ Å}$ sphere has only 11 residues and clamps `Phe154` against fixed sequence neighbors `146..153`), we expand the unfixed set with $\pm 14$ sequence neighbors whenever $|S_{15\text{Å}}| < 25$.

| Protein & Variant | Method | Unfixed / Total | `RepairPDB` Time | `BuildModel ×5` ΔΔG | SD | Error vs. Full `RepairPDB` | Band |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| **CNNM2 875 aa** (`SA489C`) | `--mutate-residues-file` (`15 Å`) | 62 / 875 | `11.10 s` | `+0.4406` | `0.0187` | `-0.7344` | neutral (wrong) |
| **CNNM2 875 aa** (`SA489C`) | **`--fix-residues-file` (`15 Å` unfixed)** | **62 / 875** | **`10.93 s`** | **`+1.1732`** | **`0.0168`** | **`-0.0018`** | **moderate (matches full)** |
| **CNNM2 875 aa** (`SA489C`) | **`--fix-residues-file` (`15 Å ∪ ±14 seq`)** | **75 / 875** | **`49.85 s`** | **`+1.1749`** | **`0.0259`** | **`-0.0001`** | **moderate (matches full)** |
| **CNNM2 875 aa** (`SA489C`) | **Full-chain `RepairPDB`** | 875 / 875 | `284.10 s` | **`+1.1750`** | `0.0230` | `0.0000` (ref) | **moderate** |
| **GATA4 442 aa** (`SA159C`) | `--mutate-residues-file` (`15 Å`) | 11 / 442 | `0.90 s` | `+0.6023` | `0.0013` | `+0.4747` | moderate (wrong) |
| **GATA4 442 aa** (`SA159C`) | **`--fix-residues-file` (`15 Å ∪ ±14 seq`)** | **29 / 442** | **`8.48 s`** | **`+0.1610`** | **`0.0263`** | **`+0.0334`** | **neutral (matches full)** |
| **GATA4 442 aa** (`SA159C`) | **Full-chain `RepairPDB`** | 442 / 442 | `89.00 s` | **`+0.1276`** | `0.0045` | `0.0000` (ref) | **neutral** |

### 9.1 Held-out check of §9 (2026-11-02, after the v2 claim was written)

§9 reports two sites — and one of them (GATA4 159) required a heuristic added *after* seeing its
failure. Equivalence claims have to survive sites the rule was not tuned on. The parameters were
therefore frozen exactly as §9 states them (movable = 15 Å sphere, ∪ ±14 sequence neighbours when the
sphere has <25 residues; no re-tuning) and applied to twelve further substitutions across four
structures (three proteins), each compared against a full-chain `RepairPDB` run made in the same session.

| Site | 15 Å sphere | Movable (rule) | Regime the rule calls safe? | Fix-complement ΔΔG | Δ vs full | Adaptive ΔΔG | Δ vs full | Full `RepairPDB` | Full repair time |
| :--- | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| GATA4 A100 T→A | 11 | 29 | no (buffer applied) | +0.3539 | −0.0016 | +0.3533 | −0.0022 | +0.3555 | 44.6 s |
| GATA4 A200 A→V | 13 | 29 | no (buffer applied) | +0.5544 | +0.0256 | +0.5549 | +0.0261 | +0.5288 | 74.8 s |
| GATA4 A250 I→A | 45 | 45 | **yes** | +0.7994 | −0.0191 | +0.7994 | −0.0191 | +0.8185 | 44.9 s |
| GATA4 A300 K→A | 35 | 35 | **yes** | +0.1951 | −0.0364 | +0.1951 | −0.0364 | +0.2315 | 47.3 s |
| GATA4 A350 S→C | 10 | 29 | no (buffer applied) | −0.0993 | +0.0038 | −0.0996 | +0.0035 | −0.1031 | 112.4 s |
| GATA4 A159 S→C | 11 | 29 | no (buffer applied) | −0.0458 | −0.1734 | +0.1610 | +0.0334 | +0.1276 | 89.0 s |
| **CNNM2 A300 N→A** | 47 | 47 | **yes** | +0.1203 | **−0.5128** | +0.1203 | **−0.5128** | **+0.6331** | 233.1 s |
| CNNM2 A450 M→A | 86 | 86 | **yes** | +2.1654 | +0.0564 | +2.1654 | +0.0564 | +2.1090 | 303.3 s |
| **CNNM2 A600 R→A** | 56 | 56 | **yes** | +1.6500 | **+0.3264** | +1.6500 | **+0.3264** | **+1.3236** | 232.0 s |
| CNNM2 A700 K→A | 31 | 31 | **yes** | +0.1896 | +0.0153 | +0.1896 | +0.0153 | +0.1743 | 234.8 s |
| CNNM2 A489 S→C | 62 | 75 | **yes** | +1.1732 | −0.0018 | +1.1749 | −0.0001 | +1.1750 | 284.1 s |
| **6N7E A489 S→C** (crystal, 44 incomplete) | 51 | 51 | **yes** | +0.0425 | +0.0097 | +0.0425 | +0.0097 | +0.0328 | 122.8 s |
| **1R3S A318 G→R** (crystal, UROD, 0 incomplete) | 67 | 67 | **yes** | −1.6661 | +0.1760 | −1.6661 | +0.1760 | −1.8421 | 93.6 s |
| 1R3S A250 E→A (crystal, UROD) | 40 | 40 | **yes** | +0.3058 | +0.0807 | +0.3058 | +0.0807 | +0.2251 | 93.4 s |

**Third and fourth structures (2026-11-03).** The first review asked whether the error was a property of
one structure. 6N7E chain A is a crystal of the *same protein* (CNNM2) at the *same residue* that already
passed on the AlphaFold model, 305 residues with 44 truncated side chains; it agreed (+0.0425 vs +0.0328,
Δ 0.0097) and took 26.9 s against full repair's 122.8 s. That also settles the "does the local repair still
pay for missing side chains" question: it does, about 0.3 s each natively, well inside the 420 s cap.
It is **not** an independent protein, so a fourth structure was run: UROD (1R3S, chain A, 356 residues, a
dense crystal with no truncated side chains). It does not agree as tightly — 0.176 and 0.081 kcal/mol.
Neither crosses a band, but they show the offset is **not** confined to one template.

**What this says:**

1. **The rule is not generally equivalent.** 9 of 14 sites agree within 0.04 kcal/mol; five do not
   (0.056, 0.081, 0.176, 0.326, 0.513). The 0.17 in the 15 Å-only column is the A159 failure that the
   sequence buffer fixes.
2. **Two misses are band-changing.** CNNM2 A300: 0.12 (neutral) vs 0.63 (moderately destabilizing).
   CNNM2 A600: 1.65 (destabilizing) vs 1.32 (moderately destabilizing). The other three stay in band.
3. **Most gaps are small, and a few are large.** Across the 14 sites the median gap is about 0.03 kcal/mol,
   with no overall shift (mean signed +0.013). Every gap above 0.2 is on one structure, the CNNM2 AlphaFold
   model, and 3 of its 5 sites miss; four structures cannot say whether that comes from the site or the
   template. Neither shell size nor template source predicts it so far, which is the argument for
   disclosing it rather than modelling it.
4. **The band-changing misses are in the regime the plan declares safe.** Both have 47 and 56 movable
   residues, so the `< 25` buffer never triggers. **The "shell collapse in disordered segments"
   explanation is contradicted by the data** — the small-shell sites are fine and the large-shell
   sites fail.
5. **The ±14 buffer is a patch for one site.** It fixes GATA4 159 (0.17 → 0.03) and is harmless
   elsewhere; it cannot help the CNNM2 failures because the rule does not fire there.
6. **The speed-up is real and grows with chain length.** Fix-complement repair ran 4.6–57× faster than
   full repair on the same site (6N7E: 26.9 s vs 122.8 s; 1R3S: 13–16 s vs 93 s; CNNM2: 8.9–31.3 s vs
   234–303 s; GATA4: 0.9–13.1 s vs 44.6–164.6 s), with the same determinism.

**Corrected claim for §9:** `--fix-residues-file` is a real discovery — it removes the simplified
code path and is a legitimate speed-up — but it is **a distinct estimator, not a drop-in equivalent**.
Measured disagreement with full repair: ≤0.04 kcal/mol at 9 of 14 sites, 0.06–0.51 at the other five,
band-changing in 2 of 14. It may be *served* (it is deterministic and fast), but its values must be
labelled and must never be mixed with full-repair values for the same variant or compared with
ProtVar's full-repair FoldX as if they were the same quantity.

### 9.2 Shipped (2026-11-03): the product code reproduces the benchmark

The conclusion of 9.1 was adopted as stated: a disclosed, size-chosen estimator, not an equivalence.
The TypeScript shell planner (`server/services/stability/foldx/repair-shell.ts`) was compared with the
benchmark's own `fix.txt` files at all six held-out sites: identical residue sets (47, 56, 29, 29, 45, 29
movable). The shipped runner (`generateMutantPdb`, the real FoldX 5.1 binary, no fakes) then gave:

| Variant | Conditions | Shipped runner ΔΔG | Benchmark | Wall time |
| :--- | :--- | ---: | ---: | ---: |
| GATA4 442 aa, SA159C | shipped pH 7.4 / 298.15 K / 0.15 M | **+0.1610** | +0.1610 | 4.0 s |
| GATA4 442 aa, SA159C | FoldX defaults | +0.1774 | — | 4.2 s |
| CNNM2 875 aa, NA300A | FoldX defaults | **+0.1203** | +0.1203 | 37.2 s |

(For comparison, whole-chain repair of the GATA4 variant gave +0.1276 in 89 s. CNNM2 NA300A is one
of the two sites where local repair differs from whole-chain repair, +0.1203 against +0.6331; that is the
disclosed offset, and the interface says so on every local-repair value.)

The rule that decides the mode is `foldxIntendedRepairMode(residueCount)`: whole chain up to 233 residues
(the largest a whole-chain repair fits the 420 s cap on the Box64 server), local above. It is part of the
result's cache key (`_repair:` segment, key version v5), and a result that did not get the repair its key
names is shown but never cached.

### 9.3 Against experiment: all of S669 (2026-11-04)

Sections 2 to 9.2 compare the repairs with each other, as if whole-chain repair were the truth. This one
compares each with the measured stability change. `scripts/foldx-repair-benchmark.ts` ran the shipped cleaner,
shell planner and parser on S669 (Pancotti et al. 2022), experimental chains, pH 7.4 / 298.15 K / 0.15 M, 5 runs:
667 of 669 variants on 94 chains. (3DV0 chain I residue 129 failed in all modes: FoldX drops the residue and
answers "Specified residue not found".) Raw rows and `summary.json` are in `logs/foldx_bench/s669/`.

| Set | Mode | r | RMSE | MAE | Band matches measurement |
| :--- | :--- | ---: | ---: | ---: | ---: |
| All (667 on 94) | none | 0.293 | 2.059 | 1.435 | 48.1% |
| | full | 0.328 | 1.970 | 1.395 | 47.4% |
| | local | 0.320 | 2.001 | 1.407 | 47.2% |
| Up to 233 residues (575 on 81) | none | 0.318 | 2.002 | 1.374 | 49.2% |
| | full | 0.373 | 1.856 | 1.305 | 48.7% |
| | local | 0.359 | 1.900 | 1.322 | 48.2% |
| Above 233 residues (92 on 13) | none | 0.224 | 2.385 | 1.818 | 41.3% |
| | full | 0.177 | 2.571 | 1.959 | 39.1% |
| | local | 0.189 | 2.543 | 1.937 | 41.3% |

95% intervals, resampling whole chains, for local minus full:

| Set | r | RMSE |
| :--- | ---: | ---: |
| All | −0.026 to +0.007 | −0.011 to +0.087 |
| Up to 233 residues | −0.028 to −0.001 | 0.000 to +0.099 |
| Above 233 residues | −0.079 to +0.037 | −0.071 to +0.123 |

Local against whole-chain, above 233 residues: median gap 0.09, 90th percentile 0.64, maximum 1.87 kcal/mol, band
changed for 4 of 92. Across all variants: median 0.03, maximum 2.69, band changed for 18 of 667; no repair against
whole-chain changed the band for 96 of 667.

**What this settles**

1. **The size rule stands.** Up to 233 residues, whole-chain repair is slightly but measurably closer to
   experiment (the interval only just excludes zero), so local repair should not replace it there. Above 233 no
   difference is detectable, so nothing justifies making readers wait for a whole-chain repair there.
2. **The earlier 0.51 kcal/mol ceiling was too low.** It came from 14 hand-picked sites. The interface now shows
   the S669 numbers, generated by the script.
3. **Repair is not shown to improve accuracy.** No repair against whole-chain: r −0.081 to +0.017, RMSE −0.074 to
   +0.275. The intervals include zero, and on the large chains the unrepaired point estimates are the best of
   the three. Repair stays as the preparation standard FoldX recommends and because it changes the band for 14% of
   variants, not because it is proven more accurate.
4. **The bands are weak against experiment.** FoldX's RMSE is about 2 kcal/mol, four times the 0.5 mark, and its band
   matches the measured band under half the time in every mode. The gap between repair modes is not the main
   limit on this reading.

**Limits.** These are experimental structures, while the app often uses AlphaFold models. The largest chain is 540
residues, so nothing here tests sizes like CNNM2 (875), where the earlier gaps were found. Only 13 chains are above
233 residues, so "no detectable difference" there is a wide interval, not proof that they are the same. A few
chains supply many rows, which is why the intervals resample chains.

### 9.4 What a FoldX value can say: a held-out test (2026-11-04)

Section 9.3 compares repairs on S669 alone. This section treats FoldX as an instrument and tests it on data used for no
fitting: Ssym direct, 342 lab-measured variants on 15 proteins, sharing no PDB entry with S669. All 342 completed.
`scripts/foldx-measurement-analysis.py logs/foldx_bench/s669 logs/foldx_bench/ssym` reproduces every number; intervals
resample whole chains. "Shown value" means what the app shows: whole-chain up to 233 residues, local above.

**Rules fixed before Ssym was run, and what happened**

| Rule | Result | Outcome |
| :--- | :--- | :--- |
| 1. A repair mode changes only if another is better by more than 0.1 kcal/mol RMSE on both sets | Local minus whole-chain, 90%: S669 −0.007 to +0.080, Ssym +0.007 to +0.054 | Equivalent on both. **Rule stays** |
| 2. Recalibrate only if held-out RMSE falls by over 0.1 and band agreement does not fall | RMSE 1.55 to 1.24, band agreement 63.2% to 48.0% | **Rejected** |
| 3. An 80% interval is credible only with 75% to 85% held-out coverage | Coverage 88.0% (81.2% to 91.1%); mean width 3.99 kcal/mol | **Rejected** |
| 4. A band reliability table only if every row is within 15 points of the held-out set | Largest gap 22 points | **Rejected** |
| 5. To be called informative, beat both baselines on Ssym | Band: +6.1 to +28.4 points, passes. RMSE gain over a constant: −0.217 to +0.448, fails | **Mixed** |

| | S669 | Ssym direct |
| :--- | ---: | ---: |
| Variants, chains | 667, 94 | 342, 15 |
| Correlation, shown value | 0.331 | 0.641 |
| RMSE, shown value | 1.965 | 1.552 |
| RMSE of always predicting the S669 mean | 1.637 | 1.542 |
| Slope of measured on FoldX | 0.309 | 0.500 |
| Band matches measurement | 47.7% | 63.2% |
| Always "no destabilization" | 41.1% | 43.3% |
| RMSE, exposed sites / buried sites | 1.53 / 2.32 | 1.05 / 1.80 |

Measured band when FoldX shows each band (low / moderate / high, percent):

| FoldX shows | S669 | Ssym direct |
| :--- | ---: | ---: |
| Low | 52 / 28 / 20 | 74 / 22 / 4 |
| Moderate | 48 / 25 / 27 | 32 / 35 / 33 |
| High | 21 / 20 / 59 | 12 / 24 / 64 |

**What this settles**

1. **The repair question is closed.** Local repair came out slightly worse than whole-chain repair at 233 residues or fewer
   on both sets (+0.04 on each, intervals excluding zero), but inside the margin. That is a reason to keep whole-chain repair
   where it is affordable, and no reason to change anything. Above 233 there is too little data: S669's interval just crosses
   the margin (+0.101), and Ssym has one such chain.
2. **Large FoldX values overstate the change; the overall spread is about right.** FoldX's spread of values is 1.07 and 1.28
   times the measured spread, so it is not simply "too large". The low slope (0.31, 0.50) mostly reflects the weak correlation:
   slope is correlation times the ratio of spreads. A first version of this note read the slope as "2 to 3 times too large",
   which was wrong. What is true: values from 3 to 5 averaged 3.8 and 3.6, and the lab values 2.2 and 2.8; values in the middle
   are close on average (0.94 and 0.96 against 0.84 and 1.04). A constant still matches raw FoldX by RMSE, so FoldX carries
   information about order and direction more than about exact size, and the differing fits are why rule 2's rejection stands.
3. **The moderate band says very little.** On both sets a FoldX "moderate" reading is close to an even split of the measured bands.
4. **Accuracy depends on the protein set, so no single number describes FoldX.** Ssym is dominated by well-studied proteins
   (259 of 342 rows are lysozymes), which probably overlap what FoldX was parameterized on; this was not checked. S669 was
   built to be non-redundant, so its 2 kcal/mol stays the honest figure for a protein FoldX has not seen.
5. **Buried sites have larger errors in both sets.** This replicates, but it was not a fixed rule and is not shown in the app.
6. **The instrument is sound.** Pancotti et al. 2022 report FoldX on S669 direct variants at r 0.22, RMSE 2.30, MAE 1.56; ours is
   r 0.33, RMSE 1.97, MAE 1.40. Shuffled labels give r 0.00. The difference in the published direction may come from FoldX version
   and protocol; a row-by-row match was not done.
7. **The error is mostly FoldX, not the lab.** 34 variants measured more than once in FireProt give a pooled SD of 0.43 kcal/mol
   (a weak estimate, since that file is mostly de-duplicated). Montanucci et al. 2019 put the correlation ceiling near 0.7 to 0.8.

**Limits.** Both sets use experimental structures, so none of this describes AlphaFold models. Only 13 S669 chains and 1 Ssym chain
are above 233 residues. Neither set tests the app's headline verdict, which combines six engines.

### 9.5 AlphaFold models, the headline verdict and engine bugs (2026-11-05)

Rules were fixed before these runs, in the same way as section 9.4. Reproduce with `scripts/foldx-alphafold-dataset.py`,
`scripts/foldx-repair-benchmark.ts` and `scripts/verdict-benchmark.ts`.

**AlphaFold models.** 335 S669 and Ssym variants on 84 proteins (sizes 45 to 1,465 residues; 37 proteins above 233), at most 8
variants per protein.

| Check | Result | Outcome |
| :--- | :--- | :--- |
| Model against experimental structure, same variants, RMSE (90%) | 2.02 against 2.03, difference −0.128 to +0.110 | Just outside ±0.1, so not shown equivalent. The size of the error is about the same |
| Local minus whole-chain, above 233 residues (90%) | −0.032 to +0.031 | **Equivalent.** This closes the large-chain gap left by section 9.4 |
| Local minus whole-chain, 233 or fewer (90%) | −0.166 to −0.012 | Local slightly better here, the opposite of S669 and Ssym. No mode is better by over 0.1 on all sets, so the rule stays |
| No repair minus whole-chain (90%) | −0.117 to −0.027 | Repair is again not shown to improve accuracy on models |
| Error by pLDDT at the site | 333 of 335 sites have pLDDT of 70 or more | Cannot say anything about low-confidence sites |

The structure matters more than the repair: for the same variant, FoldX on the model and on the experimental structure differ by a
median of 0.51 kcal/mol, and land in a different band 33% of the time.

**Burial.** The rule needed buried minus exposed RMSE above 0.3, with the interval above zero, on all three sets. S669 +0.79 (0.43 to
1.09), models +0.56 (0.12 to 1.00), Ssym +0.75 (−0.22 to 1.18). Ssym fails, so the app shows no burial line. Buried sites also have
larger measured changes, so this does not by itself mean FoldX is less reliable there.

**Engine bugs found by comparing with what the authors publish.**

| Engine | Bug | Before | After |
| :--- | :--- | ---: | ---: |
| ThermoMPNN | `lightattn: False`; the checkpoint's attention layer was dropped without an error | r with lab 0.19 (S669), 0.11 (Ssym) | 0.44, 0.73. Matches the authors' 2OCJ predictions to 0.0005 |
| VESM | Hid the residue before scoring; the authors score the unmasked sequence | Spearman with lab 0.23 (28 proteins) | 0.42, a gain of 0.19 (95%: 0.12 to 0.26), better on 23 of 28. Re-run on true wild-type sequences; the first run used one variant's sequence as the base |
| ESM-2 | None found: masked is very slightly better than unmasked (difference −0.017, 95%: −0.033 to −0.003) | | Unchanged |
| SaProt | Loads all weights. Scoring not compared, because it needs structure tokens | | Unchanged |
| StabilityOracle | Inputs differ from upstream, and the output is not converted: published value = −output/2 | r with lab 0.12 (S669), 0.17 (Ssym), against published 0.49, 0.69 | 0.39, 0.64. Not an exact match, section 9.6 |

StabilityOracle's checkpoint reproduces its published predictions exactly (r 1.00000) from upstream's own embeddings, so the model is sound
and the problem is its inputs. A recipe with hydrogens and a charge table learned from p53 reaches r 0.56 with published values on S669, and
r 0.28 with lab values. The charges are still not identified.

**Headline verdict over 3 of 6 engines** (FoldX, ThermoMPNN, StabilityOracle, with ThermoMPNN fixed and StabilityOracle not; DynaMut2 and DDMut
are remote services not meant for bulk use, and RaSP is keyed by accession):

| Set | Variants | Calls made | Verdict band match | Always "no destabilization", all variants | ThermoMPNN alone | FoldX alone |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| S669 | 666 | 67.9% | 53.3% | 41.0% | 54.5% | 47.7% |
| Ssym | 341 | 64.8% | 78.7% | 43.4% | 67.4% | 63.0% |
| AlphaFold models | 335 | 63.0% | 59.2% | 43.6% | 54.6% | 52.2% |

Against always "no destabilization" on the same called variants, the verdict's gain (95%) is −2.6 to +16.7 points on S669, +8.6 to +34.9 on Ssym
and −1.3 to +20.2 on models. So it is not shown useful on all sets. No single engine beats it by 5 points on all sets, and dropping FoldX or its
moderate readings does not gain 5 points on all sets, so its rules stay as they are. Section 9.6 repeats this with StabilityOracle fixed.

### 9.6 The verdict with every engine fixed (2026-11-05)

StabilityOracle now follows its authors (`doc/STABILITY_ORACLE_INPUTS_RESEARCH.md`): r with their predictions 0.85 on Ssym, 0.81 on S669 and 0.88 on proteins never used in this work, not an exact match. NMR files now keep the first model only in every structure-based engine. Same rules as section 9.5, fixed in advance, and the same three engines. Variants are those all three engines scored (StabilityOracle refuses 5PTI A and 3DV0 I).

These templates hold one chain, as FoldX was run on them, so this does not measure StabilityOracle's partner-chain rule. On a multi-chain file the engine's own results improve (research doc), but the verdict there is untested. The app's own templates hold one chain, as here.

| Set | Variants | Calls made (9.5) | Verdict band match (9.5) | Gain over always "no destabilization" on the same variants, points | 95% | 90% |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| S669 | 638 | 72.4% (67.9%) | 58.4% (53.3%) | +9.3 | −0.2 to +18.2 | +1.3 to +16.8 |
| Ssym | 337 | 67.7% (64.8%) | 77.2% (78.7%) | +21.5 | +5.7 to +32.0 | +8.1 to +30.1 |
| AlphaFold models | 335 | 68.4% (63.0%) | 62.4% (59.2%) | +12.2 | +4.8 to +20.0 | +6.0 to +18.7 |

| Rule | Measured | Outcome |
| :--- | :--- | :--- |
| V1: gain interval above zero on S669 and Ssym. The rule named no level; the script computed 95% from the start, so 95% is what it reads | Ssym passes. S669 misses by 0.2 points at 95% and passes at 90% | **Borderline.** Not met at the level fixed in advance, and closer than before (−2.6). The gain is likely real on S669 but not firmly shown. Nothing in the app depends on this rule |
| V2: use one engine instead, if it gains 5 or more points on both | ThermoMPNN alone: +11.8 and +23.4, against the verdict's +9.3 and +21.5, so 2.5 and 1.9 better | **Not met.** The verdict stays |
| V3: drop FoldX, if it gains 5 or more points on both and costs at most 10 points of calls | Band match +4.7 and −0.3; costs 16.0 and 20.2 points of calls | **Not met.** FoldX stays |
| V3: drop FoldX's moderate readings, same test | Band match +2.6 and +2.5; costs 6.6 and 6.3 points of calls | **Not met.** They stay |

The engines alone, r with lab values on S669, Ssym, models: FoldX 0.33, 0.65, 0.40; ThermoMPNN 0.42, 0.71, 0.44; StabilityOracle 0.38, 0.66, 0.37. By band match, StabilityOracle alone is the weakest (45.8%, 48.7%, 46.3%) and barely beats always "no destabilization", since its values are less spread out than published.

What readers can take from a verdict, as measured bands (low / moderate / high):

| Verdict says | S669 | Ssym | AlphaFold models |
| :--- | :--- | :--- | :--- |
| No destabilization | 58 / 24 / 18 (n 350) | 77 / 19 / 4 (n 157) | 62 / 21 / 16 (n 170) |
| Moderate | 30 / 33 / 37 (n 46) | 26 / 52 / 22 (n 23) | 23 / 41 / 36 (n 22) |
| High | 15 / 6 / 79 (n 66) | 0 / 10 / 90 (n 48) | 11 / 14 / 76 (n 37) |

So a "high" verdict is usually right, a "moderate" verdict says little, and "no destabilization" still hides a measured high change in 4 to 18% of cases. These shares are not shown in the app: they are from three engines, not the six the app can use. DynaMut2, DDMut and RaSP are still not tested.

### 9.7 Partner chains in the FoldX template (2026-11-05)

The app cuts a PDB entry down to one chain before FoldX sees it, so a residue at a chain interface loses its neighbours. Would FoldX be closer to the lab if the chains touching the site stayed? The rule was fixed before any run (header of `scripts/foldx-partner-chain-benchmark.ts`): send partner chains only if, on S669 interface variants, the RMSE falls by 0.10 kcal/mol or more with the chain-resampled 95% interval below zero, the band match does not fall, and the independent set (T2837 and FireProtDB, no entry shared with S669, Ssym, p53 or myoglobin) moves the same way. Each template uses the repair the app would choose for its size. An interface variant has a partner-chain atom within 10 Å of its alpha carbon.

| Set | Variants | RMSE, one chain | RMSE, with partners | Difference (95%) | Band match |
| :--- | ---: | ---: | ---: | :--- | :--- |
| S669 | 149 on 36 chains | 2.01 | 2.35 | +0.34 (+0.10 to +0.56) | 51.7% to 47.0% |
| Independent | 75 on 26 chains | 1.78 | 1.99 | +0.21 (−0.04 to +0.54) | 54.7% to 53.3% |

**Outcome: not adopted.** All three conditions fail. Partner chains made the error larger on both sets, and the S669 interval lies wholly above zero. Not deciding anything, but pointing the same way:

- Direct contact only (a partner atom within 5 Å of the variant residue): S669 RMSE 1.86 to 2.59 on 72 variants, and the largest single change is 6.85 kcal/mol. Independent: 1.87 to 2.11 on 49.
- No repair on either side: the difference is about the same (+0.34 on S669, +0.19 independent), so repair does not cause it.
- Templates grow (median 243 residues on S669, largest 854), and many pass the 233-residue limit, which changes the repair. The no-repair rows are the control for that.

The cause is not established. One possibility is that some partner chains in a PDB file are crystal contacts, not real partners. So the app keeps sending one chain. StabilityOracle is different: it reads partner chains only when a supplied file holds them, and they helped it (research doc).
