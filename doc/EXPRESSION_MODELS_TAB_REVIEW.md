# Expression & models tab — review and rebuild (2026-10-07)

Audited against the Gene–disease tab, the rail (`EvidenceContextRail`) and the shared context hook, then rebuilt.
Verification: `tsc`, `npm run lint`, full vitest (4127 passed), tab and rail rendered with the SOD1 p.Ala5Val fixture at 1300px and 820px.

## Defects fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | **Residue in orthologs never worked on a real payload.** `metadata.wildType/mutant` are three-letter (`Ala`, `variant-parser.ts`); the alignment walk compares one-letter residues, so every row was "Reference differs". The unit test used `'C'`, which hid it. | Tab resolves the pair with `resolveResidueShiftModel`; card shows `Ala5Val`. Regression test uses `Cys`/`Gln`. |
| 2 | Medium | The rail traced only GTEx, Alliance, IMPC and dGTEx. Protein Atlas, pext, Ensembl, HPO and model phenotypes had no provenance. | Rail lists every source's state ("Sources read") and every provenance record. |
| 3 | Medium | Rail printed "no validity-source manifest" on Expression (a GenCC concern). | Gene–disease keeps it; Expression no longer shows it. |
| 4 | Medium | Pext tissue names differed from the GTEx table. | Pext uses the GTEx label through the tissue id. |
| 5 | Medium | Alliance (orthology and phenotypes) showed "Release not reported". | `allianceRelease.ts` reads `/api/releaseInfo` (best effort, cached; a failed lookup stays "not reported" and never fails the read). IMPC and HPA expose no release, so they still say so. |
| 6 | Low | Pext "top 8" of tied values is arbitrary. | A uniform region is stated in one sentence. |
| 7 | Low | Stretched buttons, developer wording, "1 coding regions". | Fixed. |

## Rebuild

- **`shared/expressionTabEvidence.ts`**: one pure model for the tab and rail. The tab's question is coverage, not an ACMG criterion, so the finding is the highest measured median in the reviewer's systems with its rank among sampled tissues, per-system coverage, and what GTEx does not sample. No expression cut-point exists; nothing is called expressed or not. A gap is a coverage limit, a zero median is a measurement.
- **Review frame**: disease, onset and systems in one compact card (was two cards and a details block).
- **Finding hero** with a coverage strip (one cell per system) and four source facts (adult, pediatric, Protein Atlas, at the variant), each stating its state.
- **Rail**: numbered review trace ending in the interpretation boundary; "Sources read"; method disclosures including what each selected system covers; one closed disclosure per source for provenance.
- "Not covered yet" kept.

## Not done

- The cards below the hero still use the `ctx-*` row grammar (already flat rows, tinted head/foot bars), not Population's `pop-*` classes.
- Gene–disease keeps its card-shaped disease picker; the inline form is used only on Expression.
- IMPC and HPA releases are not exposed by their endpoints.
# 10 October 2026 workspace follow-up

Expression and Species & models are now separate workspaces. The shared context, interactive
RNA comparison, alignment/phenotype exploration and corrected missing-measurement states are
documented in [Context workspaces review](CONTEXT_WORKSPACES_REVIEW.md).
