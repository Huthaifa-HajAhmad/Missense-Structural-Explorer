"""Tests for the deploy check on the model server tests; no network needed."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("model_server_gate", Path(__file__).with_name("model_server_gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def run(status="completed", conclusion="success", created_at="2026-11-05T10:00:00Z"):
    return {"status": status, "conclusion": conclusion, "created_at": created_at, "html_url": "https://example.test/run/1"}


class DecideTests(unittest.TestCase):
    def test_a_commit_the_model_server_tests_did_not_run_for_goes_ahead(self):
        self.assertEqual(gate.decide([])[0], "deploy")

    def test_passed_and_skipped_runs_go_ahead(self):
        for conclusion in ("success", "skipped", "neutral"):
            self.assertEqual(gate.decide([run(conclusion=conclusion)])[0], "deploy", conclusion)

    def test_every_other_ending_stops_the_deploy(self):
        for conclusion in ("failure", "cancelled", "timed_out", "action_required", "startup_failure", None):
            verdict, reason = gate.decide([run(conclusion=conclusion)])
            self.assertEqual(verdict, "stop", conclusion)
            self.assertIn("https://example.test/run/1", reason)

    def test_a_run_that_has_not_finished_is_waited_for(self):
        for status in ("queued", "in_progress", "waiting", "requested", "pending"):
            self.assertEqual(gate.decide([run(status=status, conclusion=None)])[0], "wait", status)

    def test_the_newest_run_decides_so_a_passing_re_run_replaces_a_failed_one(self):
        old_failure = run(conclusion="failure", created_at="2026-11-05T10:00:00Z")
        new_success = run(conclusion="success", created_at="2026-11-05T10:30:00Z")
        self.assertEqual(gate.decide([old_failure, new_success])[0], "deploy")
        self.assertEqual(gate.decide([new_success, old_failure])[0], "deploy")
        self.assertEqual(gate.decide([run(conclusion="success"), run(conclusion="failure", created_at="2026-11-05T10:30:00Z")])[0], "stop")


class CheckTests(unittest.TestCase):
    def test_it_waits_for_a_running_workflow_and_then_follows_its_result(self):
        answers = iter([[run(status="in_progress", conclusion=None)], [run(status="in_progress", conclusion=None)], [run()]])
        slept = []
        allowed, _ = gate.check(lambda: next(answers), sleep=slept.append, wait_seconds=600, poll_seconds=20)
        self.assertTrue(allowed)
        self.assertEqual(slept, [20, 20])

    def test_it_stops_when_the_workflow_never_finishes_in_time(self):
        slept = []
        allowed, reason = gate.check(lambda: [run(status="in_progress", conclusion=None)], sleep=slept.append, wait_seconds=60, poll_seconds=20)
        self.assertFalse(allowed)
        self.assertEqual(sum(slept), 60)
        self.assertIn("did not finish in 60 seconds", reason)

    def test_it_stops_at_once_on_a_failure_without_waiting(self):
        slept = []
        allowed, _ = gate.check(lambda: [run(conclusion="failure")], sleep=slept.append)
        self.assertFalse(allowed)
        self.assertEqual(slept, [])


class WiringTests(unittest.TestCase):
    """The check only protects production if the deploy workflow runs it, on the automatic path, with the right permission."""

    workflow = (Path(__file__).parent.parent / ".github" / "workflows" / "cd.yml").read_text(encoding="utf-8")

    def test_the_deploy_workflow_runs_the_check_on_automatic_deploys_only(self):
        step = self.workflow.split("- name: Stop if the model server tests failed for this commit", 1)[1].split("\n      - name:", 1)[0]
        self.assertIn("python3 deploy/model_server_gate.py", step)
        self.assertIn("github.event_name == 'workflow_run'", step)

    def test_the_check_runs_before_anything_is_deployed(self):
        self.assertLess(
            self.workflow.index("deploy/model_server_gate.py"), self.workflow.index("- name: Deploy to OCI VM via SSH")
        )

    def test_the_deploy_job_may_read_workflow_runs(self):
        self.assertIn("actions: read", self.workflow)

    def test_the_workflow_name_matches_the_file_the_check_reads(self):
        sidecar = (Path(__file__).parent.parent / ".github" / "workflows" / "sidecar.yml").read_text(encoding="utf-8")
        self.assertTrue(sidecar.startswith("name: Model server"))
        self.assertEqual(gate.WORKFLOW, "sidecar.yml")


if __name__ == "__main__":
    unittest.main()
