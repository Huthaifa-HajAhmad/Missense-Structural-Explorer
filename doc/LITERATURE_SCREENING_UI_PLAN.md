# Literature screening — UI and frontend plan

Companion to `doc/LITERATURE_SCREENING_PROPOSAL.md`. **Status: implemented and rendered on 2026-10-05; UniProt curated links and Phase 2 implemented; ClinVar citation mapping and Phase 3 deferred.** See `LITERATURE_SCREENING_REVIEW.md` for findings, validation and next steps. Original code was read
2026-10-05: `LiteratureView.tsx`, `literature/PaperTable.tsx`, `inspector/LiteratureInspector.tsx`,
`shared/literatureEvidence.ts` (exports listed there), and the evidence-tab design system
(`.agents/skills/evidence-tab-refactor/references/design-system.md`). Priority order, never reversed:
**true → traceable → legible → beautiful.**

## 1. Decisions taken (from the proposal's §12)

| # | Decision |
|---|---|
| 1 | Taxonomy kept as in proposal §4 (ten tags). |
| 2a | Curated variant→PMID links kept (Phase 1b). UniProt natural-variant PubMed evidence verified and implemented. ClinVar deferred pending exact identity and citation semantics. |
| 2b | Mechanism context = **gnomAD gene constraint only** (`pli`, `loeuf`, `missense_z`, `oe_mis`; present in `contracts.ts:1639-1642,2471-2474`). |
| 3 | Citation digest **included** in the narrative evidence hash (proposal §7.4 option a). |
| 4 | Phase 3 (local model) is a future upgrade. |
| Q2 | **Both: tiered default sort the reader can override, plus filter chips** — see §3. |

### What constraint can and cannot support (limits the mechanism panel)

gnomAD constraint measures intolerance to **loss-of-function** (pLI, LOEUF) and to **missense** (missense Z,
o/e). It says nothing about gain-of-function or dominant-negative action. So the panel may compare only:

- paper terms *loss-of-function / haploinsufficiency* ↔ LOEUF / pLI → flag **"terms differ from context"**
  when the paper asserts haploinsufficiency for a gene that is **not** LoF-constrained;
- paper terms *dominant-negative / gain-of-function* → **no comparison and no flag**; the panel prints
  "constraint cannot speak to this mechanism". Silence is the honest output; a flag here would be invented.

If constraint is absent for the gene, the panel says so (`ENGINE_STATE_LABELS` vocabulary), never a blank.
The store path that carries constraint to the Literature view is **to be verified** before building.

## 2. Screen anatomy (three tiers, house shape)

Keep the audited shape: finding → papers → trace. Changes, top to bottom:

1. **Finding hero** — figure and sentence unchanged (count of records matched by a stated query; screening
   never enters it). Fact strip gains nothing; "Engine record: None" stays.
2. **Shortlist strip (new, directly under the hero).** One sentence on the card, not a box:
   *"2 variant-anchored · 1 same residue · 9 gene context · 13 other"* with zeros shown. Each count is a
   button that applies that tier's filter. Zero-state reads as a statement (proposal §0.3-H).
3. **Papers card** — existing scope buttons and search form stay. Below them **two rows**:
   - *Tier row* (replaces nothing; sits above the old "what the text check found" row): **Read first ·
     Read next · All**. Read first = tiers 1–2, Read next = tiers 3–4, All = everything. Default: Read first
     when it has any rows, else All.
   - *Observation chips* (multi-select, AND): Functional · Clinical case · Same residue · Mechanism ·
     Review · Preprint. Counts live, disabled at zero. Exactly the existing `lit-group` pattern.
4. **Rows** — see §3. **Foot** — adds the ordering rule in one sentence.

## 3. Ordering and filtering: why both

Filtering alone hides papers behind a click and makes the order unexplained. A tier sort alone gives the
reader no way to ask "only the clinical ones". So: **tier sort is the default and is stated; chips narrow
it; a "Sort: Attention / Newest" toggle** lets the reader revert to date order. The sort rule prints in the
foot and in the rail trace; ties keep server newest-first.

## 4. Row design

Flat rows, hairline separators, no boxes (design system). Per row:

- Title button, authors/journal/id line (unchanged).
- **"Why read this" line** (new), one line in `detail-prose`, muted: tier name · strongest quote (clamped,
  full text in tooltip) · source (`sentence anchor` / `publication type` / `curated link` / `lexicon`).
  No quote → no line.
- **Chips** (`ev-tier`), at most three visible then "+n": tone map — variant-anchored = `accent` solid;
  same-residue = `neutral`; functional/clinical/mechanism = `neutral`; review/preprint/multi-variant =
  `muted`; "terms differ from context" = `warning`. **No chip is danger/good**: those colours are reserved
  for ACMG codes (design system), and screening is not an ACMG code. A chip whose source is `lexicon` gets a
  dotted underline and tooltip "lexical match — verify in the abstract"; dashed borders stay reserved for
  "unconfirmed" (curated-link chips are *not* dashed; they are a fact about a record).
- **Expanded detail**: existing sentence-quote figure, now one figure per fired tag with its source label;
  then the abstract with `MarkedText`; then, only when relevant, the **mechanism panel** (§5).
- Keyboard: unchanged row model; chip filters are a `role="group"` of `aria-pressed` buttons; tier strip
  counts are buttons with accessible names ("Show 2 variant-anchored papers").

## 5. Mechanism panel (inside the expanded row, only when the paper has mechanism terms)

Two flat `dl` rows: **In the paper** — terms with quote; **Gene constraint** — LOEUF / pLI / missense Z
with the **published cut-points the app already carries** (read from the shared thresholds; none re-typed).
Heading: *"For you to compare"*. The "terms differ from context" chip appears only under the §1 rule.
If thresholds for constraint are not already in `src/shared/thresholds/`, **stop and surface that**, rather
than invent one — a hand-typed cut-point is exactly the defect the integrity checklist forbids.

## 6. Rail (Evidence lineage)

Existing sections kept. Add / change:

1. **Trace** gains steps: *Papers loaded → Text check → Screening → Order*. The Screening step states the
   lexicon version and which sources contributed (publication type present for N of M records).
2. **Shortlist** (new section): tier counts and the sort rule.
3. **Export**: RIS/CSV/BibTeX gain `tier`, `tags` with `source`, the quote, and a header block (query,
   lexicon version, date). A **"Export shortlist"** button exports Read first + Read next only.
4. **What reads this list**: one added line — the screener reads titles and abstracts, is not evidence,
   enters no ACMG criterion.
5. **Method notes**: the §11 limits of the proposal, verbatim.

## 7. Model and file plan

| Layer | File | Work |
|---|---|---|
| Pure model | `src/shared/literatureScreening.ts` (new) | tags, sources, tier, `whyRead`; no React |
| Pure model | `src/shared/literatureEvidence.ts` | `PaperReading.screening`; `same-residue` in `readMentions`; sort + `ShortlistCounts`; trace steps |
| View | `LiteratureView.tsx` | tier/sort/chip state; reset rules mirror `groupFilter` (reset on new query) |
| Table | `literature/PaperTable.tsx` (+ `ScreeningChips.tsx`, `MechanismPanel.tsx`) | rows, chips, panel |
| Rail | `inspector/LiteratureInspector.tsx` | §6 |
| Styles | `src/styles/literature.css` (extend; prefix `lit-`) | tokens only; container queries for narrow columns |
| Tests | model contract on synthetic abstracts; `LiteratureView.test.tsx` invariant guard (no tag in hero / ACMG); export test; a11y names |

The existing request state machine (newest-wins, abort, inspector re-apply) is **not touched**. Screening is
a pure derivation of `citations`, so it cannot reintroduce the stale-response defects that machine fixed.

## 8. Build order and test gates

1. **1a** server: keep publication type / MeSH / keywords through the RAG cache (schema bump).
2. **Pure model + tests** on the synthetic abstracts (proposal §0.3) — green before any UI.
3. **UI**: shortlist strip → rows/chips → mechanism panel → rail → export.
4. **Verify**: `tsc`, `npm run lint`, full vitest; render light, dark and ~800px, including zero-result,
   degraded, and expanded-row states; update `LiteratureView.test.tsx` expectations by renaming, not deleting.
5. **Phase 2** (AI summary + citation digest + prompt/schema/client cache bumps) as its own PR.

Memory/process rules for this repo: do not commit; decide autonomously within the integrity checklist; ask
only where the rule engine's output would change (it does not here).
