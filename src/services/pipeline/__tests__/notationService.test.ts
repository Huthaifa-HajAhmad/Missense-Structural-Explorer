import { describe, it, expect, vi } from "vitest";
import { toFoldxMutation, isGenomicOrCdnaNotation, translateVariantNotation } from "../notationService";

describe("notationService", () => {
  describe("toFoldxMutation", () => {
    it("converts 3-letter amino acid notation to FoldX format", () => {
      expect(toFoldxMutation("p.Arg408Trp")).toBe("RA408W");
      expect(toFoldxMutation("Arg408Trp")).toBe("RA408W");
      expect(toFoldxMutation("p.(Arg408Trp)")).toBe("RA408W");
    });

    it("converts 1-letter amino acid notation to FoldX format", () => {
      expect(toFoldxMutation("R408W")).toBe("RA408W");
      expect(toFoldxMutation("p.R408W")).toBe("RA408W");
    });

    it("preserves already formatted FoldX notation", () => {
      expect(toFoldxMutation("RA408W")).toBe("RA408W");
    });

    it("returns null for invalid strings", () => {
      expect(toFoldxMutation("invalid")).toBeNull();
      expect(toFoldxMutation("p.=")).toBeNull();
    });
  });

  describe("isGenomicOrCdnaNotation", () => {
    it("identifies genomic g. and cDNA c. notations correctly", () => {
      expect(isGenomicOrCdnaNotation("chr12:g.102845234A>G")).toBe(true);
      expect(isGenomicOrCdnaNotation("12:g.102845234A>G")).toBe(true);
      expect(isGenomicOrCdnaNotation("NM_000277.3:c.1222C>T")).toBe(true);
      expect(isGenomicOrCdnaNotation("c.1222C>T")).toBe(true);
      expect(isGenomicOrCdnaNotation("chr7-140753336-A-T")).toBe(true);
      expect(isGenomicOrCdnaNotation("chr7:140753336")).toBe(true);
    });

    it("returns false for standard protein notations", () => {
      expect(isGenomicOrCdnaNotation("p.Arg408Trp")).toBe(false);
      expect(isGenomicOrCdnaNotation("R408W")).toBe(false);
    });
  });

  describe("translateVariantNotation", () => {
    it("translates notation and emits trace context", async () => {
      const mockApiClient = {
        translateVariant: vi.fn().mockResolvedValue({
          gene: "PAH",
          variant: "p.Arg408Trp",
          uniprotId: "P00439",
          transcriptId: "ENST00000335062",
          isManeSelect: true
        })
      };

      const addTraceSpan = vi.fn();
      const signal = new AbortController().signal;

      const result = await translateVariantNotation(
        "NM_000277.3:c.1222C>T",
        mockApiClient,
        signal,
        {
          setAnalysisState: vi.fn(),
          setLoadingStep: vi.fn()
        },
        {
          activeTraceId: "trace-123",
          traceStart: performance.now(),
          addTraceSpan
        }
      );

      expect(result.gene).toBe("PAH");
      expect(result.variant).toBe("p.Arg408Trp");
      expect(result.uniprotId).toBe("P00439");
      expect(result.transcriptMeta.isManeSelect).toBe(true);
      expect(addTraceSpan).toHaveBeenCalled();
    });
  });
});
