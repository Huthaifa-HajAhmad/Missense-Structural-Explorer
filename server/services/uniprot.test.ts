import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchUniprotFeatures } from "./uniprot.ts";
import { clearAllCaches } from "./cache.ts";

describe("UniProt Features Service", () => {
  beforeEach(() => {
    clearAllCaches(true);
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

  it("should extract InterPro cross-references with abbreviated database names and sequence length", async () => {
    const mockUniProtJson = {
      genes: [{ geneName: { value: "MAST2" } }],
      sequence: { length: 1798 },
      uniProtKBCrossReferences: [
        {
          database: "InterPro",
          id: "IPR000719",
          properties: [{ key: "EntryName", value: "Prot_kinase_dom" }]
        },
        {
          database: "InterPro",
          id: "IPR000961",
          properties: [{ key: "EntryName", value: "AGC-kinase_C" }]
        },
        {
          database: "InterPro",
          id: "IPR001478",
          properties: [{ key: "EntryName", value: "PDZ" }]
        }
      ],
      features: [
        {
          type: "Domain",
          description: "Protein kinase",
          location: { start: { value: 512 }, end: { value: 785 } }
        },
        {
          type: "Domain",
          description: "AGC-kinase C-terminal",
          location: { start: { value: 786 }, end: { value: 854 } }
        },
        {
          type: "Domain",
          description: "PDZ",
          location: { start: { value: 1104 }, end: { value: 1192 } }
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
    expect(result?.sequenceLength).toBe(1798);

    const kinaseDomain = result?.features.find(f => f.description === "Protein kinase");
    expect(kinaseDomain?.interproId).toBe("IPR000719");

    const agcDomain = result?.features.find(f => f.description === "AGC-kinase C-terminal");
    expect(agcDomain?.interproId).toBe("IPR000961");

    const pdzDomain = result?.features.find(f => f.description === "PDZ");
    expect(pdzDomain?.interproId).toBe("IPR001478");
  });
});
