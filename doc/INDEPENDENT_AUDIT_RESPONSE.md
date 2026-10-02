# Response to the independent audit (2026-09-30, `main` @ `ddecd03`)

Every finding in `INDEPENDENT_AUDIT_REPORT.md` was checked against the code at this commit and, where it
rested on a published source, against the source itself (Crossref, PMC, ClinGen). Each was then fixed,
refuted with evidence, or turned into a recorded decision. **Nothing was applied on trust**: four of the
audit's claims were wrong, and applying them would have broken correct code or introduced wrong citations.

Verification after the changes: `tsc --noEmit` 0 errors; boundary, focus-indicator and verify-parity
checks pass; `vitest run` 229 files, **2,867 passed** (2,850 before), 0 failed; `npm run build` passes end
to end; `npm run verify:geometry` passes (header 61, function-track 107 assertions).

## Fixed

| Audit id | What was wrong | Change | Pinned by |
|---|---|---|---|
| A1 | PVS1 + 1 PM + 1 PP and PVS1 + ≥2 PP were demoted to Likely Pathogenic. Richards 2015 Table 5 Pathogenic (i)(c)/(d) makes them Pathogenic. | `acmgClassifier.ts` combining rule. PVS1 + 1 PP meets no Table 5 row and **stays VUS** (see "Audit claim not followed" below). | `src/shared/__tests__/acmgClassifier.test.ts`; a stale test that encoded the defect (`acmg.test.ts`) now expects Pathogenic |
| B1 | `"Conflicting … pathogenicity"` contains "pathogenic": it opened the conservative-weighting gate and could award PS1. | One reading, `src/shared/clinvarClassification.ts` (`classifyClinvar`), used by `criteria.ts`, `clinvar.ts` and `landscape-context.ts`. | `acmg.test.ts`, `clinvar.test.ts` |
| H1 | `computeTierGap` printed "…: ." when evidence conflicts, and the Insights card rendered an empty list. | Sentence explains the conflict; `InsightsScreen` shows it instead of an empty `<ul>`. | `insightsEvidence.test.ts` |
| J1 / H2 | `"N/A"` interpolated into the Gemini prompt; the prompt asked for hypotheses "based on peptide chain coordinates" while sending none. | `"not measured"`; prompt now says no coordinates are given. `NARRATIVE_PROMPT_SCHEMA_VERSION` 3 → 4 (the audit said v1 → v2; the constant was already 3). | existing prompt-grounding tests |
| Cache | A stored client bundle replays the verdict it was computed with, so A1/B1 would not reach recently viewed variants. | `variantCache.ts` `CACHE_VERSION` v4.1 → v4.2. | — |
| L1 | `express.static` answered `/` and `/index.html` from disk, so the shell arrived with no CSP nonce on its scripts. | `createSpaShellHandler` (in `spa-shell-cache.ts`) serves `/`, `/index.html` and the fallback; static mount sets `index: false`. | `spa-shell-cache.test.ts` (nonce at `/`, `/index.html`, deep link) |
| E1 | PM1/PVS1 re-read digits out of the variant string. | `ACMGEvidenceInput.residueIndex` is preferred when the caller has it; wired at the core fetcher and both orchestrator call sites. String parsing remains the fallback. | `acmg.test.ts` |
| E2 | UniParc returns 404 for an isoform accession (confirmed live: `P04637-2` 404, `P04637` 200), so the features result was never cached. | Isoform accessions skip UniParc and record `domainMatchesStatus: "unsupported"` (cacheable; InterPro is still reported as "not read"). Stripping the suffix was rejected: UniParc locations are canonical-sequence coordinates and would mis-locate domains on an isoform. | — |
| C2 | Variant header banded LOEUF at 0.35 / 1.0 while the Score thresholds tab uses gnomAD's 0.6. | Header reads `THRESHOLDS.loeuf`; verdicts are Strong LoF intolerance < 0.35, LoF constrained < 0.60, and "Not LoF constrained" ≥ 0.60 (it read "LoF tolerant" until 2026-10-02: a LOEUF above the cut shows no constraint, not that loss of function is tolerated). Missense Z below 2 reads "Not constrained" unless Z ≤ 0, which reads "Tolerant". NAE1 (0.94) reads "Not LoF constrained" in both places. | `VariantHeader.test.tsx` |
| F1 | P2Rank always ran `-c alphafold`. | `selectP2RankProfile`: `default` only when the file's own `EXPDTA` record declares X-ray diffraction; predicted models, NMR, EM and files with no record keep `alphafold`; `P2RANK_CONFIG_PROFILE` still overrides. Cache key includes the profile. | `pocket.test.ts` |
| D1 | `calculateAlphaGenomeAcmgStrength` was documented as a ClinGen SVI tiering. | Comments in the client and in `contracts.ts` now say it is an app-defined banding of the rank. The field keeps its name: it is part of persisted payloads and is read by the heatmap and by many tests; the engine never counts it. | existing `acmg.test.ts` AVI cases |
| LOW-C1 | AlphaMissense test title quoted obsolete 0.983 / 0.063. | Title now states Bergquist 2025 (0.792 / 0.169). | — |
| LOW-C2 | Unread `THRESHOLDS.bayesdel` (0.133 / −0.0404). | Removed; bands live in `calibration.ts`. | `tsc`, full suite |
| LOW-G1 | `queryOpenBind`, `THRESHOLDS.openBind` and `JapanFoldBindingResult` had no production caller. | Removed with their test. | `tsc`, full suite |
| LOW-I1 | Report HTML had no wrapping for long tokens. | `overflow-wrap:anywhere` on `td, th, dd, p, li`; `dd{min-width:0}`. | — |
| M / Windows | `vite build` and the function-track harness failed with `remove …\Temp\esbuild-…: Access is denied`. **Reproduced here**, and reproduced as fixed by moving the temp directory. | `scripts/with-local-tmp.mjs` points `TEMP`/`TMP` at `node_modules/.cache/tmp` **on Windows only**; used by `build:client` and both geometry harnesses. Docker/CI are unchanged. | `npm run build`, `npm run verify:geometry` |
| J1 (labels) | The capabilities endpoint and two settings strings named a fixed "650M" SaProt while 35M can serve. | Unsized "SaProt", as `PERTURBATION_REVIEW.md` #18 already decided. | `tsc`, full suite |

### Found while verifying (not in the audit)

The audit's citation finding sent me to check every DOI in `src/` and `server/` against Crossref by
**resolved title**, not just by HTTP status. Three more were wrong and are fixed:

- **BayesDel** (`attributions.ts`): `10.1002/humu.24155` resolves to a *MAPK7 scoliosis* paper and the
  cited "Feng 2021, Hum Mutat 42:725" does not exist. Now Feng 2017 (PERCH, which introduced BayesDel),
  `10.1002/humu.23158`, matching `MetricExplanations.ts`.
- **GPN-Star** (`attributions.ts`, `MetricExplanations.ts`): `10.1101/2024.11.08.622668` is an *RTF1 / Th17*
  paper. Now Ye, Benegas et al. 2025, `10.1101/2025.09.21.677619`.
- **MetaRNN** and **ClinPred**: `10.1186/s13073-022-01069-0` and `10.1016/j.ajhg.2018.07.028` do not
  exist. Now `10.1186/s13073-022-01120-z` and `10.1016/j.ajhg.2018.08.005`.

All other DOIs resolve to the paper they are cited as. The retired-DOI list in `methodCitations.test.ts`
already guards earlier mistakes of this kind.

## Audit claims refuted

| Audit id | Claim | What the evidence says |
|---|---|---|
| **N1** | Abou Tayoun 2018, Tavtigian 2020 and Zhou 2023 DOIs are wrong; use `humu.23650`, `humu.24020`, `gkad246`. | The repo's DOIs (`humu.23626`, `humu.24088`, `gkad472`) resolve to exactly those papers. The audit's "corrections" resolve to the ***CDH1* specifications**, ***dbMTS***, and an **HMCES DNA-adduct** paper. The audit's "wrong" DOIs (`humu.23617`, `humu.23984`, `gkad459`) are not in the repo. **No change.** |
| **C1 (REVEL)** | REVEL `bp4.VeryStrong` 0.003 is unsourced; remove it. | Pejaver 2022 Table 2 (PMC9748256), REVEL row: `≤0.003 | (0.003, 0.016] | (0.016, 0.183] | (0.183, 0.290]`. The Very Strong band is published; REVEL is one of two tools that reach it. The audit attributed REVEL to Bergquist 2025, which does not calibrate it. **No change.** |
| **C1 (ESM-1b)** | Add a Benign Strong band at ≥ −8.8. | Bergquist 2025 calibrates benign evidence up to **Moderate** for ESM1b; a Strong band at ≥ −8.8 would also be *less* benign than the existing Supporting band at ≥ −6.3, so it is internally impossible. **No change.** |
| **J1 ("SaProt 650M AF2" banned)** | Banned in PR #5 for "SaProt 650M (structure-aware)". | No guard test, doc or commit in the repo bans it, and `SettingsDrawer.tsx:86` / `ConnectionsSection.tsx:190` never contained "AF2". `westlake-repl/SaProt_650M_AF2` is the real checkpoint name and the registry labels follow the engine that served. Only the places that named a size without knowing the engine were changed (above). |
| **A2 (framing)** | The PP3 + PM1 ≤ Strong cap "regressed". | It was never active by design: the vote block states PP3 is emitted at Supporting only (1 point), so 1 + 2 = 3 cannot exceed Strong (4). `assessPm1` is correct and tested at every strength. The defect was that nothing said so; `criteria.ts` now says it, and a test pins the dormancy so enabling calibrated PP3 strength cannot bypass the cap. Enabling it is decision D2. |
| **Cross-tab matrix** | GZF1 p.Arg591Trp is "Likely Pathogenic (PM2, PP2, PP3)". | `1 PM + 2 PP` meets no Table 5 row (LP (v) is 2 PM + ≥2 PP), and the engine returns VUS for it, before and after this work. The matrix's BRCA1 row lists `PP3_Strong`, which the engine cannot emit (it votes bare `PP3`); the rows were not reproduced from a run, so treat the matrix as unverified. |
| **Sept 15 / "v1 → v2"** | PM2 SVI approved 15 Sept 2020; narrative schema `v1`. | The ClinGen document is dated **4 Sept 2020**; the schema constant was already 3. Cosmetic, but the dates should not be copied forward. |

## Audit claim not followed exactly

**A1 negative control.** The audit says `PVS1 + 1 PP` "must remain Likely Pathogenic". Under Richards 2015
Table 5 it is neither Pathogenic nor Likely Pathogenic (LP (i) is PVS1 + **1 Moderate**); the engine has
always returned VUS for it and still does. The ClinGen SVI PM2 recommendation *proposes* a new rule making
PVS1 + 1 Supporting Likely Pathogenic. That rule is part of decision D1 below, not of a Richards-faithful
engine, so it was not introduced silently.

## Decisions (resolved in the follow-up PR)

Both were closed in `feat/pm2-supporting-and-svi-pvs1-rule`: **D1 adopted** (PM2 at Supporting plus the SVI PVS1 + Supporting rule; measured effect and
canary changes in `REPORT_TAB_REVIEW.md`, "Resolution") and **D2 decided as "keep"** (the engine continues to emit bare Supporting PP3, so the PP3 + PM1
cap stays dormant; the dormancy is pinned by a test). The original text of each decision follows.

**D1 — PM2 strength (audit HIGH-A1; `REPORT_TAB_REVIEW.md` decision record).** *Verified now*: ClinGen SVI
Recommendation for PM2, Version 1.0 (approved September 2020), reduces PM2 from Moderate to **Supporting**
(`PM2_Supporting`). The engine still applies Richards 2015 Moderate. Adopting it re-tiers **110 of 2,048**
criterion combinations, all toward less pathogenic (e.g. PVS1 + PM2: Likely Pathogenic → VUS under
Richards' table; PVS1 + PM1 + PM2: Pathogenic → Likely Pathogenic). For the reference variants: NAE1 is
unchanged (PM2 + PP3 is VUS either way); the audit's claim that GZF1 drops from Likely Pathogenic to VUS is
**not** right (it is VUS today, see above). Recommendation: adopt `PM2_Supporting` together with the SVI's
PVS1 + 1 Supporting → Likely Pathogenic rule, in one PR that also updates the Guidelines tab and every
surface that prints "Moderate" for PM2, and that carries a release note because verdicts change. It was not
done here because it changes clinical output and the owner's own record says it needs its own PR.

**D2 — Calibrated PP3 strength in the engine (audit CRITICAL-A2).** Keep bare Supporting PP3 (current,
conservative, cap dormant by design) or emit `PP3_Moderate`/`PP3_Strong` from the single calibrated
reference tool. If D2 is "emit", the cap in `assessPm1` then binds and is already tested.

## Left as documented, deliberately

- **Word / PowerPoint export (7.8)** remains "not built yet" in the UI; nothing to grade.
- **`acmgStrength` wire field (D1 of the audit)** keeps its name for payload compatibility; a rename is a
  contract migration and is worth doing only with a payload version bump.
- **Terminal tier in `computeTierGap`** still returns `null` (nothing to reach); both surfaces already
  omit the section, and the verdict above it says the tier.
