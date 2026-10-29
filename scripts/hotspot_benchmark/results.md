# 3D proximity benchmark — results

thresholds.json sha256 `2c3bb84254e3d013e0886ab5de5bac4b408cac275ddd24660110820394c414ad`. Decision: **adopt** (P3 pass: BRCA1, SCN1A, KCNQ2; P5 pass: SOD1, BRCA1, VHL). Informative genes: SOD1, BRCA1, VHL, SCN1A, KCNQ2.

| Gene | Confident / length | P / N residues | Univariate p | Bivariate p | t (Å) | AUROC P/LP vs gnomAD AC≥2 [95% CI] (scored) | AUROC P/LP vs B/LB | RMC AUROC | ΔAUROC vs RMC [95% CI] | Run time |
|---|---|---|---|---|---|---|---|---|---|---|
| SOD1 | 154 / 154 | 64 / 74 | 0.004 (area 0.65) | 0.003 (area 1.56) | 10.1 | 0.64 [0.55, 0.73] (114/114 vs 49/49) | — (114 vs 0) | 0.50 | 0.14 [0.05, 0.23] | 0.4 s |
| BRCA1 | 324 / 1863 | 91 / 756 | 1.0e-3 (area 4.13) | 1.0e-3 (area 5.50) | 12.4 | 0.72 [0.66, 0.79] (208/217 vs 70/370) | 0.69 (208 vs 92) | 0.50 | 0.22 [0.16, 0.29] | 0.7 s |
| LDLR | 625 / 860 | 283 / 545 | 0.017 (area 2.11) | 0.091 (area 2.48) | 9.3 | 0.60 [0.56, 0.64] (636/697 vs 275/425) | 0.59 (636 vs 21) | 0.50 | 0.10 [0.06, 0.14] | 4.6 s |
| VHL | 155 / 213 | 67 / 128 | 1.0e-3 (area 1.93) | 0.002 (area 2.68) | 5.9 | 0.67 [0.59, 0.75] (162/164 vs 54/105) | 0.54 (162 vs 25) | 0.50 | 0.17 [0.09, 0.25] | 0.4 s |
| SCN1A | 1236 / 2009 | 579 / 933 | 1.0e-3 (area 4.92) | 1.0e-3 (area 8.75) | 16.1 | 0.72 [0.69, 0.76] (914/1015 vs 242/569) | 0.76 (914 vs 20) | 0.69 | 0.03 [-0.01, 0.07] | 12.5 s |
| KCNQ2 | 350 / 872 | 194 / 474 | 1.0e-3 (area 4.12) | 1.0e-3 (area 7.19) | 11.1 | 0.90 [0.85, 0.94] (317/362 vs 64/379) | — (317 vs 0) | 0.90 | -0.00 [-0.03, 0.02] | 1.1 s |
