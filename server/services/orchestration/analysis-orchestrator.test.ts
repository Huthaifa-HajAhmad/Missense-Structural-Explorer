import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCoreAnalysis, streamCoreAnalysis, runStructuralAnalysis } from "./analysis-orchestrator.ts";
import { STREAM_HEARTBEAT_MS } from "../../../src/shared/timeouts.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

vi.mock("../structure/structural-model-fetcher.ts", () => ({
  fetchStructuralModelData: vi.fn(async () => ({
    esm3Eval: { score: -4.5 },
    esmcEval: { score: -2.1 },
    esm2Eval: { score: -3.8 },
    saprotEval: { score: -1.9 },
    serviceStatus: { esm3: "ok", esmc: "ok", esm2: "ok", saprot: "ok" }
  }))
}));

const mockCoreData = {
  clinvar: { classification: "Pathogenic" },
  conservationData: { revel: 0.8 },
  stringInteractions: [],
  gnomadFrequency: { maxAF: 0.0001 },
  disruptionPredictor: { level: "high", reason: "disruption" },
  esm2: { llr: -5.0 },
  predictorData: { caddPhred: 25 },
  pdbMapping: { pdbId: "2PAH" },
  gnomadConstraint: { isPP2Constrained: true },
  uniprotFeatures: { features: [] },
  ruleBasedInsights: { acmgVerdict: "Pathogenic", acmgCriteria: [] },
  aouFrequency: null,
  resolvedPdbId: "2PAH",
  resolvedPdbSource: "RCSB PDB" as const,
  serviceStatus: {
    clinvar: "ok",
    predictorData: "ok",
    conservationData: "ok",
    stringInteractions: "ok",
    disruptionPredictor: "ok",
    esm2: "ok",
    gnomadConstraint: "ok",
    gnomadFrequency: "ok",
    uniprotFeatures: "ok",
    pdbMapping: "ok"
  },
  serviceTimings: {}
};

vi.mock("../external-api/core-data-fetcher.ts", () => ({
  fetchCoreVariantData: vi.fn(async () => mockCoreData)
}));

vi.mock("../external-api/clinvar.ts", () => ({
  fetchClinVarData: vi.fn(async () => ({ classification: "Pathogenic" }))
}));

vi.mock("../prediction/index.ts", () => ({
  fetchPredictorData: vi.fn(async () => ({ caddPhred: 25 }))
}));

const mockDb: any = {
  getVariantAnalysisAsync: vi.fn(async () => null),
  saveVariantAnalysisAsync: vi.fn(async () => {}),
  getExternalCacheAsync: vi.fn(async () => null),
  saveExternalCacheAsync: vi.fn(async () => {}),
  getVariantAnalysis: vi.fn(() => null),
  saveVariantAnalysis: vi.fn(() => {}),
  getExternalCache: vi.fn(() => null),
  saveExternalCache: vi.fn(() => {})
};

vi.mock("../infra/analysis-db.ts", () => ({
  AnalysisDatabase: {
    getInstance: vi.fn(() => mockDb)
  }
}));

describe("Analysis Orchestrator Unit Tests", () => {
  const baseContext: ParsedVariantContext = {
    gene: "PAH",
    variant: "p.Arg408Trp",
    uniprotId: "P00439",
    originalNotation: "p.Arg408Trp",
    acmgWeighting: "standard",
    sequence: "MKVLIVGLGNCGVFSLLDKN",
    pos: 408,
    residueIndex: "408",
    wildType: "Arg",
    mutant: "Trp",
    wt1Letter: "R",
    mut1Letter: "W"
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run synchronous core analysis and persist result to cache", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);

    const result = await runCoreAnalysis(baseContext);

    expect(result).toBeDefined();
    expect(result.metadata.gene).toBe("PAH");
    expect(result.metadata.variant).toBe("p.Arg408Trp");
    expect(result.clinvar.classification).toBe("Pathogenic");
    expect(result.ruleBasedInsights.acmgVerdict).toBe("Pathogenic");
    expect(mockDb.saveVariantAnalysisAsync).toHaveBeenCalled();
  });

  it("should return cached analysis when valid SQLite cache entry exists", async () => {
    const cachedPayload = {
      metadata: { gene: "PAH", variant: "p.Arg408Trp" },
      clinvar: { classification: "Pathogenic" },
      conservationData: { available: true, dann: 0.9, bayesdel: 0.5, clinpred: 0.8, eigenPhred: 12.0 },
      ruleBasedInsights: { acmgVerdict: "Pathogenic" }
    };
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: cachedPayload, id: "1" });

    const result = await runCoreAnalysis(baseContext);

    expect(result).toBeDefined();
    expect(result.metadata.gene).toBe("PAH");
    // Should NOT have called fetchCoreVariantData because cache hit occurred
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).not.toHaveBeenCalled();
  });

  it("should stream progressive analysis chunks to onChunk callback", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);
    const chunks: any[] = [];

    const result = await streamCoreAnalysis(baseContext, (chunk) => {
      chunks.push(chunk);
    });

    expect(result).toBeDefined();
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Chunk 1: fast triage preview
    expect(chunks[0].chunkIndex).toBe(1);
    expect(chunks[0].data.clinvar).toBeDefined();
    // The preview carries the sequence too: the client merges this chunk before the final
    // payload arrives, and the report's re-synthesis needs it from whichever chunk it has.
    expect(chunks[0].data.metadata.sequence).toBe("MKVLIVGLGNCGVFSLLDKN");
    // Chunk 2: full complete payload
    expect(chunks[1].chunkIndex).toBe(2);
    expect(chunks[1].isFinal).toBe(true);
    expect(chunks[1].data.metadata.gene).toBe("PAH");
  });

  it("should respect abort signals during streaming", async () => {
    const controller = new AbortController();
    controller.abort();

    const chunks: any[] = [];
    const result = await streamCoreAnalysis(baseContext, (chunk) => {
      chunks.push(chunk);
    }, controller.signal);

    expect(result).toBeNull();
    expect(chunks.length).toBe(0);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * THE STREAM CONTRACT — previews, liveness, and a final frame that is last
   * ─────────────────────────────────────────────────────────────────────────────
   * The route used to write two frames: "ClinVar + predictors", then everything, the second only
   * after the SLOWEST of eleven sources settled. A client that gave up after 30 s of silence then
   * killed runs the server considered healthy (the server's own per-stage budget is 45 s), and no
   * source could paint before the slowest one had finished.
   *
   * These tests pin the three things a consumer relies on: previews arrive per source, heartbeats
   * arrive even while nothing has settled, and exactly one frame is final and it is the last one.
   */
  describe("stream framing", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("emits per-source previews before a single final frame", async () => {
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);
      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      // `as any`: the real signature's 4th parameter is the progress listener, and the fixture is a
      // deliberately partial CoreAnalysisData (the same shape the module-scope mock uses).
      (vi.mocked(fetchCoreVariantData) as any).mockImplementationOnce(async (_ctx: any, _t: any, _p: any, onPartial: any) => {
        // Two sources settle at different instants; each must reach the wire immediately.
        onPartial({
          data: { conservationData: { revel: 0.9 }, serviceStatus: { conservationData: "ok", stringInteractions: "pending" }, serviceTimings: { conservationData: 12 } },
          serviceStatus: { conservationData: "ok", stringInteractions: "pending" },
          serviceTimings: { conservationData: 12 }
        });
        onPartial({
          data: { stringInteractions: [{ preferredName: "QDPR" }], serviceStatus: { conservationData: "ok", stringInteractions: "ok" }, serviceTimings: { conservationData: 12, stringInteractions: 30 } },
          serviceStatus: { conservationData: "ok", stringInteractions: "ok" },
          serviceTimings: { conservationData: 12, stringInteractions: 30 }
        });
        return mockCoreData;
      });

      const chunks: any[] = [];
      const result = await streamCoreAnalysis(baseContext, (chunk) => { chunks.push(chunk); });

      expect(result).toBeDefined();
      // Chunk 1 is itself a preview (the fast triage frame), so the per-source previews are the
      // non-final frames after it.
      const previews = chunks.filter(c => !c.isFinal && c.type !== "heartbeat" && c.chunkIndex !== 1);
      const finals = chunks.filter(c => c.isFinal);

      expect(previews.length, "one preview per settled source").toBe(2);
      expect(previews[0].data.conservationData).toEqual({ revel: 0.9 });
      expect(previews[1].data.stringInteractions).toEqual([{ preferredName: "QDPR" }]);
      /**
       * NOTE: the status MAP's content is asserted in `core-data-fetcher.test.ts`, not here.
       *
       * This mock IS the emitter, so a `"pending"` literal in it would be the fixture talking to
       * itself — the map is produced by `fetchCoreVariantData`, and only a test that runs the real
       * emitter can pin it. What belongs here is the framing: that whatever the emitter publishes
       * reaches the wire in order, unframed and unaltered.
       */
      expect(previews[0].data.serviceStatus).toBeDefined();
      expect(previews[1].data.serviceStatus).toBeDefined();
      // Preview indices increase, and the final frame comes after all of them.
      expect(previews[0].chunkIndex).toBeLessThan(previews[1].chunkIndex);
      expect(finals.length).toBe(1);
      expect(chunks[chunks.length - 1]).toBe(finals[0]);
      expect(finals[0].chunkIndex).toBeGreaterThan(previews[1].chunkIndex);
      expect(finals[0].data.metadata.gene).toBe("PAH");
      // Chunk 1 (the fast triage) is still first and still not final.
      expect(chunks[0].chunkIndex).toBe(1);
      expect(chunks[0].isFinal).toBe(false);
    });

    it("heartbeats while a source is still settling, and stops when the run ends", async () => {
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);
      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      (vi.mocked(fetchCoreVariantData) as any).mockImplementationOnce(async () => {
        // Long enough to cross several heartbeat intervals.
        await new Promise(resolve => setTimeout(resolve, STREAM_HEARTBEAT_MS * 3 + 50));
        return mockCoreData;
      });

      vi.useFakeTimers();
      const chunks: any[] = [];
      const run = streamCoreAnalysis(baseContext, (chunk) => { chunks.push(chunk); });
      await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_MS * 3 + 200);
      await run;

      const heartbeats = chunks.filter(c => c.type === "heartbeat");
      expect(
        heartbeats.length,
        "a healthy but silent stream must still prove it is alive"
      ).toBeGreaterThanOrEqual(2);
      // A heartbeat carries no data: merging one would change the shape of the analysis result.
      expect(heartbeats.every(h => h.data === undefined)).toBe(true);
      // ...and the interval is cleared, or every request leaks a timer for the life of the process.
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  /**
   * The SECOND predictor call site.
   *
   * `fetchCoreVariantData` queries the predictor when the caller did not pre-fetch it, but this
   * stream's fast triage queries it FIRST (to emit chunk 1 without waiting on the other nine
   * sources) and hands the promise down as `prefetched.predictorPromise`. Both sites built the
   * coordinate by hand from the SUBMITTED pair before, so both had to be converted; pinning only
   * the core-data-fetcher one left this path handing GRCh37 coordinates to a GRCh38-only index
   * (the wrong-locus hazard: a coinciding reference base scores a different locus and the numbers
   * are attributed to this variant).
   */
  it("pairs the fast-triage predictor query with the lift-verified canonical build", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);
    const { fetchPredictorData } = await import("../prediction/index.ts");

    const liftedContext: ParsedVariantContext = {
      ...baseContext,
      assembly: "GRCh37",
      genomicCoordinates: "1-1256452-C-A",
      resolvedAssembly: "GRCh38",
      liftedGenomicCoordinates: "1-1321072-C-A"
    };

    await streamCoreAnalysis(liftedContext, () => {});

    expect(vi.mocked(fetchPredictorData)).toHaveBeenCalled();
    const coordinate = vi.mocked(fetchPredictorData).mock.calls[0][3];
    expect(coordinate).toEqual({ chrom: "1", pos: 1321072, ref: "C", alt: "A", assembly: "GRCh38" });
  });

  it("should execute runStructuralAnalysis and merge deep model evaluations", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);

    const result = await runStructuralAnalysis(baseContext, "mock-biohub-token", "mock-hf-token");

    expect(result).toBeDefined();
    expect((result.esm3Eval as any)?.score).toBe(-4.5);
    expect((result.esmcEval as any)?.score).toBe(-2.1);
    expect((result.esm2Eval as any)?.score).toBe(-3.8);
    expect((result.saprotEval as any)?.score).toBe(-1.9);
    expect(result.serviceStatus.esm3).toBe("ok");
    expect(result.ruleBasedInsights).toBeDefined();
    expect(mockDb.saveVariantAnalysisAsync).toHaveBeenCalled();
  });

  it("should invalidate cached analysis when HF token is provided but cached data lacks GPN-Star", async () => {
    const cachedPayloadLackingGpn = {
      metadata: { gene: "PAH", variant: "p.Arg408Trp" },
      clinvar: { classification: "Pathogenic" },
      conservationData: {
        available: true,
        dann: 0.9,
        bayesdel: 0.5,
        clinpred: 0.8,
        eigenPhred: 12.0,
        gpnStar: null,
        gpnStarStatus: "token_required"
      }
    };
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: cachedPayloadLackingGpn, id: "1" });

    const contextWithHfToken: ParsedVariantContext = {
      ...baseContext,
      hfToken: "hf_test_token"
    };

    const result = await runCoreAnalysis(contextWithHfToken);

    expect(result).toBeDefined();
    // Cache was invalidated -> fetched fresh core data
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).toHaveBeenCalled();
  });

  it("should invalidate stale cache when AlphaGenome API key is provided and cached payload lacks live AlphaGenome score", async () => {
    const cachedPayloadLackingAlpha = {
      metadata: { gene: "CNNM2", variant: "p.Ser489Cys" },
      clinvar: { classification: "Uncertain Significance" },
      conservationData: {
        available: true,
        dann: 0.9,
        bayesdel: 0.5,
        clinpred: 0.8,
        eigenPhred: 12.0,
        alphagenome: null
      }
    };
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: cachedPayloadLackingAlpha, id: "2" });

    const contextWithAlphaKey: ParsedVariantContext = {
      ...baseContext,
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      alphagenomeApiKey: "ag_secret_key_123"
    };

    const result = await runCoreAnalysis(contextWithAlphaKey);

    expect(result).toBeDefined();
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).toHaveBeenCalled();
  });

  it("should NOT invalidate cache for an already-queried unindexed variant", async () => {
    const cachedPayloadUnindexed = {
      metadata: { gene: "CNNM2", variant: "p.Ser489Cys" },
      clinvar: { classification: "Uncertain Significance" },
      conservationData: {
        available: true,
        dann: 0.9,
        bayesdel: 0.5,
        clinpred: 0.8,
        eigenPhred: 12.0,
        alphagenome: {
          status: "unavailable",
          aviPhred: null,
          message: "Variant not indexed in AlphaGenome Atlas."
        }
      }
    };
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: cachedPayloadUnindexed, id: "3" });

    const contextWithAlphaKey: ParsedVariantContext = {
      ...baseContext,
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      alphagenomeApiKey: "ag_secret_key_123"
    };

    const result = await runCoreAnalysis(contextWithAlphaKey);

    expect(result).toBeDefined();
    // Cache was NOT invalidated -> returned cached payload
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).not.toHaveBeenCalled();
  });

  /**
   * Review M1: a build refusal is TRANSIENT (the lift may succeed on the next attempt), so
   * honoring it must be time-bounded — unlike "not indexed", which is a permanent property
   * of the Atlas.
   */
  const refusedPayload = {
    metadata: { gene: "CNNM2", variant: "p.Ser489Cys" },
    clinvar: { classification: "Uncertain Significance" },
    conservationData: {
      available: true,
      dann: 0.9,
      bayesdel: 0.5,
      clinpred: 0.8,
      eigenPhred: 12.0,
      alphagenome: null,
      assemblyRefusals: [
        { source: "alphagenome", reason: "alphagenome covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not scored." }
      ]
    }
  };
  const alphaKeyContext: ParsedVariantContext = {
    ...baseContext,
    gene: "CNNM2",
    variant: "p.Ser489Cys",
    alphagenomeApiKey: "ag_secret_key_123"
  };

  it("honors a RECENT build refusal without thrashing (no recompute)", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({
      payload: refusedPayload, id: "4", updatedAt: new Date().toISOString()
    });

    await runCoreAnalysis(alphaKeyContext);

    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).not.toHaveBeenCalled();
  });

  it("re-attempts after the refusal window lapses — a transient refusal must not pin a blank forever", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({
      payload: refusedPayload, id: "5",
      updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() // 7h ago (> 6h window)
    });

    await runCoreAnalysis(alphaKeyContext);

    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).toHaveBeenCalled();
  });
});
