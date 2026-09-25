import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCoreAnalysis, streamCoreAnalysis, runStructuralAnalysis } from "./analysis-orchestrator.ts";
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
