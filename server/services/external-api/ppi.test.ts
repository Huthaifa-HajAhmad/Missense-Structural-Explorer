import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzePpiBinding } from "./ppi.ts";
import { clearJapanFoldCache } from "./japanfold-client.ts";

describe("PPI Binding Affinity Service Tests", () => {
  beforeEach(() => {
    clearJapanFoldCache();
    vi.restoreAllMocks();
  });

  it("returns STRING partners and curated interface residues", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      // STRING-DB network mock
      if (urlStr.includes("string-db.org")) {
        return {
          ok: true,
          json: async () => [
            { preferredName_A: "PAH", preferredName_B: "QDPR", score: "0.85" },
            { preferredName_A: "PAH", preferredName_B: "PTS", score: "0.72" }
          ]
        } as any;
      }

      // UniProt features mock
      if (urlStr.includes("rest.uniprot.org")) {
        return {
          ok: true,
          json: async () => ({
            entryType: "UniProtKB reviewed (Swiss-Prot)",
            features: [
              {
                type: "Binding site",
                description: "Subunit interface interaction residue",
                location: { start: { value: 408 }, end: { value: 408 } }
              },
              {
                type: "Active site",
                description: "Catalytic iron coordination",
                location: { start: { value: 285 }, end: { value: 285 } }
              }
            ]
          })
        } as any;
      }

      return { ok: false } as any;
    });

    const result = await analyzePpiBinding("PAH", "p.Arg408Trp", "P00439");

    expect(result.status).toBe("success");
    expect(result.stringPartners.length).toBe(2);
    expect(result.stringPartners[0].partner).toBe("QDPR");
    expect(result.stringPartners[0].score).toBe(0.85);

    // Check interface residues identified and ensure catalytic active site (285) is excluded
    expect(result.interfaceResidues.length).toBeGreaterThan(0);
    const variantRes = result.interfaceResidues.find((r) => r.pos === 408);
    expect(variantRes).toBeDefined();
    expect(variantRes?.isVariantPosition).toBe(true);
    expect(result.interfaceResidues.some((r) => r.pos === 285)).toBe(false);

    // No PDBs provided => bindingShift is null (no synthetic fallback)
    expect(result.bindingShift).toBeNull();
  });

  it("computes OpenBind-0 binding affinity shift when mutant complex is provided", async () => {
    const mockWtPdb = "ATOM      1  N   ARG A 408      11.1  12.2  13.3  1.00 20.00           N\nATOM      2  N   ASP B 100      14.1  15.2  16.3  1.00 20.00           N";
    const mockMutPdb = "ATOM      1  N   TRP A 408      11.1  12.2  13.3  1.00 20.00           N\nATOM      2  N   ASP B 100      14.1  15.2  16.3  1.00 20.00           N";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("japanfold.aiand.com")) {
        return {
          ok: true,
          json: async () => ({
            model: "openbind-0",
            status: "success",
            ddgBind: 2.14,
            unit: "kcal/mol",
            classification: "INTERFACE_DISRUPTIVE"
          })
        } as any;
      }

      if (urlStr.includes("string-db.org")) {
        return {
          ok: true,
          json: async () => []
        } as any;
      }

      return { ok: false } as any;
    });

    const result = await analyzePpiBinding(
      "PAH",
      "p.Arg408Trp",
      "P00439",
      mockWtPdb,
      mockMutPdb,
      "A",
      "B"
    );

    expect(result.status).toBe("success");
    expect(result.bindingShift).not.toBeNull();
    expect(result.bindingShift?.ddgBind).toBe(2.14);
    expect(result.bindingShift?.classification).toBe("INTERFACE_DISRUPTIVE");
    expect(result.bindingShift?.provenance).toContain("JapanFold OpenBind-0");
  });
});
