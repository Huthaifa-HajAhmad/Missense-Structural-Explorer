import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPdbHomologs } from "./structure-fetcher.ts";
import { pdbCache } from "./cache.ts";

describe("fetchPdbHomologs & Diversity Clustering", () => {
  beforeEach(() => {
    pdbCache.clear();
    vi.restoreAllMocks();
  });

  it("should parse polymer_entity hits, calculate accurate sequence identity percentages, and deduplicate redundant models from the same species", async () => {
    const mockSequence = "MKVLVLGSGGREHALAWKAAQAAPEVVAVHT";

    const mockRcsbSearchResult = {
      result_set: [
        { identifier: "5V3M_3", score: 1.0 }, // Self or near-identical human (100% -> should be skipped by >98% rule)
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

    // 1. 5V3M (100% identity) excluded as self-match
    expect(pdbIds).not.toContain("5V3M");

    // 2. 5V3J (98% Mouse) is included
    expect(pdbIds).toContain("5V3J");

    // 3. 5WJQ (97% Mouse) is filtered out because 5V3J is already selected in the 95-100% Mouse bucket
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
});
