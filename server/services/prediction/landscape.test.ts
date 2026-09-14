import { describe, it, expect, vi } from "vitest";

// Landscape aggregation orchestrates several external services; in this test we want to
// isolate the post-fetch statistics, so stub out the dependent network-call modules.
vi.mock("./dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: vi.fn(() => false),
  queryLocalDbnsfpVariant: vi.fn(async () => null),
  queryLocalDbnsfpLandscape: vi.fn(async () => null)
}));
vi.mock("../external-api/genos_web.ts", () => ({ queryGenosLandscape: vi.fn(async () => []) }));
vi.mock("../external-api/uniprot.ts", () => ({
  resolveGeneToUniprot: vi.fn(async () => "P00439"),
  fetchUniprotSequence: vi.fn(async () => "MKVLIVGLGNCGVFSLLDKN")
}));

import { fetchLandscapeData } from "./landscape.ts";

describe("fetchLandscapeData Stats Calculations", () => {
  it("should calculate mean, median, min, max and count for REVEL and AlphaMissense", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    
    const hitsPayload = {
      hits: [
          {
            dbnsfp: {
              aa: { pos: 5 },
              revel: { score: 0.2 },
              alphamissense: { score: 0.1 },
              'gerp++': { rs: 1.5 },
              phylop: { '100way_vertebrate': { score: 0.5 } }
            }
          },
          {
            dbnsfp: {
              aa: { pos: 5 },
              revel: { score: 0.8 },
              alphamissense: { score: 0.9 },
              'gerp++': { rs: 2.5 },
              phylop: { '100way_vertebrate': { score: 1.5 } }
            }
          },
          {
            dbnsfp: {
              aa: { pos: 5 },
              revel: { score: 0.5 },
              alphamissense: { score: 0.5 },
              'gerp++': { rs: 2.0 },
              phylop: { '100way_vertebrate': { score: 1.0 } }
            }
          }
        ]
      };
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(hitsPayload), { status: 200, headers: { "Content-Type": "application/json" } })
      );

    const data = await fetchLandscapeData("PAH", 5, 5);
    expect(data).toHaveLength(1);
    const pos5 = data[0];
    
    expect(pos5.residx).toBe(5);
    expect(pos5.revelMean).toBeCloseTo(0.5);
    expect(pos5.revelMedian).toBeCloseTo(0.5);
    expect(pos5.revelMin).toBe(0.2);
    expect(pos5.revelMax).toBe(0.8);
    expect(pos5.revelCount).toBe(3);

    expect(pos5.amMean).toBeCloseTo(0.5);
    expect(pos5.amMedian).toBeCloseTo(0.5);
    expect(pos5.amMin).toBe(0.1);
    expect(pos5.amMax).toBe(0.9);
    expect(pos5.amCount).toBe(3);

    expect(pos5.gerp).toBeCloseTo(2.0);
    expect(pos5.phylop).toBeCloseTo(1.0);

    fetchSpy.mockRestore();
  });
});
