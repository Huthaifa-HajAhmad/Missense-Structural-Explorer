import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchProgressivePpi } from "../biophysicalService";
import { clearClientVariantCache, getCachedVariant, setCachedVariant } from "../variantCache";

/**
 * The Interfaces & PPI partner lookups are prefetched with the assembly, exactly like
 * `fetchProgressiveMultimer`. Before this, the tab issued the request on mount, so a reader who
 * opened it long after the run finished watched the Partners/STRING/Curation trace steps start cold.
 * These pin that the lookups are stored under the `ppi` stage and written through to the cache.
 */
function sink(result: any) {
  let state: any = { isLoading: false, error: null, result };
  const setAnalysisState = vi.fn((input: any) => {
    state = typeof input === "function" ? input(state) : input;
    return state;
  });
  return { setAnalysisState, get: () => state };
}

const params = { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" };
const payload = {
  status: "success",
  gene: "SOD1",
  variant: "p.Ala5Val",
  uniprotId: "P00441",
  lookups: { uniprot: "ok", intact: "ok", stringPhysical: "ok", stringPartners: "ok" },
  string: { physical: [], functional: [], limit: 500, minScore: 0.15 },
};

describe("fetchProgressivePpi", () => {
  beforeEach(() => clearClientVariantCache());

  it("stores the lookups as ppiBindingData under the ppi stage", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const s = sink({ metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" } });
    await fetchProgressivePpi(params, fetchWithAuth, new AbortController().signal, s.setAnalysisState, 1, () => 1);

    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/v1/ppi/binding-affinity",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(fetchWithAuth.mock.calls[0][1].body)).toEqual(params);
    expect(s.get().result.ppiBindingData).toEqual(payload);
    expect(s.get().result.metadata.pipelineStages.ppi).toBe("complete");
  });

  it("writes the lookups through to the stored cache", async () => {
    setCachedVariant("SOD1", "p.Ala5Val", "P00441", {
      analysisResult: { metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" } },
    });
    const fetchWithAuth = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const s = sink({ metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" } });
    await fetchProgressivePpi(params, fetchWithAuth, new AbortController().signal, s.setAnalysisState, 1, () => 1);

    expect(getCachedVariant("SOD1", "p.Ala5Val")?.analysisResult.ppiBindingData).toEqual(payload);
  });

  it("marks the ppi stage error and stores no payload when the lookup fails", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    const s = sink({ metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" } });
    await fetchProgressivePpi(params, fetchWithAuth, new AbortController().signal, s.setAnalysisState, 1, () => 1);

    expect(s.get().result.ppiBindingData).toBeUndefined();
    expect(s.get().result.metadata.pipelineStages.ppi).toBe("error");
  });

  it("never issues a second request for the same variant (shared dedupe key)", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const s = sink({ metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" } });
    await Promise.all([
      fetchProgressivePpi(params, fetchWithAuth, new AbortController().signal, s.setAnalysisState, 1, () => 1),
      fetchProgressivePpi(params, fetchWithAuth, new AbortController().signal, s.setAnalysisState, 1, () => 1),
    ]);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });
});
