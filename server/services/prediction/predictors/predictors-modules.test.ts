import { describe, it, expect, vi } from "vitest";
import { safeParseFloat, safeParseInt, toSingleAa, getFirstOrVal } from "./normalizer.ts";
import { UNIPROT_ACCESSION_REGEX, getTranscriptsForProtein, transcriptMappingCache } from "./transcript-resolver.ts";
import { queryDbnsfpOrg } from "./dbnsfp-query.ts";

describe("Predictors Sub-Resolvers Unit Tests", () => {
  describe("normalizer", () => {
    it("safely parses float values and handles sentinel strings", () => {
      expect(safeParseFloat("0.85")).toBe(0.85);
      expect(safeParseFloat(0.42)).toBe(0.42);
      expect(safeParseFloat(".")).toBeNull();
      expect(safeParseFloat("")).toBeNull();
      expect(safeParseFloat(null)).toBeNull();
      expect(safeParseFloat(undefined)).toBeNull();
      expect(safeParseFloat("invalid")).toBeNull();
    });

    it("safely parses int values", () => {
      expect(safeParseInt("42")).toBe(42);
      expect(safeParseInt(100)).toBe(100);
      expect(safeParseInt(".")).toBeNull();
      expect(safeParseInt(null)).toBeNull();
      expect(safeParseInt("foo")).toBeNull();
    });

    it("converts 3-letter amino acids to 1-letter codes", () => {
      expect(toSingleAa("Ala")).toBe("A");
      expect(toSingleAa("Arg")).toBe("R");
      expect(toSingleAa("val")).toBe("V");
      expect(toSingleAa("W")).toBe("W");
      expect(toSingleAa("")).toBe("");
    });

    it("extracts the first value from arrays or semicolon-delimited strings", () => {
      expect(getFirstOrVal(["first", "second"])).toBe("first");
      expect(getFirstOrVal("0.85;0.92")).toBe("0.85");
      expect(getFirstOrVal(123)).toBe(123);
    });
  });

  describe("UniProt Accession vs Gene Symbol disambiguation", () => {
    it("correctly identifies valid UniProt accessions", () => {
      expect(UNIPROT_ACCESSION_REGEX.test("P00439")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("Q9BYF1")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("O15552")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("A0A024RBG1")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("p04637")).toBe(true); // case-insensitive
    });

    it("rejects 6-10 character standard gene symbols to prevent UniProt 404s", () => {
      // Common human genes with 6-10 characters that must NEVER match UniProt regex
      const geneSymbols = ["CDKN2A", "PIK3CA", "COL1A1", "CYP2D6", "MAPK14", "SMARCA4", "TMPRSS2", "BRCA1", "TP53", "EGFR"];
      for (const gene of geneSymbols) {
        expect(UNIPROT_ACCESSION_REGEX.test(gene)).toBe(false);
      }
    });

    it("routes gene symbols to search endpoint and accessions to uniprotkb endpoint", async () => {
      transcriptMappingCache.clear();
      const origFetch = global.fetch;
      const requestedUrls: string[] = [];

      global.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url);
        requestedUrls.push(urlStr);
        return new Response(JSON.stringify({
          results: [{
            uniProtKBCrossReferences: [
              { database: "MANE-Select", id: "ENST00000304494", properties: [{ key: "RefSeqNucleotideId", value: "NM_000077.5" }] }
            ]
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      try {
        const mapping = await getTranscriptsForProtein("CDKN2A");
        expect(mapping.isManeSelect).toBe(true);
        expect(mapping.ensemblId).toBe("ENST00000304494");
        expect(requestedUrls[0]).toContain("https://rest.uniprot.org/uniprotkb/search?query=gene_exact:CDKN2A+AND+organism_id:9606+AND+reviewed:true");
        expect(requestedUrls[0]).not.toContain("/uniprotkb/CDKN2A.json");
      } finally {
        global.fetch = origFetch;
      }
    });

    it("falls back to unreviewed human UniProt search only when reviewed search returns empty results", async () => {
      transcriptMappingCache.clear();
      const origFetch = global.fetch;
      const requestedUrls: string[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const u = String(url);
        requestedUrls.push(u);
        if (u.includes("reviewed:true")) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({
          results: [{
            primaryAccession: "A0A000",
            uniProtKBCrossReferences: [{ database: "Ensembl", id: "ENST00000999999", isoformId: "A0A000-1", properties: [] }]
          }]
        }), { status: 200 });
      });
      try {
        const mapping = await getTranscriptsForProtein("UNREVGENE");
        expect(requestedUrls).toHaveLength(2);
        expect(requestedUrls[0]).toContain("+AND+reviewed:true");
        expect(requestedUrls[1]).not.toContain("reviewed:true");
        expect(mapping.ensemblId).toBe("ENST00000999999");
      } finally {
        global.fetch = origFetch;
        transcriptMappingCache.clear();
      }
    });

    /**
     * F-2/M-6 (unmapping-defect review): the canonical transcript must be selected by the
     * ISOFORM RULE, not by xref ordering — live UniProt names the canonical isoform
     * `<accession>-1`, and the first ENST xref is not always the canonical isoform's model.
     * The fixture deliberately lists the NON-canonical isoform's transcript first.
     */
    it("selects canonicalEnsemblId by the isoform rule, not by xref ordering", async () => {
      transcriptMappingCache.clear();
      const origFetch = global.fetch;

      global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        results: [{
          primaryAccession: "P00002",
          uniProtKBCrossReferences: [
            { database: "Ensembl", id: "ENST00000111111.1", isoformId: "P00002-2", properties: [] },
            { database: "Ensembl", id: "ENST00000222222.3", isoformId: "P00002-1", properties: [] },
            { database: "MANE-Select", id: "ENST00000111111.1", isoformId: "P00002-2", properties: [{ key: "RefSeqNucleotideId", value: "NM_000001.1" }] }
          ]
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

      try {
        const mapping = await getTranscriptsForProtein("P00002b"); // search branch (non-accession form)
        expect(mapping.ensemblId).toBe("ENST00000111111.1"); // MANE wins ensemblId
        expect(mapping.canonicalEnsemblId).toBe("ENST00000222222.3"); // isoform rule wins geometry model
      } finally {
        global.fetch = origFetch;
        transcriptMappingCache.clear();
      }
    });
  });

  describe("queryDbnsfpOrg", () => {
    it("normalizes 1-letter variants to p.3-letter and preserves rows when only secondary scores exist", async () => {
      const origFetch = global.fetch;
      let capturedBody: any = null;
      global.fetch = vi.fn().mockImplementation(async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          tabs: {
            all_transcripts: { rows: [{ BayesDel_noAF_score: "0.42" }] }
          }
        }), { status: 200 });
      });
      try {
        const res = await queryDbnsfpOrg("BRAF", "V600E");
        expect(capturedBody.variants).toEqual(["BRAF:p.Val600Glu"]);
        expect(res?.bayesdel).toBe(0.42);
      } finally {
        global.fetch = origFetch;
      }
    });

    it("reads the transcript query.dbnsfp.org selected (function_prediction), not the first of all_transcripts", async () => {
      const origFetch = global.fetch;
      // Shape and values from a real response (TP53 R175H, 17-7675088-C-T), with a
      // non-MANE transcript moved to the front of all_transcripts.
      global.fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        tabs: {
          conservative_scores: { rows: [{ "GERP++_RS": 5.409999847412109, phyloP100way_vertebrate: 6.163000106811523 }] },
          function_prediction: { rows: [{
            Ensembl_transcriptid: "ENST00000269305", MANE: "Select",
            REVEL_score: "0.922", MetaRNN_score: "0.9912145", BayesDel_noAF_score: 0.5461900234222412,
            ClinPred_score: 0.9928691983222961, ESM1b_score: "-10.123794", popEVE_score: null,
          }] },
          all_transcripts: { rows: [
            // popEVE here belongs to another transcript: it must not fill the selected row's gap.
            { Ensembl_transcriptid: "ENST00000714356", MANE: null, REVEL_score: null, ESM1b_score: "-10.613666", popEVE_score: "-5.2" },
            { Ensembl_transcriptid: "ENST00000269305", MANE: "Select", REVEL_score: "0.922", ESM1b_score: "-10.123794" },
          ] },
        },
      }), { status: 200 }));
      try {
        const res = await queryDbnsfpOrg("TP53", "R175H", "17-7675088-C-T", "GRCh38");
        expect(res?.revel).toBe(0.922);
        expect(res?.gerp).toBeCloseTo(5.41, 2);
        expect(res?.phylop).toBeCloseTo(6.163, 3);
        expect(res?.bayesdel).toBeCloseTo(0.5462, 4);
        expect(res).not.toHaveProperty("metarnn");
        expect(res).not.toHaveProperty("clinpred");
        expect(res?.esm1b).toBe(-10.123794);
        expect(res?.popeve).toBeNull();
      } finally {
        global.fetch = origFetch;
      }
    });

    it("never reads BayesDel_addAF as BayesDel: the calibrated bands are for the noAF score", async () => {
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        tabs: { function_prediction: { rows: [{ BayesDel_addAF_score: "0.31", REVEL_score: "0.5" }] } }
      }), { status: 200 }));
      try {
        const res = await queryDbnsfpOrg("BRAF", "V600E");
        expect(res?.revel).toBe(0.5);
        expect(res?.bayesdel).toBeNull();
      } finally {
        global.fetch = origFetch;
      }
    });

    it("withholds non-GRCh38 coordinates and falls back to protein query while accepting GRCh38 coordinates", async () => {
      const origFetch = global.fetch;
      const seenBodies: any[] = [];
      global.fetch = vi.fn().mockImplementation(async (_url: any, init: any) => {
        seenBodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({
          tabs: { all_transcripts: { rows: [{ BayesDel_noAF_score: "0.42" }] } }
        }), { status: 200 });
      });
      try {
        await queryDbnsfpOrg("BRAF", "V600E", "7-140453136-A-T", "GRCh37");
        await queryDbnsfpOrg("BRAF", "V600E", "7-140753336-A-T", "GRCh38");
        expect(seenBodies[0].variants).toEqual(["BRAF:p.Val600Glu"]);
        expect(seenBodies[1].variants).toEqual(["7-140753336-A-T"]);
      } finally {
        global.fetch = origFetch;
      }
    });
  });
});
