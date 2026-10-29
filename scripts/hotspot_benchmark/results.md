# 3D proximity benchmark — results

thresholds.json sha256 `2c3bb84254e3d013e0886ab5de5bac4b408cac275ddd24660110820394c414ad`. Decision: **adopt** (P3 pass: BRCA1, KCNQ2; P5 pass: SOD1, BRCA1, VHL). Informative genes: SOD1, BRCA1, VHL, SCN1A, KCNQ2.

| Gene | Confident / length | P / N residues | Univariate p | Bivariate p | t (Å) | AUROC P/LP vs gnomAD AC≥2 [95% CI] (scored) | AUROC P/LP vs B/LB | RMC AUROC | ΔAUROC vs RMC [95% CI] | Run time |
|---|---|---|---|---|---|---|---|---|---|---|
| SOD1 | 154 / 154 | 64 / 74 | 0.004 (area 0.65) | 0.003 (area 1.56) | 10.1 | 0.66 [0.55, 0.77] (64/64 vs 39/39) | — (64 vs 0) | 0.50 | 0.16 [0.05, 0.27] | 0.1 s |
| BRCA1 | 324 / 1863 | 91 / 756 | 1.0e-3 (area 4.13) | 1.0e-3 (area 5.50) | 12.4 | 0.70 [0.61, 0.79] (85/91 vs 61/336) | 0.69 (85 vs 82) | 0.50 | 0.20 [0.11, 0.29] | 0.2 s |
| LDLR | 625 / 860 | 283 / 545 | 0.017 (area 2.11) | 0.091 (area 2.48) | 9.3 | 0.59 [0.53, 0.64] (263/283 vs 214/336) | 0.57 (263 vs 21) | 0.50 | 0.09 [0.03, 0.14] | 1.8 s |
| VHL | 155 / 213 | 67 / 128 | 1.0e-3 (area 1.93) | 0.002 (area 2.68) | 5.9 | 0.66 [0.56, 0.76] (66/67 vs 44/77) | 0.57 (66 vs 21) | 0.50 | 0.16 [0.06, 0.26] | 0.2 s |
| SCN1A | 1236 / 2009 | 579 / 933 | 1.0e-3 (area 4.92) | 1.0e-3 (area 8.75) | 16.1 | 0.69 [0.66, 0.74] (505/579 vs 213/477) | 0.73 (505 vs 19) | 0.67 | 0.03 [-0.02, 0.08] | 5.0 s |
| KCNQ2 | 350 / 872 | 194 / 474 | 1.0e-3 (area 4.12) | 1.0e-3 (area 7.19) | 11.1 | 0.87 [0.81, 0.91] (169/194 vs 52/283) | — (169 vs 0) | 0.86 | 0.00 [-0.03, 0.04] | 0.4 s |
