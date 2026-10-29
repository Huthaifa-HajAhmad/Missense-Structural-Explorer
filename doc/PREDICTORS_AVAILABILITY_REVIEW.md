# Predictor availability and local agreement

GATA4 p.Ser159Cys: UniProt P43694 lists the alternative NP_001295022.1 before the displayed sequence NP_002043.2. The popEVE resolver previously selected the first NP_ entry. It now uses the displayed isoform explicitly and avoids silently selecting an alternative when that mapping is known.

Live provider check on 29 October 2026: https://data.evemodel.org/popeve/v1.1/mutations/NP_002043.2.csv contains S159C = -3.376. This is an indeterminate reading under the existing popEVE rule. No engine voting policy or cut-point changed.

Comparison and Native score scales now expose local descriptive agreement with coverage, named contributors and missing sources. Native/alternate LLR preference is described separately from published clinical bands. AVI, Eigen, DANN and ConSurf receive no invented directional cut-point. No average or independent-evidence claim is made. The inspector uses the same shared summary.

Other missing provider fields (including ESM-1b and Eigen) remain missing; no scores are imputed. Existing persisted analyses need a fresh analysis to obtain the corrected popEVE lookup.

Validation: lint/type checks passed; 83 focused tests passed. Full Vitest: 5529 passed, one unrelated FoldX background repair timing failure; its 10 tests passed on isolated rerun. Browser fixture check passed at 1440 and 800 pixels in light/dark, including missing scores. Full app startup timed out before rendering; fixture verification used isolated Vite.

Review follow-up: the popEVE UniProt mapping degrades deliberately — an unexpected payload shape is asked again rather than thrown, without negative caching (85 focused tests now). The agreement wording is shared constants so the tab card and inspector rail cannot drift, and the comparison card says how the engine read the predictors, since one of its rows is explicitly not the engine's.
