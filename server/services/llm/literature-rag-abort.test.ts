import { describe, it, expect, vi, afterEach } from "vitest";
import { syncLiteratureForGene } from "./literature-rag.ts";

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

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
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
});
