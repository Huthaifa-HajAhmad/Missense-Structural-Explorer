import threading
import time
import unittest

from tools.model_server_app.engine_resilience import (
    PriorityCpuGate,
    account_level_refusal,
    RemoteDeadlineExceeded,
    RemoteFailureMemory,
    SingleFlightCache,
    describe_remote_error,
    extract_status,
    raise_if_sdk_error,
    run_with_deadline,
    to_full_coordinates,
)


class _SdkError(Exception):
    def __init__(self, message, error_code=None):
        super().__init__(message)
        self.error_code = error_code


class ExtractStatusTests(unittest.TestCase):
    def test_reads_sdk_error_code_attribute(self):
        self.assertEqual(extract_status(_SdkError("x", 451)), 451)

    def test_reads_requests_style_response(self):
        exc = Exception("boom")
        exc.response = type("R", (), {"status_code": 403})()
        self.assertEqual(extract_status(exc), 403)

    def test_falls_back_to_message_text(self):
        self.assertEqual(extract_status(Exception("Client Error: HTTP 429 Too Many Requests")), 429)

    def test_no_status_is_none(self):
        self.assertIsNone(extract_status(ValueError("plain")))

    def test_451_is_described_as_regional_restriction(self):
        self.assertIn("regionally restricted", describe_remote_error(_SdkError("blocked", 451)))

    def test_402_is_described_as_credits_exhausted_and_remembered(self):
        err = Exception("402 Client Error: Payment Required: You have no remaining credits.")
        self.assertEqual(extract_status(err), 402)
        self.assertIn("credits exhausted", describe_remote_error(err))
        mem = RemoteFailureMemory(ttl_seconds=60)
        mem.record("esm2", "huggingface", "hf_tok", err)
        self.assertIn("HTTP 402", mem.blocked_reason("esm2", "huggingface", "hf_tok"))

    def test_only_credential_refusals_are_shared_across_engines(self):
        mem = RemoteFailureMemory(ttl_seconds=60)
        mem.record("saprot", "huggingface", "hf_tok", Exception("402 Client Error: Payment Required"))
        self.assertIn("HTTP 402", account_level_refusal(mem.blocked_reason("saprot", "huggingface", "hf_tok")))
        mem.record("esm2", "huggingface", "hf_tok2", _SdkError("gated repository", 403))
        # A 403 can be one gated model: it blocks that engine, never its neighbour.
        self.assertIsNotNone(mem.blocked_reason("esm2", "huggingface", "hf_tok2"))
        self.assertIsNone(account_level_refusal(mem.blocked_reason("esm2", "huggingface", "hf_tok2")))
        self.assertIsNone(account_level_refusal(None))


class SdkReturnedErrorTests(unittest.TestCase):
    class _ReturnedError(Exception):
        error_code = 451
        error_msg = "Unavailable For Legal Reasons"

    def test_a_returned_sdk_error_is_raised_with_its_status_attached(self):
        with self.assertRaises(RuntimeError) as ctx:
            raise_if_sdk_error(self._ReturnedError())
        self.assertEqual(extract_status(ctx.exception), 451)

    def test_ordinary_values_pass_through(self):
        for value in (None, {"a": 1}, [1, 2], "tensor"):
            self.assertEqual(raise_if_sdk_error(value), value)

    def test_the_sdk_follow_on_message_still_yields_a_status(self):
        msg = "Input must be an ESMProteinTensor instance, but received an ESMProteinError instead: 451 blocked"
        self.assertEqual(extract_status(ValueError(msg)), 451)


class RemoteFailureMemoryTests(unittest.TestCase):
    def setUp(self):
        self.now = [1000.0]
        self.memory = RemoteFailureMemory(ttl_seconds=60, clock=lambda: self.now[0])

    def test_permanent_failure_is_remembered_then_expires(self):
        self.memory.record("esm3", "forge", "tok", _SdkError("refused", 401))
        self.assertIn("refused", self.memory.blocked_reason("esm3", "forge", "tok"))
        self.now[0] += 61
        self.assertIsNone(self.memory.blocked_reason("esm3", "forge", "tok"))

    def test_transient_failure_is_not_remembered(self):
        for status in (429, 503, None):
            self.memory.record("esm3", "forge", "tok", _SdkError("slow", status))
        self.assertIsNone(self.memory.blocked_reason("esm3", "forge", "tok"))

    def test_scoped_to_engine_host_and_credential(self):
        self.memory.record("esm3", "forge", "tok-a", _SdkError("no", 403))
        self.assertIsNone(self.memory.blocked_reason("esm3", "forge", "tok-b"))
        self.assertIsNone(self.memory.blocked_reason("esmc", "forge", "tok-a"))
        self.assertIsNone(self.memory.blocked_reason("esm3", "biohub", "tok-a"))

    def test_token_is_never_stored_in_the_key(self):
        self.memory.record("esm3", "forge", "SECRET-TOKEN-VALUE", _SdkError("no", 401))
        self.assertNotIn("SECRET-TOKEN-VALUE", repr(self.memory._entries))

    def test_token_in_exception_is_scrubbed_from_reason(self):
        exc = Exception("Invalid token: Bearer hf_secret123456789 and raw esmp_abc987654321")
        reason = self.memory.record("esm3", "forge", "hf_secret123456789", exc)
        self.assertNotIn("hf_secret123456789", reason)
        self.assertNotIn("esmp_abc987654321", reason)
        self.assertIn("Bearer [REDACTED]", reason)
        self.assertIn("[REDACTED_TOKEN]", reason)

    def test_memory_prunes_expired_when_capacity_exceeded(self):
        mem = RemoteFailureMemory(ttl_seconds=10, clock=lambda: self.now[0])
        # Insert 300 entries with past timestamp
        for i in range(300):
            mem._entries[(f"eng_{i}", "host", f"fp_{i}")] = (self.now[0] - 5, f"reason_{i}")
        self.assertEqual(len(mem._entries), 300)
        # Recording a new permanent error should prune expired entries
        mem.record("esm3", "forge", "tok", _SdkError("refused", 401))
        self.assertLessEqual(len(mem._entries), 256)


class SingleFlightCacheTests(unittest.TestCase):
    def test_concurrent_callers_compute_once_and_get_independent_copies(self):
        cache = SingleFlightCache()
        calls = []
        gate = threading.Event()

        def compute():
            calls.append(1)
            gate.wait(2)
            return {"provenance": "VESM", "map": [1]}

        results = []
        threads = [threading.Thread(target=lambda: results.append(cache.get_or_compute("k", compute))) for _ in range(3)]
        for t in threads:
            t.start()
        time.sleep(0.1)
        gate.set()
        for t in threads:
            t.join()

        self.assertEqual(len(calls), 1)
        self.assertEqual(len(results), 3)
        results[0]["provenance"] = "mutated by one engine"
        self.assertEqual(results[1]["provenance"], "VESM")

    def test_a_failed_owner_does_not_poison_the_key(self):
        cache = SingleFlightCache()
        with self.assertRaises(RuntimeError):
            cache.get_or_compute("k", lambda: (_ for _ in ()).throw(RuntimeError("fail")))
        self.assertEqual(cache.get_or_compute("k", lambda: {"ok": True}), {"ok": True})


class DeadlineTests(unittest.TestCase):
    def test_slow_call_raises_deadline_exceeded(self):
        with self.assertRaises(RemoteDeadlineExceeded):
            run_with_deadline(lambda: time.sleep(0.5), 0.05, "ESM3 remote")

    def test_fast_call_returns_value_and_propagates_errors(self):
        self.assertEqual(run_with_deadline(lambda: 7, 1, "x"), 7)
        with self.assertRaises(ValueError):
            run_with_deadline(lambda: (_ for _ in ()).throw(ValueError("v")), 1, "x")


class CropOffsetTests(unittest.TestCase):
    def test_positions_are_shifted_back_to_full_protein_numbering(self):
        mapped = to_full_coordinates([{"position": 511, "shift": 0.4}, {"position": 512, "shift": 0.1}], 365)
        self.assertEqual([m["position"] for m in mapped], [876, 877])

    def test_no_offset_is_identity_and_input_is_not_mutated(self):
        original = [{"position": 5, "shift": 1.0}]
        self.assertEqual(to_full_coordinates(original, 0), original)
        to_full_coordinates(original, 10)
        self.assertEqual(original[0]["position"], 5)


class PriorityCpuGateTests(unittest.TestCase):
    def test_wakes_priority_zero_triage_before_queued_embedding_passes(self):
        gate = PriorityCpuGate()
        order: list[str] = []
        hold = threading.Event()
        queued_low = threading.Event()
        queued_high = threading.Event()

        def holder():
            with gate.acquire(priority=1):
                order.append("holder")
                hold.wait(2)

        def low():
            queued_low.set()
            with gate.acquire(priority=1):
                order.append("low")

        def high():
            queued_high.set()
            with gate.acquire(priority=0):
                order.append("high")

        t_hold = threading.Thread(target=holder)
        t_hold.start()
        time.sleep(0.02)

        t_low = threading.Thread(target=low)
        t_low.start()
        queued_low.wait(1)
        time.sleep(0.02)

        t_high = threading.Thread(target=high)
        t_high.start()
        queued_high.wait(1)
        time.sleep(0.02)

        hold.set()
        for t in (t_hold, t_low, t_high):
            t.join()

        self.assertEqual(order, ["holder", "high", "low"])


if __name__ == "__main__":
    unittest.main()
