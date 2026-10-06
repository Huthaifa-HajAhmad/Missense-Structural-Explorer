# Tissue & developmental expression — should this workspace add it, and how

> **Superseded 2026-10-05 as a design, retained as the v1 research appendix.** The design now lives in
> `EXPRESSION_AND_MODELS_PROPOSAL.md` (phenotype-driven human + mouse + zebrafish tab) and
> `GENE_DISEASE_PROPOSAL.md` (causality, mechanism, variant locus). Three v1 rows are resolved there:
> dGTEx (planned, not released), HPA version (v25.1, Ensembl 109), and E-MTAB-6814 (Cardoso-Moreira is
> multi-species, so a mouse arm exists).

Research proposal. All URLs and API responses below were read **2026-09-28** on this machine; every
number is marked either **verified** (read from the primary source in this session, response or file
quoted) or **UNVERIFIED** (could not be confirmed — do not publish it without a follow-up check).
`web_search` was unavailable in this session (no API key), so sources were read directly: GTEx REST
API, the GTEx subject files, the Human Protein Atlas bulk export, BioStudies/Expression Atlas,
ENCODE REST, OLS4, PMC/PubMed E-utilities and Crossref.

---

## 1. Recommendation

**Yes — add it, but as a context layer that never votes.** Three properties are non-negotiable, and
each is a defect the workspace already knows how to avoid:

1. **It is a plausibility / relevance layer, not a pathogenicity criterion.** No ACMG/AMP criterion
   consumes expression (verified: the two framework papers below name six splicing-related codes —
   PVS1, PS3, PP3, BS3, BP4, BP7 — and none of them is expression). The app must not manufacture a
   PP/BP code out of it.
2. **The relevant tissue is the question, not the top tissue.** A gene's highest-expressing tissue is
   routinely the wrong one, and the right one is frequently absent from every resource. Both states
   must render as states (`coverage`, not `0`).
3. **Stage is a second axis, and for congenital/neonatal phenotypes it is the axis that matters.**
   "Add embryo data" is the wrong frame; **add stage-matched data with an explicit age/stage label**,
   and say out loud where no reference exists (the 0–2 y multi-organ window is essentially empty).

It also fixes a defect the app already documents about itself. `AlphaGenomeRail.tsx:165-168` warns
the reader: *"Each AlphaGenome feature is the largest predicted effect across all biosamples, so a
feature can be driven by a tissue irrelevant to this gene."* That is exactly the gap a tissue layer
closes — and it is why this work should land **before** any further AlphaGenome calibration work.

### Phase order (each phase is independently shippable)

| Phase | Content | Why first |
|---|---|---|
| **0** | Nothing votes; the layer is registered as context | Keeps the rule engine's meaning unchanged |
| **1** | Gene-level adult bulk: GTEx v10 + HPA consensus, offline snapshots, UBERON-keyed, with `not sampled` states | Highest value per line of code; both are gene-level and cacheable |
| **2** | Stage axis: BrainSpan, E-MTAB-6814, HDBR E-MTAB-4840, HCA/CellxGene — with HsapDv labels | Answers the congenital/neonatal question honestly |
| **3** | Tissue-selected AlphaGenome tracks (per-track REF/ALT instead of `MAX_ABS_*`) | Turns the layer into the tissue-aware functional read the rail already promises |
| **4** | Tissue-resolved splicing (AbSplice / MTSplice) feeding the RNA-splicing tab | Only after 1–3, because it needs the tissue choice to exist |

---

## 2. What the workspace has today

| Fact | Evidence |
|---|---|
| Ten evidence sub-tabs; no tissue/expression source anywhere | `MasterSidebar.tsx:153-164`; a tree-wide grep for `GTEx|proteinatlas|tissue|nTPM|BrainSpan` in `src/` and `server/` returns only AlphaGenome proto comments, a ClinVar trait string and a literature-parsing test |
| AlphaGenome is queried as `MAX_ABS_*` features only — the max across every biosample | `server/services/external-api/alphagenome-client.ts:93-112` (`AVI_FEATURE_KEYS`) |
| The rail already admits that per-tissue attribution is missing | `src/components/inspector/AlphaGenomeRail.tsx:165-168` |
| gnomAD gene constraint is already fetched (`mis_z`, `oe_mis`, `pLI`, `oe_lof_upper`) and already drives PM2's ceiling and PP2/BP1 | `server/services/external-api/gnomad.ts:245-292`; `server/services/prediction/acmg/criteria.ts:352-429` |
| **There is no phenotype input at all** — the app takes a gene + variant; no HPO term is read anywhere | grep for `HPO|HP:0|phenotype` across `src/` and `server/` returns nothing |
| The vocabulary for "the data source does not cover this" already exists and is exactly right | `AbsenceClass = "install" \| "coverage" \| "upstream"` in `src/shared/engineStatus.ts:68`; an unsampled tissue is `coverage` |

That last-but-one row is the load-bearing gap: **"is this gene active in the patient's tissue at the
patient's stage?" cannot be answered without a phenotype→tissue bridge, and the app has no phenotype
and no bridge.** Section 6 proposes one that does not depend on the HPO mapping that does not exist.

---

## 3. Where expression legitimately enters variant interpretation

### 3.1 Where it does **not** vote

- **ACMG/AMP 2015 + ClinGen SVI refinements.** Verified from the primary sources: the ClinGen SVI
  Splicing Subgroup paper (Walker 2023) frames its whole scope as "six evidence categories related to
  the splicing potential of variants: **PVS1, PS3, PP3, BS3, BP4, and BP7**" — expression is not among
  them, and the paper's own recommendations are about RNA assay evidence and calibration of splice
  predictors. The PVS1 paper (Abou Tayoun 2018) refines PVS1 strength for predicted nulls; its
  abstract names no expression criterion.
- **PP4** is about the *patient's* phenotype being specific for a disease with a single genetic
  aetiology. A gene-expression profile is not a patient phenotype. Using it for PP4 would be exactly
  the "promote a soft fact to a calibrated code" defect `PREDICTORS_TAB_REVIEW.md` F/S-findings list.
- **PS3/BS3** require a functional assay. Expression is not an assay; and Walker 2023 explicitly says
  PS3/BS3 should be reserved for "well-established assays that measure functional impact **not
  directly captured by RNA-splicing assays**".

### 3.2 Where it is genuinely load-bearing

| Use | Mechanism | Source of the rule |
|---|---|---|
| **Which transcript is the biologically relevant one** | A variant only means what the expressed transcript says. The app already fights isoform-numbering defects; tissue/stage-specific expression is the same question asked from the other side | DiStefano 2018 (curating clinically relevant transcripts); the app's own numbering machinery (`doc/API.md`) |
| **Whether RNA/splicing evidence is obtainable at all** | RNA evidence must come from a tissue — and a stage — in which the transcript is expressed; a splice effect that exists only in a fetal program is invisible in adult tissue | Walker 2023 (SVI splicing) |
| **Tissue-relevant functional prediction** | AlphaGenome can be read per track instead of `MAX_ABS_*`, so the functional claim is about the phenotype's tissue | AlphaGenome Nature 2026; the existing client already requests `calibrated_scores` and carries a per-track field mask |
| **Interface / complex variants** | A missense that breaks an obligate interface only matters where both partners are co-expressed | Requires a co-expression layer (GTEx correlation or complex resources) — exploratory, not calibrated |
| **Plausibility and review framing** | "This gene acts in the tissue the phenotype implicates, at the age the phenotype starts" is a curator's prior, and a strong one — but it is a prior | Same status as constraint: context, not a code |

### 3.3 The verified demonstration set (why "top tissue" is the wrong question)

Read from the HPA gene-level export (`proteinatlas.tsv`, 119 columns) on 2026-09-28:

| Gene | HPA `RNA tissue specificity` | HPA top tissues by nTPM | The tissue the disease actually needs |
|---|---|---|---|
| **PAH** (PKU) | Group enriched | kidney 463.6; **liver 1316.7** | Liver — matches |
| **MYH7** (cardiomyopathy) | Group enriched | **heart muscle 7145.3**; skeletal muscle 13633.1; tongue 5024.6 | Heart — matches |
| **TTN** | Tissue enhanced | heart muscle 151.7; skeletal muscle 861.9 | Heart/skeletal muscle — matches (adult program) |
| **ABCA4** (Stargardt) | Group enriched | choroid plexus 90.6; **retina 328.7** | Retina — matches, and **GTEx has no retina at all** |
| **FGFR3** (achondroplasia, the README's own case) | Tissue enhanced | brain 148.8; esophagus 126.6; **skin 1 256.5** | **Growth-plate cartilage — absent from GTEx's 54 tissues, and never appears as a tissue label anywhere in HPA's gene-level RNA export** |
| **GBA1** (Gaucher) | **Low tissue specificity**, Detected in all | (no specific tissue) | **Macrophage/lysosome** — a cell type, not a tissue; bulk tissue dilutes it. HPA's single-cell data carries `Macrophages` |
| **GJB2** (hearing loss) | Group enriched | cervix 418.8; esophagus 779.9; vagina 501.5 | **Cochlea — absent from both** |

Two conclusions fall straight out of that table and should be encoded in the model:

1. A row that says *"GJB2 is highest in esophagus"* beside a hearing-loss phenotype is not neutral —
   it is actively misleading. The correct render is **"the phenotype-relevant tissue is not sampled by
   this resource"** (`coverage`), with the sampled neighbours shown only as context.
2. HPA and GTEx are **complementary, not redundant**: HPA's RNA tissue labels include placenta,
   retina, choroid plexus, bone marrow and tongue (≈37 distinct labels observed in the gene-level
   export, each appearing with a per-gene nTPM); GTEx has 54 tissues with per-tissue UBERON ids and
   per-tissue sample counts but **no retina, placenta, cartilage, growth plate or cochlea**.

Neutral, verified HPA category vocabulary and global counts (gene-level export, all genes):
`Low tissue specificity` 8,096 · `Tissue enhanced` 6,356 · `Tissue enriched` 3,132 ·
`Group enriched` 1,547 · `Not detected` 1,031. Distribution values are a separate axis
(`Detected in all/many/some/single`). **The numeric definitions of those categories must be
transcribed from the HPA dictionary at implementation time — do not restate them from memory.**

---

## 4. The resources, and the honest state of each

### 4.1 GTEx — add it, with the pediatric hole stated as a property

Verified against `https://gtexportal.org/api/v2/dataset/tissueSiteDetail` on 2026-09-28:

- **54 tissue sites**, and the portal serves **both `gtex_v8` and `gtex_v10`** (`?datasetId=gtex_v10`
  returns `"datasetId":"gtex_v10"`, `totalNumberOfItems: 54`).
- Every row carries an ontology id, e.g. `Heart_Left_Ventricle` → `UBERON:0006566`,
  `Whole_Blood` → `UBERON:0013756`. **This is what makes a tissue→UBERON→phenotype join mechanical.**
- Per-tissue RNA-seq n varies by two orders of magnitude and must be displayed:
  `Adipose_Subcutaneous` 663 (v8) / **714 (v10)**; `Muscle_Skeletal` 803; `Kidney_Medulla` **4**;
  `Fallopian_Tube` 9; `Bladder` 21.
- **Age range is adult in both releases.** Adipose subcutaneous: 21–70 y (v8) and 21–70 y (v10).
- The subject tables say the same thing twice over: GTEx v8 subject phenotypes = 980 donors, decade
  bins 20-29 = 84 … 70-79 = 33, **zero donors under 20**; the v11 subject table (981 subjects, same
  columns) has bins 20-29 = 84, 30-39 = 78, 40-49 = 153, 50-59 = 315, 60-69 = 318, 70-79 = 33 —
  **also zero under 20**.
- `dgtex.org` (developmental GTEx) redirects to the GTEx portal — it exists, but its scope, age range
  and tissue list are **UNVERIFIED**: the portal FAQ is JS-rendered and returned no content. Do not
  quote numbers for dGTEx.

**Consequence to encode:** for a 0–2 y phenotype, adult GTEx has literally no coverage, so
*"not expressed in GTEx"* must never be rendered as evidence against pathogenicity. It is `coverage`.

### 4.2 Human Protein Atlas — add it for what GTEx lacks

- Adds tissue labels GTEx does not sample (placenta, retina, choroid plexus, bone marrow, tongue) and
  adds a **cell-type axis** (`Macrophages`, `Cardiomyocytes`, `Hepatocytes`, …) that bulk GTEx cannot
  express. Cell-type resolution is exactly what GBA1/Gaucher needs.
- Provides a **tissue-specificity call and a Tau-style score per gene**, i.e. a ready-made answer to
  "is this gene broadly or narrowly expressed?" — verified vocabulary and counts in §3.3.
- **Units are not GTEx's.** HPA reports **nTPM** (its own normalization) and single-cell **nCPM**;
  GTEx reports TPM. Three different units with three different normalizations — the model must carry
  the unit as a field and the UI must never draw them on one axis. This is the "name what actually
  served a number" rule applied to units.
- HPA's exact version string was not established in this session; per `attributions.ts`'s own rule,
  `release` stays `null` unless the code pins one. Do not fill it in from a marketing page.

### 4.3 Developmental and pediatric — this is the "embryo data" answer

**Yes to stage-matched data; no to treating "fetal" as "infant", and no to pretending the infant
window is covered.** Verified resources:

| Resource | Stages / ages | Scope | Units | Note |
|---|---|---|---|---|
| **BrainSpan** | **8 pcw → 40 y**, 32 age labels (13 prenatal stages, 19 postnatal incl. 4 mo, 10 mo, 1 y, 2 y) | 524 samples, 42 donors, 26 brain structures, brain only | gene-level **RPKM**, Gencode v10 | Files are served (hosting alive, "©2004–2026"), but the annotation is frozen at Gencode v10 (2013-era): a **legacy reference, not a live atlas** |
| **E-MTAB-6814** (Cardoso-Moreira 2019 human arm) | **4 pcw → 58–63 y**, 23 stages, labels include **neonate, infant, toddler, school-age child** | 313 samples, **7 organs only** (brain, cerebellum, heart, kidney, liver, ovary, testis) | TMM-normalized CPM/RPKM, GRCh37/Ensembl E71 | The **only verified resource that spans the infant window** — and it covers 7 organs, so most pediatric phenotypes have nothing |
| **HDBR E-MTAB-4840** | **4–17 pcw** (bank collects 3–20 weeks of development) | 628 prenatal **brain** RNA-seq datasets; modified Carnegie staging for 4–8 pcw | hg38, TopHat2/HTSeq | Brain only; a neonatal + third-trimester post-mortem brain archive was only announced 2026-08-07 |
| **HCA / HDCA + CellxGene** | fetal, concentrated ~4–20 pcw (Cao 2020: >110 samples, 15 organs, ~4M single cells) | single-cell, cell-type attribution | single-cell counts | Programme, not a frozen release; use for *which cell type*, not for a tissue nTPM lookup |
| **ENCODE "fetal"** | gestational ages UNVERIFIED | 591 experiments matching "fetal", but **516 are Roadmap** and mostly chromatin (DNase-seq 270, histone ChIP 98); life-stage facets: embryonic 582, fetal 3, child 2, **newborn 1** | mixed | Thin for expression. Do not sell it as a fetal expression resource |
| **Pediatric Cell Atlas** (Taylor 2019) | — | **a roadmap paper, not a dataset** | — | Must not be offered as data |
| **Kids First** | pediatric **disease cohorts** (cancer, structural birth defects) | not a healthy-tissue baseline | — | Cannot serve as a normal reference |

**The gaps, stated precisely:** there is no healthy multi-organ bulk expression reference for
**0–2 y**; GTEx contributes nothing below 20 y (verified twice); the only dense infant coverage is
**brain** (BrainSpan 4 mo n=33, 10 mo n=10, 1 y n=16, 2 y n=12); and the resources disagree on stage
vocabulary (pcw vs Carnegie vs "neonate"/"toddler"). The app therefore needs a stage axis
(**HsapDv**, verified live at OLS4, release **2025-01-23**, 260 terms, Carnegie stages as first-class
classes — CS01 `HsapDv:0000003`, CS02 `HsapDv:0000005`, CS03 `HsapDv:0000007`; **EHDAA2**, latest
release IRI 2024-01-11, 2,743 terms, for developmental *anatomy*), and it needs a first-class
**"no reference exists for this tissue at this stage"** state — which is not a failure of the app but
a finding about the field.

**Why stage matters mechanistically, with a verified example:** the fetal→adult **titin isoform
switch** is documented in human myocardium (Lahmers 2004; Krüger 2008) and in skeletal muscle
(Ottenheijm 2009), and TTN truncating variants' effect is revealed in a fetal-like iPSC-cardiomyocyte
context (Hinson 2015). An adult-transcript consequence call can therefore be simply *wrong* for a
congenital phenotype. Several other switches I expected to cite (TNNT2 exon 5, MYH6/MYH7 perinatal
switch, globin switching) came back **UNVERIFIED** this session — do not publish them without a check.

### 4.4 Tissue-aware computation — use what is already wired, extend deliberately

| Tool / route | What it gives | Calibrated? | Citation |
|---|---|---|---|
| **AlphaGenome per-track** | REF/ALT effect **per biosample track** (the client already requests `calibrated_scores` and exposes a region path with a dense field mask) | The Atlas is a research tool; the app already counts the AVI toward **no** ACMG criterion | Nature 2026, `10.1038/s41586-025-10014-0` (preprint `10.1101/2025.06.25.661532`) |
| **AbSplice** | tissue-specific **aberrant splicing** prediction | Published method; not a ClinGen calibration | Nat Genet 2023, `10.1038/s41588-023-01373-3` |
| **MTSplice** | tissue-specific splicing effects of variants | Published method | Genome Biol 2021, `10.1186/s13059-021-02273-7` |
| **GTEx eQTL / sQTL** | expression- and splicing-QTLs per tissue | No framework converts an eQTL into an ACMG code; and it risks double-counting with frequency/functional evidence | GTEx portal |
| **gnomAD constraint (already read)** | gene-level pLI / LOEUF / mis_z — **not tissue-resolved** | Already used for PM2's ceiling and PP2/BP1 | Chen 2024, `10.1038/s41586-023-06045-0`, already in `attributions.ts` |

A tissue-resolved constraint layer ("intolerant *in this tissue*") does **not** exist as a ready
clinical product in what I could verify. The honest move is to **not simulate one**: show gene-level
constraint as it already is, and show tissue expression beside it as context.

Nothing in §4.4 may vote. The two that already exist in the app (AlphaGenome AVI, gnomAD constraint)
are already correctly constrained; a new tissue layer must inherit the same discipline.

---

## 5. The failure modes this layer must be built to prevent

Each one is a defect class the repo has already paid for once; the tissue layer is a new place for all
of them to reappear.

1. **Absence ≠ not expressed.** Three distinct states must render distinctly: *not sampled by this
   resource* (`coverage`), *sampled and not detected* (a real measurement), *provider did not answer*
   (`upstream`). Reuse `AbsenceClass` and `ENGINE_STATE_LABELS`; never a bare `0`.
2. **No uncalibrated cut-point may wear a published name.** HPA's category thresholds and any
   TPM band are `published` *only* when transcribed from HPA's/GTEx's own definition page, with the
   URL recorded; a convenience floor invented in the app is `local` and must be drawn dashed
   (the `{kind, source}` contract in `thresholds/`).
3. **No cross-unit axis.** TPM (GTEx), nTPM and nCPM (HPA), RPKM (BrainSpan), TMM-CPM (E-MTAB-6814)
   are five scales. One row = one source = one unit, labelled.
4. **No "top tissue" headline.** The headline is the *phenotype-relevant* tissue's value or its
   `not sampled` state. See §3.3.
5. **No expression→pathogenicity sentence.** "Expressed in the right place at the right time" is
   permissive, not determinative. The app's own precedent is the conservation rule on the Predictors
   tab ("constraint at the position, not a mechanism").
6. **No double counting.** Expression must not become a fourth vote beside the AlphaGenome AVI that
   is already the max across biosamples — and an eQTL must not be re-counted as functional evidence.
7. **No version invented.** `attributions.ts` sets `release: null` when the code establishes none.
   GTEx can be pinned by datasetId (`gtex_v10`); HPA's version string was not established here.
8. **No stage-blind comparison.** A 4 pcw value and a 40 y value in one table without an age column
   is the developmental version of the sign-drift bug in `engineStatus.ts`.

---

## 6. Implementation plan for this repository

### 6.1 The phenotype→tissue bridge (the part that decides whether this feature is real)

The app has **no HPO input**, and — verified this session via OLS4 — **HP terms do not carry UBERON
cross-references**: `HP:0001639` (Hypertrophic cardiomyopathy) returns only a PMID definition xref and
no `obo_xref` to UBERON. So the bridge is **not free** and must be built in two steps:

- **Phase 1 — gene-first, no phenotype needed (recommended).** Derive the *disease frame* from what
  the app already has: the gene's ClinVar trait strings, plus one curated table of `gene → disease →
  UBERON tissue(s) + typical onset stage`, sourced from ClinGen Gene-Disease Validity / OMIM and
  labelled in the UI as **app-curated** (dashed, per the provenance rules). This is a table of tens of
  rows, not thousands — the app's scope is rare Mendelian missense variants. It makes the feature work
  on day one without any new user input.
- **Phase 2 — optional phenotype input.** If an HPO term (or a small set) is supplied, map it to the
  **anatomical-system level** of HPO (e.g. `HP:0001626` "Abnormality of the cardiovascular system")
  and join to UBERON through the same curated table, with HsapDv for onset stage. Any mapping the
  app owns is declared `local`; any mapping taken from a published file cites the file. **Do not
  invent an HP→UBERON mapping and present it as official.**

EHDAA2 is the right companion for *developmental anatomy* once Phase 2 exists; until then, the tissue
vocabulary is UBERON (GTEx already hands it to us per tissue).

### 6.2 Modules (matching the reference-tab architecture)

```
src/shared/tissueEvidence.ts            pure model: buildTissueEvidence(result, frames) → readings[] + finding + availability
src/shared/thresholds/tissue.ts         HPA/GTEx cut-points with {kind, source, url} provenance; no hand-written copies
src/components/evidence/TissueTab.tsx   three-tier screen (finding → readings table → secondary)
src/components/inspector/TissueRail.tsx evidence lineage: rule trace, cut-points with "this variant" band, method, sources
src/styles/tissue.css                   prefixed classes, tokens only; @import in components.css
src/shared/__tests__/tissueEvidence.test.ts     contract on the reference variants
src/components/__tests__/TissueTab.test.tsx     what the screen may claim
server/services/external-api/gtex.ts    tissue list + gene median TPM; refusals; cache keys
server/services/external-api/hpa.ts     consensus nTPM + single-cell nCPM + specificity category
```

Registration points, each of which is a place a new source is currently forgotten:
`src/shared/assembly.ts` (build support — GTEx is GRCh38-keyed like AlphaGenome, so a GRCh37-only run
must refuse exactly as AlphaGenome does; HPA's gene-level export is build-invariant), `attributions.ts`
(`usedBy` paths + licence), `provenance.ts` (`PROVENANCE_DATA_SOURCES`), `cache-keys.ts`,
`core-data-fetcher.ts` (parallel fetch + refusal), `MetricExplanations.ts` (knowledge modal),
and the `energeticsLabels.guard.test.ts` guarded-file list.

### 6.3 Data handling

- **Prefer an offline snapshot for the gene-level matrices.** Gene median TPM and the HPA consensus
  file are gene-level, change on release, and are identical for every variant in a gene — fetch once,
  pin the release, and record it in the payload's provenance. Live per-request querying of a 43 MB TSV
  is the wrong shape.
- **Keep the measurement's own anatomy.** Each reading carries: source, release, unit, tissue UBERON
  id, tissue label, value, per-tissue n, sex composition where relevant, stage/age label, and the
  resource's own specificity call. The dataset's `samplingSite` string (GTEx provides one per tissue)
  belongs in the rail.
- **Show per-tissue n.** Kidney-Medulla n=4 and Muscle-Skeletal n=803 are not the same measurement.

### 6.4 Screen shape

- **Tier 1 — the finding.** Eyebrow: "Is this gene active where the phenotype lives?" Headline figure:
  the phenotype-relevant tissue's value (or the `not sampled` state as the headline, in words).
  Callout in bold: *expression is not pathogenicity*; and, where relevant, *adult reference — the
  patient's stage is not covered*.
- **Tier 2 — readings.** One table, grouped by source and stage, one row per tissue, right-aligned
  mono numbers, unit in the column header, absent rows spanning their reason, a legend foot.
  A specificity row (HPA category) sits above the values it summarizes.
- **Tier 3 — rail.** Rule trace (why this tissue is the frame), the cut-points with provenance, the
  stage-coverage map (which stages this resource covers, and the explicit gap), and the sources.
- **Cross-links.** AlphaGenome ("read the track for this tissue"), RNA splicing ("does the aberrant
  transcript exist in this tissue?"), Multimer assembly (co-expression caveat).

### 6.5 Tests that must exist before it ships

- `tissueEvidence.test.ts` asserting the §3.3 table verbatim (PAH → liver/kidney; MYH7 → heart;
  ABCA4 → retina; **FGFR3 → `cartilage not sampled`**, not "skin"; GBA1 → `low tissue specificity`).
- A test that `not sampled` is not reachable as `0` and cannot render as "not expressed".
- A test that two different units never share an axis.
- A guard that no expression value reaches `criteria.ts` (i.e. the layer votes nowhere).

---

## 7. The decision that is yours

Only one thing here changes what the app *means*, so it should be your call:

**Does tissue/developmental expression ever contribute to a classification?** Recommendation:
**no** — context and framing only, with the AlphaGenome track selection being the single place it
changes a number on screen (and that number still votes nowhere). The alternative — letting
"expressed in the relevant tissue" add to PP3/PP4-class reasoning — has no published calibration, and
per `PREDICTORS_TAB_REVIEW.md` S1/S3 that is precisely the failure this codebase has already corrected
once.

Secondary: do you want the optional phenotype/HPO input in Phase 2, or is the gene-first frame enough?

---

## 8. Sources

**Verified in this session (2026-09-28)**

| Source | Identifier |
|---|---|
| GTEx tissue-site REST data (8 + 10) | `https://gtexportal.org/api/v2/dataset/tissueSiteDetail[?datasetId=gtex_v10]` — 54 tissues, UBERON ids, adult ages |
| GTEx subject phenotypes (v8) / v11 subject table | `https://storage.googleapis.com/adult-gtex/annotations/v8/metadata-files/GTEx_Analysis_v8_Annotations_SubjectPhenotypesDS.txt` (980 donors, none <20 y); v11 table, 981 subjects, none <20 y |
| Human Protein Atlas gene-level export | `https://www.proteinatlas.org/download/proteinatlas.tsv.zip` → `proteinatlas.tsv` (119 columns): specificity vocabulary, per-gene top-tissue nTPM used in §3.3 |
| ClinGen SVI splicing recommendations | Walker LC et al. *Am J Hum Genet* 2023;110(7):1046-1067. `10.1016/j.ajhg.2023.06.002` · PMID 37352859 · PMC10357475 |
| PVS1 decision tree | Abou Tayoun AN et al. *Hum Mutat* 2018;39(11):1517-1524. `10.1002/humu.23626` · PMID 30192042 · PMC6185798 |
| BrainSpan | Miller JA et al. *Nature* 2014. `10.1038/nature13185`; data files read first-hand (524 samples, 8 pcw–40 y, RPKM) |
| Mammalian organ development (human arm) | Cardoso-Moreira M et al. *Nature* 2019;571:505-509. `10.1038/s41586-019-1338-5`; E-MTAB-6814 (313 samples, 7 organs, neonate/infant/toddler labels) |
| HDCA roadmap | Haniffa M et al. *Nature* 2021;597:196-205. `10.1038/s41586-021-03620-1` |
| Fetal cell atlas | Cao J et al. *Science* 2020;370:eaba7721. `10.1126/science.aba7721` |
| Human Cell Atlas | *eLife* 2017. `10.7554/eLife.27041` |
| Pediatric Cell Atlas (roadmap, not data) | Taylor DM et al. *Dev Cell* 2019;49:10-29. `10.1016/j.devcel.2019.03.001` |
| HDBR prenatal brain RNA-seq | E-MTAB-4840 (628 datasets, 4–17 pcw, hg38); Lindsay SJ et al. *Front Neuroanat* 2016. `10.3389/fnana.2016.00086` |
| Developmental staging ontologies | HsapDv release 2025-01-23 (260 terms; Carnegie CS01 `HsapDv:0000003`); EHDAA2 release 2024-01-11 (2,743 terms) — via OLS4 |
| Titin developmental isoform switch | Lahmers S et al. *Circ Res* 2004. `10.1161/01.RES.0000115522.52554.86`; Krüger M et al. *Circ Res* 2008. `10.1161/CIRCRESAHA.107.162719`; Ottenheijm CA et al. *Biophys J* 2009. `10.1016/j.bpj.2009.07.041`; Hinson JT et al. *Science* 2015. `10.1126/science.aaa5458` |
| AlphaGenome | *Nature* 2026. `10.1038/s41586-025-10014-0`; preprint `10.1101/2025.06.25.661532` |
| AbSplice | *Nat Genet* 2023. `10.1038/s41588-023-01373-3` |
| MTSplice | *Genome Biol* 2021. `10.1186/s13059-021-02273-7` |
| Clinically relevant transcript curation | DiStefano MT et al. *J Mol Diagn* 2018;20(6):789-801. `10.1016/j.jmoldx.2018.06.005` |
| gnomAD constraint (already used by the app) | Chen S et al. *Nature* 2024;625:92-100. `10.1038/s41586-023-06045-0` |

**Explicitly UNVERIFIED — resolve before publishing any of it**

- dGTEx (developmental GTEx) scope, tissue list, age range, current data status.
- HPA's exact version string, and whether its per-tissue matrix (`rna_tissue_consensus.tsv`) carries a
  fetal/developmental subset and a cartilage sample. The gene-level export carries neither.
- Whether an infant (0–2 y) multi-organ bulk reference exists beyond E-MTAB-6814's 7 organs.
- ENCODE fetal/embryonic biosample gestational ages.
- HPO→UBERON: OLS4 shows no UBERON xref on `HP:0001639`; whether *any* HP term carries one, and
  whether an official mapping file is published, was not established.
- Developmental isoform switches other than titin (TNNT2 exon 5, MYH6/MYH7, globin, DMD Dp140/Dp71
  primary sources, SCN1A/KCNQ2 age-dependence).
- Co-expression evidence for interface variants being used in variant interpretation.
