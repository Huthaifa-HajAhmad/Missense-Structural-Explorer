import { describe, it, expect } from "vitest";
import {
  extractPayload,
  extractProteinChange,
  isUsablePayload,
  mapVariantValidatorResponse,
} from "./variant-validator.ts";

/** Captured live from VariantValidator for NC_000001.11:g.25484258G>A (MACO1). */
const MACO1_RESPONSE = {
  "NM_018202.6:c.1297G>A": {
    flag: "MANE_Select",
    gene_symbol: "MACO1",
    hgvs_transcript_variant: "NM_018202.6:c.1297G>A",
    hgvs_predicted_protein_consequence: {
      lrg_slr: "",
      lrg_tlr: "",
      slr: "NP_060672.2:p.(E433K)",
      tlr: "NP_060672.2:p.(Glu433Lys)",
    },
    annotations: {
      chromosome: "1",
      mane_select: true,
      mane_plus_clinical: false,
      ensembl_select: false,
      db_xref: { CCDS: "CCDS30638.1", hgnc: "HGNC:25572", ncbigene: "55219", select: "MANE" },
    },
    primary_assembly_loci: {
      grch37: {
        hgvs_genomic_description: "NC_000001.10:g.25810749G>A",
        vcf: { alt: "A", chr: "1", pos: "25810749", ref: "G" },
      },
      grch38: {
        hgvs_genomic_description: "NC_000001.11:g.25484258G>A",
        vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" },
      },
    },
  },
  flag: "MANE_Select",
};

/**
 * The silent-failure shape returned for unsupported `select_transcripts` values such as
 * `/ensembl` or `/MANE`. It is HTTP 200 with no error, so a naive mapper would report it as
 * a legitimate "no consequence" answer — a false negative in a clinical tool.
 */
const INTERGENIC_RESPONSE = {
  flag: "intergenic",
  intergenic_variant_1: {
    alt_genomic_loci: [],
    annotations: {},
    gene_ids: {},
    gene_symbol: "",
    hgvs_transcript_variant: "",
    hgvs_predicted_protein_consequence: {},
    primary_assembly_loci: {},
  },
};

describe("VariantValidator response mapping", () => {
  describe("extractPayload", () => {
    it("discovers the dynamically-keyed transcript payload", () => {
      const extracted = extractPayload(MACO1_RESPONSE);
      expect(extracted?.payloadKey).toBe("NM_018202.6:c.1297G>A");
      expect(extracted?.payload.gene_symbol).toBe("MACO1");
    });

    it("returns null for the intergenic silent-failure envelope", () => {
      expect(extractPayload(INTERGENIC_RESPONSE)).toBeNull();
    });

    it("returns null for non-object bodies", () => {
      expect(extractPayload(null)).toBeNull();
      expect(extractPayload(undefined)).toBeNull();
      expect(extractPayload("nope")).toBeNull();
      expect(extractPayload([1, 2, 3])).toBeNull();
      expect(extractPayload({})).toBeNull();
    });
  });

  describe("extractProteinChange", () => {
    it("strips the protein accession prefix and keeps the parentheses form", () => {
      // validateVariant downstream strips parentheses, so passing them through is correct.
      expect(extractProteinChange({ tlr: "NP_060672.2:p.(Glu433Lys)" })).toBe("p.(Glu433Lys)");
    });

    it("prefers the three-letter form and falls back to the single-letter form", () => {
      expect(extractProteinChange({ tlr: "NP_1:p.(Glu433Lys)", slr: "NP_1:p.(E433K)" })).toBe("p.(Glu433Lys)");
      expect(extractProteinChange({ slr: "NP_1:p.(E433K)" })).toBe("p.(E433K)");
    });

    it("handles values without an accession prefix", () => {
      expect(extractProteinChange({ tlr: "p.Glu433Lys" })).toBe("p.Glu433Lys");
    });

    it("returns undefined when there is no protein consequence", () => {
      expect(extractProteinChange({})).toBeUndefined();
      expect(extractProteinChange(undefined)).toBeUndefined();
    });
  });

  describe("isUsablePayload", () => {
    it("rejects the silent-failure flag", () => {
      expect(
        isUsablePayload({
          flag: "intergenic",
          gene_symbol: "SHOULD_NOT_MATTER",
          hgvs_predicted_protein_consequence: { tlr: "NP_1:p.(Glu1Lys)" },
        } as any)
      ).toBe(false);
    });

    it("rejects payloads without a gene symbol or a protein consequence", () => {
      expect(isUsablePayload({ gene_symbol: "", hgvs_predicted_protein_consequence: { tlr: "x" } } as any)).toBe(false);
      expect(isUsablePayload({ gene_symbol: "MACO1", hgvs_predicted_protein_consequence: {} } as any)).toBe(false);
      expect(isUsablePayload(undefined)).toBe(false);
    });

    it("accepts a genuine MANE resolution", () => {
      expect(isUsablePayload(extractPayload(MACO1_RESPONSE)!.payload)).toBe(true);
    });
  });

  describe("mapVariantValidatorResponse", () => {
    it("maps a genuine resolution onto the provider-neutral consequence shape", () => {
      const mapped = mapVariantValidatorResponse(MACO1_RESPONSE, "GRCh38");

      expect(mapped).not.toBeNull();
      expect(mapped!.provider).toBe("variant-validator");
      expect(mapped!.seq_region_name).toBe("1");
      expect(mapped!.start).toBe(25484258);
      expect(mapped!.allele_string).toBe("G/A");
      expect(mapped!.transcript_consequences).toHaveLength(1);

      const tc = mapped!.transcript_consequences[0];
      expect(tc.gene_symbol).toBe("MACO1");
      expect(tc.hgvsp).toBe("p.(Glu433Lys)");
      expect(tc.mane_select).toBe(true);
      expect(tc.transcript_id).toBe("NM_018202.6");
    });

    it("selects the locus matching the requested assembly", () => {
      expect(mapVariantValidatorResponse(MACO1_RESPONSE, "GRCh37")!.start).toBe(25810749);
      expect(mapVariantValidatorResponse(MACO1_RESPONSE, "GRCh38")!.start).toBe(25484258);
    });

    it("never fabricates a result from the intergenic silent-failure envelope", () => {
      expect(mapVariantValidatorResponse(INTERGENIC_RESPONSE, "GRCh38")).toBeNull();
    });

    it("does not claim MANE when the provider did not report it", () => {
      const response = {
        "NM_000001.1:c.1A>G": {
          gene_symbol: "TEST",
          hgvs_predicted_protein_consequence: { tlr: "NP_1:p.(Glu1Lys)" },
          annotations: { chromosome: "1", mane_select: false, ensembl_select: true },
        },
      };
      const mapped = mapVariantValidatorResponse(response, "GRCh38")!;
      expect(mapped.transcript_consequences[0].mane_select).toBeUndefined();
      expect(mapped.transcript_consequences[0].canonical).toBe(1);
    });
  });
});