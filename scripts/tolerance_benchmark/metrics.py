"""Discrimination metrics and the MetaDome tolerance formula. Python stdlib only, so the benchmark has no
dependency that could change a number between runs."""
import math
import random

# MetaDome codon background (metadome/domain/metrics/codon_statistics.py, codon_background_rates): the number
# of the 9 single-nucleotide changes of a codon that are missense / synonymous. Derived here from the codon
# table instead of copied, and checked against the published table in test_metrics.py.


def codon_background(codon, table):
    mis = syn = 0
    ref = table[codon]
    for i in range(3):
        for b in "ACGT":
            if b == codon[i]:
                continue
            alt = table[codon[:i] + b + codon[i + 1:]]
            if alt == ref:
                syn += 1
            elif alt != "*" and ref != "*":
                mis += 1
    return mis, syn


def mosy(missense, missense_bg, synonymous, synonymous_bg):
    """background_corrected_mosy_score in metadome/domain/metrics/GeneticTolerance.py."""
    return ((missense + 1) / (missense_bg + 1)) / ((synonymous + 1) / (synonymous_bg + 1))


def window(i, length, half):
    """create_sliding_window in metadome/domain/services/helper_functions.py, 0-based residue index i."""
    lo, hi = max(0, i - half), min(length, i + half + 1)
    return lo, hi


def tolerance_landscape(mis, syn, mis_bg, syn_bg, half=10):
    n = len(mis)
    out = []
    for i in range(n):
        lo, hi = window(i, n, half)
        out.append(mosy(sum(mis[lo:hi]), sum(mis_bg[lo:hi]), sum(syn[lo:hi]), sum(syn_bg[lo:hi])))
    return out


def auroc(pos, neg):
    """Probability a random positive outranks a random negative; ties count one half (Mann-Whitney U / n1n0)."""
    if not pos or not neg:
        return None
    allv = sorted([(v, 1) for v in pos] + [(v, 0) for v in neg])
    rank_sum, i, n = 0.0, 0, len(allv)
    while i < n:
        j = i
        while j < n and allv[j][0] == allv[i][0]:
            j += 1
        avg = (i + j + 1) / 2
        rank_sum += avg * sum(1 for k in range(i, j) if allv[k][1] == 1)
        i = j
    n1, n0 = len(pos), len(neg)
    return (rank_sum - n1 * (n1 + 1) / 2) / (n1 * n0)


def auprc(pos, neg):
    """Average precision with tied scores taken as one threshold step (no optimistic tie ordering)."""
    if not pos or not neg:
        return None
    pairs = sorted([(v, 1) for v in pos] + [(v, 0) for v in neg], key=lambda x: -x[0])
    tp = fp = 0
    ap = 0.0
    prev_recall = 0.0
    i, n, P = 0, len(pairs), len(pos)
    while i < n:
        j = i
        while j < n and pairs[j][0] == pairs[i][0]:
            j += 1
        tp += sum(1 for k in range(i, j) if pairs[k][1] == 1)
        fp += sum(1 for k in range(i, j) if pairs[k][1] == 0)
        recall = tp / P
        precision = tp / (tp + fp)
        ap += (recall - prev_recall) * precision
        prev_recall = recall
        i = j
    return ap


def odds_ratio(a, b, c, d):
    """a = positives in bin, b = negatives in bin, c = positives out, d = negatives out. Haldane +0.5 if any
    cell is zero; Woolf 95% CI."""
    if min(a, b, c, d) == 0:
        a, b, c, d = a + 0.5, b + 0.5, c + 0.5, d + 0.5
    orr = (a * d) / (b * c)
    se = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
    return orr, math.exp(math.log(orr) - 1.96 * se), math.exp(math.log(orr) + 1.96 * se)


def lr_positive(a, b, n_pos, n_neg):
    """LR+ of 'in bin' = (a/n_pos)/(b/n_neg) with a log-scale 95% CI; +0.5 to empty cells."""
    if a == 0 or b == 0:
        a, b, n_pos, n_neg = a + 0.5, b + 0.5, n_pos + 0.5, n_neg + 0.5
    lr = (a / n_pos) / (b / n_neg)
    se = math.sqrt(max(1 / a - 1 / n_pos + 1 / b - 1 / n_neg, 0.0))
    return lr, math.exp(math.log(lr) - 1.96 * se), math.exp(math.log(lr) + 1.96 * se)


def decile_edges(values):
    """Nine cut points over the gene's scored residues (sorted ascending; decile 1 holds the lowest tenth)."""
    v = sorted(values)
    n = len(v)
    return [v[min(n - 1, max(0, math.ceil(n * k / 10) - 1))] for k in range(1, 10)]


def decile_of(x, edges):
    for k, e in enumerate(edges):
        if x <= e:
            return k + 1
    return 10


def bootstrap(pos, neg, stat, iterations, seed):
    """Percentile 95% CI, resampling positives and negatives separately."""
    rng = random.Random(seed)
    vals = []
    for _ in range(iterations):
        p = [pos[rng.randrange(len(pos))] for _ in pos]
        q = [neg[rng.randrange(len(neg))] for _ in neg]
        s = stat(p, q)
        if s is not None:
            vals.append(s)
    vals.sort()
    if not vals:
        return None, None
    return vals[int(0.025 * len(vals))], vals[min(len(vals) - 1, int(0.975 * len(vals)))]


def paired_bootstrap_diff(pos, neg, stat, iterations, seed):
    """pos/neg are lists of (score_a, score_b) for the same variants; CI of stat(a) - stat(b)."""
    rng = random.Random(seed)
    vals = []
    for _ in range(iterations):
        p = [pos[rng.randrange(len(pos))] for _ in pos]
        q = [neg[rng.randrange(len(neg))] for _ in neg]
        a = stat([x[0] for x in p], [x[0] for x in q])
        b = stat([x[1] for x in p], [x[1] for x in q])
        if a is not None and b is not None:
            vals.append(a - b)
    vals.sort()
    if not vals:
        return None, None
    return vals[int(0.025 * len(vals))], vals[min(len(vals) - 1, int(0.975 * len(vals)))]
