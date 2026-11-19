"""Pure-Python statistical metrics and chain-clustered bootstrap CIs."""
from __future__ import annotations

import math
import random
from typing import Callable, Iterable


def _ranks(values: list[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda kv: kv[1])
    out = [0.0] * len(values)
    i = 0
    while i < len(indexed):
        j = i
        while j + 1 < len(indexed) and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        avg_rank = 0.5 * (i + j) + 1.0
        for k in range(i, j + 1):
            out[indexed[k][0]] = avg_rank
        i = j + 1
    return out


def pearson_r(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 2 or n != len(ys):
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs)
    dy = sum((y - my) ** 2 for y in ys)
    denom = math.sqrt(dx * dy)
    return num / denom if denom > 0.0 else None


def spearman_rho(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2 or len(xs) != len(ys):
        return None
    return pearson_r(_ranks(xs), _ranks(ys))


def rmse(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n == 0 or n != len(ys):
        return None
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(xs, ys)) / n)


def roc_auc(labels: list[int], scores: list[float]) -> float | None:
    """ROC AUC via Mann-Whitney U with exact average-rank tie handling."""
    if len(labels) != len(scores) or not labels:
        return None
    n_pos = sum(1 for y in labels if y == 1)
    n_neg = len(labels) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None
    ranks = _ranks(scores)
    pos_rank_sum = sum(r for r, y in zip(ranks, labels) if y == 1)
    u = pos_rank_sum - n_pos * (n_pos + 1) / 2.0
    return u / (n_pos * n_neg)


def ssym_antisymmetry(direct_preds: list[float], reverse_preds: list[float]) -> dict[str, float | int | None]:
    """Compute paired Ssym antisymmetry: r_dir_inv and mean(dir + inv) / 2."""
    n = min(len(direct_preds), len(reverse_preds))
    if n == 0:
        return {"n_pairs": 0, "r_dir_inv": None, "mean_bias": None, "mean_sum": None}
    sums = [d + r for d, r in zip(direct_preds, reverse_preds)]
    return {
        "n_pairs": n,
        "r_dir_inv": pearson_r(direct_preds, reverse_preds),
        "mean_bias": 0.5 * (sum(sums) / len(sums)),
        "mean_sum": sum(sums) / len(sums),
    }


def _quantile(sorted_vals: list[float], q: float) -> float:
    pos = q * (len(sorted_vals) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (pos - lo) * (sorted_vals[hi] - sorted_vals[lo])


def bootstrap_ci(
    rows: list[dict],
    group_key: str,
    metric_fn: Callable[[list[dict]], float | None],
    n_boot: int = 2000,
    seed: int = 42,
) -> dict[str, float | int | None]:
    """Clustered 95% bootstrap CI resampling whole protein/chain groups."""
    point = metric_fn(rows)
    if point is None or not rows:
        return {"point": point, "ci_low": None, "ci_high": None, "n_clusters": 0}
    by_group: dict[str, list[dict]] = {}
    for row in rows:
        by_group.setdefault(str(row[group_key]), []).append(row)
    groups = list(by_group.values())
    k = len(groups)
    rng = random.Random(seed)
    samples: list[float] = []
    for _ in range(n_boot):
        drawn = [groups[rng.randrange(k)] for _ in range(k)]
        flat = [item for grp in drawn for item in grp]
        val = metric_fn(flat)
        if val is not None and math.isfinite(val):
            samples.append(val)
    if len(samples) < 20:
        return {"point": point, "ci_low": None, "ci_high": None, "n_clusters": k}
    samples.sort()
    return {
        "point": point,
        "ci_low": _quantile(samples, 0.025),
        "ci_high": _quantile(samples, 0.975),
        "n_clusters": k,
    }


MIN_REGRESSION_N = 20
MIN_ROC_CLASS_N = 20


def summarize_regression(
    rows: Iterable[dict],
    threshold_kcal: float = 1.0,
    n_boot: int = 2000,
    seed: int = 42,
    group_key: str = "cluster",
) -> dict:
    """Compute Spearman, Pearson, RMSE, and ROC AUC with protein-level 95% bootstrap CIs.

    Protocol rules:
      - Spearman / Pearson / RMSE require at least 20 scored variants.
      - ROC AUC requires at least 20 destabilizing (measured >= 1.0) and 20 other variants.
    """
    items = list(rows)
    n_scored = len(items)
    n_groups = len({str(r[group_key]) for r in items}) if items else 0
    n_pos = sum(1 for r in items if r["measured"] >= threshold_kcal)
    n_neg = n_scored - n_pos
    out: dict[str, object] = {
        "n": n_scored,
        "n_groups": n_groups,
        "n_pos": n_pos,
        "n_neg": n_neg,
        "spearman": None,
        "pearson": None,
        "rmse": None,
        "roc_auc": None,
    }
    if n_scored >= MIN_REGRESSION_N:
        out["spearman"] = bootstrap_ci(
            items, group_key, lambda rs: spearman_rho([r["measured"] for r in rs], [r["pred"] for r in rs]), n_boot, seed
        )
        out["pearson"] = bootstrap_ci(
            items, group_key, lambda rs: pearson_r([r["measured"] for r in rs], [r["pred"] for r in rs]), n_boot, seed
        )
        out["rmse"] = bootstrap_ci(
            items, group_key, lambda rs: rmse([r["measured"] for r in rs], [r["pred"] for r in rs]), n_boot, seed
        )
    if n_pos >= MIN_ROC_CLASS_N and n_neg >= MIN_ROC_CLASS_N:
        out["roc_auc"] = bootstrap_ci(
            items,
            group_key,
            lambda rs: roc_auc([1 if r["measured"] >= threshold_kcal else 0 for r in rs], [r["pred"] for r in rs]),
            n_boot,
            seed,
        )
    return out


def summarize_ssym_pairs(
    pairs: Iterable[dict],
    n_boot: int = 2000,
    seed: int = 42,
    group_key: str = "cluster",
) -> dict:
    """Compute paired Ssym antisymmetry metrics with protein-level 95% bootstrap CIs."""
    items = list(pairs)
    n_pairs = len(items)
    n_groups = len({str(r[group_key]) for r in items}) if items else 0
    out: dict[str, object] = {
        "n_pairs": n_pairs,
        "n_groups": n_groups,
        "r_dir_inv": None,
        "mean_bias": None,
        "mean_sum": None,
    }
    if n_pairs >= MIN_REGRESSION_N:
        for k in ("r_dir_inv", "mean_bias", "mean_sum"):
            out[k] = bootstrap_ci(
                items,
                group_key,
                lambda rs, m=k: ssym_antisymmetry([x["dir"] for x in rs], [x["inv"] for x in rs])[m],
                n_boot,
                seed,
            )
    return out
