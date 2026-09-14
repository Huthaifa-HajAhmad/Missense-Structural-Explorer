import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queryEsmc,
  queryEsmfold2,
  querySaProt,
  queryBoltz2Multimer,
  queryOpenBind,
  clearJapanFoldCache
} from "./japanfold-client.ts";

describe("JapanFold API Client", () => {
  beforeEach(() => {
    clearJapanFoldCache();
    vi.restoreAllMocks();
  });

  describe("queryEsmc", () => {
    it("returns parsed zero-shot metrics on successful API response", async () => {
      const mockResponse = {
        status: "success",
        llr: -2.345,
        wtProbability: 0.12,
        mutProbability: 0.015,
        mutRank: 6,
        positionalEntropy: 2.1,
        embeddingShift: 0.45,
        preferences: [{ aa: "R", prob: 0.12 }, { aa: "H", prob: 0.015 }],
        localShiftMap: [{ position: 408, residue: "R", shift: 0.45 }]
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await queryEsmc("MSLSK", 3, "L", "P");
      expect(result).not.toBeNull();
      expect(result?.llr).toBe(-2.345);
      expect(result?.provenance).toBe("JapanFold ESMC (Tier 1)");
      expect(result?.wtProbability).toBe(0.12);
      expect(result?.embeddingShift).toBe(0.45);
    });

    it("caches identical queries without repeating HTTP requests", async () => {
      const mockResponse = { status: "success", llr: -1.2, wtProbability: 0.2, mutProbability: 0.05 };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const res1 = await queryEsmc("MSLSK", 3, "L", "P");
      const res2 = await queryEsmc("MSLSK", 3, "L", "P");

      expect(res1?.llr).toBe(-1.2);
      expect(res2?.llr).toBe(-1.2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null on network failure without throwing unhandled exceptions", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

      const result = await queryEsmc("MSLSK", 3, "L", "P");
      expect(result).toBeNull();
    });
  });

  describe("queryEsmfold2", () => {
    it("returns PDB coordinate string on successful 3D folding", async () => {
      const mockPdb = "ATOM      1  N   MET A   1       0.000   0.000   0.000  1.00 90.00           N\nTER";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", pdb: mockPdb })
      } as any);

      const pdb = await queryEsmfold2("MSLSK");
      expect(pdb).toBe(mockPdb);
    });

    it("returns null when folding request fails or returns non-200", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable"
      } as any);

      const pdb = await queryEsmfold2("MSLSK");
      expect(pdb).toBeNull();
    });
  });

  describe("querySaProt", () => {
    it("returns structure-aware evaluation metrics", async () => {
      const mockResponse = {
        status: "success",
        llr: -3.12,
        wtProbability: 0.18,
        mutProbability: 0.008,
        conformationState: "A",
        klDivergence: 0.85
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await querySaProt("MSLSK", 3, "L", "P", "ATOM...");
      expect(result).not.toBeNull();
      expect(result?.llr).toBe(-3.12);
      expect(result?.conformationState).toBe("A");
      expect(result?.provenance).toBe("JapanFold SaProt (Tier 1)");
    });
  });

  describe("queryBoltz2Multimer", () => {
    it("returns multi-chain assembly PDB and ipTM scores", async () => {
      const mockResponse = {
        status: "success",
        complexPdb: "ATOM... Chain A... ATOM... Chain B...",
        ipTm: 0.84,
        pTm: 0.91,
        interfaceContacts: [{ resA: 408, resB: 315, distance: 2.8 }]
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await queryBoltz2Multimer([
        { chainId: "A", sequence: "MSLSK" },
        { chainId: "B", sequence: "MSLSK" }
      ]);

      expect(result).not.toBeNull();
      expect(result?.ipTm).toBe(0.84);
      expect(result?.interfaceContacts.length).toBe(1);
      expect(result?.provenance).toBe("JapanFold Boltz-2 (Tier 1)");
    });

    it("returns null for ipTm and pTm when upstream does not provide them", async () => {
      const mockResponse = {
        status: "success",
        complexPdb: "ATOM... Chain A... ATOM... Chain B...",
        interfaceContacts: []
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await queryBoltz2Multimer([
        { chainId: "A", sequence: "MSLSK" },
        { chainId: "B", sequence: "MSLSK" }
      ]);

      expect(result).not.toBeNull();
      expect(result?.ipTm).toBeNull();
      expect(result?.pTm).toBeNull();
    });
  });

  describe("queryOpenBind", () => {
    it("returns binding affinity change (ddG_bind)", async () => {
      const mockResponse = {
        status: "success",
        ddgBind: 2.45,
        unit: "kcal/mol",
        classification: "INTERFACE_DISRUPTIVE"
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await queryOpenBind("ATOM... WT", "ATOM... MUT", "A", "B");
      expect(result).not.toBeNull();
      expect(result?.ddgBind).toBe(2.45);
      expect(result?.classification).toBe("INTERFACE_DISRUPTIVE");
      expect(result?.provenance).toBe("JapanFold OpenBind-0 (Tier 1)");
    });
  });
});
