"""
Resilience helpers shared by the model-server routers (ESMFold, StabilityOracle, ThermoMPNN).

Deliberately free of torch / fastapi imports so they can be unit-tested anywhere.

What it holds
-------------
One CPU gate with priorities and request deadlines (`PriorityCpuGate`, `BudgetHeaderMiddleware`), a
single-flight cache so concurrent identical passes share one result, a deadline runner for remote SDK
calls, and a check that turns an SDK error value into a raised error. The remote-failure memory that
served the protein language models was removed with them on 2026-11-18.
"""

from __future__ import annotations

import concurrent.futures
import contextlib
import contextvars
import copy
import heapq
import math
import threading
import time
from collections import OrderedDict
from typing import Any, Callable

def raise_if_sdk_error(value: Any) -> Any:
    """
    The ESM SDK RETURNS an `ESMProteinError` from `encode` / `logits` once its retries are spent
    instead of raising it; the next call then fails with a message that no longer says why.
    Raising it at the call site keeps the HTTP status (401/403/451/429...) attached.
    """
    if isinstance(value, Exception) and hasattr(value, "error_code") and hasattr(value, "error_msg"):
        err = RuntimeError(f"HTTP {value.error_code}: {value.error_msg}")
        setattr(err, "error_code", value.error_code)
        raise err
    return value


class SingleFlightCache:
    """
    Computes each key once even when several engines ask for it at the same moment.

    The second caller waits for the first and receives a deep copy, because the routers mutate the
    returned dict (they overwrite `provenance`, set `klDivergence`).
    """

    def __init__(self, max_entries: int = 8):
        self._max = max_entries
        self._lock = threading.Lock()
        self._done: "OrderedDict[Any, Any]" = OrderedDict()
        self._inflight: dict[Any, threading.Event] = {}

    def get_or_compute(self, key: Any, compute: Callable[[], Any]) -> Any:
        while True:
            with self._lock:
                if key in self._done:
                    self._done.move_to_end(key)
                    return copy.deepcopy(self._done[key])
                waiter = self._inflight.get(key)
                if waiter is None:
                    waiter = threading.Event()
                    self._inflight[key] = waiter
                    owner = True
                else:
                    owner = False
            if not owner:
                # A follower waits no longer than its own caller will. Without this limit it could outlive the request.
                limit = request_deadline.get()
                if not waiter.wait(timeout=None if limit is None else max(0.0, limit - time.monotonic())):
                    raise GateDeadlineExceeded("The caller's deadline passed while waiting for the same work to finish.")
                continue  # re-check: the owner may have failed, in which case this caller computes
            try:
                result = compute()
                with self._lock:
                    self._done[key] = copy.deepcopy(result)
                    while len(self._done) > self._max:
                        self._done.popitem(last=False)
                return result
            finally:
                with self._lock:
                    self._inflight.pop(key, None)
                waiter.set()

    def clear(self) -> None:
        with self._lock:
            self._done.clear()


# When the caller stops waiting, as a monotonic-clock time. Set per request by `BudgetHeaderMiddleware`
# from the `X-Budget-Ms` header, and copied into worker threads by `asyncio.to_thread`.
request_deadline: contextvars.ContextVar[float | None] = contextvars.ContextVar("request_deadline", default=None)

# Must match `SIDECAR_BUDGET_HEADER` in server/services/infra/sidecar-budget.ts (a test compares them).
BUDGET_HEADER = "X-Budget-Ms"
_MAX_BUDGET_S = 600.0


class GateDeadlineExceeded(TimeoutError):
    """The caller's deadline passed before this pass could start. The caller is gone, so the pass is skipped."""


def register_refusal_handler(app: Any) -> None:
    """
    Answers a CPU-gate refusal with `503` and a readable body instead of a bare `500`.

    Without this, `GateDeadlineExceeded` reached FastAPI as an unhandled exception: the caller got a
    generic `500`, and every client of the model server maps an unrecognised status to "offline" — so a
    server that had just ANSWERED was reported to the reader as absent. A refusal is a busy signal: the
    pass was never started because the caller's own deadline had passed. `503` plus `status: busy` says
    exactly that, and the Node side reads it as a retryable timeout
    (`server/services/infra/sidecar-budget.ts` `sidecarFailure`).

    Starlette is imported inside the function on purpose: this module stays free of framework imports
    so it can be unit-tested anywhere (see the module docstring).
    """

    from starlette.responses import JSONResponse

    @app.exception_handler(GateDeadlineExceeded)
    async def _refused_pass(_request: Any, exc: GateDeadlineExceeded) -> Any:
        return JSONResponse(
            status_code=503,
            content={
                "status": "busy",
                "message": str(exc) or "The model server was too busy to start this pass.",
                "retryable": True,
            },
        )


class BudgetHeaderMiddleware:
    """
    Reads how long the caller will wait (`X-Budget-Ms`, milliseconds from now) into `request_deadline`.

    A pure ASGI middleware, so the value is set in the same context the endpoint runs in. A missing,
    malformed or non-positive header sets nothing: such a request simply has no deadline, as before.
    """

    def __init__(self, app: Any, clock: Callable[[], float] = time.monotonic):
        self.app = app
        self._clock = clock

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        token = None
        if scope["type"] == "http":
            wanted = BUDGET_HEADER.lower().encode()
            for name, value in scope.get("headers", []):
                if name.lower() != wanted:
                    continue
                try:
                    budget_ms = float(value)
                except ValueError:
                    break
                if math.isfinite(budget_ms) and budget_ms > 0:
                    token = request_deadline.set(self._clock() + min(budget_ms / 1000.0, _MAX_BUDGET_S))
                break
        try:
            await self.app(scope, receive, send)
        finally:
            if token is not None:
                request_deadline.reset(token)


class PriorityCpuGate:
    """
    Serializes CPU-bound forward passes so OpenMP threads do not oversubscribe cores,
    waking priority=0 (passes of about a second: masked LLR triage, ThermoMPNN) callers ahead of priority=1 (embedding / structure) callers.

    A pass is refused (`GateDeadlineExceeded`) when its caller's deadline has passed, whether that is
    discovered on arrival or while queued. A running pass cannot be stopped, but a queued one that nobody
    is waiting for no longer takes its turn ahead of live requests.
    """

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._busy = False
        self._waiters: list[tuple[int, int, threading.Event]] = []
        self._seq = 0

    @contextlib.contextmanager
    def acquire(self, priority: int = 1, deadline: float | None = None):
        limit = deadline if deadline is not None else request_deadline.get()
        entry: tuple[int, int, threading.Event] | None = None
        with self._cond:
            if limit is not None and time.monotonic() >= limit:
                raise GateDeadlineExceeded("The caller's deadline passed before this pass could start.")
            if not self._busy and not self._waiters:
                self._busy = True
            else:
                self._seq += 1
                entry = (priority, self._seq, threading.Event())
                heapq.heappush(self._waiters, entry)
        if entry is not None:
            wait_s = None if limit is None else max(0.0, limit - time.monotonic())
            if not entry[2].wait(timeout=wait_s):
                with self._cond:
                    # Woken at the last moment (the event is set under this same lock): this caller owns the gate.
                    if not entry[2].is_set():
                        self._waiters.remove(entry)
                        heapq.heapify(self._waiters)
                        raise GateDeadlineExceeded("The caller's deadline passed while this pass was queued.")
        try:
            yield
        finally:
            with self._cond:
                if self._waiters:
                    _, _, next_ev = heapq.heappop(self._waiters)
                    next_ev.set()
                else:
                    self._busy = False


class RemoteDeadlineExceeded(TimeoutError):
    pass


_deadline_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="remote-deadline")


def run_with_deadline(fn: Callable[[], Any], seconds: float, label: str) -> Any:
    """
    Runs `fn` and gives up waiting after `seconds`.

    A thread cannot be killed, so an abandoned call finishes in the background; callers bound it
    further with the SDK's own request timeout. What this guarantees is that a slow remote tier can
    no longer consume the whole HTTP budget of the request that is waiting for the local fallback.
    """
    future = _deadline_pool.submit(fn)
    try:
        return future.result(timeout=seconds)
    except concurrent.futures.TimeoutError as exc:
        future.cancel()
        raise RemoteDeadlineExceeded(f"{label} exceeded its {seconds:.0f}s remote budget") from exc
