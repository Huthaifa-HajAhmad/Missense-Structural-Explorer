# Hotspot feasibility probes

Two throwaway probes behind doc/FUNCTIONAL_HOTSPOTS_PLAN.md. The app never imports them. Both read the gnomAD GraphQL API
live (gnomAD v4 missense, ClinVar via gnomAD), so results move as ClinVar does.

- `per_probe.py GENE…` re-runs the gene-wise PER burden test (Pérez-Palma et al. 2020) with the parameters of
  `dlal-group/PERs/Part-2-burden-analysis.R`. Rung D in the plan.
- `ripley_probe.py GENE MODEL.pdb [MIN_PLDDT]` runs the univariate and bivariate Ripley's K clustering tests of Sivley et al.
  2018 on an AlphaFold model. Rung E in the plan. Its deviations from the paper are listed in its docstring.

Run with `python -I` (standard library only). AlphaFold models: `https://alphafold.ebi.ac.uk/api/prediction/<UniProt>` gives
`pdbUrl`; the file host needs a browser user agent.

## Parity with the shipped code

The PER burden test is implemented in TypeScript (`src/shared/perBurden.ts`) and in Python (`per_probe.py`, `burden()`).
`src/shared/__tests__/perBurdenParity.test.ts` runs the TypeScript port on the golden inputs in
`src/shared/__tests__/fixtures/perBurdenGolden.json` and checks it against the Python output stored there. The golden
covers the SOD1 and VHL hotspot fixtures plus two synthetic cases (one enriched stretch, two separated stretches).
Both sides get the same residue sets and length, so the test checks the two ports, not live gnomAD or ClinVar data.
Regenerate the golden after changing either implementation or the fixtures:

    python -I scripts/hotspot_probe/make_golden.py

The Ripley/3D probe (`ripley_probe.py` vs `src/shared/spatialClustering.ts`) is **not covered**: its permutation
p-values come from different RNGs (seeded mulberry32 in TS, Python's `random`), so they cannot match bit for bit.

Live runs need care: pass `--length N` (the AlphaFold model's residue count, e.g. `per_probe.py VHL --length 213`).
Without it the probe windows to the last observed variant rather than the AlphaFold
model length the app uses, which changes the window count and the Bonferroni `m`. The `[warn]` line reports this.

## Results, 2026-10-28

| Gene | P/LP residues | gnomAD residues | PER re-run (D) | Ripley univariate (E) | Ripley P − N (E) |
|---|---|---|---|---|---|
| SOD1 (P00441) | 67 | 89 PASS / 96 any | no region; best window 36–44, raw p 0.12 | p < 0.0005 | p = 0.005 |
| VHL (P40337), all residues | 70 | 164 PASS / 178 any | no region; best 151–159, raw p 0.0077 (×41 windows) | p < 0.0005 | p < 0.0005 |
| VHL, pLDDT ≥ 70 | 69 | 121 | — | p < 0.0005 | p = 0.001 |
| NAE1 | 3 | 365 PASS | no region | not tested (3 P/LP) | — |

The published 2019 gene-wise PER tables agree with the re-run on these genes: no PER in SOD1, VHL or NAE1.
