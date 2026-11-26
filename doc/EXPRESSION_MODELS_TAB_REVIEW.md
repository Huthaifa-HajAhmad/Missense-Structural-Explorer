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

## Third audit: the tab answer, pext wording and the review row (2026-11-26)

Reference variant: ABCG1 p.Gly358Arg (ENST00000361802, GRCh38 21-42287987-G-A). Checked against the gnomAD
pext help text (`browser/help/topics/pext.md` in broadinstitute/gnomad-browser) and the live gnomAD v4 and
Ensembl records for ABCG1.

| Severity | Finding | Fix |
| --- | --- | --- |
| High | Pext was described as "a maximum over transcripts" (card foot, rail method, `shared/pext.ts`). gnomAD defines base-level pext as the **sum** of the expression of every transcript that touches the base, divided by gene expression; it is a maximum only in the sense of an upper bound for any one annotation. | All three now say "sum", and the card names the upper-bound consequence. |
| High | HPA's protein row read "Evidence at protein level" over "Tissue pattern: Not detected", which looks like a contradiction. The first is HPA's protein-existence level, the second the antibody-staining (IHC) result. | Two rows: "Protein existence" and "Protein in tissues", each with what it measures. The fact line says "protein existence: …". |
| Medium | "Variant in region 16 of 23" did not say what a region is. ABCG1 has 23 pext regions and 15 MANE coding exons: regions cover the coding bases of every transcript (regions 1, 2, 4, 6–8 belong to other transcripts) and an exon splits where pext changes (MANE exon 9 = regions 16 and 17; region 17 has pext 0.34). | The card says a region is not an exon and why, and lists the variant's position, coding region and mean pext as label/value rows. |
| Medium | The Tissue explorer, the main view, had no answer. | `ExpressionAnswer` opens the view: source, headline, detail (the rail's "Reading" step renders the same `expressionWorkspaceFinding`), per-system coverage, and a four-source strip. Shown once: not repeated on Sampling & coverage. |
| Medium | Pext tissue labels missed GTEx names whose ids differ in punctuation ("Cells ebv transformed lymphocytes"). | `pextTissueKey` normalises both ids. |
| Low | The source-fact strip built its pext note in the component with nested conditions. | `buildSourceFacts` takes the pext location and region count and writes the note itself. |
| Low | Layout: the Adult/Pediatric switch took its own row; "Change review systems" sat in a second row under the review row; the review box repeated its heading and folded twice; the rail folded its trace and method behind disclosures and repeated the ACMG boundary sentence; the closing guide was a fold. | Switch opens the search row; the shortcut sits in the review row (hidden where it would force a second line); embedded review frame with field hints; rail trace and method shown flat, boundary stated once (trace step 5); closing guide is a plain note. |

No ACMG rule, criterion or score changed: expression stays context only.

Not done: the provenance rows in the rail still expand to show release, terms and fingerprint (a record, not prose).
The pext map has no exon numbers of the run's transcript; showing them needs the transcript's exon coordinates in the payload.

### Review follow-up

- Flat selected-reading notes apply only to Expression; other evidence inspectors keep their disclosure.
- A missing gene locus is stated explicitly in the pext source strip, including while loading.
- Standalone rendering hides the systems shortcut when it has no review disclosure to open.
- The review action uses a wrapping flex row without a reserved pixel width.
- The tab reuses its adult finding for the shared summary. Removed unused hero styles and the Expression design-check exception.
- Direct component tests cover the four-source summary, onset limit, and review action; existing pext tests cover the location definition list.
