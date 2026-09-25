# Residue Shifts & Pockets — review resolution

**What this records.** The multi-reviewer findings on the Residue Shifts & Pockets /
narrative surface, what was changed for each, and what was deliberately left open.

**Provenance.** This work was authored in session `session-353d0bf3` ("Residue shift tab
Fix AI"), whose final turn was aborted mid-flight on 24 Sep 2026 at 21:31:30 when the LLM
provider's quota window closed — one step short of committing. The file writes had already
landed, so the change set survived on disk; only the reasoning and the report were lost. The
transcripts were recovered to `.session-recovery/` (now git-ignored) and the change set was
verified and landed as commit `da643fa`. Findings are reproduced from the interrupted
session's review record; every disposition below is grounded in the committed diff, not in
that record's claims.

**Verified against:** `da643fa` on `main` (working tree clean for this surface), and `06774d7`
for the closure recorded in "Closed after this resolution".

---

## What landed

`da643fa` — 22 files, +1026 / −327:

| Area | Files |
|---|---|
| Burial classification | `src/shared/burialEvidence.ts`, `server/services/external-api/esm3_forge.ts`, `server/services/structure/pocket/disruption.ts`, `tools/sasa_eval.py` |
| Panel / inspector | `src/components/evidence/ResidueEnvironmentPanel.tsx`, `StructureTab.tsx`, `MetricExplanations.ts`, `src/components/inspector/ResidueShiftInspector.tsx` |
| Narrative re-synthesis | `src/hooks/useNarrativeResynthesis.ts` (+ new test), `src/shared/residueShiftEvidence.ts` |
| Gemini attempt policy | `server/services/llm/gemini.ts`, `gemini.test.ts`, `gemini-budget.test.ts` |
| Cache generation | `server/services/infra/cache-keys.ts`, `src/services/pipeline/variantCache.ts` |
| Docs | `doc/ARCHITECTURE.md`, `doc/DEPLOY.md`, `.env.example` |

`f02e9fe` — `.gitignore` gains `.session-recovery/`, so the ~45 MB of decoded transcripts
cannot be swept into an unrelated commit.

---

## How this was verified

| Check | Command | Result |
|---|---|---|
| Typecheck | `node node_modules/typescript/lib/tsc.js --noEmit` | exit 0, **0 errors** across the whole tree |
| Full suite | `node node_modules/vitest/vitest.mjs run` | **163 files passed, 1908 tests passed, 5 skipped, exit 0** |
| Surface suites present in that run | — | `gemini` 11, `gemini-budget` 24, `useNarrativeResynthesis` 7, `burialEvidence` 16, `burialBandsSingleSource` 3, `StructureTab` 20, `ResidueShiftInspector` 20, `ContrastScale` 14 |
| Guard can fail | mutated the stale-variant guard to an always-equal comparison | **1 failed / 6 passed** — exactly the stale-variant test, no other |
| Mutation reverted | SHA-256 of `useNarrativeResynthesis.ts` | `D289BEBF…D7045` before and after — byte-identical |
| Typecheck at `06774d7` | `node node_modules/typescript/lib/tsc.js --noEmit` | exit 0, **0 errors** |
| Full suite at `06774d7` | `node node_modules/vitest/vitest.mjs run` | **164 files passed, 1920 tests passed, 5 skipped, exit 0** — reproduced in both file-parallel and `--no-file-parallelism` modes |
| The closure's guards can fail | reintroduced all five source defects at once (route re-derives the kind; cancellation message; `sequence` unwired; packing sentence; unnamed structure) | **7 failed / 53 passed** in the five touched suites — exactly the assertions covering the five, nothing else. Restored byte-identical (SHA-256 of all 12 files) |

The suite cannot start under the confined sandbox (`esbuild` needs a named pipe), so those
two runs used a one-shot escalation.

**Not verified:** rendering in a real browser. No browser or image reader was available, so
the visual claims rest on the code and the DOM-level tests.

---

## Findings and disposition

### Fixed — a surface asserted more than its data supported

| # | Finding | Fix |
|---|---|---|
| B1 | The panel printed "Decided by Cα packing density" whenever an RSA value was present — even when that value contradicted the word beside it. The engine's "residue not found in structure" path returns `boundary` with 0 neighbours, which bands as surface. | The basis is claimed only when the indicator *reproduces* the word; otherwise the panel says it cannot tell which measurement decided it, and the caveat says so instead of "no measurement was reported". |
| B2 | `esm3_forge.ts` banded a hard-coded `rsa = 0.12` placeholder as if measured, so every variant without a structure asserted "Hydrophobic core" — and the perturbation rules reasoned about core packing on the strength of it. | The placeholder is no longer banded; the unmeasured case reports "Burial not measured". |
| B3 | `sasa_eval.py` banded the unrounded fraction while shipping `round(rsa, 4)`, so a true `0.15004` could be "core" in the sidecar and "boundary" on screen. | It bands the value it actually ships. |
| B4 | `disruption.ts` hard-coded the 10 Å neighbour shell. | Uses `PACKING_NEIGHBOUR_BANDS.radiusAngstrom`, the constant the client's meter and tick labels use. |
| B5 | Both meters had fixed drawing domains (100%, 24 neighbours) that saturate: RSA above 100% and real 41-neighbour shells drew a marker pinned to the edge beside a label reporting the larger value. | Domains stretch to contain the marker; the ticks stay on the classifier's thresholds. |
| B6 | **Cache generation.** Persisted payloads and client bundles written under the retired 5%/25% RSA cutoffs rendered a "Surface" badge beside a BOUNDARY measure — for up to 30 days server-side and 24 h client-side. | `CACHE_SCHEMA_VERSION` v7 → v8, `CACHE_VERSION` v3.8 → v3.9, so the older generation is purged rather than replayed. |

### Fixed — narrative re-synthesis

| # | Finding | Fix |
|---|---|---|
| N1 | **MAJOR.** A retry started for variant A could resolve after the user switched to B and install A's clinical report under B's gene/variant header. The store's own update path and the pipeline both guard on this; this path did not. | The write is guarded on the variant, and the request now carries an `AbortSignal` that is aborted on unmount. Mutation-tested. |
| N2 | **MAJOR.** A degraded response merged with a spread, which *retained* the previous pass's AI-authored `plausibility` — an AI paragraph printed under a "rule-based only" status strip. | For AI-authored fields a declared absence now wins: `plausibility` is cleared when the response is degraded. |
| N3 | Two surfaces retrying at once fired two syntheses for one variant. | Concurrent retries coalesce onto the in-flight promise. |
| N4 | A transport failure left the shared loading flag set. | The failure path reports through a notification and clears the flag in `finally`. |
| N5 | The degradation-reason chip was hard-coded amber, painting "AI not configured" (a setup state) with the severity of a rejected key. | The tone comes from the shared vocabulary (`reasonTone`), so the chip and the report bar's status strip agree. |
| N6 | `ResidueEnvironmentPanel`'s caveat was an `else` branch — suppressed in exactly the state it scopes: a packing-derived word that contradicts its own count. | The caveat renders alongside the disagreement. |
| N7 | `StructureTab` imported the *named* export and silently dropped the memo, re-rendering the pane on every parent update. | Imports the memoized default export. |
| N8 | The inspector listed the four contrast axes in a different order from the main column. | Both use `rankContrastRowsByMagnitude`. |

### Fixed — Gemini attempt policy

| # | Finding | Fix |
|---|---|---|
| G1 | **MAJOR.** The slice-expiry error `gemini.ts` itself raises matched no classification bucket, so a merely-slow candidate classified as `unknown`, was spliced out of the pool and never cooled. The model measured answering a full narrative could therefore never reach the uncapped long-shot attempt the reserve exists for, and led the ladder again on the next request. | The synthetic slice error carries `status = 504`, the provider's own deadline status, so the existing timeout branch classifies it. |
| G2 | The reserve was computed from the *shrinking remainder*, which let the first attempts consume the very time it existed to protect. | Derived from the total budget. |
| G3 | Budget accounting summed provider-call durations, understating consumption by ~11.6 s (mean) over a full ladder — so "the budget is the bound" was untrue of the clock. | Elapsed wall clock. |
| G4 | An empty completion was cooled but not remembered, and an undecodable JSON reply likewise; a request that never produced text fell through to "unavailable due to generation error" prose the route treats as a *successful* synthesis and caches. | Both set the last error and leave the pool; a request with no attempt at all now raises a typed failure. |
| G5 | The biophysical call's flat 60 s `httpOptions.timeout` could never fire under a 45 s budget and contradicted the narrative path beside it. | Uses the attempt slice. |
| G6 | The backoff's abort listener leaked one registration per attempt. | Removed on the success path. |
| G7 | The mapping test in `gemini.test.ts` was vacuous — an outer `catch` swallowed every assertion. | Rewritten with direct assertions and no swallowing catch; proven able to fail by mutation (expectation changed → RED → reverted). |
| G8 | `MAX_ATTEMPTS_PER_REQUEST` was 12, which recreated the original defect elsewhere: a fast-failure storm stopped the loop with most of the budget unspent. | Raised to 48 as a runaway guard only, with the wall-clock budget as the real bound. |

### Documentation

| # | Finding | Fix |
|---|---|---|
| D1 | `.env.example` described the ladder as "ordered by measured synthesis latency", which the ordering is not (it is reliability first, then latency). | Reworded; the model lines are commented out with the reason, since the request round-robins the ladder anyway. |
| D2 | `ARCHITECTURE.md` named `gemini-3.5-flash` falling back to `gemini-2.5-pro` — two models the API no longer serves. | Describes the round-robined configured ladder. |
| D3 | `DEPLOY.md` advised pinning `GEMINI_MODEL`, which in combination with a stale fallback list left a deployment with no working candidate. | Advises leaving both unset. |

---

## Closed after this resolution

`06774d7` closes F1, F2, and the three MINOR findings the review record carried but this
document never listed.

| # | Finding | Fix |
|---|---|---|
| F1 | The route re-derived the failure kind from the raw error after the attempt loop had already classified it to decide pool membership and cooldowns — one fact, two derivations, and they disagreed in a reachable case: a 503-coded unclassified failure was re-read as "overload", so a slow-but-working provider was presented as "AI service busy". | `GeminiError` carries the verdict it was chosen from (`failureKind`) and the route reads it; only a foreign error that never passed through the loop is classified there. The unclassified case now reports `SERVICE_UNAVAILABLE`. |
| F2 | `metadata.sequence` was declared in `metadataSchema`, sent by the report's re-synthesis, and populated by no builder — so the narrative request asked for a sequence that never arrived. | Both builders carry the wild-type sequence beside `mutatedSequence`. |
| M1 | A packing-derived word was described with the accessibility sentence plus "(Estimated from packing density.)", asserting solvent contact that packing density does not measure — beside a caveat calling packing a proxy. The boundary sentence also claimed "it sits in a pocket", which an RSA band does not establish. | Words derived from packing get sentences about packing; the pocket claim is gone. |
| M2 | The panel header said "in the modelled structure" whatever the source was — including an RCSB entry, which is experimental — and never named the entry. | The header names the entry and its provenance, or says plainly that the structure is unnamed. |
| M3 | The catch-side cancellation said "before any model responded" while attaching the models it had already tried. | It reports the attempt count. The status stays `DEADLINE_EXCEEDED` by decision: the signal is `AbortSignal.any([client disconnect, request deadline])`, the engine cannot tell which input fired, and a client that disconnected reads nothing. |

## Still open

- **F3 — the inspector's retry is not gated on a key being configured.** Re-checked while
  closing F1, and it is narrower than recorded here: the button renders only when the server's
  `fallbackRetryable` is true (`ResidueShiftInspector.tsx:320`), and a *missing* key is
  `API_KEY_MISSING` → status 401 → kind `auth` → non-transient, and not `API_KEY_INVALID`, so
  `fallbackRetryable` is false and no button is offered at all. The forced-retryable case is a
  *rejected* key, where retrying after the credential is fixed is the point. Left as is, but
  restated rather than carried as an open question.

- **F4 — `BiochemicalNarrativeOptions` remains exported** as a public signature type.
  Retained deliberately.

---

## Found while landing this

- **The "not measured" microenvironment was still being presented as a finding.**
  B2's fix stopped `esm3_forge.ts` asserting "Hydrophobic core" from the `rsa = 0.12`
  placeholder and made it report `"Burial not measured"` instead — but that string reached the
  Perturbation tab through a chip renderer that painted every entry identically (same purple,
  same bold, same uppercase). The assertion the server-side fix removed was still being made
  one layer up: on screen, an absence of evidence carried the authority of a measurement.

  Fixed in `e78a866`. The entry is now shared vocabulary
  (`UNMEASURED_BURIAL_ENVIRONMENT` / `isUnmeasuredEnvironment` in
  `src/shared/burialEvidence.ts`), so the producer and the renderer cannot drift on the
  string; the chip marks the absence with muted surface tones in sentence case, and
  `data-environment` carries the distinction for tests instead of a presentation class. The
  four distinction guards were mutation-tested — inverting the predicate fails exactly those
  four and leaves the two unrelated tests passing.

---

## Found while verifying the closure

- **The suite has a cross-file race on the shared job registry** — not this surface, and not
  fixed here. `src/test/setup.ts` redirects `JOB_REGISTRY_PATH` to one file for the whole run
  (`<tmp>/missense-test-state/temp_jobs/job_registry.json`), while `recordJobInRegistry`
  (`server/routes/shared.ts:98`) is an unserialized read-modify-write: two workers writing at
  once lose an entry. One full run at `06774d7` failed
  `biophysics.test.ts > should backfill completed DynaMut2 prediction into FoldX cache upon
  DONE status` for exactly that reason — the entry it had just recorded was clobbered, so the
  poll handler fell back to a computed cache key
  (`cf4dda3d…_SA489C_pH:7_temp:298_ion:0.05_seed:12345_version:v2`) instead of the registry's
  `test_cache_key_489`. The same commit then passed twice (file-parallel and serial), and the
  failing run was by far the slowest of the three (88.5 s against 38.2 s and 57.7 s). A
  per-worker registry path would remove it; that belongs to the route/registry surface.

---

## Work outside this surface (not touched)

At the time of writing, 22 paths in the working tree belong to two *other* workstreams and
were deliberately left unstaged, per the concurrent-commit hygiene rule:

- **Functional Domains tab** (session `535a2230`, which is wedged past its context window):
  `FunctionInteractionsTabs.tsx`, `EvidenceInspector.tsx`, `typography-tables.css`,
  `tools/function-track-geometry/*`, `shared/featurePalette.ts`.
- **Sequence density / AlphaGenome region** (no session log — edited outside DSH on 25 Sep
  between 11:25 and 12:06): `DensityTrack.tsx`, `SequenceRowGrid.tsx`, `GenomicSaturationHeatmap.tsx`,
  `SequenceVisualizer.tsx`, `AppViews.tsx`, `LandscapeMinimap.tsx`, `LandscapeInspector.tsx`,
  `useProteinSequence.ts`, `uniprotAccession.ts`, `alphagenomeRegion.ts`, `searchSlice.ts`,
  `sequence/types.ts`, and their tests.

Both workstreams have since landed on `main` (`f2ae4a7`, `0250f18`), with their own
verification. This resolution still does not verify them.
