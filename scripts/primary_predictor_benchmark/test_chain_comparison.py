"""Tests for the post-hoc fallback-chain comparison (amendment to the pre-registered rule)."""
from __future__ import annotations

import gzip
import tempfile
import unittest
from pathlib import Path

from scripts.primary_predictor_benchmark import compare_chains as cc


def _variant(gene: str, y: int, revel: str, bayesdel: str) -> dict:
    calls = {"revel": revel, "bayesdel": bayesdel, "alphamissense": "Missing", "esm1b": "Missing"}
    return {"gene": gene, "y": y, "in_dbnsfp": True, "calls": calls}


class ChainCallTests(unittest.TestCase):
    def test_first_tool_with_a_score_answers(self) -> None:
        calls = {"revel": "Missing", "bayesdel": "PP3", "alphamissense": "BP4"}
        self.assertEqual(cc.chain_call(calls, ("revel", "bayesdel", "alphamissense")), "PP3")
        self.assertEqual(cc.chain_call(calls, ("alphamissense", "bayesdel")), "BP4")
        self.assertEqual(cc.chain_call({"revel": "Missing"}, ("revel",)), "Missing")


class CompareChainsTests(unittest.TestCase):
    def test_chain_that_fills_gaps_with_a_better_tool_wins(self) -> None:
        # REVEL is more accurate where it has a score but is missing on one gene in five.
        # A single-tool ranking penalises REVEL for the gap; a chain ranking must not,
        # because BayesDel answers those variants in either order.
        variants = []
        for g in range(30):
            gap = g % 5 == 0
            revel_p = "Missing" if gap else "PP3_Strong"
            revel_b = "Missing" if gap else "BP4_Moderate"
            bd_p = "PP3_Moderate" if g % 3 else "PP3"
            bd_b = "PP3" if g % 4 == 0 else "BP4_Moderate"
            variants.append(_variant(f"G{g}", 1, revel_p, bd_p))
            variants.append(_variant(f"G{g}", 0, revel_b, bd_b))

        orders = {"bayesdel_first": ("bayesdel", "revel"), "revel_first": ("revel", "bayesdel")}
        out = cc.compare_chains(variants, orders, reps=200, seed=1)

        tools = out["tools"]
        self.assertGreater(tools["revel_first"]["h_mod"], tools["bayesdel_first"]["h_mod"])
        self.assertLess(tools["revel_first"]["w_bal"], tools["bayesdel_first"]["w_bal"])
        self.assertEqual(tools["revel_first"]["cov_a"], 1.0)
        delta = out["paired_h_mod_deltas"]["revel_first_minus_bayesdel_first"]
        self.assertGreater(delta["ci_low"], 0.0)
        # With two chains, the W_bal excess of one chain is its paired difference from the other.
        w_delta = out["w_bal_excess"]["bayesdel_first"]
        self.assertGreater(w_delta["ci_low"], 0.0)

    def test_reads_cohort_from_variant_calls_tsv(self) -> None:
        header = "chr\tpos_genomic\tref\talt\tvariation_id\tgene\ty\tin_dbnsfp\tplddt\tpost_2023\tpost_2024\trevel_call\tbayesdel_call\talphamissense_call\tesm1b_call\n"
        lines = [
            "1\t10\tA\tC\t1\tG1\t1\t1\t90\t1\t0\tPP3_Strong\tPP3\tMissing\tMissing\n",
            "1\t11\tA\tG\t2\tG2\t0\t0\t\t0\t0\tMissing\tMissing\tMissing\tMissing\n",
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "variant_calls.tsv.gz"
            with gzip.open(path, "wt", newline="\n") as fh:
                fh.write(header + "".join(lines))
            cohorts = cc.load_cohorts(path)

        self.assertEqual(len(cohorts["full_2star"]), 2)
        self.assertEqual(len(cohorts["post_2023"]), 1)
        self.assertEqual(len(cohorts["post_2024"]), 0)
        first = cohorts["post_2023"][0]
        self.assertEqual(first["calls"]["revel"], "PP3_Strong")
        self.assertEqual(first["y"], 1)
        self.assertTrue(first["in_dbnsfp"])
        self.assertFalse(cohorts["full_2star"][1]["in_dbnsfp"])


if __name__ == "__main__":
    unittest.main()
