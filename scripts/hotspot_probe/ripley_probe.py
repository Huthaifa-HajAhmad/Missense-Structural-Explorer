"""Feasibility probe of the Sivley et al. 2018 (PathProx) spatial tests on an AlphaFold model.

Univariate Ripley's K for ClinVar P/LP residues (permuting positions over all modelled residues) and
the bivariate D = K_P - K_N (permuting P/N labels over the pooled variant residues). Distance range:
min observed to half the max observed distance; area between observed and median permuted curves by
Simpson's rule; two-tailed permutation p. Deviations from the paper, all disclosed: AlphaFold model
instead of solved PDB structures, unique residues instead of variants, gnomAD v4 missense residues as
the neutral set instead of ExAC, 2,000 permutations instead of 100,000, a 40-step distance grid.
The optional third argument keeps only residues at or above that pLDDT (AlphaFold DB's published
"confident" band is 70), so a disordered tail cannot manufacture clustering.
Usage: python -I ripley_probe.py VHL AF-P40337-F1-model_v6.pdb [70]
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from per_probe import gql, residue, plp

PERMS, STEPS = 2000, 40
MIN_PLDDT = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0


def ca_coords(path):
    out = {}
    for line in open(path):
        if line.startswith("ATOM") and line[12:16] == " CA " and float(line[60:66]) >= MIN_PLDDT:
            out[int(line[22:26])] = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
    return out


def dist(a, b):
    return math.dist(a, b)


def k_curve(points, grid, D):
    n = len(points)
    ds = sorted(D[i][j] for x, i in enumerate(points) for j in points[x + 1:])
    out, k = [], 0
    for t in grid:
        while k < len(ds) and ds[k] <= t:
            k += 1
        out.append(k / max(1, n * (n - 1) / 2))
    return out


def simpson(ys, h):
    if len(ys) % 2 == 0:
        ys = ys[:-1]
    return h / 3 * (ys[0] + ys[-1] + 4 * sum(ys[1:-1:2]) + 2 * sum(ys[2:-1:2]))


def two_tailed(obs, null):
    lo = sum(v <= obs for v in null) / len(null)
    hi = sum(v >= obs for v in null) / len(null)
    return min(1.0, 2 * min(lo, hi))


def run(gene, pdb):
    random.seed(7)
    g = gql(gene)
    tx = (g["canonical_transcript_id"] or "").split(".")[0]
    on = lambda r: not tx or not r.get("transcript_id") or r["transcript_id"].split(".")[0] == tx
    ca = ca_coords(pdb)
    pat = sorted({residue(r["hgvsp"]) for r in g["clinvar_variants"] if on(r) and plp(r["clinical_significance"])} & ca.keys())
    neu = sorted({residue(r["hgvsp"]) for r in g["variants"] if on(r) and r.get("consequence") == "missense_variant"} & ca.keys())
    allres = sorted(ca)
    idx = {r: i for i, r in enumerate(allres)}
    D = [[dist(ca[a], ca[b]) for b in allres] for a in allres]
    P = [idx[r] for r in pat]
    N = [idx[r] for r in neu]
    pd = [D[i][j] for x, i in enumerate(P) for j in P[x + 1:]]
    lo, hi = min(pd), max(pd)
    top = hi / 2 if lo < hi / 2 else hi
    grid = [lo + (top - lo) * s / STEPS for s in range(STEPS + 1)]
    h = (top - lo) / STEPS

    # Univariate: are P/LP residues clustered relative to random residues of the model?
    obs = k_curve(P, grid, D)
    perms = [k_curve(random.sample(range(len(allres)), len(P)), grid, D) for _ in range(PERMS)]
    med = [sorted(c[s] for c in perms)[PERMS // 2] for s in range(len(grid))]
    area = lambda c: simpson([a - m for a, m in zip(c, med)], h)
    uni_obs = area(obs)
    uni_p = two_tailed(uni_obs, [area(c) for c in perms])

    # Bivariate: are P/LP residues more clustered than gnomAD missense residues? Permute labels over the pool.
    pool = P + N
    dcurve = lambda a, b: [x - y for x, y in zip(k_curve(a, grid, D), k_curve(b, grid, D))]
    dobs = dcurve(P, N)
    dperm = []
    for _ in range(PERMS):
        random.shuffle(pool)
        dperm.append(dcurve(pool[:len(P)], pool[len(P):]))
    dmed = [sorted(c[s] for c in dperm)[PERMS // 2] for s in range(len(grid))]
    darea = lambda c: simpson([a - m for a, m in zip(c, dmed)], h)
    bi_obs = darea(dobs)
    bi_p = two_tailed(bi_obs, [darea(c) for c in dperm])
    return {"min_plddt": MIN_PLDDT, "gene": gene, "model_residues": len(allres), "plp_residues": len(P), "gnomad_residues": len(N),
            "range_A": [round(lo, 1), round(top, 1)], "permutations": PERMS,
            "univariate_P_clustering": {"area": round(uni_obs, 3), "p_two_tailed": uni_p},
            "bivariate_P_minus_N": {"area": round(bi_obs, 3), "p_two_tailed": bi_p}}


if __name__ == "__main__":
    print(json.dumps(run(sys.argv[1], sys.argv[2]), indent=1))
