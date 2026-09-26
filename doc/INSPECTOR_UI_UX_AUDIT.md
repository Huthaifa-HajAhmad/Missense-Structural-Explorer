# Inspector UI/UX audit — findings, fixes, and what is still open

Revision `7ac04cf`, working tree dirty and **edited concurrently by another writer** for the whole
session (see §9). Bound to that revision and dirty state; re-verify before quoting anything here.

This document covers two things:

1. the five items raised against the Insights and Population Data screenshots, and the inspector rails
   those screenshots show; and
2. **an independent five-dimension review of the resulting change**, which found three blocking
   defects in it — including one that made the headline fix inert in the browser. §0 is that story,
   because it is the most useful part of this document: the defects it records were invisible to the
   author and to the tests the author wrote.

Everything below was reproduced in source, by running a guard, or by resolving the stylesheet through
a real CSS engine. Nothing is inferred from a screenshot.

| # | Item raised | Status | Root cause |
| --- | --- | --- | --- |
| 1 | Verdict card has a shadow, siblings do not | **Fixed** | Raw Tailwind `shadow-sm` on one card against a design token of `none` |
| 2 | AI plausibility says the variant is a ClinVar VUS; the ClinVar card says otherwise | **Fixed** | The prompt omitted ClinVar entirely when no record exists, so the model answered from priors |
| 3 | Critique the inspector UI/UX | **Answered** — 5 fixed, 6 open | See §3–§5 and §8 |
| 4 | The clinical narrative is duplicated in the Report | **Decided and implemented** — Insights condensed, Report unchanged | Two copies of one AI artefact, only one covered by print/export/fingerprint |
| 5 | Cards use `hsl(45,29%,97%)` — the same colour as the page | **Fixed** | `--cs-surface-2` sat 0.19 points from `--cs-bg`; the nested-panel step was *negative* |

---

## 0. The review round, and the three things it caught that the change did not

Five reviewers ran independently against this change: clinical/provenance semantics, UI and design
system, test and verification integrity, integration/regression/layering, and an adversarial
red-team. Three returned **BLOCK**. Their findings were reproduced, not accepted on trust; several are
recorded in this document because the author had missed them.

### 0.1 The headline fix was inert in the browser (HIGH — the worst finding in this document)

`src/styles/variables.css` declared `--cs-surface-2` **twice inside the same `:root` rule** — the
corrected `#F5F2EA` near the top, and a legacy `#FAF9F6` straggler 140 lines later. For one property in
one declaration block, CSS takes the **last** value. So:

- the fix was applied in source, reviewed, and never painted;
- the shipped `bg → surface-2` step was still **−0.20** points, against the −0.19 the change set out to
  fix, across all 332 references; and
- **the guard written to pin it certified the broken version.** `surfaceRamp.test.ts` read the FIRST
  declaration — `if (!values.has(token)) values.set(...)`, commented "a later alias cannot overwrite the
  literal", which is the inverse of the cascade — so it computed a 3.14-point step while the browser
  computed −0.20. Two reviewers found this independently, one by minifying the file with `lightningcss`
  and one by resolving it through `jsdom`.

Fixed three ways, because one was not enough:

1. the duplicate declarations are gone from `:root` and `.dark` (the `.dark` pair happened to agree, so
   nothing was mis-painted there — but an agreeing duplicate is one edit from a disagreeing one);
2. the guard now models CSS (**last wins**) *and* fails on any token declared twice in one block, naming
   both line numbers. With duplicates banned, "last wins" and "the only declaration" are the same value;
3. the ramp is verified through the real CSS engine (`scratch/resolve-ramp.mjs`), which reports the
   fixed value present and `#FAF9F6` absent from the compiled stylesheet.

The rebuilt guard was negative-controlled by reintroducing the duplicate inside `:root`: **four
assertions fail**, including the named one reporting `--cs-surface-2 declared at lines 56, 246`. The
first negative-control attempt anchored the duplicate *after* `:root`'s closing brace and the guard
correctly ignored it — which is why the control is quoted here with its anchor.

**The lesson worth keeping:** a guard that reads a file by parsing it can disagree with the consumer of
that file. The first version was not weak, it was *confidently wrong*, and it would have stopped anyone
from looking. Resolving the artefact with the real engine is what settled it.

### 0.2 The prompt fix would have been invisible on any variant already viewed (HIGH)

The prompt gained a ClinVar-absence block and a grounding rule. The **server** narrative cache was
invalidated for it (`NARRATIVE_PROMPT_SCHEMA_VERSION`, §3.2). The **client** cache was not:
`variantCache.CACHE_VERSION` stayed `v3.9`, and `workflowOrchestrator` replays a sessionStorage bundle
verbatim without calling the server at all. So a variant viewed before the change would have kept
serving the narrative the old prompt wrote — the fabricated ClinVar classification — for up to a day,
with the fix never running. Bumped to `v4.0`, with the reasoning recorded beside the other bumps (the
file's own comment documents v3.7/3.8/3.9 for exactly this reason).

### 0.3 The replacement absence block made a *new* false claim about the run (HIGH)

The first fix decided ClinVar's state from the record alone, so `!clinvar` meant "not queried". But
`core-data-fetcher` sets `clinvar = null` **and** `serviceStatus.clinvar = "timeout"` on an outage. The
prompt therefore told the model, as a fact about the run, that ClinVar was never queried — while the
Population rail on the same screen said the query had timed out. A negative clinical claim manufactured
from a failed request, one layer down from the original defect. See §3.1 for the state machine that
replaces it, and why the failure states are the ones that matter.

### 0.4 Also caught and fixed

- **The author's own edit broke the boundary checker.** Adding rule 5 referenced `storesDir` /
  `componentsDir` without declaring them: `ReferenceError`, exit 1, and three `tsc` errors — and the
  change's audit table claimed "0 violations". Fixed, and §10's verification is now recorded from a run
  against the finished tree rather than from an earlier one.
- **Writing a *new* false claim in a comment.** `contracts.ts` blamed zod for stripping
  `insights.model`; the narrative route validates with `insights: z.any()`, so zod never touched it —
  the client reducer did. Corrected, and the dead-schema divergence recorded as O11.
- **A test that passed because of the bug it was meant to catch.** The condensed-summary fixture joined a
  heading and its body with a single space, making them one line; the old implementation fell back to
  the whole document when the selected section had no body, so the assertion held. Removing that
  fallback exposed the fixture (§6.2).
- Two regexes written in this change were wrong in the direction of *under*-reporting: the elevation
  pattern let `shadow-none` match as bare `shadow`, and the pipe-stripping rule treated a sentence
  containing `|ΔΔG|` as a table row. Both were caught by their own new tests.

---

## 1. The surface that was not a surface (item 5)

`hsl(45, 29%, 97%)` is `#FAF9F6`, which was `--cs-surface-2` — the fill of most card bodies in this app
(the inspector cards, the Insights card's panels, buttons, chips: **332 references across 59 files**).
The page was `--cs-bg: #F9F8F6`.

| | colour | HSL lightness | step |
| --- | --- | --- | --- |
| card | `#FFFFFF` | 100.00% | — |
| page | `#F9F8F6` | 97.06% | 2.94 |
| **nested panel** | **`#FAF9F6`** | **97.25%** | **−0.19** ← the defect |
| hover | `#F3F0EA` | 93.53% | 3.73 |

The nested panel was **lighter than the page it was drawn on**, by a fifth of a percentage point. Not
"similar to": the same. In a design whose elevation tokens are both `none`, fill and hairline carry the
entire hierarchy — so two of the five levels were effectively one token. The Insights view made it
worst: its root is passed `classCard="border-0 rounded-none shadow-none"`, so the page showed through
and its panels *were* the page. The whole screen was one cream sheet.

The ramp is re-derived so every adjacent step clears 2.5 points. Page and white card keep their
documented values; only the levels that had no room moved.

| token | was | now | step |
| --- | --- | --- | --- |
| `--cs-surface` | `#FFFFFF` | `#FFFFFF` | — |
| `--cs-bg` | `#F9F8F6` | `#F9F8F6` | 2.94 |
| `--cs-surface-2` | `#FAF9F6` | `#F5F2EA` | 3.14 |
| `--cs-bg-subtle` | `#F3F0EA` | `#EEEBE2` | 2.94 |
| `--cs-border-subtle` | `#ECEAE4` | `#E6E2D8` | 3.53 |
| `--cs-border` | `#E5E1DC` | `#D9D4C9` | 5.49 |

Hue stays in the 40–42° band. `--cs-text-muted` was re-measured on the darker fills it is actually
painted on (4.93:1 on `--cs-surface-2`, 4.63:1 on `--cs-bg-subtle`, 5.20:1 on the page — all above AA)
and its token comment now carries that table instead of the single stale 5.24:1 figure.

**The printed report had the same defect and it was worse.** `print.css` set `--cs-border-subtle` and
`--cs-surface-2` to the *identical* hex `#F3F4F6`, so every panel written as
`background: var(--cs-surface-2); border: 1px solid var(--cs-border-subtle)` — all of `ReportBlocks` —
lost its outline on paper at 1.00:1, and `--cs-bg-subtle` sat above `--cs-surface-2`, inverting the
ramp. The print ramp is now monotonic too, and the same test asserts it.

Two raw copies of the old value also survived in live code (`FunctionInteractionsTabs`'s domain band,
`MetricExplanationModal`'s card) — they happened to agree with the token only because of §0.1 — and are
now `var(--cs-surface-2)`. `featurePalette`'s measured-contrast note named the retired literal.

**Dark mode was left alone deliberately** (O6). Its range is compressed by construction
(`bg` 9.22% → `surface-2` 11.57% → `surface` 15.29%), so it cannot hold three 2.5-point steps without
moving a deliberate value; its `bg → surface-2` step is 2.35 points. The ramp note and the guard now say
"light" explicitly rather than claiming a property the dark block does not have.

Guard: `src/styles/__tests__/surfaceRamp.test.ts` — 11 cases: selector-based block location, the
duplicate ban, last-wins parsing, ordering, minimum step, the named regression, a **hue/chroma** check
(the file claimed a 40–42° band and nothing tested it — a clearly blue fill passed the old version), a
non-empty fill list, muted-text contrast, and the print ramp with its own duplicate ban.

---

## 2. The verdict card's shadow (item 1)

`ClinicalInsightsCard` carried `shadow-sm` on the ACMG consensus verdict card while every sibling panel
in the column carried none, so the verdict read as a different class of object from the evidence
supporting it.

The shadow was not an inconsistency to be matched elsewhere — it was **off-token**: `--cs-shadow-card`
and `--cs-shadow-sm` are both `none` in both themes, and `print.css` strips `box-shadow` again, so the
one surface that looked raised lost its elevation in the artefact that gets filed. Removed, along with
four more in the same two panes and one in the Report inspector rail (the same defect one file over,
which the first version of the guard did not scan while its test title claimed it did).

Guard: `src/components/__tests__/clinicalElevation.test.ts`, now with a non-empty-surface assertion
(without it, `SURFACES = []` made the scan pass while checking nothing — the "scanned an empty
directory" shape this repository has been bitten by), a broadened pattern that catches the spellings the
first version missed (bare `shadow`, `shadow-[…]`, `2xl:shadow-md`), and self-tests that run the **real
scan** rather than the bare regex, so the comment filter is finally covered.

**108 raw shadow utilities remain in 36 files** — see O1.

---

## 3. The model contradicted its own ClinVar card (item 2)

The AI plausibility paragraph read:

> "…and the variant is **listed as a variant of uncertain significance in ClinVar** without definitive
> functional validation."

The Population Data tab, in the same viewport, read:

> "ClinVar holds **no classification** for this variant."

**This was not a UI bug and could not be fixed in the UI.** In `server/services/llm/gemini.ts` the
ClinVar block was built inside `if (clinvar && classification !== "Not found in ClinVar")`, so for a
variant ClinVar does not hold, the prompt said **nothing whatsoever about ClinVar** — not even that it
had been queried. The model filled the vacuum from its pretraining prior, and a fabricated VUS is the
safe-looking fabrication: it reads as diligence rather than as an error, which is why it survived
review.

### 3.1 The state machine that replaces the string test

Four surfaces decided ClinVar's state four different ways, reading the classification string, a `uid`
check, or a case-insensitive sentinel match. Two read *only* the string, which cannot distinguish three
situations that all arrive as "no classification": the query failed, the query succeeded and ClinVar
holds nothing, and ClinVar holds a submission that records no classification value.

`src/shared/clinvarPresence.ts` now derives one of five states from the record **and** the run's
per-source status:

| state | when | what a surface may say |
| --- | --- | --- |
| `held` | a submission with a usable classification | quote it |
| `unclassified` | a submission exists, records no classification value | a submitter engaged, so "no submitter has classified it" would be false |
| `recorded-negative` | the query completed and ClinVar holds nothing | a real negative — and *not* evidence of benignity |
| `unread` | timed out, errored, build-gated, or still running | **no conclusion**; this is a failure to obtain the record, not an absence of one |
| `unqueried` | no query was made | no conclusion |

The failure states are tested **before** the record, because a record in hand after a timeout is the
previous attempt's and must not be quoted as this run's result. An unknown status fails towards silence
(`unqueried`) rather than towards a claim.

The prompt emits a labelled block on **every** path, forbids asserting a ClinVar classification in the
terms the observed hallucination used, and carries a global `[EVIDENCE GROUNDING RULE]` forbidding any
database claim not traceable to a labelled block. The same state now produces the rule-based fallback
report's ClinVar sentence, which had its own version of the defect: a timeout printed *"Not listed in
ClinVar (rare or novel variant)"* — an absence **and** a novelty claim from a failed request — and a
sentinel record printed *"Listed as Not found in ClinVar"*, which reads as a classification.

`serviceStatus` travels end-to-end for this: the route's request schema already accepted it and nothing
was sending it, so `unread` was unreachable in production until both client senders included it.

### 3.2 The cache, both halves

The prompt's cache key carries `NARRATIVE_PROMPT_SCHEMA_VERSION` from the shared constant rather than a
literal, so a prompt change cannot leave the route serving old narratives while the file that changed
says otherwise. That fixes the **server** LRU (up to its TTL within a process). The **client** half is
what actually short-circuits the server, and `CACHE_VERSION` was bumped for it — see §0.2.

Guards: `server/services/llm/gemini.evidenceGrounding.test.ts` (7 cases — absence wording, the four-way
distinction, the unclassified record, the presence case so the fix cannot pass by suppressing ClinVar,
the case-insensitive sentinel, the grounding rule, and the humanised AlphaMissense token that used to
reach clinical prose as `likely_benign`); `src/shared/__tests__/clinvarPresence.test.ts` (9 cases);
`server/routes/variant/narrativeCacheKey.test.ts` (4 cases, including one asserting it found the key, so
a rename cannot make it vacuous).

---

## 4. The rail contradicted the card about the same criterion (item 3)

In the Insights screenshot the rail reads **"PP3 — AI Inferred"** while the card below lists **PP3** as
**"DATABASE-VERIFIED"**. Same code, same run, opposite provenance, a few hundred pixels apart — the one
field that decides whether a curator treats a criterion as evidence or as a suggestion.

Cause: `handleNarrativeResponse` returns a merged list with the rule engine's codes tagged
`database_verified` first and the AI's non-duplicates tagged `ai_suggested`. Both rails discarded it —
they concatenated it with the raw, untagged `ruleBasedInsights.acmgCriteria` and deduped with
`new Map(pairs)`, which keeps the **last** entry per key, so the untagged copy overwrote the tagged one
and every rule-engine code fell through to "AI Inferred". Always, on every run.

Fixed by single-sourcing the list and the label vocabulary. All **five** render sites now consume it —
the two rails, the Insights card, the report body and the report rail — which matters because the
report rail's own "Copy Report" feeds its list to the shared builder: two of the five were missed in the
first pass, so with `insights: null` (the normal pre-narrative payload) the rails labelled every code
DATABASE-VERIFIED while the report body rendered no label at all, and the two buttons emitted different
documents. That is now true by construction.

An untagged code on the merged path is resolved **by membership in the engine's own list** rather than
guessed: the first fix defaulted to `ai_suggested`, which is the same class of error in the opposite
direction — presenting a computed criterion as a model's suggestion.

Two further consequences of the same block: the card's "Suggester" section silently dropped the AI's own
criteria whenever they existed (it filtered for `database_verified` and printed "none met"); and the
rail's nested scroll put the third of three criteria behind a scrollbar while the header said "3 Met".

Guards: `src/shared/__tests__/acmgCriteriaView.test.ts` and
`src/components/inspector/__tests__/InsightsInspector.provenance.test.tsx`.

---

## 5. The rail's telemetry card was four claims and three were false (item 3)

The "AI Synthesis Telemetry" card is the surface a curator opens to ask *where did this come from*.

| row | rendered | truth |
| --- | --- | --- |
| Inference Model | `Clinical LLM Engine` | a category; the model is on the payload as `insights.model` |
| Generation Mode | `Structured Clinical Schema` | roughly right, but a literal |
| Sampling Temperature | `0.2 (Deterministic)` | the call sets **0.0**; and 0.2 is not deterministic |
| Status | `Inference Ready` | a constant — identical with no key, and after a failure |

Replaced with `NarrativeProvenanceRow`, reading the payload or `src/shared/narrativeSynthesis.ts` — which
the **server** now imports for its own `temperature`, since a claim about a parameter is only checkable
if there is one declaration of it. Status comes from `deriveAiStatus`, the same decision the Report rail
renders.

Three provenance defects surfaced while making it honest:

- **A rule-based fallback was stamped `ai_inference`.** The route wrote it unconditionally, including for
  the degraded report it assembles itself — and named the **head of the fallback ladder**, not the model
  that answered. `model` now comes from the engine (the attempt that returned text) and is absent on a
  fallback.
- **The model identity was discarded in transit.** The pipeline reducer named every field it kept, and
  `model`/`source` were not among them; the retry path merged with a spread and kept them. The same
  synthesis rendered "AI synthesis · gemini-3.7-flash" from one control and the generic label from
  another.
- **One fact, three predicates.** Authorship was derived three ways. Now one shared
  `deriveNarrativeAuthorship`, whose asymmetry is deliberate and tested: presenting rule-based prose as a
  model's **overstates** provenance, so degradation wins over the payload's own field.

Also fixed: the rail stated inferential parameters for a rule-based run (describing a call that never
returned); the primary rail action carried a stray `shadow-sm`; and the fallback report printed
`Transcript: MANE Select` whenever no transcript had resolved — a reference-sequence designation invented
from a literal, in the header block a reader uses to check the right transcript was analysed.

---

## 6. The clinical narrative: decision and implementation (item 4)

**Decision (yours): the Insights card shows a short, concise summary; the Report stays as it is.**

The duplication was a provenance problem before a layout one. The narrative existed twice in one
viewport and only the Report copy is covered by the section toggles, the print pass, the EHR export and
the SHA-256 fingerprint. The sidebar already labels the Report tab "Clinical narrative".

- **The Report is unchanged** — full narrative, same section, same id.
- **The Insights card shows a condensed clinical summary.** `src/shared/narrativeSummary.ts` selects the
  narrative's own conclusion, strips markdown, and truncates **on a sentence boundary**, disclosing
  `truncated` and the section it came from. It authors no prose and calls no model, so nothing shown can
  be attributed to the model that the model did not say. A link opens the Report, re-enabling the summary
  section first if the reader had switched it off (a disabled section does not mount, so the anchor would
  otherwise resolve to nothing).
- The card states who wrote the prose, from the shared authorship predicate, so a rule-based run cannot
  be presented as an AI synthesis.

### 6.1 The narrative was also emitted by three divergent builders

The Insights "Copy Report" built its own text:

```
`${clinvar.classification ?? ruleBasedInsights.acmgVerdict}\n\n${analysis}\n\nACMG: ${codes}`
```

`??` falls through on null/undefined only, and `clinvar.classification` is a real string
("Not found in ClinVar") for an unheld variant — so pasting from the Insights view began with **"Not
found in ClinVar" where a classification belongs**, while the identically-labelled button in the Report
view began with the rule engine's verdict. It also omitted the plausibility, the ACMG reasons, the
energetics, the provenance manifest, the evidence completeness, the numbering basis, and ignored the
section toggles. Both now call the one pure builder with the Report's verdict precedence.

### 6.2 Defects the review found in this module, and what they were

- **Raw markdown reached the reader.** `toProse(chosen.body) || toProse(source)` fell back to the whole
  document while `sourceSection` kept naming the chosen heading, and `toProse` never stripped headings —
  so a heading-only clinical section produced the *next* section's prose, led by its `###` marker, under
  a label describing a different section. There is now no such fallback: a section qualifies only if it
  has prose, and the label always describes the text beside it.
- **The selection took the first clinical-ish heading.** "Structural Interpretation of the Model" is the
  argument, and the server's own degraded report opens with "Rule-Based Clinical Summary" — process
  boilerplate — while placing the verdict in "Classification". A reader was shown the boilerplate and
  told it was the clinical summary. Selection is now a preference order with the conclusion first.
- **Pipe stripping corrupted clinical notation.** A blanket `replace(/\|/g, " ")` turned
  `|ΔΔG| > 2 kcal/mol` into a *signed* value (a different claim) and removed an allele separator from
  `p.Gly12Asp|p.Gly12Val`. Pipes are punctuation only on a line that structurally is a table row.
- **A test passed because of the bug.** The condensed-summary fixture joined a heading to its body with a
  space, making one line; the old fallback made that "work". Removing the fallback exposed it.

Guards: `src/shared/__tests__/narrativeSummary.test.ts` (18 cases) and
`src/components/__tests__/ClinicalInsightsCard.narrativeSummary.test.tsx` (9), plus
`src/stores/__tests__/handleCopyReport.test.ts` (7, the verdict precedence and the shared-builder
equality — nothing tested the copy handler before, so a revert passed the whole suite).

---

## 7. Layering

A store slice now imports the report builder so both copy buttons emit one document. The boundary
checker had **no rule for that direction at all** — it modelled server/client/shared and said nothing
about store→component — so the edge was invisible to the guard that is supposed to police layering. A
five-dimension reviewer proved it benign today (no cycle; the module is React-free) and flagged the trap:
the next import added to that file would put component code in the store's module graph invisibly.

Rather than leave it unguarded or move the file under time pressure, `check-boundaries.ts` gained
**rule 5** (`STORES_CANNOT_IMPORT_COMPONENTS`) with a validated exception: the allowlisted module is
checked to import no React and no sibling component, and the exemption is *reported as a violation* if
that stops being true. Three negative tests were added alongside the existing adversarial set.

Moving the module into `src/shared/` is the better end state and is recorded as O12.

---

## 8. Open findings

Severity is impact on a reader acting on the screen.

| # | Sev | Location | Finding |
| --- | --- | --- | --- |
| O1 | **HIGH** | 37 files, 117 sites | **Raw `shadow-*` utilities bypass an elevation token that is `none`.** The three guarded panes are clean (0 live hits) and the rest are not, so elevation stays inconsistent app-wide and `print.css` silently removes it all. Concentrations: `modals/OnboardingModal.tsx` (10), `VariantSearchPanel.tsx` (9), `evidence/PerturbationTab.tsx` (8). Some are genuine depth cues over the 3D viewport and should be re-expressed as a token, not deleted. |
| O2 | **HIGH** | `inspector/EvidenceInspector.tsx:202,206,210,823,831,835` | **Six `dark:` colour utilities in an inspector rail are not print-safe.** They compile to `.dark .dark\:text-rose-400 { color: … }` — no token involved — so the print pass's token flattening cannot reach them, which is the exact hole `print.css` documents. Printing from dark mode puts pale ink on white paper. **192 such utilities** exist across 28 files; 42 in the inspector rails. |
| O3 | **HIGH** | `src/services/pipeline/variantCache.ts` | **Resolved for the narrative, open for the next payload change.** The bump is a manual convention with no guard: nothing fails if a prompt or payload change ships without one. A `CACHE_VERSION` derived from the prompt/schema constants would make it structural. |
| O4 | **MEDIUM** | `ClinicalReportBar.tsx:217`, `inspector/ReportInspector.tsx:225` | **The report states its own version twice, from two literals.** The masthead prints `MSE Protocol v2.5` and the JSON export declares `schema: "mse.clinical-report/2.5"`; neither reads a build stamp, while a real version is available from `useDiagnostics()`. A filed report cannot be matched to the build that produced it. |
| O5 | **MEDIUM** | Insights card + Report section + rail trace | **The criteria list is still rendered three times.** The copies now agree about provenance, which was the defect; whether the rail should keep a full trace rather than a count and a link is a design question this pass did not settle. |
| O6 | **MEDIUM** | `variables.css` dark ramp | **The dark ladder is a different shape and was not re-tuned.** In dark, `surface-2` is a nested panel LIGHTER than the page (the inverse of light), the borders are lighter than the surfaces they bound, and the smallest step between adjacent levels is 1.18 points. Fitting three 2.5-point steps into it means moving the dark page background, a deliberate value. The ramp note and the guard now say "light" rather than claiming otherwise; the fix is a separate, deliberate repaint. |
| O7 | **MEDIUM** | `print.css` | **Print's flattened `--cs-text-*` values were not re-measured** against the new print fills. The cold-gray ramp changed, and the text tokens were chosen for the old one. |
| O8 | **MEDIUM** | `inspector/EvidenceInspector.tsx` | **The concordance badge and the ClinGen point scale still use raw palette hues** (`text-rose-500`, `text-amber-500`, `text-amber-400`), so one fact carries two reds and print cannot flatten them. The panel's own comments record this fix being applied to the sibling criteria rows. |
| O9 | **LOW** | `ClinicalInsightsCard` | **The AI plausibility panel is amber while the rail paints AI provenance clay**, and amber is reserved elsewhere on these screens for a run fault and "likely pathogenic". One provenance, two colours. |
| O10 | **LOW** | `ClinicalReportBar` masthead | **The masthead still defaults to `MANE Select`** when no transcript resolved. The EHR export no longer does (§5); the screen surface does, and it is the same unsupported reference-sequence claim. |
| O11 | **LOW** | `src/shared/contracts.ts` | **One of the two `insights` schemas is never executed.** `biophysicalAnalysisResponseSchema` is parsed at runtime; `analyzeVariantResponseSchema` is parsed **only in its own test** — the narrative route is validated by `z.any()` in `src/api/clinicalApi.ts`. The schema a reader would take for the narrative's contract enforces nothing in production, and the two have diverged (the biophysics one has no `acmgVerdict`, `model` or `source`). |
| O12 | **LOW** | `src/stores/slices/searchSlice.ts:9-13` | **A pure module still lives under `src/components/`.** Rule 5 now guards the edge and validates the exemption, but the module belongs in `src/shared/` where rule 3 would cover it. Moving it touches five import sites and a shared test. |
| O13 | **LOW** | `acmgCriteriaView.ts` | **Two structurally identical positional parameters**, so a swapped call compiles and silently relabels every rule-engine code. All four call sites are correct; an options object would make it unrepresentable. |
| O14 | **LOW** | review loop | **Nothing in the UI says which build is running.** Screenshot 2's sidebar read "Population Frequencies", which `7ac04cf` renamed to "Population Data"; the built bundle contains the new label, so the reviewed artefact predated HEAD. See O4. |

---

## 9. Verification

Recorded from a run against the finished tree.

| Layer | Command | Result |
| --- | --- | --- |
| Types (whole repo) | `npx tsc --noEmit` | **0 errors** |
| Boundaries | `node scripts/check-boundaries.ts` | **0 violations** (rule 5 active) |
| Focus indicators | `node scripts/check-focus-indicators.mjs` | **pass** — 10 suppressions, all with replacements |
| Ramp, real CSS engine | `node scratch/resolve-ramp.mjs` (`lightningcss`) | fixed value present, **`#FAF9F6` absent**, min step 2.94 |
| Ramp duplicate, negative control | duplicate reintroduced inside `:root` | **4 assertions fail**, naming both line numbers |
| Encoding | BOM + mojibake scan over all 41 changed files | **clean** |
| Suite, before this change | `npx vitest run` | 171 files / 2027 passed, 5 skipped (173 / 2032) |
| Suite, after | `npx vitest run` | **184 files / 2176 passed, 5 skipped (186 / 2181), exit 0** |
| New/changed tests | 12 new files + 4 modified | **all pass** |
| Boundary rule 5 | `server/tests/architectural-boundaries.test.ts` | 14 cases, including 3 new for the rule and its exemption |

The delta is +13 files / +149 tests. This change added **12 test files** (`surfaceRamp`,
`clinicalElevation`, `gemini.evidenceGrounding`, `narrativeCacheKey`, `narrativeResponseProvenance`,
`acmgCriteriaView`, `clinvarPresence`, `narrativeAuthorship`, `narrativeSummary`,
`InsightsInspector.provenance`, `ClinicalInsightsCard.narrativeSummary`, `handleCopyReport`) and modified
**4** (`narrativeService`, `contracts`, `narrative`, `architectural-boundaries`). The remaining files in
the delta are the concurrent writer's (see §10, caveat 6).

### The review round's own verification claims

The three reviewers that returned BLOCK could not run the suite — `npx vitest run` fails under the file
sandbox with `spawn EPERM` (esbuild's config loader pipes stdio) — and said so explicitly rather than
inferring results. Their findings came from reading, from `git show HEAD:` diffs, and from replicating
the guards' own logic in plain `node`; two used the real `lightningcss`/`jsdom` binaries. That is why
§0.1 was believed: it did not rest on a test result.

An intermediate suite run mid-session reported one failure in `CommandPalette.test.tsx`, a file the
concurrent writer rewrote at 22:38:30 — after this session's baseline and during the run. It was
attributed by three independent facts (this change's diff does not touch `handleSearchSubmit`; the stack
is entirely inside that file; the file's mtime is mid-run) and deliberately not touched. The final run
above is green.

---

## 10. Caveats

1. **No browser verification.** No visual, hover, focus, zoom, dark-mode or print-preview check was
   possible in this environment. The ramp is justified by lightness arithmetic, AA contrast and the real
   CSS engine's output — not by a screenshot. `--cs-surface-2` is referenced 332 times across 59 files, so
   the visual delta is broad even though the token change is four lines.
2. **The 2.5-point floor is a chosen threshold**, informed by the defect (0.19) and the smallest
   pre-existing step (2.55) but not by a perceptual study. It is a named constant in the guard and one
   edit to move. It is *not* "derived" from the defect — any positive threshold would have caught a
   negative step, and the first version of the comment claimed otherwise.
3. **The dark theme was not re-tuned** (O6), so dark mode keeps its smaller nested-panel step.
4. **Print text contrast was not re-measured** against the new print fills (O7).
5. **`scratch/` is a working area**, excluded from the suite. `scratch/resolve-ramp.mjs`,
   `scratch/check-ramp.mjs` and `scratch/surface-ramp-final.ps1` are the measurement tools referenced
   above. The committed guard re-derives the same numbers from the stylesheets, so nothing load-bearing
   lives there.
6. **Concurrent edits.** Another writer held this tree for the whole session. Line numbers in the open
   findings were true when read; re-check before acting.
7. **Not verified upstream:** whether a real provider now obeys the ClinVar prohibition. The prompt, the
   state machine and the prohibition are pinned by test; the model's compliance is not something this
   repository can assert.
8. **The review was of a change, not of the application.** Five reviewers covered this diff and the
   surfaces it touches; the ~100 raw shadow sites, the 172 `dark:` colour utilities and the other
   surfaces listed in §8 were found and recorded, not audited in full.
