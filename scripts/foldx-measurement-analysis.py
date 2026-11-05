"""What can a FoldX value say about the measured stability change?

Reads the per-variant rows that scripts/foldx-repair-benchmark.ts wrote for a training set and a held-out set and
reports: baselines, repair equivalence, recalibration, a prediction interval, band reliability and error by burial.
Nothing is fitted on the held-out set. Every interval resamples whole chains, because variants of one protein are not
independent.

    python scripts/foldx-measurement-analysis.py logs/foldx_bench/s669 logs/foldx_bench/ssym
"""
import json
import os
import sys

import numpy as np

MARGIN = 0.1
DRAWS = 2000
MODES = ["none", "full", "local"]


def load(folder):
    rows = []
    for line in open(os.path.join(folder, "results.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        if all(isinstance(r["ddg"].get(m), (int, float)) for m in MODES):
            # The value the app itself would show: whole-chain up to 233 residues, local above.
            r["app"] = r["ddg"]["full"] if r["residues"] <= 233 else r["ddg"]["local"]
            r["key"] = r["pdb"] + r["chain"]
            rows.append(r)
    return rows


def band(v):
    return np.digitize(v, [0.5, 1.5])


def rmse(x, y):
    return float(np.sqrt(np.mean((x - y) ** 2)))


def r_of(x, y):
    return float(np.corrcoef(x, y)[0, 1])


def agree(x, y):
    return float(np.mean(band(x) == band(y)))


def arrays(rows, get):
    return np.array([get(r) for r in rows], dtype=float)


def boot(rows, stat, draws=DRAWS, seed=20261104):
    """Resample chains; returns the 5th, 2.5th, 95th and 97.5th percentiles of `stat(rows)`."""
    keys = sorted({r["key"] for r in rows})
    by = {k: [r for r in rows if r["key"] == k] for k in keys}
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(draws):
        sample = []
        for i in rng.integers(0, len(keys), len(keys)):
            sample.extend(by[keys[i]])
        out.append(stat(sample))
    out = np.array(out)
    return {"p90": [float(np.percentile(out, 5)), float(np.percentile(out, 95))], "p95": [float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))]}


def describe(rows, name):
    y = arrays(rows, lambda r: r["measured"])
    print(f"\n=== {name}: {len(rows)} variants on {len({r['key'] for r in rows})} chains; measured mean {y.mean():.2f}, sd {y.std():.2f} ===")
    result = {"variants": len(rows), "chains": len({r["key"] for r in rows}), "measuredSd": float(y.std())}
    for m in MODES + ["app"]:
        x = arrays(rows, lambda r: r[m] if m == "app" else r["ddg"][m])
        print(f"  {m:5s} r {r_of(x, y):.3f} RMSE {rmse(x, y):.3f} MAE {np.mean(np.abs(x - y)):.3f} bias {np.mean(x - y):+.3f} slope(measured on FoldX) {np.polyfit(x, y, 1)[0]:.3f} band {agree(x, y) * 100:.1f}%")
        result[m] = {"r": r_of(x, y), "rmse": rmse(x, y), "band": agree(x, y), "bias": float(np.mean(x - y))}
    return result


def baselines(rows, train_mean, name):
    y = arrays(rows, lambda r: r["measured"])
    print(f"  Baselines on {name}: predict the training mean RMSE {rmse(np.full_like(y, train_mean), y):.3f}; always 'no destabilization' band {np.mean(band(y) == 0) * 100:.1f}%")

    def rmse_gain(s):
        yy = arrays(s, lambda r: r["measured"])
        return rmse(np.full_like(yy, train_mean), yy) - rmse(arrays(s, lambda r: r["app"]), yy)

    def band_gain(s):
        yy = arrays(s, lambda r: r["measured"])
        return agree(arrays(s, lambda r: r["app"]), yy) - float(np.mean(band(yy) == 0))

    a, b = boot(rows, rmse_gain)["p95"], boot(rows, band_gain)["p95"]
    print(f"  FoldX minus baseline (95%): RMSE improvement [{a[0]:+.3f}, {a[1]:+.3f}], band agreement [{b[0] * 100:+.1f}, {b[1] * 100:+.1f}] points")
    rng = np.random.default_rng(7)
    x = arrays(rows, lambda r: r["app"])
    print(f"  Shuffled-label control: mean r {np.mean([r_of(x, rng.permutation(y)) for _ in range(500)]):+.3f}")
    return {"rmseGain": a, "bandGain": b, "alwaysNeutral": float(np.mean(band(y) == 0)), "meanRmse": rmse(np.full_like(y, train_mean), y)}


def equivalence(rows, name, a="local", b="full"):
    def diff(s):
        y = arrays(s, lambda r: r["measured"])
        return rmse(arrays(s, lambda r: r["ddg"][a]), y) - rmse(arrays(s, lambda r: r["ddg"][b]), y)

    ci = boot(rows, diff)
    point = diff(rows)
    inside = ci["p90"][0] > -MARGIN and ci["p90"][1] < MARGIN
    y = arrays(rows, lambda r: r["measured"])
    ba, bb, bm = band(arrays(rows, lambda r: r["ddg"][a])), band(arrays(rows, lambda r: r["ddg"][b])), band(y)
    changed = ba != bb
    better = int(np.sum(np.abs(ba - bm)[changed] < np.abs(bb - bm)[changed]))
    worse = int(np.sum(np.abs(ba - bm)[changed] > np.abs(bb - bm)[changed]))
    gaps = np.abs(arrays(rows, lambda r: r["ddg"][a]) - arrays(rows, lambda r: r["ddg"][b]))
    print(f"  {name:32s} {a}-{b} RMSE {point:+.3f}, 90% [{ci['p90'][0]:+.3f}, {ci['p90'][1]:+.3f}] {'EQUIVALENT' if inside else 'not shown equivalent'}; band changes {int(changed.sum())}/{len(rows)} (closer {better}, further {worse}); gap median {np.median(gaps):.3f} p90 {np.percentile(gaps, 90):.3f} max {gaps.max():.2f}")
    return {"point": point, "ci90": ci["p90"], "equivalent": inside, "bandChanges": int(changed.sum()), "closer": better, "further": worse}


def bin_of(x):
    return band(x)


def fit_interval(rows, q=(0.1, 0.9)):
    """Signed error (measured minus FoldX) quantiles, per FoldX band. Chain-held-out errors are the same as the
    plain ones here because nothing is fitted but the quantiles; leave-one-chain-out coverage tests them."""
    x, y = arrays(rows, lambda r: r["app"]), arrays(rows, lambda r: r["measured"])
    return {int(b): (float(np.quantile((y - x)[bin_of(x) == b], q[0])), float(np.quantile((y - x)[bin_of(x) == b], q[1]))) for b in (0, 1, 2)}


def coverage(rows, table):
    x, y = arrays(rows, lambda r: r["app"]), arrays(rows, lambda r: r["measured"])
    lo = np.array([table[int(b)][0] for b in bin_of(x)])
    hi = np.array([table[int(b)][1] for b in bin_of(x)])
    return float(np.mean((y - x >= lo) & (y - x <= hi))), float(np.mean(hi - lo))


def reliability(rows):
    x, y = band(arrays(rows, lambda r: r["app"])), band(arrays(rows, lambda r: r["measured"]))
    out = {}
    for b in (0, 1, 2):
        mask = x == b
        out[int(b)] = {"n": int(mask.sum()), "measured": [float(np.mean(y[mask] == k)) if mask.sum() else None for k in (0, 1, 2)]}
    return out


def burial(rows, chains_dir):
    """Heavy atoms within 10 Å of the site's CA in the whole-chain repaired template. A simple, unfitted proxy."""
    cache = {}
    counts = []
    for r in rows:
        path = os.path.join(chains_dir, r["key"], "full_Repair.pdb")
        if r["key"] not in cache:
            atoms, ca = [], {}
            for line in open(path, encoding="utf-8", errors="replace"):
                if line.startswith("ATOM"):
                    xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
                    atoms.append(xyz)
                    if line[12:16].strip() == "CA":
                        ca[int(line[22:26])] = xyz
            cache[r["key"]] = (np.array(atoms), ca)
        atoms, ca = cache[r["key"]]
        site = int("".join(c for c in r["mutation"][2:-1] if c.isdigit()))
        counts.append(int(np.sum(np.sum((atoms - np.array(ca[site])) ** 2, axis=1) <= 100)) if site in ca else -1)
    return counts


def burial_report(rows, counts, cut=None):
    known = [(r, c) for r, c in zip(rows, counts) if c >= 0]
    cut = cut if cut is not None else float(np.median([c for _, c in known]))
    out = {"cut": cut}
    for label, keep in (("exposed", lambda c: c < cut), ("buried", lambda c: c >= cut)):
        part = [r for r, c in known if keep(c)]
        x, y = arrays(part, lambda r: r["app"]), arrays(part, lambda r: r["measured"])
        print(f"  {label:8s} n {len(part)} r {r_of(x, y):.3f} RMSE {rmse(x, y):.3f} bias {np.mean(x - y):+.3f} band {agree(x, y) * 100:.1f}% measured sd {y.std():.2f}")
        out[label] = {"n": len(part), "r": r_of(x, y), "rmse": rmse(x, y), "bias": float(np.mean(x - y)), "band": agree(x, y)}
    return out


def main():
    train_dir, test_dir = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None
    train = load(train_dir)
    test = load(test_dir) if test_dir else []
    summary = {"train": describe(train, "S669 (training)")}
    train_mean = float(np.mean(arrays(train, lambda r: r["measured"])))
    summary["trainBaselines"] = baselines(train, train_mean, "training")

    print("\nRepair equivalence, margin +/-0.1 kcal/mol RMSE, 90% interval")
    small = [r for r in train if r["residues"] <= 233]
    large = [r for r in train if r["residues"] > 233]
    summary["equivalence"] = {
        "s669All": equivalence(train, "S669 all"),
        "s669Small": equivalence(small, "S669 up to 233"),
        "s669Large": equivalence(large, "S669 above 233"),
        "s669NoneAll": equivalence(train, "S669 all", "none", "full"),
        "s669NoneLarge": equivalence(large, "S669 above 233", "none", "full"),
    }

    x, y = arrays(train, lambda r: r["app"]), arrays(train, lambda r: r["measured"])
    b, a = np.polyfit(x, y, 1)
    print(f"\nRecalibration fitted on S669: measured = {a:+.3f} + {b:.3f} x FoldX")
    errors = []
    for key in sorted({r["key"] for r in train}):
        fit = [r for r in train if r["key"] != key]
        bb, aa = np.polyfit(arrays(fit, lambda r: r["app"]), arrays(fit, lambda r: r["measured"]), 1)
        errors.extend((aa + bb * r["app"] - r["measured"]) ** 2 for r in train if r["key"] == key)
    print(f"  leave-one-chain-out RMSE {np.sqrt(np.mean(errors)):.3f} (raw {rmse(x, y):.3f})")
    summary["recalibration"] = {"a": float(a), "b": float(b), "looRmse": float(np.sqrt(np.mean(errors))), "rawRmse": rmse(x, y)}

    table = fit_interval(train)
    loo_hits, loo_width = [], []
    for key in sorted({r["key"] for r in train}):
        t = fit_interval([r for r in train if r["key"] != key])
        hit, width = coverage([r for r in train if r["key"] == key], t)
        n = sum(r["key"] == key for r in train)
        loo_hits.append((hit, n))
        loo_width.append((width, n))
    loo = sum(h * n for h, n in loo_hits) / sum(n for _, n in loo_hits)
    print("\n80% interval, added to the FoldX value, by FoldX band (fitted on S669):")
    for k, (lo, hi) in table.items():
        print(f"  band {k}: {lo:+.2f} to {hi:+.2f}")
    print(f"  leave-one-chain-out coverage on S669 {loo * 100:.1f}%")
    summary["interval"] = {"table": table, "looCoverage": loo}

    print("\nMeasured band given the band FoldX shows (S669):")
    rel = reliability(train)
    for k, v in rel.items():
        print(f"  FoldX band {k}: n {v['n']} measured {[round(p * 100) for p in v['measured']]}")
    summary["reliability"] = {"train": rel}

    print("\nError by burial (S669), split at the median:")
    summary["burial"] = {"train": burial_report(train, burial(train, os.path.join(train_dir, "chains")))}
    cut = summary["burial"]["train"]["cut"]

    if test:
        summary["test"] = describe(test, "Ssym direct (held out)")
        summary["testBaselines"] = baselines(test, train_mean, "held-out")
        print("\nHeld-out repair equivalence")
        small_t = [r for r in test if r["residues"] <= 233]
        large_t = [r for r in test if r["residues"] > 233]
        summary["equivalence"]["heldOutAll"] = equivalence(test, "Ssym all")
        if len({r["key"] for r in small_t}) >= 3:
            summary["equivalence"]["heldOutSmall"] = equivalence(small_t, "Ssym up to 233")
        if len({r["key"] for r in large_t}) >= 3:
            summary["equivalence"]["heldOutLarge"] = equivalence(large_t, "Ssym above 233")
        summary["equivalence"]["heldOutNone"] = equivalence(test, "Ssym all", "none", "full")

        xt, yt = arrays(test, lambda r: r["app"]), arrays(test, lambda r: r["measured"])
        recal = a + b * xt
        print(f"\nRecalibration on held-out: RMSE {rmse(recal, yt):.3f} vs raw {rmse(xt, yt):.3f}; band {agree(recal, yt) * 100:.1f}% vs raw {agree(xt, yt) * 100:.1f}%; slope of measured on FoldX {np.polyfit(xt, yt, 1)[0]:.3f}")
        summary["recalibration"]["heldOut"] = {"rmse": rmse(recal, yt), "raw": rmse(xt, yt), "band": agree(recal, yt), "rawBand": agree(xt, yt)}

        cover, width = coverage(test, table)
        print(f"80% interval on held-out: coverage {cover * 100:.1f}%, mean width {width:.2f}")
        ci = boot(test, lambda s: coverage(s, table)[0])["p95"]
        print(f"  95% interval on coverage (resampling chains): [{ci[0] * 100:.1f}, {ci[1] * 100:.1f}]")
        summary["interval"]["heldOut"] = {"coverage": cover, "width": width, "ci": ci}

        print("\nMeasured band given the band FoldX shows (held out), and the largest gap from S669:")
        rel_t = reliability(test)
        worst = 0.0
        for k, v in rel_t.items():
            if v["n"]:
                gap = max(abs(p - q) for p, q in zip(v["measured"], rel[k]["measured"]))
                worst = max(worst, gap)
                print(f"  FoldX band {k}: n {v['n']} measured {[round(p * 100) for p in v['measured']]}; largest gap {gap * 100:.0f} points")
        summary["reliability"]["test"] = rel_t
        summary["reliability"]["worstGap"] = worst

        print("\nError by burial (held out), same cut:")
        summary["burial"]["test"] = burial_report(test, burial(test, os.path.join(test_dir, "chains")), cut)

    with open(os.path.join(train_dir, "measurement-analysis.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)


main()
