"""Unit tests for Phase 5a primary predictor benchmark & CSpec parser (TDD)."""
from __future__ import annotations

import datetime as dt
import re
import unittest
from pathlib import Path

from scripts.primary_predictor_benchmark import metrics as m


REPO_ROOT = Path(__file__).resolve().parents[2]


class CalibrationParityTests(unittest.TestCase):
    def test_bands_match_calibration_ts_verbatim(self) -> None:
        ts_path = REPO_ROOT / "src" / "shared" / "thresholds" / "calibration.ts"
        src = ts_path.read_text(encoding="utf-8")

        def extract_block(key: str) -> str:
            pat = re.compile(rf"\b{key}:\s*\{{(.*?)\n  \}},", re.DOTALL)
            match = pat.search(src)
            self.assertIsNotNone(match, f"Missing block for {key} in calibration.ts")
            return match.group(1)

        ts_to_py = {
            "revel": "revel",
            "bayesdel": "bayesdel",
            "alphaMissense": "alphamissense",
            "esm1b": "esm1b",
        }
        for ts_key, py_key in ts_to_py.items():
            block = extract_block(ts_key)
            ori_match = re.search(r'orientation:\s*"(higher|lower)"', block)
            self.assertIsNotNone(ori_match)
            self.assertEqual(
                m.CALIBRATION_BANDS[py_key]["orientation"], ori_match.group(1)
            )
            for side in ("pp3", "bp4"):
                side_match = re.search(rf"{side}:\s*\{{([^}}]*)\}}", block)
                self.assertIsNotNone(side_match)
                pairs = re.findall(r"(\w+):\s*([-0-9.]+)", side_match.group(1))
                parsed = {k: float(v) for k, v in pairs}
                self.assertEqual(
                    m.CALIBRATION_BANDS[py_key][side],
                    parsed,
                    f"Threshold drift for {py_key}.{side}",
                )

    def test_calibrated_call_boundaries_and_esm1b_gaps(self) -> None:
        # REVEL
        self.assertEqual(m.calibrated_call("revel", 0.932)[2], "PP3_Strong")
        self.assertEqual(m.calibrated_call("revel", 0.9319)[2], "PP3_Moderate")
        self.assertEqual(m.calibrated_call("revel", 0.773)[2], "PP3_Moderate")
        self.assertEqual(m.calibrated_call("revel", 0.644)[2], "PP3")
        self.assertEqual(m.calibrated_call("revel", 0.500)[2], "Indeterminate")
        self.assertEqual(m.calibrated_call("revel", 0.290)[2], "BP4")
        self.assertEqual(m.calibrated_call("revel", 0.183)[2], "BP4_Moderate")
        self.assertEqual(m.calibrated_call("revel", 0.016)[2], "BP4_Strong")
        self.assertEqual(m.calibrated_call("revel", 0.003)[2], "BP4_VeryStrong")
        self.assertEqual(m.calibrated_call("revel", None)[2], "Missing")
        self.assertEqual(m.calibrated_call("revel", float("nan"))[2], "Missing")

        # BayesDel noAF
        self.assertEqual(m.calibrated_call("bayesdel", 0.50)[2], "PP3_Strong")
        self.assertEqual(m.calibrated_call("bayesdel", 0.27)[2], "PP3_Moderate")
        self.assertEqual(m.calibrated_call("bayesdel", 0.13)[2], "PP3")
        self.assertEqual(m.calibrated_call("bayesdel", -0.18)[2], "BP4")
        self.assertEqual(m.calibrated_call("bayesdel", -0.36)[2], "BP4_Moderate")

        # AlphaMissense
        self.assertEqual(m.calibrated_call("alphamissense", 0.990)[2], "PP3_Strong")
        self.assertEqual(m.calibrated_call("alphamissense", 0.906)[2], "PP3_Moderate")
        self.assertEqual(m.calibrated_call("alphamissense", 0.792)[2], "PP3")
        self.assertEqual(m.calibrated_call("alphamissense", 0.169)[2], "BP4")
        self.assertEqual(m.calibrated_call("alphamissense", 0.099)[2], "BP4_Moderate")

        # ESM1b (lower is pathogenic, decimal gaps fall to Indeterminate)
        self.assertEqual(m.calibrated_call("esm1b", -24.0)[2], "PP3_Strong")
        self.assertEqual(m.calibrated_call("esm1b", -12.2)[2], "PP3_Moderate")
        self.assertEqual(m.calibrated_call("esm1b", -10.7)[2], "PP3")
        self.assertEqual(m.calibrated_call("esm1b", -10.65)[2], "Indeterminate")
        self.assertEqual(m.calibrated_call("esm1b", -6.3)[2], "BP4")
        self.assertEqual(m.calibrated_call("esm1b", -3.1)[2], "BP4_Moderate")


class ClinVarAndTemporalHoldoutTests(unittest.TestCase):
    def test_missense_parser(self) -> None:
        self.assertEqual(
            m.parse_missense_protein_change("NM_000546.6(TP53):c.524G>A (p.Arg175His)"),
            ("R", 175, "H"),
        )
        # Reject nonsense, start-loss, synonymous, frameshift, in-frame indel
        self.assertIsNone(
            m.parse_missense_protein_change("NM_000546.6(TP53):c.637C>T (p.Arg213Ter)")
        )
        self.assertIsNone(
            m.parse_missense_protein_change("NM_000546.6(TP53):c.1A>G (p.Met1Val)")
        )
        self.assertIsNone(
            m.parse_missense_protein_change("NM_000546.6(TP53):c.639A>G (p.Arg213=)")
        )
        self.assertIsNone(
            m.parse_missense_protein_change("NM_000546.6(TP53):c.524del (p.Arg175fs)")
        )

    def test_vcf_clnsig_both_numeric_and_text(self) -> None:
        self.assertTrue(m.parse_vcf_clnsig_is_classified("ALLELEID=1;CLNSIG=Pathogenic;ORIGIN=1"))
        self.assertTrue(
            m.parse_vcf_clnsig_is_classified("CLNSIG=Pathogenic/Likely_pathogenic")
        )
        self.assertTrue(m.parse_vcf_clnsig_is_classified("CLNSIG=Likely_benign"))
        self.assertTrue(m.parse_vcf_clnsig_is_classified("CLNSIG=5"))
        self.assertTrue(m.parse_vcf_clnsig_is_classified("CLNSIG=2|3"))
        self.assertFalse(m.parse_vcf_clnsig_is_classified("CLNSIG=Uncertain_significance"))
        self.assertFalse(
            m.parse_vcf_clnsig_is_classified("CLNSIG=Conflicting_interpretations_of_pathogenicity")
        )
        self.assertFalse(m.parse_vcf_clnsig_is_classified("CLNSIG=0"))

    def test_temporal_holdout_filters(self) -> None:
        hist_coords = {("17", 7675088, "C", "T")}
        hist_ids = {"12345"}
        cutoff = dt.date(2023, 12, 31)
        # Excluded via coordinate match in snapshot
        self.assertFalse(
            m.is_post_cutoff_variant(
                ("17", 7675088, "C", "T"),
                "99999",
                hist_coords,
                hist_ids,
                dt.date(2025, 2, 1),
                cutoff,
            )
        )
        # Excluded via VariationID match in snapshot
        self.assertFalse(
            m.is_post_cutoff_variant(
                ("1", 1000, "A", "G"),
                "12345",
                hist_coords,
                hist_ids,
                dt.date(2025, 2, 1),
                cutoff,
            )
        )
        # Excluded via pre-cutoff SCV DateLastEvaluated
        self.assertFalse(
            m.is_post_cutoff_variant(
                ("1", 2000, "A", "G"),
                "55555",
                hist_coords,
                hist_ids,
                dt.date(2023, 12, 31),
                cutoff,
            )
        )
        # Included when absent from snapshot and first evaluated after cutoff
        self.assertTrue(
            m.is_post_cutoff_variant(
                ("1", 2000, "A", "G"),
                "55555",
                hist_coords,
                hist_ids,
                dt.date(2024, 1, 1),
                cutoff,
            )
        )

    def test_dbnsfp_row_disambiguation(self) -> None:
        rows = [
            {"gene": "GENE1", "aaref": "R", "aaalt": "H", "pos": 100, "transcript_basis": "mane"},
            {"gene": "GENE2", "aaref": "A", "aaalt": "T", "pos": 50, "transcript_basis": "mane"},
        ]
        row, status = m.select_dbnsfp_row(rows, ("GENE2",), "A", "T")
        self.assertEqual(status, "matched")
        self.assertEqual(row["gene"], "GENE2")

        _, amb_status = m.select_dbnsfp_row(rows, ("OTHER",), "Q", "P")
        self.assertEqual(amb_status, "ambiguous_gene")


class AlphaFoldAndSubgroupTests(unittest.TestCase):
    def test_alphafold_fragment_mapping_and_verification(self) -> None:
        # Fragment 1 covers 1..1400 (midpoint 700), Fragment 2 covers 201..1600 (midpoint 900)
        fragments = {
            1: {500: ("K", 85.0), 850: ("R", 40.0)},
            2: {650: ("R", 42.0), 1000: ("D", 91.2)},
        }
        # Position 850 is closer to F1 midpoint (700, dist 150) than F2 midpoint (900, dist 50) -> picks F2!
        plddt, status = m.resolve_alphafold_plddt(fragments, 850, "R")
        self.assertEqual(status, "ok")
        self.assertEqual(plddt, 42.0)

        # Position 1200 only in F2 (local pos 1000)
        plddt2, status2 = m.resolve_alphafold_plddt(fragments, 1200, "D")
        self.assertEqual(status2, "ok")
        self.assertEqual(plddt2, 91.2)

        # Amino acid mismatch rejected
        plddt_bad, status_bad = m.resolve_alphafold_plddt(fragments, 1200, "E")
        self.assertIsNone(plddt_bad)
        self.assertEqual(status_bad, "aa_mismatch")

    def test_g2p_mechanism_sets(self) -> None:
        payload = {
            "genes": {
                "FGFR3": [
                    {"gene": "FGFR3", "confidence": "definitive", "mechanism": "gain of function"},
                ],
                "TP53": [
                    {"gene": "TP53", "confidence": "definitive", "mechanism": "loss of function"},
                    {"gene": "TP53", "confidence": "strong", "mechanism": "dominant negative"},
                ],
                "DUAL": [
                    {"gene": "DUAL", "confidence": "definitive", "mechanism": "gain of function"},
                    {"gene": "DUAL", "confidence": "strong", "mechanism": "loss of function"},
                ],
                "WEAK": [
                    {"gene": "WEAK", "confidence": "limited", "mechanism": "gain of function"},
                ],
            }
        }
        sets = m.extract_g2p_mechanism_sets(payload)
        self.assertEqual(sets["gof_exclusive"], {"FGFR3"})
        self.assertEqual(sets["gof_any"], {"FGFR3", "DUAL"})
        self.assertEqual(sets["lof_only"], set())
        self.assertEqual(sets["dn_any"], {"TP53"})


class SelectionAndDisagreementTests(unittest.TestCase):
    def _make_variant(self, gene: str, y: int, calls: dict[str, str], in_db: bool = True):
        return {"gene": gene, "y": y, "in_dbnsfp": in_db, "calls": calls}

    def test_bootstrap_determinism_and_pareto_selection(self) -> None:
        variants = []
        for g_idx in range(25):
            g = f"G{g_idx}"
            # REVEL strictly dominates Moderate+ in both directions; BayesDel only reaches Moderate+ on 4/5
            bd_p = "PP3_Moderate" if g_idx % 5 != 0 else "PP3"
            bd_b = "BP4_Moderate" if g_idx % 5 != 0 else "BP4"
            variants.append(
                self._make_variant(
                    g,
                    1,
                    {
                        "revel": "PP3_Strong",
                        "bayesdel": bd_p,
                        "alphamissense": "PP3",
                        "esm1b": "Indeterminate",
                    },
                )
            )
            variants.append(
                self._make_variant(
                    g,
                    0,
                    {
                        "revel": "BP4_Strong",
                        "bayesdel": bd_b,
                        "alphamissense": "BP4",
                        "esm1b": "BP4",
                    },
                )
            )

        s1 = m.summarize_variants(variants, reps=200, seed=20261124)
        s2 = m.summarize_variants(variants, reps=200, seed=20261124)
        self.assertEqual(s1["cis"], s2["cis"])
        self.assertEqual(s1["tools"]["revel"]["h_mod"], 1.0)
        self.assertEqual(s1["tools"]["alphamissense"]["h_mod"], 0.0)

        sel = m.evaluate_selection_rule(s1, {"ordered": s1})
        self.assertEqual(sel["primary"], "revel")
        self.assertEqual(sel["selection_basis"], "pareto_dominant")
        self.assertEqual(sel["fallback_order"][:2], ["revel", "bayesdel"])

    def test_subgroup_wrong_direction_gate_flags_strict_outlier(self) -> None:
        clean_variants = []
        sub_variants = []
        for g_idx in range(30):
            g = f"G{g_idx}"
            clean_variants.append(
                self._make_variant(
                    g,
                    1,
                    {
                        "revel": "PP3_Moderate",
                        "bayesdel": "PP3_Moderate",
                        "alphamissense": "PP3_Strong",
                        "esm1b": "PP3_Moderate",
                    },
                )
            )
            clean_variants.append(
                self._make_variant(
                    g,
                    0,
                    {
                        "revel": "BP4_Moderate",
                        "bayesdel": "BP4_Moderate",
                        "alphamissense": "BP4_Moderate",
                        "esm1b": "BP4_Moderate",
                    },
                )
            )
            # In subgroup `gof`, AlphaMissense calls pathogenic on ALL benign variants (W_bal = 0.50)
            sub_variants.append(
                self._make_variant(
                    g,
                    1,
                    {
                        "revel": "PP3_Moderate",
                        "bayesdel": "PP3_Moderate",
                        "alphamissense": "PP3_Strong",
                        "esm1b": "PP3_Moderate",
                    },
                )
            )
            sub_variants.append(
                self._make_variant(
                    g,
                    0,
                    {
                        "revel": "BP4_Moderate",
                        "bayesdel": "BP4_Moderate",
                        "alphamissense": "PP3_Moderate",
                        "esm1b": "BP4_Moderate",
                    },
                )
            )

        primary_sum = m.summarize_variants(clean_variants, reps=200, seed=20261124)
        sub_sum = m.summarize_variants(sub_variants, reps=200, seed=20261124)
        sel = m.evaluate_selection_rule(primary_sum, {"gof": sub_sum})
        self.assertIn("alphamissense", sel["flagged_tools"])
        self.assertNotIn("alphamissense", sel["eligible_tools"])
        self.assertEqual(sel["fallback_order"][-1], "alphamissense")

    def test_fallback_and_disagreement_audit(self) -> None:
        variants = [
            # Primary (revel) hits PP3_Moderate, AM agrees
            self._make_variant(
                "G1", 1, {"revel": "PP3_Moderate", "bayesdel": "PP3", "alphamissense": "PP3", "esm1b": "Missing"}
            ),
            # Primary (revel) misses, fallback bayesdel hits PP3_Moderate, ESM1b disagrees (BP4)
            self._make_variant(
                "G2", 1, {"revel": "Missing", "bayesdel": "PP3_Moderate", "alphamissense": "Indeterminate", "esm1b": "BP4"}
            ),
            # Primary (revel) calls wrong direction BP4 on P/LP, AM calls PP3 (disagrees)
            self._make_variant(
                "G3", 1, {"revel": "BP4", "bayesdel": "Indeterminate", "alphamissense": "PP3_Strong", "esm1b": "Missing"}
            ),
        ]
        audit = m.audit_fallback_and_disagreement(
            variants, ["revel", "bayesdel", "alphamissense", "esm1b"]
        )
        self.assertEqual(audit["tier_counts"]["revel"], 2)
        self.assertEqual(audit["tier_counts"]["bayesdel"], 1)
        self.assertEqual(audit["still_missing"], 0)
        self.assertEqual(audit["active_pp3_or_bp4"], 3)
        self.assertEqual(audit["disagree_when_correct"], 1)
        self.assertEqual(audit["disagree_when_wrong"], 1)


class CSpecParserTests(unittest.TestCase):
    def test_cspec_released_vs_legacy(self) -> None:
        released_doc = {
            "@id": "https://cspec.genome.network/cspec/api/SequenceVariantInterpretation/id/GN006",
            "label": "ClinGen RASopathy VCEP",
            "version": "2.2.0",
            "currentStatus": "Released",
            "legacy": False,
            "legacyReplaced": False,
            "affiliation": {"label": "RASopathy VCEP"},
            "ruleSets": [
                {
                    "genes": [{"label": "BRAF"}, {"label": "PTPN11"}],
                    "criteriaCodes": [
                        {
                            "label": "PP3",
                            "description": "Computational evidence",
                            "evidenceStrengths": [
                                {
                                    "label": "Supporting",
                                    "applicability": "Applicable",
                                    "description": "REVEL >= 0.70 or SpliceAI > 0.2",
                                },
                                {
                                    "label": "Strong",
                                    "applicability": "Not applicable",
                                    "description": "",
                                },
                            ],
                        }
                    ],
                }
            ],
        }
        parsed = m.parse_cspec_svi_record(released_doc)
        self.assertTrue(parsed["is_active_released"])
        self.assertEqual(parsed["genes"], ["BRAF", "PTPN11"])
        self.assertEqual(parsed["tools_mentioned"], ["REVEL", "SpliceAI"])
        self.assertEqual(parsed["pp3_applicable"], ["Supporting"])

        legacy_doc = dict(released_doc, legacy=True)
        self.assertFalse(m.parse_cspec_svi_record(legacy_doc)["is_active_released"])


if __name__ == "__main__":
    unittest.main()
