# Expression & models — a phenotype-driven tab (human tissue/stage + mouse + zebrafish)

Design proposal, **Revision 2 of `TISSUE_EXPRESSION_PROPOSAL.md`** (that file stays as the v1 research
appendix; its verified GTEx/HPA/BrainSpan findings are carried forward, not repeated). Status: **not
implemented.** Written **2026-10-05**. **Revision 2.1 (2026-10-05):** a second, direct-HTTP verification
pass re-exercised every live-API claim; results and corrections are in §12 and supersede §1 where they
differ.

Evidence labels used throughout:

- **verified (live)** — a request was made from this machine on 2026-10-05 and the raw response read.
- **verified (page)** — read from the primary page/paper, but through a page-to-text summariser; re-read the
  raw payload before coding against it.
- **snippet** — taken from a search-result summary or a third-party description; **treat as UNVERIFIED**.
- **UNVERIFIED** — not established. Do not publish without a check.

This tab is one of two. The other (`GENE_DISEASE_PROPOSAL.md`) carries causality, mechanism and variant
locus. They share one `DiseaseFrame` but answer different questions: this tab asks *where, when and in
which organism does the gene act*; that tab asks *is the claim established and does a missense fit it*.

---

## 0. The aim, and the one idea that carries it

The reader is a researcher with a rare-disease case. They want to know how much a **gene and variant
matter for that disease**. This tab contributes the biological-context half of that answer.

**One idea:** the researcher ticks the phenotypes or organ systems that matter, and that single selection
drives three independent reads of the same gene:

1. **human expression** in the tissues those systems imply (and at the patient's stage),
2. **what is already annotated** for the gene in humans (HPO), and
3. **what the mouse and zebrafish orthologs do** when perturbed, in the same systems.

Rendered as a grid — rows are the ticked systems, columns are evidence sources, every cell is a *state*,
never a colour for good/bad:

```
System          Human expression      Human annotation   Mouse                     Zebrafish
Skeletal        cartilage: not sampled annotated (HPO)    knock-in ✓ (Fgfr3 allele)  2 orthologs · not phenotyped
Cardiovascular  heart 7145 nTPM        annotated          KO: abnormal               no ortholog
Hearing         cochlea: not sampled   not annotated      phenotyped, no abnormality not phenotyped
```

Nothing in this tab votes. It is a plausibility and review-framing layer, with the same standing as the
gnomAD constraint the app already shows.

---

## 1. What the first proposal under-looked — the source survey

The v1 document reviewed GTEx, HPA, BrainSpan, E-MTAB-6814 and HDBR. This survey adds what was missing.
All checks were made on 2026-10-05.

### 1.1 DECIPHER (the one you asked about)

| Fact | Status |
|---|---|
| DECIPHER **v11.31** added an **Expression tab** that shows **Human Developmental Cell Atlas** single-cell data "in 12 sections of a 6–7 post-conception-week human embryo", with TBX5 / Holt-Oram as the example | verified (page) — EMBL-EBI release note |
| The same release integrated **Gene2Phenotype** ear-disorder data (87 genes, 97 LGMDE records) | verified (page) |
| DECIPHER is a **GenCC member** | snippet |
| The tab covers **one stage window (6–7 pcw)** and is a **spatial/single-cell view**, not a tissue×stage table | verified (page) |
| A public API or licence for the expression tab | **UNVERIFIED** — no documentation found; `https://www.deciphergenomics.org/gene/<SYMBOL>/expression` returned HTTP 500 when fetched, so the URL pattern is also unconfirmed |
| The 2012 DECIPHER paper has no expression feature | verified (page) — the tab is a later addition |

**Verdict:** DECIPHER's expression view is real, but it is a *visualisation of public HDCA data at one
embryonic window*, with no documented programmatic access. **Do not integrate it as a data source.** Offer
it as a **deep link** ("open embryo view in DECIPHER") once the URL pattern is confirmed, and treat HDCA /
CELLxGENE as the underlying sources (§1.5).

### 1.2 The one the v1 text missed that matters most for the aim — gnomAD **pext**

- The gnomAD v4 browser carries **transcript tissue expression and pext** tracks built on **GTEx v10**
  (GRCh38), added November 2024 — verified (page).
- **verified (live, re-verified in the second pass, §12):** the public GraphQL API the app already calls
  (`https://gnomad.broadinstitute.org/api`, `server/services/external-api/gnomad.ts:101`) exposes
  `gene.pext { regions { start stop mean tissues { tissue value } } }`.
  **Correction (§12): the schema has no `flags` field on `PextRegion`** — introspection returns exactly
  `start, stop, mean, tissues`. Sample read for FGFR3 (GRCh38): 21 regions, per-region `mean` values
  genuinely differ (7 distinct means, 0.031–0.816), with per-tissue values
  (`adipose_subcutaneous` 0.768, `brain_amygdala` 0.939, …).
- pext is the **variant-level** expression read: *what fraction of the gene's expressed transcript output
  in tissue T includes the region this variant sits in.* It is the only item in this survey that is
  specific to the position, not to the gene, and it costs **no new integration** — same client, same
  endpoint, GRCh38 like the rest.
- Published utility is for **pLoF** annotation (a bioRxiv abstract reports 22.4 % of falsely annotated
  pLoF variants in haploinsufficient genes filtered while removing <4 % of high-confidence pathogenic
  variants — snippet). **Applicability to missense is UNVERIFIED**; show it as *context at the position*
  ("this exon is in X % of the tissue's transcript output"), never as a pathogenicity input.
  Recommended cut-points: **UNVERIFIED** — transcribe from the gnomAD pext help page at implementation;
  that page returned no content when fetched.

### 1.3 Adult baseline: what to use, now with versions

| Source | Facts | Status | Role |
|---|---|---|---|
| **GTEx v10** REST | 54 tissues, UBERON ids, per-tissue n, sampling site; adults only (see v1 §4.1) | verified (live, v1) | Primary adult bulk; the only source with per-tissue n |
| **HPA v25.1 (Ensembl 109)** | 51 consensus RNA tissues, 45 IHC tissues (15,312 genes), mass-spec in 20 tissues, 36 single-cell datasets, brain 13 regions / 193 subregions / 966 samples, **mouse and pig brain data**; TSV/JSON/XML/RDF, per-gene JSON by Ensembl id | verified (page) | Fills v1's "HPA version unestablished"; adds tissues GTEx lacks, cell types, **protein-level (IHC)** and brain cross-species |
| **Open Targets baseline expression** | Tabula Sapiens scRNA (66 tissues, 180 cell types), GTEx v10 (54), DICE (12 immune cell types), PRIDE proteomics (74 tissues); metadata mapped to **UBERON** and **Cell Ontology**; GraphQL API; CELLEX specificity ranks | verified (page) | One ontology-keyed API for **cell-type** and **protein** layers; use it for Tabula Sapiens and PRIDE, not as the GTEx source (an aggregator must not hide which release served a number) |
| **Bgee** (CC0) | 29 species (14.1); human includes curated GTEx (kept 6,008 of 11,983 samples); anatomy = **Uberon**, stages = merged cross-species stage ontology; gold/silver/bronze presence calls and 0–100 rank scores; bulk, scRNA, in-situ, EST; R package, SPARQL, TSV; Bgee 15 filters by developmental-stage id (with descendants); 2024 paper adds curated scRNA | verified (page, partial) + snippet | **The cross-species expression backbone** — one anatomy/stage vocabulary for human, mouse, zebrafish. REST availability **UNVERIFIED** (FAQ returned 403) |
| **Expression Atlas 2026** | 67 species, 4,562 studies; NAR Dec 2025; Ensembl 104 | verified (page) | Source of raw experiments (incl. E-MTAB-6814); not a lookup API for this tab |

### 1.4 Stage axis: the pediatric gap, re-stated with current facts

- **dGTEx** (human, 0–2 y, 2–8 y, ~8–12.5 y, ~12.5–18 y; ≥120 donors, 30 per group; up to 75 tissues;
  non-human-primate arm incl. prenatal) — verified (page, NHGRI). A 2026 NHGRI council concept describes a
  **renewal / Phase 2 beginning 2026** — snippet. **No released data was found.** This resolves v1's
  UNVERIFIED dGTEx row: it is a **planned resource that targets exactly the 0–2 y hole**, and the app should
  carry a `watch` entry, not a source.
- **Cardoso-Moreira 2019 is multi-species, not human-only** (verified (page)): the same 7 organs
  (cerebrum, cerebellum, heart, kidney, liver, ovary, testis) across **human, macaque, mouse, rat, rabbit,
  opossum, chicken**, early organogenesis to adulthood; explorer at `evodevoapp.kaessmannlab.org`.
  v1 treated only the human arm (E-MTAB-6814). The **mouse arm gives a same-organ, same-method
  developmental series for the mouse column of this tab.** Per-species ArrayExpress accessions other than
  E-MTAB-6814: not retrieved (UNVERIFIED).
- **HDCA / HCA fetal** — 4–22 pcw, ~4.6 M cells, ~450 cell types (snippet); a 2026 bioRxiv
  "integrated single cell and spatial omics atlas of prenatal development" exists (snippet).
- **CELLxGENE Census** — 217 M+ cells, 2025-11-08 LTS, cell metadata includes **development stage**
  (verified (page/snippet)); access is TileDB-SOMA through Python/R. A heavy dependency for a Node server;
  a web query API was not verified. Prefer a **pre-aggregated per-gene snapshot** over a live Census call.
- **Mouse developmental expression**: **GXD 2026** — >16,200 genes, ~8,700 mouse mutants, >2 M classical
  annotations, 96 imported bulk RNA-seq studies (2,127 samples, 178 anatomical structures), Cell Ontology
  browser (verified (page)); no programmatic access was stated. Reach it **through Alliance** (§1.5).

### 1.5 Cross-species: Alliance, IMPC, ZFIN, Ensembl

All of this was exercised live.

| Source | What was read | Status |
|---|---|---|
| **Alliance of Genome Resources** — orthologs | `GET https://www.alliancegenome.org/api/gene/HGNC:3690/orthologs` returns stringent-filtered DIOPT orthologs for **FGFR3**: mouse `Fgfr3` (`MGI:95524`), zebrafish `fgfr3` (`ZFIN:ZDB-GENE-000816-1`), plus rat, frog (`fgfr3.S`/`fgfr3.L`), *Xenopus tropicalis* `fgfr3`, fly (`htl` best-score; **`btl` is the `isBestScore: No` pair** — §12) and worm (`egl-15`, confidence *moderate*). Each carries `isBestScore`, `stringencyFilter`, a method list, and **`hasDiseaseAnnotations` / `hasExpressionAnnotations`** flags | **verified (live)** |
| Alliance — phenotypes | `/api/gene/{id}/phenotypes` works for MGI and ZFIN ids. Mouse: MP terms per **genotype** (`Fgfr3 tm1Dor` homozygous → "abnormal axial skeleton morphology", a `Col2a1-Fgfr3` transgene → "abnormal appendicular skeleton morphology"). Zebrafish: **ZFA** anatomy terms per **allele** with zygosity and background (`fgfr3 zf3388/zf3389` → "basihyal bone chondrocyte disorganized, abnormal") | verified (page) |
| Alliance — **human** phenotypes | The human `FGFR3` record returned **339** annotations whose provenance is **RGD** (HPO terms, e.g. "1-minute APGAR score of 1"), i.e. literature curation by the rat database, **not** the HPO consortium's disease annotation. **Do not use it for the human annotation column** | verified (page) — a trap worth a test |
| Alliance — release/licence | DIOPT-based orthology with manual supplementation; monthly releases; CC BY 4.0; 8 organisms, 142,000 disease models (v5.4.0, 2023) | verified (page) |
| Alliance — expression endpoints | `/api/gene/{id}/expression-summary` and `/api/openapi.json` returned **404**; the real expression route names are **UNVERIFIED** (the orthology response confirms the data exists via `hasExpressionAnnotations`) | UNVERIFIED |
| **IMPC** (DR23.0, 2025) | >100 M data points, 9,277 genes, 113,803 significant phenotypes (51,190 embryonic stages), 9,994 lines; **viability categories** (cellular lethal, developmentally lethal, subviable, viable with phenotype, viable with no phenotype); Solr API `https://www.ebi.ac.uk/mi/impc/solr/`; CC BY 4.0 | verified (page/snippet) |
| **uPheno** | species-neutral grouping over HP, MP, ZP (and others); e.g. HP:0001640 *Cardiomegaly*, MP:0000274 *enlarged heart*, ZP:0000532 *heart increased size, abnormal* → `UPHENO:0001471`; used by IMPC, MGI, Monarch; ships mapping tables | verified (page) |
| **Monarch v3 API** | `https://api.monarchinitiative.org/v3/api`; MONDO/HPO keyed; cross-species phenotype comparison; no auth | snippet (third-party description) |
| **Ensembl REST homology** | `GET /homology/symbol/human/FGFR3?type=orthologues;target_taxon=10090;target_taxon=7955;sequence=protein;aligned=1` returns the **aligned protein sequences** (human FGFR3 `perc_pos` 94.9 % shown in the first record) | **verified (live)** |
| **ZFIN** (direct) | annotates genotypes with one or many alleles and non-standard conditions; contributes to Alliance | verified (page); direct REST **UNVERIFIED** |

**Orthology must show every ortholog.** The FGFR3 response alone returns two frog paralogs and a
best-score-No fly gene. Zebrafish retains duplicates for many human genes. The tab lists all stringent
orthologs with method count and `isBestScore`, and never picks one silently.

### 1.6 Sources considered and demoted

- **ENCODE fetal / Roadmap** — chromatin-heavy (v1); keep out.
- **Pediatric Cell Atlas, Kids First** — not baselines (v1); keep out.
- **dGTEx** — watch only (§1.4).
- **DECIPHER expression** — deep link at most (§1.1).
- **Alliance human phenotypes (RGD provenance)** — do not use (§1.5).
- **GTEx eQTL/sQTL** — risk of double counting; out of scope here (v1 §4.4).

---

## 2. Source assignment — what serves which cell

| Grid column / read | Primary source | Fallback / complement | Key | Unit |
|---|---|---|---|---|
| Human adult tissue | **GTEx v10 REST** (n, sampling site) | HPA consensus snapshot (tissues GTEx lacks) | UBERON | TPM (GTEx), nTPM (HPA) — never one axis |
| Human protein level | HPA IHC (level, not number) | Open Targets / PRIDE | UBERON | categorical / iBAQ |
| Human cell type | HPA single-cell + Open Targets (Tabula Sapiens) | CELLxGENE snapshot | Cell Ontology | nCPM / pseudobulk CPM |
| **Position-level** expression | **gnomAD pext** (existing client) | — | GTEx tissue name → UBERON | proportion 0–1 |
| Human developmental | BrainSpan (brain), E-MTAB-6814 (7 organs), HDCA/CELLxGENE (cell type) | dGTEx — *when released* | HsapDv stage | RPKM / TMM-CPM / counts, per row |
| Human annotation | **HPO** (`genes_to_phenotype`, `phenotype.hpoa`) | Orphanet | HPO | — |
| Mouse phenotype | Alliance (MGI) + **IMPC** (viability, embryonic) | MGI direct | MP → uPheno | — |
| Zebrafish phenotype | Alliance (ZFIN) | ZFIN direct | ZP/ZFA → uPheno | — |
| Mouse/zebrafish expression | **Bgee** (stage-aware, Uberon), Alliance/GXD/ZFIN | Cardoso-Moreira mouse arm | Uberon | Bgee rank / per-source |
| Orthology | **Alliance** (DIOPT) | Ensembl Compara | gene ids | method count |
| Residue alignment | **Ensembl REST** protein alignment | UniProt + pairwise | UniProt/Ensembl | identity |

**Rule that follows from the survey:** one row = one source = one unit, named. An aggregator (Open Targets,
Alliance) may serve a row, but the row names the *underlying* source and release it came from.

---

## 3. Failure modes (inherited and new)

Inherited from v1 §5 (absence ≠ not expressed; no cross-unit axis; no top-tissue headline; no
expression→pathogenicity sentence; no double counting; no invented version; no stage-blind comparison).
New for this tab:

1. **Not phenotyped ≠ no phenotype.** Mouse/zebrafish genes without a mutant are common. Three states, always:
   *not phenotyped*, *phenotyped, no abnormality*, *abnormal*. IMPC's viability classes are a fourth, separate
   signal (a lethal knockout masks adult phenotypes).
2. **Allele type is part of the claim.** Label null/KO, conditional, hypomorph, transgene, **knock-in of the
   human variant**, **morpholino** (unreliable), and zygosity. A heterozygous knockout that looks normal says
   nothing against a dominant human disease.
3. **Ortholog ≠ same gene.** One-to-many, `isBestScore: No`, and renamed orthologs (human *SCN1A* ↔ zebrafish
   *scn1lab*) are shown, not resolved. Surface method count and stringency.
4. **Species mismatch is information.** The mdx mouse is mild where human *DMD* disease is severe; a mouse
   model's severity must not be read as the human's.
5. **Stages are not convertible.** Show each species on its native stage scale (pcw / Carnegie, E-day / Theiler,
   hpf). No Carnegie↔Theiler arithmetic.
6. **The selection must not filter.** Ticks reorder and emphasise; every tissue stays reachable, or
   confirmation bias is built into the screen.
7. **Alliance's human phenotype list is RGD-sourced** (§1.5) and must not be presented as HPO annotation.
8. **Ubiquitous gene, tissue-restricted disease.** *LMNA*, *SMN1*, tRNA synthetases and mitochondrial genes
   are broadly expressed yet cause organ-specific disease. Broad expression is as uninformative as absence;
   the screen must never read breadth as a mark against relevance.
9. **pext is not a missense score.** Position-level, loss-of-function-calibrated (§1.2).
10. **No vote.** Model-organism phenotype is plausibility. It is not **PS3**, which requires a validated assay.

---

## 4. The phenotype picker

- **Two levels.** Top-level HPO organ-system chips by default; a typeahead expands to specific HPO terms.
  An **onset** choice (congenital, neonatal, infantile, childhood, adult — HPO onset terms) maps to a
  `HsapDv` stage and sets the stage axis.
- **Suggested vs yours.** Suggestions come from the selected disease (Tab B's `DiseaseFrame`) or the gene's HPO
  annotations; they are drawn distinctly from the researcher's own ticks, are removable, and the researcher's
  ticks always win.
- **No ticks** → the plain gene profile, **no relevance headline**.
- **The mapping chain is visible and editable.** "Cardiovascular → heart LV, atrial appendage, HPA heart
  muscle, …". The system→tissue map is **local** and declared so (dashed, per the `thresholds/` provenance
  contract). It is a table of roughly 25 organ systems, not per-gene curation.
- **Syndromic cases** get one grid row per ticked system, not a blended row.
- **HPO licence conditions** (snippet, verify at implementation): cite the consortium, **display the file
  date/version of any HPO file shown**, and do not alter the content or logical relationships. The roll-up
  table lives in the app's own file; the HPO files are consumed unmodified and their release date is printed
  in the rail.
- **Persistence.** The selection is stored with the session and exported with the report; a change of
  disease keeps the researcher's ticks and shows a "frame changed" note.

### Grid cell states (closed vocabulary)

`supported` · `present, not in ticked system` · `not sampled by this source` (`coverage`) · `sampled, not
detected` · `not annotated` · `not phenotyped` · `phenotyped, no abnormality` · `lethal before phenotype` ·
`no ortholog` · `provider did not answer` (`upstream`). Every cell is one of these; none is a bare `0`.

---

## 5. The cross-species residue panel — the one variant-specific item

For the variant's residue, the Ensembl protein alignment (verified (live)) gives the aligned residue and a
flanking window in each ortholog. Show: human residue, mouse residue, each zebrafish ortholog's residue, and
window identity. This answers a practical question: *does the model organism carry the same amino acid here?*
A zebrafish paralog with a different residue means a rescue assay there is not testing the human missense.
It informs functional-assay planning and is context only (it duplicates no existing conservation vote; link to
the Predictors tab's conservation rather than restate it).

---

## 6. Worked cases (the test set)

All numbers marked v1 are from `TISSUE_EXPRESSION_PROPOSAL.md` §3.3 (HPA export read 2026-09-28).

| Case | What it must show |
|---|---|
| **FGFR3 p.Gly380Arg** (achondroplasia) | skeletal system ticked → human cartilage `not sampled` (GTEx/HPA gene export lack it, v1) rather than "skin"; mouse `Fgfr3` has skeletal MP phenotypes across KO and transgene alleles (live read); zebrafish `fgfr3` has chondrocyte ZFA phenotypes for two alleles (read); orthology panel shows mouse, zebrafish and the two frog paralogs |
| **GJB2** (hearing loss) | hearing ticked → cochlea `not sampled` in human; HPA top tissues (esophagus etc., v1) shown only as context; mouse/zebrafish states must distinguish `not phenotyped` / `lethal before phenotype` / `abnormal` (the specific mouse and zebrafish GJB2 states are **UNVERIFIED** — read them at build time, do not assume) |
| **SCN1A** (Dravet) | infantile onset → stage-gap statement ("brain only: BrainSpan covers 4 mo–2 y; no other organ at this age; dGTEx not released"); zebrafish ortholog is named `scn1lab` (naming trap) — to confirm from the live ortholog call |
| **DMD** | isoform/tissue note (Dp71 brain isoform — **UNVERIFIED**, confirm); mouse-vs-human severity mismatch caveat as a labelled model limitation |
| **LMNA** | pleiotropy (several diseases) tests the frame selector; ubiquitous expression tests failure mode 8 |
| **ABCA4** (Stargardt) | retina in HPA, absent in GTEx (v1); the grid must show *which source* answered |
| **GBA1** | low tissue specificity; cell-type read (macrophage) beats bulk; HPA single-cell and Tabula Sapiens columns carry it |

---

## 7. Architecture (matching the reference tabs)

```
src/shared/phenotypeFrame.ts            ticks, onset, system→tissue map (local), stage mapping
src/shared/expressionModels.ts          pure model: buildExpressionGrid(result, frame, ticks) → cells[] + states
src/shared/thresholds/expression.ts     HPA categories, pext cut-points: {kind, source, url}; transcribed, not remembered
src/components/evidence/ExpressionModelsTab.tsx   finding → grid → secondary (orthology, residue panel)
src/components/inspector/ExpressionRail.tsx       rule trace, sources+releases, stage-coverage map, mapping chain
src/styles/expression.css               prefixed, tokens only
server/services/external-api/gtex.ts  hpa.ts  alliance.ts  impc.ts  ensembl-homology.ts  bgee.ts
server/services/external-api/gnomad.ts  (extend: pext selection on the existing client)
```

Registration points that are currently easy to forget (from v1 §6.2): `assembly.ts` (GTEx/gnomAD/pext are
GRCh38; a GRCh37-only run refuses as AlphaGenome does), `attributions.ts` (licences: Alliance CC BY 4.0,
IMPC CC BY 4.0, Bgee CC0, HPO conditions), `provenance.ts`, `cache-keys.ts`, `core-data-fetcher.ts`,
`MetricExplanations.ts`, `energeticsLabels.guard.test.ts`.

**Data handling.** Gene-level matrices (GTEx medians, HPA consensus, HPO annotations) are the same for every
variant: **pinned offline snapshots**, release recorded in provenance, and no 43 MB TSV shipped whole —
precompute a per-gene subset. Alliance, IMPC and Ensembl are per-gene live calls with caching. **pext** is
live and per-gene via the existing gnomAD client. Every reading carries source, release, unit, UBERON/Cell
Ontology id, label, value, per-tissue n, stage, and the source's own call.

---

## 8. Phases (each shippable)

Re-written per the §12 second-pass verification: every API shape named here was live-confirmed on
2026-10-05, so each phase starts from a working endpoint, not an assumed one.

| Phase | Content | §12-informed detail |
|---|---|---|
| **0** | `phenotypeFrame` + picker + HPO system roll-up (local, declared); the layer registered as context that votes nowhere | Roll-up sourced from pinned `genes_to_phenotype.txt` — its `disease_id` column also seeds the Tab B `DiseaseFrame` (one file, two consumers). Pin the file with its release date; add the "339 annotations" recount lesson: never print a count the pinned file itself hasn't been filtered to |
| **1** | Human adult grid: GTEx v10 REST + HPA snapshot + **Open Targets baseline expression**, coverage states, per-tissue n, HPA IHC level | Open Targets handled as verified-live backend: `targets(ensemblIds:[…]).baselineExpression(page:{index,size})`, one GraphQL call for GTEx bulk (`datatypeId: "bulk rna-seq"`) and Tabula Sapiens cell-type (`datatypeId: "scrna-seq"`), UBERON/CL ids native via `biosampleId`. **Medians can be `0` — they are values, not coverage gaps; render per the closed state vocabulary**. Every row stores `datasourceId` + `unit` (the aggregator rule of §2 rides on fields the API already exposes) |
| **2** | Orthology (Alliance) + mouse/zebrafish phenotype columns (+ IMPC) + **residue panel** (Ensembl) | IMPC by Solr `marker_symbol` (mouse form) or `human_gene_symbol`; `symbol:` is not a field. IMPC's `phenotyping_data_available` / `embryo_data_available` checkboxes are separate from MGI literature alleles: a gene can be screen-screened by IMPC and have literature MP terms, or either alone — the grid must show both states, and the FGFR3 **`not phenotyped (IMPC)` with MGI alleles present** case becomes a fixture. Ensembl homology client must send `accept: application/json` (bare fetches get HTML). Orthology detail shows `isBestScore` per row (fly `htl` Yes / `btl` No from the live read) |
| **3** | **pext** at the variant position (existing gnomAD client) | Schema confirmed by introspection: `regions { start stop mean tissues { tissue value } }` — **no `flags` field exists**; drop it from the type. Overlap by `start`/`stop` needs the variant's GRCh38 coordinate (already in the request). Wording fixed per §12: "the transcript region containing this variant contributes X % of tissue T's expressed output (gnomAD v4 pext, GTEx v10)". Cut-points still transcribed from the pext help page, never quoted from memory |
| **4** | Stage axis: BrainSpan, E-MTAB-6814 (human **and mouse** arms), HDCA/CELLxGENE cell-type snapshot, **Bgee expression-calls TSVs**, DECIPHER embryo deep link, `watch` entry for dGTEx | Bgee switched to CC0 download files per §12 (`gene-expression-calls` per species, human/mouse/zebrafish in one pass, UBERON × stage columns) — pinned snapshots, no SPARQL runtime dependency; the JSON API at `doc-api/` is the fallback if a snapshot needs regeneration. Bgee species count is 52 (fish-emphasised) — verify zebrafish coverage in the chosen release before wiring the column |
| **5** | Per-tissue AlphaGenome tracks keyed by ontology term | Unchanged; verify the track-to-UBERON join again at build — it was not re-exercised in §12 |

---

## 9. Tests that must exist before it ships

- Grid contract on §6: FGFR3 → cartilage `not sampled` (not skin); GJB2 → cochlea `not sampled`; GBA1 → low
  specificity with a cell-type column.
- **Closed state vocabulary**: no cell renders `0`, empty, or "not expressed" for a coverage gap.
- **Orthology completeness**: FGFR3 renders mouse + zebrafish (+ frog paralogs in the detail list); a one-to-many
  fixture shows every ortholog; `isBestScore: No` is visible.
- **`not phenotyped` ≠ `phenotyped, no abnormality`**, and IMPC lethal ≠ either.
- **Alliance human-phenotype guard**: RGD-sourced human annotations are never rendered in the HPO column.
- **Selection never filters**: with ticks applied, every tissue remains reachable.
- **No cross-unit axis**; one row = one source = one unit.
- **Stage labels native per species**; no cross-species stage conversion.
- **Votes nowhere**: a guard that no expression, pext, or model-organism value reaches `criteria.ts`.
- **GRCh37 refusal** for GTEx/pext paths.
- **§12 fixtures**: gnomAD pext type has no `flags`; fetches without `accept: application/json` to Ensembl
  fail loudly; Open Target rows with `median: 0` render as values, not coverage gaps; FGFR3 IMPC row is
  `not phenotyped (IMPC)` while MGI literature alleles still show in the same phase.

---

## 10. Decisions already made (from the review) and what is still open

Made: split into two tabs; phenotype ticks drive the grid; suggestions are pre-filled and removable; Alliance
first with per-source fallback; naming "Expression & models" and "Gene–disease"; nothing votes.

Still open and worth your call:

1. **pext in the first release or later?** It is the cheapest position-level signal (existing client), but its
   missense meaning is unverified. Recommend Phase 3 with explicit "context, LoF-calibrated" wording.
2. **Live Alliance vs a nightly snapshot** for orthology/phenotype. Monthly Alliance releases argue for a
   snapshot keyed to the release id; live calls are simpler but unpinned.
3. **DECIPHER deep link**: ship it only after the URL pattern is confirmed from a working page.
   Status as of §12: `gene/FGFR3/expression` still returned HTTP 500 on the second pass, so the link
   stays shelved.

What §12 settled (no longer open):

- **pext field shape** — `regions { start stop mean tissues { tissue value } }`, no `flags`. Verified by
  introspection; the type in §7 should drop it when written.
- **IMPC query field** — `marker_symbol`/`human_gene_symbol` on the `gene` core; confirmed, so Phase 2 has
  a working endpoint contract, not a guess.
- **Open Targets API shape** — Ensembl-id keyed, `page:{index,size}`, biosample objects with ontology ids.
  Phase 1's dual bulk+scrna read is a single API, not two integrations.
- **Bgee access mode** — CC0 download files primary, JSON API fallback, SPARQL not in the runtime path.
  Phase 4 no longer carries REST-availability risk.

---

## 11. Sources

**Verified live (2026-10-05):** Alliance orthologs (`/api/gene/HGNC:3690/orthologs`); Ensembl REST homology
with aligned protein; gnomAD GraphQL `gene.pext` (introspection + FGFR3 sample).

**Verified (page, via summariser):** DECIPHER v11.31 release note (`ebi.ac.uk/about/news/updates-from-data-resources/decipher-v11-31-released`);
gnomAD v4 pext news (`gnomad.broadinstitute.org/news/2024-11-gnomad-v4-pext/`); HPA downloads page (v25.1,
Ensembl 109); Open Targets baseline-expression docs; Bgee suite paper (PMC7778977); GXD 2026 update
(PMC12807655); Expression Atlas home; Alliance 2023 paper (PMC10628019); Alliance phenotype endpoints; NHGRI
dGTEx programme page; uPheno paper (PMC11429889).

**Snippet / UNVERIFIED:** IMPC DR23 figures and Solr path; Monarch v3 API; HPO licence conditions; GenCC and
ClinGen access details (Tab B); dGTEx 2026 renewal concept (PDF not machine-readable); HDCA size figures;
CELLxGENE web API; Bgee REST; DECIPHER API/URL; pext cut-points; every specific mouse/zebrafish state named
in §6 beyond FGFR3.

**Carried from v1:** GTEx 54-tissue REST and the no-donors-under-20 finding; BrainSpan; E-MTAB-6814; HDBR;
HsapDv/EHDAA2; titin isoform switch; ClinGen SVI splicing and PVS1 papers.

---

## 12. Second-pass re-verification — 2026-10-05, live HTTP from this machine (Revision 2.1)

Every fact below was exercised with a direct `fetch` and the raw response read. All of §1.5's
"verified (live)" items were re-confirmed; the following rows change, upgrade, or correct the survey.

| Claim in this document | Status after second pass | Correction / upgrade |
|---|---|---|
| gnomAD `gene.pext` queryable from the existing client | **verified (live)** — FGFR3 returned 21 regions, 7 distinct per-region means (0.031–0.816), 54 tissue values per region | Upgraded from single-sample read. **`flags` does not exist** on `PextRegion` (introspection: `start, stop, mean, tissues`); the original claim's schema string was wrong. Region-level values genuinely vary — the position-level read is real, not gene-level |
| Alliance `/api/gene/HGNC:3690/orthologs` | **verified (live)** — same 9 stringent rows, request-dated 2026/10/05 | One detail: fly `htl` is `isBestScore: Yes`; **`btl` is the `isBestScore: No` pair**. `egl-15` is confidence *moderate*, methods 7. Method-count display obligation unchanged |
| Alliance `expression-summary` / `openapi.json` 404 | **re-confirmed live** (both HTTP 404) | Upgraded from claimed → reproduced. Expression route names remain UNVERIFIED |
| Alliance `/api/gene/{id}/phenotypes` per genotype/allele | **verified (live)** — `MGI:95524` returns allele/genotype-scoped MP annotations with evidence (e.g. `MP:0009250` abnormal appendicular skeleton, Col2a1-Fgfr3 transgenic allele) | Matches §1.5 |
| Alliance human `HGNC:3690` phenotypes are RGD-sourced | **verified (live)** — every returned `GenePhenotypeAnnotation` carries `dataProvider: RGD`; **25 annotations in the returned block** (the earlier "339" count was not reproduced — recount at build; either way, provenance is uniformly RGD) | The trap stands; the head-count should not be quoted |
| Ensembl REST homology with aligned protein | **verified (live)** — `ortholog_one2one` with aligned sequences; requires `accept: application/json` (a bare fetch returns HTML and yields a parse error — worth a client test) | Upgraded |
| DECIPHER v11.31 Expression tab (HDCA), TBX5 example, G2P ear data 87 genes / 97 LGMDE | **verified (live text)** — the EMBL-EBI release note read in full: 12 sections of a 6–7 pcw embryo, sagittal view, Expression tab on gene pages and the patient record | Upgraded from page-through-summariser. `https://www.deciphergenomics.org/gene/FGFR3/expression` still **HTTP 500** — deep link stays shelved |
| Open Targets baseline expression (GraphQL) | **verified (live)** — `targets(ensemblIds:[ENSG00000068078]).baselineExpression` returns **1,428 rows** for FGFR3: `datatypeId` = `bulk rna-seq` (datasource `gtex`) and `scrna-seq` (datasource `tabula_sapiens`), each row with UBERON/CL ontology id (`biosampleId`, e.g. `UBERON_0000007`), `median`, `specificity_score`, `unit`. Requires `page:{index,size}`; **medians can be 0** and rows are per biosample×datatype | Upgraded from page-summariser; API shape confirmed (query by Ensembl id, biosample objects, not a `tissue` field) |
| IMPC Solr | **verified (live)** — `https://www.ebi.ac.uk/mi/impc/solr/gene/select` answers; correct query fields are **`marker_symbol` (mouse form, `Fgfr3`)** or **`human_gene_symbol:FGFR3`** (a raw `symbol:FGFR3` errors with "undefined field"). FGFR3 doc carries `embryo_data_available: false` | Upgraded from snippet. The `phenotyping_data_available` flag is per-gene truth for the `not phenotyped` state |
| bgee.org — REST | **upgraded:** SPARQL endpoint is **live** (`https://www.bgee.org/sparql/`, Virtuoso; versioned graphs e.g. `<https://bgee.org/rdf_v15_1>`), and the 2024 paper documents a **new JSON API at `https://www.bgee.org/doc-api/`** with an expression-calls endpoint. Several guessed REST routes and a v15_1 expression query returned empty/404 in this pass (verified (live): the *endpoint* answers; the *routes/queries* still need the API doc at build time). Species count per the 2024 paper: **52** (not 29), with an emphasis on fish — directly relevant to the zebrafish column | Treat as: SPARQL + JSON API exist; exact expression query verified-by-doc, route-by-route |
| Monarch v3 API (`api.monarchinitiative.org/v3/api`) | **upgraded to verified (live)** — entity lookup returns FGFR3 with xrefs (Ensembl, OMIM) | Was snippet; usable for cross-species phenotype hops |
| HPO `genes_to_phenotype.txt` | **verified (live)** — served at `http://purl.obolibrary.org/obo/hp/hpoa/genes_to_phenotype.txt`, columns `ncbi_gene_id, gene_symbol, hpo_id, hpo_name, frequency, disease_id` (`OMIM:…`) | New: this file already carries a **disease id per row**, which feeds the `DiseaseFrame` (Tab B) directly, not just the HPO column |

**Not re-exercised in this pass (still as labelled in §1.3/§1.4):** HPA release figures, Expression Atlas,
GXD 2026 counts, dGTEx programme pages, uPheno paper, HDCA/Census size claims. They were page-verified
on the first pass; re-verify at build only where a number will be printed.

### What the second pass changes — evidence-graded upgrades

1. **pext is stronger than written, and structurally cleaner.** No `flags`, four fields, values vary by
   region. Phase 3 wording can say: "the region of the transcript containing this variant contributes
   X % of tissue T's expressed output (gnomAD v4 pext, GTEx v10)" — no misleading schema, no cut-points
   quoted until the help page is read.
2. **IMPC gives the tab a per-gene truth table it can serve from one cheap Solr call.** For every mouse
   ortholog: `phenotyping_data_available`, `embryo_data_available`, production statuses. Add a test:
   *FGFR3 renders `not phenotyped (IMPC)` even though MGI literature alleles exist* — the two sources
   answer different questions and must stay separate rows.
3. **Open Targets can carry the cell-type and aggregator rows with less code than planned** (one GraphQL
   endpoint, ontology ids native). Keep the proposal's "never one axis" rule by attaching
   `datasourceId` + `unit` to every row read — the API supports exactly that.
4. **Bgee via CC0 download files, not SPARQL.** The expression-calls TSVs give per-gene presence/absence
   per UBERON × developmental stage for human, mouse, zebrafish at once — pinned snapshots satisfying
   §2's "one row = one source = one unit" without new runtime coupling. Use SPARQL only for ad hoc
   queries outside this tab.
5. **HPO genes_to_phenotype doubles as the Tab B bridge.** Its `disease_id` column means the phenotype
   picker's "suggested systems" can be derived from the same pinned files.
