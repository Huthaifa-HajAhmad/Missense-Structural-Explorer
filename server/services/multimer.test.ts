import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseOligomericState, analyzeMultimerStructure } from "./multimer.ts";
import { clearJapanFoldCache } from "./japanfold-client.ts";

describe("Multimer Service Unit Tests", () => {
  beforeEach(() => {
    clearJapanFoldCache();
    vi.restoreAllMocks();
  });

  describe("parseOligomericState", () => {
    it("identifies homotetramers (e.g. PAH)", () => {
      const parsed = parseOligomericState("Homotetramer; consists of four identical subunits.");
      expect(parsed.isMultimer).toBe(true);
      expect(parsed.chainCount).toBe(4);
      expect(parsed.state).toBe("Homotetramer (A4)");
    });

    it("identifies homodimers (e.g. FGFR3)", () => {
      const parsed = parseOligomericState("Homodimer. Interacts with FGF.");
      expect(parsed.isMultimer).toBe(true);
      expect(parsed.chainCount).toBe(2);
      expect(parsed.state).toBe("Homodimer (A2)");
    });

    it("identifies heterodimers (e.g. NAE1/UBA3)", () => {
      const parsed = parseOligomericState("Heterodimer of NAE1 and UBA3.");
      expect(parsed.isMultimer).toBe(true);
      expect(parsed.isHeteromer).toBe(true);
      expect(parsed.state).toBe("Heterodimer");
    });

    it("identifies monomers", () => {
      const parsed = parseOligomericState("Monomer in solution.");
      expect(parsed.isMultimer).toBe(false);
      expect(parsed.isHeteromer).toBe(false);
      expect(parsed.chainCount).toBe(1);
      expect(parsed.state).toContain("Monomer");
    });
  });

  describe("analyzeMultimerStructure", () => {
    it("returns monomeric verdict without making JapanFold call if gene is monomer", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes(".json")) {
          return {
            ok: true,
            json: async () => ({
              comments: [{ commentType: "SUBUNIT", note: { texts: [{ value: "Monomer." }] } }]
            })
          } as any;
        }
        if (typeof url === "string" && url.includes(".fasta")) {
          return {
            ok: true,
            text: async () => ">P12345\nMSLSK"
          } as any;
        }
        return { ok: false } as any;
      });

      const res = await analyzeMultimerStructure("TEST", "p.Leu3Pro", "P12345");
      expect(res.status).toBe("monomeric");
      expect(res.chainCount).toBe(1);
      expect(res.complexPdb).toBeNull();
    });

    it("rejects heteromultimer sequence cloning and reports partner requirement", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes(".json")) {
          return {
            ok: true,
            json: async () => ({
              comments: [{ commentType: "SUBUNIT", note: { texts: [{ value: "Heterodimer with UBA3." }] } }]
            })
          } as any;
        }
        if (typeof url === "string" && url.includes(".fasta")) {
          return {
            ok: true,
            text: async () => ">Q13564\nMSLSK"
          } as any;
        }
        return { ok: false } as any;
      });

      const res = await analyzeMultimerStructure("NAE1", "p.Arg100Trp", "Q13564");
      expect(res.status).toBe("failed");
      expect(res.error).toContain("Heteromeric complex modeling requires partner subunit");
    });
  });
});
