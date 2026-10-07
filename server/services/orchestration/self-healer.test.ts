import { describe, it, expect, vi, beforeEach } from "vitest";
import { healCachedAnalysisIfPossible } from "./self-healer.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

const mockGetExternalCache = vi.fn();
const mockPersistVariantAnalysisPayload = vi.fn();
const mockComputeRuleBasedACMG = vi.fn();

vi.mock("../infra/analysis-db.ts", () => ({
  AnalysisDatabase: {
    getInstance: () => ({
      getExternalCache: (...args: any[]) => mockGetExternalCache(...args)
    })
  }
}));

vi.mock("./payload-assembler.ts", () => ({
  persistVariantAnalysisPayload: (...args: any[]) => mockPersistVariantAnalysisPayload(...args)
}));

vi.mock("../prediction/acmg.ts", () => ({
  computeRuleBasedACMG: (...args: any[]) => mockComputeRuleBasedACMG(...args)
}));

describe("self-healer service", () => {
  const dummyContext: ParsedVariantContext = {
    gene: "BRAF",
    variant: "V600E",
    originalNotation: "BRAF V600E",
    pos: 600,
    residueIndex: "600",
    wildType: "Val",
    mutant: "Glu",
    wt1Letter: "V",
    mut1Letter: "E",
    uniprotId: "P15056",
    sequence: "MAALSGGGG...",
    acmgWeighting: "standard"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistVariantAnalysisPayload.mockReset();
    mockComputeRuleBasedACMG.mockReturnValue({
      acmgVerdict: "Pathogenic",
      criteria: ["PS1", "PM1"]
    });
  });

  it("returns null or unchanged payload if input is empty or already complete with no timeouts", () => {
    expect(healCachedAnalysisIfPossible(null, dummyContext)).toBeNull();

    const completePayload = {
      serviceStatus: {
        clinvar: "ok",
        conservationData: "ok",
        gnomadFrequency: "ok"
      },
      conservationData: { spliceai: 0.1 }
    };

    const res = healCachedAnalysisIfPossible(completePayload, dummyContext);
    expect(res).toBe(completePayload);
    expect(mockGetExternalCache).not.toHaveBeenCalled();
    expect(mockPersistVariantAnalysisPayload).not.toHaveBeenCalled();
  });

  it("backfills the wild-type sequence into a payload persisted before the builders carried it", () => {
    // A row written before `metadata.sequence` existed replays verbatim for up to 30 days, and
    // the report's rule-based criteria are computed from whatever the client sends back. The
    // backfill has to run on the "nothing else to heal" path too, which is the common one.
    const completePayload = {
      serviceStatus: { clinvar: "ok", conservationData: "ok" },
      conservationData: { spliceai: 0.1 },
      metadata: { gene: "BRAF", variant: "V600E" }
    };

    const healed = healCachedAnalysisIfPossible(completePayload, dummyContext);
    expect(healed.metadata.sequence).toBe("MAALSGGGG...");

    // ...and a sequence the payload already carries is left alone.
    const withSequence = {
      serviceStatus: { clinvar: "ok" },
      conservationData: { spliceai: 0.1 },
      metadata: { gene: "BRAF", variant: "V600E", sequence: "MK" }
    };
    expect(healCachedAnalysisIfPossible(withSequence, dummyContext).metadata.sequence).toBe("MK");
  });

  it("heals timed-out services and missing spliceai from SQLite external_cache", () => {
    const timedOutPayload = {
      serviceStatus: {
        clinvar: "timeout",
        gnomadFrequency: "timeout",
        gnomadConstraint: "error",
        uniprotFeatures: "timeout",
        predictorData: "error",
        conservationData: "timeout"
      },
      predictorData: {
        gnomadVariantId: "7-140753336-A-T",
        gnomadVariantAssembly: "GRCh38"
      },
      conservationData: null,
      metadata: {
        serviceStatus: {}
      }
    };

    mockGetExternalCache.mockImplementation((key: string) => {
      if (key.startsWith("genos_")) {
        return {
          data: {
            revel: 0.85,
            spliceai: 0.05,
            aou_ac: 2,
            aou_an: 1000
          }
        };
      }
      if (key.startsWith("clinvar_")) {
        return {
          data: {
            significance: "Pathogenic",
            reviewStatus: "criteria provided"
          }
        };
      }
      if (key.startsWith("gnomad_freq_")) {
        return {
          data: {
            exome_af: 0.00001
          }
        };
      }
      if (key.startsWith("gnomad_constraint_")) {
        return {
          data: {
            mis_z: 2.5
          }
        };
      }
      if (key.startsWith("uniprot_features_")) {
        return {
          data: {
            domains: ["Kinase"]
          }
        };
      }
      if (key.startsWith("predictors_")) {
        return {
          data: {
            alphamissense: 0.95,
            gnomadVariantId: "7-140753336-A-T",
            gnomadVariantAssembly: "GRCh38"
          }
        };
      }
      return null;
    });

    const healed = healCachedAnalysisIfPossible(timedOutPayload, dummyContext);

    expect(healed.serviceStatus.conservationData).toBe("ok");
    expect(healed.conservationData.revel).toBe(0.85);
    expect(healed.conservationData.spliceai).toBe(0.05);
    // A protein-selected Genos row has no allele identity even when other services have healed.
    expect(healed.conservationData.aouFrequency).toBeNull();

    expect(healed.serviceStatus.clinvar).toBe("ok");
    expect(healed.clinvar.significance).toBe("Pathogenic");

    expect(healed.serviceStatus.gnomadFrequency).toBe("ok");
    expect(healed.gnomadFrequency.exome_af).toBe(0.00001);

    // Gene-only legacy objects cannot restore transcript-specific v4 evidence.
    expect(healed.serviceStatus.gnomadConstraint).toBe("error");
    expect(healed.gnomadConstraint).toBeUndefined();

    expect(healed.serviceStatus.uniprotFeatures).toBe("ok");
    expect(healed.uniprotFeatures.domains).toContain("Kinase");

    expect(healed.serviceStatus.predictorData).toBe("ok");
    expect(healed.predictorData.alphamissense).toBe(0.95);

    expect(mockComputeRuleBasedACMG).toHaveBeenCalled();
    expect(mockPersistVariantAnalysisPayload).toHaveBeenCalledWith(
      dummyContext,
      healed,
      "Pathogenic"
    );
  });

  it("handles persistence errors gracefully without crashing", () => {
    const payload = {
      serviceStatus: { clinvar: "timeout" },
      conservationData: { spliceai: 0.1 }
    };

    mockGetExternalCache.mockReturnValue({
      data: { significance: "Pathogenic" }
    });
    mockPersistVariantAnalysisPayload.mockImplementation(() => {
      throw new Error("DB write error");
    });

    expect(() => healCachedAnalysisIfPossible(payload, dummyContext)).not.toThrow();
  });

  it("never heals protein-keyed AoU into a definitive ambiguity, including a complete splice payload", () => {
    const context = { ...dummyContext, gene: "SLC12A4", variant: "Q867H" };
    for (const spliceai of [null, 0.1]) {
      mockGetExternalCache.mockImplementation((key: string) => key.startsWith("genos_")
        ? { data: { revel: 0.5, spliceai: 0.1, aou_ac: 2, aou_an: 1000, aou_hom: 1 } } : null);
      const payload: any = {
        serviceStatus: { conservationData: "ok", gnomadFrequency: "unsupported-build" },
        predictorData: { gnomadVariantId: null, gnomadVariantAssembly: null,
          locusResolution: { route: "fallback", canonicalBy: null, policyVersion: 2, retryable: false, failureKind: "ambiguous-allele", steps: [] } },
        conservationData: { spliceai, aouFrequency: { aouAC: 2, aouAN: 1000, aouHom: 1 } },
        aouFrequency: { aouAC: 2, aouAN: 1000, aouHom: 1 },
        gnomadFrequency: { genomeAF: 0.002 }
      };
      const healed = healCachedAnalysisIfPossible(payload, context);
      expect(healed.aouFrequency).toBeNull();
      expect(healed.gnomadFrequency).toBeNull();
      expect(healed.conservationData.aouFrequency).toBeNull();
      expect(mockComputeRuleBasedACMG.mock.lastCall?.[0].conservationData.aouFrequency).toBeNull();
    }
  });

  it.each([
    { gnomadVariantId: "7-140753336-A-T", gnomadVariantAssembly: "GRCh37" },
    { source: "dbNSFP Fallback", gnomadVariantId: "7-140753336-A-T", gnomadVariantAssembly: "GRCh38" },
    { gnomadVariantId: null, locusResolution: { route: "fallback", canonicalBy: null, retryable: true, policyVersion: 2, steps: [] } }
  ])("does not resurrect an unusable predictor record from external cache: %j", (cached) => {
    const before = { amPathogenicity: null, caddPhred: null, gnomadVariantId: null };
    const payload = { serviceStatus: { predictorData: "timeout" }, predictorData: before, conservationData: { spliceai: 0.1 } };
    mockGetExternalCache.mockImplementation((key: string) => key.startsWith("predictors_") ? { data: cached } : null);
    expect(healCachedAnalysisIfPossible(payload, dummyContext).predictorData).toBe(before);
    expect(payload.serviceStatus.predictorData).toBe("timeout");
  });

  it("rejects an old healthy-looking protein-only Q867H VEP cache", () => {
    const before = { amPathogenicity: null, caddPhred: null, gnomadVariantId: null };
    const payload = { serviceStatus: { predictorData: "timeout" }, predictorData: before, conservationData: { spliceai: 0.1 } };
    mockGetExternalCache.mockImplementation((key: string) => key.startsWith("predictors_")
      ? { data: { source: "Ensembl VEP", gnomadVariantId: "16-67946177-C-G", gnomadVariantAssembly: "GRCh38", caddPhred: 25 } } : null);
    expect(healCachedAnalysisIfPossible(payload, { ...dummyContext, gene: "SLC12A4", variant: "Q867H" }).predictorData).toBe(before);
  });

  it("preserves exact-coordinate local AoU and healthy predictor healing for Q867H", () => {
    const context: ParsedVariantContext = { ...dummyContext, gene: "SLC12A4", variant: "Q867H", genomicCoordinates: "16:67946177:C:G", assembly: "GRCh38" };
    const predictor = { source: "Ensembl VEP", gnomadVariantId: "16-67946177-C-G", gnomadVariantAssembly: "GRCh38" };
    const counts = { aouAC: 1, aouAN: 1000, aouHet: 1, aouHom: 0 };
    const payload = { serviceStatus: { predictorData: "timeout", gnomadFrequency: "timeout" }, predictorData: predictor,
      aouFrequency: counts, conservationData: { spliceai: null, aouFrequency: counts } };
    mockGetExternalCache.mockImplementation((key: string) => key.startsWith("predictors_") ? { data: predictor }
      : key.startsWith("genos_") ? { data: { aou_ac: 4, aou_an: 1000, aou_hom: 2, spliceai: 0.1 } }
      : key.startsWith("gnomad_freq_") ? { data: { genomeAF: 0.001 } } : null);
    const healed = healCachedAnalysisIfPossible(payload, context);
    expect(healed.aouFrequency).toBe(counts);
    expect(healed.conservationData.aouFrequency).toBe(counts);
    expect(healed.predictorData).toBe(predictor);
    expect(healed.serviceStatus.predictorData).toBe("ok");
    expect(healed.gnomadFrequency).toEqual({ genomeAF: 0.001 });
  });
});
