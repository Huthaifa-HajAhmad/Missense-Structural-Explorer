import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchUniprotFeatures } from "./uniprot.ts";
import { uniprotFeaturesCache } from "./cache.ts";

describe("UniProt Features Service", () => {
  beforeEach(() => {
    uniprotFeaturesCache.clear();
    vi.restoreAllMocks();
  });

  it("should parse and retain Domain, Binding site with ligand, and Transmembrane features", async () => {
    const mockUniProtJson = {
      genes: [{ geneName: { value: "MAST2" } }],
      comments: [{ commentType: "SUBUNIT", note: { texts: [{ value: "Homodimer." }] } }],
      features: [
        {
          type: "Domain",
          description: "Protein kinase",
          location: { start: { value: 512 }, end: { value: 785 } }
        },
        {
          type: "Active site",
          description: "Proton acceptor",
          location: { start: { value: 635 }, end: { value: 635 } }
        },
        {
          type: "Binding site",
          description: "",
          ligand: { name: "ATP" },
          location: { start: { value: 518 }, end: { value: 526 } }
        },
        {
          type: "Transmembrane",
          description: "Helical",
          location: { start: { value: 20 }, end: { value: 40 } }
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockUniProtJson
    } as any);

    const result = await fetchUniprotFeatures("Q6P0Q8");
    expect(result).toBeDefined();
    expect(result?.geneName).toBe("MAST2");
    expect(result?.isMultimer).toBe(true);
    expect(result?.features.length).toBe(4);

    const domainFeature = result?.features.find(f => f.type === "Domain");
    expect(domainFeature).toBeDefined();
    expect(domainFeature?.description).toBe("Protein kinase");
    expect(domainFeature?.start).toBe(512);

    const bindingFeature = result?.features.find(f => f.type === "Binding site");
    expect(bindingFeature?.description).toBe("Ligand: ATP");
  });
});
