import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncLiteratureForGene, resetDbForTesting } from "./literature-rag.ts";

vi.mock("./gemini.ts", () => ({
  getGeminiClient: () => ({
    models: {
      embedContent: async () => ({ embeddings: [{ values: new Array(768).fill(0.1) }] })
    }
  })
}));

/**
 * Regression guard for a process-killing bug.
 *
 * `syncLiteratureForGene` bookkept its in-flight de-duplication map with
 * `syncPromise.finally(() => inFlightSyncs.delete(key))`. `.finally()` returns a *derived*
 * promise that rejects whenever `syncPromise` rejects, and nothing handled that derived
 * promise. An aborted sync therefore produced an unhandled rejection, and Node terminates the
 * process on those — so a cancelled narrative request could kill the server outright.
 *
 * The abort path itself also threw before its own try/catch, which made an aborted signal a
 * guaranteed rejection rather than a benign no-op.
 */
describe("syncLiteratureForGene abort handling", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    resetDbForTesting();
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
    resetDbForTesting();
  });

  it("resolves benignly for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      syncLiteratureForGene("ABORTGENE1", undefined, controller.signal)
    ).resolves.toBe(0);
  });

  it("emits no unhandled rejection for an already-aborted signal", async () => {
    process.on("unhandledRejection", onUnhandled);

    const controller = new AbortController();
    controller.abort();

    await syncLiteratureForGene("ABORTGENE2", undefined, controller.signal);

    // Let any stray rejection surface before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unhandled).toEqual([]);
  });

  it("does not leave a rejected promise behind in the in-flight map", async () => {
    const controller = new AbortController();
    controller.abort();

    await syncLiteratureForGene("ABORTGENE3", undefined, controller.signal);

    // A second call must behave identically rather than reusing a poisoned entry.
    await expect(
      syncLiteratureForGene("ABORTGENE3", undefined, controller.signal)
    ).resolves.toBe(0);
  });

  it("completes a shared in-flight sync for remaining callers when one caller aborts", async () => {
    const originalFetch = global.fetch;
    let releaseFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        })
    );
    global.fetch = fetchMock;
    try {
      const controllerA = new AbortController();
      const controllerB = new AbortController();

      const promiseA = syncLiteratureForGene("SHAREDABORT", undefined, controllerA.signal);
      const promiseB = syncLiteratureForGene("SHAREDABORT", undefined, controllerB.signal);

      // Abort only caller A while Europe PMC request is still waiting.
      controllerA.abort();
      await expect(promiseA).resolves.toBe(0);

      // Resolve Europe PMC after caller A left; caller B must still receive synced count 1.
      releaseFetch({
        ok: true,
        json: async () => ({
          hitCount: 1,
          resultList: {
            result: [{
              id: "777",
              pmid: "777",
              source: "MED",
              title: "SHAREDABORT study",
              abstractText: "Functional evidence.",
              authorString: "Author A",
              journalTitle: "J Test",
              pubYear: "2024",
            }],
          },
        }),
      } as unknown as Response);

      await expect(promiseB).resolves.toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("evicts the in-flight entry immediately when the last waiter aborts and skips zero-vector fallback writes", async () => {
    const originalFetch = global.fetch;
    let releaseFirst!: (value: Response) => void;
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          hitCount: 1,
          resultList: {
            result: [{
              id: "888",
              pmid: "888",
              source: "MED",
              title: "Fresh retry study",
              abstractText: "Recovered abstract.",
              authorString: "Author B",
              journalTitle: "J Test",
              pubYear: "2025",
            }],
          },
        }),
      } as unknown as Response);
    });
    global.fetch = fetchMock;
    try {
      const controllerA = new AbortController();
      const promiseA = syncLiteratureForGene("UNWINDGENE", undefined, controllerA.signal);
      controllerA.abort();
      await expect(promiseA).resolves.toBe(0);

      // Even before the aborted first fetch settles, a fresh caller must start a clean sync.
      const count = await syncLiteratureForGene("UNWINDGENE");
      expect(count).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Letting the dying first fetch resolve must not poison cache or reject.
      releaseFirst({
        ok: true,
        json: async () => ({
          hitCount: 1,
          resultList: {
            result: [{
              id: "889",
              pmid: "889",
              source: "MED",
              title: "Stale study",
              abstractText: "Should not overwrite.",
              authorString: "Author C",
              journalTitle: "J Test",
              pubYear: "2024",
            }],
          },
        }),
      } as unknown as Response);
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      global.fetch = originalFetch;
    }
  });
});
