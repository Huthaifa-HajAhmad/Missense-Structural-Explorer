# Gene–disease: validity classes and the Reference & methods panel

27 November 2026. Context only: no ACMG criterion, engine rule or provider request changed.

## Findings

| # | Severity | What was wrong | Evidence | Fix |
| --- | --- | --- | --- | --- |
| 1 | High (science) | "Supportive" was drawn as a rung between Limited and Moderate. | GenCC FAQ: Supportive is "a basic level of evidence … such as that used by OMIM and Orphanet", a resource that does not grade. `inheritanceBasis.ts` already excluded it from qualifying levels. | `src/shared/validityClasses.ts`: only Limited → Definitive are graded. Supportive, Animal model only and No known relationship are "not graded"; the table says so instead of drawing a rung. |
| 2 | Medium (science) | Disputed and Refuted were ranked as rungs below Limited, as if they were weaker evidence on the same axis. | They contest the relationship (GenCC FAQ definitions). | Grouped as "Contests"; the table shows "Contests the relationship". |
| 3 | Medium (science) | "Animal Model Only" was missing from the reference list. | GenCC FAQ lists nine terms. | Listed with its definition. |
| 4 | Low (copy) | The finding said "dispute or reject this relationship", and called it contested, for "No known disease relationship", which neither disputes nor rejects. | GenCC: no claim has ever been made. | "dispute, refute or report no known relationship"; "contested" is used only for Disputed or Refuted. |
| 5 | Low (UI) | The inspector showed the raw value `same-disease` / `unscoped` under "Selected disease scope". | `contextWorkspace.ts` | Uses the reader sentence (`DOSAGE_SCOPE_NOTE`, now shared with the table). |
| 6 | Low (copy) | Empty disease choice read "Not curated by the installed GenCC snapshot for this exact gene symbol…". | ABCG1 p.Gly358Arg | "GenCC lists no disease for ABCG1 in the installed snapshot. That does not show the gene has no disease relationship." |
| 7 | UX | Reference & methods was two long lists (8 + 6 rows) and four paragraphs. | Inspector panel | Two small interactive charts (`ReferenceScaleChart`): graded steps as a staircase, other classes as chips, one definition readout. This disease's classes and this gene's HI/TS codes are marked. A contesting class opens first, and each chart resets when the disease or its data changes. Definitions are short summaries that keep GenCC’s qualifiers for the top three grades. Scope is four short lines. |

Data flow checked: both reads are schema-validated at the client, identity-checked against the gene,
and a failed read is never shown as "not curated". No change was needed.

## Verification

- New tests: `src/shared/__tests__/validityClasses.test.ts`, dosage reference and finding-sentence tests in
  `geneDiseaseEvidence.test.ts`, the strength column, chart interaction and chart reset in `EvidenceContextTabs.test.tsx`.
  Colours and chart layout were checked on screenshots, not by tests.
- `npx vitest run`: 7295 passed, 8 skipped, 0 failed.
- `npm run lint` (boundaries, focus, parity, code map, oxlint, tsc): clean.
- Preview harness (`tools/evidence-preview`, Differing assertions) in light, dark and 820 px: no page errors, no overflow.

## Sources

- GenCC FAQ, classification terms and definitions: https://thegencc.org/faq/
- DiStefano MT et al. The Gene Curation Coalition: a global effort to harmonize gene–disease evidence resources. Genetics in Medicine, 2022 (not re-read here; the FAQ above is the source used).
- ClinGen Dosage Sensitivity curation (not re-read; see below): https://www.clinicalgenome.org/curation-activities/dosage-sensitivity/

## Not done

- The ClinGen dosage code wording was not re-read from the SOP PDF (the page could not be read); the
  labels are the ones the app already used, and the longer meanings in the chart are plain-language summaries.
