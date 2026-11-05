"""Models checked against what their authors publish, not against what we expect.

A silently missing layer kept ThermoMPNN loading, answering and passing every test while it gave near-constant values
(SD 0.19 kcal/mol on S669, r 0.19 against lab measurements). A test that only checks that a model answers cannot see that,
so these compare outputs with the authors' own published numbers or documented method.
"""
import csv
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    import torch
except ImportError:
    torch = None

ROOT = os.path.abspath(os.path.dirname(__file__))
# Set in CI. There a missing checkpoint must fail, because a skipped check cannot catch a silently broken model.
REQUIRE_WEIGHTS = os.environ.get("REQUIRE_MODEL_WEIGHTS") == "1"
EXAMPLES = os.path.join(ROOT, "thermompnn", "examples")
WEIGHTS = os.path.join(ROOT, "thermompnn", "models", "thermoMPNN_default.pt")


@unittest.skipUnless(REQUIRE_WEIGHTS or (torch is not None and os.path.exists(WEIGHTS)), "needs torch and the ThermoMPNN weights")
class ThermoMpnnMatchesUpstream(unittest.TestCase):
    def test_reproduces_the_authors_published_2ocj_predictions(self):
        from tools.model_server_app.routers.thermompnn import ThermoMpnnRequest, predict_thermompnn_sync

        with open(os.path.join(EXAMPLES, "2OCJ.pdb"), encoding="utf-8") as fh:
            pdb = "".join(line for line in fh if line.startswith("ATOM") and line[21] == "A")
        numbers, seen = [], set()
        for line in pdb.splitlines():
            if line[12:16].strip() == "CA" and line[22:27] not in seen:
                seen.add(line[22:27])
                numbers.append(int(line[22:26]))
        with open(os.path.join(EXAMPLES, "ThermoMPNN_inference_2OCJ.csv"), encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))

        for row in rows[::500]:
            mutation = f"{row['wildtype']}A{numbers[int(row['position'])]}{row['mutation']}"
            result = predict_thermompnn_sync(ThermoMpnnRequest(pdb_content=pdb, mutation=mutation, chain="A"))
            self.assertAlmostEqual(result["ddG"], float(row["ddG_pred"]), delta=0.002, msg=mutation)

    def test_refuses_a_checkpoint_that_does_not_match_the_model_exactly(self):
        from tools.model_server_app.routers import thermompnn as T

        real_load = torch.load

        def drop_a_layer(*args, **kwargs):
            checkpoint = real_load(*args, **kwargs)
            state = checkpoint.get("state_dict", checkpoint)
            for key in [k for k in state if "light_attention" in k]:
                del state[key]
            return checkpoint

        with mock.patch.object(T, "_official_model", None), mock.patch.object(T, "_model_loaded", False), mock.patch.object(T, "_model_load_error", None), mock.patch.object(torch, "load", drop_a_layer):
            self.assertIsNone(T.get_official_model())
            self.assertIn("does not match", T._model_load_error)


STABILITY_ORACLE_WEIGHTS = os.path.join(ROOT, "model_server_app", "checkpoints", "stability_oracle_cdna117k.pt")


@unittest.skipUnless(REQUIRE_WEIGHTS or (torch is not None and os.path.exists(STABILITY_ORACLE_WEIGHTS)), "needs torch and the StabilityOracle weights")
class StabilityOracleFollowsItsAuthors(unittest.TestCase):
    """
    The authors' published predictions for p53 on 2OCJ (their data/predictions/SO/p53.csv).

    Not an exact match by design: their charge method is not identified, so the recipe reaches about r 0.8 on variants it was not
    built from. This pins the two things that were wrong and invisible: the sign and scale of the value, and the inputs. With the
    previous inputs, the same comparison gave a negative correlation.
    """

    PUBLISHED = {
        "Q104H": 0.119, "T123A": 0.025, "F134L": 0.794, "A129S": -0.032, "T150P": 0.070, "D148E": 0.018, "H168R": 0.641,
        "Q165K": 0.046, "R175H": 1.088, "L206S": 0.793, "I195T": 1.640, "M237I": 0.198, "D228E": -0.081, "R249S": 0.771,
    }

    def test_tracks_the_published_values_with_the_published_sign_and_scale(self):
        import numpy as np
        from tools.model_server_app.routers.stabilityoracle import StabilityOracleRequest, predict_stabilityoracle_sync

        with open(os.path.join(EXAMPLES, "2OCJ.pdb"), encoding="utf-8") as fh:
            pdb = fh.read()
        ours, published = [], []
        for mutation, value in self.PUBLISHED.items():
            request = StabilityOracleRequest(sequence="", position=int(mutation[1:-1]), wt=mutation[0], mut=mutation[-1], wtPdb=pdb, chain="A")
            ours.append(predict_stabilityoracle_sync(request)["ddG"])
            published.append(value)
        ours, published = np.array(ours), np.array(published)
        self.assertGreater(np.corrcoef(ours, published)[0, 1], 0.7)
        self.assertLess(np.abs(ours - published).mean(), 0.35)
        # R175H is a known destabilizing p53 mutation: positive means destabilizing, as everywhere in the app.
        self.assertGreater(ours[list(self.PUBLISHED).index("R175H")], 0.5)


@unittest.skipUnless(torch is not None, "needs torch")
class VesmScoresAsItsAuthorsDocument(unittest.TestCase):
    def test_reads_the_residue_from_the_unmasked_wild_type_sequence(self):
        from tools.model_server_app import models
        from tools.model_server_app.routers import vesm

        sequence = "MKTAY"
        calls = []

        class Tokenizer:
            mask_token = "<mask>"

            def __call__(self, text, return_tensors=None):
                calls.append(text)
                return {"input_ids": torch.zeros((1, len(text) + 2), dtype=torch.long)}

        class Output:
            logits = torch.arange(7 * 33, dtype=torch.float32).reshape(1, 7, 33)

        with mock.patch.object(models, "vesm_tokenizer", Tokenizer()), mock.patch.object(models, "vesm_model", lambda **_: Output()), mock.patch.object(vesm, "_ensure_vesm_loaded", lambda: None):
            logits = vesm._compute_sequence_logits(sequence)

        self.assertEqual(calls, [sequence])
        self.assertNotIn("<mask>", calls[0])
        self.assertEqual(tuple(logits.shape), (7, 33))


if __name__ == "__main__":
    unittest.main()
