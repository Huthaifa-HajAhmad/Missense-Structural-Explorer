"""
Resilience helpers shared by the model-server routers (ESM3, ESM-2, VESM).

Deliberately free of torch / fastapi imports so they can be unit-tested anywhere.

Why this module exists
----------------------
A remote engine (EvolutionaryScale Forge / Biohub, Hugging Face serverless) can fail in two
different ways, and the routers used to treat both identically:

* transient (429, 5xx, timeouts) - worth retrying on the next request;
* deterministic for this credential or region (401, 403, 451) - a retry only burns the request's
  time budget, because the same call fails the same way.

The old behaviour paid for the failed remote attempt on every analysis and then recomputed the same
local VESM-150M pass once per engine (ESM3 fallback, ESM-2 fallback) concurrently on a CPU host.
"""

from __future__ import annotations

import concurrent.futures
import contextlib
import copy
import hashlib
import heapq
import re
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Iterable

# Statuses that will not change by retrying the same request with the same credential.
PERMANENT_STATUSES = frozenset({401, 402, 403, 451})

_STATUS_RE = re.compile(
    r"(?:(?:HTTP|status[_ ]?code|error[_ ]?code|ESMProteinError instead:)\D{0,4}(\d{3})|\b(\d{3})\s+(?:Client|Server)\s+Error\b)",
    re.IGNORECASE,
)


def extract_status(exc: BaseException) -> int | None:
    """HTTP status carried by an SDK / requests / huggingface_hub error, if it has one."""
    chain = [exc]
    for linked in (getattr(exc, "__cause__", None), getattr(exc, "__context__", None)):
        if linked is not None and linked not in chain:
            chain.append(linked)
    for item in chain:
        for attr in ("error_code", "status_code"):
            value = getattr(item, attr, None)
            if isinstance(value, int):
                return value
        response = getattr(item, "response", None)
        value = getattr(response, "status_code", None)
        if isinstance(value, int):
            return value
    for item in chain:
        match = _STATUS_RE.search(str(item))
        if match:
            code = match.group(1) or match.group(2)
            return int(code) if code else None
    return None


def sanitize_error_message(text: str, token: str | None = None) -> str:
    """Scrubs authorization headers, bearer tokens, and provider keys from error text."""
    if token and token in text:
        text = text.replace(token, "[REDACTED]")
    text = re.sub(r"(?:Bearer\s+)[A-Za-z0-9._\-~+]+=*", "Bearer [REDACTED]", text, flags=re.IGNORECASE)
    text = re.sub(r"(?:hf_|esmp_)[A-Za-z0-9_\-]+", "[REDACTED_TOKEN]", text)
    text = re.sub(r"(?:token|api[_-]?key)=['\"]?[A-Za-z0-9_\-]+['\"]?", "token=[REDACTED]", text, flags=re.IGNORECASE)
    return text


def describe_remote_error(exc: BaseException, token: str | None = None) -> str:
    """One line a researcher can act on; never hides the underlying exception type or leaks tokens."""
    status = extract_status(exc)
    raw = sanitize_error_message(str(exc), token=token)
    base = f"{type(exc).__name__}: {raw}"
    if status == 451:
        return f"HTTP 451 - the endpoint is regionally restricted for this host ({base})"
    if status == 402:
        return f"HTTP 402 - inference credits exhausted for the configured token ({base})"
    if status in (401, 403):
        return f"HTTP {status} - the saved token was refused ({base})"
    if status == 429:
        return f"HTTP 429 - rate limited ({base})"
    return base


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


class RemoteFailureMemory:
    """Remembers deterministic remote failures for a short time, per (engine, host, credential)."""

    def __init__(self, ttl_seconds: float = 600.0, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: dict[tuple[str, str, str], tuple[float, str]] = {}

    @staticmethod
    def _fingerprint(token: str | None) -> str:
        # A hash, never the token: the key must not let a log line or a dump leak the credential.
        return hashlib.sha256((token or "").encode()).hexdigest()[:10]

    def _key(self, engine: str, host: str, token: str | None) -> tuple[str, str, str]:
        return (engine, host, self._fingerprint(token))

    def blocked_reason(self, engine: str, host: str, token: str | None) -> str | None:
        key = self._key(engine, host, token)
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            until, reason = entry
            if self._clock() >= until:
                del self._entries[key]
                return None
            return reason

    def record(self, engine: str, host: str, token: str | None, exc: BaseException) -> str:
        """Records only deterministic failures. Returns the readable reason either way."""
        reason = describe_remote_error(exc, token=token)
        if extract_status(exc) in PERMANENT_STATUSES:
            with self._lock:
                if len(self._entries) >= 256:
                    now = self._clock()
                    self._entries = {k: v for k, v in self._entries.items() if v[0] > now}
                self._entries[self._key(engine, host, token)] = (self._clock() + self._ttl, reason)
        return reason

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


def account_level_refusal(reason: str | None) -> str | None:
    """
    The part of another engine's remembered refusal that applies to THIS engine on the same host.

    A 401 (the token was refused) and a 402 (the account has no inference credits) are facts about the
    credential, so ESM-2 and SaProt on Hugging Face share them. A 403 or 451 can be specific to one
    model (a gated repository, a regional block on one endpoint) and is not carried across engines.
    """
    return reason if reason and reason.startswith(("HTTP 401", "HTTP 402")) else None


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
                waiter.wait()
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


class PriorityCpuGate:
    """
    Serializes CPU-bound forward passes so OpenMP threads do not oversubscribe cores,
    waking priority=0 (fast masked LLR triage) callers ahead of priority=1 (embedding / structure) callers.
    """

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._busy = False
        self._waiters: list[tuple[int, int, threading.Event]] = []
        self._seq = 0

    @contextlib.contextmanager
    def acquire(self, priority: int = 1):
        with self._cond:
            if not self._busy and not self._waiters:
                self._busy = True
                ev = None
            else:
                self._seq += 1
                ev = threading.Event()
                heapq.heappush(self._waiters, (priority, self._seq, ev))
        if ev is not None:
            ev.wait()
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


def to_full_coordinates(items: Iterable[dict] | None, start_offset: int) -> list[dict]:
    """
    Maps a local shift map from the cropped window back to full-protein numbering.

    `crop_sequence_around_mutation` returns a window starting `start_offset` residues into the
    protein; a position reported inside that window is `start_offset` short of the real residue.
    """
    mapped = []
    for item in items or []:
        copy_item = dict(item)
        position = copy_item.get("position")
        if isinstance(position, int):
            copy_item["position"] = position + start_offset
        mapped.append(copy_item)
    return mapped
