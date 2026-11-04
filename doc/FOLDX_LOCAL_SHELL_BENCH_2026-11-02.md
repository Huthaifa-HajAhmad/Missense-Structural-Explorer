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
| ±0.15 kcal/mol straddle guard | Smaller than FoldX's accuracy (RMSE ≈ 0.5–1) and than the 0.45 repair step. It would almost never fire where it matters. |
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
