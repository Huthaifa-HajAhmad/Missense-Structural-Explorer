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

    /**
     * The build trail must survive translation, or nothing downstream can state it.
     *
     * `assembly` is what the reader submitted; `resolvedAssembly` is what the annotation ran against;
     * `liftedGenomicCoordinates` is the verified canonical locus; `coordinateLift` is the decision
     * that connects them. Dropping any of them here is how a GRCh37 coordinate would reach the
     * predictors labelled — or paired — with the wrong build.
     *
     * The locus is the REAL `Chr1(GRCh37):g.1256452C>A` → `Chr1(GRCh38):g.1321072C>A` lift. The
     * fixture used to lift an INDEL (`7-117199644-ATCT-A` → `7-117548628-ATCT-A`), which the server
     * can never emit — `liftover.ts` refuses anything but a single-base substitution.
     */
    it("carries the resolved build, the verified canonical locus and the lift record", async () => {
      const coordinateLift = {
        status: "lifted" as const,
        fromAssembly: "GRCh37" as const,
        toAssembly: "GRCh38" as const,
        fromCoordinates: "1-1256452-C-A",
        toCoordinates: "1-1321072-C-A",
        reverseVerified: true
      };
      const mockApiClient = {
        translateVariant: vi.fn().mockResolvedValue({
          gene: "CFTR",
          variant: "p.Phe508del",
          uniprotId: "P13569",
          assembly: "GRCh37",
          genomicCoordinates: "1-1256452-C-A",
          resolvedAssembly: "GRCh38",
          liftedGenomicCoordinates: "1-1321072-C-A",
          coordinateLift
        })
      };

      const result = await translateVariantNotation(
        "Chr1(GRCh37):g.1256452C>A",
        mockApiClient,
        new AbortController().signal
      );

      expect(result.transcriptMeta.assembly).toBe("GRCh37");
      expect(result.transcriptMeta.resolvedAssembly).toBe("GRCh38");
      expect(result.transcriptMeta.liftedGenomicCoordinates).toBe("1-1321072-C-A");
      expect(result.transcriptMeta.coordinateLift).toEqual(coordinateLift);
    });

    it("reports the canonical-pair fields as null when the route did not lift", async () => {
      const mockApiClient = {
        translateVariant: vi.fn().mockResolvedValue({
          gene: "PAH",
          variant: "p.Arg408Trp",
          uniprotId: "P00439",
          assembly: "GRCh38"
        })
      };

      const result = await translateVariantNotation(
        "p.Arg408Trp",
        mockApiClient,
        new AbortController().signal
      );

      // Null rather than absent: "no lift was recorded" must be stated, not left to inference from a
      // missing key (which is indistinguishable from a payload cached before the field existed).
      expect(result.transcriptMeta.liftedGenomicCoordinates).toBeNull();
      expect(result.transcriptMeta.coordinateLift).toBeNull();
      expect(result.transcriptMeta.resolvedAssembly).toBeUndefined();
    });
  });
});
