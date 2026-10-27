"""python -I -m unittest discover -s scripts/tolerance_benchmark -p test_metrics.py"""
import itertools
import random
import unittest

from metrics import auprc, auroc, codon_background, decile_edges, decile_of, lr_positive, mosy, odds_ratio, tolerance_landscape, window
from sources import CODON, classify_clinvar, translate

# metadome/domain/metrics/codon_statistics.py codon_background_rates, (missense, synonymous), release e8ec9a8.
METADOME_BG = {
    "AAA": (7, 1), "AAC": (8, 1), "AAG": (7, 1), "AAT": (8, 1), "ACA": (6, 3), "ACC": (6, 3), "ACG": (6, 3), "ACT": (6, 3),
    "AGA": (6, 2), "AGC": (8, 1), "AGG": (7, 2), "AGT": (8, 1), "ATA": (7, 2), "ATC": (7, 2), "ATG": (9, 0), "ATT": (7, 2),
    "CAA": (7, 1), "CAC": (8, 1), "CAG": (7, 1), "CAT": (8, 1), "CCA": (6, 3), "CCC": (6, 3), "CCG": (6, 3), "CCT": (6, 3),
    "CGA": (4, 4), "CGC": (6, 3), "CGG": (5, 4), "CGT": (6, 3), "CTA": (5, 4), "CTC": (6, 3), "CTG": (5, 4), "CTT": (6, 3),
    "GAA": (7, 1), "GAC": (8, 1), "GAG": (7, 1), "GAT": (8, 1), "GCA": (6, 3), "GCC": (6, 3), "GCG": (6, 3), "GCT": (6, 3),
    "GGA": (5, 3), "GGC": (6, 3), "GGG": (6, 3), "GGT": (6, 3), "GTA": (6, 3), "GTC": (6, 3), "GTG": (6, 3), "GTT": (6, 3),
    "TAA": (0, 2), "TAC": (6, 1), "TAG": (0, 1), "TAT": (6, 1), "TCA": (4, 3), "TCC": (6, 3), "TCG": (5, 3), "TCT": (6, 3),
    "TGA": (0, 1), "TGC": (7, 1), "TGG": (7, 0), "TGT": (7, 1), "TTA": (5, 2), "TTC": (8, 1), "TTG": (6, 2), "TTT": (8, 1),
}


class MetaDomeFormula(unittest.TestCase):
    def test_codon_background_matches_published_table_for_all_64_codons(self):
        for codon, expected in METADOME_BG.items():
            self.assertEqual(codon_background(codon, CODON), expected, codon)

    def test_mosy_is_metadome_background_corrected_ratio(self):
        self.assertAlmostEqual(mosy(3, 60, 1, 20), ((3 + 1) / 61) / ((1 + 1) / 21))

    def test_window_truncates_at_both_ends_like_create_sliding_window(self):
        self.assertEqual(window(0, 154, 10), (0, 11))
        self.assertEqual(window(153, 154, 10), (143, 154))
        self.assertEqual(window(50, 154, 10), (40, 61))

    def test_landscape_of_empty_counts_is_background_ratio(self):
        s = tolerance_landscape([0] * 30, [0] * 30, [6] * 30, [3] * 30, half=10)
        self.assertAlmostEqual(s[15], (1 / 127) / (1 / 64))


class Discrimination(unittest.TestCase):
    def brute_auroc(self, p, n):
        return sum(1 if a > b else 0.5 if a == b else 0 for a, b in itertools.product(p, n)) / (len(p) * len(n))

    def test_auroc_matches_pairwise_count_with_ties(self):
        rng = random.Random(1)
        for _ in range(50):
            p = [rng.randint(0, 5) for _ in range(rng.randint(1, 12))]
            n = [rng.randint(0, 5) for _ in range(rng.randint(1, 12))]
            self.assertAlmostEqual(auroc(p, n), self.brute_auroc(p, n))

    def test_auprc_perfect_and_tied(self):
        self.assertAlmostEqual(auprc([3, 4], [1, 2]), 1.0)
        self.assertAlmostEqual(auprc([1, 1], [1, 1]), 0.5)

    def test_odds_ratio_haldane_on_zero_cell(self):
        orr, lo, hi = odds_ratio(5, 0, 5, 10)
        self.assertAlmostEqual(orr, (5.5 * 10.5) / (0.5 * 5.5))
        self.assertLess(lo, orr)
        self.assertGreater(hi, orr)

    def test_lr_positive(self):
        lr, lo, hi = lr_positive(20, 10, 100, 200)
        self.assertAlmostEqual(lr, 4.0)
        self.assertTrue(lo < 4.0 < hi)

    def test_deciles_put_top_tenth_in_decile_10(self):
        vals = list(range(100))
        e = decile_edges(vals)
        self.assertEqual(decile_of(0, e), 1)
        self.assertEqual(decile_of(95, e), 10)
        self.assertEqual(sum(1 for v in vals if decile_of(v, e) == 10), 10)


class Sources(unittest.TestCase):
    def test_translate_and_clinvar_reading(self):
        self.assertEqual(translate("ATGGCGACGAAGTAA"), "MATK*")
        self.assertEqual(classify_clinvar("Conflicting classifications of pathogenicity"), "other")
        self.assertEqual(classify_clinvar("Pathogenic/Likely pathogenic"), "plp")
        self.assertEqual(classify_clinvar("Likely benign"), "blb")
        self.assertEqual(classify_clinvar("Uncertain significance"), "other")


if __name__ == "__main__":
    unittest.main()
