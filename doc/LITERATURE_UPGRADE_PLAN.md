# Literature upgrade: disease and phenotype context

Owner decisions, 2026-10-06:
- Broad retrieval with a focused default shortlist; weaker matches stay accessible.
- Disease/phenotype-guided reading is the next upgrade.
- Optional disease/HPO input, with explicitly labelled gene-disease associations as fallback.
- Benchmark genes: RGS9 p.Cys182Ser, NAE1 p.Asp116Gly, PAH p.Arg408Trp, GBA1 and FGFR3. Choose the exact GBA1/FGFR3 variants during benchmark curation; do not guess their numbering.

## Current implementation and boundaries

The current pass fixes case/plural clinical recognition, publication-type support, explicit assay-absence promotion, matching quotes, false full-text labels, inappropriate constraint warnings, metadata narrowing, summary eligibility and selection receipts. The tab supports cursor-based pages, clinical/functional query shortcuts, inexpensive cache reads and a default Read first/Read next shortlist. The summary retrieves at most four gene pages, four protein-notation pages and two clinical/functional pages under a shared five-second budget; provider coverage and truncation are recorded. Curated links remain separate from query membership.

Verified cDNA aliases are carried from the same successful translation's transcript consequence into the variant result, bound to the resolved gene, canonical accession and protein substitution. The tab offers a separate explicit alias search. Unverified numbering supplies no aliases. Protein-only queries cannot identify a unique nucleotide allele; no reverse mapping is invented. Old cached results may have no aliases or narrative receipt. Allele identifiers remain notation search hits, not assertions that a paper supports pathogenicity.

ClinVar citation mapping still requires verified exact VCV/submission identity and citation semantics. The local model remains optional and unevaluated. No literature tag, contextual ranking or provider citation relationship enters ACMG criteria.

## Recommended next phase

1. Add an optional compact Context control: disease label plus optional ontology ID; selected HPO terms with IDs and labels. Keep patient narratives out of search requests. Display the origin of every term: user-selected or curated gene-disease fallback. Permit correction/removal; avoid silently choosing one disease for pleiotropic genes.
2. Define one shared, versioned context contract. Canonicalize identifiers and deduplicate terms. Bind it to gene, variant, transcript/allele provenance where available, and the current analysis run. Include its digest in search and narrative cache identities. Reset stale context when the variant changes.
3. Retrieve separate bounded pools: exact protein and verified nucleotide notations; gene plus selected disease synonyms; gene plus HPO labels; gene clinical/functional background. Retain query, source, total hits, loaded count, truncation and failure for each pool. Gene fallback must never masquerade as user phenotype input.
4. Distinguish relationships: exact variant, another variant in the same gene/disease, gene mechanism, model-organism context, disease background and unrelated. Disease names alone do not establish patient/variant relevance. Store the exact passage supporting each relationship. Support conflicting, absent and inconclusive functional findings.
5. Rank by relationship and study context, then current deterministic screening. Keep all retrieved records accessible, explain the preferred shortlist and export its context/provenance. Show the actual narrative receipt and allow explicit re-synthesis with the chosen context.
6. Curate and freeze the held-out set before adjusting rules. Add temporal holdout and transcript/legacy-notation cases. Include every known relevant paper even when retrieval misses it, so recall is not measured only inside the fetched pool.

## Evaluation contract

One adjudicated row per query-paper pair:
`case_id, gene, canonical_variant, allele/transcript, disease_context, hpo_context, PMID/PMCID, publication_date, title, abstract, provider_metadata, expert_relationship, should_read, reason, source_url, reviewer, adjudication_status`.

Required negative controls: different alternate at the same residue; a variant in another gene; common-word gene collisions; animal homologs; unrelated papers matched outside abstracts; a negated assay; a review listing many variants; a clinical case described only in plurals; conflicting mechanism and mixed-disease cohorts; old protein nomenclature and cDNA-only titles.

Compare the merged baseline, this deterministic pass and the contextual upgrade on the SAME frozen query-paper universe. Measure retrieval recall against all adjudicated relevant IDs, precision at 5/10, useful-paper coverage, false-negative rate for exact-variant functional/clinical papers, and false-positive rate for unrelated papers. Report per-gene results as well as aggregate results. Also measure cold/warm latency, request count, provider failures and partial coverage. Set acceptance targets with the curator after the baseline is measured; synthetic unit tests are not measured clinical accuracy.

## Upgrade options after contextual retrieval

| Option | Benefit | Gate / cost |
| --- | --- | --- |
| Context-aware deterministic rules (recommended) | Explainable, inexpensive disease/HPO-guided shortlist | Curator-labelled baseline; verified ontology terms and explicit fallback provenance |
| Optional local decision model | Better contextual sentence interpretation and negation | Must improve held-out recall/precision over rules; measure model size, load time and inference latency; keep deterministic fallback |
| Server model for difficult papers only | Richer passage-based relation extraction | Opt-in bounded calls, quotes validated against supplied text, measured incremental benefit and cost |
| Full-text extraction | Tables and supplement-level variant/assay evidence | Access/licensing checks, section/table provenance and separate failure states; no automatic ACMG criteria |
| ClinVar citation enrichment | Variant-linked records beyond UniProt | Exact VCV/submission mapping and variant-specific citation validation |

No model option is selected or installed by this plan. Disease/phenotype context comes first.
