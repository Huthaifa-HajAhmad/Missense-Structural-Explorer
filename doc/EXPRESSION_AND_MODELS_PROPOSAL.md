# Expression & models — phenotype-driven biological context

**Revision 5, 2026-10-06. Implemented: adult GTEx v10, pinned dGTEx V1 and audited shared context.**
Companion: [Gene–disease](GENE_DISEASE_PROPOSAL.md). Original survey:
`research/EXPRESSION_AND_MODELS_PROPOSAL_REV2_1.md`; v1 appendix: `TISSUE_EXPRESSION_PROPOSAL.md`.
This revision supersedes their conflicting implementation instructions.

## 0. Aim and owner decisions

Where, at what sampled stage, and in which organism is the gene measured or perturbed?
Context only: no relevance score, pathogenicity claim, ACMG vote or cross-source evidence tally.

The owner confirmed explicit disease choice, **manual acceptance** of suggestions, unchanged ACMG
rules and advancing both tabs equally. Selected systems reorder/emphasise observations; all tissues
remain reachable. No selected systems means a plain gene profile.

## 1. Corrections that change the plan

### Pediatric reference: dGTEx V1 is released

The old “no release / watch only” claim is wrong. NDRI's **2026-05-13** announcement reports
**379 samples (342 RNA-seq, 37 WGS), 40 subjects**, open-access downloads. Independently confirmed
through primary HTTP/page sources on 2026-10-06:
<https://ndriresource.org/dgtex-project-releases-first-data-on-pediatric-genetic-development/>
and <https://gtexportal.org/home/downloads/developmental-gtex>.

Promote dGTEx to a **real, sparse pediatric source**, not a comprehensive baseline. Its public
tissue × age-cohort × donor manifest is now ingested. The current adult GTEx REST dataset list does
not expose dGTEx (independent HTTP review). Use a pinned download-derived per-gene artifact, not
guessed dataset IDs. The public metadata has four coarse AGECOHORT labels; exact age fields are
protected. Eligible matrix columns reconcile to **332 RNASEQ samples / 34 donors**; metadata also
contains 10 EXCLUDE and 37 WGS samples across 40 subjects. Never claim exact neonatal/infantile
coverage from the source's “Infant (0 to 2 years)” label. The v1 appendix's categorical “no multi-organ infant reference”
claim is withdrawn; coverage must be assessed per actual dataset.

BrainSpan, HDBR and Cardoso-Moreira remain complementary. Cardoso-Moreira's human accession is
E-MTAB-6814; mouse **E-MTAB-6798**, rat E-MTAB-6811, macaque E-MTAB-6813 (independent BioStudies
verification). Frozen transcript annotations need version-aware gene/protein remapping.

### Onset is not sampled stage

Onset describes symptom appearance, not when the gene acts. Do not auto-convert onset to HsapDv or
a sampled reference age. Keep onset, patient/reference age and actual sampled developmental stage
separate. Preserve pcw/gestational-week conventions, Carnegie/Theiler labels, E-days and hpf; no
cross-species arithmetic or unlabelled pcw-to-gestational-week conversion.

Review labels include antenatal, congenital, neonatal, infantile, childhood, juvenile, adult,
young-adult, late onset and unspecified. Until pinned definitions land, do not invent HPO age bounds.
GTEx adults do not cover every age included in an HPO adult-onset definition.

### Missing annotations and nonsignificance are not normality

Empty Alliance/MGI/ZFIN lists mean no returned annotation. They cannot establish an untested gene or
a normal organism. Add **assessment unknown**, partial response, unmapped anatomy and source-not-installed
states to the original vocabulary.

IMPC metadata exposes phenotype_status, phenotyping_data_available, significant and
not_significant_top_level_mp_terms. Nonsignificance is not proof of normality. The negative read needs
the tested procedure/outcome, allele, zygosity, sex, strain, age, n and statistics. Say “tested; no
significant abnormality detected in these procedures”, not blanket “phenotyped, no abnormality”.
Lethal models can censor adult testing. Literature and screening sources stay separately attributed.

Label morpholino perturbations with artefact risks, controls and genetic validation, not a categorical
“unreliable” verdict. Model phenotypes are not automatically PS3/BS3. A different paralog residue does
not automatically invalidate a humanized rescue assay; its construct determines what it tests.

### Orthology and residue numbering

Retain all orthologs in scope, one-to-many relations, methods, stringency and best-score flags.
“No ortholog” requires a complete successful query, never an error or truncated page.
Alliance's best-score flag is under geneToGeneOrthologyGenerated. SCN1A's zebrafish scn1lab/scn1laa
naming was independently confirmed.

Verify Ensembl's human source protein against the selected app isoform/version before locating the
variant. Walk gapped alignments to obtain ungapped species coordinates; same-index lookup is wrong.
A gap/no mapping is explicit. perc_pos is positive similarity; perc_id is identity. No residue claim
without a compatible reference sequence.

## 2. Source assignment and verified contracts

| Read | Source | Contract and gate |
|---|---|---|
| Human adult bulk | GTEx v10 | Implemented; versioned **GENCODE v39** identity, median TPM, ontologyId, samplingSite, RNA-seq cohort n |
| Complementary tissue/protein | HPA | Pin actual matrix/XML/JSON and release; top-tissue gene export cannot prove atlas-wide missing coverage. Consensus can include GTEx, so not independent replication. IHC needs antibody/reliability metadata |
| Human cell type | Open Targets / Tabula Sapiens, HPA | BaselineExpression rows use **tissueBiosample** and **celltypeBiosample** ontology fields, datasourceId, datatypeId, median/unit; paginate completely. Zero is a value. Do not combine pseudobulk and TPM axes |
| Human annotation | HPO | genes_to_phenotype provides disease IDs, but **phenotype.hpoa** carries onset and NOT qualifiers. hp.obo/owl supplies ancestors. Roll up phenotypic abnormalities only, not inheritance/modifier/course terms |
| Mouse/zebrafish phenotype | Alliance + IMPC | Genotype/allele and underlying provider provenance; screening assay coverage separately. Human Alliance FGFR3 is RGD curation, not HPO disease annotation. Total differs from page length |
| Cross-species phenotype mapping | uPheno | Pin SSSOM and predicates; invert UPHENO-to-species terms for lookup; coverage partial. ZFA anatomy cannot silently enter a ZP phenotype join |
| Cross-species expression | Bgee | Verify chosen release species and **stage dimensions**. Generic downloads may pool stages; do not promise Uberon × stage from a file not inspected |
| Development | dGTEx V1 + complementary atlases | dGTEx implemented: pinned GENCODE v47 matrix/manifest, donor medians, public age cohorts, inclusion reconciliation; complementary atlases remain |
| Embryo link | DECIPHER | Feature confirmed; deep-link/API/licence remain unconfirmed, guessed URL returned 500. No shipped link |
| Residue alignment | Ensembl REST | JSON Accept header, sequence-compatible selected isoform, gap-aware mapping |

GTEx contract, directly verified 2026-10-06:

```
GET /api/v2/reference/gene?geneId=FGFR3&gencodeVersion=v39&genomeBuild=GRCh38/hg38
  -> ENSG00000068078.20
GET /api/v2/expression/medianGeneExpression?gencodeId=ENSG00000068078.20&datasetId=gtex_v10
GET /api/v2/dataset/tissueSiteDetail?datasetId=gtex_v10
```

Default reference lookup silently returns v26 (FGFR3 .17), which yields an empty v10 expression response.
The adapter explicitly requests v39, validates identity and reconciles page totals. Cohort n is samples,
not independent donors or gene-specific detected samples. Missing gene rows are not a detection call.
Gene-level expression is build-independent: a GRCh37 variant can inspect this GRCh38-reference profile.
Only genomic-position overlaps require a validated GRCh38 allele.

## 3. pext corrections

Schema: `pext { flags regions { start stop mean tissues { tissue value } } }`.
**Pext.flags exists; PextRegion.flags does not.** Preserve low_max_pext and null gene pext separately.

Browser values are **base-level** expression across transcripts touching a coding position, normalized
by gene expression. They do not establish expression of the transcript carrying the missense annotation.
Label “Base-level pext” and show that limitation; annotation-specific pext is a different read.

Position overlap is verified **1-based inclusive**: start <= pos <= stop, with chromosome/build/allele
validated first. CDS-only regions cannot cover UTR/introns. FGFR3 has **49 returned tissues**, not 54;
calculation/browser sample filters differ. Use response tissue names with versioned ontology aliases.

The primary help text gives qualitative caveats, not numeric thresholds to transcribe. Initial
display has **no cut-points** or expressed-exon classification. Adult bulk isoform quantification has
transcript ambiguity and developmental/rare-cell limitations; no missense calibration is claimed.
Primary documentation: <https://github.com/broadinstitute/gnomad-browser/blob/main/browser/help/topics/pext.md>.
Release: <https://gnomad.broadinstitute.org/news/2024-11-gnomad-v4-pext/>.

## 4. Shared selection and screen

Disease choice is shared with Gene–disease. Source-derived suggestions are separate and require
manual acceptance.
Acceptance is at the individual HPO-term level, with organ-system summaries; accepted terms remain
review context and never become patient observations. This interaction is owner-confirmed.
Researcher systems and onset survive disease changes. Initial 12 system labels
are a **local display grouping**, not HPO hierarchy/axioms or official HP→UBERON mapping. Specific HPO
typeahead and a complete editable ontology mapping need pinned ontology files.

Implemented: selector → system chips/independent onset → pediatric age-cohort context → adult tissue table → named coverage follow-ups.
Selected-system tissues lead; all others remain in an explicit disclosure. Growth-plate cartilage,
cochlea and retina are not sampled by adult GTEx; skeletal muscle is not cartilage. No top-tissue
relevance headline. Zero median remains numeric and is not proof of absent expression.

After HPO/animal adapters land, add the proposed system × source grid. Cells distinguish measured
biology, assay/sampling coverage, mapping uncertainty, availability and upstream error. Do not repeat
“not phenotyped” for uninstalled sources. Detail retains allele/assay, strain/sex/stage, n, source
evidence code and provider. One source/unit per numeric scale.

Pediatric medians are derived by taking a within-donor median, then a median across donors within
each tissue and source age cohort. All 125 tissue × age groups remain reachable, including the 52
single-donor groups, which are flagged. Cohort selection is independent of onset. Separate source
tables prevent a visual age trajectory or matched adult/pediatric comparison. No sex/batch-adjusted
developmental model is claimed.

The inspector uses the same context model: identity/selection trace, source release/retrieval/hash,
local mapping explanation and sampled-stage limitation. House sans prose, mono aligned numbers,
token themes, keyboard focus, container-responsive layouts; no good/bad colours or score-like tally.

## 5. Architecture and delivery

```
src/shared/{diseaseFrame,phenotypeFrame,expressionModels}.ts
src/stores/slices/evidenceContextSlice.ts
server/services/evidence-context/{gencc,store,gtex,dgtex,g2p}.ts
server/routes/evidence-context.ts
src/components/evidence/{GeneDiseaseTab,ExpressionModelsTab,DiseaseContextPicker}.tsx
src/components/inspector/EvidenceContextRail.tsx
src/styles/evidence-context.css
```

First GTEx slice: release-keyed live REST, bounded 24-hour LRU and single-flight requests,
schema/identity/duplicate/count validation, combined reference/expression/tissue response hash.
This is an explicit initial implementation choice, **not an installed offline GTEx matrix**.
Next: persisted artifacts for reproducible offline/batch use. GenCC is already atomically installed.
No context module feeds criteria.ts.

Selections are per gene + protein + variant + transcript/isoform + assembly/resolved locus; browser-session persistence is confirmed by the owner. Standalone context export was removed at the owner’s request. Main report/session
integration remains follow-up. Exact unverified versions are never printed.
The owner confirmed a brief selected-disease summary, coverage gaps and source dates in the main
report, with full evidence in an appendix.

## 6. Paired implementation sequence

| Slice | Gene–disease | Expression & models |
|---|---|---|
| Started | Shared explicit selector, GenCC assertions, ClinVar xrefs | Adult GTEx v10, sample n, system/onset controls, coverage, rail |
| Second slice, implemented | Pinned G2P mechanisms, raw support/modifiers, exact identity and explicit allelic scope | Pinned dGTEx V1, public age cohorts, donor counts and conservative medians |
| Next | HPO-linked verified disease choices and report context | Pinned HPO suggestions/manual acceptance and annotation ancestry |
| Following paired context | ClinGen reconciliation/dosage | Pinned HPA assay coverage/confidence |
| Then | RCV/SCV condition-specific locus context | Alliance orthologs/alleles + assay-scoped IMPC + validated alignment |
| Development follow-up | Source lifecycle/crosswalk trace | Complement dGTEx V1 with BrainSpan/organ series and stage-specific Bgee where verified |
| Position/context export | Main report/session integration | Base-level pext and tissue AlphaGenome tracks after contract checks |

Open artifact gates: HPA coverage/release, complementary atlas age/tissue manifests, Bgee stage dimensions, organism
assay controls, exact licences/releases, DECIPHER URL. No silent source refresh in a saved case.

## 7. Verification contracts

Missing provider/installation/identity differs from unsampled tissue and zero. All tissues remain
reachable; skeletal muscle is not cartilage. v39 identity precedes v10 expression; incomplete pages
fail visibly. Disease changes preserve systems/onset; suggestions are not patient observations.
Empty animal annotations and nonsignificance cannot establish normality.

Later fixtures: complete orthology; gapped isoform-aware residues; HPO NOT qualifiers; partial uPheno;
allele/assay scope; pext inclusive boundaries/null/flags/CDS/tissue filters; native sampled stages.
The ACMG engine never imports these context modules.

Research ledger: `EXPRESSION_MODELS_EXTERNAL_AUDIT.md`; its “IMPC true negatives” phrasing is corrected
by §1 here. Original survey figures remain historical observations, not hard-coded production facts.
See [review and actual implementation status](EVIDENCE_CONTEXT_REVIEW.md).
See [implementation re-audit and production runbook](EVIDENCE_CONTEXT_IMPLEMENTATION_AUDIT.md)
for the owner-approved operator snapshot policy and verified G2P choices beyond GenCC.

Deployed baseline corrections and revised verification: [baseline audit](EVIDENCE_CONTEXT_BASELINE_FIX.md).
