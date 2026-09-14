import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPdbHomologs, fetchAlphafoldPdb, fetchPdbFromRcsb, fetchFullPdbEntry } from "./structure-fetcher.ts";
import { pdbCache, afUrlCache } from "../infra/cache.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";

describe("structure-fetcher SingleFlight & PDB Cache", () => {
  beforeEach(() => {
    pdbCache.clear();
    afUrlCache.clear();
    AnalysisDatabase.resetInstance(":memory:");
    vi.restoreAllMocks();
  });

  it("should deduplicate concurrent AlphaFold PDB fetches and cache the PDB text", async () => {
    let apiCallCount = 0;
    let pdbDownloadCount = 0;

    const mockPdbText = "ATOM      1  N   MET A   1      27.340  24.430   2.614  1.00 90.00           N\nATOM      2  CA  MET A   1      26.266  25.413   2.842  1.00 90.00           C\nEND";

    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("alphafold.ebi.ac.uk/api/prediction")) {
        apiCallCount++;
        return new Response(JSON.stringify([{ pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.pdb" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (u.includes(".pdb")) {
        pdbDownloadCount++;
        return new Response(mockPdbText, {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }
      return new Response("{}", { status: 200 });
    }));

    // 3 concurrent calls at the exact same moment
    const [res1, res2, res3] = await Promise.all([
      fetchAlphafoldPdb("P04637"),
      fetchAlphafoldPdb("P04637"),
      fetchAlphafoldPdb("P04637")
    ]);

    expect(res1).toBe(mockPdbText);
    expect(res2).toBe(mockPdbText);
    expect(res3).toBe(mockPdbText);

    // SingleFlight ensures only 1 API lookup and 1 PDB text download occurred
    expect(apiCallCount).toBe(1);
    expect(pdbDownloadCount).toBe(1);

    // Subsequent sequential call hits pdbCache directly without any new fetch
    const res4 = await fetchAlphafoldPdb("P04637");
    expect(res4).toBe(mockPdbText);
    expect(pdbDownloadCount).toBe(1);
  });

  it("should deduplicate concurrent RCSB PDB fetches and cache the extracted chain", async () => {
    let rcsbDownloadCount = 0;
    const mockRcsbText = "ATOM      1  N   MET A   1      27.340  24.430   2.614  1.00 50.00           N\nATOM      2  CA  MET A   1      26.266  25.413   2.842  1.00 50.00           C\nEND";

    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("files.rcsb.org")) {
        rcsbDownloadCount++;
        return new Response(mockRcsbText, { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));

    const [pdb1, pdb2, pdb3] = await Promise.all([
      fetchPdbFromRcsb("1TUP", "A"),
      fetchPdbFromRcsb("1TUP", "A"),
      fetchPdbFromRcsb("1TUP", "A")
    ]);

    expect(pdb1).toBeDefined();
    expect(pdb1?.includes("ATOM")).toBe(true);
    expect(pdb2).toBe(pdb1);
    expect(pdb3).toBe(pdb1);

    expect(rcsbDownloadCount).toBe(1);

    // Subsequent call hits pdbCache
    const pdb4 = await fetchPdbFromRcsb("1TUP", "A");
    expect(pdb4).toBe(pdb1);
    expect(rcsbDownloadCount).toBe(1);
  });

  it("should deduplicate concurrent full PDB downloads in fetchFullPdbEntry", async () => {
    let rcsbDownloadCount = 0;
    const mockFullText = "HEADER    TRANSCRIPTION FACTOR\nATOM      1  N   MET A   1      27.340  24.430   2.614  1.00 50.00           N\nEND";

    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("files.rcsb.org")) {
        rcsbDownloadCount++;
        return new Response(mockFullText, { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));

    const [full1, full2] = await Promise.all([
      fetchFullPdbEntry("1TUP"),
      fetchFullPdbEntry("1TUP")
    ]);

    expect(full1).toBe(mockFullText);
    expect(full2).toBe(mockFullText);
    expect(rcsbDownloadCount).toBe(1);
  });
});

describe("fetchPdbHomologs & Diversity Clustering", () => {
  beforeEach(() => {
    pdbCache.clear();
    afUrlCache.clear();
    vi.restoreAllMocks();
  });

  it("should parse polymer_entity hits, calculate accurate sequence identity percentages, and deduplicate redundant models from the same species", async () => {
    const mockSequence = "MKVLVLGSGGREHALAWKAAQAAPEVVAVHT";

    const mockRcsbSearchResult = {
      result_set: [
        { identifier: "5V3M_3", score: 1.0 }, // Self or near-identical human (100% -> top representative kept)
        { identifier: "5V3X_3", score: 1.0 }, // Duplicate 100% human structure -> should be filtered as redundant
        { identifier: "5V3J_3", score: 0.98 }, // 98% Mouse
        { identifier: "5WJQ_3", score: 0.97 }, // 97% Mouse (micro-redundant to 5V3J in same 95-100% bucket -> should be filtered)
        { identifier: "2I13_3", score: 0.76 }, // 76% Mouse (distinct 75% bucket -> kept)
        { identifier: "5V3G_3", score: 0.74 }, // 74% Human (75% bucket Human -> kept)
        { identifier: "5EGB_3", score: 0.60 }, // 60% Human (60% bucket Human -> kept)
        { identifier: "6ML2_1", score: 0.51 }  // 51% Mouse (50% bucket Mouse -> kept)
      ]
    };

    const mockGqlResult = {
      data: {
        entries: [
          {
            rcsb_id: "5V3M",
            struct: { title: "mouseZFP568-ZnF1-10 allele A" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.1] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }]
          },
          {
            rcsb_id: "5V3X",
            struct: { title: "mouseZFP568-ZnF1-10 allele A duplicate state" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.5] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }]
          },
          {
            rcsb_id: "5V3J",
            struct: { title: "mouseZFP568-ZnF1-10 in complex with DNA" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.06] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Mus musculus" }] }]
          },
          {
            rcsb_id: "5WJQ",
            struct: { title: "mouseZFP568-ZnF2-11 in complex with DNA" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.79] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Mus musculus" }] }]
          },
          {
            rcsb_id: "2I13",
            struct: { title: "Aart, a six finger zinc finger designed to recognize a target" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [1.96] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Mus musculus" }] }]
          },
          {
            rcsb_id: "5V3G",
            struct: { title: "PRDM9-allele-C ZnF8-13 in complex with DNA" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.42] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }]
          },
          {
            rcsb_id: "5EGB",
            struct: { title: "Human PRDM9 allele-A ZnF Domain with Associated DNA" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [1.98] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }]
          },
          {
            rcsb_id: "6ML2",
            struct: { title: "ZBTB24 Zinc Fingers 4-8 with DNA" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [1.87] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Mus musculus" }] }]
          }
        ]
      }
    };

    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprotkb")) {
        return new Response(`>sp|Q9H116|TEST_HUMAN\n${mockSequence}`, { status: 200 });
      }
      if (u.includes("rcsbsearch")) {
        return new Response(JSON.stringify(mockRcsbSearchResult), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (u.includes("graphql")) {
        return new Response(JSON.stringify(mockGqlResult), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("{}", { status: 200 });
    }));

    const homologs = await fetchPdbHomologs("Q9H116");
    expect(homologs).toBeDefined();
    expect(Array.isArray(homologs)).toBe(true);

    const pdbIds = homologs.map(h => h.pdbId);

    // 1. 5V3M (100% identity, Homo sapiens) included as top experimental structure
    expect(pdbIds).toContain("5V3M");

    // 2. 5V3X (100% identity duplicate, Homo sapiens) filtered out to prevent redundant self-construct flooding
    expect(pdbIds).not.toContain("5V3X");

    // 3. 5V3J (98% Mouse) is included as top representative for mouse
    expect(pdbIds).toContain("5V3J");

    // 4. 5WJQ (97% Mouse) is filtered out because 5V3J is already selected in the >=95% Mouse bucket
    expect(pdbIds).not.toContain("5WJQ");

    // 4. 2I13 (76% Mouse) is included because it is in a distinct identity tier (75%)
    expect(pdbIds).toContain("2I13");

    // 5. 5V3G (74% Human) is included!
    expect(pdbIds).toContain("5V3G");
    const hit5V3G = homologs.find(h => h.pdbId === "5V3G");
    expect(hit5V3G?.identity).toBe(74);

    // 6. 5EGB (60% Human) is included
    expect(pdbIds).toContain("5EGB");

    // 7. 6ML2 (51% Mouse) is included
    expect(pdbIds).toContain("6ML2");
  });

  it("should dynamically re-rank and isolate cache results across different mutation positions", async () => {
    const mockSequence = "MKVLVLGSGGREHALAWKAAQAAPEVVAVHTMKVLVLGSGGREHALAWKAAQAAPEVVAVHT";

    const mockRcsbSearchResult = {
      result_set: [
        {
          identifier: "1AAA_1",
          score: 0.85,
          services: [{ nodes: [{ match_context: [{ query_sequence_from: 1, query_sequence_to: 20 }] }] }]
        },
        {
          identifier: "2BBB_1",
          score: 0.80,
          services: [{ nodes: [{ match_context: [{ query_sequence_from: 30, query_sequence_to: 60 }] }] }]
        }
      ]
    };

    const mockGqlResult = {
      data: {
        entries: [
          {
            rcsb_id: "1AAA",
            struct: { title: "N-terminal domain structure" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.0] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }]
          },
          {
            rcsb_id: "2BBB",
            struct: { title: "C-terminal domain structure" },
            rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.0] },
            polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }]
          }
        ]
      }
    };

    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprotkb")) {
        return new Response(`>sp|P12345|POS_TEST\n${mockSequence}`, { status: 200 });
      }
      if (u.includes("rcsbsearch")) {
        return new Response(JSON.stringify(mockRcsbSearchResult), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (u.includes("graphql")) {
        return new Response(JSON.stringify(mockGqlResult), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("{}", { status: 200 });
    }));

    // Query 1: pos 10 (covered by 1AAA, not 2BBB) -> 1AAA ranks first
    const homologsPos10 = await fetchPdbHomologs("P12345", 10);
    expect(homologsPos10[0].pdbId).toBe("1AAA");

    // Query 2: pos 40 (covered by 2BBB, not 1AAA) -> 2BBB ranks first even though 1AAA has higher score
    const homologsPos40 = await fetchPdbHomologs("P12345", 40);
    expect(homologsPos40[0].pdbId).toBe("2BBB");
  });

  it("should gracefully return empty array when RCSB query times out or fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string | URL | Request) => {
      const u = typeof url === "string" ? url : (url as Request).url || url.toString();
      if (u.includes("uniprotkb")) {
        return new Response(">sp|P99999|TEST\nMKVLVLGSGGREHALAWKAAQAAPEVVAVHT\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }
      if (u.includes("rcsbsearch")) {
        return Promise.reject(new Error("TimeoutError: Request timed out after 10000ms"));
      }
      return new Response("{}", { status: 200 });
    }));

    const result = await fetchPdbHomologs("P99999", 15);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});
