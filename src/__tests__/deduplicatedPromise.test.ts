import { describe, it, expect, vi } from "vitest";
import {
  getDeduplicatedPromise,
} from "../variantAnalysisUtils";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A RE-QUERY MUST NOT INHERIT THE ABORTED REQUEST IT REPLACED
 * ─────────────────────────────────────────────────────────────────────────────
 * `useAnalysisPipeline.executeAnalysis` aborts the previous run and then synchronously starts the
 * next one, so for any repeated query — the same preset clicked twice, Search pressed again, a
 * history row re-opened — the aborted run's in-flight entry was still in the dedup table when the
 * new run asked for it. The new run was handed the OLD promise, already doomed by the abort, and
 * failed instantly with "Biophysical analysis stream aborted by client." while its own signal was
 * alive. Measured against the real function before the fix: run 2 issued ZERO requests.
 *
 * The table is module-level, so these keys are deliberately unique per test.
 */
describe("getDeduplicatedPromise", () => {
  it("reuses an in-flight request for the same key while its run is alive", async () => {
    const creator = vi.fn(() => new Promise<string>(resolve => setTimeout(() => resolve("first"), 5)));
    const controller = new AbortController();

    const a = getDeduplicatedPromise("dedup-alive", creator, controller.signal);
    const b = getDeduplicatedPromise("dedup-alive", creator, controller.signal);

    expect(creator, "the second caller must not issue its own request").toHaveBeenCalledTimes(1);
    expect(await a).toBe("first");
    expect(await b).toBe("first");
  });

  it("issues a NEW request when the previous one's run was aborted", async () => {
    const controller = new AbortController();
    const abortedCreator = vi.fn(() => new Promise<string>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("aborted run")), { once: true });
    }));
    const freshCreator = vi.fn().mockResolvedValue("second run");

    const doomed = getDeduplicatedPromise("dedup-abort", abortedCreator, controller.signal);
    doomed.catch(() => {});
    await Promise.resolve();

    controller.abort();

    const next = getDeduplicatedPromise("dedup-abort", freshCreator, new AbortController().signal);

    expect(abortedCreator).toHaveBeenCalledTimes(1);
    expect(freshCreator, "the replacement run must make its own request").toHaveBeenCalledTimes(1);
    await expect(next).resolves.toBe("second run");
  });

  it("evicts the entry on abort even before the promise settles", async () => {
    const controller = new AbortController();
    let settle: (value: string) => void = () => {};
    const creator = vi.fn(() => new Promise<string>(resolve => { settle = resolve; }));
    const replacement = vi.fn().mockResolvedValue("replacement");

    const first = getDeduplicatedPromise("dedup-evict", creator, controller.signal);
    controller.abort();

    // Same key, still-live signal: the aborted entry must be gone, not merely flagged.
    const second = getDeduplicatedPromise("dedup-evict", replacement, new AbortController().signal);
    expect(creator).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledTimes(1);

    settle("late first");
    await expect(first).resolves.toBe("late first");
    await expect(second).resolves.toBe("replacement");
  });

  it("keeps the two-argument form working, and clears the entry once it settles", async () => {
    const creator = vi.fn().mockResolvedValue("value");
    await expect(getDeduplicatedPromise("dedup-legacy", creator)).resolves.toBe("value");
    // Settled entries are deleted, so the next caller starts a new request rather than reading a
    // resolved promise forever.
    await expect(getDeduplicatedPromise("dedup-legacy", creator)).resolves.toBe("value");
    expect(creator).toHaveBeenCalledTimes(2);
  });

  it("does not let the settling of a replaced request delete its replacement's entry", async () => {
    const controller = new AbortController();
    let failFirst: (err: Error) => void = () => {};
    const firstCreator = vi.fn(() => new Promise<string>((_, reject) => { failFirst = reject; }));

    const first = getDeduplicatedPromise("dedup-identity", firstCreator, controller.signal);
    first.catch(() => {});
    controller.abort();

    let resolveSecond: (value: string) => void = () => {};
    const secondCreator = vi.fn(() => new Promise<string>(resolve => { resolveSecond = resolve; }));
    const second = getDeduplicatedPromise("dedup-identity", secondCreator, new AbortController().signal);

    // The first request now fails, long after its entry was replaced.
    failFirst(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();

    const thirdCreator = vi.fn().mockResolvedValue("third");
    const third = getDeduplicatedPromise("dedup-identity", thirdCreator, new AbortController().signal);
    expect(
      thirdCreator,
      "the replacement's in-flight entry was deleted by the request it replaced"
    ).not.toHaveBeenCalled();

    resolveSecond("second");
    await expect(second).resolves.toBe("second");
    await expect(third).resolves.toBe("second");
  });
});
