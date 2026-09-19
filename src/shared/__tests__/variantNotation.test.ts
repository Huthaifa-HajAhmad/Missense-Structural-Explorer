import { describe, it, expect } from "vitest";
import {
  GENOMIC_HGVS_PATTERN,
  DASHED_GENOMIC_PATTERN,
  CDNA_PATTERN,
  HGVS_PATTERN,
  MUTATION_FOLDX_PATTERN,
  classifyNotation,
  isGenomicOrCdnaNotation,
  isProteinNotation,
  needsNotationResolution,
  parseAccessionedProteinNotation,
  detectAssemblyAnnotation,
  normalizeGenomicNotation,
  ACCEPTED_NOTATION_SUMMARY,
  MISSENSE_ONLY_NOTE,
} from "../variantNotation.ts";

describe("Shared variant notation grammar", () => {
  describe("GENOMIC_HGVS_PATTERN (strict acceptance gate)", () => {
    it("accepts the previously supported forms", () => {
      expect(GENOMIC_HGVS_PATTERN.test("chr7:g.140753336A>T")).toBe(true);
      expect(GENOMIC_HGVS_PATTERN.test("7:g.140753336A>T")).toBe(true);
      expect(GENOMIC_HGVS_PATTERN.test("chrX:g.12345C>G")).toBe(true);
      expect(GENOMIC_HGVS_PATTERN.test("chrMT:g.7581T>C")).toBe(true);
    });

    it("accepts inline assembly annotations (the regression this module fixes)", () => {
      expect(GENOMIC_HGVS_PATTERN.test("Chr1(GRCh38):g.25484258G>A")).toBe(true);
      expect(GENOMIC_HGVS_PATTERN.test("chr1(GRCh38):g.25484258G>A")).toBe(true);
      expect(GENOMIC_HGVS_PATTERN.test("chr1(GRCh37):g.25484258G>A")).toBe(true);
      expect(GENOMIC_HGVS_PATTERN.test("1(GRCh38):g.25484258G>A")).toBe(true);
      // hg19/hg38 are the UCSC aliases and use a different numeric suffix than GRCh.
      expect(GENOMIC_HGVS_PATTERN.test("chrX(hg19):g.12345C>G")).toBe(true);
      expect(GENOMIC_HGVS_PATTERN.test("chrX(hg38):g.12345C>G")).toBe(true);
      // Patch releases are accepted.
      expect(GENOMIC_HGVS_PATTERN.test("chr1(GRCh38.p14):g.25484258G>A")).toBe(true);
    });

    it("accepts RefSeq chromosome accessions", () => {
      expect(GENOMIC_HGVS_PATTERN.test("NC_000001.11:g.25484258G>A")).toBe(true);
    });

    it("still rejects malformed genomic notations", () => {
      expect(GENOMIC_HGVS_PATTERN.test("chr7:140753336A>T")).toBe(false);
      expect(GENOMIC_HGVS_PATTERN.test("g.140753336A>T")).toBe(false);
      expect(GENOMIC_HGVS_PATTERN.test("chr7:g.140753336")).toBe(false);
      expect(GENOMIC_HGVS_PATTERN.test("chr7:g.140753336A>")).toBe(false);
      expect(GENOMIC_HGVS_PATTERN.test("chr1(GRCh39):g.25484258G>A")).toBe(false);
      expect(GENOMIC_HGVS_PATTERN.test("chr1(GRCh37.9):g.25484258G>A")).toBe(false);
    });
  });

  describe("cDNA and dashed genomic patterns", () => {
    it("matches valid cDNA notations", () => {
      expect(CDNA_PATTERN.test("NM_004333.6:c.1799T>A")).toBe(true);
      expect(CDNA_PATTERN.test("c.1799T>A")).toBe(true);
      expect(CDNA_PATTERN.test("ENST00000288602.11:c.1799T>A")).toBe(true);
      expect(CDNA_PATTERN.test("NM_004333.6:1799T>A")).toBe(false);
      expect(CDNA_PATTERN.test("c.1799")).toBe(false);
    });

    it("matches dashed genomic coordinates and preserves its capture groups", () => {
      expect(DASHED_GENOMIC_PATTERN.test("20-23365054-G-A")).toBe(true);
      expect(DASHED_GENOMIC_PATTERN.test("chr20-23365054-G-A")).toBe(true);
      expect(DASHED_GENOMIC_PATTERN.test("X-12345-C-G")).toBe(true);
      expect(DASHED_GENOMIC_PATTERN.test("chrY-9876-A-T")).toBe(true);
      expect(DASHED_GENOMIC_PATTERN.test("20-23365054-G")).toBe(false);
      expect(DASHED_GENOMIC_PATTERN.test("20--G-A")).toBe(false);

      const m = "chr20-23365054-G-A".match(DASHED_GENOMIC_PATTERN);
      expect(m?.[1]).toBe("20");
      expect(m?.[2]).toBe("23365054");
      expect(m?.[3]).toBe("G");
      expect(m?.[4]).toBe("A");
    });
  });

  describe("detectAssemblyAnnotation", () => {
    it("maps both annotation families onto canonical build names", () => {
      expect(detectAssemblyAnnotation("Chr1(GRCh38):g.25484258G>A")).toBe("GRCh38");
      expect(detectAssemblyAnnotation("chr1(GRCh37):g.25484258G>A")).toBe("GRCh37");
      expect(detectAssemblyAnnotation("chrX(hg38):g.12345C>G")).toBe("GRCh38");
      // hg19 is GRCh37 — the suffix does not contain "37", which is easy to get wrong.
      expect(detectAssemblyAnnotation("chrX(hg19):g.12345C>G")).toBe("GRCh37");
    });

    it("returns null when no annotation is present", () => {
      expect(detectAssemblyAnnotation("chr1:g.25484258G>A")).toBeNull();
      expect(detectAssemblyAnnotation("20-23365054-G-A")).toBeNull();
      expect(detectAssemblyAnnotation("")).toBeNull();
    });

    it("is case and whitespace tolerant", () => {
      expect(detectAssemblyAnnotation("chr1( grch38 ):g.25484258G>A")).toBe("GRCh38");
      expect(detectAssemblyAnnotation("chr1(HG19):g.25484258G>A")).toBe("GRCh37");
    });
  });

  describe("normalizeGenomicNotation", () => {
    it("strips the annotation and canonicalizes chr casing", () => {
      expect(normalizeGenomicNotation("Chr1(GRCh38):g.25484258G>A")).toBe("chr1:g.25484258G>A");
      expect(normalizeGenomicNotation("chr1(GRCh37):g.25484258G>A")).toBe("chr1:g.25484258G>A");
      expect(normalizeGenomicNotation("chrX(hg19):g.12345C>G")).toBe("chrX:g.12345C>G");
      expect(normalizeGenomicNotation("  CHR7:g.140753336A>T  ")).toBe("chr7:g.140753336A>T");
    });

    it("leaves notations without an annotation intact", () => {
      expect(normalizeGenomicNotation("chr7:g.140753336A>T")).toBe("chr7:g.140753336A>T");
      expect(normalizeGenomicNotation("7:g.140753336A>T")).toBe("7:g.140753336A>T");
      expect(normalizeGenomicNotation("20-23365054-G-A")).toBe("20-23365054-G-A");
      expect(normalizeGenomicNotation("NM_000277.5:c.1222C>T")).toBe("NM_000277.5:c.1222C>T");
    });
  });

  describe("classifyNotation", () => {
    it("classifies dashed genomic coordinates and keeps the input verbatim", () => {
      expect(classifyNotation("20-23365054-G-A")).toEqual({
        kind: "genomic-dashed",
        assembly: null,
        canonical: "20-23365054-G-A",
      });
    });

    it("classifies genomic HGVS and exposes canonical form plus inferred assembly", () => {
      expect(classifyNotation("chr1:g.25484258G>A")).toEqual({
        kind: "genomic-hgvs",
        assembly: null,
        canonical: "chr1:g.25484258G>A",
      });
      expect(classifyNotation("Chr1(GRCh38):g.25484258G>A")).toEqual({
        kind: "genomic-hgvs",
        assembly: "GRCh38",
        canonical: "chr1:g.25484258G>A",
      });
      expect(classifyNotation("NC_000001.11:g.25484258G>A")).toEqual({
        kind: "genomic-hgvs",
        assembly: null,
        canonical: "NC_000001.11:g.25484258G>A",
      });
    });

    it("classifies cDNA notations", () => {
      expect(classifyNotation("NM_004333.6:c.1799T>A")).toEqual({
        kind: "cdna",
        assembly: null,
        canonical: "NM_004333.6:c.1799T>A",
      });
      expect(classifyNotation("c.1799T>A").kind).toBe("cdna");
    });

    it("classifies bare genomic notations", () => {
      expect(classifyNotation("g.140753336A>T").kind).toBe("genomic-bare");
      expect(classifyNotation("chr7:140753336").kind).toBe("genomic-bare");
    });

    it("classifies protein notations", () => {
      expect(classifyNotation("p.Arg408Trp").kind).toBe("protein-hgvs");
      expect(classifyNotation("R408W").kind).toBe("protein-hgvs");
      expect(classifyNotation("Arg408Trp").kind).toBe("protein-hgvs");
      expect(classifyNotation("RA408W").kind).toBe("protein-foldx");
    });

    it("returns 'unknown' for unusable input and never throws", () => {
      for (const bad of ["", "   ", "not a variant", "12345"]) {
        expect(classifyNotation(bad)).toEqual({ kind: "unknown", assembly: null, canonical: null });
      }
      expect(classifyNotation(null as any).kind).toBe("unknown");
      expect(classifyNotation(undefined as any).kind).toBe("unknown");
    });

    /**
     * Accession-qualified protein notation: how a lab reports a variant
     * (`NP_001032248.1:p.Lys281Asn`). The accession names the numbering basis, so it must be
     * recognised, must NOT be taken for a coordinate, and must be resolved before modelling.
     */
    describe("accessioned protein notation", () => {
      const LAB_NOTATION = "NP_001032248.1:p.Lys281Asn";

      it("classifies RefSeq- and UniProt-qualified substitutions", () => {
        expect(classifyNotation(LAB_NOTATION).kind).toBe("protein-accessioned");
        expect(classifyNotation("NP_001032248.1:p.(Lys281Asn)").kind).toBe("protein-accessioned");
        expect(classifyNotation("Q9Y305-4:p.Lys281Asn").kind).toBe("protein-accessioned");
        expect(classifyNotation("Q9Y305:p.Lys272Asn").kind).toBe("protein-accessioned");
      });

      it("is a protein notation, not a coordinate, and is flagged for resolution", () => {
        expect(isProteinNotation(LAB_NOTATION)).toBe(true);
        expect(isGenomicOrCdnaNotation(LAB_NOTATION)).toBe(false);
        expect(needsNotationResolution(LAB_NOTATION)).toBe(true);
        // A bare protein notation is assumed canonical, so it needs no server-side resolution.
        expect(needsNotationResolution("p.Lys281Asn")).toBe(false);
        expect(needsNotationResolution("chr1:g.25484258G>A")).toBe(true);
      });

      it("splits the accession from the substitution, and rejects other families", () => {
        expect(parseAccessionedProteinNotation(LAB_NOTATION)).toEqual({
          accession: "NP_001032248.1",
          proteinNotation: "p.Lys281Asn",
        });
        expect(parseAccessionedProteinNotation("Q9Y305-4:p.Lys281Asn")).toEqual({
          accession: "Q9Y305-4",
          proteinNotation: "p.Lys281Asn",
        });
        expect(parseAccessionedProteinNotation("p.Lys281Asn")).toBeNull();
        expect(parseAccessionedProteinNotation("chr1:g.25484258G>A")).toBeNull();
        expect(parseAccessionedProteinNotation("NP_001032248.1:c.843G>T")).toBeNull();
      });
    });
  });

  describe("isGenomicOrCdnaNotation", () => {
    it("preserves every previously accepted coordinate form", () => {
      for (const form of [
        "chr7:g.140753336A>T", "Chr20:g.23365248G>T", "chrX:g.123456C>G", "chrMT:g.7581T>C",
        "7:g.140753336A>T", "20:g.23365248G>T", "X:g.123456C>G", "20:23365054", "g.140753336A>T",
        "20-23365054-G-A", "chr20-23365054-G-A", "7-140753336-A-T", "X-123456-C-T",
        "NM_004333.6:c.1799T>A", "ENST00000288602.11:c.1799T>A", "c.1799T>A",
        "chr7:140753336",
      ]) {
        expect(isGenomicOrCdnaNotation(form), `expected "${form}" to be genomic/cDNA`).toBe(true);
      }
    });

    it("returns false for protein notations", () => {
      for (const form of ["p.Val600Glu", "Val600Glu", "V600E", "p.Arg215Trp", "R215W", "p.Gly380Arg", "RA408W"]) {
        expect(isGenomicOrCdnaNotation(form), `expected "${form}" to be protein`).toBe(false);
      }
    });

    it("recognizes the assembly-annotated and RefSeq-accession families", () => {
      expect(isGenomicOrCdnaNotation("Chr1(GRCh38):g.25484258G>A")).toBe(true);
      expect(isGenomicOrCdnaNotation("chr1(GRCh37):g.25484258G>A")).toBe(true);
      expect(isGenomicOrCdnaNotation("chrX(hg19):g.12345C>G")).toBe(true);
      expect(isGenomicOrCdnaNotation("NC_000001.11:g.25484258G>A")).toBe(true);
    });

    it("no longer mis-classifies strings that merely begin with 'chr'", () => {
      // The retired `/^chr/i` catch-all routed these to Ensembl VEP.
      expect(isGenomicOrCdnaNotation("CHRD")).toBe(false);
      expect(isGenomicOrCdnaNotation("CHRDL1")).toBe(false);
      expect(isGenomicOrCdnaNotation("chromosome 7")).toBe(false);
    });
  });

  describe("isProteinNotation", () => {
    it("recognizes HGVS and FoldX protein notations", () => {
      expect(isProteinNotation("p.Arg408Trp")).toBe(true);
      expect(isProteinNotation("R408W")).toBe(true);
      expect(isProteinNotation("RA408W")).toBe(true);
      expect(isProteinNotation("Chr1(GRCh38):g.25484258G>A")).toBe(false);
    });
  });

  describe("ACCEPTED_NOTATION_SUMMARY", () => {
    it("advertises every family the server gate accepts, keeping error copy accurate", () => {
      expect(ACCEPTED_NOTATION_SUMMARY).toContain("Chr1(GRCh38):g.25484258G>A");
      expect(ACCEPTED_NOTATION_SUMMARY).toContain("NM_004333.6:c.1799T>A");
      expect(ACCEPTED_NOTATION_SUMMARY).toContain("20-23365054-G-A");
    });
  });

  describe("missense-only scope", () => {
    it("classifies genomic and cDNA indels / no-change notations as 'non-substitution'", () => {
      for (const form of [
        "chr1:g.25484258delG",
        "chr1:g.25484258_25484259del",
        "chr1:g.25484258dupG",
        "chr1:g.25484258_25484259insA",
        "chr1:g.25484258inv",
        "chr1:g.25484258delinsTT",
        "chr1:g.25484258=",
        "NM_000277.5:c.1222delC",
        "NM_000277.5:c.1222_1223del",
        "NM_000277.5:c.1222dup",
        "NM_000277.5:c.1222=",
      ]) {
        expect(classifyNotation(form).kind, `expected "${form}" to be non-substitution`).toBe("non-substitution");
      }
    });

    it("keeps assembly-annotated indels inside the missense-scope check", () => {
      expect(classifyNotation("Chr1(GRCh38):g.25484258delG")).toEqual({
        kind: "non-substitution",
        assembly: "GRCh38",
        canonical: "chr1:g.25484258delG",
      });
    });

    it("never mistakes a single-nucleotide substitution for a non-substitution", () => {
      expect(classifyNotation("chr1:g.25484258G>A").kind).toBe("genomic-hgvs");
      expect(classifyNotation("chr1:g.25484258G>T").kind).toBe("genomic-hgvs");
      expect(classifyNotation("NM_000277.5:c.1222C>T").kind).toBe("cdna");
    });

    it("routes non-substitutions to the translator so the scope error reaches the user", () => {
      expect(isGenomicOrCdnaNotation("chr1:g.25484258delG")).toBe(true);
      expect(isGenomicOrCdnaNotation("NM_000277.5:c.1222delC")).toBe(true);
    });

    it("states the missense-only scope in shared user-facing copy", () => {
      expect(MISSENSE_ONLY_NOTE).toContain("missense");
      expect(MISSENSE_ONLY_NOTE).toContain("FoldX/DynaMut2");
    });
  });
});
