# Literature screening — should the workspace triage papers, and how

Design proposal. **Status: Phases 0, 1a and 1 implemented; mechanism comparison implemented. UniProt curated links (1b) and screening-selected summary integration (2) implemented. ClinVar citation mapping and the optional local model remain deferred.** See `LITERATURE_SCREENING_REVIEW.md` for the rendered review and next-phase implementation notes. All original code references were read **2026-10-04** in this
session; line numbers are as of that revision. Claims about SemIf/openjev were read from
`https://openjev.com/` on the same date and are marked **verified (site)**. No screening model has
been evaluated, so no accuracy number appears below.

Reference variants: **NAE1 p.Asp116Gly** (Q13564, the Literature tab's audit reference),
**PAH p.Arg408Trp**, **GBA1 p.Leu483Pro**, **FGFR3 p.Gly380Arg** (the README's worked examples).

**Revision 2 (2026-10-05).** Rewritten to lead with the reader's aims (§0), add worked use cases
(§0.3), and add two signal sources the first draft missed: structured Europe PMC metadata and
curated variant→PMID links (§4a). Claims in §4a about external APIs other than Europe PMC are
**unverified** and marked so; the Europe PMC claim is **verified (code)**: `resultType=core` is
requested (`literature-rag.ts:561,947`) but `toCitation` keeps only id, title, abstract, authors,
journal, year and url (`literature-rag.ts:461-478`); publication type, MeSH and keywords are discarded.

---

## 0. The reader's aims, and what this proposal owes them

The first draft spent most of its length on what the screener must *not* say. That is necessary but
it is the guard rail, not the product. The aim, in the reader's words: **for the variant I chose,
capture the papers that actually deserve a read** — is it reported in rare disease, is it
investigated functionally, does the proposed mechanism fit the gene — and make the *output* of that
better, not just the list.

### 0.1 The three questions, restated so they can be answered honestly

Each question is asked of a *paper*, answered as an *observation with a quote*, and never as a finding
about the variant.

| The reader asks | The screener may say | It may not say | What makes it trustworthy |
|---|---|---|---|
| Is this variant reported in rare disease? | "A **patient/family is described in the same sentence as `p.Asp116Gly`**" + the sentence | "Pathogenic", "disease-causing", PP4/PS4 | The anchor: variant notation and case language in one sentence, not merely both somewhere in the abstract |
| Is it investigated in functional studies? | "**Assay language in the sentence that names the variant**" (e.g. *"…reduced thioester formation…"*) + the sentence | "Functional studies show…", PS3 | Same sentence-level anchor; plus Europe PMC's own publication type when it says Review |
| Does the mechanism match the gene? | A **side-by-side**: the mechanism terms found in the paper (*dominant-negative, loss-of-function*) next to the gene's mechanism context the app already holds | "Mechanism matches", "consistent with PVS1/PM1" | The reader makes the match; the screener lines the two up |

The third row is the real departure from the first draft, which treated "mechanism" as one more
lexicon tag. A tag cannot answer *matches the gene*; a **juxtaposition** can, without asserting
anything (§4b).

### 0.2 What "deserves a read" means, concretely

A paper deserves a read when reading it can change the reader's interpretation. In descending
order of how often that is true for a missense variant:

1. A paper that reports **this exact variant** in a patient or an assay.
2. A paper that reports **a different substitution at this residue** — the reader's PM5-style
   question ("is another change here already known?") — which an exact-notation match misses
   entirely today.
3. A paper that studies **this gene's disease mechanism or this domain**, and so tells the reader
   what a missense here would do.
4. A paper that **lists this variant among many** (a screen, a table) — useful, but a different read
   (open the supplement), and today indistinguishable from (1).
5. Everything else the search returned.

The tier ordering in §5 is rebuilt around this list; the first draft's tiers merged (1) and (4) and
had no place for (2).

### 0.3 Use cases and worked examples

The abstracts below are **synthetic, written to illustrate the rule, not quoted from any paper**.
They are the seed of the checked-in test table (§10).

**A. The curator with 40 minutes.** A curator reviewing NAE1 p.Asp116Gly has 25 gene-wide records.
Today: unordered, 14 do not name the gene (`doc/LITERATURE_TAB_REVIEW.md:15-19`). With screening:
"Read first" holds the two or three records with a variant-anchored sentence; "Read next" the
same-residue and mechanism papers; the rest collapse. Output: a shortlist, each row with its
*"why read this"* line (§4c) — the reader opens three PDFs, not twenty-five abstracts.

**B. The same-residue rescue.** The reader's variant is p.Arg408Trp (PAH). A paper's abstract says
*"…the p.Arg408Gln substitution retained 12% residual activity…"*. Literal matching files it under
gene-only. The screener sees the **same residue, different alternate residue** — a distinct tag,
`same-residue`, quoted — and lifts it to tier 2. This is the single largest recall gain over today's
tab for missense work, and it needs no model.

**C. The sentence-level false friend.** Abstract: *"Patients with GBA1 variants were diagnosed… We
separately measured activity of the recombinant enzyme."* Abstract-level lexicons fire both
`clinical-case` and `functional-assay` and claim a variant-level experimental paper. The
**sentence anchor** (§4a rule 1) does not: no single sentence couples the variant with either
language, so the paper stays gene-context. This is why the anchor is the headline design change.

**D. The variant buried in a table.** *"We screened 312 GBA1 variants for residual activity"* — the
screener counts distinct variant notations in the abstract and, with the variant named once among
dozens, tags `multi-variant` rather than letting it outrank a dedicated study. Rail text: "names
the variant among N others — open the supplement."

**E. The mechanism fit, shown not decided.** FGFR3 p.Gly380Arg. The panel shows the abstract's
mechanism terms (*"ligand-independent constitutive activation"*) beside the gene-mechanism context
the workspace already carries (gain-of-function / dimerisation domain), and labels the pair "for the
reader to compare". A paper whose terms contradict the context (*"loss-of-function"* for a
GoF gene) is flagged **"mechanism terms differ from context"** — the cheapest high-value warning in
the proposal, and still an observation.

**F. The reviewer's export.** One click exports the shortlist as RIS/CSV with `tier`, `tags`, the
quoted sentence, and the retrieval query, so a second curator can see why each paper is in the file
and re-run it. Today's export (`LiteratureInspector.tsx:129-138`) carries records but not the
reason they were chosen.

**G. The AI summary that finally reads the right papers.** The summary today cites the five
gene-wide records most similar to a generic query (§7.1). After Phase 2, a variant that has a
variant-anchored paper has that paper cited, tagged, and bounded by the no-criterion rule.

**H. Honest emptiness.** A novel variant with no variant-level paper. The screener reports "0 variant
-anchored; 0 same-residue" as a first-class result — itself useful (the literature does not cover
this variant; PS3 and PS4 have no lead) — instead of a list that looks full.

---

## 1. Recommendation

**Yes — add triage, but not a decision model.** The thing worth building is a *screening / sorting
layer* that tells the reader which of the loaded papers to open first. It must never produce a
clinical verdict, a probability, or an ACMG input. Three properties are non-negotiable, and each is a
defect this codebase has already paid to remove:

1. **It sorts attention; it does not assert truth.** A tag says "this abstract contains functional-assay
   language", backed by the quote that triggered it — exactly as the existing variant chip says
   `Names p.Asp116Gly` with the matched notation (`literatureEvidence.ts:76-104`,
   `literatureEvidence.ts:241-267`). It must not say "this variant is pathogenic", "reported in rare
   disease", or "functional studies confirm X".
2. **No probability is shown.** `doc/CALIBRATED_STACKING.md` retired the calibrated stack because its
   parameters were hand-typed and ended with the rule *"Until then, no surface may show a probability
   of destabilization."* A small language model's softmax over labels is the same artifact: an
   uncalibrated number presented as a finding. The screener's output is a **closed-set tag**, never a
   score.
3. **The verdict's meaning does not change.** `LiteratureView.tsx:323` prints *"Not counted in the
   ACMG verdict"* and `literatureEvidence.ts:465` prints *"Engine record: None · Literature is read,
   not scored"*. Screening must preserve both: the rule engine consumes no tag.

This lands the work inside the existing follow-ups rather than against them. `doc/LITERATURE_TAB_REVIEW.md:79-86`
already names two of its three pieces — variant papers into the AI summary (follow-up 3) and better
matching of what a record is *about* (follow-up 4).

### Phase order (each phase independently shippable)

| Phase | Content | Why this order |
|---|---|---|
| **0** | Freeze the taxonomy and the ordering rule in a pure shared module; no model | The tags are the contract every later phase reads |
| **1a** | Keep Europe PMC publication type / MeSH / keywords through the RAG cache (§4a.2) | Cheapest strong signal; unblocks `review` and preprint marking; schema bump |
| **1** | Deterministic screener (sentence anchor, `same-residue`, `multi-variant`, "why read this") + tab filter + shortlist export + rail disclosure | Highest value per line; free, offline, unit-testable |
| **1b** | Curated variant→PMID provenance (§4a.3) and the mechanism juxtaposition (§4b) | Each needs an external-API / cross-tab check first; not blocking Phase 1 |
| **2** | Reorder the AI-summary inputs by screening (the scope chosen for this proposal) | Needs Phase 1's tags; carries the cache/contract change |
| **3** | Optional: browser-local readout (SemIf-style), gated on a labelled evaluation | Only if it beats Phase 1 on held-out abstracts |

Phase 2 is the one explicitly requested; it is specified in §6 because it is the phase with real
blast radius.

---

## 2. Why "decision model" is the wrong frame here

The workspace already has exactly one thing called a decision: the ACMG verdict. The Literature tab
was rebuilt around the claim that it holds none (`doc/LITERATURE_TAB_REVIEW.md:5-7`). A model whose
output is a *decision* over clinical labels would be a second, unauditable decision engine sitting
beside the first — and its labels map straight onto real criteria:

- "investigated in functional studies" ↔ **PS3** (well-established functional studies);
- "reported in rare disease / patient" ↔ **PP4 / PS4** (phenotype and cohort evidence).

A curator reading a chip that says a paper is "a functional study" will treat that as the PS3 lead the
tab currently says it does not provide. The screenshot's own rail line — *"ACMG engine: Nothing. No
criterion is scored from literature."* (`LiteratureInspector.tsx:341`) — is what would become false.

What is safe is the weaker claim: **"this abstract looks like a primary report with assay language;
here is the sentence."** That directs a human to the evidence without manufacturing it. That is the
whole difference between screening and deciding, and it is why the answer is "yes, screening" and
"no, decision model".

There is a second reason to avoid the word. The proposal's motivating example (openjev/SemIf) is a
**method demonstration**, not a component: it exists to compare reading option logits against writing
the same distribution token by token (**verified (site)**). Its value here is the *technique* it
proves cheap — a constrained local readout — not the site or its models. §7 treats the technique on
its merits.

---

## 3. The question literal matching cannot answer

The current text check answers one question precisely: *does this abstract, as text, name the
variant?* (`readMentions`, `literatureEvidence.ts:241-267`; worded in the rail at
`LiteratureInspector.tsx:352-355`). It cannot answer *is this abstract about this variant's
biology?* — and that gap is exactly where readers waste time.

The audit reference makes the gap concrete: for NAE1 p.Asp116Gly, 14 of the first 25 gene-wide records
have the gene in neither title nor abstract, and a fish gene-editing review sat at the top of the list
(`doc/LITERATURE_TAB_REVIEW.md:15-19`). A literal check labels those correctly as "gene not in
abstract" — but the other 11, which *do* name NAE1, still arrive unordered with respect to whether
they are a functional study, a case report, or a mechanism review.

So the screener's job is to add a **second, orthogonal axis** to the one the tab already has:

| Existing axis (literal) | New axis (screening) |
|---|---|
| Does the text name the variant / the gene / neither? | What kind of paper is it, and is it about this variant's biology? |

---

## 4. The screening taxonomy

Each tag is an **independent, one-bit observation** about the abstract, carrying **the matched phrase**
so the chip is checkable. Tags are not mutually exclusive and are not ranked against each other; the
ordering in §5 is a separate, visible rule.

| Tag | What it asserts (and only this) | Matched-phrase source |
|---|---|---|
| `names-variant` | A stored notation of the variant appears in title/abstract | reuse `readMentions` — already computed |
| `names-gene` | The gene symbol appears in title/abstract | reuse `readMentions` — already computed |
| `functional-assay` | The abstract uses experimental-assay language on the protein | lexicon: *activity, kinetic, Western blot, in vitro, knock-in, rescue, expression, catalytic, binding affinity, misfold, ERAD, trafficking, oligomer* |
| `clinical-case` | The abstract describes a patient, family, or cohort | lexicon: *patient, proband, case report, cohort, family, segregation, phenotype, diagnosed* |
| `mechanism` | The abstract discusses the gene's disease mechanism / domain biology | lexicon: *loss-of-function, gain-of-function, dominant-negative, haploinsufficiency, domain, ortholog, homolog, dimer, interface, structure* |
| `review` | The abstract presents no primary observation | **Europe PMC publication type first** (§4a); lexicon fallback: *review, we summarize, meta-analysis, overview* |
| `full-text-only` | Neither gene nor variant in the abstract (Europe PMC matched full text) | reuse the existing `elsewhere` level |
| `same-residue` | A **different substitution at the same residue** is named (`p.Arg408Gln` for `p.Arg408Trp`) | extend `readMentions`: match residue + position with any alternate; quote the sentence |
| `multi-variant` | The variant is named among **many** distinct variants (threshold stated in the trace, e.g. ≥ 10) | count distinct notations; no lexicon |
| `model-system` | The abstract names an experimental system (*mouse, zebrafish, yeast, patient fibroblasts, iPSC*) | small closed lexicon; informs *what kind* of functional read it is |

Design constraints on the lexicon:

- **Every tag is quote-backed.** The chip's tooltip is the triggering sentence, capped (reuse the
  `sentenceAround` shape, `literatureEvidence.ts:233-239`). A tag with no quotable sentence is not
  rendered.
- **Whole-word, case-aware matching**, like `genePattern` (`literatureEvidence.ts:215-221`) — so a
  common-word gene or an assay word inside another word does not fire.
- **No negation handling in Phase 1** unless a test demands it; a lexicon that claims to understand
  "did not perform a functional assay" from substring matching is over-claiming. The tag asserts
  *lexical presence*, and says so.
- **`review` and `clinical-case` can both fire**; they are observations, not a partition.

### 4a. Signal sources, strongest first

Lexical presence anywhere in an abstract is the weakest evidence a paper is about the variant. The
screener should consume signals in this order and say which one fired:

1. **Sentence anchor (new, headline change).** `functional-assay` and `clinical-case` only count as
   *variant-level* when the lexicon hit and a variant notation fall **in the same sentence** (or
   adjacent sentences, stated). Abstract-wide co-occurrence stays available as the weaker
   *gene-context* signal. This removes the false-friend in §0.3-C and costs nothing: `sentenceAround`
   (`literatureEvidence.ts:233-239`) already segments sentences.
2. **Structured Europe PMC metadata (verified (code): requested, then discarded).** `resultType=core`
   returns publication type (*Review*, *Case Reports*, *Clinical Trial*, *Preprint*…), MeSH headings
   and author keywords, but `toCitation` drops them. Keep them through the cache (a schema bump on
   the RAG row) and let `review` and `clinical-case` fire from **publication type** first — a
   curator-assigned field beats a regex on prose. Preprints can then also be marked, which the tab
   cannot do reliably today. This needs a cache-schema change and a re-fetch; it is Phase 1's one
   server-side cost.
3. **Curated variant→PMID links (unverified; not in the codebase today).** A repo-wide search finds no
   use of ClinVar submission citations, UniProt variant evidence PubMed IDs, or a variant-normalising
   literature service (PubTator3 / LitVar). If the workspace already fetches ClinVar and UniProt
   records, their citation lists are a **high-precision, variant-specific** source the abstract
   search cannot match (they find papers whose *full text* reports the variant, not just abstracts).
   Surface them as a distinct, labelled provenance — *"cited by ClinVar submission"* — not mixed into
   the tiers. **Verify each service's response shape, rate limits and licence before any code**; this
   proposal does not assume them.
4. **Lexicon on title and abstract.** The fallback for everything the above did not decide.

Every tag records `{ source: "sentence-anchor" | "pubtype" | "curated" | "lexicon", quote }`. The
chip shows the source, so a reader can discount a lexicon-only tag.

### 4b. Mechanism as a juxtaposition, never a tag

"Does the mechanism match the gene?" is a claim about biology, so the screener does not answer it.
It does two things:

- extracts **mechanism terms present** in the abstract (*loss-of-function, dominant-negative,
  haploinsufficiency, gain-of-function, constitutive activation*) with the quote; and
- displays them **beside the gene-mechanism context the workspace already holds** (domain, interface
  and constraint information from the other Evidence tabs; the exact fields to be chosen from what
  those tabs expose, none invented here), headed *"for you to compare"*.

When the paper's terms and the context point opposite ways, the row carries a neutral flag —
**"mechanism terms differ from context"** — which routes attention without asserting who is right
(the context may be incomplete; the paper may be about a different isoform). It is an observation
with two quotes. It must not feed PVS1, PM1, PS3 or any criterion.

### 4c. The "why read this" line

The headline output improvement. Each shortlisted row gets one generated-by-rule line built from its
tags, never free text:

> **Read first** · variant-anchored case: *"…a proband homozygous for p.Asp116Gly presented with…"* ·
> via sentence anchor · mouse model

Rule: tier name + the strongest quote + its source + `model-system` when present. No adjectives, no
score. A row with nothing quotable shows no line (§4's "no quote, no tag").

---

## 5. The ordering rule (attention tiers)

Ordering is where "deserve a read" actually lives, and it must be a rule a reader can restate. Proposed
order, inside the existing variant → gene → elsewhere sort (`literatureEvidence.ts:357,386-390`):

1. **Variant-anchored** — `names-variant` with `functional-assay` or `clinical-case` in the same
   sentence (§4a.1), or a curated variant→PMID link (§4a.3); not `multi-variant`, not `review`
2. **Variant named** — `names-variant` only, or `multi-variant` (open the supplement)
3. **Same residue** — `same-residue`
4. **Gene context** — `names-gene` + (`mechanism` | `functional-assay` | `clinical-case`), or a `review`
5. **Gene only** — `names-gene` only
6. **Full-text only** — `full-text-only` (already last today)

Tiers 1–3 are the *"Read first / Read next"* shortlist of §0.3-A; tiers 4–6 collapse by default and
stay one click away, so nothing is hidden, only deferred.

Within a tier the existing order holds (server newest-first). The tier is printed in the trace beside
the current "variant → gene → elsewhere" line, so the sort is never unexplained.

This is deliberately *not* a score. A rank is a statement about where a row sits, not a claim about the
paper; two rows in the same tier are the same tier.

---

## 6. Where the signal lands, and where it must not

**It lands in three places:**

- **Tab** — a second filter row beside the existing group chips (`LiteratureView.tsx:425-444`):
  *Functional · Clinical case · Mechanism · Review*, each with a live count, disabled at zero, exactly
  like the current controls. Plus the tier ordering above.
- **Export** (`LiteratureInspector.tsx:129-138`) — a `screening:` note per record in RIS/CSV/BibTeX,
  labelled as machine screening. This is the "output" half of the request: an exported shortlist a
  reviewer can act on without re-deriving triage. Per row: `tier`, tags with their `source`, the
  quoted sentence, plus a header block with the retrieval query, the lexicon version, and the date,
  so the file is reproducible and a second reader can see *why* each paper is in it.
- **Evidence summary strip** — above the list, one plain sentence per §0.3-H: *"2 variant-anchored,
  1 same-residue, 9 gene context, 13 other."* Counts of tiers, not a score; zero is shown.
- **Rail** — one line in *"What reads this list"* (`LiteratureInspector.tsx:340-344`) and a method
  note stating: the screener reads titles and abstracts only; it is a lexical triage aid; it is not
  evidence and not an ACMG input.

**It must not land in:**

- **ACMG** — no tag may create, weight, or suggest a criterion. The engine reads no literature today;
  it must read none after.
- **The finding figure** (`literatureEvidence.ts:410-444`) — the headline count stays a count of
  records matched by a stated query. Screening does not become a number in the hero.
- **The narrative's classification language** — see §7.

---

## 7. Reordering the AI-summary inputs (chosen scope)

This is `doc/LITERATURE_TAB_REVIEW.md` follow-up 3, and the phase the reader asked to include.

### 7.1 What happens today

`performGeminiAnalysis` (`gemini.ts:664`) calls `retrieveRelevantLiterature(gene, query, …)`
(`gemini.ts:704-708`) with `query = "${gene} ${variant} functional activity pathogenicity stability"`.
That function (`literature-rag.ts:752-824`):

- reads only the **gene's default cache key** — `literatureCacheKey(cleanGene)`, no custom query
  (`literature-rag.ts:760`), which is why the rail says *"Searches here do not change them"*
  (`LiteratureInspector.tsx:342`);
- embeds the query and ranks **all** gene-wide rows by cosine similarity, taking the top 5
  (`literature-rag.ts:797-819`);
- with a 5-second ceiling (`gemini.ts:707`).

The five citations are interpolated into the prompt as a `[CITED SCIENTIFIC LITERATURE …]` block
(`gemini.ts:710-722`), with author/year grounding instructions. The **variant-scope set** — the papers
that actually name the variant — is never consulted by the summary.

### 7.2 Proposed selection

Replace "top-5 by similarity over the gene-wide set" with a **bounded, screening-driven selection**:

1. **Pool** = gene-wide default set **plus** the variant-scope set, when the variant probe has a cache
   key (`literatureCacheKey(gene, variantSearchQuery(gene, forms))`). This is the change that lets
   variant-naming papers reach the summary at all.
2. **Order** by the §5 tiers, then by embedding similarity within a tier, then newest.
3. **Cap at 5**, preserving the current prompt budget and the 5 s retrieval ceiling.
4. **Implementation decision (2026-10-05): abstracts without embeddings remain eligible** by tier and year. Available similarity breaks ties; missing similarity is not zero and does not exclude cold exact-variant discoveries.

The retrieval signature stays small: `retrieveRelevantLiterature` gains an optional variant-query
argument, or a sibling `selectSummaryCitations` is introduced and the old function is left for the
biophysics-only path. The latter is preferred — it keeps the existing function's tests intact.

### 7.3 Prompt and disclosure changes

Feeding variant papers into clinical prose is the highest-integrity-risk part of this proposal, so the
prompt must say what each citation is and is not:

- Tag each citation in the block with its screening tier and whether it names the variant (e.g.
  `[variant-level, functional-assay, names the variant]`).
- Add an explicit rule to the grounding block: **literature abstracts are context for the
  plausibility prose; they must not be converted into an ACMG criterion, a classification, or a
  statement that a functional study has established pathogenicity.** This mirrors the existing
  deep-evidence rule (`gemini.ts:921`) and the "do not assign a final classification" directive
  (`gemini.ts:906`).
- Keep the existing instruction that a record naming a variant reports nothing about its finding, so
  the model does not treat `names-variant` as a result.

### 7.4 Cache and contract versioning (the reason this is its own phase)

Changing what the narrative is given **must** invalidate every cached narrative, or a re-run of the
same variant is served the old, gene-only summary for the cache's 24 h TTL. The machinery already
exists and must be used, not bypassed:

- Bump `NARRATIVE_PROMPT_SCHEMA_VERSION` `5 → 6` in `src/shared/narrativeSynthesis.ts:66`. The route
  interpolates it into the cache key (`narrative.ts:242`), and `narrativeCacheKey.test.ts` fails if a
  literal reappears.
- Update `NARRATIVE_PROMPT_EVIDENCE` (`narrativeSynthesis.ts:113-126`). Literature citations are
  currently in **neither** its `sent` nor its `notSent` list, despite being sent
  (`gemini.ts:710-722`). This phase is the moment to add them honestly — `narrativePromptEvidence.test.ts`
  reads the prompt source and fails when a named block appears or disappears.
- Bump the **client** cache version too. `narrativeSynthesis.ts:50-54` records why the server half is
  a TTL question but the client half is not: `src/services/pipeline/variantCache.ts` writes
  sessionStorage and `workflowOrchestrator` can replay it without calling the server, so a prompt change
  cannot reach a recently-viewed variant through the server constant alone.
- **Decision to make:** literature is *not* in the evidence hash today
  (`narrative.ts:174-201,230-233`) — the selected citations are a pure function of cache contents, not
  of the hash. With screening-driven selection, two runs over different literature sets can still share
  a key. Options: (a) add a digest of the selected citation ids to `buildNarrativeEvidenceContract`, at
  the cost of more cache misses as new papers land; or (b) accept it, since the prompt version bump
  bounds the staleness to one deploy/prompt generation. This proposal recommends **(a)** for the
  variant-scope contribution specifically, because the whole point of the phase is that variant papers
  reach the prose — a run that had none must not be served a narrative that cited some.

---

## 8. The local model (SemIf-style): read the technique, gate adoption

The reader's framing — *"I'm including openjev as an example because it's computationally cheap"* — is
correct about the mechanism. What SemIf demonstrates (**verified (site)**):

- a small GGUF model runs in-browser via wllama; and
- **direct readout** normalizes the model's next-token distribution over only the supplied options,
  with no decoding — one forward pass instead of an autoregressive loop.

That is a real cost win over calling Gemini per abstract, and it keeps abstracts local.

If Phase 3 is ever attempted, these are the conditions, drawn from what the codebase requires of every
other model:

1. **Closed-set, single-token answers only.** Logit readout works when the answer is one token. So
   Phase 3 asks `Yes/No` questions per criterion (one pass each), never "label this paper" as free
   text. This is a hard constraint of the technique, not a preference.
2. **It replaces Phase 1, or it does not ship.** The deterministic screener is the baseline. The model
   is admitted only if it beats the lexicon on a **hand-labelled held-out set** of abstracts from the
   reference variants (NAE1, PAH, GBA1, FGFR3) — the same shape of evidence `CALIBRATED_STACKING.md`
   demands before any "calibrated" number returns. The evaluation set and its labels must be checked
   in, and a test must fail if the labels change without the evaluation being regenerated.
3. **No probability on screen, even then.** The readout may be used to *order*; the UI shows the tag
   and the quote, never the softmax value.
4. **Opt-in, cached, and off the critical path.** A 0.6–2 GB model competes with the Mol* viewport for
   GPU and bandwidth; it must not load for a reader who did not ask for it.
5. **A browser-local model weakens the audit trail.** The current RAG path runs server-side and
   caches; a browser model's output is not reproducible from a request. If Part 3 is pursued, the
   deterministic tags must still be computed server-side and stored, so the export and the rail have a
   provenance the model cannot provide.

Given (2)–(5), the honest recommendation is: **Phase 3 is speculative.** The lexicon is likely to
capture most of the value, and the model should not be built until the labelled set shows it would
add something.

---

## 9. Shape of the change

| Layer | File | Change |
|---|---|---|
| Model (pure) | `src/shared/literatureScreening.ts` (new) | Lexicon + tag computation + ordering tier; dependency-free, like `literatureEvidence.ts` |
| Model | `src/shared/literatureEvidence.ts` | Extend `PaperReading` with `screening`; fold tiers into the existing sort; add a trace line |
| Tab | `src/components/LiteratureView.tsx`, `literature/PaperTable.tsx` | Filter row; chip rendering with quoted tooltips |
| Rail | `src/components/inspector/LiteratureInspector.tsx` | Screening section; disclosure; export note |
| Server | `server/services/llm/literature-rag.ts` (`PmcPaper`/`toCitation`) | Phase 1a: carry `pubTypeList`, MeSH, keywords through the cache row; schema bump |
| Server | `server/services/llm/literature-rag.ts` (new `selectSummaryCitations`) | Screening-ordered, variant-aware selection |
| Server | `server/services/llm/gemini.ts` | Tagged citation block + the no-criterion rule |
| Contract | `src/shared/narrativeSynthesis.ts`, `src/shared/narrativeEvidence.ts`, `src/services/pipeline/variantCache.ts` | Version bumps; optional citation digest |

---

## 10. Verification

- **Labelled fixture** — the §0.3 synthetic abstracts, plus real abstracts for the four reference
  variants hand-labelled once and checked in. Phase 1 is measured on it for recall of tiers 1–3
  (did the paper a curator would open reach "Read first"?). This is the same set Phase 3 must beat.
- **Unit** — the screener is pure: a test table of (abstract ⇒ expected tags ⇒ expected tier), plus
  whole-word and negation-regression cases (a "non-functional" abstract must not fire
  `functional-assay` on the word "functional" alone once negation is out of scope — it should still
  fire, and the test documents that).
- **Invariant guard** — a test that fails if any screening tag reaches the ACMG criteria or the hero
  figure, mirroring `LiteratureView.test.tsx`'s existing guard that keeps
  `impactFactor`/`journalRank`/`quartile` out (`doc/LITERATURE_TAB_REVIEW.md:42-43`).
- **Cache guard** — `narrativeCacheKey.test.ts` and `narrativePromptEvidence.test.ts` must be updated,
  not silenced; a fake "the prompt changed but the key did not" is the exact defect the version
  constant exists to catch.
- **Rendered** — the headless-Browser harness the tab already uses, for light/dark/narrow and the
  zero-result, degraded and expanded-row states (`doc/LITERATURE_TAB_REVIEW.md:75-77`).
- **`npm run verify`** before push (`README.md:96-106`).

---

## 11. Method limits (to be printed as-is if implemented)

- Screening reads **titles and abstracts only** — no full text, tables or figures.
- It is **lexical**, not semantic: it reports that assay language is present, not that an assay was
  performed on this variant, and not what it found.
- Tiers are an ordering rule, not a quality judgement; no journal metric is computed or shown
  (`doc/LITERATURE_TAB_REVIEW.md:36-43`).
- No screening tag is evidence, and none enters the ACMG verdict.
- On the AI-summary side: the summary is prose grounded in cited abstracts; a citation in it is not an
  assertion that a paper supports the narrative's claims.

---

## 12. Open questions (for the reader to decide before Phase 1)

1. **Taxonomy freeze.** The set is now ten tags (§4). Are `same-residue`, `multi-variant` and
   `model-system` wanted, and is `structural-experiment` (cryo-EM, crystal, NMR) a further one for
   this domain?
2a. **Curated links (§4a.3).** Is a ClinVar/UniProt citation source in scope for Phase 1b, given it
   adds an external dependency and an unverified response shape?
2b. **Mechanism juxtaposition (§4b).** Which existing Evidence-tab fields are trusted enough to
   appear as "gene mechanism context"? A wrong context makes the "terms differ" flag misleading.
2. **Ordering vs filtering.** Should tiers be a default sort the reader can override, or only a filter
   row?
3. **The citation-digest decision in §7.4** — include selected-citation ids in the narrative evidence
   hash (more honest, more cache misses) or leave it out (fewer misses, bounded staleness)?
4. **Phase 3 at all** — is the local model worth an evaluation set, or is the lexicon sufficient?

---

## 13. Sources

- Europe PMC RESTful Web Service — search endpoint; the RAG cache and its schema are in
  `server/services/llm/literature-rag.ts`. (Documentation page refused automated access from this
  environment; behaviour verified by reading the stored queries and the audit doc.)
- Ferguson C, et al. 2021. Europe PMC in 2020. Nucleic Acids Res 49:D1507–D1514. doi:10.1093/nar/gkaa994
- SemIf (formerly OpenJev) — `https://openjev.com/`, read 2026-10-04. Cited **only** for the
  logit-readout technique; it is a method comparison, not a dependency.
- `doc/CALIBRATED_STACKING.md` — the standing rule that no probability is shown without a checked-in,
  regenerated evaluation.
- `doc/LITERATURE_TAB_REVIEW.md` — the audit that fixed this tab's claims; follow-ups 3 and 4 are the
  origin of Phases 1 and 2 here.
