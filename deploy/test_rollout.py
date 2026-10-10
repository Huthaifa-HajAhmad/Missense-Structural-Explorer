"""Behavioural failure-path tests for the production handover; no Docker or network required."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("rollout", Path(__file__).with_name("rollout.py"))
rollout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollout)
COMMIT = "a" * 40
OLD, NEW = rollout.SLOTS


class FakeDocker:
    def __init__(self):
        self.events = []
        self.target = OLD
        self.states = {OLD: self.status(False)}
        self.states[OLD]["commit"] = "b" * 40
        self.candidate_ready = True
        self.fail_activation_response = False
        self.busy_old = False
        self.public_commit = COMMIT
        self.fail_cleanup = False

    def status(self, paused):
        return dict(protocol=1, backend="sqlite", paused=paused, activeJobs=0,
                    activeRequests=0, backgroundTasks=0, ready=True, commit=COMMIT)

    def proxy_target(self):
        return self.target

    def inspect(self, name):
        return {"Config": {"Cmd": ["caddy", "run", "--resume"]}}

    def start_candidate(self, name, commit):
        self.events.append(("start", name))
        self.states[name] = self.status(True)
        self.states[name]["ready"] = self.candidate_ready

    def retain_assets(self, old, new):
        self.events.append(("assets", old, new))

    def switch(self, target):
        self.events.append(("switch", target))
        self.target = target

    def public_version(self):
        return self.public_commit

    def available_mb(self):
        return 8000

    def control(self, name, action=None, probe=False):
        if action:
            self.events.append((action, name))
            self.states[name]["paused"] = action == "pause"
            # Assert the critical invariant at the moment of worker activation.
            if action == "resume":
                others = [s for n, s in self.states.items() if n != name]
                assert all(s["paused"] and s["activeJobs"] == 0 for s in others)
            if name == NEW and action == "resume" and self.fail_activation_response:
                raise subprocess.CalledProcessError(1, "lost response")
        state = dict(self.states[name])
        if name == OLD and self.busy_old:
            state["activeRequests"] = 1
        return state

    def run(self, *args, capture=False):
        self.events.append(tuple(args))
        if args[0] == "ps":
            return "\n".join(self.states)
        if args[0] == "stop":
            if self.fail_cleanup and args[-1] == OLD:
                raise RuntimeError("stop failed")
            state = self.states[args[-1]]
            assert state["activeRequests"] == 0 and state["activeJobs"] == 0 and state["paused"]
            self.states.pop(args[-1])
        return ""


class RolloutTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.time = 0
        self.docker = FakeDocker()

    def driver(self):
        def sleep(seconds):
            self.time += seconds
        return rollout.Rollout(self.docker, COMMIT, readiness_timeout=10, drain_timeout=10,
                               clock=lambda: self.time, sleep=sleep,
                               journal=Path(self.directory.name) / "status.json")

    def test_success_warms_before_switch_and_transfers_workers_after_draining(self):
        self.driver().execute()
        self.assertEqual(self.docker.target, NEW)
        self.assertEqual(self.docker.states[NEW]["paused"], False)
        self.assertNotIn(OLD, self.docker.states)
        events = self.docker.events
        self.assertLess(events.index(("assets", OLD, NEW)), events.index(("switch", NEW)))
        self.assertLess(events.index(("pause", OLD)), events.index(("resume", NEW)))
        self.assertLess(events.index(("resume", NEW)), events.index(("stop", "--time", "30", OLD)))
        self.assertIn(("update", "--memory", "10g", "--memory-swap", "20g", NEW), events)

    def test_failed_readiness_never_switches_or_stops_serving_app(self):
        self.docker.candidate_ready = False
        with self.assertRaises(RuntimeError):
            self.driver().execute()
        self.assertEqual(self.docker.target, OLD)
        self.assertFalse(self.docker.states[OLD]["paused"])
        self.assertNotIn(("switch", NEW), self.docker.events)

    def test_drain_timeout_restores_old_without_aborting_its_request(self):
        self.docker.busy_old = True
        with self.assertRaises(RuntimeError):
            self.driver().execute()
        self.assertEqual(self.docker.target, OLD)
        self.assertFalse(self.docker.states[OLD]["paused"])
        self.assertNotIn(("stop", "--time", "30", OLD), self.docker.events)
        self.assertNotIn(("resume", NEW), self.docker.events)

    def test_public_version_mismatch_rolls_back_before_worker_transfer(self):
        self.docker.public_commit = "b" * 40
        with self.assertRaisesRegex(RuntimeError, "expected candidate"):
            self.driver().execute()
        self.assertEqual(self.docker.target, OLD)
        self.assertNotIn(("resume", NEW), self.docker.events)

    def test_lost_activation_response_pauses_candidate_before_resuming_old(self):
        self.docker.fail_activation_response = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.driver().execute()
        events = self.docker.events
        self.assertLess(events.index(("pause", NEW)), events.index(("resume", OLD)))
        self.assertEqual(self.docker.target, OLD)

    def test_cleanup_failure_keeps_verified_candidate_serving(self):
        self.docker.fail_cleanup = True
        with self.assertRaises(RuntimeError):
            self.driver().execute()
        self.assertEqual(self.docker.target, NEW)
        self.assertFalse(self.docker.states[NEW]["paused"])
        self.assertTrue(self.docker.states[OLD]["paused"])
        self.assertNotIn(("resume", OLD), self.docker.events)

    def test_legacy_process_is_rejected_without_any_mutation(self):
        self.docker.states[OLD]["protocol"] = None
        with self.assertRaisesRegex(RuntimeError, "bootstrap"):
            self.driver().execute()
        self.assertEqual(self.docker.events, [])

    def test_same_revision_is_an_idempotent_noop(self):
        self.docker.states[OLD]["commit"] = COMMIT
        self.driver().execute()
        self.assertEqual(self.docker.target, OLD)
        self.assertNotIn(("start", NEW), self.docker.events)

    def test_missing_drain_fields_are_never_treated_as_zero(self):
        self.assertFalse(rollout.drained({"protocol": 1, "paused": True}))

    def test_proxy_probe_uses_ipv4_loopback(self):
        docker = rollout.Docker()
        calls = []
        def run(*args, **kwargs):
            calls.append(args)
            return '{"handler":"reverse_proxy","upstreams":[{"dial":"' + OLD + ':3000"}]}'
        docker.run = run
        self.assertEqual(docker.proxy_target(), OLD)
        self.assertIn("http://127.0.0.1:2019/config/", calls[0])


class BuildHeadroomTests(unittest.TestCase):
    """The disk guard that turns a late, silent ENOSPC into an immediate, named refusal."""

    def recording_docker(self):
        docker = rollout.Docker()
        calls = []
        docker.run = lambda *args, **kwargs: calls.append(args) or ""
        return docker, calls

    def test_plenty_of_space_skips_reclaim(self):
        docker, calls = self.recording_docker()
        with mock.patch.object(rollout, "min_free_disk_mb", return_value=1000), \
             mock.patch.object(rollout, "free_disk_mb", return_value=50_000):
            docker.ensure_build_headroom(COMMIT)
        self.assertEqual(calls, [])

    def test_low_space_reclaims_then_proceeds(self):
        docker, calls = self.recording_docker()
        values = iter([100, 50_000])
        with mock.patch.object(rollout, "min_free_disk_mb", return_value=1000), \
             mock.patch.object(rollout, "free_disk_mb", side_effect=lambda *a, **k: next(values)):
            docker.ensure_build_headroom(COMMIT)
        self.assertIn(("builder", "prune", "-f"), calls)
        self.assertIn(("image", "prune", "-a", "-f"), calls)

    def test_space_that_never_recovers_refuses_by_name(self):
        docker, calls = self.recording_docker()
        with mock.patch.object(rollout, "min_free_disk_mb", return_value=1000), \
             mock.patch.object(rollout, "free_disk_mb", return_value=100):
            with self.assertRaisesRegex(RuntimeError, "MiB free"):
                docker.ensure_build_headroom(COMMIT)
        self.assertIn(("builder", "prune", "-f"), calls)

    def test_start_candidate_refuses_before_building(self):
        docker, calls = self.recording_docker()
        docker.available_mb = lambda: 8000
        with mock.patch.object(rollout, "min_free_disk_mb", return_value=1000), \
             mock.patch.object(rollout, "free_disk_mb", return_value=10):
            with self.assertRaises(RuntimeError):
                docker.start_candidate(NEW, COMMIT)
        self.assertFalse(any(args and args[0] == "compose" and "build" in args for args in calls))


if __name__ == "__main__":
    unittest.main()
