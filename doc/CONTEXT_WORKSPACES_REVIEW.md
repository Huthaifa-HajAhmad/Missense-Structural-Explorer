# Gene–disease, Expression and Species & models workspaces

10 October 2026. Continues the Landscape, Structure, Energetics and first Evidence workspace batch.

## Outcome

Gene–disease now compares submitted categories in an interactive assertion matrix. Selecting an
assertion or dosage record pins its exact scope, date and source report in the inspector. Categories
are not converted to scores or averaged. Existing mechanism qualifications and ClinVar locus
boundaries remain available below the comparison.

The former Expression & models tab is split into Expression (the existing `expression-models` ID
remains valid) and Species & models (`species-models`). Both share the existing disease,
inheritance, onset and review-system selection. Neither treats those choices as patient findings.

Expression uses the installed TanStack renderer for adult and pediatric RNA, with separate source
views, tissue search, an optional review-system filter, public pediatric cohort filtering, exact
records and a linked inspector. Each source's linear domain remains fixed under filtering.
Missing medians have no point; a measured zero has a point at zero. Protein Atlas, pext and
pediatric source tables are separate disclosures with their own original units and limitations.

Species & models provides ortholog, variant-site and phenotype views. One-to-many orthologs remain
separate; alignments verify the human sequence/reference residue before mapping gapped columns.
Each selected record exposes its provider identity and limitations. Phenotype overlap names the
disease HPO terms matched through uPheno; it is not a patient similarity score. Partial phenotype
parsing and per-ortholog provider failures are visible.

## Findings and corrections

| Severity | Finding | Correction and regression coverage |
| --- | --- | --- |
| High | A sampled GTEx tissue with no gene median could become “not sampled.” | Separate `no-reading` from `not-sampled`, including the hero; `src/test/contextWorkspace.test.ts`. |
| High | ClinGen HI 40 could be described as corroborating a G2P gain-of-function mechanism. | No positive mechanism inference from evidence against dosage sensitivity; `geneDiseaseEvidence.test.ts`. This changes context prose, not ACMG rules. |
| Medium | Only the first returned IMPC screen was rendered. A null availability flag was treated as false. | Render each returned screen, and distinguish true, false and unknown availability. Existing screen assertions remain in `EvidenceContextTabs.test.tsx`. |
| Medium | Unknown Alliance match directions read as “Not a best match.” | Explicitly report incomplete match-direction information. No ortholog is dropped. |
| Medium | Species grouping relied on display names. | Group by taxon identity and retain every ortholog. Provider-specific gene identifiers are never merged by symbol. |
| Medium | Gene–disease counted disease/inheritance frames as distinct diseases. | Label the count as frames; `contextWorkspace.test.ts`. |
| Medium | The displayed phenotype rows could be fewer than the provider's total without disclosure. | Display unresolved-summary coverage and failed orthologs; model/production integration fixtures cover the distinction. Raw unparsed statements remain a follow-up. |
| Medium | Entering Expression or warming context started the animal providers too. | Separate human and animal loading; prefetch only disease/dosage. Pending requests and successful responses remain shared. Hook tests cover request boundaries and remount coalescing. |
| Medium | Context inspectors subscribed to the whole analysis store. | Read-only, shallow-selected source slots and memoised shared models. Inspectors initialise no API client and issue no requests. |
| Low | Large secondary tables mounted even when closed. | Workspace disclosures mount contents on demand and retain their open state across tab navigation. |

## Architecture and state

- `shared/contextWorkspace.ts`: typed presentation readings, exact keys, interpretation notes,
  source facts and bounded filtering. It wraps the existing scientific models and creates no votes.
- `hooks/useContextWorkspace.ts`: common model construction for the tab and inspector. The read-only
  path uses Zustand selectors; the active path uses the existing authenticated context loaders.
- `ContextExplorer.tsx`: categorical matrix, biological alignment rows, lazy TanStack RNA comparison,
  source records, search and disclosures. Styles are owned by `context-workspace.css` (`cx-`).
- `EvidenceWorkspaceProvider`: existing variant-scoped state extended with source view, search,
  cohort and review filter. Pins and filters survive navigation; a changed analysed identity clears
  them. Disease-specific assertion/phenotype keys include the disease frame. An out-of-view pin
  remains inspectable, with a visible explanation. Open inspector transfers keyboard focus.

## Density and source audit

Read the current GenCC, GTEx, dGTEx, Alliance/IMPC, alignment and model-phenotype contracts and their
server adapters. Local installed GenCC audit: densest single frame AGL, 10 assertions in three
categories; most frames LMNA, 26; SOD1, four frames/seven assertions. The dGTEx database contains
75,738 gene rows. No snapshot was changed or refreshed for this pass.

The primary list is bounded to 20 readings. Search and “Show all” retain access to all matches;
quantitative plots remain bounded to 20, with an explicit notice and full source records. A 150-row
fixture checks density and reachability. Browser scenarios use schema-checked, clearly labelled
illustrative values, including conflict, one-to-many orthology, zero, missing median, alignment
mismatch, one-donor cohorts, partial parsing and provider errors. These are not real clinical data.

## Verification

Targeted checks: 74 tests passed. The full suite completed with 345 files passing, two skipped,
and one failing static status-label guard (4,402 tests passed, four failed, five skipped).
The guard expected direct canonical-label imports in views that now delegate status rendering.
It now verifies both the actual delegate import and the delegate's canonical source. Its affected
file was rerun: all 131 tests passed, resolving all four full-suite failures. The entire suite was
not repeated after this test-only correction. Production build and final lint (including TypeScript)
passed. An earlier interrupted run's Energetics timeout did not recur in the completed full run.

Browser checks in the real AppViews wrapper: light/dark, desktop, approximately 800px and 390px;
matrix-to-inspector pinning; keyboard selection in the real TanStack chart; exact zero; cohort
filtering; alignment pinning; all three source-record views without page overflow at 390px;
mobile inspector expansion/focus. Live scientific providers were not rerun. Preview `/api/`
requests are blocked; warnings from other mounted application views are expected.

## Boundaries and follow-ups

- No ACMG criteria, weights, votes, thresholds, predictor values or provider endpoints changed.
- No new atlas or animal assay integration was added. The source response does not expose full
  allele/genotype, procedure, sex, stage or sample-count detail for phenotype summaries. The
  inspector explicitly says so; this pass cannot turn aggregate annotations into functional evidence.
- Unresolved phenotype summaries are counted, not reconstructed. Retaining their raw statements
  with parser diagnostics requires a provider-contract extension.
- Existing HGNC/alias dosage lookup limitations, unsupported G2P allelic mappings, prenatal atlases,
  selected-transcript expression and annotation-level pext remain as documented in prior reviews.
- HPA's RNA summaries and protein evidence/antibody reliability remain distinct; “protein evidence”
  is not a tissue-level protein abundance measurement.
- Source-record disclosures retain their established tables. The primary workspace handles bounded
  exploration; expanding full secondary records can still render a large table.

## Sources

Primary documentation checked during this pass:

- [ClinGen dosage sensitivity curation](https://clinicalgenome.org/working-groups/60031/): the
  assessment concerns dosage sensitivity. The removal of inferred GoF corroboration follows that
  scope; it is not a new published classification rule.
- [Ensembl Compara protein trees](https://jun2026.archive.ensembl.org/info/genome/compara/homology_method.html):
  orthology and one-to-many relationships, distinct from functional equivalence.
- [IMPC gene pages](https://www.mousephenotype.org/help/data-visualization/gene-pages/): phenotype
  summaries and experimental results need their own coverage context.
- [gnomAD pext documentation](https://github.com/broadinstitute/gnomad-browser/blob/main/browser/help/topics/pext.md).
- Existing source validation, release receipts and publication references:
  [context implementation record](EVIDENCE_CONTEXT_REVIEW.md),
  [Gene–disease review](GENE_DISEASE_REVIEW.md), [Expression review](EXPRESSION_MODELS_TAB_REVIEW.md).

The GenCC FAQ fetch was blocked (403); no new assertion about its criteria was derived from that
page. This pass adds no numerical scientific cut-points and therefore no new calibration citation.
