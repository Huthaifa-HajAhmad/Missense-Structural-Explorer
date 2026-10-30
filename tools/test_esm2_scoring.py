"""
ESM-2 scoring contract, without network or weights.

The fake model copies whatever residue it can see and puts its peak on Cys only where the residue is
masked, so a reading taken from the unmasked pass (the old local defect) prefers the native Ser and
fails these tests.
"""
import math
import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import torch

from tools.model_server_app import models
from tools.model_server_app.engine_resilience import InvalidProviderResponse, classify_remote_failure, with_remote_failure
from tools.model_server_app.routers import esm2, esm3, saprot, vesm
from tools.model_server_app.routers.esm2 import Esm2Request, predict_esm2_3b_sync, run_esm2_remote
from tools.model_server_app.utils import AA_LIST, compute_scientific_metrics, validate_saprot_tokenization

MASK_ID = 31
SEQUENCE = "MKTAYSLLGW"  # Ser6
PEAK = "C"


class FakeTokenizer:
    mask_token = "<mask>"
    mask_token_id = MASK_ID

    def convert_tokens_to_ids(self, aa):
        return 4 + AA_LIST.index(aa)

    def __call__(self, seq, return_tensors="pt"):
        ids, i = [0], 0
        while i < len(seq):
            if seq.startswith("<mask>", i):
                ids.append(MASK_ID)
                i += len("<mask>")
            else:
                ids.append(self.convert_tokens_to_ids(seq[i]))
                i += 1
        ids.append(2)
        return {"input_ids": torch.tensor([ids]), "attention_mask": torch.ones(1, len(ids), dtype=torch.long)}


class FakeLm:
    def __init__(self):
        self.calls = []

    def parameters(self):
        return iter([torch.zeros(1)])

    def __call__(self, input_ids, attention_mask=None, output_hidden_states=False):
        self.calls.append(input_ids.clone())
        length = input_ids.shape[1]
        logits = torch.zeros(1, length, 33)
        for j, token in enumerate(input_ids[0].tolist()):
            logits[0, j, 4 + AA_LIST.index(PEAK) if token == MASK_ID else token] = 8.0
        hidden = torch.nn.functional.one_hot(input_ids[0], 33).float().unsqueeze(0) + 0.1
        return SimpleNamespace(logits=logits, hidden_states=[hidden])


class LocalEsm2Tests(unittest.TestCase):
    def setUp(self):
        esm2.clear_esm2_caches()
        self.model = FakeLm()
        patches = [
            patch.object(esm2.torch.cuda, "is_available", return_value=False),
            patch.object(esm2.models, "get_esm2_model", return_value=(FakeTokenizer(), self.model)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_preferences_come_from_the_masked_site(self):
        result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C"))
        self.assertEqual(result["preferences"][0]["aa"], PEAK)
        self.assertEqual(result["mutRank"], 1)
        self.assertGreater(result["llr"], 0)  # log P(Cys) − log P(Ser): the variant is preferred
        self.assertGreater(result["mutProbability"], result["wtProbability"])
        self.assertEqual(self.model.calls[0][0, 6].item(), MASK_ID)

    def test_embedding_shift_reads_the_unmasked_alleles(self):
        result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C"))
        unmasked = [c for c in self.model.calls if MASK_ID not in c[0].tolist()]
        self.assertEqual(len(unmasked), 2)
        self.assertEqual({c[0, 6].item() for c in unmasked}, {4 + AA_LIST.index("S"), 4 + AA_LIST.index("C")})
        self.assertGreater(result["embeddingShift"], 0)
        by_position = {d["position"]: d["shift"] for d in result["localShiftMap"]}
        self.assertEqual(sorted(by_position), list(range(1, 11)))
        self.assertEqual(by_position[5], 0)

    def test_records_the_checkpoint_method_and_host(self):
        result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C"))
        self.assertEqual(result["checkpoint"], models.ESM2_CPU_MODEL)
        self.assertEqual(result["scoringMethod"], "masked-marginal")
        self.assertEqual(result["provenance"], "ESM-2 (esm2_t33_650M_UR50D - Local CPU)")
        self.assertIsNone(result["klDivergence"])
        self.assertIsNone(result["remoteFailure"])

    def test_a_spent_budget_keeps_the_score_and_names_the_skipped_trace(self):
        result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C"), deadline=time.monotonic() - 1)
        self.assertEqual(len(self.model.calls), 1)
        self.assertEqual(result["preferences"][0]["aa"], PEAK)
        self.assertIsNone(result["embeddingShift"])
        self.assertEqual(result["localShiftMap"], [])
        self.assertIn("not computed", result["embeddingNote"])

    def test_another_allele_at_the_site_reuses_the_masked_and_wild_type_passes(self):
        predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C"))
        self.model.calls.clear()
        predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="A"))
        self.assertEqual(len(self.model.calls), 1)

    def test_positions_are_in_full_protein_numbering_after_a_crop(self):
        long_sequence = "A" * 1500 + SEQUENCE
        result = predict_esm2_3b_sync(Esm2Request(sequence=long_sequence, position=1506, wt="S", mut="C"))
        self.assertIn(1506, {d["position"] for d in result["localShiftMap"]})
        self.assertEqual(result["preferences"][0]["aa"], PEAK)

    def test_a_refused_remote_is_classified_and_genuine_esm2_still_serves(self):
        refusal = RuntimeError("402 Client Error: Payment Required")
        with patch.object(esm2.remote_failures, "blocked_reason", return_value=None), \
             patch.object(esm2.remote_failures, "record", return_value="HTTP 402 - inference credits exhausted"), \
             patch.object(esm2, "run_esm2_remote", side_effect=refusal):
            result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C", hfToken="t"))
        self.assertEqual(result["remoteFailure"], {"provider": "huggingface", "code": "billing"})
        self.assertTrue(result["provenance"].startswith("ESM-2 ("))
        self.assertIn("402", result["remoteEngineNote"])

    def test_vesm_serves_only_when_genuine_esm2_cannot_load(self):
        vesm_result = {"status": "success", "llr": 1.0, "provenance": "VESM-150M (Local)"}
        with patch.object(esm2.models, "get_esm2_model", side_effect=OSError("weights unavailable")), \
             patch.object(esm2, "predict_vesm_sync", return_value=vesm_result):
            result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C"))
        self.assertEqual(result["provenance"], "VESM-150M (Local Fallback)")
        self.assertIn("esm2_t33_650M_UR50D: OSError: weights unavailable", result["fallbackReason"])

    def test_the_hosted_try_runs_on_a_clock_and_genuine_esm2_still_serves(self):
        slow = lambda *args: time.sleep(0.5)
        with patch.dict(os.environ, {"ESM2_REMOTE_BUDGET_S": "0.05"}), \
             patch.object(esm2, "run_esm2_remote", side_effect=slow):
            result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C", hfToken="slow-token"))
        self.assertEqual(result["remoteFailure"], {"provider": "huggingface", "code": "timeout"})
        self.assertTrue(result["provenance"].startswith("ESM-2 ("))

    def test_a_request_that_waited_too_long_skips_the_hosted_try(self):
        hosted = MagicMock()
        with patch.object(esm2, "run_esm2_remote", hosted):
            result = predict_esm2_3b_sync(
                Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C", hfToken="late-token"), deadline=time.monotonic() + 10
            )
        hosted.assert_not_called()
        self.assertEqual(result["remoteFailure"]["code"], "timeout")
        self.assertTrue(result["provenance"].startswith("ESM-2 ("))

    def test_vesm_serves_while_the_weights_are_still_downloading(self):
        vesm_result = {"status": "success", "llr": 1.0, "provenance": "VESM-150M (Local)"}
        with patch.dict(models.model_status, {"esm2": "preparing"}), \
             patch.object(esm2, "predict_vesm_sync", return_value=vesm_result):
            result = predict_esm2_3b_sync(Esm2Request(sequence=SEQUENCE, position=6, wt="S", mut="C"))
        self.assertEqual(result["provenance"], "VESM-150M (Local Fallback)")
        self.assertIn("still being downloaded", result["fallbackReason"])
        self.assertEqual(len(self.model.calls), 0)


def fill_mask_client(scores):
    client = MagicMock()
    client.fill_mask.return_value = [{"token_str": aa, "score": s} for aa, s in scores.items()]
    client.feature_extraction.side_effect = RuntimeError("unsupported")
    return client


class RemoteDistributionTests(unittest.TestCase):
    def run_remote(self, scores):
        with patch("huggingface_hub.InferenceClient", return_value=fill_mask_client(scores)) as factory:
            result = run_esm2_remote("test", "MSA", 2, "S", "C", "test-token")
        return result, factory.return_value

    def test_an_incomplete_or_invalid_distribution_is_refused(self):
        uniform = {aa: 0.05 for aa in AA_LIST}
        for broken in (
            {"S": 0.9},
            {**uniform, "C": -0.1},
            {**uniform, "C": math.nan},
            {**uniform, "C": math.inf},
            {aa: 0.0 for aa in AA_LIST},
        ):
            with self.subTest(broken=list(broken.items())[:2]), self.assertRaises(InvalidProviderResponse):
                self.run_remote(broken)

    def test_the_variant_preferred_reads_positive_and_ranks_first(self):
        result, client = self.run_remote({**{aa: 0.01 for aa in AA_LIST}, "C": 0.5, "S": 0.05})
        self.assertEqual(client.fill_mask.call_args.args[0], "M<mask>A")
        self.assertAlmostEqual(result["llr"], math.log(10), places=3)
        self.assertEqual(result["mutRank"], 1)
        self.assertEqual(result["scoringMethod"], "masked-marginal")
        self.assertIsNone(result["embeddingShift"])

    def test_non_residue_tokens_do_not_enter_the_normalisation(self):
        result, _ = self.run_remote({**{aa: 0.04 for aa in AA_LIST}, "<eos>": 0.2})
        self.assertAlmostEqual(sum(p["prob"] for p in result["preferences"]), 1.0, places=4)
        self.assertAlmostEqual(result["wtProbability"], 0.05, places=6)


class FailureClassificationTests(unittest.TestCase):
    def test_codes(self):
        cases = {
            "billing": RuntimeError("402 Client Error: Payment Required"),
            "auth": RuntimeError("HTTP 401: unauthorized"),
            "region": RuntimeError("HTTP 451"),
            "rate-limit": RuntimeError("429 Client Error: Too Many Requests"),
            "timeout": TimeoutError("read timed out"),
            "invalid-response": InvalidProviderResponse("19 of 20 residues"),
            "unavailable": ConnectionError("connection reset"),
        }
        for code, failure in cases.items():
            with self.subTest(code=code):
                self.assertEqual(classify_remote_failure(failure), code)

    def test_a_remembered_refusal_keeps_its_cause(self):
        self.assertEqual(classify_remote_failure("HTTP 402 - inference credits exhausted for the configured token"), "billing")
        self.assertEqual(classify_remote_failure("InvalidProviderResponse: ESM-2 returned an incomplete distribution"), "invalid-response")

    def test_every_router_endpoint_codes_its_remote_note(self):
        coded = with_remote_failure({"status": "success", "remoteEngineNote": "remote skipped (recent refusal): HTTP 451 - regional"}, "biohub")
        self.assertEqual(coded["remoteFailure"], {"provider": "biohub", "code": "region"})
        self.assertNotIn("remoteFailure", with_remote_failure({"status": "success", "remoteEngineNote": None}, "biohub"))
        kept = {"remoteEngineNote": "HTTP 402", "remoteFailure": {"provider": "huggingface", "code": "billing"}}
        self.assertEqual(with_remote_failure(dict(kept), "biohub")["remoteFailure"]["provider"], "huggingface")


class Esm3RemoteIndexingTests(unittest.TestCase):
    """The SDK's embeddings carry <cls> and <eos>; score i must be residue i + 1."""

    def run_remote(self, rows_for):
        sequence = "MKTAYSLLGW"
        client = MagicMock()
        client.encode.side_effect = lambda protein: protein.sequence
        client.logits.side_effect = lambda seq, config: SimpleNamespace(embeddings=rows_for(seq))
        with patch("esm.sdk.forge.ESM3ForgeInferenceClient", return_value=client):
            return esm3._predict_esm3_remote(esm3.Esm3Request(sequence=sequence, position=6, wt="S", mut="C"), sequence, 6, "C")

    def test_special_token_rows_are_dropped(self):
        def rows(seq):  # <cls>, one row per residue (identity of the residue), <eos>
            body = [[1.0, 0.0] if aa != "C" else [0.0, 1.0] for aa in seq]
            return torch.tensor([[[0.5, 0.5]] + body + [[0.5, 0.5]]])
        scores = self.run_remote(rows)["perturbationScores"]
        self.assertEqual(len(scores), 10)
        self.assertEqual(max(range(10), key=scores.__getitem__) + 1, 6)

    def test_an_unexpected_row_count_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_remote(lambda seq: torch.ones(1, len(seq) + 1, 2))


class VesmCosineProfileTests(unittest.TestCase):
    def setUp(self):
        vesm.clear_vesm_caches()
        self.addCleanup(vesm.clear_vesm_caches)
        p = patch.multiple(models, vesm_model=FakeLm(), vesm_tokenizer=FakeTokenizer())
        p.start()
        self.addCleanup(p.stop)

    def test_esm3_fallback_carries_cosine_distance_over_the_whole_window(self):
        result = esm3._local_vesm_fallback(SEQUENCE, 6, "S", "C", "VESM-150M (Local Fallback)", None)
        scores = result["perturbationScores"]
        self.assertEqual(len(scores), len(SEQUENCE))
        self.assertTrue(all(0 <= s <= 2 for s in scores))
        self.assertEqual(max(range(len(scores)), key=scores.__getitem__) + 1, 6)
        self.assertEqual(scores[0], 0)

    def test_residues_outside_the_scoring_window_are_marked_unmeasured(self):
        long_sequence = "A" * 1500 + SEQUENCE
        scores = esm3._local_vesm_fallback(long_sequence, 1506, "S", "C", "VESM", None)["perturbationScores"]
        self.assertEqual(len(scores), len(long_sequence))
        self.assertEqual(scores[0], -1.0)
        self.assertGreater(scores[1505], 0)


class EsmcRemoteTests(unittest.TestCase):
    """The hosted ESMC request scores the hidden residue; the unmasked sequences are for embeddings only."""

    def run_remote(self, include_embeddings):
        calls = []

        class Client:
            def __init__(self, **kwargs):
                pass

            def encode(self, protein):
                calls.append(("encode", protein.sequence))
                ids = [0] + [vesm.ESMC_CANONICAL_VOCAB.get(c, 32) for c in protein.sequence] + [2]
                return SimpleNamespace(sequence=torch.tensor(ids), text=protein.sequence)

            def logits(self, tensor, config):
                calls.append(("logits", tensor.text, bool(config.return_embeddings)))
                logits = torch.zeros(tensor.sequence.shape[0], 64)
                for j, ch in enumerate(tensor.text, start=1):
                    logits[j, vesm.ESMC_CANONICAL_VOCAB["C"] if ch == "_" else vesm.ESMC_CANONICAL_VOCAB.get(ch, 32)] = 8.0
                embeddings = torch.nn.functional.one_hot(tensor.sequence, 64).float() if config.return_embeddings else None
                return SimpleNamespace(logits=SimpleNamespace(sequence=logits), embeddings=embeddings)

        req = vesm.VesmRequest(sequence=SEQUENCE, position=6, wt="S", mut="C", biohubToken="t", includeEmbeddings=include_embeddings)
        with patch("esm.sdk.forge.ESMCForgeInferenceClient", Client):
            result = vesm._run_esmc_remote_host(req, SEQUENCE, 6, "S", "C", 0, "https://forge.test")
        return result, calls

    def test_the_site_is_scored_with_the_residue_hidden(self):
        result, calls = self.run_remote(include_embeddings=False)
        self.assertEqual([c for c in calls if c[0] == "logits"], [("logits", "MKTAY_LLGW", False)])
        self.assertEqual(result["preferences"][0]["aa"], PEAK)
        self.assertGreater(result["llr"], 0)
        self.assertEqual(result["scoringMethod"], "masked-marginal")
        self.assertIsNone(result["embeddingShift"])

    def test_the_embedding_shift_reads_the_two_unmasked_sequences(self):
        result, calls = self.run_remote(include_embeddings=True)
        with_embeddings = [c[1] for c in calls if c[0] == "logits" and c[2]]
        self.assertEqual(with_embeddings, ["MKTAYSLLGW", "MKTAYCLLGW"])
        self.assertGreater(result["embeddingShift"], 0)


class SaprotLocalTests(unittest.TestCase):
    """Local SaProt scores the hidden residue, and its VESM stand-in is numbered in the full protein."""

    class Tokenizer:
        mask_token_id = 31
        unk_token_id = 3

        def convert_tokens_to_ids(self, token):
            return 4 + AA_LIST.index(token[0]) if len(token) == 2 and token[1] == "#" else self.unk_token_id

        def __call__(self, seq, return_tensors="pt"):
            ids, i = [0], 0
            while i < len(seq):
                if seq.startswith("<mask>", i):
                    ids.append(31)
                    i += 6
                else:
                    ids.append(self.convert_tokens_to_ids(seq[i : i + 2]))
                    i += 2
            ids.append(2)
            return {"input_ids": torch.tensor([ids]), "attention_mask": torch.ones(1, len(ids), dtype=torch.long)}

    def request(self, sequence=SEQUENCE, position=6):
        return saprot.SaprotRequest(sequence=sequence, position=position, wt="S", mut="C", modelName="westlake-repl/SaProt_35M_AF2")

    def test_preferences_come_from_the_masked_site_and_embeddings_from_the_unmasked_ones(self):
        model = FakeLm()
        with patch.object(saprot.models, "get_saprot_model", return_value=(self.Tokenizer(), model)):
            result = saprot.predict_saprot_sync(self.request())
        self.assertEqual(result["preferences"][0]["aa"], PEAK)
        self.assertGreater(result["llr"], 0)
        self.assertEqual(result["scoringMethod"], "masked-marginal")
        self.assertIsNone(result["klDivergence"])
        masked = [c for c in model.calls if 31 in c[0].tolist()]
        self.assertEqual(len(masked), 1)
        self.assertEqual(masked[0][0, 6].item(), 31)
        self.assertEqual(len(model.calls) - len(masked), 2)

    def test_the_stand_in_gets_the_full_protein_not_the_saprot_window(self):
        long_sequence = "A" * 1500 + SEQUENCE
        seen = {}

        def capture(vesm_req):
            seen["sequence"], seen["position"] = vesm_req.sequence, vesm_req.position
            return {"status": "success", "llr": 1.0}

        with patch.object(saprot.models, "get_saprot_model", side_effect=OSError("weights unavailable")), \
             patch.object(saprot, "predict_vesm_sync", side_effect=capture):
            saprot.predict_saprot_sync(self.request(long_sequence, 1506))
        self.assertEqual(seen, {"sequence": long_sequence, "position": 1506})


class TokenizationGuardTests(unittest.TestCase):
    def test_only_one_pair_per_residue_plus_the_two_special_tokens_is_accepted(self):
        validate_saprot_tokenization(512, 510)
        for count in (508, 510, 511, 513):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "expected 512"):
                validate_saprot_tokenization(count, 510)

    def test_residues_that_share_a_token_cannot_be_scored(self):
        logits = torch.zeros(3, 40)
        collapsed = {aa: 3 for aa in AA_LIST}  # every residue answered <unk>
        with self.assertRaisesRegex(ValueError, "not distinct"):
            compute_scientific_metrics(logits, 1, "S", "C", collapsed)


if __name__ == "__main__":
    unittest.main()
