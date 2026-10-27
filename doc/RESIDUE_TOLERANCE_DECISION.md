# Decision: residue-level population missense tolerance on the Landscape tab (2026-10-26)

**Decision: rejected, all four candidates.** No residue-level tolerance score is added to the Landscape tab, as a lane, a
link-out or engine input. The tab keeps what it already shows: gnomAD v4.1.1 regional missense O/E (RMC) and the gnomAD/ClinVar
missense density lanes.

The question was whether a per-residue population tolerance signal should sit on the Landscape tab as PM1/PP2 context, non-voting.
Four candidates were benchmarked: (a) the MetaDome 2027 tolerance landscape, (b) MTR3D-AF2, (c) CCR, (d) an in-house sliding
window built from the gnomAD data the tab already fetches. They were tested on SOD1, BRCA1, RYR2 and LDLR against ClinVar and
gnomAD, with pass/fail thresholds fixed before any score was joined to a variant. None passed.

- In **RYR2** every candidate separates P/LP from gnomAD missense well (AUROC 0.76–0.81). RYR2 is the only study gene where
  RMC finds regional breakpoints. But every candidate there is **worse than the RMC O/E the tab already shows** (0.86). The paired
  ΔAUROC is −0.04 to −0.10, and every 95% CI sits below zero.
- In **SOD1, BRCA1 and LDLR** no candidate reaches AUROC 0.70 on the primary contrast (range 0.55–0.65). Each of these genes has
  a single RMC interval spanning the whole transcript, so this outcome was predicted before the run (see "Pre-registration").
- No candidate passed the step-3 gate, so **no decile→ClinGen strength table is proposed**.

The decision is consistent with the two standing decisions it touches:

- **PM1 stays open.** The rejection does not depend on the hot-spot ruling. Every candidate fails on discrimination or on adding
  nothing over RMC, whatever PM1 is later used for. Nothing here changes what the engine classifies.
- **No local store.** Nothing is ingested. The per-gene slices exist only inside the benchmark (`scripts/tolerance_benchmark/data/`,
  1.0 MB gzip for four genes) and are never read by the app.

Verification: `python -I -m unittest discover -s scripts/tolerance_benchmark -p test_metrics.py` gives 10 passed. The tests
include a check that the codon background, derived from the genetic code, equals MetaDome's published table for all 64 codons.
`reproduce_metadome.py` returns `exact` for SOD1. `benchmark.py` regenerates `results.json` and `results.md` from the committed
slices with no network. No app code, engine rule, contract or cache version changed.

## Sources (every number below cites one)

| Key | Primary material | Bytes checked |
|---|---|---|
| **M27** | Wiel et al., *MetaDome 2027*, bioRxiv, doi 10.64898/2026.08.26.747388 (JATS full text, v1, 2026-08-31) | — |
| **MZ** | MetaDome 2027 data release, Zenodo 10.5281/zenodo.19376150, `…GRCh38…final-dataset-sw10.tsv.gz` | md5 `6e791a9a…` equals Zenodo's, verified while streaming |
| **MS** | MetaDome pipeline source v2.0.1 (commit `e8ec9a8`), Zenodo 10.5281/zenodo.23384270 | `GeneticTolerance.py`, `codon_statistics.py`, `gene_region_computations.py`, `helper_functions.py`, `default_settings.py` |
| **C412 / MCR** | gnomAD v4.1.2 constraint TSV and v4.1.1 MCR TSV, through the app's pinned snapshot (`src/shared/constraintSource.ts`) | snapshot carries source sha256 `a3fbca52…` / `f31bbe46…` |
| **S21** | Silk et al. 2021, *MTR3D*, NAR, doi 10.1093/nar/gkab428 (PMC8265191) | — |
| **K24** | Kovacs et al. 2024, *MTR3D-AF2*, Protein Sci, doi 10.1002/pro.5112 (PMC11258768); bulk `mtr_data.csv.gz` | sha256 `30e660f4…` (no published checksum; bytes served 2026-10-26) |
| **H19** | Havrilla et al. 2019, *CCR*, Nat Genet, doi 10.1038/s41588-018-0294-6 (PMC6589356); `ccrs.autosomes.v2.20180420.bed.gz` | sha256 `711e1d46…` (no published checksum) |
| **B18** | Biesecker & Harrison 2018, *ACMG/AMP reputable source criteria*, Genet Med, doi 10.1038/gim.2018.42 | — |
| **P22** | Pejaver et al. 2022, *Calibration of computational tools…*, AJHG, doi 10.1016/j.ajhg.2022.10.013 (PMC9748256) | — |
| **R** | This benchmark's `results.json` / `reproduction.json` | computed from the above plus the benchmark inputs below |

Benchmark inputs outside the list: these are the variants themselves, read from the **same gnomAD GraphQL API the Landscape tab
already calls** (`landscape-context.ts`). That is gnomAD `gnomad_r4` (v4.1) and gnomAD's ClinVar mirror (release dated 2026-10-11),
on GRCh38. Transcript models come from Ensembl REST release 116, with GRCh37 models from grch37.rest.ensembl.org. They are labels
and coordinates, not tolerance scores.

## What each candidate is, from its primary bytes

| | MetaDome (a) | MTR3D-AF2 (b) | CCR (c) | In-house (d) |
|---|---|---|---|---|
| Formula | ((mis+1)/(mis_bg+1)) / ((syn+1)/(syn_bg+1)) over a 21-residue window, truncated at protein ends **[MS]** | missense share of observed over missense share of expected, in a 5/8/11/14 Å sphere on an AF2 model **[K24 Eq. 1]** | coverage-weighted distance between protein-changing gnomAD variants, CpG-regressed, percentile **[H19 Methods]** | MetaDome's formula on the tab's gnomAD v4.1 source, leaving each evaluated variant out of its own window **[R]** |
| Population data | gnomAD v4.1 joint exomes, FILTER PASS **[MS `default_settings.py`]** | gnomAD v2.1.1 (lifted) + v3, UK Biobank 200,000 exomes, DiscovEHR 50,000 exomes **[K24 Methods]** | gnomAD v2.0.1, 123,136 exomes **[H19]** | gnomAD v4.1 exome or genome PASS **[R]** |
| Assembly / transcript identity | GRCh38, GENCODE v45 **versioned** ids, 100% sequence identity to Swiss-Prot **[M27, MZ]** | GRCh38, **unversioned** Ensembl ids **[K24 bulk]** | **GRCh37 only**, Ensembl 75 **[H19; repo README]** | GRCh38, MANE id + version checked against C412 **[R]** |
| Published discrimination | none reported for the tolerance landscape in M27 | AUROC 0.642–0.700 by window, ClinVar ≥2★ P vs B, proteome-wide **[K24 Tables 1–2]** | OR 161.8 (40.4–647.5) for ≥95th percentile vs ClinVar benign; 4.61 for DNMs absent from gnomAD **[H19]** | — |
| Public, reproducible inputs | yes (reproduced below) | **no**: UK Biobank is application-gated and DiscovEHR "is no longer publicly available" **[K24 Data availability]** | yes (inputs public; not re-derived here) | yes |

Two notes on these sources:

- K24 is internally inconsistent. Its text gives MTR3D-AF2 5 Å AUC 0.662 and MTR3D 5 Å 0.642, but Table 1 prints the two values
  against the opposite rows.
- S21 reports AUCs of 0.63 (MTR3D 5 Å), 0.64 (MTR v2, 21 codons) and 0.67 (MTR v1, 41 codons) for single MTR scores. Only the
  random-forest consensus with solvent accessibility reaches 0.90 **[S21 Table 1]**.

## Pre-registration

`scripts/tolerance_benchmark/thresholds.json` (sha256 `0297e1c26daf3a532ca7504175139b70966e009be09c17073f88099d601578bf`) was
written at 2026-10-26T22:11 local time. That was after the candidate files were sliced and before `fetch.py` joined any score to a
variant. `benchmark.py` grades against it mechanically and prints its hash into `results.md`.

| Gate | Rule |
|---|---|
| **P1** coverage + identity | ≥90% of MANE residues scored in ≥3 of 4 genes. Transcript id **and version** must equal the pinned C412 snapshot (the RMC identity rule). A GRCh37 source qualifies only through a transcript that encodes the identical protein. |
| **P2** traceable | The score can be recomputed from public primary inputs. |
| **P3** discrimination | Primary contrast AUROC ≥0.70 with bootstrap 95% CI lower bound ≥0.60, in ≥2 genes, and one of them must be RYR2. |
| **P5** incremental | In RYR2, AUROC exceeds the RMC-O/E baseline, with a paired-bootstrap CI that excludes 0. |
| **P4** (step-3 gate only) | In the most intolerant gene-internal decile, LR+ ≥2.406 (P22 Table 1, Supporting) with lower 95% bound >1, in ≥2 genes. |
| Decision | Adopt only on P1 ∧ P2 ∧ P3 ∧ P5. Map to ClinGen strengths only if P4 also passes. |

The primary contrast is ClinVar P/LP missense (≥1★) against gnomAD v4.1 missense with joint AC ≥2, after removing any variant that
ClinVar calls P/LP or conflicting. Secondary contrasts: gnomAD singletons, gnomAD AC ≥10, and ClinVar B/LB (≥1★). Residue 1
(start loss) is excluded. Bootstrap: 2,000 iterations, seed 20261026.

**Expected outcomes, written from the published region calls before the run [MCR via the pinned snapshot]:**

| Gene | v4.1.1 MCR call | Expectation |
|---|---|---|
| SOD1 | One interval spanning the transcript, O/E 0.70, p 3.7e-5 | Near 0.5 within the gene |
| BRCA1 | One interval, O/E 0.91, p 4.8e-5 | Near 0.5 |
| RYR2 | 18 intervals, O/E 0.06–0.92 (17 project onto the CDS) | Informative if any residue-level score is |
| LDLR | One interval, O/E 1.00, p 0.91 | Near 0.5 |

## Results [R]

The primary contrast is ClinVar P/LP ≥1★ vs gnomAD missense with AC ≥2. Full tables, with all four contrasts, AUPRC, decile ORs and
residues per decile, are in `scripts/tolerance_benchmark/results.md`.

| Gene (P/LP / gnomAD AC≥2) | MetaDome | MTR3D-AF2 (11 Å) | CCR | In-house (LOO) | RMC O/E (baseline) |
|---|---|---|---|---|---|
| SOD1 (114 / 49) | 0.56 (0.46–0.66) | 0.57 (0.46–0.67) | not covered | 0.55 (0.45–0.65) | constant (one interval) |
| BRCA1 (217 / 370) | 0.57 (0.52–0.62) | 0.60 (0.55–0.64) | 0.65 (0.60–0.70) | 0.55 (0.50–0.60) | constant |
| RYR2 (243 / 1,987) | **0.81 (0.78–0.85)** | not covered | 0.76 (0.72–0.79) | **0.80 (0.77–0.83)** | **0.86 (0.83–0.88)** |
| LDLR (697 / 425) | 0.57 (0.54–0.61) | 0.57 (0.53–0.60) | 0.58 (0.55–0.62) | 0.56 (0.53–0.60) | constant |

**RYR2, paired against RMC.** ΔAUROC is −0.042 (−0.067 to −0.018) for MetaDome, −0.052 (−0.076 to −0.029) for in-house and −0.097
(−0.134 to −0.058) for CCR. The order holds on the P/LP vs B/LB contrast, where neither class is defined by gnomAD presence: RMC
0.89, MetaDome 0.85, in-house 0.84, CCR 0.80.

**Most intolerant decile, LR+ (primary contrast).**

- RYR2: MetaDome 7.49 (5.65–9.92), in-house 6.11 (4.78–7.82), CCR 7.69 (5.84–10.12). RMC's own most-intolerant decile gives
  11.24 (7.65–16.52).
- BRCA1: CCR 2.97 (2.00–4.42). This is the only non-RYR2 value above 2.406, and it is inflated by circularity (see below).
- In BRCA1, MTR3D-AF2 puts **zero** of 217 P/LP in its most intolerant decile, against 31 gnomAD variants. That fits K24's warning
  that low-pLDDT residues produce extreme scores **[K24, "Low pLDDT regions"]**.

**Coverage and window size.**

- MTR3D-AF2 has no RYR2 rows (4,967 aa). AlphaFold2 modelled 208 human proteins only in segments, and K24 re-modelled whole only
  the smallest 27 of them (2,040–2,813 aa) **[K24 Methods]**.
- CCR has no rows anywhere in chr21:32.9–33.2 Mb on GRCh37, so SOD1 and its neighbour SCAF4 are missing. Coverage does not explain
  it: gnomAD v2.1 exome coverage over the SOD1 CDS has over_10 = 1 in every bin (gnomAD API). Havrilla's other exclusions
  (segmental duplications, ≥90% self-chain) were not checked, so the cause is open.
- The in-house window n (observed missense plus synonymous SNVs per 21-residue window) has a median of 31–43 per gene and a minimum
  of 11 (RYR2). No residue in any gene falls below 10. Flat results are therefore not a power-of-window artefact.

| Gate | MetaDome | MTR3D-AF2 | CCR | In-house |
|---|---|---|---|---|
| P1 | pass (4/4) | **fail**: RYR2 0%, and ids carry no version | pass (3/4 via identical-protein GRCh37 models; SOD1 0%) | pass (4/4) |
| P2 | pass (SOD1 exact; see reproduction) | **fail** (non-public inputs) | pass (public inputs) | pass |
| P3 | **fail** (RYR2 only) | **fail** | **fail** (RYR2 only) | **fail** (RYR2 only) |
| P5 | **fail** (worse than RMC) | **fail** (no RYR2) | **fail** | **fail** |
| P4 | fail (RYR2 only) | fail | pass (BRCA1, RYR2), but moot | fail (RYR2 only) |

CCR also fails the GRCh38 pin, which is a hard constraint independent of the gates. Its P1 pass relies on the identical-protein
bridge the pre-registration allowed, but the score is still a GRCh37, gnomAD v2.0.1 product.

### Per-gene check against published region calls

- **SOD1** comes out uninformative, as predicted. The record explains it in three ways:
  - RMC finds no internal breakpoint **[MCR]**.
  - SOD1's 114 P/LP missense variants sit at **64 of 154 residues (42%)**, against 5% in BRCA1 and 4% in RYR2. Pathogenic sites cover
    nearly half the protein, leaving no tolerant background to rank against.
  - Every MetaDome window in SOD1 is already below 1 (range 0.28–0.96 **[MZ]**), and 26 of the 114 P/LP variants are themselves in
    gnomAD **[R]**.

  The gene is uniformly depleted, which RMC's single interval at O/E 0.70 already says. The memory note that "gnomAD regional blocks
  do not exist for SOD1" is imprecise: there is exactly one block, spanning the gene.
- **BRCA1**: as predicted. Its pathogenic missense clusters by function (RING, BRCT), and population depletion has not resolved that
  clustering. RMC: one interval at O/E 0.91.
- **RYR2**: as predicted, informative. RMC's 17 projected intervals capture it better than any 21-residue or point score. The
  RMC baseline is computed from the same gnomAD v4.1 counts without leaving variants out, but its intervals span 14–1,656 residues,
  so one variant's own contribution is negligible. MetaDome as deposited is not leave-one-out either, and still loses.
- **LDLR**: as predicted. No missense depletion at all (O/E 1.00, p 0.91), and 247 of 697 P/LP variants are present in gnomAD.

### Circularity, stated

- **gnomAD-derived scores vs gnomAD negatives.** MetaDome, MTR3D-AF2 and RMC count the negatives' own alleles; CCR places every
  gnomAD v2 protein-changing variant at percentile 0 by construction **[H19]**. The in-house score is leave-one-out, and the B/LB
  contrast avoids gnomAD presence. Both point the same way as the primary contrast.
- **ClinVar labels.** Some P/LP calls may themselves have used MetaDome. M27 reports 23 citing publications that invoke it under
  PM1, and notes that ACGS 2024 names it for PM1. This bias favours MetaDome, so it makes the rejection conservative.
- **Double counting.** The app's PP2 proxy is already a gnomAD missense-depletion measure (gene missense Z and O/E). A residue-level
  depletion score drawn from the same counts would be a second reading of the same data, the kind of double counting B18 warns
  against. The non-voting constraint avoids it in the engine, but a lane can still invite it in a reader's head.

## MetaDome reproduction (step 2) [R, MS, MZ]

`reproduce_metadome.py` recomputes the GRCh38 tolerance landscape from gnomAD v4.1 using MetaDome's own formula, window and codon
table. The codon table is derived from the genetic code and asserted equal to `codon_background_rates` for all 64 codons. Six
counting rules were declared up front, because which gnomAD API fields equal "joint VCF FILTER == PASS" is not documented.

- **SOD1: exact.** Rule "exome PASS, exome AC >0" reproduces all 154 codons to 1e-9. The other five rules match 6–133 codons.
- **Other genes, same rule:** BRCA1 1,737 of 1,863 codons (93%), LDLR 776 of 860 (90%), RYR2 4,387 of 4,967 (88%).
  - Mismatches come as 21-codon runs, which means a single residue's count differs (checked run by run in BRCA1 and LDLR).
  - Removing 31 specific SNVs (6 in BRCA1, 4 in LDLR, 21 in RYR2) that the API reports as exome PASS fixes most runs. The remainder
    needs variants the deposit has and the API lacks.
  - The dropped SNVs share no filter, AC or multi-allelic pattern. One-allele-per-site was tested and refuted.
  - Cause: unresolved. It is most likely a difference between the API's v4.1 records and the joint sites VCF the pipeline read.
- What this means for P2: the formula is fully traceable, and the deposit is reproducible to the codon where inputs agree. The
  benchmark's in-house score uses its own fixed counting rule. The decision does not depend on the residual, because deposited and
  in-house scores give the same verdict in every gene.

## Falsification: what would reverse the decision

Re-running `fetch.py` then `benchmark.py` under the same `thresholds.json`, with these outcomes, would reverse it:

1. **In RYR2, a candidate's paired ΔAUROC over RMC has a 95% CI above 0** (e.g. after a new gnomAD or ClinVar release), **and** it
   reaches AUROC ≥0.70 with CI lower bound ≥0.60 in at least one more study gene. That would show added, transferable signal and
   flip the decision to "adopt as context".
2. **A gene with a single RMC interval shows AUROC ≥0.70 (CI ≥0.60)** for any candidate. That would refute the explanation given for
   SOD1, BRCA1 and LDLR: that residue-level population scores cannot resolve what RMC does not.
3. **The RMC lane becomes unavailable for most genes.** Today it is withheld only when the transcript mapping cannot be verified, so
   the "incremental over RMC" premise would fail. That case needs a new pre-registration, not this one. The in-house score would face
   the same transcript-identity gate in any case.
4. **The owner adopts a hot-spot PM1 reading** defined as a cluster of P/LP with no benign variation. That is a different signal
   (density of assertions, not population depletion) and is **not** tested here. This record neither supports nor blocks it.

Not reversals:

- A better published AUROC on a proteome-wide set. K24 and S21 report 0.63–0.70, which is below this record's bar anyway.
- A larger top-decile LR+ in RYR2 alone. RMC already gives 11.24 there.

## Step 3 (decile → ClinGen strength): not proposed

The gate failed for every candidate. Two reasons would stand even if it had not:

- P22 calibrates on genome-wide ClinVar sets with a held-out year and one-sided bootstrap bounds on a local LR. Per-gene deciles from
  114–697 positives are not that procedure.
- P22's Supporting threshold is LR+ 2.406 at prior 0.0441 (Table 1). The only candidate–gene pairs above it were in RYR2, where RMC
  is stronger, and CCR in BRCA1, where the value is circular.

## Constraints, checked

| Constraint | Status |
|---|---|
| No engine vote | Holds. Nothing is wired; no file under `src/` or `server/` changed. |
| No large local store | Holds. Nothing ingested. Benchmark slices are 1.0 MB gzip for four genes and live only under `scripts/tolerance_benchmark/data/`. |
| GRCh38 pinned | Holds for the benchmark. CCR is GRCh37-only, a further reason against it. |
| Transcript version as strict as RMC | `fetch.py` refuses a gene unless Ensembl, gnomAD's MANE record and the C412 snapshot all carry the same id **and** version. MetaDome rows are matched on the versioned GENCODE id. MTR3D-AF2 cannot meet this rule (unversioned ids). Every gnomAD and ClinVar REF allele matched the CDS: 0 mismatches in all four genes. |
| PM1 decision stays with the owner | Holds. The recommendation does not depend on it (falsification item 4). |

## Link-out UI sketch

None. Adoption was not recommended, so no lane or link-out is sketched (per the brief). MetaDome remains a resource a curator can
open themselves. ACGS's guidance on it **[M27]** is a laboratory decision outside this app's evidence model.

## Reproduce

```powershell
python -I scripts/tolerance_benchmark/fetch.py            # network: streams ~1.3 GB of sources with hash checks, writes data/*.json.gz
python -I scripts/tolerance_benchmark/reproduce_metadome.py
python -I scripts/tolerance_benchmark/benchmark.py        # offline; writes results.json, results.md
python -I -m unittest discover -s scripts/tolerance_benchmark -p test_metrics.py
```

`fetch.py` stops if any bulk file's hash differs from `sources.py`, if Ensembl or gnomAD serve a different transcript version from the
pin, or if a CDS model does not translate cleanly.
