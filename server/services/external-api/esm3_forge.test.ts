import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchEsm3StructureEval } from "./esm3_forge.ts";

/**
 * These tests lock the two properties behind the RGS9 (674 aa) ESM3 failure:
 *
 *  1. The sidecar `/predict/esm3` budget scales for long sequences instead of aborting at the flat
 *     20s the outer 120s structural budget would have allowed it to finish.
 *  2. A sidecar timeout is reported as `status: "timeout"` (the evidence layer's `upstream-busy`),
 *     not as a bare `AbortError` message that reads as a generic model failure.
 *
 * `sequenceOverride` is supplied so the function never reaches for a UniProt sequence, and
 * `wtPdbText` is left null so the Python SASA sidecar is not spawned.
 */

const originalTimeout = AbortSignal.timeout.bind(AbortSignal);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureTimeouts() {
  const seen: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    seen.push(ms);
    return originalTimeout(ms);
  });
  return seen;
}

function stubSidecarSuccess() {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "success", perturbationScores: [0.1, 0.2] })
  })));
}

describe("fetchEsm3StructureEval sidecar budget", () => {
  // 40 s = the sidecar's 15 s remote tier + the local fallback; 100 s = its 30 s remote tier + a longer fallback,
  // held 10 s under the outer 120 s structural budget. The old 20/60 s covered the local pass alone.
  it("uses the default budget for ordinary-length sequences", async () => {
    stubSidecarSuccess();
    const timeouts = captureTimeouts();

    await fetchEsm3StructureEval("TEST_SHORT", 1, "A", "V", null, null, "A".repeat(120));

    expect(timeouts).toEqual([40000]);
  });

  it("scales the budget for sequences longer than 500 residues", async () => {
    stubSidecarSuccess();
    const timeouts = captureTimeouts();

    await fetchEsm3StructureEval("TEST_LONG", 1, "A", "V", null, null, "A".repeat(674));

    expect(timeouts).toEqual([100000]);
  });
});

describe("fetchEsm3StructureEval timeout classification", () => {
  it("reports a sidecar abort as status 'timeout', not a generic error", async () => {
    const timeoutErr = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError"
    });
    vi.stubGlobal("fetch", vi.fn(async () => { throw timeoutErr; }));

    const result = await fetchEsm3StructureEval("TEST_ABORT", 1, "A", "V", null, null, "A".repeat(674)) as any;

    expect(result.status).toBe("timeout");
    expect(result.error).toMatch(/timed out/i);
  });

  it("keeps a non-timeout failure as status 'error'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }));

    const result = await fetchEsm3StructureEval("TEST_REFUSED", 1, "A", "V", null, null, "A".repeat(120)) as any;

    expect(result.status).toBe("error");
    expect(result.error).toBe("connect ECONNREFUSED");
  });
});

describe("fetchEsm3StructureEval coverage and caching", () => {
  const answer = (provenance: string, scores: number[]) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "success", perturbationScores: scores, provenance }) })));

  it("reports the share of residues that have a score, not a fixed 100", async () => {
    answer("VESM-150M (Local Fallback)", [-1, -1, 0.1, 0.2]);
    const result = await fetchEsm3StructureEval("COVERAGE_PARTIAL", 3, "A", "V", null, null, "AAAA") as any;
    expect(result.confidence.sequenceCoverage).toBe(50);
  });

  it("keeps a genuine ESM3 answer for the next request", async () => {
    answer("ESM3-Medium (Remote)", [0.1, 0.2, 0.3, 0.4]);
    await fetchEsm3StructureEval("CACHE_GENUINE", 1, "A", "V", null, null, "AAAA");
    answer("ESM3-Medium (Remote)", [9, 9, 9, 9]);
    const again = await fetchEsm3StructureEval("CACHE_GENUINE", 1, "A", "V", null, null, "AAAA") as any;
    expect(again.perturbationScores).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("does not keep a VESM stand-in, so a fixed token takes effect on the next request", async () => {
    answer("VESM-150M (Local Fallback - ESM-3 remote failed)", [0.1, 0.2, 0.3, 0.4]);
    await fetchEsm3StructureEval("CACHE_STAND_IN", 1, "A", "V", null, null, "AAAA");
    answer("ESM3-Medium (Remote)", [0.5, 0.6, 0.7, 0.8]);
    const again = await fetchEsm3StructureEval("CACHE_STAND_IN", 1, "A", "V", null, null, "AAAA") as any;
    expect(again.provenance).toBe("ESM3-Medium (Remote)");
  });
});
