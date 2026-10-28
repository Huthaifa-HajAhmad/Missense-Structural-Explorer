import { describe, it, expect, vi, beforeEach } from "vitest";

const acmgSpy = vi.hoisted(() => ({ calls: [] as Array<{ conservationData: unknown; status: unknown }> }));
vi.mock("../prediction/acmg.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prediction/acmg.ts")>();
  return {
    ...actual,
    computeRuleBasedACMG: (input: any) => {
      acmgSpy.calls.push({ conservationData: input.conservationData, status: input.serviceStatus?.conservationData });
      return actual.computeRuleBasedACMG(input);
    },
  };
});
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

vi.mock("../prediction/landscape.ts", () => ({
  fetchLocalPopulationFrequencies: vi.fn(async () => null),
}));

vi.mock("../prediction/dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: vi.fn(() => false),
  queryLocalDbnsfpVariant: vi.fn(async () => null),
  readLocalDbnsfpVersion: vi.fn(() => null)
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

import { fetchCoreVariantData } from "./core-data-fetcher.ts";
import { fetchConservationDataProgressive } from "../prediction/index.ts";

/**
 * The conservation composite streams per model (conservation-orchestrator.ts). These pin what the
 * core fetch does with those snapshots: forward them, keep them out of the provisional ACMG verdict,
 * and keep the answered models when the composite's budget expires.
 */
describe("core fetch and the streamed conservation composite", () => {
  const context: ParsedVariantContext = {
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
  const snapshot = {
    available: true, revel: 0.91, gerp: 5.1, phylop: 7.2, spliceai: null,
    modelStatus: { base: "settled", spliceai: "pending", alphagenome: "pending" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    acmgSpy.calls.length = 0;
    // Publishes one snapshot, then never settles: the composite's budget has to end it.
    vi.mocked(fetchConservationDataProgressive).mockImplementation(async (ctx: any) => {
      setTimeout(() => ctx.onPartial?.(snapshot), 5);
      return new Promise(() => {});
    });
  });

  it("forwards the snapshot while the composite is pending, without feeding it to the provisional verdict", async () => {
    const partials: any[] = [];
    await fetchCoreVariantData(context, 300, undefined, p => partials.push(p));

    const streamed = partials.find(p => (p.data as any).conservationData?.revel === 0.91 && p.serviceStatus.conservationData === "pending");
    expect(streamed).toBeDefined();
    expect((streamed.data as any).conservationData.modelStatus.spliceai).toBe("pending");
    // A REVEL-only snapshot must not be counted as the whole in-silico ensemble.
    expect(acmgSpy.calls.some(c => c.status === "pending" && c.conservationData)).toBe(false);
  });

  it("keeps the answered models when the budget expires, and marks the rest timed out", async () => {
    const result = await fetchCoreVariantData(context, 300);

    expect(result.serviceStatus.conservationData).toBe("timeout");
    expect(result.conservationData?.revel).toBe(0.91);
    expect(result.conservationData?.modelStatus).toEqual({ base: "settled", spliceai: "timeout", alphagenome: "timeout" });
    // The final verdict reads the measured base scores rather than discarding them.
    expect(acmgSpy.calls.at(-1)?.conservationData).toMatchObject({ revel: 0.91 });
    // …and the in-silico criterion stands: the voting base ensemble settled, while SpliceAI and AlphaGenome
    // (informational, `isInformationalOnly` in the concordance) cannot change the tally by timing out.
    expect(result.ruleBasedInsights?.acmgCriteria.some(c => c.code === "PP3" || c.code === "BP4")).toBe(true);
  });
});
