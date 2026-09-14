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
        gnomadVariantId: "7-140753336-A-T"
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
            gnomadVariantId: "7-140753336-A-T"
          }
        };
      }
      return null;
    });

    const healed = healCachedAnalysisIfPossible(timedOutPayload, dummyContext);

    expect(healed.serviceStatus.conservationData).toBe("ok");
    expect(healed.conservationData.revel).toBe(0.85);
    expect(healed.conservationData.spliceai).toBe(0.05);
    expect(healed.conservationData.aouFrequency).toEqual({
      aouAC: 2,
      aouAN: 1000,
      aouHet: null,
      aouHom: null
    });

    expect(healed.serviceStatus.clinvar).toBe("ok");
    expect(healed.clinvar.significance).toBe("Pathogenic");

    expect(healed.serviceStatus.gnomadFrequency).toBe("ok");
    expect(healed.gnomadFrequency.exome_af).toBe(0.00001);

    expect(healed.serviceStatus.gnomadConstraint).toBe("ok");
    expect(healed.gnomadConstraint.mis_z).toBe(2.5);

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
});
