# Literature tab review

The 2026-10-11 second pass is documented in [Insights and Literature workspaces](./REVIEW_WORKSPACES_REVIEW.md): loaded-text coverage figure, bounded Reading desk, Source records, persistent source inspection and accurate clipboard feedback. Pagination and the newer screening model are described in `LITERATURE_SCREENING_REVIEW.md`.

Reference variant: **NAE1 p.Asp116Gly** (Q13564). Checked against Europe PMC on 2026-09-30.

The tab was audited and rebuilt to the standard of Population Data and Predictors (true → traceable → legible → beautiful).
Literature is not an ACMG input — the rule engine reads none — so there is no engine decision here and nothing in
the verdict changes. The work is about what the tab claims and whether a reader can check it.

## What the reference variant shows now

| Reading | Value | How it was obtained |
|---|---|---|
| Gene-wide records (`NAE1 AND (mutation OR variant OR functional OR "pathogenic")`) | **747** | Europe PMC REST, the query the server sent |
| Records naming p.Asp116Gly (`NAE1 AND ("p.Asp116Gly" OR "Asp116Gly" OR "D116G" OR "p.D116G")`) | **0** | Same service, background probe |
| Of the first 25 gene-wide records, those with NAE1 in neither title nor abstract | **14** | Literal match; every one is an open-access full-text match |

So the honest answer for this variant is "Europe PMC holds no record that names it", and more than half of the
gene-wide page was not about NAE1 in any way the abstract shows. The old tab showed 25 papers newest-first, among them a
fish gene-editing review and a SARS-CoV-2 paper, with no indication of either fact.

## Findings

| # | Severity | What was wrong | Fix |
|---|---|---|---|
| 1 | High | **The query shown was not the query that ran.** The rail pre-filled `(NAE1[Gene]) AND ("missense"… OR p.Asp116Gly)` under "Search query string", labelled "Live In-App Citation Feed". The list came from `NAE1 AND (mutation OR variant OR functional OR "pathogenic")`. | The route returns `europePmcQuery`, the string actually sent. The rail's trace prints it verbatim; the query box is labelled "Suggested query — not run yet" until something is applied. |
| 2 | High | **Records matched on full text were listed as gene literature.** Europe PMC searches open-access full text, so a record can match with the gene nowhere in its abstract (14 of 25 for NAE1). | Each row is classed by a literal check of title and abstract: names the variant / names only the gene / gene not in abstract. Filterable, sorted in that order, and explained in the trace. |
| 3 | High | **Variant-specific literature was never asked for**, so "nothing found" and "never searched" looked identical. | A background search for the variant's notations (`p.Asp116Gly`, `Asp116Gly`, `D116G`, `p.D116G`) answers the headline; a scope control switches the list to it. A failed probe is a fault, never a zero. |
| 4 | Medium | **An upstream failure was invisible.** When Europe PMC did not answer, the server served the gene's cached rows and the client could only guess from a null hit count. | The response carries `degraded`; the tab and rail raise an amber statement and withhold the hit count. |
| 5 | Medium | Ordering unexplained: the page is Europe PMC's default ranking, then re-sorted newest-first by the store. | Stated in the trace and the card foot. Verified that the default order is not date order (years interleave; `sort=P_PDATE_D desc` returns a different set of ids). |
| 6 | Medium | Nothing said what reads this list. The AI summary reads **up to 5 abstracts from the gene-wide set**, ranked by embedding similarity; searches run here store unscorable vectors and do not reach it. | Rail section "What reads this list": ACMG engine — nothing; AI summary — as above; Report — only pinned papers. |
| 7 | Medium | Three controls ran the identical forced search ("Sync Europe PMC", "Search Europe PMC", and the rail's own). | One search (Enter / the button) plus a scope control; the rail edits and applies. |
| 8 | Medium | "Add to report" was hidden inside the expanded abstract; the row's only control was a chevron. | Pin is a row control (`aria-pressed`, 28px target). |
| 9 | Low | Off-system styling: Tailwind `rose-*`/`emerald-*`, `animate-spin` as a status, serif titles, 9–10px text, dashed-border empty states, hard-coded white. | Tokens only, the house type ramp, amber for a fault, empty states as statements. |
| 10 | Low | Three `focus:outline-none` suppressions. | Every control draws the clay ring; `server/tests/focus-indicators.test.ts` sanity floor lowered 9 → 6 accordingly. |

## Decision: no journal metrics

The screenshot this redesign started from shows "IF 3.2 · Q1"-style badges beside journal names. **They are not
from this app.** No impact-factor or quartile code exists anywhere in the repository, its history, or the built
bundle; they are injected by a browser extension. They are deliberately not added: no sourced, licensed journal
metric exists in the stack, a per-journal number says nothing about a paper's finding, and an unsourced figure beside
a clinical citation is exactly the kind of claim this review exists to remove. A test
(`LiteratureView.test.tsx`) keeps `impactFactor`/`journalRank`/`quartile` out of the Literature sources.

## What changed

- **Model** `src/shared/literatureEvidence.ts` — pure; the tab and rail both render it. Variant notation parsing,
  the literal mention check (with the quoted sentence), highlighting, identifier and link resolution, local narrowing,
  the finding, the fact strip and the five-step trace. Invariants are in the module header.
- **Server** `server/routes/variant/literature.ts` — adds `europePmcQuery`, `degraded`, `fetchedAt`, `pageSize`
  (`src/api/clinicalApi.ts` validates them as optional, so an older server renders "Not reported").
- **Tab** `LiteratureView.tsx`, `literature/PaperTable.tsx`, `literature/MarkedText.tsx`, `styles/literature.css` —
  finding card with a four-cell strip ending "Engine record: None", one papers table, scope and group controls.
  The audited request state machine (newest-request-wins, self-update guard, inspector re-apply) is unchanged.
- **Rail** `LiteratureInspector.tsx` — search trace, change-the-search, export, what reads the list, method notes,
  sources. The BibTeX/RIS/CSV serialisers and their tests are untouched.
- **Wiring** `AppViews.tsx`, `ViewInspector.tsx` — the view hands its evidence model to the rail (replacing the bare
  citation list); the rail is titled "Evidence Lineage" like its siblings.

## Method limits (also printed in the rail)

- "Names the variant" is a **literal match** of four notations in the title and abstract we hold. It does not read
  full text, tables or figures, nucleotide (`c.`) notation, or gene aliases, and a paper that names the variant says
  nothing here about what it found.
- The gene symbol is matched as written or with mouse-style capitalisation, never case-blind, so a gene named like a
  common word does not match ordinary prose.
- Only the first 25 records of a query are loaded (Europe PMC returns one page per request).
- The variant probe is an ordinary, cached custom search: one extra request per gene and variant, stored like any other.

## Verification

- `tsc --noEmit` clean; boundary, focus-indicator and verify-parity checks pass.
- New tests: `literatureEvidence.test.ts` (28), `LiteratureView.test.tsx` (21), route provenance (3). Full `vitest run`:
  231 files, 2,922 passed, 0 failed. `npm run build` was not re-run for this change (no build config touched).
- Rendered with headless Edge against a fixture shaped like the reference screen, in light, dark and an ~440px column,
  with the zero-result, one-hit, degraded and expanded-row states. Two defects were found and fixed that way: an
  upper-cased fact label that turned `p.Asp116Gly` into `P.ASP116GLY`, and a table that pushed its pin button off a narrow column.

## Follow-ups not done

1. **Paging beyond 25.** Needs a cursor contract (`cursorMark`) in the route and store; the UI already reports "first 25 of N".
2. **Nucleotide and alias matching.** A `c.` form needs the transcript mapping the Population tab already uses; aliases need a
   curated source. Both would raise the naming count honestly; neither is faked here.
3. **Variant papers into the AI summary and the Report.** Today the summary reads only the gene-wide set's top 5. Feeding
   abstracts that *name the variant* first is a prompt and cache-version change and should be its own PR.
4. **Europe PMC's text-mined annotations** (mutation mentions in full text) could reduce the abstract-only limit; not evaluated.

## Sources

- Europe PMC RESTful Web Service (search endpoint). The documentation page refused automated access from this
  environment, so ordering and full-text matching were verified by direct queries on the dates above.
- Ferguson C, et al. 2021. Europe PMC in 2020. Nucleic Acids Res 49:D1507–D1514. doi:10.1093/nar/gkaa994
