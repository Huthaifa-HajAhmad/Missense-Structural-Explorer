"""Unit tests for canonical DDG sign normalization, metrics, grouping, thresholds, and held-out exclusion."""
from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from common import global_sequence_identity, locate_residue, residues_from_pdb, to_canonical_ddg
from evaluate import _eval_split, _eval_ssym_pairs, _evaluate_criteria, _fmt_stat
from metrics import (
    bootstrap_ci,
    pearson_r,
    rmse,
    roc_auc,
    spearman_rho,
    ssym_antisymmetry,
    summarize_regression,
    summarize_ssym_pairs,
)
from prepare_datasets import protein_cluster
from run_foldx import plan_fix_shell
from training_overlap import check_heldout


class TestMetrics(unittest.TestCase):
    def test_sign_normalization(self) -> None:
        self.assertEqual(to_canonical_ddg(1.8, "positive-destabilizing"), 1.8)
        self.assertEqual(to_canonical_ddg(-1.8, "negative-destabilizing"), 1.8)
        with self.assertRaises(ValueError):
            to_canonical_ddg(1.0, "unknown")

    def test_pearson_and_spearman_with_ties(self) -> None:
        xs = [1.0, 2.0, 2.0, 4.0]
        ys = [10.0, 20.0, 20.0, 40.0]
        self.assertAlmostEqual(pearson_r(xs, ys), 1.0, places=9)
        self.assertAlmostEqual(spearman_rho(xs, ys), 1.0, places=9)
        self.assertAlmostEqual(pearson_r(xs, [-y for y in ys]), -1.0, places=9)
        self.assertAlmostEqual(rmse([1.0, 2.0], [2.0, 4.0]), (2.5) ** 0.5, places=9)

    def test_roc_auc(self) -> None:
        self.assertAlmostEqual(roc_auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1.0, places=9)
        self.assertAlmostEqual(roc_auc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1]), 0.0, places=9)
        self.assertAlmostEqual(roc_auc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]), 0.5, places=9)
        # 1 pos > 1 neg, 1 pos < 1 neg -> 3 of 4 pairs concordant -> 0.75
        self.assertAlmostEqual(roc_auc([0, 1, 0, 1], [0.1, 0.4, 0.6, 0.9]), 0.75, places=9)

    def test_ssym_antisymmetry(self) -> None:
        res = ssym_antisymmetry([1.0, 2.0, -0.5], [-1.0, -2.0, 0.5])
        self.assertAlmostEqual(res["r_dir_inv"], -1.0, places=9)
        self.assertAlmostEqual(res["mean_bias"], 0.0, places=9)
        biased = ssym_antisymmetry([1.5, 2.5], [-0.5, -1.5])
        self.assertAlmostEqual(biased["mean_bias"], 0.5, places=9)
        self.assertAlmostEqual(biased["mean_sum"], 1.0, places=9)

    def test_chain_bootstrap_ci_deterministic_and_clustered(self) -> None:
        rows = []
        for c in range(10):
            shift = 0.0 if c < 5 else 2.0
            for i in range(4):
                rows.append({"cluster": f"chain_{c}", "measured": float(i), "pred": float(i) + shift})
        ci1 = bootstrap_ci(rows, "cluster", lambda rs: rmse([r["measured"] for r in rs], [r["pred"] for r in rs]), n_boot=400, seed=42)
        ci2 = bootstrap_ci(rows, "cluster", lambda rs: rmse([r["measured"] for r in rs], [r["pred"] for r in rs]), n_boot=400, seed=42)
        self.assertEqual(ci1, ci2)
        self.assertEqual(ci1["n_clusters"], 10)
        self.assertLess(ci1["ci_low"], ci1["point"])
        self.assertGreater(ci1["ci_high"], ci1["point"])

    def test_global_sequence_identity_length_and_random(self) -> None:
        s1 = "ACDEFGHIKLMNPQRSTVWY" * 4
        s2 = "MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWK"
        self.assertAlmostEqual(global_sequence_identity(s1, s1), 1.0, places=9)
        self.assertLess(global_sequence_identity(s1, s2), 0.25)
        self.assertLess(global_sequence_identity("ACDEFGHIKL", "ACDEFGHIKL" * 10), 0.15)

    def test_plan_fix_shell_and_locate_residue(self) -> None:
        pdb = "\n".join([
            "ATOM      1  CA  ALA A  10       0.000   0.000   0.000  1.00 20.00           C",
            "ATOM      2  CA  GLY A  11       4.000   0.000   0.000  1.00 20.00           C",
            "ATOM      3  CA  VAL A  30      25.000   0.000   0.000  1.00 20.00           C",
        ])
        res, mode = locate_residue(residues_from_pdb(pdb), "G", 2)
        self.assertEqual(mode, "running-count")
        self.assertEqual(res["res_seq"], 11)
        fixed = plan_fix_shell(pdb, "A", 10)
        self.assertEqual(fixed, "VA30;")

    def test_grouping_by_accession_and_no_accession_fallback(self) -> None:
        # Two PDB chains sharing UniProt P02417 map to one protein group
        g1, f1 = protein_cluster("P02417", "1DIV", "A")
        g2, f2 = protein_cluster("p02417", "2HBB", "A")
        self.assertEqual(g1, "P02417")
        self.assertEqual(g2, "P02417")
        self.assertFalse(f1)
        self.assertFalse(f2)

        # Missing accession gets its own PDB_chain group and is flagged no_accession
        g3, f3 = protein_cluster("", "1FH5", "H")
        g4, f4 = protein_cluster("NA", "1FH5", "H")
        self.assertEqual(g3, "1FH5_H")
        self.assertEqual(g4, "1FH5_H")
        self.assertTrue(f3)
        self.assertTrue(f4)

        # Regression bootstrap counts unique UniProt protein groups, not PDB chains
        rows = []
        # 2 PDBs (1DIV_A, 2HBB_A) sharing P02417 + 9 other proteins = 10 protein groups, 40 variants
        clusters = ["P02417", "P02417"] + [f"P0000{i}" for i in range(1, 9)]
        for idx, cl in enumerate(clusters):
            for j in range(4):
                meas = 2.0 if j < 2 else -0.5
                rows.append({"cluster": cl, "measured": meas, "pred": meas + 0.1 * (idx % 3)})
        summary = summarize_regression(rows, threshold_kcal=1.0, n_boot=200, seed=42)
        self.assertEqual(summary["n"], 40)
        self.assertEqual(summary["n_groups"], 9)  # P02417 + 8 P00001..P00008
        self.assertEqual(summary["pearson"]["n_clusters"], 9)

    def test_ssym_pair_grouping_keeps_direct_and_reverse_together(self) -> None:
        # Two PDB pairs (1L63_A and 2LZM_A) sharing P00720, plus 9 other proteins (2 pairs each)
        direct_rows, reverse_rows = [], []
        d_preds, r_preds = {}, {}
        proteins = ["P00720", "P00720"] + [f"P1000{i}" for i in range(1, 9)]
        for idx, cl in enumerate(proteins):
            for j in range(2):
                pid = f"PAIR_{idx}_{j}"
                did = f"D_{idx}_{j}"
                rid = f"R_{idx}_{j}"
                ho = {"foldx": {"heldout": True, "reason": None}}
                direct_rows.append({"id": did, "pair_id": pid, "cluster": cl, "no_accession": False, "heldout": ho})
                reverse_rows.append({"id": rid, "pair_id": pid, "cluster": cl, "no_accession": False, "heldout": ho})
                d_val = 1.0 + 0.2 * j + 0.1 * idx
                r_val = -d_val + 0.05 * idx
                d_preds[did] = {"id": did, "status": "ok", "raw_ddg": d_val}
                r_preds[rid] = {"id": rid, "status": "ok", "raw_ddg": r_val}

        res = _eval_ssym_pairs("foldx", {"ssym_direct": direct_rows, "ssym_reverse": reverse_rows}, d_preds, r_preds, False)
        self.assertEqual(res["n_pairs"], 20)
        self.assertEqual(res["n_groups"], 9)  # P00720 grouped across 1L63_A & 2LZM_A
        self.assertIsNotNone(res["stats"]["r_dir_inv"])
        self.assertEqual(res["stats"]["r_dir_inv"]["n_clusters"], 9)

        # Fewer than 20 pairs reports "too few"
        small = summarize_ssym_pairs(
            [{"cluster": f"P{i}", "dir": float(i), "inv": -float(i)} for i in range(19)],
            n_boot=200,
            seed=42,
        )
        self.assertEqual(small["n_pairs"], 19)
        self.assertIsNone(small["r_dir_inv"])
        self.assertEqual(_fmt_stat(small, "r_dir_inv"), "too few")

    def test_twenty_twenty_rule_and_min_n_thresholds(self) -> None:
        def make_rows(n_pos: int, n_neg: int) -> list[dict]:
            out = []
            for i in range(n_pos):
                out.append({"cluster": f"P{i % 10}", "measured": 1.5 + 0.05 * i, "pred": 1.2 + 0.05 * i})
            for i in range(n_neg):
                out.append({"cluster": f"N{i % 10}", "measured": 0.2 - 0.05 * i, "pred": 0.1 - 0.05 * i})
            return out

        # < 20 total -> all stats None ("too few" / "too few to judge")
        s19 = summarize_regression(make_rows(10, 9), threshold_kcal=1.0, n_boot=200, seed=42)
        self.assertEqual(s19["n"], 19)
        self.assertEqual(s19["n_pos"], 10)
        self.assertEqual(s19["n_neg"], 9)
        self.assertIsNone(s19["spearman"])
        self.assertIsNone(s19["pearson"])
        self.assertIsNone(s19["rmse"])
        self.assertIsNone(s19["roc_auc"])
        self.assertEqual(_fmt_stat(s19, "spearman"), "too few")
        self.assertEqual(_fmt_stat(s19, "roc_auc"), "too few to judge")

        # >= 20 total (25) with 20 pos / 5 neg -> regression computed, ROC AUC None ("too few to judge")
        s25 = summarize_regression(make_rows(20, 5), threshold_kcal=1.0, n_boot=200, seed=42)
        self.assertIsNotNone(s25["spearman"])
        self.assertIsNotNone(s25["pearson"])
        self.assertIsNotNone(s25["rmse"])
        self.assertIsNone(s25["roc_auc"])
        self.assertEqual(_fmt_stat(s25, "roc_auc"), "too few to judge")

        # 40 total with 19 pos / 21 neg -> fails 20/20 rule for ROC AUC
        s19_21 = summarize_regression(make_rows(19, 21), threshold_kcal=1.0, n_boot=200, seed=42)
        self.assertIsNotNone(s19_21["pearson"])
        self.assertIsNone(s19_21["roc_auc"])
        self.assertEqual(_fmt_stat(s19_21, "roc_auc"), "too few to judge")

        # 40 total with 20 pos / 20 neg -> passes 20/20 rule, ROC AUC computed
        s20_20 = summarize_regression(make_rows(20, 20), threshold_kcal=1.0, n_boot=200, seed=42)
        self.assertIsNotNone(s20_20["roc_auc"])
        self.assertIsNotNone(s20_20["roc_auc"]["point"])

        # A7 verdict returns "too few to judge" when held-out has <20 pos or <20 neg
        fake_row = {
            "n_dataset": 30, "eligible": 30, "attempted": 30, "scored": 30,
            "n_groups": 10, "n_pos": 19, "n_neg": 11, "coverage": 1.0, "dataset_coverage": 1.0,
            "partial_set": False, "run_in_progress": False, "missing_total": 0, "missing_reasons": {},
            "stats": s19_21,
        }
        crit = _evaluate_criteria(
            "foldx",
            {"s669": {"all": fake_row, "heldout": fake_row}, "ssym_direct": {"all": fake_row, "heldout": fake_row}, "ssym_reverse": {"all": fake_row, "heldout": fake_row}},
            {"s669": {"n_examples": 5, "n_agree": 5}, "ssym_direct": {"n_examples": 5, "n_agree": 5}, "ssym_reverse": {"n_examples": 0, "n_agree": 0}},
        )
        self.assertEqual(crit["A7"], "too few to judge")

    def test_unmatched_protein_excluded_from_heldout(self) -> None:
        empty_prof = {"pdbs": set(), "uniprots": set(), "seqs": [], "m8": set()}
        for bad_up in ("", "   ", "NA", "None", "-"):
            ok, reason = check_heldout("1FH5", "H", bad_up, "MKTAYIAKQRQ", empty_prof)
            self.assertFalse(ok)
            self.assertEqual(reason, "no_uniprot_accession")

        ok_valid, reason_valid = check_heldout("1ABC", "A", "P12345", "MKTAYIAKQRQ", empty_prof)
        self.assertTrue(ok_valid)
        self.assertIsNone(reason_valid)

        # _eval_split with heldout_only=True excludes no_accession even if flagged otherwise
        ds_rows = [
            {
                "id": "1FH5H_S18N", "cluster": "1FH5_H", "no_accession": True, "measured": 1.5,
                "organism": "Homo sapiens", "heldout": {"foldx": {"heldout": False, "reason": "no_uniprot_accession"}},
            },
            {
                "id": "1ABCA_A1G", "cluster": "P12345", "no_accession": False, "measured": 2.0,
                "organism": "Homo sapiens", "heldout": {"foldx": {"heldout": True, "reason": None}},
            },
        ]
        preds = {
            "1FH5H_S18N": {"id": "1FH5H_S18N", "status": "ok", "raw_ddg": 1.2},
            "1ABCA_A1G": {"id": "1ABCA_A1G", "status": "ok", "raw_ddg": 1.8},
        }
        ho_eval = _eval_split("foldx", "s669", ds_rows, preds, heldout_only=True)
        self.assertEqual(ho_eval["n_dataset"], 1)
        self.assertEqual(ho_eval["scored"], 1)


if __name__ == "__main__":
    unittest.main()
