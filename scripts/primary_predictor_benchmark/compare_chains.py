"""Compare whole fallback chains instead of single tools (post-hoc amendment to PLAN.md 4.3).

The pre-registered rule ranked each tool alone and counted a missing score as a miss. The app
never uses one tool alone: when the first tool has no score, the next tool in the fallback order
answers. This script scores each candidate order as one "tool" (the first tool in the order that
has a score gives the call) and reuses the same metrics and paired gene-cluster bootstrap.

Input is the per-variant output of `run_vm_benchmark.py` (`variant_calls.tsv.gz`), so no
ClinVar or dbNSFP access is needed.

Usage:
  python -m scripts.primary_predictor_benchmark.compare_chains \
      logs/primary_predictor_bench/variant_calls.tsv.gz logs/primary_predictor_bench/chain_comparison.json
"""
from __future__ import annotations

import csv
import gzip
import json
import sys
from pathlib import Path
from typing import Any

from scripts.primary_predictor_benchmark import metrics as m

CHAIN_ORDERS: dict[str, tuple[str, ...]] = {
    "bayesdel_first": ("bayesdel", "revel", "alphamissense", "esm1b"),
    "revel_first": ("revel", "bayesdel", "alphamissense", "esm1b"),
    "alphamissense_first": ("alphamissense", "bayesdel", "revel", "esm1b"),
}
COHORT_FLAGS: tuple[str, ...] = ("post_2023", "post_2024")


def chain_call(calls: dict[str, str], order: tuple[str, ...]) -> str:
    """The call of the first tool in `order` that has a score; "Missing" when none has."""
    for tool in order:
        code = calls.get(tool, "Missing")
        if code != "Missing":
            return code
    return "Missing"


def compare_chains(
    variants: list[dict[str, Any]],
    orders: dict[str, tuple[str, ...]],
    *,
    reps: int = m.BOOTSTRAP_REPS,
    seed: int = m.BOOTSTRAP_SEED,
) -> dict[str, Any]:
    """Score each order as one tool, with paired bootstrap CIs across orders."""
    chained = [
        {**v, "calls": {name: chain_call(v["calls"], order) for name, order in orders.items()}}
        for v in variants
    ]
    return m.summarize_variants(chained, reps=reps, seed=seed, tools=tuple(orders))


def load_cohorts(path: Path) -> dict[str, list[dict[str, Any]]]:
    """Read `variant_calls.tsv.gz` into the full set and the dated holdout cohorts."""
    cohorts: dict[str, list[dict[str, Any]]] = {"full_2star": []}
    cohorts.update({flag: [] for flag in COHORT_FLAGS})
    with gzip.open(path, "rt", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            variant = {
                "gene": row["gene"],
                "y": int(row["y"]),
                "in_dbnsfp": row["in_dbnsfp"] == "1",
                "calls": {tool: row[f"{tool}_call"] for tool in m.TOOLS},
            }
            cohorts["full_2star"].append(variant)
            for flag in COHORT_FLAGS:
                if row[flag] == "1":
                    cohorts[flag].append(variant)
    return cohorts


def _pct(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:.2f}%"


def _pp(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:+.2f} pp"


def render_markdown(results: dict[str, dict[str, Any]]) -> str:
    """One table per cohort, then REVEL-first minus BayesDel-first with 95% CIs."""
    out = ["# Fallback-chain comparison (post-hoc)", ""]
    for cohort, s in results.items():
        out += [f"## {cohort} (N = {s['n_variants_a']:,}, {s['n_genes']:,} genes)", ""]
        out += ["| Order | Cov_A | Reach_P_Mod+ | Reach_B_Mod+ | H_Mod+ | W_P | W_B | W_bal |"]
        out += ["|---|---:|---:|---:|---:|---:|---:|---:|"]
        for name, t in s["tools"].items():
            out.append(
                f"| {name} | {_pct(t['cov_a'])} | {_pct(t['reach_p_mod'])} | {_pct(t['reach_b_mod'])} "
                f"| {_pct(t['h_mod'])} | {_pct(t['w_p'])} | {_pct(t['w_b'])} | {_pct(t['w_bal'])} |"
            )
        dh = s["paired_h_mod_deltas"]["revel_first_minus_bayesdel_first"]
        dw = s["paired_w_bal_deltas"]["revel_first_minus_bayesdel_first"]
        out += [
            "",
            f"REVEL-first minus BayesDel-first: ΔH_Mod+ {_pp(dh['delta_h_mod'])} "
            f"[{_pp(dh['ci_low'])}, {_pp(dh['ci_high'])}]; ΔW_bal {_pp(dw['delta'])} "
            f"[{_pp(dw['ci_low'])}, {_pp(dw['ci_high'])}]",
            "",
        ]
    return "\n".join(out)


def main(argv: list[str]) -> int:
    tsv_path, json_path = Path(argv[1]), Path(argv[2])
    pair = {k: CHAIN_ORDERS[k] for k in ("bayesdel_first", "revel_first")}
    results: dict[str, dict[str, Any]] = {}
    for cohort, variants in load_cohorts(tsv_path).items():
        summary = compare_chains(variants, CHAIN_ORDERS)
        # With exactly two orders, the W_bal "excess" of one order is its paired difference
        # from the other, so this gives the paired ΔW_bal and its bootstrap CI.
        w = compare_chains(variants, pair)["w_bal_excess"]["revel_first"]
        summary["paired_w_bal_deltas"] = {
            "revel_first_minus_bayesdel_first": {
                "delta": w["excess_over_next_worst"],
                "ci_low": w["ci_low"],
                "ci_high": w["ci_high"],
            }
        }
        results[cohort] = summary
    json_path.write_text(json.dumps(results, indent=2), encoding="utf-8", newline="\n")
    md = render_markdown(results)
    json_path.with_suffix(".md").write_text(md, encoding="utf-8", newline="\n")
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
