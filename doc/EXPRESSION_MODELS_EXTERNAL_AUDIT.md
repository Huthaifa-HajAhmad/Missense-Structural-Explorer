# External audit — Expression & models / Gene–disease proposals

Independent scientific and API audit of `EXPRESSION_AND_MODELS_PROPOSAL.md` (rev 2.1),
`GENE_DISEASE_PROPOSAL.md` and the v1 appendix `TISSUE_EXPRESSION_PROPOSAL.md`.

- **Auditor:** research sub-agent (DeepSeek v4.1 High), independent pass.
- **Date of checks:** **2026-10-06**, live HTTP from this machine (the proposals are dated 2026-10-05).
- **Method:** every claim below was re-exercised against the primary endpoint/file/repo, or read from the
  authoritative pipeline source where the public page is a JS shell. Each row gives the URL, what was
  observed, the real limitation, and the fix.
- **Scope:** expression APIs, pext transcript/coordinate semantics, orthology, phenotype negative
  evidence, onset-vs-sampled-age, uPheno mappings, pediatric data, and gene–disease source access.
- **Not edited:** no source or proposal file was modified. This note is the only file written.

Labels: **CONFIRMED** (reproduced live) · **CORRECTED** (doc statement is wrong as written) ·
**GAP** (doc treats as unverified/absent but a primary source now exists) · **RISK** (scientifically
misleading if implemented as written).

---

## 0. Headline corrections (ranked by impact)

| # | Doc statement | Verified reality 2026-10-06 | Action |
|---|---|---|---|
| 1 | §1.4/§12: dGTEx is "planned, not released"; "watch only" | **dGTEx V1 data is released** (announced **2026-05-13**): 379 samples (342 RNA-seq + 37 WGS) from 40 subjects, open access | **GAP** — promote from `watch` to a sparse real source; not yet in the GTEx API (see §6) |
| 2 | §12: pext schema has "no `flags` field"; "drop it from the type" | `PextRegion` has no flags, but **`Pext` itself has `flags: [String!]!`**, value `["low_max_pext"]` for low-expression genes | **CORRECTED** — keep flags; use `low_max_pext` as a gene-level signal (§1.2) |
| 3 | §1.2/§12: pext region = "the transcript region containing this variant" | pext is **base-level and a maximum over all transcripts** — it is *not* the annotated transcript's expression | **RISK** — reword and label "base-level (maximal)" (§1.3) |
| 4 | §12: "54 tissue values per region" | API returns **49** tissues for FGFR3; tissues with <50 GTEx v10 samples are excluded | **CORRECTED** — read the tissue list per response (§1.5) |
| 5 | §12: human FGFR3 Alliance phenotypes "25" (superseding "339") | **`total = 339`**, `returnedRecords = 20` (page size). The 25 was a page artifact | **CORRECTED** — 339 is correct; do not quote page size (§3.3) |
| 6 | §1.5: Monarch `entity/FGFR3` returns the gene | `/v3/api/entity/FGFR3` → **404**; must use `/entity/HGNC:3690` or `/search?q=FGFR3` | **CORRECTED** (§8) |
| 7 | §1.2: "transcribe pext cut-points from the gnomAD pext help page" | The help page contains **no numeric cut-points**, only qualitative caveats | **GAP** — no published threshold to transcribe; source any number from the paper or mark `local` (§1.6) |
| 8 | IMPC section: only viability classes + `phenotyping_data_available` | IMPC gene core also carries **`not_significant_top_level_mp_terms`** and `phenotype_status` | **GAP** — this is the real "phenotyped, no abnormality" state (§3.1) |

---

## 1. pext — transcript and coordinate pitfalls (highest-value section)

### 1.1 Provenance — CONFIRMED, doc is right
gnomAD v4 pext is built on **GTEx v10**. Authoritative text: `browser/help/topics/pext.md`
(<https://github.com/broadinstitute/gnomad-browser/blob/main/browser/help/topics/pext.md>); the ">100
samples displayed" and ">50 samples included" rules are stated there. The public page
`https://gnomad.broadinstitute.org/help/pext` is a JS shell and returns no text via HTTP — the doc's
"returned no content" observation is a rendering artifact, not a missing page.

### 1.2 `Pext.flags` — CORRECTED
Live introspection (`https://gnomad.broadinstitute.org/api`):
`type PextRegion { start stop mean tissues }` (no flags — doc right), but
`type Pext { regions flags }` with **`flags: [String!]!`** (doc wrong to drop it).
Pipeline source `data-pipeline/.../pext.py` shows the only flag is **`"low_max_pext"`**, set when the gene
is in the low-max-pext list (no region/tissue reaches a meaningful pext — annotation-error/intergenic
enrichment signal). FGFR3 returns `flags: []`.
→ Keep `flags` on the type; render `low_max_pext` as a **gene-level "no well-expressed region"** state.

### 1.3 Base-level vs annotation-level — RISK
The help text is explicit: for base-level pext "we **sum the expression value of all transcripts that
touch that base**"; base-level is "**a maximum of the position, and will always be higher than the
annotation-level pext value**."
→ The doc's wording ("this exon is in X % of the tissue's transcript output") reads as if *the variant's
transcript* is expressed. It is not: a high base-level pext does **not** mean the transcript carrying the
missense is expressed. Label the row **"base-level pext (maximal over transcripts)"** and never attach a
per-transcript claim without the annotation-level value (not exposed by this endpoint).

### 1.4 Coordinates are 1-based inclusive — RISK (off-by-one)
Pipeline `pext.py` groups consecutive Hail `locus.position` values (1-based) and writes `start = first
pos`, `stop = last pos`. Live check: 16 of FGFR3's 21 pext regions are **byte-identical to
`Gene.exons` start/stop** (the other 5 are exons split where per-tissue values differ, e.g. exon
1799747–1799812 splits at 1799801). `Gene.exons` uses gnomAD's 1-based inclusive convention.
→ Any overlap test must be inclusive: `start <= variant.pos && variant.pos <= stop`. A BED-style
0-based half-open test is off-by-one at every boundary. Also: regions are **CDS only** — UTR and intronic
variants have **no region** and must render a distinct state (not `0`, not "not expressed").

### 1.5 Tissue list is 49, and names have drifted — CORRECTED
FGFR3 region[0] returns **49** `tissues` entries (not 54). Two consequences:
- Never hard-code 54 or "GTEx's 54"; render coverage from the response.
- The pipeline's own `TISSUE_NAME_MAP` (54 entries) is **not identical to the API output**: the API
  returns `cells_cultured_fibroblasts`, which is not in the map (the map has
  `cells_transformed_fibroblasts`). Build the tissue-name → UBERON join from the **returned values**,
  not from a stale code map.

### 1.6 Nullability and cut-points — GAP
- `Gene.pext` is nullable. Verified: **MALAT1 (ENSG00000251562) → `pext: null`**. Handle a
  `no pext for this gene` state.
- The help page gives **no numeric cut-point**. The doc's plan to "transcribe cut-points from the pext
  help page at implementation" will find nothing. Any threshold used to call an exon "expressed" must
  come from the pext paper (Cummings 2020) or be declared `local` under the `thresholds/` contract.

**pext test fixtures to add:** `flags low_max_pext` surfaced; MALAT1 → `pext null`; an intronic variant
→ `no region`; a variant exactly on a region boundary → still included (inclusive test); a gene whose API
tissue count ≠ 54.

---

## 2. Orthology

### 2.1 Alliance `/orthologs` — CONFIRMED with access-path correction
`GET https://www.alliancegenome.org/api/gene/HGNC:3690/orthologs` (checked 2026-10-06, `requestDate`
2026/10/06) returns **9 rows, every one `stringencyFilter: "stringent"`**: Xenopus tropicalis, X. laevis,
worm, fly ×2, mouse, rat, zebrafish. `isBestScore` lives on **`geneToGeneOrthologyGenerated`**, not at the
row top level — code that reads `row.isBestScore` gets `undefined`. Verified: fly `FBgn0285896` is the
**`isBestScore: No`** row (`predictionMethodsMatched` 6), `FBgn0010389` is `Yes` — consistent with the
doc's htl/btl note. `predictionMethodsMatched` count and `confidence` (`high`/`moderate`) are present.
→ Read `isBestScore` at the nested path; keep the "show every stringent ortholog" rule.

### 2.2 Ensembl homology alignment — CONFIRMED, with a residue-mapping caveat
`GET https://rest.ensembl.org/homology/symbol/human/FGFR3?type=orthologues;target_taxon=10090;sequence=protein;aligned=1`
with `accept: application/json` returns aligned sequences. The doc's "94.9 %" is the **human `source.perc_pos`
(94.9132)**; the mouse `target.perc_pos` is **95.625** and the two `perc_id` values differ in each
direction (`source` 92.6799 vs `target` 93.375). The mouse alignment carries gaps
(`cigar_line: 14M2D128M4D658M`).
→ For the residue panel: walk the alignment with gaps (never index directly by residue number), and
quote *which direction* an identity percentage came from.

### 2.3 SCN1A naming trap — CONFIRMED
Alliance returns two zebrafish orthologs for `HGNC:10585` (SCN1A): `ZFIN:ZDB-GENE-060906-1` and
`ZFIN:ZDB-GENE-040426-751`. Direct check: `https://zfin.org/ZDB-GENE-060906-1` → title "**scn1lab**".
The doc's naming trap is real; the second gene is the other paralog (`scn1laa`). Note the Alliance
ortholog payload does **not** carry a symbol field — resolve symbols via the gene endpoint or ZFIN.

---

## 3. Phenotype negative evidence

### 3.1 IMPC gives true negatives — GAP (important)
`https://www.ebi.ac.uk/mi/impc/solr/gene/select?q=...&fl=*` (checked 2026-10-06) exposes, per gene:
`phenotype_status`, `significant_top_level_mp_terms`, and **`not_significant_top_level_mp_terms`**, plus
`phenotyping_data_available`, `embryo_data_available`, production statuses. Example: `Dll1` →
`phenotype_status: "Phenotyping data available"`, significant = vision/eye, behavior/neurological,
immune system; **not_significant = muscle, nervous system, integument**.
- Fgfr3 → `phenotyping_data_available: false`, `embryo_data_available: false`,
  `null_allele_production_status: "Withdrawn"` (the doc's fixture holds).
→ The genuine **"phenotyped, no abnormality"** cell must be rendered from
`not_significant_top_level_mp_terms` (per organ system), not inferred from an empty MGI list. Surface
`phenotype_status` to separate "not phenotyped" from "phenotyped".

### 3.2 Absence of annotation ≠ no phenotype — CONFIRMED (design principle)
MGI/Alliance gene→phenotype tables hold **positive curations only**; an empty list means "not curated",
not "screened normal". The doc's three-state rule is right; the implementation must source the negative
state from IMPC (§3.1), and keep literature (MGI/Alliance) and screen (IMPC) as **separate rows**, as
§12 already proposes.

### 3.3 Alliance human annotations are RGD — CONFIRMED; count is 339, not 25
`GET .../api/gene/HGNC:3690/phenotypes` returns `total: 339`, `returnedRecords: 20`. Inspected
annotations carry `dataProvider.abbreviation = "RGD"` (e.g. `HP:0030928` "1-minute APGAR score of 1",
evidence `MIM:187600`). The trap is real. The §12 "correction" to 25 was itself a page-size artifact —
restore 339 (or, better, print no count and filter by `dataProvider`).

### 3.4 HPO files: two distinct roles — CORRECTED framing
- `genes_to_phenotype.txt` (`http://purl.obolibrary.org/obo/hp/hpoa/genes_to_phenotype.txt`, 20.8 MB,
  live 2026-10-06): columns `ncbi_gene_id, gene_symbol, hpo_id, hpo_name, frequency, disease_id`.
  `disease_id` is OMIM/ORPHA (doc right). **It has no onset and no qualifier/NOT column**, and it carries
  non-phenotype rows (e.g. `HP:0000007` "Autosomal recessive inheritance").
- `phenotype.hpoa` (`http://purl.obolibrary.org/obo/hp/hpoa/phenotype.hpoa`, 35.8 MB, `hpo-version`
  **2026-09-01**, `#version` 2026-09-02; 8478 OMIM / 4357 ORPHANET / 47 DECIPHER) columns:
  `database_id disease_name qualifier hpo_id reference evidence onset frequency sex modifier aspect ...`.
→ **Onset and negative (`qualifier: NOT`) annotations live in `phenotype.hpoa`, not in
`genes_to_phenotype.txt`.** If the picker's onset or any "absent phenotype" evidence is to be sourced
from the pinned per-gene file, it will not be found. Also, the system roll-up must filter out
inheritance/clinical-course/modifier terms from `genes_to_phenotype.txt` or the organ-system summary is
polluted.

---

## 4. Onset vs sampled age

### 4.1 The picker's onset vocabulary is incomplete — CORRECTED
HPO onset terms have exact definitions (verified via OLS4, `https://www.ebi.ac.uk/ols4/api/ontologies/hp`):

| Term | Label | Definition (verbatim gist) |
|---|---|---|
| HP:0030674 | Antenatal onset | before birth (fetal) |
| HP:0003577 | Congenital onset | present at birth |
| HP:0003623 | Neonatal onset | first 28 days |
| HP:0003593 | Infantile onset | first 12 months |
| HP:0011463 | Childhood onset | up to but not including the 5th birthday |
| HP:0003621 | Juvenile onset | 5–15 years |
| HP:0003581 | Adult onset | 16 years or later |
| HP:0011462 | Young adult onset | 16–40 years |
| HP:0003584 | Late onset | adult, after 60 years |
| HP:0410280 | Pediatric onset | grouping |

The doc's list "congenital, neonatal, infantile, childhood, adult" **omits Juvenile (5–15), Antenatal,
Young adult and Late onset** — a 5–15 y onset would be mis-binned. Also HP:0011461 "Fetal onset" carries
a gestation-period definition and appears superseded; use **HP:0030674 Antenatal onset**.

### 4.2 Onset is not the sampling stage — RISK
HPO onset is when *signs/symptoms* appear; it is a disease-level, frequently-variable annotation and is
**absent from the per-gene file** (§3.4). Mapping onset → HsapDv and then treating that as "the stage at
which the gene acts / should be sampled" conflates disease onset with developmental gene action.
→ Keep onset as a disease-frame filter with a visible caveat; do **not** equate it with the expression
sampling stage, and print the source (disease-level `phenotype.hpoa`) beside it.

### 4.3 The stage gap is real and confirmed
GTEx v10 is adult only — every per-tissue summary shows age **min 20 / max 70**
(`Heart_Left_Ventricle` RNA-seq n=452, ages 20–70; `Adipose_Subcutaneous` n=714, 21–70). So a
congenital/neonatal phenotype has effectively no multi-organ reference; the "patient's stage is not
covered" callout must fire for onset ∈ {Antenatal, Congenital, Neonatal, Infantile} regardless of gene.

---

## 5. uPheno mappings

### 5.1 The example — CONFIRMED
OLS4 `UPHENO:0001471` "increased size of the heart": cross-species exact matches
`HP:0001640`, `MP:0000274`, `ZP:0000532`, `XPO:0103382`. Doc's example exact.

### 5.2 Routing gotcha — RISK (blocks a naive implementation)
The mapping is stored on the **UPHENO** term (`annotation."cross-species exact match"`). OLS4 lookups of
the MP/ZP terms themselves return **no** such annotation (tested `MP:0009250`, `MP:0002083`, `MP:0005367`,
`MP:0011100`, `ZP:0000000`, `ZP:0000532` → all null). A per-MP-term OLS query will silently fail.
→ Build a **reverse index** (MP/ZP → UPHENO) by inverting the uPheno mapping file, not by querying terms.

### 5.3 The mapping table — CONFIRMED (with coverage caveat)
Authoritative file: `mappings/upheno-species-independent.sssom.tsv`
(<https://raw.githubusercontent.com/obophenotype/upheno/master/mappings/upheno-species-independent.sssom.tsv>,
2.55 MB, checked 2026-10-06), predicate `semapv:crossSpeciesExactMatch`, `mapping_set_id` at
`data.monarchinitiative.org`. Also present: fuzzy `hp-to-mp-bestmatches.tsv`,
`hp-to-zp-bestmatches.tsv`, `hp-to-wbphenotype-bestmatches.tsv` (Jaccard-scored HP↔species; **no direct
MP↔ZP file** — HP is the pivot).
→ Expect partial coverage: render an explicit **"no uPheno grouping"** state and never drop an unmapped
MP/ZP term. The fuzzy files are scores, not exact matches — do not present them as curated equivalence.

---

## 6. Pediatric / developmental data

### 6.1 dGTEx V1 is released — GAP (biggest factual change since the doc)
Announcement: <https://ndriresource.org/dgtex-project-releases-first-data-on-pediatric-genetic-development>
(`article:published_time` **2026-05-13**). Verbatim: **"dGTEx V1 contains 379 samples (342 RNA-seq and
37 WGS) from 40 subjects and the open access data is now available on the Open Access Download Page."**
Download portal: <https://gtexportal.org/home/downloads/developmental-gtex>. Programme scope (NIH):
<https://www.genome.gov/Funded-Programs-Projects/Developmental-Genotype-Tissue-Expression> — age groups
0–2, 2–8, ~8–12.5, ~12.5–18 y; ≥120 donors, up to 75 tissues.

**But:** the GTEx portal **API** does not yet expose dGTEx —
`https://gtexportal.org/api/v2/metadata/dataset` (2026-10-06) lists only `gtex_v7` (GRCh37), `gtex_v8`,
`gtex_v10` (both GRCh38) and `kids_first_harmonization`; every candidate `datasetId=dgtex_*` returned
**422**.
→ Change the doc: not "watch only / no released data", but **"downloads available (V1, 40 subjects), no
per-gene API yet"**. With 40 subjects over four bins, per-tissue n is single-digit — a real but very
sparse source, not a substitute for a pediatric baseline; keep a `coverage` state.

### 6.2 Cardoso-Moreira per-species accessions — RESOLVED
The doc marks "per-species ArrayExpress accessions other than E-MTAB-6814: not retrieved". Verified via
BioStudies API (2026-10-06):

| Species | Accession | Title |
|---|---|---|
| Human | **E-MTAB-6814** | Human RNA-seq time-series of the development of seven major organs |
| **Mouse** | **E-MTAB-6798** | Mouse RNA-seq time-series of the development of seven major organs |
| Rat | E-MTAB-6811 | Rat RNA-seq time-series of the development of seven major organs |
| Rhesus macaque | E-MTAB-6813 | Rhesus macaque RNA-seq time-series of the development of six major organs |

→ The mouse developmental column can cite **E-MTAB-6798** directly (mouse TABLE). E-MTAB-6814 release
date confirmed **2019-02-18**.

### 6.3 BrainSpan — CONFIRMED alive, legacy
`https://www.brainspan.org/` returns 200 (version 361). Keep the "legacy, Gencode v10, brain only"
framing. No newer multi-organ pediatric bulk reference exists that I could verify beyond §6.1.

---

## 7. Adult expression API shape corrections

### 7.1 GTEx v10 — CONFIRMED, one field-name fix
`https://gtexportal.org/api/v2/dataset/tissueSiteDetail?datasetId=gtex_v10` → **54 tissues**,
`datasetId: gtex_v10`. The UBERON cross-reference field is **`ontologyId`** (e.g.
`Heart_Left_Ventricle` → `UBERON:0006566`), not `uberonId`. Per-tissue `rnaSeqSampleSummary` gives n and
age min/mean/max. Adult-only confirmed (min 20). `docs` endpoint guesses like `/api/v2/dataset` return
404 — use `/dataset/tissueSiteDetail`.

### 7.2 Open Targets — CORRECTED field path
`POST https://api.platform.opentargets.org/api/v4/graphql`, `targets(ensemblIds:["ENSG00000068078"]).baselineExpression(page:{index,size})`
→ **1,428 rows**. `BaselineExpressionRow` has **no `biosample` field**; the ontology-carrying fields are
**`tissueBiosample { biosampleId biosampleName }`** and **`celltypeBiosample { … }`**
(e.g. `tissueBiosample.biosampleId = UBERON_0000007`; `celltypeBiosample.biosampleId = CL_0000115`).
`median` **can be 0** (tabula_sapiens row), units differ (`TPM` vs `CPM(pseudobulk sum[counts])`), and
`datatypeId` distinguishes `bulk rna-seq` / `scrna-seq`. The doc's `datasourceId` + `unit` rule is
servable as-is; only the field name is wrong.

---

## 8. Gene–disease source access (Tab B)

| Source | Doc claim | Verified 2026-10-06 | Fix |
|---|---|---|---|
| **GenCC** | bulk TSV, ~24 MB, no live API, CC0 | `https://search.thegencc.org/download/action/submissions-export-tsv` → 200, **26.5 MB** TSV; header has `classification_curie/title`, `moi_*`, `submitter_*`, `submitted_as_date`, `submitted_as_public_report_url`, `submitted_as_pmids`. FGFR3 → multiple MONDO diseases with Definitive/Strong/Moderate. `/api/...` routes 404 | CONFIRMED; snapshot approach correct. Use the `disease_curie` (MONDO) + per-submitter rows directly |
| **ClinGen validity** | CSV at `search.clinicalgenome.org/kb/gene-validity/download` | 200; header "FILE CREATED: 2026-10-06" | CONFIRMED |
| **ClinGen dosage** | JSON `search.clinicalgenome.org/api/dosage`, TSV on ftp | JSON 200, 2,233 rows with `haplo_assertion`/`triplo_assertion` **numeric codes**, `pli`, `hi`, `haplo_disease`, `haplo_mondo`, dates | CONFIRMED JSON; must map the numeric assertion codes to labels; ftp TSV not re-checked |
| **G2P** | "confidence levels on LGMDE threads" (page) | **Documented REST API v21.0.0** (OpenAPI at `.../api/schema/`). `/gene2phenotype/api/gene/FGFR3/summary/` returns per-disease `molecular_mechanism` (`gain of function` / `undetermined`), `confidence`, `genotype`, `variant_consequence`, `variant_type`, `stable_id`; `/molecular_mechanisms/` gives the vocabulary; `/panel/{name}/download/` for bulk | GAP — the mechanism axis can be served **per disease, live**; no need to treat G2P as page-only. Cross-check: G2P says achondroplasia = GoF |
| **Monarch v3** | entity lookup returns FGFR3 | `/v3/api/entity/FGFR3` → **404**; `/v3/api/entity/HGNC:3690` → 200 (HGNC gene node); `/v3/api/search?q=FGFR3` → 200 | CORRECTED — use a CURIE, not a symbol |

---

## 9. Claims NOT re-exercised in this pass (still as labelled)

- HPA v25.1 release figures, Bgee REST/SPARQL/download details, IMPC DR23 headline numbers, Expression
  Atlas counts, GXD 2026 counts, HDCA/Census sizes, DECIPHER deep-link pattern (still HTTP 500 per the
  doc), AlphaGenome track→UBERON join, dGTEx per-gene API availability beyond the dataset list.
- dGTEx open-access download file inventory: the GTEx `developmental-gtex` page is a JS shell and no file
  names were extractable via HTTP — read the manifest from the portal or NDRI at implementation time.

---

## 10. Concrete changes to make in the two proposals (no code)

1. **§1.4 / §12:** dGTEx V1 released 2026-05-13 (379 samples / 40 subjects); promote to a sparse source,
   keep the API-gap note.
2. **§12 pext flags:** keep `flags`; document `low_max_pext`; the "drop it" instruction is wrong.
3. **§1.2 / §12 pext wording:** add "base-level = maximum over transcripts"; never imply the annotated
   transcript is expressed.
4. **§12 pext tissues:** 49 for FGFR3 (not 54); build the UBERON join from response values.
5. **§7/§12 architecture:** state the inclusive 1-based coordinate test, CDS-only coverage, `pext: null`
   gene state, and that the help page has no numeric cut-points.
6. **§12 Alliance phenotypes:** restore `total = 339`; stop quoting page size.
7. **§1.3/§4 picker:** complete the onset vocabulary (+Juvenile, Antenatal, Young adult, Late) and state
   onset ≠ sampling stage; onset only exists in `phenotype.hpoa`.
8. **§1.5 / Phase 2 IMPC:** add `not_significant_top_level_mp_terms` + `phenotype_status` as the
   "phenotyped, no abnormality" source.
9. **§1.5 uPheno:** invert the SSSOM file (mapping lives on UPHENO, not MP/ZP); add an "unmapped" state.
10. **§1.4:** add mouse E-MTAB-6798 (and rat E-MTAB-6811, macaque E-MTAB-6813).
11. **§1.5:** Monarch needs a CURIE (`HGNC:3690`).
12. **Phase 1 Open Targets:** field is `tissueBiosample`/`celltypeBiosample`, not `biosample`.
13. **Tab B §1:** G2P has a documented REST API; the mechanism axis can be live per disease.

---

### Verification ledger (all 2026-10-06, live from this machine)

| Item | Endpoint / file | Result |
|---|---|---|
| pext schema | `gnomad.broadinstitute.org/api` introspection | `PextRegion{start,stop,mean,tissues}`, `Pext{regions,flags}` |
| pext pipeline | `gnomad-browser/.../data_types/pext.py` | 1-based inclusive, CDS-only, `low_max_pext`, <50-sample exclusion |
| pext FGFR3 | GraphQL `gene.pext` | 21 regions, **49** tissues, 16/21 = exons exactly |
| pext null | GraphQL MALAT1 | `pext: null` |
| GTEx tissue list | `gtexportal.org/api/v2/dataset/tissueSiteDetail?datasetId=gtex_v10` | 54 tissues, `ontologyId`, adult ages |
| GTEx API datasets | `/api/v2/metadata/dataset` | v7, v8, v10, kids_first_harmonization (no dGTEx) |
| Open Targets | `api.platform.opentargets.org/api/v4/graphql` | 1,428 rows; `tissueBiosample`/`celltypeBiosample` |
| Alliance orthologs | `/api/gene/HGNC:3690/orthologs` | 9 stringent; `isBestScore` nested |
| Alliance phenotypes | `/api/gene/HGNC:3690/phenotypes` | total 339, provider RGD |
| Ensembl homology | `/homology/symbol/human/FGFR3?...aligned=1` | gaps present; source perc_pos 94.91 |
| ZFIN SCN1A | `zfin.org/ZDB-GENE-060906-1` | "scn1lab" |
| IMPC | `ebi.ac.uk/mi/impc/solr/gene/select` | `not_significant_top_level_mp_terms`, `phenotype_status` |
| HPO genes_to_phenotype | `purl.obolibrary.org/obo/hp/hpoa/genes_to_phenotype.txt` | no onset/NOT |
| HPO phenotype.hpoa | `.../phenotype.hpoa` | 2026-09-01; has `onset`, `qualifier` |
| HPO onset terms | `ebi.ac.uk/ols4` | ranges per §4.1 |
| uPheno SSSOM | `raw.githubusercontent.com/obophenotype/upheno/master/mappings/...` | 2.55 MB, `crossSpeciesExactMatch` |
| uPheno example | OLS4 `UPHENO:0001471` | HP:0001640, MP:0000274, ZP:0000532 |
| dGTEx V1 | `ndriresource.org/...` (published 2026-05-13) | 379 samples / 40 subjects |
| GenCC | `search.thegencc.org/download/action/submissions-export-tsv` | 26.5 MB TSV |
| ClinGen validity | `search.clinicalgenome.org/kb/gene-validity/download` | 200, file created 2026-10-06 |
| ClinGen dosage | `search.clinicalgenome.org/api/dosage` | 2,233 rows |
| G2P | `ebi.ac.uk/gene2phenotype/api/gene/FGFR3/summary/` | per-disease mechanism/confidence |
| Monarch | `api.monarchinitiative.org/v3/api/entity/HGNC:3690` | 200 (symbol path 404) |
| Cardoso-Moreira | BioStudies API | mouse E-MTAB-6798, rat E-MTAB-6811, macaque E-MTAB-6813 |
