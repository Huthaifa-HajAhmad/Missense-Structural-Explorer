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

import tempfile
import types
import unittest
from unittest.mock import Mock, mock_open, patch
from fastapi import HTTPException
import torch
import numpy as np
from model_server import crop_sequence_around_mutation, compute_scientific_metrics, clear_model_cache

class TestModelServerHealth(unittest.TestCase):
    def test_warming_includes_each_model_without_overwriting_ready_models(self):
        from unittest.mock import patch
        from model_server import health_check, models
        for name in ('vesm', 'thermompnn', 'stabilityoracle', 'esm2', 'saprot'):
            for state in ('downloading', 'loading'):
                statuses = {key: 'ready' for key in models.model_status}
                statuses[name] = state
                with self.subTest(name=name, state=state), patch.dict(models.model_status, statuses, clear=True):
                    health = health_check()
                    self.assertEqual(health['state'], 'warming_up')
                    self.assertEqual(health['model_status'], statuses)

    def test_finished_and_failed_models_are_not_reported_as_loading(self):
        from unittest.mock import patch
        from model_server import health_check, models
        with patch.dict(models.model_status, {'vesm': 'failed', 'esm2': 'ready'}, clear=True):
            health = health_check()
            self.assertEqual(health['state'], 'ready')
            self.assertEqual(health['model_status']['vesm'], 'failed')


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

        # 3. Wild-type residue mismatch must raise 422 instead of silently substituting parsed_wt
        sample_pdb = (
            "ATOM      1  N   ARG A 408      11.104  13.205  -9.943  1.00 80.00           N\n"
            "ATOM      2  CA  ARG A 408      11.500  14.500 -10.500  1.00 80.00           C\n"
            "ATOM      3  C   ARG A 408      12.000  14.000 -11.000  1.00 80.00           C\n"
            "ATOM      4  O   ARG A 408      12.500  13.000 -11.500  1.00 80.00           O\n"
        )
        req_mismatch = ThermoMpnnRequest(pdb_content=sample_pdb, mutation="LA408W")
        with self.assertRaises(HTTPException) as ctx_mismatch:
            predict_thermompnn_sync(req_mismatch)
        self.assertEqual(ctx_mismatch.exception.status_code, 422)

        # 4. Missing position on offset crystal structure (min_resn > 0) must raise 422, not fall back to pos - 1
        offset_pdb = (
            "ATOM      1  N   ALA A  50      10.000  10.000  10.000  1.00 20.00           N\n"
            "ATOM      2  CA  ALA A  50      11.000  10.000  10.000  1.00 20.00           C\n"
            "ATOM      3  C   ALA A  50      12.000  10.000  10.000  1.00 20.00           C\n"
            "ATOM      4  O   ALA A  50      13.000  10.000  10.000  1.00 20.00           O\n"
            "ATOM      5  N   GLY A  55      20.000  10.000  10.000  1.00 20.00           N\n"
            "ATOM      6  CA  GLY A  55      21.000  10.000  10.000  1.00 20.00           C\n"
            "ATOM      7  C   GLY A  55      22.000  10.000  10.000  1.00 20.00           C\n"
            "ATOM      8  O   GLY A  55      23.000  10.000  10.000  1.00 20.00           O\n"
        )
        req_missing = ThermoMpnnRequest(pdb_content=offset_pdb, mutation="AA2V")
        with self.assertRaises(HTTPException) as ctx_missing:
            predict_thermompnn_sync(req_missing)
        self.assertEqual(ctx_missing.exception.status_code, 422)

        # 5. Valid PDB structure - either returns official model prediction or explicit 503 (never fake numbers)
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

    def test_stabilityoracle_featurization(self):
        from tools.model_server_app.routers import stabilityoracle as SO

        def atom(serial, name, res_name, chain, res_seq, x, bfactor="95.00"):
            element = name[0]
            return f"ATOM  {serial:5d}  {name:<3} {res_name} {chain}{res_seq:4d}    {x:8.3f}{0:8.3f}{0:8.3f}  1.00 {bfactor}           {element}"

        def pdb(bfactor):
            return "\n".join([
                "HETATM    1  O   HOH A  10       0.000   0.000   0.000  1.00 99.00           O",
                atom(2, "CA", "GLY", "A", 10, 50.0, bfactor),
                atom(3, "CA", "ARG", "B", 10, 1.0, bfactor),
                atom(4, "CB", "ARG", "B", 10, 2.0, bfactor),
                atom(5, "CA", "LEU", "B", 11, 3.5, bfactor),
                atom(6, "CB", "LEU", "B", 11, 4.0, bfactor),
                atom(7, "CA", "SER", "B", 40, 30.0, bfactor),
                "ENDMDL",
                atom(8, "CA", "ARG", "B", 10, 9.0, bfactor),
            ])

        seen = {}

        def fake_prepare(chain_text):
            seen["text"] = chain_text
            names = ["CA", "CB", "CA", "HA", "CB", "CA"]
            return {
                "xyz": np.array([[1.0, 0, 0], [2.0, 0, 0], [3.5, 0, 0], [3.6, 0, 0], [4.0, 0, 0], [30.0, 0, 0]]),
                "names": names,
                "res_seqs": np.array([10, 10, 11, 11, 11, 40]),
                "chains": np.array(["B"] * 6),
                "elements": ["C", "C", "C", "H", "C", "C"],
                "charge": np.array([0.25, 0.1, 0.25, 0.09, 0.07, 0.25]),
                "exposure": np.array([5.0, 6.0, 7.0, 0.0, 8.0, 9.0]),
            }

        SO._prepared_chains.clear()
        with patch.object(SO, "_prepare_chain", fake_prepare):
            coords, types, pp, ca, mask, aa, contacts = SO.featurize_pdb_for_stability_oracle(pdb("95.00"), position=10, wt="R", mut="H", chain="B")
            _, _, pp_low, _, _, _, _ = SO.featurize_pdb_for_stability_oracle(pdb("10.00"), position=10, wt="R", mut="H", chain="B")

        # First model, without water, a far-away chain or a second copy from a later model.
        self.assertNotIn("HOH", seen["text"])
        self.assertNotIn(" A  10", seen["text"])
        self.assertNotIn("   9.000", seen["text"])
        self.assertTrue(torch.allclose(ca, torch.tensor([[1.0, 0.0, 0.0]])))
        # Only residue 11's atoms: the variant residue is removed and residue 40 is beyond 10 A.
        self.assertEqual(int(mask.sum().item()), 3)
        self.assertEqual(contacts, 2)
        self.assertTrue(torch.allclose(coords[0, 0], torch.tensor([3.5, 0.0, 0.0])))
        self.assertEqual(types[0, 1].item(), 0)  # the hydrogen
        self.assertAlmostEqual(pp[0, 1, 0].item(), 0.09, places=5)
        self.assertEqual(pp[0, 1, 1].item(), 0.0)  # hydrogens carry no exposure
        # The B-factor column holds pLDDT on AlphaFold models and must not reach the inputs.
        self.assertTrue(torch.allclose(pp, pp_low))

        # Wild-type mismatch on the selected chain is refused before any work is done.
        with self.assertRaisesRegex(ValueError, "Wild-type residue mismatch"):
            SO.featurize_pdb_for_stability_oracle(pdb("95.00"), position=10, wt="R", mut="H", chain="A")

    def test_stabilityoracle_environment_includes_a_partner_chain_touching_the_site(self):
        from tools.model_server_app.routers import stabilityoracle as SO

        def atom(serial, name, res_name, chain, res_seq, x):
            return f"ATOM  {serial:5d}  {name:<3} {res_name} {chain}{res_seq:4d}    {x:8.3f}{0:8.3f}{0:8.3f}  1.00 95.00           {name[0]}"

        pdb = "\n".join([
            atom(1, "CA", "ARG", "B", 10, 1.0),
            atom(2, "CA", "LEU", "A", 10, 4.0),  # Touches the site and has the same number as the variant residue.
            atom(3, "CA", "SER", "C", 10, 40.0),  # Far from the site.
        ])
        seen = {}

        def fake_prepare(text):
            seen["text"] = text
            return {
                "xyz": np.array([[1.0, 0, 0], [4.0, 0, 0]]), "names": ["CA", "CA"], "res_seqs": np.array([10, 10]),
                "chains": np.array(["B", "A"]), "elements": ["C", "C"], "charge": np.array([0.2, 0.3]), "exposure": np.array([1.0, 2.0]),
            }

        SO._prepared_chains.clear()
        with patch.object(SO, "_prepare_chain", fake_prepare):
            coords, _, _, ca, mask, _, contacts = SO.featurize_pdb_for_stability_oracle(pdb, position=10, wt="R", mut="H", chain="B")
        self.assertIn("LEU A", seen["text"])
        self.assertNotIn("SER C", seen["text"])
        self.assertTrue(torch.allclose(ca, torch.tensor([[1.0, 0.0, 0.0]])))
        # Only the variant residue is removed, not the partner's residue with the same number.
        self.assertEqual(contacts, 1)
        self.assertTrue(torch.allclose(coords[0, 0], torch.tensor([4.0, 0.0, 0.0])))

    def test_stabilityoracle_says_why_when_hydrogens_cannot_be_added(self):
        from tools.model_server_app.routers import stabilityoracle as SO

        pdb = "ATOM      1  CA  ARG B  10       1.000   0.000   0.000  1.00 95.00           C\n"
        run = Mock(return_value=types.SimpleNamespace(returncode=1))
        SO._prepared_chains.clear()
        with patch.object(SO.subprocess, "run", run):
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, "PDB2PQR could not add hydrogens"):
                    SO.featurize_pdb_for_stability_oracle(pdb, position=10, wt="R", mut="H", chain="B")
        # The same chain fails the same way, so the second variant does not pay for another attempt.
        self.assertEqual(run.call_count, 1)

    def test_stabilityoracle_out_of_time_is_a_busy_answer_and_is_not_kept(self):
        from tools.model_server_app.engine_resilience import GateDeadlineExceeded
        from tools.model_server_app.routers import stabilityoracle as SO

        pdb = "ATOM      1  CA  ARG B  10       1.000   0.000   0.000  1.00 95.00           C\n"
        request = SO.StabilityOracleRequest(sequence="", position=10, wt="R", mut="H", wtPdb=pdb, chain="B")
        run = Mock(side_effect=SO.subprocess.TimeoutExpired("pdb2pqr", 1))
        SO._prepared_chains.clear()
        with patch.object(SO, "get_stability_oracle_model"), patch.object(SO.subprocess, "run", run):
            for _ in range(2):
                with self.assertRaises(GateDeadlineExceeded):
                    SO.predict_stabilityoracle_sync(request)
        self.assertEqual(run.call_count, 2)

    def test_stabilityoracle_passes_wait_at_the_shared_cpu_gate(self):
        from tools.model_server_app import models
        from tools.model_server_app.engine_resilience import GateDeadlineExceeded, request_deadline
        from tools.model_server_app.routers import stabilityoracle as SO

        pdb = "ATOM      1  CA  ARG B  10       1.000   0.000   0.000  1.00 95.00           C\n"
        request = SO.StabilityOracleRequest(sequence="", position=10, wt="R", mut="H", wtPdb=pdb, chain="B")
        run = Mock()
        token = request_deadline.set(0.0)  # The caller has already gone.
        SO._prepared_chains.clear()
        with patch.object(SO, "get_stability_oracle_model"), patch.object(SO.subprocess, "run", run):
            with self.assertRaises(GateDeadlineExceeded):
                SO.predict_stabilityoracle_sync(request)
        request_deadline.reset(token)
        run.assert_not_called()

    def test_stabilityoracle_refuses_missing_or_damaged_tables_and_only_it_stops(self):
        from tools.model_server_app.routers import stabilityoracle as SO

        request = SO.StabilityOracleRequest(sequence="", position=10, wt="R", mut="H", wtPdb="END\n", chain="B")
        for opened in (Mock(side_effect=FileNotFoundError("stability_oracle_inputs.json")), mock_open(read_data='{"heavyCharge": {}}')):
            SO._input_tables.cache_clear()
            with patch.object(SO, "get_stability_oracle_model"), patch("builtins.open", opened):
                with self.assertRaises(HTTPException) as caught:
                    SO.predict_stabilityoracle_sync(request)
            self.assertEqual(caught.exception.status_code, 503)
        SO._input_tables.cache_clear()
        self.assertTrue(SO._input_tables()["heavyCharge"])

    def test_stabilityoracle_says_when_pdb2pqr_is_not_installed(self):
        from tools.model_server_app.routers import stabilityoracle as SO

        request = SO.StabilityOracleRequest(sequence="", position=10, wt="R", mut="H", wtPdb="END\n", chain="B")
        with patch.object(SO, "get_stability_oracle_model"), patch.object(SO.importlib.util, "find_spec", return_value=None):
            with self.assertRaises(HTTPException) as caught:
                SO.predict_stabilityoracle_sync(request)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("PDB2PQR is not installed", caught.exception.detail)

    def test_vesm_and_esm3_keep_a_busy_refusal_as_a_busy_refusal(self):
        from tools.model_server_app.engine_resilience import GateDeadlineExceeded
        from tools.model_server_app.routers import esm3, vesm

        refused = Mock(side_effect=GateDeadlineExceeded("late"))
        with patch.object(vesm, "_ensure_vesm_loaded"), patch.object(vesm._local_vesm_logits_cache, "get_or_compute", refused):
            with self.assertRaises(GateDeadlineExceeded):
                vesm._predict_vesm_local(types.SimpleNamespace(includeEmbeddings=False), "MK", 1, "M", "K", 0)
        with patch.object(esm3, "_local_vesm_fallback", refused):
            with self.assertRaises(GateDeadlineExceeded):
                esm3.predict_esm3_sync(esm3.Esm3Request(sequence="MK", position=1, wt="M", mut="K"))

    def test_thermompnn_reads_only_the_first_model(self):
        from tools.model_server_app.routers.thermompnn import parse_pdb_chains_for_thermompnn

        def atom(res_seq):
            return f"ATOM      1  CA  ALA A{res_seq:4d}       1.000   0.000   0.000  1.00 95.00           C\n"

        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "nmr.pdb")
            with open(path, "w") as fh:
                fh.write("MODEL 1\n" + atom(1) + "ENDMDL\nMODEL 2\n" + atom(1) + atom(9) + "ENDMDL\n")
            chains, _ = parse_pdb_chains_for_thermompnn(path, atoms=["CA"])
        self.assertEqual(chains["A"]["max_resn"], 0)  # Zero-based. Residue 9 exists only in the second model.

    def test_saprot_fill_mask_bpe_parsing(self):
        from tools.model_server_app.routers.saprot import parse_saprot_fill_mask_scores
        
        from tools.model_server_app.engine_resilience import InvalidProviderResponse
        from tools.model_server_app.utils import AA_LIST

        # 1. BPE tokens with leading spaces (e.g. " Sa", " Cc") must match canonical amino acids
        weights = {"S": 0.45, "C": 0.05, "A": 0.20, "G": 0.15, "L": 0.15}
        mock_bpe_preds = [{"token_str": f" {aa}a", "score": weights.get(aa, 0.01)} for aa in AA_LIST]
        probs = parse_saprot_fill_mask_scores(mock_bpe_preds, expected_wt="S", expected_mut="C")
        self.assertAlmostEqual(sum(probs.values()), 1.0, places=4)
        self.assertGreater(probs["S"], probs["C"])
        self.assertGreater(probs["A"], probs["C"])
        self.assertEqual(len(probs), 20)

        # 1b. A distribution that lacks residues is refused, not padded with a made-up floor
        with self.assertRaisesRegex(InvalidProviderResponse, "5 of 20"):
            parse_saprot_fill_mask_scores(mock_bpe_preds[:5], expected_wt="S", expected_mut="C")

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
        # Only " Aa" and " Rd" are residues: '<mask>', '<pad>', '<s>' and '[CLS]' must not be read as
        # M, P, S or C, so the answer counts as 2 of 20 and is refused.
        with self.assertRaisesRegex(InvalidProviderResponse, "2 of 20"):
            parse_saprot_fill_mask_scores(mock_special_tokens, expected_wt="A", expected_mut="R")

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

class TestSaProtScoreParser(unittest.TestCase):
    def test_valid_scores_parsing(self):
        from model_server_app.routers.saprot import parse_saprot_fill_mask_scores
        from model_server_app.utils import AA_LIST
        weights = {"R": 0.8, "H": 0.15, "A": 0.05}
        preds = [{"token_str": f"{aa}a", "score": weights.get(aa, 0.001)} for aa in AA_LIST]
        probs = parse_saprot_fill_mask_scores(preds, expected_wt="R", expected_mut="H")
        self.assertAlmostEqual(sum(probs.values()), 1.0, places=4)
        self.assertGreater(probs["R"], probs["H"])
        self.assertGreater(probs["H"], probs["A"])
        self.assertGreater(probs["A"], probs["W"])

    def test_missing_wt_and_mut_raises(self):
        from model_server_app.routers.saprot import parse_saprot_fill_mask_scores
        preds = [
            {"token_str": "Aa", "score": 0.5},
            {"token_str": "Ca", "score": 0.5},
        ]
        with self.assertRaises(ValueError):
            parse_saprot_fill_mask_scores(preds, expected_wt="R", expected_mut="H")

    def test_insufficient_tokens_raises(self):
        from model_server_app.routers.saprot import parse_saprot_fill_mask_scores
        preds = [
            {"token_str": "Ra", "score": 0.99},
        ]
        with self.assertRaises(ValueError):
            parse_saprot_fill_mask_scores(preds, expected_wt="R", expected_mut="H")

    def test_zero_matched_tokens_blames_the_engine_not_the_parser(self):
        """
        The observed production failure: HF's serverless filler answers with tokens that carry no
        residue at all, so 0/20 match. The message has to say the *engine* cannot serve SaProt's
        3Di vocabulary — otherwise the card's only diagnostic reads like a bug in this parser, which
        is exactly how it was read from the UI.
        """
        from model_server_app.routers.saprot import parse_saprot_fill_mask_scores
        preds = [
            {"token_str": "<mask>", "score": 0.90},
            {"token_str": "▁", "score": 0.07},
            {"token_str": "#", "score": 0.03},
        ]
        with self.assertRaises(ValueError) as ctx:
            parse_saprot_fill_mask_scores(preds, expected_wt="R", expected_mut="W")

        message = str(ctx.exception)
        self.assertIn("0/20", message)
        self.assertIn("no residue tokens", message)
        self.assertIn("structure-aware", message)
        self.assertIn("local engine", message)


class TestSaProtFallbackDiagnostics(unittest.TestCase):
    """
    A fallback response replaces one model's numbers with another's. The response therefore has to
    carry *why*, per tier: the local candidates' failure (which forces the fallback) and the remote
    engine's failure (which only removes the first choice).
    """

    def _request(self):
        from model_server_app.routers.saprot import SaprotRequest
        return SaprotRequest(sequence="MKTAY", position=5, wt="Y", mut="W", engine="saprot-35m")

    def test_local_failure_reason_reaches_the_response(self):
        from unittest import mock
        from model_server_app.routers import saprot as saprot_router

        with mock.patch.object(
            saprot_router.models, "get_saprot_model", side_effect=RuntimeError("weights unavailable")
        ), mock.patch.object(
            saprot_router, "predict_vesm_sync", return_value={"status": "success", "llr": -1.0}
        ):
            result = saprot_router.predict_saprot_sync(self._request())

        self.assertEqual(result["provenance"], "VESM-150M (Local Fallback - SaProt unavailable)")
        # The reason that actually forced the fallback, naming the candidate that failed.
        self.assertIn("SaProt_35M_AF2", result["fallbackReason"])
        self.assertIn("RuntimeError", result["fallbackReason"])
        self.assertIn("weights unavailable", result["fallbackReason"])
        # No remote attempt was made (no token), so no remote diagnostic may be invented.
        self.assertIsNone(result["hfError"])
        self.assertIsNone(result["remoteEngineNote"])

    def test_remote_and_local_failures_are_reported_separately(self):
        from unittest import mock
        from model_server_app.routers import saprot as saprot_router

        remote_error = ValueError(
            "SaProt fill_mask returned insufficient valid amino acid tokens (0/20 matched): "
            "the engine served a vocabulary with no residue tokens."
        )
        req = self._request()
        req.hfToken = "hf_test_token"
        req.preferRemote = True

        with mock.patch.object(
            saprot_router, "run_saprot_remote", side_effect=remote_error
        ), mock.patch.object(
            saprot_router.models, "get_saprot_model", side_effect=PermissionError("cache lock")
        ), mock.patch.object(
            saprot_router, "predict_vesm_sync", return_value={"status": "success", "llr": -1.0}
        ):
            result = saprot_router.predict_saprot_sync(req)

        self.assertIn("0/20", result["remoteEngineNote"])
        self.assertIn("cache lock", result["fallbackReason"])
        # The two reasons describe different engines and must not be collapsed into one field.
        self.assertNotEqual(result["remoteEngineNote"], result["fallbackReason"])
        self.assertEqual(result["hfError"], result["remoteEngineNote"])

class TestSaProtSequenceConstruction(unittest.TestCase):
    """
    SaProt's input is one residue/3Di pair token per position, and its 446-token vocabulary holds the
    pairs in *lower case* ("Rd", "Kd") — 400/400 of them — with 0/400 upper-case pairs, plus the 20
    masked "AA#" forms.

    Foldseek/mini3di emit 3Di states in upper case. Pairing them verbatim therefore produced tokens
    that do not exist, so the tokenizer collapsed a 510-residue input to a single <unk>: the model
    returned three rows (one token plus the two specials) and the scorer raised

        IndexError: index 390 is out of bounds for dimension 0 with size 3

    which the router caught and reported as "SaProt unavailable", falling back to VESM-150M. Only a
    *real* structure triggers it — an absent PDB yields '#' states, whose "AA#" tokens do exist, so
    structure-less runs looked healthy and hid the defect.
    """

    def test_uppercase_3di_states_are_lowercased_into_pair_tokens(self):
        from model_server_app.utils import build_saprot_sequence
        self.assertEqual(build_saprot_sequence("RK", "DD"), "RdKd")

    def test_lowercase_states_are_left_alone(self):
        from model_server_app.utils import build_saprot_sequence
        self.assertEqual(build_saprot_sequence("RK", "dd"), "RdKd")

    def test_masked_states_keep_the_dedicated_hash_token(self):
        from model_server_app.utils import build_saprot_sequence
        self.assertEqual(build_saprot_sequence("RK", "##"), "R#K#")

    def test_mask_index_replaces_exactly_one_position(self):
        from model_server_app.utils import build_saprot_sequence
        self.assertEqual(build_saprot_sequence("RKD", "ddd", mask_index=1), "Rd<mask>Dd")

    def test_pair_tokens_are_always_lowercase_or_masked(self):
        from model_server_app.utils import AA_LIST, to_saprot_3di
        for aa in AA_LIST:
            for state in to_saprot_3di("ACDEFGHIKLMNPQRSTVWY"):
                token = aa + state
                self.assertTrue(
                    state == "#" or state.islower(),
                    f"pair token {token!r} is not a form SaProt's vocabulary contains",
                )

    def test_collapsed_tokenisation_is_refused_with_its_cause(self):
        from model_server_app.utils import validate_saprot_tokenization
        validate_saprot_tokenization(512, 510)   # 510 pairs + <cls>/<eos>
        with self.assertRaises(ValueError) as ctx:
            validate_saprot_tokenization(3, 510)
        message = str(ctx.exception)
        self.assertIn("510 residues into 3 tokens", message)
        self.assertIn("lower-case", message)


class TestRefusedPassAnswersBusy(unittest.TestCase):
    """
    A pass the CPU gate turned away must reach the caller as `503 busy`.

    It used to be an unhandled exception: FastAPI answered a bare `500`, and the Node clients map an
    unrecognised status to "offline" — so a model server that had just replied was reported to the
    reader as absent, and a retryable busy state was presented as a broken installation.
    """

    def test_a_refused_pass_answers_503_with_a_readable_body(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from model_server_app.engine_resilience import GateDeadlineExceeded, register_refusal_handler

        app = FastAPI()
        register_refusal_handler(app)

        @app.post("/pass")
        def _pass():
            raise GateDeadlineExceeded("The caller's deadline passed while this pass was queued.")

        response = TestClient(app, raise_server_exceptions=False).post("/pass")

        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body["status"], "busy")
        self.assertTrue(body["retryable"])
        self.assertIn("queued", body["message"])


if __name__ == "__main__":
    unittest.main()

