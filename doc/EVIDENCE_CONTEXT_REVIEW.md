# Evidence context review and implementation record

Reviewed 2026-10-06. Both proposals were read in full, independently reviewed, corrected,
and used to start implementation. The revised proposals are the implementation authority:
[Gene–disease](GENE_DISEASE_PROPOSAL.md) and [Expression & models](EXPRESSION_AND_MODELS_PROPOSAL.md).
Original text is retained under `research/`; external audits record reviewer opinions, not
automatically accepted requirements.

## Owner decisions

- Require an explicit disease/inheritance choice before showing disease-specific assertions.
- Keep disease-derived suggestions separate and require manual acceptance. They must never
  become patient observations automatically.
- Context only: leave ACMG rules unchanged, including PM1 and ClinVar clustering.
- Advance both tabs together through a shared frame.
- Accept disease suggestions as individual HPO terms, with organ-system summaries. Accepted
  terms remain review context, separate from patient observations.
- Default main report: brief selected-disease summary, coverage gaps and source dates;
  full evidence in an appendix.

The owner confirmed browser-session persistence per variant with a separate JSON context
export, and dGTEx V1 first after tissue/age manifest validation, followed by complementary
atlases. No cross-restart storage.

## Corrections supported by research

| Finding | Correction and implementation consequence |
| --- | --- |
| dGTEx V1 is released | The 2026-05-13 NDRI announcement reports 379 samples (342 RNA-seq, 37 WGS) from 40 subjects. Replace categorical pediatric unavailability with a download/manifest integration task. Do not imply all ages or clinically relevant tissues are covered. |
| GTEx default gene lookup returns an older reference | Explicit GENCODE v39 resolution is required for v10. FGFR3 `.17` returned empty v10 expression; `.20` returned measurements. Production adapter validates reference, gene identity and response completeness. |
| Pext is not selected-transcript expression | Distinguish base-level from consequence-specific annotation-level pext. `Pext.flags` is supported; region flags are not. CDS coordinates are 1-based inclusive. Null and `low_max_pext` differ. Observed tissue counts are dataset-dependent. |
| Onset is not sampled developmental age | Keep separate fields. Adult GTEx cannot establish absence of developmental expression. |
| GenCC assertions have disease and inheritance scope | Group by stable gene ID, disease ID and inheritance ID. Retain every submitter and disagreement. No strongest-assertion headline, average or fuzzy disease join. |
| Dosage is not missense mechanism | ClinGen haploinsufficiency/triplosensitivity does not automatically establish LoF/activating GoF for a missense disease. G2P mechanism assertions need their own provenance and certainty. |
| ClinVar condition labels discarded identifiers | Preserve raw condition xrefs now. Do not interpret a VCV aggregate as a disease-specific RCV assertion, or match conditions by name. |
| Animal evidence is assay-scoped | Missing annotations do not establish normality. Nonsignificant IMPC results require assay, allele, sex, age, sample count and test coverage; they are not blanket true negatives. |
| Licences have distinct scopes | A paper or software licence does not establish permission to redistribute the database, ontology or phenotype descriptions. Verify each source artifact's terms. |

Verified references and bounded probes:

- [NDRI dGTEx release announcement](https://ndriresource.org/dgtex-project-releases-first-data-on-pediatric-genetic-development/)
  and [developmental GTEx downloads](https://gtexportal.org/home/downloads/developmental-gtex).
- [GTEx API](https://gtexportal.org/api/v2/) and [GenCC downloads](https://thegencc.org/download).
- [gnomAD pext source documentation](https://github.com/broadinstitute/gnomad-browser/blob/main/browser/help/topics/pext.md).
- [Gene2Phenotype](https://www.ebi.ac.uk/gene2phenotype/),
  [ClinGen dosage](https://search.clinicalgenome.org/kb/gene-dosage),
  [HPO annotations](https://hpo.jax.org/data/annotations).
- Probe receipts: `research/evidence-context-probes.json`, `research/followup-source-checks.json`.
  Reproducible bounded probe script: `scripts/probe-evidence-context.mjs`.
- Independent reviews: `EXPRESSION_MODELS_EXTERNAL_AUDIT.md` (DeepSeek) and
  `GENE_DISEASE_EXTERNAL_AUDIT.md` (Gemini). Their stronger claims about true negatives,
  missing pediatric data or automatic mechanistic inference were not adopted.

## Implemented first slice

Shared validated disease/phenotype contracts and selection state support both tabs. Choices
are keyed by gene, protein and variant; source responses are keyed by gene. Changing disease
preserves review systems and onset. Review systems are explicitly local display mappings.

Gene–disease displays exact disease/inheritance frames, per-submitter validity assertions,
assertion dates, report links and an adverse-assertion warning. Missing installation, provider
error and no curated record are distinct states.

Expression & models displays adult GTEx v10 median gene TPM, tissue anatomy IDs and RNA-seq
cohort sample counts. Zero stays measured. Review systems reorder presentation; other tissues
remain reachable. Cartilage, cochlea and ocular coverage gaps are explicit. Adult-reference
limitations appear for earlier onset selections. A separate JSON context export includes
selections, source responses and provenance.

The inspector shows the chosen context, interpretation boundary, source release when known,
retrieval time, terms and fingerprint. Both tabs are registered in navigation and the inspector.
Keyboard focus indicators, labelled controls, pressed chip states, scrollable tables and narrow
container layouts are included. Browser review used actual imported GenCC and freshly fetched
GTEx adapter output in an isolated reference harness at 1280 and 820 pixels, in light and dark.
The harness did not run a variant analysis or bypass production authentication.

ClinVar condition xrefs are now retained without changing existing clinical labels or ACMG
criteria. The ClinVar cache key now retires entries without condition identifiers; old saved
analysis results still need reanalysis to gain them.

## Data operations

Second paired slice completed after the owner confirmed the persistence and pediatric priorities:

- dGTEx V1 public metadata/matrix validated and installed. GENCODE v47 gene resolution is local,
  exact-symbol only; ambiguous symbols fail visibly. SQLite holds per-gene donor medians and a pinned
  manifest, not individual donor identities in exported context.
- **75,738 gene rows; 332 included RNA samples / 34 donors; 51 detailed tissues / 125 tissue–age
  groups**, of which 52 have a single donor. All matrix sample columns exactly match RNASEQ metadata.
  The other 10 RNA samples are explicitly EXCLUDE; 37 WGS samples are not expression measurements.
- Four public AGECOHORT labels are retained verbatim. Exact ages are protected. No inference of
  neonatal coverage, HPO age equivalence or prenatal sampling. Source cohort filtering is separate
  from saved onset. No batch/sex adjustment or developmental trajectory is claimed.
- Medians are derived across donors after a within-donor median for repeat tissue samples. Table
  rows include both donor and RNA sample counts and flag a single donor.
- G2P installed **3,851 records / 3,166 genes**, retaining mechanism support, modifiers, relationship
  confidence, publications and review date. Exact HGNC/MONDO joins only; a documented local display
  mapping compares AD/monoallelic and AR/biallelic labels. Other allelic scopes remain separate;
  modifiers do not silently establish variant applicability. FGFR3 achondroplasia's “restricted
  mutation set” remains explicit. G2P validity already present in GenCC is not counted again.
- Browser-session per-variant restoration is tested. Separate context JSON export now includes
  pediatric observations and G2P source records. Both additions remain context-only.

Run `npm run data:dgtex` to download the four public V1 input artifacts and atomically build
`data/dgtex-context.sqlite`. Python standard library only; no pandas/openpyxl dependency.
For existing original artifacts: `npm run data:dgtex -- --input-dir <directory>`; filenames must
match the portal. Optional artifact override: `DGTEX_CONTEXT_PATH` or CLI `--output`.
Inputs are kept under ignored `data/dgtex-v1-input/`; snapshots must be installed on each deployment.
Run `npm run test:evidence-context-import` for importer verification, also part of `npm run verify`.

Run `npm run data:g2p` or `npm run data:g2p -- --input <csv>` to atomically install
`data/g2p-context.json`; optional override: `G2P_CONTEXT_PATH`.
Fingerprint: `86374a1d24168fb3cb2eac189daa1a5ed543dbccf360b58ab0bc55a16955e799`.
EMBL-EBI Terms of Use are linked by the source; no paper/software CC licence is applied to the data.

dGTEx provenance combines the original input-file hashes. The manifest receipt and download catalog
are retained in `research/dgtex-v1-manifest-audit.json` and `research/dgtex-download-catalog.json`.
The combined fingerprint is `c1c4b6a92ab7c6278be16b1781a4fab9b7da772af3d0df789cd884edde6cb0aa`.
The [GTEx Portal licence](https://gtexportal.org/home/license) requires attribution/no endorsement,
and either current redistributed data or a conspicuous indication that it is not current. The UI
identifies the pinned V1 snapshot; no automatic refresh occurs.

Run `npm run data:gencc` to install/refresh a fully validated snapshot atomically.
For a separately downloaded CSV: `npm run data:gencc -- --input <path>`.
Default artifact: `data/gencc-context.json`; optional override: `GENCC_CONTEXT_PATH`.
The local artifact is ignored by git and must be installed on each deployment.

The reviewed import contained **30,345 assertions across 6,109 genes**. Raw CSV fingerprint:
`aa3ffd0ba4105e735af393f40130f9fdf00281372fbf8c2871a0fd352d911ca4`.
No release identifier is invented for this snapshot.

GTEx is a validated live adapter with a 24-hour bounded cache and coalesced requests. It is
not an offline snapshot. It sends the gene symbol and resolved GENCODE identifier; disease,
onset and system selections remain in the browser. GenCC is downloaded in bulk by the operator,
with no per-case outbound query. Both are credited in the attribution registry.

## Remaining limitations and paired implementation order

1. **Disease annotations and mechanisms:** install pinned HPO annotations with qualifiers and
   onset; implement separate suggestions/manual acceptance alongside the installed G2P mechanisms and
   ClinGen cross-check/dosage. Keep incompatible disease granularity and inheritance visible.
2. **Development and transcript context:** complement the verified dGTEx V1 public cohorts with
   prenatal/organ-specific atlases; add coordinate-validated pext alongside
   disease-conditioned ClinVar RCV context. Do not promote either to ACMG votes.
3. **Human and animal context:** add HPA with assay/antibody confidence, curated orthology and
   allele/assay-scoped MGI/ZFIN/IMPC records. Preserve unmapped phenotypes and native stages.
4. **Durable export and operations:** integrate context with the main report/session exporters,
   establish pinned ontology/dataset refresh manifests and test identity migration explicitly.

These are planned integrations, not populated features. The current UI states what is missing.
There is no phenotype similarity score, consensus validity score, automatic disease mapping,
protein-level expression inference from RNA, or new ACMG criterion.

## Verification

- `npm run lint`: passed, including type checking, boundaries and focus indicators.
- `npm test -- --reporter=dot`: **307 files passed, 2 skipped; 3,985 tests passed, 5 skipped**.
- `npm run test:evidence-context-import`: **4 tests passed**, including truncated-import atomicity,
  cohort/schema checks, complete sample reconciliation and repeat-donor weighting.
- `npm run build`: passed for client, server, workers and protocol assets. Existing large client
  chunk warnings remain; no build error.
- Meaningful new coverage: conflicting assertions/inheritance identity, CSV schema drift,
  missing/corrupt snapshot recovery, GTEx reference/pagination/identity, zero versus missing,
  context selection and visible UI boundaries, raw ClinVar xrefs and source disclosure.
  Added dGTEx/G2P identity and missing/corrupt/ambiguous snapshot states, per-variant session
  restoration, source age filtering independent of onset, and restricted mechanism modifiers.

Second-slice UI review used the actual installed dGTEx/G2P data at 1280 and 820 pixels in both
themes. Tables scroll within their cards without page overflow. Switching from AD to AR retained
the disease-specific assertion frame and moved the incompatible G2P allelic record into a separate
disclosure. Temporary fixtures and the preview harness were removed afterward.

No deployment, commit or pull request was performed.

## Implementation re-audit

See [the complete implementation audit and production runbook](EVIDENCE_CONTEXT_IMPLEMENTATION_AUDIT.md)
for corrected snapshot integrity, selection identity, cache retirement, export states and packaging.
Selection identity now includes transcript, isoform, assembly and resolved locus; old ambiguous
session keys are not automatically migrated. JSON context export uses schema v2. Source-verified
G2P choices extend the selector beyond GenCC while preserving missing versus uncurated validity.
HPO-only choices and other allelic mappings remain to add. Production snapshots are operator-managed;
new import receipts distinguish download time from local import time.

Re-audit verification: **310 test files / 4,000 JavaScript tests passed**, 2 files and 5 tests
skipped; four Python importer tests, lint and production build passed. Final client and server
bundles were rebuilt after reviewer fixes. Exact-ID choice expansion,
snapshot consistency and prototype-key recovery have regression coverage. HPO shared context
is the next paired slice, followed by main report/export round-trips.
