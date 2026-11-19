import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveStructure } from "./structure-resolver.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";

/**
 * When the local-quality rule (doc/energetics-release/STRUCTURE_SELECTION_RULE.md) finds no examined
 * experimental chain that is the wild type (TP53: the sharpest chains are engineered constructs), the
 * model used instead must still say why, and the homolog tier must not bring one of those chains back.
 */

vi.mock("./structure-fetcher.ts", () => ({
  fetchBestPdbStructure: vi.fn(),
  fetchAlphafoldPdb: vi.fn(),
  fetchPdbFromRcsb: vi.fn(),
  fetchPdbHomologs: vi.fn(),
  fetchVerifiedExperimentalChain: vi.fn(),
  getResolvedAlphafoldVersion: vi.fn(() => "v6"),
  STRUCTURE_SELECTION_VERSION: "select-v4",
  selectionWasIncomplete: vi.fn(() => false),
  selectionRefusal: vi.fn(() => null),
}));
vi.mock("../external-api/uniprot.ts", () => ({ fetchUniprotSequence: vi.fn() }));

const fetchers = await import("./structure-fetcher.ts");

const refusal = { pdbId: "3D06", chainId: "A", differences: ["N239Y", "N268D"], otherChainsRefused: 11 };

describe("no examined chain is the wild type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AnalysisDatabase.resetInstance(":memory:");
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(null);
    vi.mocked(fetchers.selectionRefusal).mockReturnValue(refusal);
  });

  it("puts the refusal on the AlphaFold model, for a view and for a mutating engine", async () => {
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue("AF_PDB" as any);
    for (const options of [{}, { requireWildType: true }]) {
      const resolved = await resolveStructure("P04637", 175, options);
      expect(resolved?.provenance.source).toBe("alphafold");
      expect(resolved?.provenance.excludedExperimental).toEqual(refusal);
    }
  });

  it("keeps the refusal when the choice is read back from memory", async () => {
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue("AF_PDB" as any);
    await resolveStructure("P04637", 273, { requireWildType: true });
    vi.mocked(fetchers.selectionRefusal).mockReturnValue(null);
    const again = await resolveStructure("P04637", 273, { requireWildType: true });
    expect(again?.provenance.excludedExperimental).toEqual(refusal);
  });

  it("never gives a mutating engine a same-protein entry as a 'homolog' when AlphaFold is down", async () => {
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([
      // Another engineered TP53 construct that the rule never downloaded: same protein, not refused by name.
      { pdbId: "8abc", chainId: "A", identity: 99, resolution: 1.1, method: "X-RAY DIFFRACTION", organism: "Homo sapiens", coversPosition: true } as any,
      { pdbId: "2xyz", chainId: "B", identity: 78, resolution: 2.0, method: "X-RAY DIFFRACTION", organism: "Mus musculus", coversPosition: true } as any,
    ]);
    vi.mocked(fetchers.fetchPdbFromRcsb).mockImplementation(async (pdbId: string) => `${pdbId.toUpperCase()}_PDB`);

    const resolved = await resolveStructure("P04637", 248, { requireWildType: true });

    expect(resolved?.provenance.source).toBe("homolog");
    expect(resolved?.provenance.pdbId).toBe("2xyz");
    expect(fetchers.fetchPdbFromRcsb).not.toHaveBeenCalledWith("8abc", "A");
  });

  it("still lets a view use a same-protein entry from the homolog search", async () => {
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([
      { pdbId: "8abc", chainId: "A", identity: 99, resolution: 1.1, method: "X-RAY DIFFRACTION", organism: "Homo sapiens", coversPosition: true } as any,
    ]);
    vi.mocked(fetchers.fetchPdbFromRcsb).mockResolvedValue("8ABC_PDB" as any);

    const resolved = await resolveStructure("P04637", 249);

    expect(resolved?.provenance.pdbId).toBe("8abc");
  });
});
