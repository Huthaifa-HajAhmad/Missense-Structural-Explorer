# Energetics and Landscape audit — 2026-10-27

Reference variant: UROD p.Gly318Arg (NM_000374.5, GRCh38 1-45015346-G-A, P06132), as on the
production screenshots. The run in those screenshots used template 1R3S:A (X-ray, 1.65 Å), which
carries D86G; mutating engines now use the AlphaFold model instead.

## Fixed in this pass

| # | Severity | Where | Defect | Evidence | Fix |
|---|----------|-------|--------|----------|-----|
| 1 | High (integrity) | `server/services/stability/foldx/pdb-utils.ts` `detectBFactorProvenance`, `estimate.ts` `isAlphaFoldModel` | Crystal structures were classed as AlphaFold models. Any `AF-` substring, or B-factors all ≤ 100 plus the word "MODEL" anywhere (REMARK 3 always has it), was enough. FoldX then **skipped RepairPDB on X-ray templates**, and the tab said "Not repaired (pLDDT in B-factors)". | 1R3S, 1SPD, 2C9V (SOD1), 4HHB → `alphafold`. Prod job `20fff15e…`: `foldxRepairSkippedReason: "alphafold-plddt"` on 1R3S. | An `EXPDTA` record decides first. AlphaFold requires `ALPHAFOLD`, a real `AF-<acc>-F<n>` accession, `COMPL_MODEL` or a pLDDT remark. The B-factor-range guess is removed. All five crystals now read `experimental`; the real AF-P06132-F1 file still reads `alphafold`. Cached results expire within 24 h (FoldX cache TTL). |
| 2 | High (delivery) | `src/hooks/useAppEffects.ts` URL restore | Landing on `/?gene=…&variant=…` painted the sessionStorage bundle and returned without the backfill rule the orchestrator applies. A bundle saved before FoldX returned therefore kept "No value" for FoldX indefinitely. | Prod FoldX for G318R **succeeded** on 26 Oct (−1.75 kcal/mol, 5 runs, 216 s on 2-core Box64). 27 Oct 16:54 UTC: URL landing, no `GENERATE_MUTANT` call. | The shortcut paints only when `shouldRunBiophysics` says the bundle is settled. Otherwise it runs the orchestrator, which paints the same cache and backfills (server cache hit, 15 min cooldown). |
| 3 | Medium (UX/integrity) | `src/shared/workflowStatus.ts` | The Analysis monitor printed the first engine with a value as "ΔΔG = +0.53 kcal/mol · Available" — DynaMut2's number, unnamed — and marked the stage complete with FoldX missing. | Third screenshot. | FoldX's own value is named when present ("FoldX ΔΔG = …"). Otherwise the monitor prints the counted median with its engine count ("Median ΔΔG = −0.11 kcal/mol (5 engines)"), and a FoldX that settled without a value degrades the stage: "FoldX: no result". |
| 4 | Medium (integrity) | `landscape-aggregate.ts`, `landscapeEvidence.ts`, `contracts.ts` | The Landscape flagged "pipeline and dbNSFP disagree … numbering or a stale cache" and withheld the rank on G318R. Both numbers were right: Gly→Arg is reachable by two SNVs. The table kept the max REVEL; the pipeline reported the queried SNV. | myvariant.info: chr1:45481018 G>A REVEL 0.229 (queried), G>C 0.233. | Each substitution carries `revelSnvs` (every SNV's REVEL). The cross-check accepts any of them and names all of them when none matches. Landscape cache schema bumped to v7. |

Tests: new cases for crystal/NMR/EM detection, the `AF-` accession, the UROD REVEL pair, the
"mostly no destabilization" majority and its contradiction guard (plus the mirrored destabilizing /
moderate wordings), the mutant-template refusal including the memo-key separation, the gate's accept
path and its fail-closed "unverified" path, the Tier-3 re-admission guard, the SEQADV parser, the
structure-header round-trip, the pipeline whitelist that now carries the disclosure (the blocker the
review found), the ThermoMPNN backfill, the Landscape fallback switch, and the structure disclosures.
`tsc` and `npm run lint` are clean; the e2e smoke and navigation suites pass. Full vitest: 5667
passed, 5 skipped; the one failure in the full run was `admission.test.ts`'s peak-RSS telemetry under
load, which passes 13/13 in isolation (the same load-timing class as the earlier documented flakes).
A live resolver check on P06132/318 refused 1R3S ("D86G (engineered mutation)") and returned the
AF-P06132-F1 v6 model.

## FoldX "failure" — root cause

There was no FoldX failure. The production job completed (ΔΔG −1.7527 ± 0.0985, raw −1.81…−1.60).
The browser never committed it: the tab's bundle was saved while FoldX was still running (rasp,
ThermoMPNN, StabilityOracle and ProtVar arrive early as `engineUpdates`; DynaMut2/DDMut through
their own pollers). The persistence effect in `useBiophysicalModeling` stores `foldingEnergetics`
on every change. On revisit, the URL restore painted that partial bundle and never asked the server
again (fix 2). With FoldX absent, the counted set changed from {FoldX, RaSP, ThermoMPNN,
StabilityOracle} (server: "No destabilization predicted", median −0.98) to {DynaMut2, DDMut, RaSP,
ThermoMPNN, StabilityOracle} (screen: "Engines disagree", median −0.11). The verdict on screen was
therefore an artefact.

Two compounding template issues, both in the FoldX run itself:
- RepairPDB was skipped because of fix 1. The re-run happens on the AlphaFold model, which the
  runner deliberately never repairs (pLDDT in the B-factors), so the value moves because of the
  template and stays unrepaired — the tab's `unrepaired-template` caveat is the honest marker of that.
- **1R3S is the D86G mutant** (`COMPND MUTATION: YES`, title "single mutant D86G"). The "wild
  type" FoldX models is not wild type. Fixed: a mutating engine now asks the resolver for a
  wild-type chain (`requireWildType`), the D86G chain is refused, and the run uses the AlphaFold
  model. The Energetics structure tile and the rail name the refused entry and its differences
  ("1R3S:A was not used: D86G — not the wild type") and link the AlphaFold DB entry it used.

## Can myvariant.info leave the Landscape?

On production it already has: the container made zero `[Landscape]` (myvariant-path) log lines in
10 h, while every window was served by the local 19 GB dbNSFP 5.4a store (`ENABLE_LOCAL_DBNSFP=true`).
myvariant is reached only when (a) the store is absent — dev and CI, by the settled decision that
the store lives on the VM only — or (b) a local window covers < 20 % of residues (partial ingest).
Removing it would leave dev and CI with an empty Landscape and drop the remote fallback for a
sparse window. It is now an explicit switch: `LANDSCAPE_REMOTE_FALLBACK=off` makes an uncovered
window an empty answer with the `remote-fallback-off` caution, instead of silently switching release
(myvariant serves 4.x; the store is 5.4a, and the AlphaMissense values differ across those). The
default stays on for dev and CI; production should set it off in `deploy/.env.oci`.

## Resolved in this pass (was: open findings)

| ID | Area | Was | Now |
|----|------|-----|-----|
| F1 | Science | Template 1R3S carries D86G; FoldX mutated a mutant. | `resolveStructure(..., { requireWildType: true })` in the generate-mutant route refuses a non-wild-type experimental chain and uses AlphaFold; `excludedExperimental` / `sequenceDifferences` travel in provenance and are shown with an AlphaFold DB link. |
| F2 | Logic | "Engines disagree" fired when 1 of 5 engines was past its moderate mark (DynaMut2 +0.53 vs +0.5) and 4 were neutral. | A two-thirds majority with adjacent-band exceptions is now "Mostly no destabilization" (and the mirrored "Mostly moderately destabilizing" / "Mostly destabilizing"); the summary names the exception and its value. A two-band contradiction (neutral vs high) still reads "Engines disagree". |
| F3 | Consistency | The monitor named one engine; the tab headlines the median. | FoldX's own value is still named when present; otherwise the monitor prints "Median ΔΔG = … (N engines)". |
| F4 | Data flow | `foldingDdG`/`foldingStatus` existed as local state and in the store. | Local copies removed from `useBiophysicalModeling`; the store is the only source. |
| F5 | Dead code | `fetchLandscapeData` had no caller. | Deleted. The `services/landscape.ts` facade stays: `services/external.ts` re-exports it and the integration barrel depends on it. |
| F6 | Loading | ThermoMPNN's late value was never written back, so a cache hit kept `thermompnn: null` and re-submitted the job. | The poll route backfills `thermompnn` into the FoldX cache entry, like DynaMut2 and DDMut. |
| F7 | Delivery | Old session bundles lack `revelSnvs`. | Unchanged, as noted: the single kept value is the fallback until the bundle refreshes. |
| F8 | UX | "No point plotted" and "No value: FoldX" gave no state or reason. | Both print the engine state and `absenceText` reason. |
| F9 | UX | The Landscape caution and the rail repeated the full disagreement paragraph. | The tab keeps the full text; the rail shows one line (full text on hover). |

## Senior review pass (2026-10-28) — fixes applied after a three-way code review

The change set was then reviewed by three independent reviewers (server, client/shared,
cross-cutting integrity). Their findings, all verified against the code, and their fixes:

| Severity | Finding | Fix |
|----------|---------|-----|
| Blocker | The client pipeline's `applyEnergetics` whitelist (`src/services/pipeline/foldxService.ts`) rebuilt `structureProvenance` without `excludedExperimental` / `sequenceDifferences`, so the F1 disclosure never reached the screen through the real pipeline — only through hand-built test fixtures. | Both fields added to the whitelist, and a pipeline-level test now drives `executeFoldxPipeline` with a server payload carrying them. |
| Major | Tier 3 could re-admit the refused mutant crystal when AlphaFold was unavailable: the homolog search returns the same entry (≈100% identity) and nothing refused it — with a provenance record claiming it was refused. | The Tier-3 loop skips the excluded entry when `requireWildType` is set. |
| Major | The speculative pre-warm fetched the raw Tier-1 mapping directly, so it still computed FoldX on the mutant crystal — and its cache key (1R3S hash) could never match the reader's (AlphaFold hash), wasting a full run per cycle. | The pre-warm resolves through `resolveStructure(..., { requireWildType: true })` like the reader. |
| Major | `isAlphaFoldModel` still matched a bare `ALPHAFOLD` substring, so a crystal whose REMARK 3 cites AlphaFold for molecular replacement skipped RepairPDB again. | An `EXPDTA` record decides first (verified: real AlphaFold DB files carry none). |
| Major | The rail hard-coded "so this run used the AlphaFold model", false when the replacement is a Tier-3 homolog. | The replacement is worded from the structure record. |
| Major | `chainDifferences` failed open (sequence unavailable ⇒ "wild type", silently). | The check fails closed: a mutating engine refuses the chain with `unverified: true`, and the screen says "could not be checked against UniProt", never "is not the wild type". |
| Minor | The `mostly-*` / unanimity summaries said "engines that returned a value" while using the counted count, contradicting the coverage sentence beside them when a value was returned but excluded. | All branches now say "counted engines"; the single-engine form says "the only counted engine". |
| Minor | The `mostly-*` comparison findings lacked the "other results are still being collected" tail; a whitespace-only `uniprotId` built a broken AlphaFold link; the differences header had no size cap; the fallback path dropped `afdbVersion`; private FoldX cache entries could not receive the ThermoMPNN backfill; `LANDSCAPE_REMOTE_FALLBACK` rejected `no`/`n`. | All fixed (header capped at 20 + "+N more"; the backfill reads through a dedicated `getMutantFromCacheForBackfill` that bypasses only the sharing gate, never a reader). |
