# Gene–disease tab review (2026-10-07)

Audit of the Gene–disease evidence tab and its Evidence Lineage inspector against the reference
tabs (Population Data, Predictors), followed by the rebuild. Context only: no ACMG criterion is
added or changed (owner decision, unchanged).

## Findings and what was done

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | **GenCC "not installed" on any other checkout, worktree or fresh deployment.** The snapshot is a gitignored manual import (`data/`), so the tab's main purpose (disease validity) was silently empty. | `server/services/evidence-context/snapshotInstall.ts`: a MISSING GenCC / G2P snapshot is fetched once on first request (single flight, full validation, atomic write, 15-minute failure back-off). Never refreshes an installed snapshot (no scheduled mutation). Off under test and with `EVIDENCE_CONTEXT_AUTO_INSTALL=0`. `npm run data:gencc` / `data:g2p` still work. Verified end to end from a fresh worktree with no `data/`: GenCC (4 SOD1 frames) and G2P installed in ~22 s. |
| 2 | High | ClinGen **score 0 was labelled "No evidence"** and drawn as a filled accent rung. ClinGen's term is "No evidence available"; it is not a finding that copy-number change is tolerated (that is 40). | Label corrected, zero rung drawn muted, explicit note in the table and inspector. |
| 3 | Medium | "No Known Disease Relationship" (256 GenCC assertions) was neither flagged nor placed on the scale; the dispute notice only covered Disputed / Refuted. | One `ADVERSE_LEVEL` rule shared by the tone, the finding and the scale; the scale gains GenCC's lowest category. |
| 4 | Medium | The finding did not lead with dispute, and a disabled empty selector was the first thing on the tab when GenCC was missing. | Hero finding with a verdict chip (`Disputed, refuted or no known relationship` leads, supportive rows stay visible). With nothing to choose the picker is a one-line statement. |
| 5 | Medium | ClinGen dosage and Gene2Phenotype mechanism were never compared (external audit §1.1 B). | `compareMechanism`: descriptive, bound to the exact disease and inheritance, refuses undetermined / mixed / unscored cases, says "neither source is overridden", no ACMG vote. |
| 6 | Medium | No snapshot age signal. | Flag after 60 days (GenCC) / 90 days (G2P). Local policy, stated as such: GenCC states its download is "updated weekly" (thegencc.org/download); G2P publishes no cadence. A flag never hides or re-weights evidence. ClinGen dosage is live (24 h cache) and never ages. |
| 7 | Low | GenCC `release` was always "not reported". | The export's own `Last-Modified` date is recorded ("Export of 2026-10-04"). ClinGen dosage is shown as a rolling table with per-gene dates instead of "Release not reported". |
| 8 | Low | Inspector said "No disease selected" when GenCC was unavailable; its Source link pointed at the raw 2 MB API JSON; it was the shared expression rail with dosage branches. | New `GeneDiseaseRail` renders the same model as a numbered trace (engine record last), the GenCC and ClinGen scales with this review's position marked, method notes and sources, plus a link to the ClinGen curation page. The expression rail is unchanged. |
| 9 | Low | ClinGen submits through expert panels (GCEPs) but looked like any other submitter. | "Expert panel curation" caption; no re-ranking. |

## Independent review, round 1 (Gemini 3.8 Flash High) and responses

| Finding | Response |
|---|---|
| HI 0 / 1 compared against G2P ("agree" with gain of function, "differ" from loss of function) treats absence of evidence as evidence | **Fixed.** Only 2, 3 (established) and 40 (unlikely) are compared; 0 and 1 are "not comparable: absence of evidence". Test rewritten. |
| "Submitters agree" with one submitter; "1 submitters" | **Fixed.** "Single submitter: X"; singular headline. |
| Code 30 described as "no scored call" | **Fixed.** Explained as ClinGen's recessive-phenotype category. |
| Loading flashed "not available here" | **Fixed.** Own `loading` verdict. |
| `scope="colgroup"` on group rows | **Fixed** (`rowgroup`). |
| No tests for the rail or G2P auto-install | **Added.** |
| Future `retrievedAt` shows "today"; PID temp-file collisions; G2P read coalescing | **Declined.** The server writes the timestamp itself; installs of one target are single-flight in-process; G2P parses once per file change. |

## Verified as sound

- Dosage codes 30 and 40 are special categories, never compared numerically; absence
  (not yet evaluated / not reported / no record) stays distinct from score 0.
- Disease matching is by exact MONDO ID; the G2P allelic mapping is the existing local one.
- Live ClinGen row for SOD1: haploinsufficiency 0, triplosensitivity 0, evaluated 2026-08-11.

## Architecture

`src/shared/geneDiseaseEvidence.ts` (pure model, invariants and replaced defects in its header),
`src/shared/snapshotAge.ts`; tab = `GeneDiseaseTab` (hero + one grouped readings table in
`GeneDiseaseReadings`, then the mechanism and ClinVar locus cards); rail = `GeneDiseaseRail`.
Styles: `src/styles/gene-disease.css` (`gd-` prefix, tokens only). `DosageSensitivityCard` was
replaced by the readings table rows.

## Not done / follow-ups

- ClinGen dosage is matched to the gene by exact symbol. An alias or renamed symbol shows "no
  result"; matching by HGNC ID needs the HGNC ID threaded from the analysis.
- G2P mechanism for a disease is compared only to ClinGen haploinsufficiency; triplosensitivity
  has no G2P counterpart.
- Mechanism and ClinVar locus remain `ctx-*` cards (secondary panels), not yet the `gd-` standard.

## Sources

- GenCC: DiStefano et al. 2022, PMID 35612544; download page
  https://thegencc.org/download ("updated weekly").
- ClinGen dosage: Riggs et al. 2020, PMID 31690835; scores 0–3, 30, 40.
- Gene2Phenotype: Thormann et al. 2019, PMID 31097695.
# 10 October 2026 workspace follow-up

The assertion comparison, linked inspector, corrected frame counts and dosage/mechanism
interpretation are documented in [Context workspaces review](CONTEXT_WORKSPACES_REVIEW.md).
The prior review below remains the record of the original scientific model.
