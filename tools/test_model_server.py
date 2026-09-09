# /// script
# dependencies = [
#   "fastapi",
#   "uvicorn",
#   "pydantic",
#   "torch",
#   "transformers",
#   "huggingface_hub",
#   "numpy",
#   "esm @ git+https://github.com/Biohub/esm.git@c6b8c342aa99c823cd63ff11e0047ccd2f962117",
#   "mini3di"
# ]
# ///

import os
import sys
# Add paths for imports
sys.path.append(os.path.abspath(os.path.dirname(__file__)))
sys.path.append(os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

import unittest
import torch
import numpy as np
from model_server import crop_sequence_around_mutation, compute_scientific_metrics, clear_model_cache

class TestModelServerHelpers(unittest.TestCase):
    def test_crop_sequence_short(self):
        # Short sequence should not change
        seq = "MGEKSL"
        cropped_seq, pos, start_offset = crop_sequence_around_mutation(seq, 3, 10)
        self.assertEqual(cropped_seq, "MGEKSL")
        self.assertEqual(pos, 3)
        self.assertEqual(start_offset, 0)

    def test_crop_sequence_long_centered(self):
        # Long sequence should crop to max_len (e.g. 10) centered around pos
        seq = "A" * 10 + "MUT" + "B" * 10
        # Mutation position of 'M' in 'MUT' is 11 (1-indexed)
        cropped_seq, pos, start_offset = crop_sequence_around_mutation(seq, 11, max_len=10)
        self.assertEqual(len(cropped_seq), 10)
        self.assertEqual(cropped_seq[pos - 1], "M")
        self.assertEqual(start_offset + pos, 11)

    def test_crop_sequence_long_left_edge(self):
        # Mutation near the N-terminus
        seq = "A" * 5 + "MUT" + "B" * 20
        # Mutation position of 'M' is 6
        cropped_seq, pos, start_offset = crop_sequence_around_mutation(seq, 6, max_len=10)
        self.assertEqual(len(cropped_seq), 10)
        self.assertEqual(cropped_seq[pos - 1], "M")
        self.assertEqual(start_offset, 0)
        self.assertEqual(pos, 6)

    def test_crop_sequence_long_right_edge(self):
        # Mutation near the C-terminus
        seq = "A" * 20 + "MUT" + "B" * 5
        # Mutation position of 'M' is 21
        cropped_seq, pos, start_offset = crop_sequence_around_mutation(seq, 21, max_len=10)
        self.assertEqual(len(cropped_seq), 10)
        self.assertEqual(cropped_seq[pos - 1], "M")
        self.assertEqual(start_offset + pos, 21)

    def test_compute_scientific_metrics_numerical_stability(self):
        # Test extreme/near-zero probabilities to verify log / division stability
        vocab_map = {aa: i for i, aa in enumerate("ARNDCQEGHILKMFPSTWYV")}
        
        # Test 1: logits that output normal probability
        logits = torch.zeros((2, 20))
        # 1-indexed pos = 1 (index 1 in tensor)
        wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
            logits, 1, "A", "R", vocab_map
        )
        self.assertAlmostEqual(wt_prob, 0.05, places=4)
        self.assertAlmostEqual(mut_prob, 0.05, places=4)
        self.assertAlmostEqual(llr, 0.0, places=4)
        
        # Test 2: zero probabilities for mutant / WT (extreme logits)
        # Pos logits are set very negative except for one index
        logits[1] = -1e9
        logits[1][0] = 1e9 # make index 0 extremely likely, others 0
        wt_prob, mut_prob, llr, preferences, mut_rank, pos_entropy = compute_scientific_metrics(
            logits, 1, "R", "N", vocab_map
        )
        # wt ("R") and mut ("N") should have probability 0 (or near zero 1e-9 offset)
        self.assertEqual(wt_prob, 0.0)
        self.assertEqual(mut_prob, 0.0)
        # llr should not be NaN or Infinity thanks to 1e-9 offset
        self.assertFalse(np.isnan(llr))
        self.assertFalse(np.isinf(llr))
        self.assertEqual(llr, 0.0) # log(1e-9) - log(1e-9) = 0.0

    def test_validate_missense_residues(self):
        from model_server import validate_missense_residues, HTTPException
        
        # Canonical amino acids should pass (return None or raise no error)
        validate_missense_residues("A", "C")
        validate_missense_residues("a", "c")
        
        # Non-canonical/non-missense amino acids should raise HTTPException
        with self.assertRaises(HTTPException) as ctx:
            validate_missense_residues("fs", "A")
        self.assertEqual(ctx.exception.status_code, 400)
        
        with self.assertRaises(HTTPException) as ctx:
            validate_missense_residues("A", "Ter")
        self.assertEqual(ctx.exception.status_code, 400)
        
        with self.assertRaises(HTTPException) as ctx:
            validate_missense_residues("del", "ins")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_clear_model_cache_endpoint(self):
        res = clear_model_cache()
        self.assertEqual(res.get("status"), "success")

    def test_thermompnn_prediction(self):
        from tools.model_server_app.routers.thermompnn import predict_thermompnn_sync, ThermoMpnnRequest, HTTPException
        
        # 1. Invalid mutation format must raise 400
        req_bad = ThermoMpnnRequest(pdb_content="ATOM  1  CA  ARG A 1  0 0 0", mutation="invalid_mut")
        with self.assertRaises(HTTPException) as ctx:
            predict_thermompnn_sync(req_bad)
        self.assertEqual(ctx.exception.status_code, 400)

        # 2. Missing PDB must raise 400
        req_empty = ThermoMpnnRequest(pdb_content="", mutation="RA408W")
        with self.assertRaises(HTTPException) as ctx:
            predict_thermompnn_sync(req_empty)
        self.assertEqual(ctx.exception.status_code, 400)

        # 3. Valid PDB structure - either returns official model prediction or explicit 503 (never fake numbers)
        sample_pdb = (
            "ATOM      1  N   ARG A 408      11.104  13.205  -9.943  1.00 80.00           N\n"
            "ATOM      2  CA  ARG A 408      11.500  14.500 -10.500  1.00 80.00           C\n"
            "ATOM      3  C   ARG A 408      12.000  14.000 -11.000  1.00 80.00           C\n"
            "ATOM      4  O   ARG A 408      12.500  13.000 -11.500  1.00 80.00           O\n"
        )
        req = ThermoMpnnRequest(pdb_content=sample_pdb, mutation="RA408W")
        try:
            result = predict_thermompnn_sync(req)
            self.assertEqual(result.get("status"), "success")
            self.assertIn("ddG", result)
            self.assertIsInstance(result["ddG"], float)
            self.assertIn("ThermoMPNN", result.get("provenance", ""))
        except HTTPException as e:
            # Explicit 503 is expected if offline without pre-trained weights
            self.assertEqual(e.status_code, 503)

    def test_saprot_fill_mask_bpe_parsing(self):
        from tools.model_server_app.routers.saprot import parse_saprot_fill_mask_scores
        
        # 1. BPE tokens with leading spaces (e.g. " Sa", " Cc") must match canonical amino acids
        mock_bpe_preds = [
            {"token_str": " Sa", "score": 0.45},
            {"token_str": " Cc", "score": 0.05},
            {"token_str": " Ad", "score": 0.20},
            {"token_str": " G#", "score": 0.15},
            {"token_str": " Lb", "score": 0.15}
        ]
        probs = parse_saprot_fill_mask_scores(mock_bpe_preds, expected_wt="S", expected_mut="C")
        self.assertAlmostEqual(sum(probs.values()), 1.0, places=4)
        self.assertGreater(probs["S"], probs["C"])
        self.assertGreater(probs["A"], probs["C"])
        self.assertEqual(probs["W"], 1e-9 / sum([0.45, 0.05, 0.20, 0.15, 0.15] + [1e-9]*15))

        # 2. Degenerate tokens (all whitespace or unparseable) must raise ValueError
        mock_degenerate_preds = [
            {"token_str": "   ", "score": 0.36},
            {"token_str": "<unk>", "score": 0.02}
        ]
        with self.assertRaises(ValueError):
            parse_saprot_fill_mask_scores(mock_degenerate_preds)

        # 3. Special tokens like <mask>, <pad>, <s>, [CLS] must be rejected and never mapped to M, P, S, C
        mock_special_tokens = [
            {"token_str": "<mask>", "score": 0.50},
            {"token_str": "<pad>", "score": 0.20},
            {"token_str": "<s>", "score": 0.10},
            {"token_str": "[CLS]", "score": 0.10},
            {"token_str": " Aa", "score": 0.05},
            {"token_str": " Rd", "score": 0.05}
        ]
        probs_special = parse_saprot_fill_mask_scores(mock_special_tokens, expected_wt="A", expected_mut="R")
        # 'M' (from <mask>), 'P' (from <pad>), 'C' (from [CLS]) must receive fallback 1e-9, NOT high probability
        self.assertAlmostEqual(probs_special["A"], 0.5, delta=0.01)
        self.assertAlmostEqual(probs_special["R"], 0.5, delta=0.01)
        self.assertLess(probs_special["M"], 1e-4)
        self.assertLess(probs_special["P"], 1e-4)
        self.assertLess(probs_special["C"], 1e-4)

    def test_encode_pdb_to_3di_alignment_and_insertion_codes(self):
        from tools.model_server_app.utils import encode_pdb_to_3di

        mock_pdb = "\n".join([
            "ATOM      1  N   ALA A 100       1.000   2.000   3.000  1.00 20.00           N",
            "ATOM      2  CA  ALA A 100       1.500   2.500   3.500  1.00 20.00           C",
            "ATOM      3  C   ALA A 100       2.000   3.000   4.000  1.00 20.00           C",
            "ATOM      4  CB  ALA A 100       2.500   3.500   4.500  1.00 20.00           C",
            "ATOM      5  N   ALA A 100A      3.000   4.000   5.000  1.00 20.00           N",
            "ATOM      6  CA  ALA A 100A      3.500   4.500   5.500  1.00 20.00           C",
            "ATOM      7  C   ALA A 100A      4.000   5.000   6.000  1.00 20.00           C",
            "ATOM      8  CB  ALA A 100A      4.500   5.500   6.500  1.00 20.00           C",
            "ATOM      9  N   GLY A 101       5.000   6.000   7.000  1.00 20.00           N",
            "ATOM     10  CA  GLY A 101       5.500   6.500   7.500  1.00 20.00           C",
            "ATOM     11  C   GLY A 101       6.000   7.000   8.000  1.00 20.00           C",
        ])

        # Test 1: Full sequence matching observed residues
        result = encode_pdb_to_3di(mock_pdb, target_seq="AAG")
        self.assertEqual(len(result), 3)

        # Test 2: Target sequence with unmodeled N-terminal residue
        result_with_gap = encode_pdb_to_3di(mock_pdb, target_seq="MAAG")
        self.assertEqual(len(result_with_gap), 4)
        self.assertEqual(result_with_gap[0], "#") # Unmodeled 'M' masked

    def test_sidecar_secret_authentication(self):
        import asyncio
        from starlette.requests import Request
        from starlette.responses import Response
        from model_server import verify_secret_header

        async def dummy_call_next(req):
            return Response(content=b"ok", status_code=200)

        # 1. /health is always allowed without secret
        scope_health = {
            "type": "http",
            "method": "GET",
            "path": "/health",
            "headers": []
        }
        res_health = asyncio.run(verify_secret_header(Request(scope_health), dummy_call_next))
        self.assertEqual(res_health.status_code, 200)

        # 2. When SIDECAR_SECRET is configured:
        test_secret = "super_secure_test_secret_32bytes!!"
        old_secret = os.environ.get("SIDECAR_SECRET")
        try:
            os.environ["SIDECAR_SECRET"] = test_secret

            # 2a. Missing header -> 401
            scope_no_header = {
                "type": "http",
                "method": "POST",
                "path": "/models/clear-cache",
                "headers": []
            }
            res_no_header = asyncio.run(verify_secret_header(Request(scope_no_header), dummy_call_next))
            self.assertEqual(res_no_header.status_code, 401)

            # 2b. Wrong secret -> 401
            scope_wrong = {
                "type": "http",
                "method": "POST",
                "path": "/models/clear-cache",
                "headers": [(b"x-sidecar-secret", b"wrong_secret")]
            }
            res_wrong = asyncio.run(verify_secret_header(Request(scope_wrong), dummy_call_next))
            self.assertEqual(res_wrong.status_code, 401)

            # 2c. Correct secret -> 200
            scope_ok = {
                "type": "http",
                "method": "POST",
                "path": "/models/clear-cache",
                "headers": [(b"x-sidecar-secret", test_secret.encode("utf-8"))]
            }
            res_ok = asyncio.run(verify_secret_header(Request(scope_ok), dummy_call_next))
            self.assertEqual(res_ok.status_code, 200)

            # 2d. When SIDECAR_SECRET is not configured on sidecar -> 401
            os.environ.pop("SIDECAR_SECRET", None)
            res_no_env = asyncio.run(verify_secret_header(Request(scope_ok), dummy_call_next))
            self.assertEqual(res_no_env.status_code, 401)
        finally:
            if old_secret is not None:
                os.environ["SIDECAR_SECRET"] = old_secret
            else:
                os.environ.pop("SIDECAR_SECRET", None)

if __name__ == "__main__":
    unittest.main()

