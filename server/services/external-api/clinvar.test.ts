import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchClinVarData } from "./clinvar.ts";
import { clearAllCaches } from "../infra/cache.ts";

describe("fetchClinVarData", () => {
  beforeEach(() => {
    clearAllCaches(true);
  });

  it("should return parsed results if variant title matches (exact or mapped AA codes)", async () => {
    const mockSearchResponse = {
      esearchresult: {
        idlist: ["12345"]
      }
    };

    const mockSummaryResponse = {
      result: {
        uids: ["12345"],
        "12345": {
          title: "NM_000277.3(PAH):c.1224C>T (p.Arg408Trp)",
          germline_classification: {
            description: "Pathogenic",
            last_evaluated: "2023-01-01",
            review_status: "practice guideline",
            trait_set: [{ trait_name: "Phenylketonuria" }]
          },
          allele_freq_set: [
            { source: "gnomAD", value: "0.0005" }
          ]
        }
      }
    };

    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResponse
    } as any);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummaryResponse
    } as any);

    const res = await fetchClinVarData("PAH", "p.Arg408Trp");
    expect(res.classification).toBe("Pathogenic");
    expect(res.trait).toBe("Phenylketonuria");
    expect(res.uid).toBe("12345");
    expect(res.alleleFrequencies[0].value).toBe("0.0005");

    fetchSpy.mockRestore();
  });

  it("should not match and return default response if title doesn't match clean variant", async () => {
    const mockSearchResponse = {
      esearchresult: {
        idlist: ["67890"]
      }
    };

    const mockSummaryResponse = {
      result: {
        uids: ["67890"],
        "67890": {
          title: "NM_000277.3(PAH):c.1000G>A (p.Ala123Val)",
          germline_classification: {
            description: "Benign"
          }
        }
      }
    };

    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResponse
    } as any);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummaryResponse
    } as any);

    const res = await fetchClinVarData("PAH", "p.Arg408Trp");
    expect(res.classification).toBe("Not found in ClinVar");
    expect(res.uid).toBeNull();

    fetchSpy.mockRestore();
  });

  it("should support direct search by Variation ID or VCV ID", async () => {
    const mockSearchResponse = {
      esearchresult: {
        idlist: ["98765"]
      }
    };

    const mockSummaryResponse = {
      result: {
        uids: ["98765"],
        "98765": {
          title: "NM_000277.3(PAH):c.1224C>T (p.Arg408Trp)",
          germline_classification: {
            description: "Pathogenic",
            last_evaluated: "2023-01-01",
            review_status: "practice guideline",
            trait_set: [{ trait_name: "Phenylketonuria" }]
          },
          allele_freq_set: []
        }
      }
    };

    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResponse
    } as any);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummaryResponse
    } as any);

    const res = await fetchClinVarData("PAH", "VCV000098765");
    expect(res.classification).toBe("Pathogenic");
    expect(res.uid).toBe("98765");

    // Verify search term is structured for Variation ID
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("term=98765%5BVariation%20ID%5D"),
      expect.any(Object)
    );

    fetchSpy.mockRestore();
  });
});
