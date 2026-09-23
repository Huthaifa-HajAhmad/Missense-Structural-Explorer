import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchCoreVariantData } from "./core-data-fetcher.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

vi.mock("./clinvar.ts", () => ({
  fetchClinVarData: vi.fn(async () => ({
    classification: "Pathogenic",
    conditions: "Phenylketonuria",
    reviewStatus: "criteria provided, multiple submitters, no conflicts",
    lastEvaluated: "2023-01-01"
  }))
}));

vi.mock("../prediction/index.ts", () => ({
  fetchPredictorData: vi.fn(async () => ({
    caddPhred: 28.5,
    revel: 0.85,
    amPathogenicity: 0.92,
    amClass: "pathogenic",
    gnomadVariantId: "12-102845012-G-A",
    // The gnomAD frequency lookup is now gated on the coordinate's build: the endpoint is
    // gnomAD r4 (GRCh38-only) and answers by numeric position, so an untagged coordinate is
    // refused rather than sent. Fixtures must declare the build they mean.
    gnomadVariantAssembly: "GRCh38"
  })),
  fetchConservationData: vi.fn(async () => ({
    revel: 0.85,
    bayesdel: 0.45,
    phylop: 7.2
  })),
  fetchConservationDataProgressive: vi.fn(async () => ({}))
}));

vi.mock("../structure/structure-fetcher.ts", () => ({
  fetchBestPdbStructure: vi.fn(async () => ({
    pdbId: "2PAH",
    chainId: "A",
    unpStart: 1,
    structStart: 1,
    resolution: 1.8
  })),
  fetchAlphafoldPdb: vi.fn(async () => "MOCK_AF_PDB"),
  fetchPdbFromRcsb: vi.fn(async () => "MOCK_RCSB_PDB")
}));

vi.mock("./string.ts", () => ({
  fetchStringInteractions: vi.fn(async () => [
    { preferredName: "QDPR", score: 0.95 }
  ])
}));

vi.mock("./gnomad.ts", () => ({
  fetchGnomadGeneConstraint: vi.fn(async () => ({
    missense_z: 1.8,
    oe_mis: 0.72,
    pli: 0.95,
    isPP2Constrained: true
  })),
  fetchGnomadVariantFrequency: vi.fn(async () => ({
    maxAF: 0.00002,
    groupMaxAF: 0.00002,
    genomeAF: 0.00001,
    exomeAF: 0.00003,
    nHomozygous: 0,
    dataset: "gnomad_v4"
  })),
  fetchLocalPopulationFrequencies: vi.fn(async () => null)
}));

vi.mock("./uniprot.ts", () => ({
  fetchUniprotFeatures: vi.fn(async () => ({
    features: [
      { type: "Active site", start: 408, end: 408, description: "Catalytic core" }
    ]
  }))
}));

vi.mock("../stability/biophysics.ts", () => ({
  predictStructuralDisruption: vi.fn(async () => ({
    level: "high",
    reason: "Disrupts active site",
    plddt: 92.5
  })),
  runEsm2Eval: vi.fn(async () => ({
    llr: -7.5,
    verdict: "deleterious"
  }))
}));

vi.mock("./genos_web.ts", () => ({
  queryGenosWebservice: vi.fn(async () => null)
}));

vi.mock("../prediction/dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: vi.fn(() => false)
}));

vi.mock("../orchestration/self-healer.ts", () => ({
  healCachedAnalysisIfPossible: vi.fn()
}));

vi.mock("../infra/analysis-db.ts", () => ({
  AnalysisDatabase: {
    getInstance: vi.fn(() => ({
      getVariantAnalysisAsync: vi.fn(async () => null),
      saveVariantAnalysisAsync: vi.fn(async () => {}),
      getExternalCacheAsync: vi.fn(async () => null),
      saveExternalCacheAsync: vi.fn(async () => {})
    }))
  }
}));

describe("Core Data Fetcher Service Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("should successfully fetch and assemble all core data components", async () => {
    const result = await fetchCoreVariantData(baseContext, 2000);

    expect(result).toBeDefined();
    expect(result.clinvar?.classification).toBe("Pathogenic");
    expect(result.predictorData?.caddPhred).toBe(28.5);
    expect(result.gnomadConstraint?.isPP2Constrained).toBe(true);
    expect(result.gnomadFrequency?.maxAF).toBe(0.00002);
    expect(result.resolvedPdbId).toBe("2PAH");
    expect(result.resolvedPdbSource).toBe("RCSB PDB");
    expect(result.ruleBasedInsights?.acmgVerdict).toBeDefined();

    // Verify service status map
    expect(result.serviceStatus.clinvar).toBe("ok");
    expect(result.serviceStatus.predictorData).toBe("ok");
    expect(result.serviceStatus.gnomadConstraint).toBe("ok");
    expect(result.serviceStatus.gnomadFrequency).toBe("ok");
    expect(result.serviceStatus.pdbMapping).toBe("ok");
  });

  it("does not query gnomAD with a coordinate whose build is unknown", async () => {
    // gnomAD r4 is GRCh38-only and answers by numeric position, so an id from another build whose
    // alleles coincide returns a DIFFERENT locus's frequency. Those frequencies drive
    // PM2/BA1/BS1/PS4, making this the highest-impact wrong number the pipeline can produce.
    // An untagged coordinate must therefore yield no frequency rather than a confident wrong one.
    // Both modules are already mocked at module scope; no dynamic import is needed.
    const { fetchPredictorData } = await import("../prediction/index.ts");
    const { fetchGnomadVariantFrequency } = await import("./gnomad.ts");
    vi.mocked(fetchGnomadVariantFrequency).mockClear();
    vi.mocked(fetchPredictorData).mockResolvedValueOnce({
      caddPhred: 28.5, revel: 0.85, amPathogenicity: 0.92, amClass: "pathogenic",
      gnomadVariantId: "12-102845012-G-A"
      // gnomadVariantAssembly deliberately absent.
    } as any);

    const result = await fetchCoreVariantData(baseContext, 2000);

    expect(fetchGnomadVariantFrequency).not.toHaveBeenCalled();
    expect(result.gnomadFrequency).toBeNull();
    /**
     * ...and the refusal must be RECORDED as one.
     *
     * This assertion is the one that matters clinically. The gate used to return `null` with no flag,
     * so the status became `not_found` — the same value a genuine confirmed absence carries — and the
     * ACMG classifier read it as one: a zero frequency and **PM2 awarded for a variant gnomAD was
     * never asked about**.
     */
    expect(result.serviceStatus.gnomadFrequency).toBe("unsupported-build");
  });

  it("should handle service errors gracefully and report status as error/not_found without throwing", async () => {
    const { fetchClinVarData } = await import("./clinvar.ts");
    vi.mocked(fetchClinVarData).mockRejectedValueOnce(new Error("ClinVar network timeout"));

    const result = await fetchCoreVariantData(baseContext, 2000);

    expect(result).toBeDefined();
    expect(result.clinvar).toBeNull();
    expect(result.serviceStatus.clinvar).toBe("error");
    // Other independent services should still succeed
    expect(result.predictorData?.caddPhred).toBe(28.5);
    expect(result.serviceStatus.predictorData).toBe("ok");
  });
});
