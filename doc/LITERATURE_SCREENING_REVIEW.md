# Literature screening review and next phases

Reviewed 2026-10-05 against NAE1 p.Asp116Gly (UniProt Q13564). Phases 0, 1a and 1 are implemented, including the constraint comparison panel. Changes remain uncommitted.

## Findings fixed

| Severity | Finding | Fix and regression coverage |
|---|---|---|
| High | Client Zod validation discarded publication types, MeSH headings and author keywords returned by the server. The rendered trace said 0/25 publication types despite the API returning 25/25. | Preserve optional metadata in `clinicalApi.ts`; API regression checks all three fields survive validation. Older payloads still work. |
| Medium | Any review was promoted to Gene context, even when its title and abstract named neither NAE1 nor the variant. | Tier 4 now requires a gene mention; unrelated reviews remain tier 6. Pure screening regression covers both cases. |
| Medium | Newest returned retrieval order, and the trace described every retrieval as newest first. | Sort loaded records by year descending, missing years last, stable ties. Attention ties preserve retrieval order. Model and UI tests start with nonchronological input. |
| Low | Empty screening intersections lacked a regression test. | Test disjoint functional and clinical papers, the empty-state explanation, and restoration through Clear screening filters. |

Screening does not enter the hero count or ACMG engine. Quote and source labels remain observations from titles, abstracts and publication metadata. Lexical tags do not handle negation or establish experimental validity.

## Rendered checks

Started the real app with `npm run dev`. The T3 collaborative preview opened and accepted the reference variant, then reported an unavailable automation host. Completed inspection with local headless Edge and Playwright against the same running application.

Refreshed the real Europe PMC response: 750 default-query matches, 25 loaded records, 25 carrying publication types. The protein-notation query returned 0 records. The corrected loaded shortlist has 0 Read first, 11 Read next and 14 other records. This is a sample of the first search page, not an exhaustive literature assessment; other variant notations can be missed.

Inspected light, dark, expanded-paper, 800 px narrow, zero-result and degraded-response screens. The matrix replayed the captured live response for consistent comparison; zero and degraded states used controlled responses. No page errors were recorded. At 800 px, the document had no horizontal overflow and the table wrapper measured 430 px client width and 430 px scroll width. Screenshots and browser scripts are in ignored `scratch/literature-browser/`.

## Validation

`npm run lint` (boundaries, focus indicators, verification parity and TypeScript) passes. The final full Vitest suite passes: 294 files passed, 2 skipped; 3,886 tests passed, 5 skipped. `git diff --check` passes. No push or deployment was performed; the full `npm run verify` deployment, coverage, geometry and production-build gates remain required before a push.

## Phase 1b: curated variant citation links

Start with UniProt natural-variant feature evidence. The existing adapter in `server/services/external-api/uniprot.ts` already retains `evidenceCode`, `source`, `id` and substitution `change`; the original proposal's blanket claim that no citation evidence is retained is outdated. UniProt natural-variant PubMed evidence verified live and implemented on 2026-10-05. Human taxon, gene/accession identity and exact substitution are checked; isoform numbering is refused. Curated-only papers remain separate from query membership and counts. ClinVar deferred until exact VCV identity and variant-specific citation semantics are established. The numbered list below records the original acceptance brief.

1. Match the exact accession/isoform, position, reference residue and alternate residue against a Natural variant feature. A same-position feature for another substitution is a separate relationship.
2. Resolve only documented PubMed evidence IDs on that matched feature. Preserve provider, feature identity, variant identity, PMID and retrieval time. Fetch citation records by those IDs and deduplicate them with search results.
3. Display the relationship as Cited by UniProt variant record. A curated link is a record relationship, not proof that an abstract names the variant or that a paper supports pathogenicity. It may have no abstract sentence to quote; carry provider provenance separately from quote-backed screening tags.
4. The current `curatedVariantLink` hook requires a variant quote before promotion. Extend the contract explicitly for full-text-only curated links, with provider provenance and tests, rather than faking a quote or silently treating a gene-wide bibliography as variant-specific.
5. Add ClinVar submission citations only after verifying the exact variant/submission-to-PMID response shape and mapping. Do not promote gene-level, condition-level or neighbouring-variant citations.

Acceptance: exact versus same-residue mapping, numbering/isoform mismatch, duplicate PMIDs, absent citations, upstream failure, and curated papers with no abstract mention. Preserve exports and ACMG isolation. Verify documented service limits and reuse terms; no claim about those is established by this review.

## Phase 2: summary selection and citation digest

Implemented 2026-10-05 in `literature-summary.ts` and the shared `literatureSummary.ts` model. The narrative route selects before cache lookup and passes that exact selection to the prompt. A separate SHA-256 literature digest extends the server cache key; the client biological-evidence revision remains client-computable. Prompt schema is now 6, evidence contract 4, and client bundle cache v4.6.

The selection retains records without embeddings by screening tier and year rather than excluding newly discovered variant papers. Available similarity breaks within-tier ties; it never determines admission. A five-second deadline bounds retrieval, including a provider that ignores cancellation. Late responses cannot mutate the already selected snapshot. Curated PMID hydration uses an exact identifier query without a gene filter and leaves search-cache membership untouched.

Regression tests cover exact-variant priority, five-item cap, deduplication, missing embeddings, incomplete variant retrieval, a hung optional provider, late-result snapshot stability, content-dependent cache invalidation, cache-hit reuse, and prompt no-criterion instructions. The remaining numbered list records the original implementation brief and acceptance requirements.

The selector runs cold variant retrieval independently of opening the tab. The inspector describes the implemented selection; local tab searches do not control AI selection.

1. Introduce a bounded `selectSummaryCitations` that merges default and variant-query cache memberships, deduplicates IDs and uses the shared screening tiers. Keep the existing five-abstract cap and retrieval deadline. Specify cold variant-cache behavior explicitly so first-run selection does not depend silently on whether the Literature tab was opened.
2. Rank within a tier by valid embedding similarity, then year and stable ID. The existing proposal excludes records without embeddings: test that policy explicitly, especially for newly found exact-variant papers, and expose incomplete selection rather than imply comprehensive coverage.
3. Select once before the narrative cache lookup. Hash the selected prompt inputs and pass that same selected set into `performGeminiAnalysis`; it must not retrieve a second, potentially different set after the hash is computed. Include IDs, source relationships, screening version and abstract content in the digest so changed content under the same PMID also invalidates prose.
4. Version the prompt (`NARRATIVE_PROMPT_SCHEMA_VERSION`, currently 5), narrative evidence contract (currently 3) and client variant cache. Decide server ownership of the literature digest explicitly: a client cannot hash an unseen server-selected set. Keep the client revision and server cache identity contracts consistent and test cold cache and client replay paths.
5. Include quoted screening observations with sources in the prompt, plus the explicit instruction that tags and curated citation links create no ACMG criterion. Update the inspector's AI-summary disclosure and the prompt-evidence inventory to describe the final selector.

Acceptance: exact-variant papers beat gene-only similarity hits; stable deduplication and five-item cap; missing embeddings and retrieval failures; one selection shared by hashing and prompting; digest changes when selected IDs/content change; prompt and client cache invalidation; no new rule-engine criteria. Existing guards: `server/routes/variant/narrativeCacheKey.test.ts` and `src/shared/__tests__/narrativePromptEvidence.test.ts`.

## Phase 3: optional local model

Prepare a curator-labelled held-out set for NAE1, PAH, GBA1 and FGFR3 before adopting a browser model. Measure incremental recall and false positives against the deterministic baseline. Synthetic rule tests are not an accuracy evaluation. Keep the model optional and off the critical path; no performance or accuracy claim is established here.

## Sources

- Europe PMC search/core response captured locally on 2026-10-05; query and provenance displayed by the tab.
- Ferguson C et al. Europe PMC in 2020. DOI: 10.1093/nar/gkaa994.
- Existing UniProt feature adapter and narrative selection/cache implementations named above; UniProtKB Q13564 natural-variant evidence verified live; ClinVar citation integration deferred for the identity and semantics limitations above.

## Final Phase 1b / 2 validation (2026-10-05)

Full Vitest: 298 files passed, 2 skipped; 3,938 tests passed, 5 skipped. `npm run lint`, production `npm run build` and `git diff --check` pass. Live NAE1 p.Leu49Phe / Q13564 resolves PMID 36608681 through VAR_088123, displayed separately from the 25 query records and included in read-first screening. NAE1 p.Asp116Gly retains its notation-specific zero-query result. The curated row and source link render in light, dark and an 800 px viewport; no document or table overflow (420 px client and scroll width). Inspector order count follows the active screening filters. Literature request cancellation uses response disconnects, avoiding normal request-completion cancellation. Gemini 3.8 full code review is the next independent validation. Changes remain uncommitted; no push or deployment.

## Independent Gemini review (2026-10-05)

Gemini 3.8 Flash High through Antigravity completed a read-only review of screening, curated citation identity/provenance, summary selection/cache integration, API/client handling, UI/export contracts and tests. It reported no high-, medium- or low-severity defects. The first OpenCode attempt failed with “Model unavailable” before reviewing; the Antigravity review completed successfully.

The reviewer noted two existing limits: curated hydration rejects more than 25 distinct PMIDs, and narrative abstract excerpts are capped at 800 characters while screening uses the full abstract. Neither required a code change. ClinVar citation mapping and the optional local model remain deferred. This code review does not establish clinical validity or measured screening accuracy; a curator-labelled held-out evaluation remains the prerequisite for Phase 3. Changes remain uncommitted.


## Post-merge relevance and UI follow-up (2026-10-06)

The screenshot audit uncovered defects missed by the preceding review: plural clinical language and publication types were under-recognized; normal retinal structure was tagged as a mechanism; explicit assay absence could be promoted; full-text-only and broad absence claims exceeded supplied evidence; useful papers beyond the first 25 could not be loaded; unrelated abstracts could enter the narrative. The previous clean code review is not a clinical accuracy claim.

This pass addresses those findings with lexicon v2, source-backed quotes, narrow protein-notation zero-result language, no inferred full-text labels, and inheritance-aware constraint disclosure without a mismatch warning. Local filtering includes MeSH and author keywords. Verified transcript cDNA aliases from the same resolved allele are carried into the result and offered as an explicit separate search; protein-only input is not reverse-mapped to an allele.

The tab now defaults to Read first, then Read next when no Read first papers exist. Weaker papers remain under All loaded. Cursor-based 25-record pages preserve filters, deduplicate records and distinguish query records from curated additions. Search presets, collapsed refinements, direct paper links and more informative reading reasons reduce control clutter. Ordinary tab requests use cache/search reads without per-paper embedding calls.

Narrative selection retrieves bounded gene, protein-notation and clinical/functional pools under the five-second deadline, preserves completed pages on later failure, excludes papers lacking target gene/variant/provider relationships, and records counts, truncation and failures. A server-authored receipt survives response validation and narrative merging so the inspector shows the actual selected papers, or explicitly says that an old result has no receipt. Relevant excerpts can begin near an anchored passage. Prompt schema is 7; selection version is 2; literature cache schema is 3. No screening observation, contextual ranking or curated relationship enters the ACMG rule engine.

Verification: full Vitest passed 4,028 tests with 5 skipped before the final scope/applicability edge-case additions; the affected three-file regression suite then passed 52 tests, receipt replacement/clearing passed 24 tests, and the final degraded-state label checks passed 61 tests. Lint, TypeScript, production build and diff checks pass. Controlled real-component browser fixtures verify RGS9 clinical recognition, focused defaults, appended-page filter retention, receipt rendering and notation-zero language. Light and dark layouts were checked at 800, 1280 and 1440 px without horizontal document overflow. The native preview screenshots have insufficient sharpness for a pixel-level typography verdict. Live Europe PMC confirms a first-page cursor is available. This is not a live end-to-end synthesis or measured relevance evaluation.

The next upgrade is disease/phenotype-guided reading: optional disease/HPO input with clearly labelled gene-disease fallback, broad retrieval and a focused shortlist. The owner agreed to RGS9 p.Cys182Ser, NAE1 p.Asp116Gly, PAH p.Arg408Trp, GBA1 and FGFR3 as benchmarks. Context contracts, provenance/cache requirements, held-out evaluation and optional model gates are specified in [LITERATURE_UPGRADE_PLAN.md](LITERATURE_UPGRADE_PLAN.md). Exact GBA1/FGFR3 variants and expert paper labels remain to be curated. ClinVar citation semantics, full-text extraction and a local decision model remain deferred.

The independent Antigravity Gemini 3.8 Flash High review completed. It ran 110 focused tests and lint, inspected the component harness at 800 px, and probed live Europe PMC pagination. It reported three actionable findings, all addressed:

- Singular `study` was absent from assay-absence detection. Both singular/plural forms now suppress the tag/promotion for unperformed studies; PAH regression cases cover both sentence forms while retaining measured absent/reduced activity results.
- A partial final page retained an advanced cursor and offered an unnecessary request. Pagination now ends on a short provider page. The check uses the raw provider record count, so a full page containing records omitted by normalization does not prematurely hide subsequent pages. Regression cases cover a full page, partial final page, exhausted cursor and body-read timeout.
- The receipt displayed `1 abstracts`. It now pluralizes correctly.

Post-review verification: four affected suites passed 56 tests; lint and diff checks passed. The prior full suite remains 4,028 passed / 5 skipped, with additional focused regressions run after the small review fixes. The reviewer assessment is code/fixture verification, not an expert-labelled relevance benchmark. The disease/HPO upgrade and deferred citation/model work remain future work. Changes remain uncommitted.


## PR verification (2026-10-06)

Rebased the working changes onto current `origin/main` by creating `fix/literature-triage-polish`; the previously merged SASA branch contributes no extra PR commits. `npm run verify` passed: lint, deployment failure paths (10 tests), evidence-context imports (4 tests), Vitest coverage (4,040 passed / 5 skipped, 314 files passed / 2 skipped), header and function-track geometry, and production build. `npm run audit` passed its production critical-severity gate; cached diff checks pass. The unrelated untracked `doc/COMPUTE_ROUTING_PLAN.md` is excluded from this commit.
