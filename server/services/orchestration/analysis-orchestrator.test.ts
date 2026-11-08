vi.mock("../structure/structure-fetcher.ts", () => ({ fetchAlphafoldPdb: vi.fn(async () => null) }));
vi.mock("../structure/pocket/disruption.ts", () => ({ predictStructuralDisruption: vi.fn(async () => ({ level: "low", plddt: 90, reason: "Measured", rsa: 0.6, burialStatus: "surface" })) }));
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCoreAnalysis, isStaleCachedPayload, streamCoreAnalysis, runStructuralAnalysis, streamStructuralAnalysis } from "./analysis-orchestrator.ts";
import { payloadIdentityRecordOf } from "./core-identity.ts";
import { LOCUS_POLICY_VERSION } from "../../../src/shared/locusResolution.ts";
import { STREAM_HEARTBEAT_MS } from "../../../src/shared/timeouts.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

vi.mock("../structure/structural-model-fetcher.ts", () => ({
  fetchStructuralModelData: vi.fn(async () => ({
    esm3Eval: { score: -4.5 },
    esmcEval: { score: -2.1 },
    esm2Eval: { score: -3.8 },
    saprotEval: { score: -1.9 },
    /**
     * The structural ESM-2 650M outcome travels as `esm2Eval`. The `esm2` entry is kept deliberately
     * in this fixture as a LEGACY ALIAS: the merge must refuse to let it overwrite the core run's own
     * VESM-150M status, which is what used to happen (both producers used that one key).
     */
    serviceStatus: { esm3: "ok", esmc: "ok", esm2Eval: "ok", saprot: "ok", esm2: "timeout" },
    /** The structural stage's own spans, under structural names (never the core's). */
    structuralTimings: { esm3: 11, esmc: 12, esm2Eval: 13, saprot: 14, pdbText: 9 },
    structuralTimingOffsets: { esm3: 20, esmc: 21, esm2Eval: 22, saprot: 24, pdbText: 9 }
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

  beforeEach(async () => {
    vi.clearAllMocks();
    // The singleflight registry is process-local state: a run left in flight by one test must not be
    // joined by the next.
    const { resetCoreSingleflightForTests } = await import("./core-singleflight.ts");
    resetCoreSingleflightForTests();
  });

  /**
   * A persisted row as the CURRENT server writes it: the payload plus the identity record the guard
   * verifies. Fixtures that assert a cache HIT must be stamped — an unstamped row is refused by
   * design, recomputed once, and stamped by that recompute.
   */
  const stamp = (payload: any, context: ParsedVariantContext = baseContext) => ({
    ...payload,
    _internal: { ...(payload?._internal || {}), coreIdentity: payloadIdentityRecordOf(context) }
  });

  it("refreshes missing burial during structural retry and returns it to the client", async () => {
    const { fetchAlphafoldPdb } = await import("../structure/structure-fetcher.ts");
    vi.mocked(fetchAlphafoldPdb).mockResolvedValueOnce("MOCK_AF_PDB");
    const result = await runStructuralAnalysis(baseContext, null, null);
    expect(result.disruptionPredictor).toMatchObject({ rsa: 0.6, burialStatus: "surface", structureLabel: "AlphaFold model" });
  });

  it("keeps the earlier burial reading and the model results when the AlphaFold refresh throws", async () => {
    const { fetchAlphafoldPdb } = await import("../structure/structure-fetcher.ts");
    vi.mocked(fetchAlphafoldPdb).mockRejectedValueOnce(new Error("AlphaFold is down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runStructuralAnalysis(baseContext, null, null);
    expect(result.esm3Eval).toEqual({ score: -4.5 });
    expect(result.disruptionPredictor).toMatchObject({ level: "high", reason: "disruption" });
    expect(result.disruptionPredictor).not.toHaveProperty("structureLabel");
    warn.mockRestore();
  });

  it("keeps the earlier burial reading when the refresh still has no accessibility value", async () => {
    const { fetchAlphafoldPdb } = await import("../structure/structure-fetcher.ts");
    const { predictStructuralDisruption } = await import("../structure/pocket/disruption.ts");
    vi.mocked(fetchAlphafoldPdb).mockResolvedValueOnce("MOCK_AF_PDB");
    vi.mocked(predictStructuralDisruption).mockResolvedValueOnce({ level: "unknown", reason: "No accessibility", plddt: 90 } as never);
    const result = await runStructuralAnalysis(baseContext, null, null);
    expect(result.disruptionPredictor).toMatchObject({ level: "high", reason: "disruption" });
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * THE BURIAL REFRESH HAS ITS OWN DEADLINE
   * ─────────────────────────────────────────────────────────────────────────────
   * After the four models settle, the retry downloads the AlphaFold structure and measures
   * accessibility. That step had no deadline at all, so a slow structure host held the answer long after
   * every model was done.
   */
  it("keeps the earlier burial reading when the refresh outlives its own deadline", async () => {
    const { CONFIG } = await import("../../config.ts");
    const { fetchAlphafoldPdb } = await import("../structure/structure-fetcher.ts");
    vi.mocked(fetchAlphafoldPdb).mockImplementationOnce(() => new Promise(() => {}));
    const timeouts = CONFIG.timeouts as { structuralTailMs: number };
    const original = timeouts.structuralTailMs;
    timeouts.structuralTailMs = 30;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const startedAt = Date.now();
      const result = await runStructuralAnalysis(baseContext, null, null);
      expect(Date.now() - startedAt, "the answer must not wait for a download that never ends").toBeLessThan(2_000);
      expect(result.esm3Eval).toEqual({ score: -4.5 });
      expect(result.disruptionPredictor).toMatchObject({ level: "high", reason: "disruption" });
      expect(result.disruptionPredictor).not.toHaveProperty("structureLabel");
      expect(warn.mock.calls.flat().join(" ")).toContain("did not finish");
    } finally {
      timeouts.structuralTailMs = original;
      warn.mockRestore();
    }
  });

  it("skips the burial refresh altogether when the reader has already left", async () => {
    const { fetchAlphafoldPdb } = await import("../structure/structure-fetcher.ts");
    const left = new AbortController();
    left.abort();
    const result = await runStructuralAnalysis(baseContext, null, null, { signal: left.signal });
    expect(fetchAlphafoldPdb).not.toHaveBeenCalled();
    // The models' results are still returned (and persisted): only the optional extra is skipped.
    expect(result.esm3Eval).toEqual({ score: -4.5 });
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * THE STRUCTURAL STREAM — each model as it settles, a heartbeat while waiting, the result last
   * ─────────────────────────────────────────────────────────────────────────────
   */
  const structuralFetchResult = {
    esm3Eval: { score: -4.5 }, esmcEval: { score: -2.1 }, esm2Eval: { score: -3.8 }, saprotEval: { score: -1.9 },
    serviceStatus: { esm3: "ok", esmc: "ok", esm2Eval: "ok", saprot: "ok" },
    structuralTimings: { esm3: 11, esmc: 12, esm2Eval: 13, saprot: 14 },
    structuralTimingOffsets: { esm3: 20, esmc: 21, esm2Eval: 22, saprot: 24 }
  };

  it("streams each model the moment it settles and ends on ONE final frame equal to the buffered result", async () => {
    const { fetchStructuralModelData } = await import("../structure/structural-model-fetcher.ts");
    vi.mocked(fetchStructuralModelData).mockImplementationOnce((async (_c: any, _b: any, _h: any, _t: any, _p: any, onModel: any) => {
      onModel?.({ type: "model", key: "esm3", evaluation: { score: -4.5 }, status: "ok", durationMs: 11 });
      onModel?.({ type: "model", key: "saprot", evaluation: { score: -1.9 }, status: "ok", durationMs: 14 });
      return structuralFetchResult;
    }) as any);

    const frames: any[] = [];
    const result = await streamStructuralAnalysis(baseContext, null, null, frame => frames.push(frame));

    expect(frames.slice(0, 2).map(frame => frame.key)).toEqual(["esm3", "saprot"]);
    const finals = frames.filter(frame => frame.type === "final");
    expect(finals, "exactly one final frame").toHaveLength(1);
    expect(frames[frames.length - 1], "and it comes last").toBe(finals[0]);
    expect(finals[0].data).toBe(result);
    expect(result).toMatchObject({ esm3Eval: { score: -4.5 }, saprotEval: { score: -1.9 }, structuralTimings: { esm3: 11 } });
  });

  it("writes a heartbeat while the models are still running, and clears its timer afterwards", async () => {
    const { fetchStructuralModelData } = await import("../structure/structural-model-fetcher.ts");
    let finish!: () => void;
    vi.mocked(fetchStructuralModelData).mockImplementationOnce(
      (() => new Promise(resolve => { finish = () => resolve(structuralFetchResult); })) as any
    );

    vi.useFakeTimers();
    try {
      const frames: any[] = [];
      const run = streamStructuralAnalysis(baseContext, null, null, frame => frames.push(frame));
      await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_MS * 2 + 10);
      expect(frames.filter(frame => frame.type === "heartbeat").length).toBeGreaterThanOrEqual(2);
      expect(frames.some(frame => frame.type === "final"), "nothing is final while a model is running").toBe(false);

      finish();
      await vi.advanceTimersByTimeAsync(0);
      await run;
      expect(frames[frames.length - 1].type).toBe("final");
      expect(vi.getTimerCount(), "the heartbeat must not outlive the request").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing for a reader that has already left", async () => {
    const left = new AbortController();
    left.abort();
    const frames: any[] = [];
    expect(await streamStructuralAnalysis(baseContext, null, null, frame => frames.push(frame), left.signal)).toBeNull();
    expect(frames).toEqual([]);
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

  it("refreshes an interrupted popEVE result even when overall availability is false", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: stamp({
      conservationData: { available: false, metarnn: 0.732, esm1b: -5.59, eigenPhred: 4.82, popeve: null, modelStatus: { base: "settled", popeve: "timeout" } },
    }), id: "interrupted" });
    await runCoreAnalysis(baseContext);
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).toHaveBeenCalledTimes(1);
  });

  it("should return cached analysis when valid SQLite cache entry exists", async () => {
    /**
     * STAMPED, because an unstamped row is no longer reusable — it records no identity to verify
     * against, so the guard refuses it and the route refetches once (see the legacy test below).
     * `stamp()` is what a modern row carries.
     */
    const cachedPayload = stamp({
      metadata: { gene: "PAH", variant: "p.Arg408Trp" },
      clinvar: { classification: "Pathogenic" },
      conservationData: { available: true, dann: 0.9, bayesdel: 0.5, clinpred: 0.8, eigenPhred: 12.0 },
      ruleBasedInsights: { acmgVerdict: "Pathogenic" }
    });
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: cachedPayload, id: "1" });

    const result = await runCoreAnalysis(baseContext);

    expect(result).toBeDefined();
    expect(result.metadata.gene).toBe("PAH");
    // Should NOT have called fetchCoreVariantData because cache hit occurred
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).not.toHaveBeenCalled();
    /**
     * The restore states its own provenance — the fact the client used to guess from latency.
     * The ROW must not carry it (a row claiming `cacheHit: true` would be asserting a provenance it
     * no longer has), which is why the helper returns a copy.
     */
    expect(result.cacheHit).toBe(true);
    expect(result.metadata.cacheHit).toBe(true);
    expect(result.cacheLayer).toBe("analysis-db");
    expect(cachedPayload.metadata.cacheHit).toBeUndefined();
  });

  it("refetches an UNSTAMPED row once, and the payload it writes is stamped", async () => {
    // A row written before the guard existed: it records no identity, so nothing about it can be
    // verified. It is a one-time recompute (the refetch stamps the row), not a blanked cache.
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({
      payload: {
        metadata: { gene: "PAH", variant: "p.Arg408Trp" },
        clinvar: { classification: "Pathogenic" },
        ruleBasedInsights: { acmgVerdict: "Pathogenic" }
      },
      id: "legacy-1"
    });

    const result = await runCoreAnalysis(baseContext);

    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData, "an unverifiable row must be recomputed").toHaveBeenCalledTimes(1);
    expect(result.cacheHit).toBe(false);

    const lastSave = mockDb.saveVariantAnalysisAsync.mock.calls[mockDb.saveVariantAnalysisAsync.mock.calls.length - 1][0];
    expect(
      lastSave.payload._internal?.coreIdentity?.scienceHash,
      "the refetch is what makes the row verifiable from then on"
    ).toBeTruthy();
    expect(lastSave.payload.metadata.cacheHit, "the row records no wire provenance").toBeUndefined();
  });

  describe.each(["synchronous", "streaming"] as const)("%s persisted locus-policy cache", (mode) => {
    const freshCachedPayload = (predictorData: Record<string, unknown>) => ({
      metadata: { gene: "PAH", variant: "p.Arg408Trp" },
      clinvar: { classification: "Pathogenic" },
      conservationData: {
        available: true, dann: 0.9, bayesdel: 0.5, clinpred: 0.8, eigenPhred: 12,
        gpnStar: -0.2, gpnStarStatus: "live",
        // This cached fixture is otherwise fresh even when provider credentials exist in the test env.
        assemblyRefusals: [{ source: "alphagenome", reason: "No verified allele", retryable: false }],
      },
      predictorData,
      ruleBasedInsights: { acmgVerdict: "Pathogenic", acmgCriteria: [] },
    });
    const run = async (context: ParsedVariantContext = baseContext) => mode === "synchronous"
      ? runCoreAnalysis(context)
      : streamCoreAnalysis(context, () => {});

    it("recomputes an old canonical fallback instead of restoring its inferred allele", async () => {
      /**
       * STAMPED, like every other fixture in this block whose assertion is a REFUSAL. An unstamped row
       * is refused for carrying no identity at all, which would make this pass without the policy rule
       * under test ever firing. `stamp` defaults to `baseContext`, the context `run()` uses here.
       */
      const payload = stamp(freshCachedPayload({
        gnomadVariantId: "12-102836889-C-T", gnomadVariantAssembly: "GRCh38",
        source: "MyVariant.info & dbNSFP (VEP Fallback)",
        locusResolution: { route: "fallback", canonicalBy: "dbnsfp-grch38", retryable: false, steps: [] },
      }));
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload, id: "old-canonical-fallback", updatedAt: new Date().toISOString() });

      const resolved = await run();

      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      expect(fetchCoreVariantData).toHaveBeenCalledOnce();
      expect(resolved.predictorData).toEqual(mockCoreData.predictorData);
    });

    it("restores a current-policy definitive ambiguity without another automatic attempt", async () => {
      /**
       * STAMPED, so the only reason this row could be refused is the locus POLICY — which is what the
       * test is about. An unstamped row is refused by the identity guard for a different reason, and
       * the legacy test below covers that case explicitly.
       */
      const payload = stamp(freshCachedPayload({
        gnomadVariantId: null, gnomadVariantAssembly: null,
        source: "MyVariant.info & dbNSFP (VEP Fallback)",
        locusResolution: {
          route: "fallback", canonicalBy: null, retryable: false,
          failureKind: "ambiguous-allele", policyVersion: LOCUS_POLICY_VERSION, steps: [],
        },
      }));
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload, id: "current-ambiguity", updatedAt: new Date().toISOString() });

      const resolved = await run();

      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      expect(fetchCoreVariantData).not.toHaveBeenCalled();
      expect(resolved.predictorData.locusResolution.failureKind).toBe("ambiguous-allele");
      expect(resolved.predictorData.gnomadVariantId).toBeNull();
    });

    const alleleContext: ParsedVariantContext = { ...baseContext, gene: "SLC12A4", variant: "Q867H", pos: 867, residueIndex: "867", wildType: "Gln", mutant: "His", wt1Letter: "Q", mut1Letter: "H", uniprotId: "Q9UP95", genomicCoordinates: "16-67946177-C-G", assembly: "GRCh38" };
    const coordinatePredictor = { gnomadVariantId: "16-67946177-C-G", gnomadVariantAssembly: "GRCh38", source: "Ensembl VEP",
      locusResolution: { route: "vep-coordinate", canonicalBy: "vep", retryable: false, steps: [] } };

    it.each([
      { gnomadVariantId: null, locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "ambiguous-allele", policyVersion: LOCUS_POLICY_VERSION, steps: [] } },
      { ...coordinatePredictor, gnomadVariantId: "16-67946177-C-A" }
    ])("a supplied nucleotide allele escapes ambiguity or another ALT cached under the same protein", async (predictor) => {
      // STAMPED with the context the run uses, so the refusal comes from the allele/ambiguity rule
      // rather than from an unverifiable row.
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: stamp(freshCachedPayload(predictor), alleleContext), id: "protein-keyed-cache", updatedAt: new Date().toISOString() });
      await run(alleleContext);
      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      expect(fetchCoreVariantData).toHaveBeenCalledOnce();
    });

    it("reuses a cache for the same verified explicit allele", async () => {
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: stamp(freshCachedPayload(coordinatePredictor), alleleContext), id: "same-allele", updatedAt: new Date().toISOString() });
      await run(alleleContext);
      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      expect(fetchCoreVariantData).not.toHaveBeenCalled();
    });

    it("does not use a prior coordinate allele to resolve a new ambiguous protein-only input", async () => {
      /*
       * The row is stamped with the PROTEIN-ONLY context the run uses, so it is verifiable. The refusal
       * must then come from the ambiguity rule — the row DOES carry a usable allele, and it is exactly
       * that allele the rule says may not be inferred for a new protein-only input.
       */
      const proteinOnlyContext: ParsedVariantContext = { ...alleleContext, genomicCoordinates: undefined };
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: stamp(freshCachedPayload(coordinatePredictor), proteinOnlyContext), id: "old-explicit-allele", updatedAt: new Date().toISOString() });
      await run(proteinOnlyContext);
      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      expect(fetchCoreVariantData).toHaveBeenCalledOnce();
    });

    it("keeps a healthy old VEP result cacheable without requiring a policy stamp", async () => {
      const payload = stamp(freshCachedPayload({
        gnomadVariantId: "12-102836889-C-T", gnomadVariantAssembly: "GRCh38", source: "Ensembl VEP",
        locusResolution: { route: "vep-hgvs", canonicalBy: "vep", retryable: false, steps: [] },
      }));
      mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload, id: "healthy-old-vep", updatedAt: new Date().toISOString() });

      const resolved = await run();

      const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
      expect(fetchCoreVariantData).not.toHaveBeenCalled();
      expect(resolved.predictorData.gnomadVariantId).toBe("12-102836889-C-T");
    });
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
      const previews = chunks.filter(c => !c.isFinal && c.type !== "heartbeat");
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
    /**
     * The collision regression: the core run's VESM-150M outcome lives at `serviceStatus.esm2`, so
     * the structural merge may not overwrite it — not even with the legacy `esm2` key the fixture
     * carries, and not with anything else. The deep model's ESM-2 650M outcome is `esm2Eval`.
     */
    expect(result.serviceStatus.esm2, "the core's status must survive the structural merge").toBe("ok");
    expect(result.serviceStatus.esm2Eval).toBe("ok");
    /**
     * The structural stage's own spans travel on the response, under structural names — the client's
     * waterfall can then draw a real model span instead of the whole-request span, which reports a
     * healthy structural stage even when every model was unavailable.
     */
    expect(result.structuralTimings).toMatchObject({ esm3: 11, esmc: 12, esm2Eval: 13, saprot: 14 });
    expect(result.structuralTimingOffsets).toMatchObject({ esm3: 20, saprot: 24 });
    expect(result.ruleBasedInsights).toBeDefined();
    expect(mockDb.saveVariantAnalysisAsync).toHaveBeenCalled();
  });

  it("persists structural spans BESIDE the core's, never over them", async () => {
    // A restored core row that carries its own per-source timings: the structural stage must not
    // relabel those sources with its own spans (nor the reverse).
    const cachedCore = stamp({
      metadata: {
        gene: "PAH",
        variant: "p.Arg408Trp",
        // The rest of the payload mirrors its timings into metadata; this row does too.
        serviceTimings: { clinvar: 12, predictorData: 480 },
        serviceTimingOffsets: { clinvar: 12, predictorData: 500 }
      },
      clinvar: { classification: "Pathogenic" },
      conservationData: { available: true, dann: 0.9, bayesdel: 0.5, clinpred: 0.8, eigenPhred: 12.0 },
      serviceStatus: { ...mockCoreData.serviceStatus },
      serviceTimings: { clinvar: 12, predictorData: 480 },
      serviceTimingOffsets: { clinvar: 12, predictorData: 500 },
      ruleBasedInsights: { plausibility: "", acmgVerdict: "Pathogenic", acmgCriteria: [] }
    });
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({
      payload: cachedCore, id: "timings-1", updatedAt: new Date().toISOString()
    });

    const result = await runStructuralAnalysis(baseContext, null, null);

    const saved = mockDb.saveVariantAnalysisAsync.mock.calls[mockDb.saveVariantAnalysisAsync.mock.calls.length - 1][0].payload;
    expect(saved.serviceTimings, "the core's per-source timings are untouched").toEqual({ clinvar: 12, predictorData: 480 });
    expect(saved.serviceTimingOffsets).toEqual({ clinvar: 12, predictorData: 500 });
    expect(saved.structuralTimings.esm3).toBe(11);
    expect(saved.structuralTimingOffsets.saprot).toBe(24);
    // The metadata mirror carries the STRUCTURAL spans beside the core's, not instead of them.
    expect(saved.metadata.structuralTimings.esm2Eval).toBe(13);
    expect(saved.metadata.structuralTimingOffsets.esmc).toBe(21);
    expect(saved.metadata.serviceTimings).toEqual({ clinvar: 12, predictorData: 480 });
    expect(result.structuralTimings.esm3).toBe(11);
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
    const contextWithHfToken: ParsedVariantContext = {
      ...baseContext,
      hfToken: "hf_test_token"
    };
    // Stamped with the context that will READ it, so the ONLY reason for the recompute is staleness.
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: stamp(cachedPayloadLackingGpn, contextWithHfToken), id: "1" });

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
    const contextWithAlphaKey: ParsedVariantContext = {
      ...baseContext,
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      alphagenomeApiKey: "ag_secret_key_123"
    };
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: stamp(cachedPayloadLackingAlpha, contextWithAlphaKey), id: "2" });

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
    const contextWithAlphaKey: ParsedVariantContext = {
      ...baseContext,
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      alphagenomeApiKey: "ag_secret_key_123"
    };
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({ payload: stamp(cachedPayloadUnindexed, contextWithAlphaKey), id: "3" });

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
      payload: stamp(refusedPayload, alphaKeyContext), id: "4", updatedAt: new Date().toISOString()
    });

    await runCoreAnalysis(alphaKeyContext);

    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).not.toHaveBeenCalled();
  });

  it("re-attempts after the refusal window lapses — a transient refusal must not pin a blank forever", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce({
      payload: stamp(refusedPayload, alphaKeyContext), id: "5",
      updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() // 7h ago (> 6h window)
    });

    await runCoreAnalysis(alphaKeyContext);

    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    expect(fetchCoreVariantData).toHaveBeenCalled();
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * ONE CORE FETCH FOR THE SAME IDENTITY — and what sharing must not change
   * ─────────────────────────────────────────────────────────────────────────────
   * The UI fires the structural tab and the stream for the same variant within milliseconds, and the
   * dispatch order is not fixed: the structural request can be the one that starts the core fetch.
   * In both orders there must be exactly ONE run, and the stream must still honour the chunk
   * contract — chunk 1 first, one final frame, and it comes last.
   */
  it("shares ONE core fetch with a concurrent structural request, in the stream-first order", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValue(null);

    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    const { coreSingleflightStats } = await import("./core-singleflight.ts");
    let releaseCore: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseCore = resolve; });
    (vi.mocked(fetchCoreVariantData) as any).mockImplementationOnce(async (_c: any, _t: any, _p: any, onPartial: any) => {
      await gate;
      onPartial?.({
        data: { conservationData: { revel: 0.9 } },
        serviceStatus: { conservationData: "ok" },
        serviceTimings: { conservationData: 12 },
        serviceTimingOffsets: { conservationData: 12 }
      });
      return mockCoreData;
    });

    const chunks: any[] = [];
    const stream = streamCoreAnalysis(baseContext, chunk => chunks.push(chunk));
    const structural = runStructuralAnalysis(baseContext, null, null);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(vi.mocked(fetchCoreVariantData), "the second route must join, not repeat").toHaveBeenCalledTimes(1);

    releaseCore();
    await Promise.all([stream, structural]);

    expect(vi.mocked(fetchCoreVariantData)).toHaveBeenCalledTimes(1);
    expect(coreSingleflightStats()).toMatchObject({ started: 1, joined: 1 });
    expect(chunks[0].chunkIndex).toBe(1);
    expect(chunks[0].isFinal).toBe(false);
    const finals = chunks.filter(c => c.isFinal);
    expect(finals.length).toBe(1);
    expect(chunks[chunks.length - 1]).toBe(finals[0]);
    // The preview the owner's run published reached the joining stream, after chunk 1.
    const preview = chunks.find(c => !c.isFinal && c.chunkIndex !== 1);
    expect(preview?.data.conservationData).toEqual({ revel: 0.9 });
  });

  it("shares ONE core fetch when the STRUCTURAL request started it, and the stream still frames correctly", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValue(null);

    const { fetchClinVarData } = await import("../external-api/clinvar.ts");
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    vi.mocked(fetchClinVarData).mockClear();

    let releaseCore: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseCore = resolve; });
    (vi.mocked(fetchCoreVariantData) as any).mockImplementationOnce(
      async (_c: any, _t: any, _p: any, onPartial: any, onFastTriage: any) => {
        /**
         * The run hands out its own two fast sources as it starts, exactly as the real fetcher does —
         * BEFORE any await, so the stream that joins a moment later can build chunk 1 from them.
         */
        onFastTriage?.({
          clinvar: Promise.resolve({ data: { classification: "Pathogenic" }, status: "ok" }),
          predictorData: Promise.resolve({ data: { caddPhred: 25 }, status: "ok" })
        });
        await gate;
        onPartial?.({
          data: { conservationData: { revel: 0.7 } },
          serviceStatus: { conservationData: "ok" },
          serviceTimings: { conservationData: 8 },
          serviceTimingOffsets: { conservationData: 8 }
        });
        return mockCoreData;
      }
    );

    // The structural request goes first, exactly as the fan-out dispatches it.
    const structural = runStructuralAnalysis(baseContext, null, null);
    const chunks: any[] = [];
    const stream = streamCoreAnalysis(baseContext, chunk => chunks.push(chunk));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(
      vi.mocked(fetchCoreVariantData),
      "a structural request must not be repeated by the stream that follows it"
    ).toHaveBeenCalledTimes(1);

    releaseCore();
    await Promise.all([structural, stream]);

    /**
     * ...and the stream did not ask the providers for ClinVar either: chunk 1 was built from the
     * RUN's answer. That is the duplicate the crossing order used to pay, and it is also why chunk 1
     * and the final payload cannot disagree about ClinVar.
     */
    expect(
      fetchClinVarData,
      "the joining stream must reuse the run's fast sources rather than re-query ClinVar"
    ).not.toHaveBeenCalled();

    expect(chunks[0].chunkIndex).toBe(1);
    expect(chunks[0].isFinal).toBe(false);
    expect(chunks[0].data.clinvar).toEqual({ classification: "Pathogenic" });
    expect(chunks[0].data.serviceStatus.clinvar).toBe("ok");
    // A frame from a live run is not a cache restore, and says so.
    expect(chunks[0].data.metadata.cacheHit).toBe(false);
    expect(chunks[0].data.metadata.cacheLayer).toBeNull();
    const finals = chunks.filter(c => c.isFinal);
    expect(finals.length).toBe(1);
    expect(chunks[chunks.length - 1]).toBe(finals[0]);
    expect(finals[0].chunkIndex).toBeGreaterThan(chunks[0].chunkIndex);
    expect(finals[0].data.metadata.gene).toBe("PAH");
    expect(finals[0].data.metadata.cacheHit).toBe(false);
  });

  it("delivers a fast source while triage is unresolved and finishes once the core run settles", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);
    const { fetchClinVarData } = await import("../external-api/clinvar.ts");
    const { fetchCoreVariantData } = await import("../external-api/core-data-fetcher.ts");
    vi.mocked(fetchClinVarData).mockImplementationOnce(() => new Promise(() => {}));
    let releaseCore!: () => void;
    const gate = new Promise<void>(resolve => { releaseCore = resolve; });
    (vi.mocked(fetchCoreVariantData) as any).mockImplementationOnce(async (_c: any, _t: any, _p: any, onPartial: any) => {
      onPartial({
        data: { uniprotFeatures: { domains: [{ name: "Early domain" }] } },
        serviceStatus: { uniprotFeatures: "ok", clinvar: "pending", predictorData: "pending" },
        serviceTimings: { uniprotFeatures: 1 }, serviceTimingOffsets: { uniprotFeatures: 1 }
      });
      await gate;
      return mockCoreData;
    });
    const chunks: any[] = [];
    const run = streamCoreAnalysis(baseContext, chunk => chunks.push(chunk));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunkIndex: 1, isFinal: false, data: {
      metadata: { gene: "PAH", sequence: "MKVLIVGLGNCGVFSLLDKN", cacheHit: false },
      uniprotFeatures: { domains: [{ name: "Early domain" }] },
      serviceStatus: { clinvar: "pending", uniprotFeatures: "ok" }
    } });
    releaseCore();
    await run;
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ chunkIndex: 2, isFinal: true });
  });

  /**
   * The reader's readiness must not be a database write.
   *
   * The persisted-write promise is deliberately left UNRESOLVED here: if any route awaited it, this
   * test would hang rather than fail, so the assertion below is the whole point — the analysis
   * answers while the write is still in flight.
   */
  it("answers /analyze-variant while the persistence write is still in flight", async () => {
    mockDb.getVariantAnalysisAsync.mockResolvedValueOnce(null);
    let resolveWrite: () => void = () => {};
    mockDb.saveVariantAnalysisAsync.mockImplementationOnce(() => new Promise<void>(resolve => { resolveWrite = resolve; }));

    const result = await runCoreAnalysis(baseContext);

    expect(result.metadata.gene).toBe("PAH");
    expect(mockDb.saveVariantAnalysisAsync).toHaveBeenCalled();
    const write = mockDb.saveVariantAnalysisAsync.mock.results[0].value;
    expect(write).toBeInstanceOf(Promise);

    resolveWrite();
    await write;
  });
});

describe("isStaleCachedPayload — SpliceAI window", () => {
  const payload = (source: string | null, distanceBp: number | null) => ({
    conservationData: {
      available: true, dann: 1, bayesdel: 1, clinpred: 1, eigenPhred: 1,
      spliceai: source ? { max_ds: 0.1, provenance: { source, distanceBp } } : null,
    },
  });
  const ctx = (d?: number) => ({ spliceaiDistance: d } as any);

  it("recomputes a live score computed under another window", () => {
    expect(isStaleCachedPayload(payload("broad-lookup", 500), ctx(2000))).toBe(true);
    expect(isStaleCachedPayload(payload("broad-lookup", 50), ctx(500))).toBe(true);
  });

  it("keeps a score whose window matches, or when no window was requested", () => {
    expect(isStaleCachedPayload(payload("broad-lookup", 500), ctx(500))).toBe(false);
    expect(isStaleCachedPayload(payload("broad-lookup", 500), ctx(undefined))).toBe(false);
  });

  it("treats a requested window of null the same as none", () => {
    expect(isStaleCachedPayload(payload("broad-lookup", 500), { spliceaiDistance: null } as any)).toBe(false);
  });

  it("leaves a live score with no recorded window alone: nothing to compare", () => {
    expect(isStaleCachedPayload(payload("broad-lookup", null), ctx(2000))).toBe(false);
  });

  it("leaves a frozen table alone: it states no window to compare", () => {
    expect(isStaleCachedPayload(payload("precomputed-dbnsfp", null), ctx(2000))).toBe(false);
  });
});

/**
 * A run whose CORE sources expired under the budget is not a finished analysis.
 *
 * The FGFR3 p.Gly380Arg run (2026-11-08): Ensembl VEP's ladder never settled inside the 45 s
 * core budget, so `predictorData`, `gnomadFrequency` and the LOCAL constraint all expired
 * together — and nothing in the cache gate rejected the result it left behind. A future visit
 * (a Recents click, a re-opened variant) could be served that run verbatim, reading "the gnomAD
 * frequency query timed out" for months while a re-run would answer in seconds. The structural
 * route's payload gate and the client bundle both refuse degraded states already; this is the
 * analysis cache held to the same rule the code-map calls "the third cache in the chain".
 */
describe("isStaleCachedPayload — an expired core source is not a finished analysis", () => {
  const payload = (statuses: Record<string, string>) => ({
    predictorData: { caddPhred: 25, gnomadVariantId: "7-104836979-C-T", gnomadVariantAssembly: "GRCh38" },
    conservationData: null,
    serviceStatus: statuses,
  });
  const ctx = { gene: "FGFR3", variant: "p.Gly380Arg", uniprotId: "P22607", originalNotation: "p.Gly380Arg", acmgWeighting: "standard", sequence: "MDVRGQVESL", pos: 380, residueIndex: "380", wildType: "Gly", mutant: "Arg", wt1Letter: "G", mut1Letter: "R" } as any;

  it("rejects the exact shape the FGFR3 run left in the database", () => {
    expect(isStaleCachedPayload(payload({ gnomadFrequency: "timeout", gnomadConstraint: "timeout", predictorData: "timeout" }), ctx)).toBe(true);
  });

  it("rejects a single expired core source even when the rest came back", () => {
    for (const key of ["predictorData", "gnomadFrequency", "gnomadConstraint"]) {
      const statuses: Record<string, string> = { clinvar: "ok", gnomadFrequency: "ok", gnomadConstraint: "ok", predictorData: "ok" };
      statuses[key] = "timeout";
      expect(isStaleCachedPayload(payload(statuses), ctx)).toBe(true);
    }
  });

  it("serves a just-written timeout row for a short back-off, then runs the providers again", () => {
    const statuses = { gnomadFrequency: "timeout", gnomadConstraint: "ok", predictorData: "ok" };
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(isStaleCachedPayload(payload(statuses), ctx, ago(30_000))).toBe(false);
    expect(isStaleCachedPayload(payload(statuses), ctx, ago(10 * 60_000))).toBe(true);
    expect(isStaleCachedPayload(payload(statuses), ctx, "not a date")).toBe(true);
  });

  it("keeps a payload whose core statuses are not faults", () => {
    expect(isStaleCachedPayload(payload({ clinvar: "ok", gnomadFrequency: "ok", gnomadConstraint: "ok", predictorData: "ok" }), ctx)).toBe(false);
    // A confirmed absence is a finished analysis; only the budget expiry is the sticky hazard.
    expect(isStaleCachedPayload(payload({ clinvar: "not_found", gnomadFrequency: "not_found", gnomadConstraint: "not_found", predictorData: "ok" }), ctx)).toBe(false);
  });
});
