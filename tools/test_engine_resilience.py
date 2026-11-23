import asyncio
import threading
import time
import unittest

from tools.model_server_app.engine_resilience import (
    BUDGET_HEADER,
    BudgetHeaderMiddleware,
    GateDeadlineExceeded,
    PriorityCpuGate,
    request_deadline,
    SingleFlightCache,
)


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


class GateDeadlineTests(unittest.TestCase):
    """A pass whose caller has already given up must not take its turn ahead of live requests."""

    def test_a_pass_whose_deadline_has_passed_is_refused_without_taking_the_gate(self):
        gate = PriorityCpuGate()
        with self.assertRaises(GateDeadlineExceeded):
            with gate.acquire(deadline=time.monotonic() - 1):
                self.fail("the pass must not start")
        # The gate was never taken, so the next caller does not wait.
        with gate.acquire(deadline=time.monotonic() + 5):
            pass

    def test_a_queued_pass_gives_up_at_its_deadline_and_leaves_the_queue(self):
        gate = PriorityCpuGate()
        hold = threading.Event()
        started = threading.Event()
        outcome: list[str] = []

        def holder():
            with gate.acquire():
                started.set()
                hold.wait(3)

        def impatient():
            try:
                with gate.acquire(deadline=time.monotonic() + 0.1):
                    outcome.append("ran")
            except GateDeadlineExceeded:
                outcome.append("refused")

        t_hold = threading.Thread(target=holder)
        t_hold.start()
        started.wait(1)
        t_wait = threading.Thread(target=impatient)
        t_wait.start()
        t_wait.join(2)
        self.assertEqual(outcome, ["refused"])
        self.assertEqual(gate._waiters, [], "a refused pass must not stay queued")

        hold.set()
        t_hold.join()
        # And the gate still works for the next caller.
        with gate.acquire(deadline=time.monotonic() + 5):
            pass

    def test_a_waiting_pass_with_time_left_still_runs_when_its_turn_comes(self):
        gate = PriorityCpuGate()
        hold = threading.Event()
        started = threading.Event()
        order: list[str] = []

        def holder():
            with gate.acquire():
                started.set()
                hold.wait(3)
                order.append("holder")

        def patient():
            with gate.acquire(deadline=time.monotonic() + 5):
                order.append("patient")

        t_hold = threading.Thread(target=holder)
        t_hold.start()
        started.wait(1)
        t_wait = threading.Thread(target=patient)
        t_wait.start()
        time.sleep(0.05)
        hold.set()
        t_hold.join()
        t_wait.join(2)
        self.assertEqual(order, ["holder", "patient"])

    def test_the_request_deadline_is_used_when_no_explicit_one_is_given(self):
        gate = PriorityCpuGate()
        token = request_deadline.set(time.monotonic() - 1)
        try:
            with self.assertRaises(GateDeadlineExceeded):
                with gate.acquire():
                    self.fail("the pass must not start")
        finally:
            request_deadline.reset(token)


class BudgetHeaderMiddlewareTests(unittest.TestCase):
    def _run(self, headers, clock=lambda: 1000.0):
        seen: list[float | None] = []

        async def app(scope, receive, send):
            seen.append(request_deadline.get())

        middleware = BudgetHeaderMiddleware(app, clock=clock)

        async def go():
            await middleware({"type": "http", "headers": headers}, None, None)
            # Checked in the SAME context the middleware ran in: the deadline must not outlive its request.
            return request_deadline.get()

        self.assertIsNone(asyncio.run(go()))
        return seen[0]

    def test_the_header_becomes_a_deadline_relative_to_now(self):
        self.assertEqual(self._run([(BUDGET_HEADER.lower().encode(), b"15000")]), 1015.0)

    def test_a_missing_malformed_or_non_positive_header_sets_no_deadline(self):
        self.assertIsNone(self._run([]))
        self.assertIsNone(self._run([(b"x-budget-ms", b"soon")]))
        self.assertIsNone(self._run([(b"x-budget-ms", b"0")]))
        self.assertIsNone(self._run([(b"x-budget-ms", b"-5")]))
        self.assertIsNone(self._run([(b"x-budget-ms", b"nan")]))

    def test_an_absurd_budget_is_capped(self):
        self.assertEqual(self._run([(b"x-budget-ms", b"999999999")]), 1600.0)

    def test_non_http_scopes_pass_through(self):
        seen = []

        async def app(scope, receive, send):
            seen.append(scope["type"])

        asyncio.run(BudgetHeaderMiddleware(app)({"type": "lifespan"}, None, None))
        self.assertEqual(seen, ["lifespan"])


class SdkTimeoutAndFollowerTests(unittest.TestCase):


    def test_a_follower_stops_waiting_when_its_own_caller_has_gone(self):
        cache = SingleFlightCache()
        started, release = threading.Event(), threading.Event()

        def slow():
            started.set()
            release.wait(5)
            return 1

        owner = threading.Thread(target=lambda: cache.get_or_compute("key", slow))
        owner.start()
        started.wait(5)
        token = request_deadline.set(time.monotonic() + 0.05)
        began = time.monotonic()
        try:
            with self.assertRaises(GateDeadlineExceeded):
                cache.get_or_compute("key", lambda: 2)
            self.assertLess(time.monotonic() - began, 2)
        finally:
            request_deadline.reset(token)
            release.set()
            owner.join()


if __name__ == "__main__":
    unittest.main()
