import { describe, it, expect, vi, afterEach } from "vitest";
import * as sasaRunner from "../structure/sasa-runner.ts";
import { fetchEsm3StructureEval } from "./esm3_forge.ts";

vi.mock("../structure/sasa-runner.ts", { spy: true });

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
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "success", perturbationScores: [0.1, 0.2] })
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchEsm3StructureEval sidecar budget", () => {
  // 40 s = the sidecar's 15 s remote tier + the local fallback; 100 s = its 30 s remote tier + a longer fallback,
  // held 10 s under the outer 120 s structural budget. The old 20/60 s covered the local pass alone.
  it("uses the default budget for ordinary-length sequences and nests X-Budget-Ms below it", async () => {
    const fetchMock = stubSidecarSuccess();
    const timeouts = captureTimeouts();

    await fetchEsm3StructureEval("TEST_SHORT", 1, "A", "V", null, null, "A".repeat(120));

    expect(timeouts).toEqual([40000]);
    const headers = (fetchMock.mock.calls[0] as any)[1].headers;
    expect(Number(headers["X-Budget-Ms"])).toBe(30000);
    expect(Number(headers["X-Budget-Ms"])).toBeLessThan(timeouts[0]);
  });

  it("scales the budget for sequences longer than 500 residues and nests X-Budget-Ms below it", async () => {
    const fetchMock = stubSidecarSuccess();
    const timeouts = captureTimeouts();

    await fetchEsm3StructureEval("TEST_LONG", 1, "A", "V", null, null, "A".repeat(674));

    expect(timeouts).toEqual([100000]);
    const headers = (fetchMock.mock.calls[0] as any)[1].headers;
    expect(Number(headers["X-Budget-Ms"])).toBe(90000);
    expect(Number(headers["X-Budget-Ms"])).toBeLessThan(timeouts[0]);
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

  it("keys cache by template context and avoids fabricating low confidence or loop SSE when unmeasured", async () => {
    vi.spyOn(sasaRunner, "executeSasaEval").mockResolvedValue({ status: "error", message: "SASA unavailable" });
    const expPdb = [
      "ATOM      1  CA  ALA B   2       1.000   1.000   1.000  1.00 88.00           C",
      "ENDMDL",
      "ATOM      2  CA  ALA B   2       1.000   1.000   1.000  1.00 12.00           C"
    ].join("\n");
    answer("ESM3-Medium (Remote)", [0.1, 0.2, 0.3, 0.4]);
    const expRes = await fetchEsm3StructureEval("CTX_CACHE", 2, "A", "V", expPdb, null, "AAAA", "experimental") as any;
    expect(expRes.confidence.level).toBeNull();
    expect(expRes.confidence.plddt).toBeNull();
    expect(expRes.microenvironments).toContain("Secondary structure not measured");
    expect(expRes.microenvironments).not.toContain("Loop / Flexible Turn");

    answer("ESM3-Medium (Remote)", [0.2, 0.3, 0.4, 0.5]);
    const afRes = await fetchEsm3StructureEval("CTX_CACHE", 2, "A", "V", expPdb, null, "AAAA", "alphafold") as any;
    expect(afRes.confidence.level).toBe("high");
    expect(afRes.confidence.plddt).toBe(88);
  });

  it("refuses synthetic poly-A fallback when no sequence can be resolved and preserves sidecar JSON errors", async () => {
    const fetchMock = vi.fn(async (_url?: unknown) => ({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    }));
    vi.stubGlobal("fetch", fetchMock as any);

    const noSeq = await fetchEsm3StructureEval("NO_UNIPROT_SEQ", 5, "A", "V", null, null, null) as any;
    expect(noSeq.status).toBe("error");
    expect(noSeq.error).toMatch(/No amino-acid sequence/i);
    // Never invokes /predict/esm3 with a fabricated "MAAAAA..." string
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/predict/esm3"))).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "error", error: "ESM3 weights not installed", remoteEngineNote: "HTTP 401" })
    })) as any);
    const jsonErr = await fetchEsm3StructureEval("JSON_ERR", 2, "A", "V", null, null, "AAAA") as any;
    expect(jsonErr.status).toBe("error");
    expect(jsonErr.error).toBe("ESM3 weights not installed");
    expect(jsonErr.remoteEngineNote).toBe("HTTP 401");
  });

  it("never attributes an unnamed ESM3 response to ESM3-Medium and labels remote-failed fallbacks as VESM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "success",
        perturbationScores: [0.1, 0.2, 0.3, 0.4],
        remoteEngineNote: "forge: HTTP 451",
      })
    })) as any);
    const fallback = await fetchEsm3StructureEval("UNNAMED_FALLBACK", 1, "A", "V", null, null, "AAAA") as any;
    expect(fallback.provenance).toBe("VESM-150M (Local Fallback - ESM-3 remote failed)");

    // Unnamed VESM-style fallback must not poison the genuine ESM3 cache.
    answer("ESM3-Medium (Remote)", [0.8, 0.7, 0.6, 0.5]);
    const real = await fetchEsm3StructureEval("UNNAMED_FALLBACK", 1, "A", "V", null, null, "AAAA") as any;
    expect(real.provenance).toBe("ESM3-Medium (Remote)");
    expect(real.perturbationScores).toEqual([0.8, 0.7, 0.6, 0.5]);
  });
});
