import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPdbHomologs, fetchAlphafoldPdb, fetchPdbFromRcsb, fetchFullPdbEntry, extractChainFromPdb, fetchVerifiedExperimentalChain, fetchBestPdbStructure, selectionWasIncomplete, selectionRefusal } from "./structure-fetcher.ts";
import { clearResidueCoverageCache } from "../external-api/pdbe-coverage.ts";
import { pdbCache, afUrlCache, bestPdbCache } from "../infra/cache.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import { uniprotSeqCache } from "../external-api/uniprot.ts";

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

  it("reads sequence identity from the verbose match context (not the relevance score) and deduplicates redundant models from the same species", async () => {
    const mockSequence = "MKVLVLGSGGREHALAWKAAQAAPEVVAVHT";
    // `results_verbosity: "verbose"` returns each hit's alignment. The relevance `score` is set
    // DIFFERENT from the identity on purpose: the parser used to read the score as identity.
    const hit = (identifier: string, identity: number) => ({
      identifier,
      score: 0.5,
      services: [{ nodes: [{ match_context: [{ sequence_identity: identity / 100, alignment_length: 31, query_beg: 1, query_end: 31 }] }] }]
    });

    const mockRcsbSearchResult = {
      result_set: [
        hit("5V3M_3", 100), // Self or near-identical human (100% -> top representative kept)
        hit("5V3X_3", 100), // Duplicate 100% human structure -> should be filtered as redundant
        hit("5V3J_3", 98), // 98% Mouse
        hit("5WJQ_3", 97), // 97% Mouse (micro-redundant to 5V3J in same 95-100% bucket -> should be filtered)
        hit("2I13_3", 76), // 76% Mouse (distinct 75% bucket -> kept)
        hit("5V3G_3", 74), // 74% Human (75% bucket Human -> kept)
        hit("5EGB_3", 60), // 60% Human (60% bucket Human -> kept)
        hit("6ML2_1", 51)  // 51% Mouse (50% bucket Mouse -> kept)
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

    // Coverage and range come from the alignment too.
    expect(hit5V3G?.coverage).toBe(100);
    expect(hit5V3G?.querySeqFrom).toBe(1);
    expect(hit5V3G?.querySeqTo).toBe(31);
  });

  it("reports identity, coverage and range as unknown when the search returned no match context", async () => {
    // 9QN5 on NAE1 was listed at "5% ID · In Range": its relevance score as identity, an invented 80%
    // coverage, and a range assumed to cover the variant.
    const mockSequence = "MKVLVLGSGGREHALAWKAAQAAPEVVAVHT";
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprotkb")) return new Response(`>sp|Q13564|NAE1\n${mockSequence}`, { status: 200 });
      if (u.includes("rcsbsearch")) {
        return new Response(JSON.stringify({ result_set: [{ identifier: "9QN5_1", score: 0.05 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("graphql")) {
        return new Response(JSON.stringify({ data: { entries: [{
          rcsb_id: "9QN5",
          struct: { title: "Cryo-EM structure" },
          rcsb_entry_info: { experimental_method: "ELECTRON MICROSCOPY", resolution_combined: [1.97] },
          polymer_entities: [{ rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }]
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200 });
    }));

    const [only] = await fetchPdbHomologs("Q13564", 116);
    expect(only.pdbId).toBe("9QN5");
    expect(only.identity).toBeNull();
    expect(only.coverage).toBeNull();
    expect(only.coversPosition).toBeUndefined();
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

  it("carries the matching polymer entity's author chain onto each homolog", async () => {
    // The search matched ENTITY 3 of 5V3M; that entity occupies author chain C, and chain A is a
    // different polymer. The loader must be told C, never fall back to A.
    AnalysisDatabase.resetInstance(":memory:");
    pdbCache.clear();
    const mockSequence = "MKVLVLGSGGREHALAWKAAQAAPEVVAVHT";
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprotkb")) return new Response(`>sp|Q9H1C1|TEST\n${mockSequence}`, { status: 200 });
      if (u.includes("rcsbsearch")) {
        return new Response(JSON.stringify({
          result_set: [
            { identifier: "5V3M_3", score: 0.9, services: [{ nodes: [{ match_context: [{ sequence_identity: 1.0, alignment_length: 31, query_beg: 1, query_end: 31 }] }] }] },
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("graphql")) {
        return new Response(JSON.stringify({ data: { entries: [{
          rcsb_id: "5V3M",
          struct: { title: "Zinc finger complex" },
          rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.1] },
          polymer_entities: [
            {
              rcsb_polymer_entity_container_identifiers: { entity_id: "1", asym_ids: ["A"], auth_asym_ids: ["A"] },
              rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }]
            },
            {
              rcsb_polymer_entity_container_identifiers: { entity_id: "3", asym_ids: ["C"], auth_asym_ids: ["C"] },
              rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }]
            },
          ],
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }));

    const homologs = await fetchPdbHomologs("Q9H1C1");
    const hit = homologs.find(h => h.pdbId === "5V3M") as any;
    expect(hit?.chainId).toBe("C");
  });

  it("merges direct PDBe mappings covering the site ahead of RCSB homologs without fabricating identity", async () => {
    AnalysisDatabase.resetInstance(":memory:");
    pdbCache.clear();
    bestPdbCache.clear();
    uniprotSeqCache.clear();
    const mockSequence = "M".repeat(806);
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprotkb")) return new Response(`>sp|P22607|FGFR3_HUMAN\n${mockSequence}`, { status: 200 });
      if (u.includes("pdbe/graph-api/mappings/best_structures/P22607")) {
        return new Response(JSON.stringify({
          P22607: [
            { pdb_id: "2lzl", chain_id: "A", experimental_method: "Solution NMR", resolution: null, tax_id: 9606, unp_start: 357, unp_end: 399, start: 1, end: 43, coverage: 0.055 },
            { pdb_id: "9eko", chain_id: "A", experimental_method: "X-ray diffraction", resolution: 2.901, tax_id: 9606, unp_start: 371, unp_end: 399, start: 447, end: 475, coverage: 0.037 },
            { pdb_id: "1ry7", chain_id: "A", experimental_method: "X-ray diffraction", resolution: 3.2, tax_id: 9606, unp_start: 32, unp_end: 365, start: 1, end: 334, coverage: 0.41 },
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("rcsbsearch")) {
        return new Response(JSON.stringify({
          result_set: [
            { identifier: "8JQI_1", score: 0.9, services: [{ nodes: [{ match_context: [{ sequence_identity: 0.68, alignment_length: 725, query_beg: 74, query_end: 798 }] }] }] },
            { identifier: "1RY7_1", score: 1.0, services: [{ nodes: [{ match_context: [{ sequence_identity: 1.0, alignment_length: 334, query_beg: 32, query_end: 365 }] }] }] },
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("graphql")) {
        return new Response(JSON.stringify({
          data: {
            entries: [
              { rcsb_id: "8JQI", struct: { title: "FGFR1 complex" }, rcsb_entry_info: { experimental_method: "ELECTRON MICROSCOPY", resolution_combined: [4.1] }, polymer_entities: [{ rcsb_polymer_entity_container_identifiers: { entity_id: "1", auth_asym_ids: ["A"] }, rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }] },
              { rcsb_id: "1RY7", struct: { title: "FGFR3 Ig domain" }, rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [3.2] }, polymer_entities: [{ rcsb_polymer_entity_container_identifiers: { entity_id: "1", auth_asym_ids: ["A"] }, rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }] },
            ]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }));

    const homologs = await fetchPdbHomologs("P22607", 380);
    expect(homologs.map(h => h.pdbId)).toEqual(["9EKO", "2LZL", "8JQI", "1RY7"]);
    expect(homologs[0]).toMatchObject({
      pdbId: "9EKO",
      chainId: "A",
      identity: null,
      source: "pdbe",
      directMapping: true,
      querySeqFrom: 371,
      querySeqTo: 399,
      coversPosition: true,
      resolution: 2.901,
    });
    expect(homologs[1]).toMatchObject({
      pdbId: "2LZL",
      source: "pdbe",
      directMapping: true,
      identity: null,
      coversPosition: true,
    });
    expect(homologs[2]).toMatchObject({ pdbId: "8JQI", identity: 68, source: "rcsb" });
    expect(homologs[3]).toMatchObject({ pdbId: "1RY7", identity: 100, source: "rcsb", directMapping: true });
  });

  it("does not duplicate an entry returned by both PDBe and RCSB and keeps RCSB metadata", async () => {
    AnalysisDatabase.resetInstance(":memory:");
    pdbCache.clear();
    bestPdbCache.clear();
    uniprotSeqCache.clear();
    const mockSequence = "M".repeat(200);
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprotkb")) return new Response(`>sp|P99901|TEST\n${mockSequence}`, { status: 200 });
      if (u.includes("pdbe/graph-api/mappings/best_structures/P99901")) {
        return new Response(JSON.stringify({
          P99901: [
            { pdb_id: "1yov", chain_id: "A", experimental_method: "X-ray diffraction", resolution: 2.6, tax_id: 9606, unp_start: 1, unp_end: 200, start: 1, end: 200, coverage: 1.0 },
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("rcsbsearch")) {
        return new Response(JSON.stringify({
          result_set: [
            { identifier: "1YOV_1", score: 1.0, services: [{ nodes: [{ match_context: [{ sequence_identity: 1.0, alignment_length: 200, query_beg: 1, query_end: 200 }] }] }] },
            { identifier: "1DUP_1", score: 0.9, services: [{ nodes: [{ match_context: [{ sequence_identity: 1.0, alignment_length: 200, query_beg: 1, query_end: 200 }] }] }] },
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("graphql")) {
        return new Response(JSON.stringify({
          data: {
            entries: [
              { rcsb_id: "1YOV", struct: { title: "NAE1 crystal structure" }, rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.6] }, polymer_entities: [{ rcsb_polymer_entity_container_identifiers: { entity_id: "1", auth_asym_ids: ["A"] }, rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }] },
              { rcsb_id: "1DUP", struct: { title: "Duplicate human crystal" }, rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.9] }, polymer_entities: [{ rcsb_polymer_entity_container_identifiers: { entity_id: "1", auth_asym_ids: ["A"] }, rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }] },
            ]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }));

    const homologs = await fetchPdbHomologs("P99901", 116);
    expect(homologs.map(h => h.pdbId)).toEqual(["1YOV"]);
    expect(homologs[0]).toMatchObject({
      pdbId: "1YOV",
      title: "NAE1 crystal structure",
      organism: "Homo sapiens",
      identity: 100,
      source: "rcsb",
      directMapping: true,
    });
  });

  it("still returns RCSB homologs when PDBe fails, without caching the degraded list", async () => {
    AnalysisDatabase.resetInstance(":memory:");
    pdbCache.clear();
    bestPdbCache.clear();
    uniprotSeqCache.clear();
    const mockSequence = "M".repeat(200);
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("uniprotkb")) return new Response(`>sp|P99902|TEST\n${mockSequence}`, { status: 200 });
      if (u.includes("pdbe/graph-api/mappings/best_structures/P99902")) {
        return new Response("unavailable", { status: 500 });
      }
      if (u.includes("rcsbsearch")) {
        return new Response(JSON.stringify({
          result_set: [
            { identifier: "8JQI_1", score: 0.9, services: [{ nodes: [{ match_context: [{ sequence_identity: 0.68, alignment_length: 190, query_beg: 1, query_end: 190 }] }] }] },
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("graphql")) {
        return new Response(JSON.stringify({
          data: {
            entries: [
              { rcsb_id: "8JQI", struct: { title: "Homolog" }, rcsb_entry_info: { experimental_method: "X-RAY DIFFRACTION", resolution_combined: [2.5] }, polymer_entities: [{ rcsb_polymer_entity_container_identifiers: { entity_id: "1", auth_asym_ids: ["A"] }, rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens" }] }] },
            ]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }));

    const homologs = await fetchPdbHomologs("P99902", 50);
    expect(homologs.map(h => h.pdbId)).toEqual(["8JQI"]);
    expect(pdbCache.has("homologs_v4_P99902_pos_50")).toBe(false);
  });
});

// Audit F3/F4 (doc/PDB_RESIDUE_COVERAGE_AUDIT.md): PDBe's `unp_start..unp_end` is the construct's span, not
// the residues with coordinates. ABCG1's five cryo-EM entries all span 1-678 and none models Gly358.
describe("an entry whose range covers the site but has no coordinates there", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const row = (pdb_id: string, resolution: number) => ({ pdb_id, chain_id: "A", experimental_method: "Electron Microscopy", resolution, tax_id: 9606, unp_start: 1, unp_end: 678, start: 1, end: 678, coverage: 1 });
  const unipdb = (entries: Array<[string, Array<[number, number, "Y" | "N"]>]>) => ({
    P45844: { length: 678, data: entries.map(([id, ranges]) => ({ accession: id, dataType: "bestChain", residues: ranges.map(([startIndex, endIndex, observed]) => ({ startIndex, endIndex, observed })) })) },
  });
  let calls: string[] = [];
  const stub = (coverage: unknown) => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("uniprotkb")) return new Response(`>sp|P45844|ABCG1_HUMAN
${"G".repeat(678)}`, { status: 200 });
      if (u.includes("mappings/best_structures/P45844")) return json({ P45844: [row("7fdv", 3.26), row("7oz1", 4.0)] });
      if (u.includes("uniprot/unipdb/P45844")) return coverage === null ? new Response("busy", { status: 503 }) : json(coverage);
      return new Response("not found", { status: 404 });
    }));
  };
  beforeEach(() => {
    AnalysisDatabase.resetInstance(":memory:");
    pdbCache.clear();
    bestPdbCache.clear();
    uniprotSeqCache.clear();
    clearResidueCoverageCache();
    vi.restoreAllMocks();
  });

  it("chooses no experimental chain, downloads none, and remembers the answer", async () => {
    stub(unipdb([["7fdv", [[1, 347, "Y"], [348, 396, "N"], [397, 678, "Y"]]], ["7oz1", [[96, 345, "Y"], [398, 676, "Y"]]]]));
    expect(await fetchBestPdbStructure("P45844", 358)).toBeNull();
    expect(calls.some(u => u.includes("files.rcsb.org"))).toBe(false);
    // A finished examination, not an outage: the answer is cached, so the next request asks nothing.
    expect(selectionWasIncomplete("P45844", 358)).toBe(false);
    // The model used instead says why, with the number of entries whose range spans the residue.
    expect(selectionRefusal("P45844", 358)).toEqual({ unmodelledResidue: 358, entries: 2 });
    calls = [];
    expect(await fetchBestPdbStructure("P45844", 358)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("marks each listed entry by whether it has coordinates at the site, those that do first", async () => {
    stub(unipdb([["7fdv", [[1, 347, "Y"], [397, 678, "Y"]]], ["7oz1", [[96, 678, "Y"]]]]));
    const homologs = await fetchPdbHomologs("P45844", 358);
    expect(homologs.map(h => [h.pdbId, h.coversPosition, h.modelsPosition])).toEqual([["7OZ1", true, true], ["7FDV", true, false]]);
  });

  it("says nothing about coordinates when PDBe's coverage did not answer, and does not cache that list", async () => {
    stub(null);
    const homologs = await fetchPdbHomologs("P45844", 358);
    expect(homologs[0]).toMatchObject({ pdbId: "7FDV", coversPosition: true });
    expect(homologs[0].modelsPosition).toBeUndefined();
    expect(pdbCache.get("homologs_v5_P45844_pos_358")).toBeUndefined();
  });
});

describe("per-atom records and validation-keyed chain caching", () => {
  beforeEach(() => {
    pdbCache.clear();
    afUrlCache.clear();
    AnalysisDatabase.resetInstance(":memory:");
    vi.restoreAllMocks();
  });

  it("drops ANISOU/SIGATM/SIGUIJ rather than keep the authors' numbering beside a shifted chain", () => {
    const text = [
      "ATOM      1  N   MET A   1      11.104  13.205   3.120  1.00 20.00           N",
      "ANISOU    1  N   MET A   1      1000   1000   1000   1000   1000   1000       N",
      "SIGATM    1  N   MET A   1      0.10   0.10   0.10   0.10   0.10   0.10       N",
      "SIGUIJ    1  N   MET A   1      0.10   0.10   0.10   0.10   0.10   0.10       N",
      "ATOM      2  CA  MET A   1      12.500  13.500   3.500  1.00 20.00           C",
      "ANISOU    2  CA  MET A  99      1000   1000   1000   1000   1000   1000       C",
      "END",
    ].join("\n");

    const out = extractChainFromPdb(text, "A", 10);

    expect(out).toContain("MET A  11");
    expect(out).not.toMatch(/ANISOU|SIGATM|SIGUIJ/);
  });

  it("keys a validated chain by accession and wild-type, so another context cannot be served it", async () => {
    let downloads = 0;
    const chainText = "ATOM      1  CA  MET A   1      27.340  24.430   2.614  1.00 50.00           C";
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("files.rcsb.org")) {
        downloads++;
        return new Response(chainText, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));

    const ctx = (uniprotId: string, expectedWt1: string) => ({ uniprotId, sequence: "MAP", pos: 1, expectedWt1 });

    const same1 = await fetchPdbFromRcsb("1AAA", "A", undefined, undefined, ctx("P12345", "M"));
    const same2 = await fetchPdbFromRcsb("1AAA", "A", undefined, undefined, ctx("P12345", "M"));
    expect(same1).toBeTruthy();
    expect(same2).toBe(same1);
    expect(downloads, "an identical validation context must be a cache hit").toBe(1);

    const otherAccession = await fetchPdbFromRcsb("1AAA", "A", undefined, undefined, ctx("Q99999", "M"));
    expect(otherAccession).toBeTruthy();
    expect(downloads, "a different accession must not share the validated chain").toBe(2);

    const otherWildType = await fetchPdbFromRcsb("1AAA", "A", undefined, undefined, ctx("P12345", "A"));
    expect(otherWildType, "a different wild-type expectation must revalidate").toBeNull();
    expect(downloads, "a different wild-type must not share the validated chain").toBe(3);
  });
});

const VERIFY_ACCESSION = "P12345";
const VERIFY_UNIPROT = "MKTAYIAKQRQISFVKSHFSRQ"; // 22 aa; residue 15 is V
const VERIFY_THREE: Record<string, string> = {
  A: "ALA", R: "ARG", N: "ASN", D: "ASP", C: "CYS", Q: "GLN", E: "GLU", G: "GLY", H: "HIS", I: "ILE",
  L: "LEU", K: "LYS", M: "MET", F: "PHE", P: "PRO", S: "SER", T: "THR", W: "TRP", Y: "TYR", V: "VAL",
};

function verifyAtomLine(serial: number, res: string, chain: string, seq: number): string {
  return (
    "ATOM  " + String(serial).padStart(5) + "   CA " + res.padStart(3) + " " + chain +
    String(seq).padStart(4) + "    " + (seq * 1.1).toFixed(3).padStart(8) + "   0.000   0.000  1.00 30.00           C"
  );
}

/** UniProt 1–10, then a GGG insertion absent from UniProt, then UniProt 11–22; author numbers run 1–25. */
function verifyConstruct(siteMut?: string): string {
  const mid = VERIFY_UNIPROT.slice(0, 10) + "GGG" + VERIFY_UNIPROT.slice(10);
  const chars = [...mid];
  if (siteMut) chars[17] = siteMut; // UniProt 15 sits at author index 17 past the insertion
  return chars.map((aa, i) => verifyAtomLine(i + 1, VERIFY_THREE[aa], "A", i + 1)).join("\n");
}

const verifyNamesAt = (text: string, pos: number) =>
  text.split("\n").filter(l => l.startsWith("ATOM") && Number(l.slice(22, 26)) === pos).map(l => l.slice(17, 20).trim());

describe("fetchVerifiedExperimentalChain — residue-by-residue verification", () => {
  beforeEach(() => {
    pdbCache.clear();
    afUrlCache.clear();
    uniprotSeqCache.clear();
    AnalysisDatabase.resetInstance(":memory:");
    vi.restoreAllMocks();
  });

  const stub = (pdbId: string, text: string) => {
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes(`files.rcsb.org/download/${pdbId}.pdb`)) return new Response(text, { status: 200 });
      if (u.includes(`uniprotkb/${VERIFY_ACCESSION}.fasta`)) return new Response(`>sp|${VERIFY_ACCESSION}|TEST\n${VERIFY_UNIPROT}\n`, { status: 200 });
      return new Response("not found", { status: 404 });
    }));
  };

  it("numbers both sides of an insertion from the alignment, not from one PDBe shift", async () => {
    stub("1XYW", verifyConstruct());
    const verified = await fetchVerifiedExperimentalChain("1XYW", "A", VERIFY_ACCESSION, 15, 1, 1);

    expect(verified).not.toBeNull();
    // A single shift taken at the site would put every residue past the GGG off by three.
    expect(verifyNamesAt(verified!.pdbText, 2)).toEqual([VERIFY_THREE[VERIFY_UNIPROT[1]]]);
    expect(verifyNamesAt(verified!.pdbText, 15)).toEqual([VERIFY_THREE[VERIFY_UNIPROT[14]]]);
    expect(verifyNamesAt(verified!.pdbText, 22)).toEqual([VERIFY_THREE[VERIFY_UNIPROT[21]]]);
    expect(verified!.validatedAt).toBe(15);
  });

  it("returns null when the site residue does not match the UniProt wild type", async () => {
    // The construct carries Ala where UniProt has Val15: a mapping that puts the variant on this
    // position would be wrong, so it must not be offered as UniProt-numbered experimental.
    stub("1XYA", verifyConstruct("A"));
    const verified = await fetchVerifiedExperimentalChain("1XYA", "A", VERIFY_ACCESSION, 15, 1, 1);
    expect(verified).toBeNull();
  });
});
