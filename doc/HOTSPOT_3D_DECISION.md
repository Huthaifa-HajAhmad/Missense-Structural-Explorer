# Decision: 3D proximity (PathProx) on the Hotspots view (2026-10-28)

**Decision: adopted, as a labelled, non-voting suggestion.** The pre-registered benchmark passed both of its
gates. The Hotspots view shows the PathProx score only for a gene whose clustering gate passes at run time. It
is graded "Published method, benchmarked here" and is never an engine input.

It is not adopted as evidence for any ACMG criterion. No decile→strength table was proposed or tested.

## Question

Does the 3D proximity reading of Sivley et al. 2018 (AJHG, PMID 29455857), computed on the AlphaFold DB model
the app shows, separate germline ClinVar P/LP missense from gnomAD missense? And does it do so beyond the
regional O/E the app already shows?

## Pre-registration

`scripts/hotspot_benchmark/thresholds.json`, sha256 `2c3bb84254e3d013e0886ab5de5bac4b408cac275ddd24660110820394c414ad`,
was written before any score was joined to a test variant.

Disclosure: before registration, `scripts/hotspot_probe/ripley_probe.py` had computed only the two clustering
p-values for SOD1 and VHL. No discrimination statistic had been computed for any gene.

- **Genes:** SOD1, BRCA1, LDLR, VHL, SCN1A, KCNQ2. RYR2 was excluded a priori, because AlphaFold DB serves no
  model above 2,700 residues.
- **Structure:** the AFDB F1 model. Only residues with pLDDT ≥ 70 (AFDB's published band) are used. The model
  sequence must equal the MANE protein.
- **Sets:** P = residues with a ClinVar P/LP missense of ≥ 1 star. N = residues with a counted gnomAD v4.1
  missense, excluding P/LP and conflicting variants. These are the tolerance benchmark's rules.
- **Gate:**
  - Univariate K test: P against random residue sets.
  - Bivariate K test: P minus N, under label permutation.
  - Both use the range from the minimum observed distance to half the maximum, a 40-step grid, Simpson area
    against the permutation median, 2,000 permutations, and p = (k + 1) / (n + 1).
  - Clustered means both p < 0.05 with a positive area.
- **Score:** PathProx at the distance with the largest bivariate Z. The residue's own entries are left out.
- **Gates for adoption:**
  - **P3:** AUROC ≥ 0.70 with a CI lower bound ≥ 0.60, in ≥ 2 informative genes.
  - **P5:** in ≥ 1 informative gene, the paired ΔAUROC against RMC O/E has a CI above 0.

## Result

Run with `npx tsx scripts/hotspot_benchmark/benchmark.ts` (offline, about 14 s). Every scoring number is
reproducible bit for bit; the one field that changes between runs is the recorded wall-clock time in
`results.json` (`runtimeMs`), which is why the timings live beside the scores rather than inside them.

| Gene | Confident / length | Clustering p (uni / bi) | AUROC P/LP vs gnomAD AC≥2 [95% CI] | RMC AUROC | ΔAUROC vs RMC [95% CI] |
|---|---|---|---|---|---|
| SOD1 | 154 / 154 | 0.004 / 0.003 | 0.64 [0.55, 0.73] | 0.50 | +0.14 [0.05, 0.23] |
| BRCA1 | 324 / 1863 | 0.001 / 0.001 | **0.72 [0.66, 0.79]** | 0.50 | +0.22 [0.16, 0.29] |
| LDLR | 625 / 860 | 0.017 / **0.091** | 0.60 [0.56, 0.64] | 0.50 | +0.10 [0.06, 0.14] |
| VHL | 155 / 213 | 0.001 / 0.002 | 0.67 [0.59, 0.75] | 0.50 | +0.17 [0.09, 0.25] |
| SCN1A | 1236 / 2009 | 0.001 / 0.001 | **0.72 [0.69, 0.76]** | 0.69 | +0.03 [−0.01, 0.07] |
| KCNQ2 | 350 / 872 | 0.001 / 0.001 | **0.90 [0.85, 0.94]** | 0.90 | −0.00 [−0.03, 0.02] |

- **Informative genes:** SOD1, BRCA1, VHL, SCN1A, KCNQ2. LDLR fails the bivariate gate.
- **P3 passes** in BRCA1, SCN1A and KCNQ2.
- **P5 passes** in SOD1, BRCA1 and VHL.

The mechanical decision is **adopt**.

## What the result means, and what the screen says

- **P5 passes only where RMC is flat.** SOD1, BRCA1 and VHL each have one regional interval, so RMC O/E is
  constant across the gene and scores 0.50 by construction. Where RMC has breakpoints (SCN1A with 18 intervals,
  KCNQ2 with 8), PathProx adds nothing over it: the ΔAUROC intervals include 0.
- **The screen says this in the rung itself:** "the benchmark found it adds to regional O/E only where O/E is
  flat across the gene".
- **Below 0.70 in some genes.** SOD1 (0.64) and VHL (0.67) pass the clustering gate but stay below the P3 bar.
  At run time the score therefore carries a per-gene self-check: the leave-residue-out AUROC of P/LP residues
  against gnomAD-only residues, computed on that gene's own data.
- **Deviations from the paper, stated on screen:** 2,000 permutations instead of 100,000; no cross-protein FDR
  (one protein at a time); an AlphaFold model instead of a solved structure; residues instead of variants.
- **Confounds not removed:**
  - ClinVar submission bias toward well-studied regions.
  - Monomer models of obligate oligomers (SOD1 is a dimer).
  - Domain-level clustering can read as a hot spot.

## Known limits of the statistic itself

These do not change the adoption decision, and they are stated so nobody reads more into the number than it
carries:

- **The self-check AUROC is in-sample.** The PathProx threshold is the grid point with the largest bivariate
  z on the same P/N labels that are then scored, so the in-gene AUROC is optimistic. The view says
  "in-sample" and names the negative set (every counted gnomAD missense, which is wider than the AC≥2 set
  graded here). The in-gene AUROC is also withheld below 10 scored residues per class, the population in which
  P3 was graded.
- **The bivariate null permutes labels over a pooled list that can contain a residue twice.** A residue in
  both P and N is concatenated, so the two copies are always in different classes and a distance-0 pair
  between them can never become P–P or N–N under permutation. The mechanism is real; its effect on the
  observed areas has not been measured, and changing it would invalidate these registered numbers. Treat the
  gate as conservative-untested until a re-registration measures it.
- **No out-of-sample gene.** Thresholds were registered and evaluated on the same six genes; the falsification
  clause below is the only independent check.

## Falsification

Re-open this decision only by re-running `benchmark.ts` under the same `thresholds.json`, for example after a
ClinVar refresh with new slices. Revert it if either of these happens:
- fewer than two informative genes reach P3;
- no informative gene keeps P5.

Adding genes requires a new pre-registration file, not an edit to this one.

## Implementation

| Piece | File |
|---|---|
| Statistic (one implementation for server and benchmark) | `src/shared/spatialClustering.ts` |
| Cα trace reader | `src/shared/coordinateText.ts` (`readCaTrace`) |
| Worker task (keeps the event loop free; SCN1A measured about 12.5 s in `results.json`) | `server/workers/structural-diff-worker.ts` (`runSpatialClustering`), `server/services/stability/biophysics-pool.ts` |
| Server rung, numbering check, sets | `server/services/evidence-context/hotspots.ts` |
| View model and rung wording | `src/shared/hotspotEvidence.ts` |
| Tests | `src/shared/__tests__/spatialClustering.test.ts`, `hotspotEvidence.test.ts` |

## Sources

- Sivley RM, et al. Comprehensive analysis of constraint on the spatial distribution of missense variants in
  human protein structures. Am J Hum Genet 2018. PMID 29455857. Preprint doi 10.1101/109652.
- AlphaFold DB confidence bands: Jumper et al. 2021; Varadi et al. 2022 (the app's `STRUCTURE_COLOUR_BANDS`).
