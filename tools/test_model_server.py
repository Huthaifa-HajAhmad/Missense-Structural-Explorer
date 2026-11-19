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
from model_server import clear_model_cache

class TestModelServerHealth(unittest.TestCase):
    def test_warming_includes_each_model_without_overwriting_ready_models(self):
        from unittest.mock import patch
        from model_server import health_check, models
        for name in ('thermompnn', 'stabilityoracle'):
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
        with patch.dict(models.model_status, {'thermompnn': 'failed', 'stabilityoracle': 'ready'}, clear=True):
            health = health_check()
            self.assertEqual(health['state'], 'ready')
            self.assertEqual(health['model_status']['thermompnn'], 'failed')
            # Deployment readiness waits on this flag: one model that passed its check is enough.
            self.assertTrue(health['model_loaded'])

    def test_no_ready_model_is_not_loaded(self):
        from unittest.mock import patch
        from model_server import health_check, models
        with patch.dict(models.model_status, {'thermompnn': 'failed', 'stabilityoracle': 'failed'}, clear=True):
            self.assertFalse(health_check()['model_loaded'])

    def test_retired_language_model_routes_are_not_served(self):
        from model_server import app
        paths = {getattr(route, 'path', '') for route in app.routes}
        for retired in ('/predict/vesm', '/predict/esm2', '/predict/esm3', '/predict/saprot'):
            self.assertNotIn(retired, paths)


class TestModelServerHelpers(unittest.TestCase):


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


    def test_thermompnn_passes_wait_at_the_shared_cpu_gate(self):
        from tools.model_server_app.engine_resilience import GateDeadlineExceeded, request_deadline
        from tools.model_server_app.routers import thermompnn as T

        atoms = [("N", 11.104, 13.205, -9.943), ("CA", 11.5, 14.5, -10.5), ("C", 12.0, 14.0, -11.0), ("O", 12.5, 13.0, -11.5)]
        pdb = "".join(
            f"ATOM  {number:5d}  {name:<3s} ARG A 408    {x:8.3f}{y:8.3f}{z:8.3f}  1.00 80.00           {name[0]}\n"
            for number, (name, x, y, z) in enumerate(atoms, 1)
        )
        model = Mock()
        token = request_deadline.set(0.0)  # The caller has already gone.
        with patch.object(T, "get_official_model", return_value=model):
            with self.assertRaises(GateDeadlineExceeded):
                T.predict_thermompnn_sync(T.ThermoMpnnRequest(pdb_content=pdb, mutation="RA408W"))
        request_deadline.reset(token)
        model.assert_not_called()

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
        from tools.model_server_app.engine_resilience import GateDeadlineExceeded, register_refusal_handler

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


    def test_thermompnn_disambiguates_heteromer_chains_by_wildtype_residue(self):
        from tools.model_server_app.routers.thermompnn import (
            parse_mutation_code,
            select_thermompnn_target_chain,
            parse_pdb_chains_for_thermompnn,
            predict_thermompnn_sync,
            ThermoMpnnRequest,
        )

        # Unchained standard notation must leave chain=None so heteromer disambiguation runs.
        wt, chain, pos, mut = parse_mutation_code("R3W")
        self.assertEqual((wt, chain, pos, mut), ("R", None, 3, "W"))

        chains = {
            "A": {"seq": ["MAAAA"], "resn_index": {"3": 2}},
            "B": {"seq": ["MKRST"], "resn_index": {"3": 2}},
        }
        chosen = select_thermompnn_target_chain(chains, ["A", "B"], chain, pos, wt=wt)
        self.assertEqual(chosen, "B")

        # Missing CA atom must return 422 rather than sending NaN coordinates to the model.
        pdb_missing_ca = (
            "ATOM      1  N   ALA A   1      10.000  10.000  10.000  1.00 50.00           N\n"
            "ATOM      2  C   ALA A   1      11.000  10.000  10.000  1.00 50.00           C\n"
            "ATOM      3  O   ALA A   1      12.000  10.000  10.000  1.00 50.00           O\n"
            "END\n"
        )
        req = ThermoMpnnRequest(pdb=pdb_missing_ca, mutation="A1G")
        with patch("model_server_app.routers.thermompnn.get_official_model", return_value=Mock()):
            with self.assertRaises(HTTPException) as ctx:
                predict_thermompnn_sync(req)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("CA", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()

