# Energetics Benchmark Report (S669 & Ssym)

- **Sign convention**: `positive = destabilizing` (kcal/mol). `DynaMut2` and `DDMut` raw outputs are negated; `FoldX`, `ThermoMPNN`, `StabilityOracle`, `RaSP`, and `ProtVar FoldX` are positive-destabilizing natively.
- **Bootstrap grouping**: 2,000 draws (seed 42) resampling whole **proteins** by UniProt accession (rows with missing accession get a `PDB_chain` group and `no_accession: true`, and are excluded from all held-out sets; Ssym direct and reverse partners share the same protein group).
- **Sample-size thresholds**: Spearman / Pearson / RMSE require `n >= 20` scored variants (otherwise `too few`); ROC AUC and A7 require `>= 20` destabilizing (`measured >= 1.0`) and `>= 20` other variants (otherwise `too few to judge`).

## Release Criteria Summary (A5, A6, A7)

| Engine | Status | A5 (Sign & Units) | A6 (Paper Agreement, All) | A7 (S669 Held-Out AUC > 0.5) | S669 Held-Out n (Destab/Other, Groups) |
| --- | --- | --- | --- | --- | --- |
| FoldX | complete (with misses) | pass (s669 5/5, ssym_dir 5/5) | pass (s669: pass (CI [0.195, 0.472] vs 0.22); ssym_direct: pass (CI [0.510, 0.706] vs 0.63); ssym_reverse: pass (CI [0.284, 0.517] vs 0.39)) | pass | 642/644 (287/355, 82 grp) |
| ThermoMPNN | complete (with misses) | pass (s669 5/5, ssym_dir 5/5) | pass (s669: pass (CI [0.272, 0.575] vs 0.43); ssym_direct: pass (CI [0.532, 0.795] vs 0.72); ssym_reverse: pass (CI [0.545, 0.663] vs 0.60)) | pass | 368/370 (162/206, 63 grp) |
| StabilityOracle | complete (with misses) | pass (s669 4/5, ssym_dir 5/5) | fail (s669: pass (CI [0.216, 0.527] vs 0.52); ssym_direct: fail (CI [0.490, 0.689] < 0.72); ssym_reverse: pass (CI [0.361, 0.664] vs 0.42)) | pass | 494/525 (217/277, 72 grp) |
| RaSP (SQLite) | partial set | unverified (too few / no WFYLIMV->AG scored) | unverified (s669: unverified (partial set); ssym_direct: unverified (partial set); ssym_reverse: unverified (partial set)) | too few to judge | 4/81 (2/2, 2 grp) |
| DynaMut2 | run in progress | pass (run in progress; s669 5/5, ssym_dir 5/5) | unverified (s669: unverified (run in progress); ssym_direct: no comparator; ssym_reverse: no comparator) | unverified (run in progress; provisional AUC CI [0.585, 0.767]) | 135/603 (56/79, 47 grp) |
| DDMut | run in progress | unverified (run in progress) | no comparator (s669: no comparator; ssym_direct: no comparator; ssym_reverse: no comparator) | too few to judge (run in progress) | 4/569 (4/0, 2 grp) |
| ProtVar FoldX | partial set | pass (partial set; s669 5/5, ssym_dir 5/5) | no comparator (s669: no comparator; ssym_direct: no comparator; ssym_reverse: no comparator) | pass (partial set) | 164/167 (72/92, 31 grp) |

## Benchmark Results (All Variants)

### s669

| Engine | Status | Scored / Eligible | Proteins | Destab / Other | Spearman rho [95% CI] | Pearson r [95% CI] | RMSE [95% CI] | ROC AUC [95% CI] | Pub. r | Pub. RMSE |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| FoldX | complete (with misses) | 667/669 (99.7%) | 85 | 300 / 367 | 0.352 [0.196, 0.496] | 0.331 [0.195, 0.472] | 1.965 [1.657, 2.267] | 0.684 [0.589, 0.776] | 0.22 | 2.30 |
| ThermoMPNN | complete (with misses) | 667/669 (99.7%) | 85 | 300 / 367 | 0.490 [0.326, 0.618] | 0.436 [0.272, 0.575] | 1.512 [1.248, 1.814] | 0.764 [0.672, 0.834] | 0.43 | 1.52 |
| StabilityOracle | complete (with misses) | 638/669 (95.4%) | 84 | 281 / 357 | 0.371 [0.183, 0.528] | 0.381 [0.216, 0.527] | 1.765 [1.543, 2.032] | 0.692 [0.579, 0.782] | 0.52 | 1.43 |
| RaSP (SQLite) | partial set | 21/192 human (10.9%; 21/669 total) | 5 | 14 / 7 | -0.035 [-0.744, 0.631] | -0.103 [-0.681, 0.485] | 2.370 [1.356, 3.750] | too few to judge | 0.39 | 1.63 |
| DynaMut2 | run in progress | 150/669 (22.4%) | 49 | 63 / 87 | 0.340 [0.170, 0.478] | 0.393 [0.165, 0.600] | 1.645 [1.218, 2.106] | 0.677 [0.584, 0.757] | 0.34 | 1.58 |
| DDMut | run in progress | 14/669 (2.1%) | 4 | 8 / 6 | too few | too few | too few | too few to judge | 0.62 | 1.50 |
| ProtVar FoldX | partial set | 186/192 human (96.9%; 186/669 total) | 33 | 83 / 103 | 0.307 [0.025, 0.527] | 0.201 [-0.049, 0.432] | 2.425 [1.924, 3.116] | 0.675 [0.522, 0.785] | - | - |

### ssym_direct

| Engine | Status | Scored / Eligible | Proteins | Destab / Other | Spearman rho [95% CI] | Pearson r [95% CI] | RMSE [95% CI] | ROC AUC [95% CI] | Pub. r | Pub. RMSE |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| FoldX | complete | 342/342 (100.0%) | 14 | 155 / 187 | 0.693 [0.487, 0.765] | 0.633 [0.510, 0.706] | 1.565 [1.252, 1.720] | 0.854 [0.736, 0.897] | 0.63 | 1.56 |
| ThermoMPNN | complete | 342/342 (100.0%) | 14 | 155 / 187 | 0.704 [0.441, 0.787] | 0.712 [0.532, 0.795] | 1.124 [0.978, 1.574] | 0.859 [0.731, 0.901] | 0.72 | 1.12 |
| StabilityOracle | complete (with misses) | 337/342 (98.5%) | 13 | 150 / 187 | 0.650 [0.461, 0.701] | 0.642 [0.490, 0.689] | 1.492 [1.298, 1.725] | 0.817 [0.744, 0.849] | 0.72 | 1.22 |
| RaSP (SQLite) | partial set | 2/65 human (3.1%; 2/342 total) | 1 | 1 / 1 | too few | too few | too few | too few to judge | 0.58 | - |
| DynaMut2 | run in progress | 62/342 (18.1%) | 6 | 35 / 27 | 0.738 [0.545, 0.781] | 0.657 [0.602, 0.763] | 1.190 [0.989, 1.556] | 0.884 [0.857, 0.936] | - | - |
| DDMut | run in progress | 0/342 (0.0%) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |
| ProtVar FoldX | partial set | 65/65 human (100.0%; 65/342 total) | 3 | 24 / 41 | 0.639 [0.158, 1.000] | 0.714 [0.343, 0.999] | 1.007 [0.981, 1.427] | 0.799 [0.667, 1.000] | - | - |

### ssym_reverse

| Engine | Status | Scored / Eligible | Proteins | Destab / Other | Spearman rho [95% CI] | Pearson r [95% CI] | RMSE [95% CI] | ROC AUC [95% CI] | Pub. r | Pub. RMSE |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| FoldX | complete | 342/342 (100.0%) | 14 | 19 / 323 | 0.407 [0.297, 0.549] | 0.380 [0.284, 0.517] | 2.148 [1.930, 2.601] | too few to judge | 0.39 | 2.13 |
| ThermoMPNN | complete | 342/342 (100.0%) | 14 | 19 / 323 | 0.587 [0.502, 0.663] | 0.600 [0.545, 0.663] | 1.533 [1.271, 2.065] | too few to judge | 0.60 | 1.53 |
| StabilityOracle | complete | 342/342 (100.0%) | 14 | 19 / 323 | 0.493 [0.397, 0.657] | 0.474 [0.361, 0.664] | 1.613 [1.279, 2.162] | too few to judge | 0.42 | 1.77 |
| RaSP (SQLite) | partial set | 0/0 human WT (0/342 total) | 0 | 0 / 0 | too few | too few | too few | too few to judge | 0.18 | - |
| DynaMut2 | run in progress | 61/342 (17.8%) | 6 | 3 / 58 | 0.001 [-0.277, 0.298] | 0.074 [-0.153, 0.248] | 2.542 [2.234, 2.729] | too few to judge | - | - |
| DDMut | run in progress | 0/342 (0.0%) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |
| ProtVar FoldX | partial set | 0/0 human WT (0/342 total) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |

## Benchmark Results (Strictly Held-Out (UniProt-matched, <25% seq id, excl. same UniProt/PDB & unmatched))

### s669

| Engine | Status | Scored / Eligible | Proteins | Destab / Other | Spearman rho [95% CI] | Pearson r [95% CI] | RMSE [95% CI] | ROC AUC [95% CI] | Pub. r | Pub. RMSE |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| FoldX | complete (with misses) | 642/644 (99.7%) | 82 | 287 / 355 | 0.358 [0.195, 0.508] | 0.333 [0.189, 0.481] | 1.967 [1.632, 2.285] | 0.692 [0.590, 0.786] | 0.22 | 2.30 |
| ThermoMPNN | complete (with misses) | 368/370 (99.5%) | 63 | 162 / 206 | 0.347 [0.146, 0.530] | 0.298 [0.113, 0.476] | 1.735 [1.343, 2.099] | 0.694 [0.575, 0.788] | 0.43 | 1.52 |
| StabilityOracle | complete (with misses) | 494/525 (94.1%) | 72 | 217 / 277 | 0.327 [0.180, 0.479] | 0.332 [0.205, 0.476] | 1.869 [1.592, 2.158] | 0.660 [0.574, 0.747] | 0.52 | 1.43 |
| RaSP (SQLite) | partial set | 4/81 human (4.9%; 4/147 total) | 2 | 2 / 2 | too few | too few | too few | too few to judge | 0.39 | 1.63 |
| DynaMut2 | run in progress | 135/603 (22.4%) | 47 | 56 / 79 | 0.315 [0.151, 0.467] | 0.358 [0.132, 0.594] | 1.703 [1.257, 2.134] | 0.673 [0.585, 0.767] | 0.34 | 1.58 |
| DDMut | run in progress | 4/569 (0.7%) | 2 | 4 / 0 | too few | too few | too few | too few to judge | 0.62 | 1.50 |
| ProtVar FoldX | partial set | 164/167 human (98.2%; 164/644 total) | 31 | 72 / 92 | 0.309 [0.003, 0.551] | 0.208 [-0.074, 0.473] | 2.472 [1.935, 3.187] | 0.685 [0.505, 0.801] | - | - |

### ssym_direct

| Engine | Status | Scored / Eligible | Proteins | Destab / Other | Spearman rho [95% CI] | Pearson r [95% CI] | RMSE [95% CI] | ROC AUC [95% CI] | Pub. r | Pub. RMSE |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| FoldX | complete | 326/326 (100.0%) | 12 | 143 / 183 | 0.683 [0.422, 0.757] | 0.634 [0.465, 0.707] | 1.561 [1.211, 1.732] | 0.852 [0.715, 0.896] | 0.63 | 1.56 |
| ThermoMPNN | complete | 339/339 (100.0%) | 13 | 155 / 184 | 0.698 [0.419, 0.782] | 0.711 [0.504, 0.800] | 1.102 [0.970, 1.564] | 0.857 [0.723, 0.900] | 0.72 | 1.12 |
| StabilityOracle | complete (with misses) | 334/339 (98.5%) | 12 | 150 / 184 | 0.658 [0.501, 0.709] | 0.658 [0.555, 0.699] | 1.474 [1.247, 1.679] | 0.818 [0.752, 0.852] | 0.72 | 1.22 |
| RaSP (SQLite) | partial set | 0/0 human WT (0/0 total) | 0 | 0 / 0 | too few | too few | too few | too few to judge | 0.58 | - |
| DynaMut2 | 0 held-out variants | 0/0 (0.0%) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |
| DDMut | 0 held-out variants | 0/0 (0.0%) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |
| ProtVar FoldX | partial set | 65/65 human (100.0%; 65/326 total) | 3 | 24 / 41 | 0.639 [0.158, 1.000] | 0.714 [0.343, 0.999] | 1.007 [0.981, 1.427] | 0.799 [0.667, 1.000] | - | - |

### ssym_reverse

| Engine | Status | Scored / Eligible | Proteins | Destab / Other | Spearman rho [95% CI] | Pearson r [95% CI] | RMSE [95% CI] | ROC AUC [95% CI] | Pub. r | Pub. RMSE |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| FoldX | complete | 326/326 (100.0%) | 12 | 16 / 310 | 0.388 [0.230, 0.505] | 0.355 [0.216, 0.456] | 2.139 [1.881, 2.679] | too few to judge | 0.39 | 2.13 |
| ThermoMPNN | complete | 338/338 (100.0%) | 13 | 16 / 322 | 0.577 [0.481, 0.654] | 0.596 [0.533, 0.657] | 1.508 [1.275, 2.037] | too few to judge | 0.60 | 1.53 |
| StabilityOracle | complete | 339/339 (100.0%) | 13 | 16 / 323 | 0.483 [0.389, 0.639] | 0.461 [0.332, 0.656] | 1.605 [1.246, 2.265] | too few to judge | 0.42 | 1.77 |
| RaSP (SQLite) | partial set | 0/0 human WT (0/0 total) | 0 | 0 / 0 | too few | too few | too few | too few to judge | 0.18 | - |
| DynaMut2 | 0 held-out variants | 0/0 (0.0%) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |
| DDMut | 0 held-out variants | 0/0 (0.0%) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |
| ProtVar FoldX | partial set | 0/0 human WT (0/326 total) | 0 | 0 / 0 | too few | too few | too few | too few to judge | - | - |

## Ssym Antisymmetry (Direct vs Reverse)

| Engine | Split | Status | Pairs | Proteins | r_dir_inv [95% CI] | mean(dir+inv)/2 [95% CI] | Pub. r_dir_inv | Pub. delta (dir+inv) |
| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: |
| FoldX | all | complete | 342 | 14 | -0.224 [-0.488, -0.088] | 0.670 [0.510, 0.758] | -0.38 | -0.47 |
| FoldX | heldout | complete | 326 | 12 | -0.210 [-0.476, -0.070] | 0.663 [0.484, 0.759] | -0.38 | -0.47 |
| ThermoMPNN | all | complete | 342 | 14 | -0.703 [-0.784, -0.507] | 0.347 [0.269, 0.436] | - | - |
| ThermoMPNN | heldout | complete | 338 | 13 | -0.699 [-0.780, -0.488] | 0.347 [0.267, 0.452] | - | - |
| StabilityOracle | all | complete | 337 | 13 | -0.790 [-0.878, -0.703] | -0.046 [-0.089, -0.024] | -0.57 | -0.50 |
| StabilityOracle | heldout | complete | 334 | 12 | -0.798 [-0.895, -0.742] | -0.049 [-0.094, -0.028] | -0.57 | -0.50 |
| RaSP (SQLite) | all | partial set | 0 | 0 | too few | too few | - | - |
| RaSP (SQLite) | heldout | partial set | 0 | 0 | too few | too few | - | - |
| DynaMut2 | all | run in progress | 61 | 6 | -0.347 [-0.447, 0.081] | 0.954 [0.666, 1.103] | -0.11 | -1.56 |
| DynaMut2 | heldout | complete | 0 | 0 | too few | too few | -0.11 | -1.56 |
| DDMut | all | run in progress | 0 | 0 | too few | too few | - | - |
| DDMut | heldout | complete | 0 | 0 | too few | too few | - | - |
| ProtVar FoldX | all | partial set | 0 | 0 | too few | too few | - | - |
| ProtVar FoldX | heldout | partial set | 0 | 0 | too few | too few | - | - |

## Missing Variants & Coverage Breakdown

| Engine | Dataset | Split | Dataset Total | Eligible | Scored | Missing | Missing Reasons |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| FoldX | s669 | all | 669 | 669 | 667 | 2 | 2x FoldX BuildModel error (missing adjacent residue / repair) |
| FoldX | s669 | heldout | 644 | 644 | 642 | 2 | 2x FoldX BuildModel error (missing adjacent residue / repair) |
| ThermoMPNN | s669 | all | 669 | 669 | 667 | 2 | 2x HTTP 422 Unprocessable Entity (missing adjacent residue) |
| ThermoMPNN | s669 | heldout | 370 | 370 | 368 | 2 | 2x HTTP 422 Unprocessable Entity (missing adjacent residue) |
| StabilityOracle | s669 | all | 669 | 669 | 638 | 31 | 31x HTTP 400 Bad Request (PDB2PQR failed) |
| StabilityOracle | s669 | heldout | 525 | 525 | 494 | 31 | 31x HTTP 400 Bad Request (PDB2PQR failed) |
| StabilityOracle | ssym_direct | all | 342 | 342 | 337 | 5 | 5x HTTP 400 Bad Request (PDB2PQR failed) |
| StabilityOracle | ssym_direct | heldout | 339 | 339 | 334 | 5 | 5x HTTP 400 Bad Request (PDB2PQR failed) |
| RaSP (SQLite) | s669 | all | 669 | 192 | 21 | 648 | 477x non_human_protein; 166x human_not_in_precomputed_db; 5x human_no_uniprot_map |
| RaSP (SQLite) | s669 | heldout | 147 | 81 | 4 | 143 | 77x human_not_in_precomputed_db; 66x non_human_protein |
| RaSP (SQLite) | ssym_direct | all | 342 | 65 | 2 | 340 | 277x non_human_protein; 63x human_not_in_precomputed_db |
| RaSP (SQLite) | ssym_reverse | all | 342 | 0 | 0 | 342 | 342x not_applicable_wt_lookup (WT human AF2 only; mutant PDBs excluded) |
| DynaMut2 | s669 | all | 669 | 669 | 150 | 519 | 519x not_run_yet (run in progress) |
| DynaMut2 | s669 | heldout | 603 | 603 | 135 | 468 | 468x not_run_yet (run in progress) |
| DynaMut2 | ssym_direct | all | 342 | 342 | 62 | 280 | 280x not_run_yet (run in progress) |
| DynaMut2 | ssym_reverse | all | 342 | 342 | 61 | 281 | 280x not_run_yet (run in progress); 1x running (in progress) |
| DDMut | s669 | all | 669 | 669 | 14 | 655 | 653x not_run_yet (run in progress); 1x running (in progress); 1x timeout (Still RUNNING after 180s) |
| DDMut | s669 | heldout | 569 | 569 | 4 | 565 | 565x not_run_yet (run in progress) |
| DDMut | ssym_direct | all | 342 | 342 | 0 | 342 | 342x not_run_yet (run in progress) |
| DDMut | ssym_reverse | all | 342 | 342 | 0 | 342 | 342x not_run_yet (run in progress) |
| ProtVar FoldX | s669 | all | 669 | 192 | 186 | 483 | 477x non_human_protein; 5x human_no_uniprot_map; 1x human_not_in_precomputed_db |
| ProtVar FoldX | s669 | heldout | 644 | 167 | 164 | 480 | 477x non_human_protein; 2x human_no_uniprot_map; 1x human_not_in_precomputed_db |
| ProtVar FoldX | ssym_direct | all | 342 | 65 | 65 | 277 | 277x non_human_protein |
| ProtVar FoldX | ssym_direct | heldout | 326 | 65 | 65 | 261 | 261x non_human_protein |
| ProtVar FoldX | ssym_reverse | all | 342 | 0 | 0 | 342 | 342x not_applicable_wt_lookup (WT human AF2 only; mutant PDBs excluded) |
| ProtVar FoldX | ssym_reverse | heldout | 326 | 0 | 0 | 326 | 326x not_applicable_wt_lookup (WT human AF2 only; mutant PDBs excluded) |

## A5 Signed-Example Check (Five Large Buried W/F/Y/L/I/M/V -> A/G per Engine & Dataset)

Buried residues selected by CA neighbors within 8 A (`>= 10`) prioritizing `measured > 0`. Canonical convention: `positive = destabilizing`.

| Engine | Dataset | Variant | Mutation | CA <=8A | Measured | Raw Engine | Converted | Sign Agrees |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| FoldX | s669 | 3DV0I_V158A | V158A | 16 | +3.20 | +1.747 | +1.747 | Yes |
| FoldX | s669 | 1N88A_V81A | V81A | 15 | +2.82 | +2.941 | +2.941 | Yes |
| FoldX | s669 | 1L6HA_F39A | F39A | 15 | +1.70 | +0.923 | +0.923 | Yes |
| FoldX | s669 | 2JIEA_L174A | L174A | 15 | +0.79 | +2.420 | +2.420 | Yes |
| FoldX | s669 | 1XZOA_W36A | W36A | 14 | +8.93 | +6.306 | +6.306 | Yes |
| FoldX | ssym_direct | 1LZ1A_I56A | I56A | 16 | +3.70 | +3.628 | +3.628 | Yes |
| FoldX | ssym_direct | 5PTIA_Y23A | Y23A | 15 | +5.90 | +2.608 | +2.608 | Yes |
| FoldX | ssym_direct | 1L63A_I27A | I27A | 15 | +3.10 | +3.156 | +3.156 | Yes |
| FoldX | ssym_direct | 5PTIA_Y35G | Y35G | 14 | +5.00 | +5.008 | +5.008 | Yes |
| FoldX | ssym_direct | 1BNIA_I88A | I88A | 14 | +4.00 | +3.711 | +3.711 | Yes |
| FoldX | ssym_reverse | 3AA4A_V52A | V52A | 13 | +1.70 | +2.523 | +2.523 | Yes |
| FoldX | ssym_reverse | 3AA3A_L52A | L52A | 12 | +1.30 | +3.807 | +3.807 | Yes |
| FoldX | ssym_reverse | 3AA2A_I52A | I52A | 11 | +1.90 | +3.817 | +3.817 | Yes |
| FoldX | ssym_reverse | 1QTCA_F129A | F129A | 13 | -1.20 | +2.854 | +2.854 | No |
| FoldX | ssym_reverse | 1QTBA_V42A | V42A | 13 | -2.70 | +2.364 | +2.364 | No |
| ThermoMPNN | s669 | 3DV0I_V158A | V158A | 16 | +3.20 | +1.735 | +1.735 | Yes |
| ThermoMPNN | s669 | 1N88A_V81A | V81A | 15 | +2.82 | +1.050 | +1.050 | Yes |
| ThermoMPNN | s669 | 1L6HA_F39A | F39A | 15 | +1.70 | +0.715 | +0.715 | Yes |
| ThermoMPNN | s669 | 2JIEA_L174A | L174A | 15 | +0.79 | +1.107 | +1.107 | Yes |
| ThermoMPNN | s669 | 1XZOA_W36A | W36A | 14 | +8.93 | +1.973 | +1.973 | Yes |
| ThermoMPNN | ssym_direct | 1LZ1A_I56A | I56A | 16 | +3.70 | +1.893 | +1.893 | Yes |
| ThermoMPNN | ssym_direct | 5PTIA_Y23A | Y23A | 15 | +5.90 | +4.003 | +4.003 | Yes |
| ThermoMPNN | ssym_direct | 1L63A_I27A | I27A | 15 | +3.10 | +1.530 | +1.530 | Yes |
| ThermoMPNN | ssym_direct | 5PTIA_Y35G | Y35G | 14 | +5.00 | +3.542 | +3.542 | Yes |
| ThermoMPNN | ssym_direct | 1BNIA_I88A | I88A | 14 | +4.00 | +2.965 | +2.965 | Yes |
| ThermoMPNN | ssym_reverse | 3AA4A_V52A | V52A | 13 | +1.70 | +1.786 | +1.786 | Yes |
| ThermoMPNN | ssym_reverse | 3AA3A_L52A | L52A | 12 | +1.30 | +2.254 | +2.254 | Yes |
| ThermoMPNN | ssym_reverse | 3AA2A_I52A | I52A | 11 | +1.90 | +1.925 | +1.925 | Yes |
| ThermoMPNN | ssym_reverse | 1QTCA_F129A | F129A | 13 | -1.20 | +1.005 | +1.005 | No |
| ThermoMPNN | ssym_reverse | 1QTBA_V42A | V42A | 13 | -2.70 | +0.826 | +0.826 | No |
| StabilityOracle | s669 | 1N88A_V81A | V81A | 15 | +2.82 | +0.902 | +0.902 | Yes |
| StabilityOracle | s669 | 1L6HA_F39A | F39A | 15 | +1.70 | +0.245 | +0.245 | Yes |
| StabilityOracle | s669 | 2JIEA_L174A | L174A | 15 | +0.79 | +0.050 | +0.050 | Yes |
| StabilityOracle | s669 | 1XZOA_W36A | W36A | 14 | +8.93 | +0.481 | +0.481 | Yes |
| StabilityOracle | s669 | 2PTLA_I20A | I20A | 14 | +4.90 | -0.032 | -0.032 | No |
| StabilityOracle | ssym_direct | 1LZ1A_I56A | I56A | 16 | +3.70 | +0.710 | +0.710 | Yes |
| StabilityOracle | ssym_direct | 1L63A_I27A | I27A | 15 | +3.10 | +0.991 | +0.991 | Yes |
| StabilityOracle | ssym_direct | 1BNIA_I88A | I88A | 14 | +4.00 | +1.486 | +1.486 | Yes |
| StabilityOracle | ssym_direct | 1L63A_I29A | I29A | 14 | +2.60 | +0.418 | +0.418 | Yes |
| StabilityOracle | ssym_direct | 1L63A_I100A | I100A | 13 | +3.40 | +0.711 | +0.711 | Yes |
| StabilityOracle | ssym_reverse | 3AA4A_V52A | V52A | 13 | +1.70 | +0.703 | +0.703 | Yes |
| StabilityOracle | ssym_reverse | 3AA3A_L52A | L52A | 12 | +1.30 | +0.863 | +0.863 | Yes |
| StabilityOracle | ssym_reverse | 3AA2A_I52A | I52A | 11 | +1.90 | +0.905 | +0.905 | Yes |
| StabilityOracle | ssym_reverse | 1QTCA_F129A | F129A | 13 | -1.20 | +2.008 | +2.008 | No |
| StabilityOracle | ssym_reverse | 1QTBA_V42A | V42A | 13 | -2.70 | +0.397 | +0.397 | No |
| RaSP (SQLite) | s669 | - | - | - | - | - | - | 0 scored WFYLIMV->AG |
| RaSP (SQLite) | ssym_direct | - | - | - | - | - | - | 0 scored WFYLIMV->AG |
| RaSP (SQLite) | ssym_reverse | - | - | - | - | - | - | not applicable (WT human lookup) |
| DynaMut2 | s669 | 2JIEA_L174A | L174A | 15 | +0.79 | -2.235 | +2.235 | Yes |
| DynaMut2 | s669 | 1XZOA_W36A | W36A | 14 | +8.93 | -3.832 | +3.832 | Yes |
| DynaMut2 | s669 | 1N88A_Y26A | Y26A | 14 | +4.61 | -1.485 | +1.485 | Yes |
| DynaMut2 | s669 | 1DIVA_V143A | V143A | 13 | +3.25 | -2.439 | +2.439 | Yes |
| DynaMut2 | s669 | 1DIVA_L102A | L102A | 13 | +2.37 | -3.066 | +3.066 | Yes |
| DynaMut2 | ssym_direct | 1L63A_I27A | I27A | 15 | +3.10 | -3.664 | +3.664 | Yes |
| DynaMut2 | ssym_direct | 1L63A_I100A | I100A | 13 | +3.40 | -3.618 | +3.618 | Yes |
| DynaMut2 | ssym_direct | 1L63A_V103A | V103A | 13 | +2.20 | -2.354 | +2.354 | Yes |
| DynaMut2 | ssym_direct | 1L63A_I78A | I78A | 13 | +1.20 | -3.664 | +3.664 | Yes |
| DynaMut2 | ssym_direct | 1BNIA_I96A | I96A | 12 | +3.20 | -3.513 | +3.513 | Yes |
| DynaMut2 | ssym_reverse | 1QTBA_V42A | V42A | 13 | -2.70 | -1.816 | +1.816 | No |
| DynaMut2 | ssym_reverse | 1QS9A_V98A | V98A | 12 | -3.20 | -2.523 | +2.523 | No |
| DDMut | s669 | 1DIVA_L102A | L102A | 13 | +2.37 | -2.680 | +2.680 | Yes |
| DDMut | s669 | 1DIVA_L72A | L72A | 10 | +3.77 | -2.190 | +2.190 | Yes |
| DDMut | ssym_direct | - | - | - | - | - | - | 0 scored WFYLIMV->AG |
| DDMut | ssym_reverse | - | - | - | - | - | - | 0 scored WFYLIMV->AG |
| ProtVar FoldX | s669 | 1GUAB_I58A | I58A | 14 | +3.27 | +4.458 | +4.458 | Yes |
| ProtVar FoldX | s669 | 1GUAB_L78A | L78A | 12 | +3.80 | +4.552 | +4.552 | Yes |
| ProtVar FoldX | s669 | 1GUAB_L126A | L126A | 12 | +3.40 | +4.971 | +4.971 | Yes |
| ProtVar FoldX | s669 | 1GUAB_V128A | V128A | 12 | +3.37 | +4.018 | +4.018 | Yes |
| ProtVar FoldX | s669 | 1GUAB_V60A | V60A | 12 | +2.25 | +4.185 | +4.185 | Yes |
| ProtVar FoldX | ssym_direct | 1LZ1A_I56A | I56A | 16 | +3.70 | +2.950 | +2.950 | Yes |
| ProtVar FoldX | ssym_direct | 1LZ1A_V125A | V125A | 13 | +1.30 | +1.791 | +1.791 | Yes |
| ProtVar FoldX | ssym_direct | 1LZ1A_V100A | V100A | 12 | +0.30 | +1.050 | +1.050 | Yes |
| ProtVar FoldX | ssym_direct | 1LZ1A_I23A | I23A | 11 | +2.50 | +2.893 | +2.893 | Yes |
| ProtVar FoldX | ssym_direct | 1LZ1A_V99A | V99A | 11 | +1.00 | +2.009 | +2.009 | Yes |
| ProtVar FoldX | ssym_reverse | - | - | - | - | - | - | not applicable (WT human lookup) |

## Published Reference Citations & Factual Caveats

| Engine | Dataset | Published Source | URL | Caveat |
| --- | --- | --- | --- | --- |
| FoldX | s669 | Pancotti et al. (2022) Brief. Bioinform. 23(2):bbab555, Table 1 | https://academic.oup.com/bib/article/23/2/bbab555/6511535 | S669 direct (n=669); FoldX v3/v4 protocol. |
| FoldX | ssym_direct | Pucci et al. (2018) Bioinformatics 34(21):3659-3665, Table 1 | https://academic.oup.com/bioinformatics/article/34/21/3659/5001386 | Ssym direct (n=342); FoldX v3.0. |
| FoldX | ssym_reverse | Pucci et al. (2018) Bioinformatics 34(21):3659-3665, Table 1 | https://academic.oup.com/bioinformatics/article/34/21/3659/5001386 | Ssym reverse (n=342); Pucci delta = dir + inv (-0.47 => mean(dir+inv)/2 = -0.235). |
| ThermoMPNN | s669 | Dieckhaus et al. (2024) PNAS 121(6):e2314853121, Table 3 | https://www.pnas.org/doi/10.1073/pnas.2314853121 | Evaluated with <=25% homologues removed from Megascale training. |
| ThermoMPNN | ssym_direct | Dieckhaus et al. (2024) PNAS 121(6):e2314853121, Table 3 | https://www.pnas.org/doi/10.1073/pnas.2314853121 | Ssym direct (n=342), homology-filtered Megascale model. |
| ThermoMPNN | ssym_reverse | Dieckhaus et al. (2024) PNAS 121(6):e2314853121, Table 3 | https://www.pnas.org/doi/10.1073/pnas.2314853121 | ThermoMPNN-ens1 benchmark.ipynb also reports r=0.583, rho=0.607, RMSE=1.540. |
| StabilityOracle | s669 | Diaz et al. (2024) Nat. Commun.; Dieckhaus et al. (2024) PNAS Table 3 | https://www.pnas.org/doi/10.1073/pnas.2314853121 | Authors' pipeline uses proprietary charge/SASA prep; local sidecar re-implements from paper. |
| StabilityOracle | ssym_direct | Diaz et al. (2024) via Dieckhaus et al. (2024) PNAS Table 3; JanusDDG (2025) Supp. Table 8 | https://www.pnas.org/doi/10.1073/pnas.2314853121 | Independent JanusDDG eval of released model reports r=0.65, rho=0.68, RMSE=1.38. |
| StabilityOracle | ssym_reverse | JanusDDG (2025) Supp. Table 8 (mutant PDBs); Diaz et al. (2024) reports r=0.72, RMSE=1.19 (WT-swapped) | https://www.pnas.org/doi/10.1073/pnas.2314853121 | Diaz et al. swapped AA embeddings on WT PDB; local run uses mutant crystal structures. |
| RaSP (SQLite) | s669 | Blaabjerg et al. (2023) eLife 12:e82593, Table 2 | https://elifesciences.org/articles/82593 | Published RaSP ran on experimental PDBs; app queries precomputed human-only AlphaFold SQLite. |
| RaSP (SQLite) | ssym_direct | Blaabjerg et al. (2023) eLife 12:e82593 (Ssym+ direct, MAE=1.01) | https://elifesciences.org/articles/82593 | Evaluated on Ssym+ (n=352) directly on PDBs; app SQLite only covers human UniProt IDs. |
| RaSP (SQLite) | ssym_reverse | Blaabjerg et al. (2023) eLife 12:e82593 (Ssym+ reverse, MAE=1.82) | https://elifesciences.org/articles/82593 | App SQLite is WT human proteome only (0 coverage on mutant PDB reverse variants). |
| DynaMut2 | s669 | Pancotti et al. (2022) Brief. Bioinform. 23(2):bbab555, Table 1 | https://academic.oup.com/bib/article/23/2/bbab555/6511535 | S669 direct (n=669). |
| DynaMut2 | ssym_direct | Hernandez et al. (2023) Bioinformatics 39(1):btad011, Table 1 & Supp. S4 | https://academic.oup.com/bioinformatics/article/39/1/btad011/6986894 | Reports combined Ssym (n=684) r=0.38, RMSE=1.88, |r_dir_inv|=0.11, bias=-1.56; direct r>0.60, RMSE<1.29. |
| DynaMut2 | ssym_reverse | Hernandez et al. (2023) Bioinformatics 39(1):btad011, Table 1 | https://academic.oup.com/bioinformatics/article/39/1/btad011/6986894 | Combined Ssym |r_dir_inv|=0.11 and bias <d>=-1.56 kcal/mol (dir+inv). |
| DDMut | s669 | Zhou et al. (2023) Nucleic Acids Res. 51(W1):W122-W128, Table 1 (S1304) | https://academic.oup.com/nar/article/51/W1/W122/7191158 | S1304 = deduplicated S669 forward+reverse (not direct-only S669). |
| DDMut | ssym_direct | Zhou et al. (2023) Nucleic Acids Res. 51(W1):W122-W128 | https://academic.oup.com/nar/article/51/W1/W122/7191158 | Ssym not reported in Zhou et al. (2023) Table 1. |
| DDMut | ssym_reverse | Zhou et al. (2023) Nucleic Acids Res. 51(W1):W122-W128 | https://academic.oup.com/nar/article/51/W1/W122/7191158 | Ssym not reported in Zhou et al. (2023) Table 1. |
| ProtVar FoldX | s669 | Stephenson et al. (2024) Nucleic Acids Res. 52(W1):W278-W285 | https://academic.oup.com/nar/article/52/W1/W278/7670900 | Precomputed FoldX on human AlphaFoldDB only; no published S669/Ssym table. |
| ProtVar FoldX | ssym_direct | Stephenson et al. (2024) Nucleic Acids Res. 52(W1):W278-W285 | https://academic.oup.com/nar/article/52/W1/W278/7670900 | Human-only AF2 lookup; zero/low coverage on non-human Ssym structures. |
| ProtVar FoldX | ssym_reverse | Stephenson et al. (2024) Nucleic Acids Res. 52(W1):W278-W285 | https://academic.oup.com/nar/article/52/W1/W278/7670900 | WT human proteome lookup only (0 coverage on mutant reverse structures). |

## Local Execution & Failure Caveats

| Engine | Scope / Condition | Exact Status & Reason |
| --- | --- | --- |
| FoldX | `s669` (`3DV0I_V129A`, `3DV0I_V129G`) | `BuildModel` exited non-zero (`wt_Repair` lacks adjacent residue 128). |
| FoldX | `ssym_reverse` | 342/342 unique mutant crystal PDBs completed locally (`RepairPDB` + 5x `BuildModel` per PDB). |
| ThermoMPNN | `s669` (`3DV0I_V129A`, `3DV0I_V129G`) | Sidecar HTTP 422 (missing adjacent residue 128 in `3DV0_I.pdb`). |
| StabilityOracle | `s669` (31 `3DV0I`), `ssym_direct` (5 `5PTIA`) | Sidecar HTTP 400: `PDB2PQR could not add hydrogens to this chain`. |
| RaSP / ProtVar | `s669`, `ssym_direct`, `ssym_reverse` | Human WT proteome lookups only (`partial set`); `ssym_reverse` marked `not_applicable_wt_lookup` (`0` human WT eligible). |
| DynaMut2 | BioSig queue (`run in progress`, `seed 42`) | `s669`: 150/669, `ssym_direct`: 62/342, `ssym_reverse`: 61/342. |
| DDMut | BioSig queue (`run in progress`, `seed 42`) | `s669`: 14/669, `ssym_direct`: 0/342. |
