import { describe, it, expect, vi } from "vitest";
import { readJsonWithTimeout } from "../httpBody.ts";

/**
 * The body read must have its own deadline.
 *
 * WHY THIS EXISTS
 * ---------------
 * `fetch` timeouts cover the HEADERS and are cleared the moment the response resolves — on the
 * first byte. `await res.json()` therefore has no deadline, and a server that sends headers and then
 * stalls hangs the caller forever. Review measured it: with `timeout: 400`, the fetch resolved in
 * 14 ms and `res.json()` was still pending after 3000 ms.
 *
 * That gap mattered because an earlier change deleted the FoldX pipeline's absolute watchdog. The
 * watchdog could not tell a queued job from a running one, which is why it went — but it also, as a
 * side effect, bounded the whole operation including body reads, and nothing replaced that.
 */

/** A response whose body never resolves — the shape a stalled connection produces. */
function stallingResponse(): Response {
  return { json: () => new Promise(() => {}) } as unknown as Response;
}

/** A response whose body resolves normally. */
function okResponse(value: unknown): Response {
  return { json: () => Promise.resolve(value) } as unknown as Response;
}

/** A response whose body rejects, as invalid JSON does. */
function badResponse(): Response {
  return { json: () => Promise.reject(new Error("Unexpected token < in JSON")) } as unknown as Response;
}

describe("readJsonWithTimeout", () => {
  it("returns the parsed body when it arrives in time", async () => {
    await expect(readJsonWithTimeout(okResponse({ a: 1 }), 1000)).resolves.toEqual({ a: 1 });
  });

  it("rejects when the body never arrives", async () => {
    // The regression this guards: without a deadline this promise never settles, so the FoldX poll
    // loop never reaches its own phase check and the spinner stays up indefinitely.
    await expect(readJsonWithTimeout(stallingResponse(), 30)).rejects.toThrow(/body did not arrive/);
  });

  it("reports the body specifically, not as a generic timeout", async () => {
    // "The request timed out" is indistinguishable from a header timeout and sends people looking in
    // the wrong place; the message must name what actually failed to arrive.
    await expect(readJsonWithTimeout(stallingResponse(), 30)).rejects.toThrow(/headers but its body/);
  });

  it("propagates a parse failure rather than masking it as a timeout", async () => {
    await expect(readJsonWithTimeout(badResponse(), 1000)).rejects.toThrow(/Unexpected token/);
  });

  it("clears its timer, so a completed read leaves nothing pending", async () => {
    vi.useFakeTimers();
    try {
      const promise = readJsonWithTimeout(okResponse({ ok: true }), 60_000);
      await expect(promise).resolves.toEqual({ ok: true });
      // If the timer leaked, this would fire a rejection into an already-settled promise (a no-op)
      // but would also keep the event loop alive; the assertion is that the timer count is back to 0.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
