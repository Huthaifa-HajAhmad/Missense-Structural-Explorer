import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  assembleCoreResponsePayload,
  declaredModelProvenanceOf,
  persistVariantAnalysisPayload,
  withCacheProvenance
} from "../payload-assembler";

/**
 * The persistence target is mocked here so the helper's RETURN CONTRACT can be tested without a
 * database: it must hand the write back as a promise, and it must never reject (a rejection nothing
 * awaits is an unhandled rejection in a request that has already answered).
 */
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    // Typed parameters, so the recorded call arguments are readable in the assertions below.
    saveVariantAnalysisAsync: vi.fn(async (_params: any) => ({})),
    getVariantAnalysisAsync: vi.fn(async () => null)
  }
}));

vi.mock("../infra/analysis-db.ts", () => ({
  AnalysisDatabase: { getInstance: () => mockDb }
}));

/**
 * The UI's analysis runs through the STREAM endpoint, whose chunks are built by this assembler.
 *
 * Numbering provenance was added only to the non-stream route, so an unverifiable numbering was
 * disclosed on the route the client does not use and silent on the one it does — the disclosure
 * existed and reached nobody. These assertions pin the payload the client actually reads.
 */
const coreData = {
  ruleBasedInsights: null,
  clinvar: null,
  predictorData: { transcriptId: "ENST1", isManeSelect: true },
  conservationData: null,
  stringInteractions: null,
  disruptionPredictor: { level: "unknown" },
  gnomadConstraint: null,
  uniprotFeatures: null,
  gnomadFrequency: null,
  aouFrequency: null,
  esm2: null,
} as any;

const context = (over: Record<string, unknown>) =>
  ({
    gene: "ACOT9",
    variant: "p.Arg64Ala",
    uniprotId: "Q9Y305",
    residueIndex: "64",
    wildType: "Arg",
    mutant: "Ala",
    sequence: "M".repeat(100),
    pos: 64,
    wt1Letter: "R",
    mut1Letter: "A",
    ...over,
  }) as any;

describe("assembleCoreResponsePayload — numbering disclosure", () => {
  it("carries the verified state, the unverified reason and the reader's decision", () => {
    const verified = assembleCoreResponsePayload(coreData, context({ numberingVerified: true }));
    expect(verified.numberingVerified).toBe(true);
    expect(verified.numberingUnverifiedReason).toBeUndefined();

    const unverified = assembleCoreResponsePayload(
      coreData,
      context({ numberingVerified: false, numberingWarning: "the isoform model could not be reached" })
    );
    expect(unverified.numberingVerified).toBe(false);
    expect(unverified.numberingUnverifiedReason).toContain("isoform model");

    const chosen = assembleCoreResponsePayload(
      coreData,
      context({ numberingVerified: true, numberingDisambiguated: true })
    );
    expect(chosen.numberingDisambiguated).toBe(true);
  });

  it("says nothing when the route established nothing", () => {
    const payload = assembleCoreResponsePayload(coreData, context({}));
    expect(payload.numberingVerified).toBeUndefined();
    expect(payload.numberingDisambiguated).toBeUndefined();
    expect(payload.numberingUnverifiedReason).toBeUndefined();
  });
});

describe("assembleCoreResponsePayload — the sequence the narrative request asks for", () => {
  it("carries the wild-type sequence beside the mutated one", () => {
    const payload = assembleCoreResponsePayload(coreData, context({}));
    const wildType = "M".repeat(100);

    // The report's re-synthesis sends `metadata.sequence` to the narrative route. It was
    // declared in the schema and read by the client, but no builder populated it, so the
    // request always asked for a sequence that never arrived. `mutatedSequence` is not a
    // substitute: it differs at exactly the residue the narrative is asked to explain.
    expect(payload.metadata.sequence).toBe(wildType);
    expect(payload.metadata.sequence).not.toBe(payload.metadata.mutatedSequence);
    expect(payload.metadata.sequence[63]).toBe("M");
    expect(payload.metadata.mutatedSequence[63]).toBe("A");
  });
});

describe("persistVariantAnalysisPayload — the return contract", () => {
  beforeEach(() => {
    mockDb.saveVariantAnalysisAsync.mockClear();
    mockDb.saveVariantAnalysisAsync.mockImplementation(async () => ({}));
  });

  it("returns a promise, and resolves even when the write fails", async () => {
    mockDb.saveVariantAnalysisAsync.mockRejectedValueOnce(new Error("worker pool down"));

    const write = persistVariantAnalysisPayload(
      context({}),
      assembleCoreResponsePayload(coreData, context({})),
      "Pathogenic"
    );

    expect(write).toBeInstanceOf(Promise);
    await expect(write).resolves.toBeUndefined();
    expect(mockDb.saveVariantAnalysisAsync).toHaveBeenCalled();
  });

  it("handles the write deliberately: the caller can await it, and nothing forces it into a reader's path", async () => {
    const write = persistVariantAnalysisPayload(context({}), assembleCoreResponsePayload(coreData, context({})), null);

    // Awaiting is the caller's choice; the promise settles either way.
    await write;
    const [saved] = mockDb.saveVariantAnalysisAsync.mock.calls[mockDb.saveVariantAnalysisAsync.mock.calls.length - 1];
    expect(saved.gene).toBe("ACOT9");
    expect(saved.payload.metadata.sequence).toBe("M".repeat(100));
  });
});

describe("declaredModelProvenanceOf — never stamp a model that did not run", () => {
  it("names the core VESM-150M evaluation, not the 35M checkpoint the block used to claim", () => {
    const declared: any = declaredModelProvenanceOf(
      { esm2: { llr: -7.5, verdict: "deleterious" } },
      context({})
    );

    expect(declared.schemaVersion).toBe(2);
    expect(declared.models["core.esm2"]).toContain("VESM-150M");
    expect(JSON.stringify(declared)).not.toContain("esm2_t12_35M");
  });

  it("records the producer's own provenance verbatim, and declares nothing that produced nothing", () => {
    const declared: any = declaredModelProvenanceOf(
      {
        esm2Eval: { provenance: "ESM-2 (esm2_t33_650M_UR50D)" },
        esmcEval: { score: -2.1 },
        saprotEval: { provenance: "SaProt (SaProt_35M_AF2)" }
      },
      context({ saprotEngine: "saprot-35m" })
    );

    expect(declared.models["structural.esm2Eval"]).toBe("ESM-2 (esm2_t33_650M_UR50D)");
    expect(declared.models["structural.saprotEval"]).toBe("SaProt (SaProt_35M_AF2)");
    // No producer provenance on the ESMC result: the declared fallback names the transport choices
    // rather than inventing which tier answered.
    expect(declared.models["structural.esmcEval"]).toContain("VESM-150M");
    // ESM3 never ran for this payload, so it is not declared at all.
    expect(declared.models["structural.esm3Eval"]).toBeUndefined();
  });
});

describe("withCacheProvenance — the fact, not the latency guess", () => {
  it("states a restore in metadata and at the top level", () => {
    const row: any = { metadata: { gene: "PAH" }, clinvar: null };
    const stamped = withCacheProvenance(row, true);

    expect(stamped.cacheHit).toBe(true);
    expect(stamped.cacheLayer).toBe("analysis-db");
    expect(stamped.metadata.cacheHit).toBe(true);
    expect(stamped.metadata.cacheLayer).toBe("analysis-db");
    // Nothing else in the payload is disturbed.
    expect(stamped.metadata.gene).toBe("PAH");
  });

  it("states freshness with a null layer, so 'absent' is never read as 'an old server'", () => {
    const stamped: any = withCacheProvenance({ metadata: {} }, false);

    expect(stamped.cacheHit).toBe(false);
    // `null`, not undefined: a missing field would be ambiguous with a payload from a server that
    // did not stamp at all.
    expect(stamped.cacheLayer).toBeNull();
    expect(stamped.metadata.cacheLayer).toBeNull();
  });

  it("returns a COPY — the persisted row must not inherit a claim about one response", () => {
    const row: any = { metadata: { gene: "PAH" } };
    const stamped = withCacheProvenance(row, true);

    expect(stamped).not.toBe(row);
    expect(stamped.metadata).not.toBe(row.metadata);
    expect(row.cacheHit ?? null).toBeNull();
    expect(row.metadata.cacheHit ?? null).toBeNull();
  });
});
