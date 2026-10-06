import { describe, it, expect, vi, afterEach } from "vitest";
import { runEsm2Eval } from "./evaluator.ts";

/**
 * These tests lock the two properties that keep fast ESM-2 triage from reporting a false
 * timeout on long proteins:
 *
 *  1. The sidecar is asked for the LLR only (`includeEmbeddings: false`), so it does not run the
 *     two unmasked WT/mutant forward passes that triage never reads.
 *  2. The request budget is scaled above the default for sequences over 500 residues, whose CPU
 *     forward pass is slower than the flat 15s the triage used to allow.
 *
 * Uniqueness of `seq` per case matters: `runEsm2Eval` memoises by sequence hash, so a repeated
 * sequence would return the cached result and never reach the fetch spy.
 */

const originalTimeout = AbortSignal.timeout.bind(AbortSignal);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubSuccessfulSidecar() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "success", llr: -2.5, verdict: "deleterious" })
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function captureTimeouts() {
  const seen: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    seen.push(ms);
    return originalTimeout(ms);
  });
  return seen;
}

describe("runEsm2Eval fast triage", () => {
  it("requests an llr-only payload and parses the verdict", async () => {
    const fetchMock = stubSuccessfulSidecar();
    const timeouts = captureTimeouts();

    const result = await runEsm2Eval("ACDEFGHIKLMNPQRSTVWY", 1, "A", "V");

    expect(result).toEqual({ llr: -2.5, verdict: "deleterious" });
    expect(timeouts).toEqual([15000]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/predict/vesm");
    // The sidecar defaults this to true; triage must opt out so it skips the embedding passes.
    expect(JSON.parse(init.body as string)).toMatchObject({ includeEmbeddings: false });
  });

  it("scales the request budget for sequences longer than 500 residues", async () => {
    const fetchMock = stubSuccessfulSidecar();
    const timeouts = captureTimeouts();
    const longSeq = "ACDEFGHIKLMNPQRSTVWY".repeat(30); // 600 residues

    await runEsm2Eval(longSeq, 1, "A", "V");

    expect(timeouts).toEqual([25000]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("memoises the result for a repeated variant", async () => {
    const fetchMock = stubSuccessfulSidecar();

    const seq = "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP";
    const first = await runEsm2Eval(seq, 3, "E", "K");
    const second = await runEsm2Eval(seq, 3, "E", "K");

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
