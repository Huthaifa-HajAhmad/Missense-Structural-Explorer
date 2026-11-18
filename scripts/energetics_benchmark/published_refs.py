"""Verified published benchmark figures and citations for side-by-side comparison."""
from __future__ import annotations

PUBLISHED_METRICS: dict[tuple[str, str], dict] = {
    ("foldx", "s669"): {
        "r": 0.22, "rho": None, "rmse": 2.30,
        "citation": "Pancotti et al. (2022) Brief. Bioinform. 23(2):bbab555, Table 1",
        "url": "https://academic.oup.com/bib/article/23/2/bbab555/6511535",
        "note": "S669 direct (n=669); FoldX v3/v4 protocol.",
    },
    ("foldx", "ssym_direct"): {
        "r": 0.63, "rho": None, "rmse": 1.56,
        "citation": "Pucci et al. (2018) Bioinformatics 34(21):3659-3665, Table 1",
        "url": "https://academic.oup.com/bioinformatics/article/34/21/3659/5001386",
        "note": "Ssym direct (n=342); FoldX v3.0.",
    },
    ("foldx", "ssym_reverse"): {
        "r": 0.39, "rho": None, "rmse": 2.13,
        "r_dir_inv": -0.38, "mean_bias_sum": -0.47,
        "citation": "Pucci et al. (2018) Bioinformatics 34(21):3659-3665, Table 1",
        "url": "https://academic.oup.com/bioinformatics/article/34/21/3659/5001386",
        "note": "Ssym reverse (n=342); Pucci delta = dir + inv (-0.47 => mean(dir+inv)/2 = -0.235).",
    },
    ("thermompnn", "s669"): {
        "r": 0.43, "rho": None, "rmse": 1.52,
        "citation": "Dieckhaus et al. (2024) PNAS 121(6):e2314853121, Table 3",
        "url": "https://www.pnas.org/doi/10.1073/pnas.2314853121",
        "note": "Evaluated with <=25% homologues removed from Megascale training.",
    },
    ("thermompnn", "ssym_direct"): {
        "r": 0.72, "rho": None, "rmse": 1.12,
        "citation": "Dieckhaus et al. (2024) PNAS 121(6):e2314853121, Table 3",
        "url": "https://www.pnas.org/doi/10.1073/pnas.2314853121",
        "note": "Ssym direct (n=342), homology-filtered Megascale model.",
    },
    ("thermompnn", "ssym_reverse"): {
        "r": 0.60, "rho": None, "rmse": 1.53,
        "citation": "Dieckhaus et al. (2024) PNAS 121(6):e2314853121, Table 3",
        "url": "https://www.pnas.org/doi/10.1073/pnas.2314853121",
        "note": "ThermoMPNN-ens1 benchmark.ipynb also reports r=0.583, rho=0.607, RMSE=1.540.",
    },
    ("stabilityoracle", "s669"): {
        "r": 0.52, "rho": 0.53, "rmse": 1.43,
        "citation": "Diaz et al. (2024) Nat. Commun.; Dieckhaus et al. (2024) PNAS Table 3",
        "url": "https://www.pnas.org/doi/10.1073/pnas.2314853121",
        "note": "Authors' pipeline uses proprietary charge/SASA prep; local sidecar re-implements from paper.",
    },
    ("stabilityoracle", "ssym_direct"): {
        "r": 0.72, "rho": None, "rmse": 1.22,
        "citation": "Diaz et al. (2024) via Dieckhaus et al. (2024) PNAS Table 3; JanusDDG (2025) Supp. Table 8",
        "url": "https://www.pnas.org/doi/10.1073/pnas.2314853121",
        "note": "Independent JanusDDG eval of released model reports r=0.65, rho=0.68, RMSE=1.38.",
    },
    ("stabilityoracle", "ssym_reverse"): {
        "r": 0.42, "rho": 0.42, "rmse": 1.77,
        "r_dir_inv": -0.57, "mean_bias_sum": -0.50,
        "citation": "JanusDDG (2025) Supp. Table 8 (mutant PDBs); Diaz et al. (2024) reports r=0.72, RMSE=1.19 (WT-swapped)",
        "url": "https://www.pnas.org/doi/10.1073/pnas.2314853121",
        "note": "Diaz et al. swapped AA embeddings on WT PDB; local run uses mutant crystal structures.",
    },
    ("rasp", "s669"): {
        "r": 0.39, "rho": None, "rmse": 1.63,
        "citation": "Blaabjerg et al. (2023) eLife 12:e82593, Table 2",
        "url": "https://elifesciences.org/articles/82593",
        "note": "Published RaSP ran on experimental PDBs; app queries precomputed human-only AlphaFold SQLite.",
    },
    ("rasp", "ssym_direct"): {
        "r": 0.58, "rho": None, "rmse": None,
        "citation": "Blaabjerg et al. (2023) eLife 12:e82593 (Ssym+ direct, MAE=1.01)",
        "url": "https://elifesciences.org/articles/82593",
        "note": "Evaluated on Ssym+ (n=352) directly on PDBs; app SQLite only covers human UniProt IDs.",
    },
    ("rasp", "ssym_reverse"): {
        "r": 0.18, "rho": None, "rmse": None,
        "citation": "Blaabjerg et al. (2023) eLife 12:e82593 (Ssym+ reverse, MAE=1.82)",
        "url": "https://elifesciences.org/articles/82593",
        "note": "App SQLite is WT human proteome only (0 coverage on mutant PDB reverse variants).",
    },
    ("dynamut2", "s669"): {
        "r": 0.34, "rho": None, "rmse": 1.58,
        "citation": "Pancotti et al. (2022) Brief. Bioinform. 23(2):bbab555, Table 1",
        "url": "https://academic.oup.com/bib/article/23/2/bbab555/6511535",
        "note": "S669 direct (n=669).",
    },
    ("dynamut2", "ssym_direct"): {
        "r": None, "rho": None, "rmse": None,
        "citation": "Hernandez et al. (2023) Bioinformatics 39(1):btad011, Table 1 & Supp. S4",
        "url": "https://academic.oup.com/bioinformatics/article/39/1/btad011/6986894",
        "note": "Reports combined Ssym (n=684) r=0.38, RMSE=1.88, |r_dir_inv|=0.11, bias=-1.56; direct r>0.60, RMSE<1.29.",
    },
    ("dynamut2", "ssym_reverse"): {
        "r": None, "rho": None, "rmse": None,
        "r_dir_inv": -0.11, "mean_bias_sum": -1.56,
        "citation": "Hernandez et al. (2023) Bioinformatics 39(1):btad011, Table 1",
        "url": "https://academic.oup.com/bioinformatics/article/39/1/btad011/6986894",
        "note": "Combined Ssym |r_dir_inv|=0.11 and bias <d>=-1.56 kcal/mol (dir+inv).",
    },
    ("ddmut", "s669"): {
        "r": 0.62, "rho": 0.61, "rmse": 1.50,
        "citation": "Zhou et al. (2023) Nucleic Acids Res. 51(W1):W122-W128, Table 1 (S1304)",
        "url": "https://academic.oup.com/nar/article/51/W1/W122/7191158",
        "note": "S1304 = deduplicated S669 forward+reverse (not direct-only S669).",
    },
    ("ddmut", "ssym_direct"): {
        "r": None, "rho": None, "rmse": None,
        "citation": "Zhou et al. (2023) Nucleic Acids Res. 51(W1):W122-W128",
        "url": "https://academic.oup.com/nar/article/51/W1/W122/7191158",
        "note": "Ssym not reported in Zhou et al. (2023) Table 1.",
    },
    ("ddmut", "ssym_reverse"): {
        "r": None, "rho": None, "rmse": None,
        "citation": "Zhou et al. (2023) Nucleic Acids Res. 51(W1):W122-W128",
        "url": "https://academic.oup.com/nar/article/51/W1/W122/7191158",
        "note": "Ssym not reported in Zhou et al. (2023) Table 1.",
    },
    ("protvar", "s669"): {
        "r": None, "rho": None, "rmse": None,
        "citation": "Stephenson et al. (2024) Nucleic Acids Res. 52(W1):W278-W285",
        "url": "https://academic.oup.com/nar/article/52/W1/W278/7670900",
        "note": "Precomputed FoldX on human AlphaFoldDB only; no published S669/Ssym table.",
    },
    ("protvar", "ssym_direct"): {
        "r": None, "rho": None, "rmse": None,
        "citation": "Stephenson et al. (2024) Nucleic Acids Res. 52(W1):W278-W285",
        "url": "https://academic.oup.com/nar/article/52/W1/W278/7670900",
        "note": "Human-only AF2 lookup; zero/low coverage on non-human Ssym structures.",
    },
    ("protvar", "ssym_reverse"): {
        "r": None, "rho": None, "rmse": None,
        "citation": "Stephenson et al. (2024) Nucleic Acids Res. 52(W1):W278-W285",
        "url": "https://academic.oup.com/nar/article/52/W1/W278/7670900",
        "note": "WT human proteome lookup only (0 coverage on mutant reverse structures).",
    },
}
