import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../../routes.ts";
import { clearAllCaches } from "../../services/infra/cache.ts";
import { ACOT9_CANONICAL, ACOT9_ISOFORM_4 } from "../../services/translation/__fixtures__/acot9.ts";
import { translateVariantResponseSchema } from "../../../src/shared/contracts.ts";

/**
 * Route-level tests for POST /api/v1/translate-variant.
 *
 * Regression context: assembly-annotated genomic HGVS ("Chr1(GRCh38):g.25484258G>A") is
 * accepted by Ensembl VEP, but the local notation gate rejected it with a 400. These tests
 * pin the normalization step and the genome-build -> Ensembl host routing.
 */

const getTranslateHandler = () => {
  const route: any = apiRouter.stack.find(
    (layer: any) => layer.route && layer.route.path === "/translate-variant"
  );
  if (!route) throw new Error("translate-variant route is not registered");
  return route.route.stack[route.route.stack.length - 1].handle;
};

/**
 * Canonically-numbered missense consequence.
 *
 * `uniprot_isoform` is what makes the numbering provable, and therefore what makes an answer
 * cacheable and free of numbering warnings: without it the route now (correctly) reports an
 * `unverified` numbering basis.
 */
const MISSENSE_CONSEQUENCE = {
  transcript_id: "ENST00000374343",
  canonical: 1,
  hgvsp: "ENSP00000363463.4:p.Glu433Lys",
  amino_acids: "E/K",
  uniprot_isoform: ["Q8N5G0-1"],
  gene_symbol: "MACO1",
  swissprot: ["Q8N5G0.1"]
};

/**
 * Builds a VEP HGVS payload carrying the supplied transcript consequence(s).
 *
 * Accepts an array so a test can reproduce a real multi-transcript VEP answer — which is what
 * makes isoform reconciliation possible (the canonically-numbered sibling is reported alongside
 * the MANE Select consequence).
 */
const vepPayload = (consequence: Record<string, any> | Record<string, any>[]) => ({
  ok: true,
  json: async () => [
    {
      seq_region_name: "1",
      start: 25484258,
      allele_string: "G/A",
      assembly_name: "GRCh38",
      transcript_consequences: Array.isArray(consequence) ? consequence : [consequence]
    }
  ]
});

/**
 * Drives the translate-variant handler.
 *
 * `fetchImpl` defaults to a single successful Ensembl VEP answer. Tests that need
 * provider-specific behaviour (fallback, outage) pass their own implementation —
 * previously this helper ALWAYS queued a mockResolvedValueOnce, which silently
 * shadowed any implementation a test installed afterwards and made those tests
 * observe a VEP success instead of the failure they were setting up.
 *
 * The request notation is always `variant`. Assertions that differ only by mocked
 * payload stay coherent with `vepPayload()`'s fixed coordinates, and cross-test
 * bleed is handled by the per-describe `clearAllCaches()` in `beforeEach`.
 */
async function invokeTranslate(
  variant: string,
  consequence: Record<string, any> | Record<string, any>[] = MISSENSE_CONSEQUENCE,
  fetchImpl?: (url: string) => any
) {
  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
    async (url: any) => (fetchImpl ? fetchImpl(String(url)) : vepPayload(consequence)) as any
  );
  const handler = getTranslateHandler();

  let statusCode = 200;
  let body: any = null;
  const req: any = { body: { variant }, headers: {} };
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(payload: any) { body = payload; return this; }
  };

  await handler(req, res, () => {});

  const rawUrl = fetchSpy.mock.calls[0]?.[0];
  const calledUrl = rawUrl ? decodeURIComponent(String(rawUrl)) : "";
  fetchSpy.mockRestore();

  return { statusCode, body, calledUrl };
}

/**
 * Drives the handler with a caller-supplied fetch spy so a test can assert the
 * spy was NOT called (cache-hit path). Unlike {@link invokeTranslate} this does
 * not install or restore a spy of its own — the caller owns its lifecycle.
 */
async function invokeTranslateWithSpy(variant: string) {
  const handler = getTranslateHandler();

  let statusCode = 200;
  let body: any = null;
  const req: any = { body: { variant }, headers: {} };
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(payload: any) { body = payload; return this; }
  };

  await handler(req, res, () => {});

  return { statusCode, body };
}

describe("POST /translate-variant — notation normalization & assembly routing", () => {
  // Resolutions are cached (L1 + persistent L2), and several tests below reuse the same
  // notation with different mocked VEP payloads. Flush both tiers so each test exercises a
  // real provider call. Matches the convention in predictors.test.ts.
  beforeEach(() => {
    clearAllCaches(true);
  });

  it("accepts the assembly-annotated form and strips the annotation before querying VEP", async () => {
    const { statusCode, body, calledUrl } = await invokeTranslate("Chr1(GRCh38):g.25484258G>A");

    expect(statusCode).toBe(200);
    expect(calledUrl).toContain("/vep/human/hgvs/chr1:g.25484258G>A");
    expect(calledUrl).not.toContain("GRCh38");
    expect(body.notationNormalized).toBe("chr1:g.25484258G>A");
    expect(body.assembly).toBe("GRCh38");
    expect(body.gene).toBe("MACO1");
    expect(body.variant).toBe("p.Glu433Lys");
    expect(body.assemblyNote).toContain("GRCh38");

    // Provenance must identify the provider that actually answered.
    expect(body.provenance.provider).toBe("ensembl-vep");
    expect(body.provenance.providerLabel).toContain("Ensembl VEP");
    expect(body.provenance.usedFallback).toBe(false);
    expect(body.provenance.cacheHit).toBe(false);
    expect(body.provenance.attempts).toHaveLength(1);
    expect(body.provenance.attempts[0].ok).toBe(true);
  });

  it("serves a repeated query from cache with provenance marked as a cache hit", async () => {
    const first = await invokeTranslate("chr1:g.25484258G>A");
    expect(first.statusCode).toBe(200);

    // Note: the cache is flushed per-test, so this exercises the L1 path within one test.
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(vepPayload(MISSENSE_CONSEQUENCE) as any);
    const second = await invokeTranslateWithSpy("chr1:g.25484258G>A");
    fetchSpy.mockRestore();

    expect(second.statusCode).toBe(200);
    expect(second.body.provenance.cacheHit).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to VariantValidator when Ensembl VEP cannot serve the request", async () => {
    // Ensembl rejects with 400 (not retried) and VariantValidator answers, so the clinician
    // still gets a protein change during a VEP outage.
    const fetchImpl = async (url: string) =>
      url.includes("rest.ensembl.org")
        ? ({
            ok: false,
            status: 400,
            json: async () => ({ error: "reference allele mismatch" }),
            text: async () => "reference allele mismatch",
          } as any)
        : ({
            ok: true,
            status: 200,
            json: async () => ({
              "NM_018202.6:c.1297G>A": {
                gene_symbol: "MACO1",
                hgvs_predicted_protein_consequence: { tlr: "NP_060672.2:p.(Glu433Lys)" },
                annotations: { chromosome: "1", mane_select: true, ensembl_select: false },
                primary_assembly_loci: {
                  grch38: { vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" } },
                },
              },
            }),
            text: async () => "",
          } as any);

    const { statusCode, body } = await invokeTranslate("chr1:g.25484258G>A", MISSENSE_CONSEQUENCE, fetchImpl);

    expect(statusCode).toBe(200);
    expect(body.gene).toBe("MACO1");
    expect(body.variant).toBe("p.Glu433Lys");
    // VariantValidator reports no UniProt, so it stays empty and the client resolves it.
    expect(body.uniprotId).toBe("");
    expect(body.provenance.provider).toBe("variant-validator");
    expect(body.provenance.usedFallback).toBe(true);
    expect(body.provenance.attempts.map((a: any) => a.provider)).toEqual([
      "ensembl-vep",
      "variant-validator",
    ]);
  });

  it("reports a total provider outage as 503 TRANSLATION_UNAVAILABLE, not a 500", async () => {
    // Retry-After: 0 makes fetchWithRetry's backoff instant, so an all-5xx outage is
    // simulated deterministically without waiting out real retry delays.
    const overloaded = () => ({
      ok: false,
      status: 503,
      headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
      json: async () => ({ error: "service unavailable" }),
      text: async () => "service unavailable",
    });

    const { statusCode, body } = await invokeTranslate(
      "chr1:g.25484258G>A",
      MISSENSE_CONSEQUENCE,
      overloaded
    );

    // An upstream outage is not an internal server error, and the message must be actionable.
    expect(statusCode).toBe(503);
    expect(body.error.code).toBe("TRANSLATION_UNAVAILABLE");
    expect(body.error.message).toContain("protein-level substitution");
  });

  it("routes a (GRCh37) annotation to the GRCh37 Ensembl host", async () => {
    const { statusCode, calledUrl, body } = await invokeTranslate("chr1(GRCh37):g.25484258G>A");

    expect(statusCode).toBe(200);
    expect(calledUrl.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(body.assembly).toBe("GRCh37");
  });

  it("treats the hg19 alias as GRCh37 (hg19 does not contain '37')", async () => {
    const { calledUrl, body } = await invokeTranslate("chr1(hg19):g.25484258G>A");

    expect(calledUrl.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(body.assembly).toBe("GRCh37");
  });

  it("treats the hg38 alias as GRCh38 and keeps the default host", async () => {
    const { calledUrl, body } = await invokeTranslate("chr1(hg38):g.25484258G>A");

    expect(calledUrl.startsWith("https://rest.ensembl.org")).toBe(true);
    expect(calledUrl).not.toContain("grch37");
    expect(body.assembly).toBe("GRCh38");
  });

  it("defaults to GRCh38 and omits the assembly note for unannotated notations", async () => {
    const { calledUrl, body } = await invokeTranslate("chr1:g.25484258G>A");

    expect(calledUrl.startsWith("https://rest.ensembl.org")).toBe(true);
    expect(body.assembly).toBe("GRCh38");
    expect(body.assemblyNote).toBeUndefined();
  });

  it("preserves the pre-existing dashed-coordinate normalization path", async () => {
    const { statusCode, calledUrl } = await invokeTranslate("20-23365054-G-A");

    expect(statusCode).toBe(200);
    expect(calledUrl).toContain("/vep/human/hgvs/chr20:g.23365054G>A");
  });

  it("preserves the pre-existing cDNA passthrough path", async () => {
    const { statusCode, calledUrl } = await invokeTranslate("NM_000277.5:c.1222C>T");

    expect(statusCode).toBe(200);
    expect(calledUrl).toContain("/vep/human/hgvs/NM_000277.5:c.1222C>T");
  });

  it("rejects unsupported notations with a message listing the accepted forms", async () => {
    const { statusCode, body, calledUrl } = await invokeTranslate("not-a-variant");

    expect(statusCode).toBe(400);
    expect(calledUrl).toBe("");
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("Chr1(GRCh38):g.25484258G>A");
    expect(body.error.message).toContain("NM_004333.6:c.1799T>A");
    expect(body.error.message).toContain("20-23365054-G-A");
  });

  it("accepts RefSeq chromosome accessions", async () => {
    const { statusCode, calledUrl } = await invokeTranslate("NC_000001.11:g.25484258G>A");

    expect(statusCode).toBe(200);
    expect(calledUrl).toContain("/vep/human/hgvs/NC_000001.11:g.25484258G>A");
  });
});

/**
 * The widened genomic gate must NOT loosen the platform's missense-only invariant. These
 * tests pin both enforcement layers:
 *   1. notations that are not single-nucleotide substitutions are refused before VEP is called
 *   2. notations that VEP resolves to a non-missense protein consequence are refused after
 */
describe("POST /translate-variant — missense-only scope enforcement", () => {
  // Resolutions are cached by notation (L1 + persistent L2). The stop-gain case below is
  // the first in this block to resolve `chr1:g.25484258G>A`, so without this flush every
  // later test reusing that notation was answered from its cached consequence instead of
  // its own mocked payload. Missing this hook — not the cache itself — was the root cause
  // of the original cross-test failures.
  beforeEach(() => {
    clearAllCaches(true);
  });

  it.each([
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
    "Chr1(GRCh38):g.25484258delG"
  ])("rejects the non-substitution %s with 422 and never contacts VEP", async (notation) => {
    const { statusCode, body, calledUrl } = await invokeTranslate(notation);

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("single-nucleotide substitution");
    expect(body.error.message).toContain("missense");
    expect(calledUrl).toBe("");
  });

  it("rejects a coordinate that resolves to a stop-gain (nonsense) consequence", async () => {
    const { statusCode, body } = await invokeTranslate("chr1:g.25484258G>A", {
      ...MISSENSE_CONSEQUENCE,
      hgvsp: "ENSP00000363463.4:p.Glu433Ter",
      consequence_terms: ["stop_gained"]
    });

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain(
      "Genomic coordinate translated to non-missense consequence (MACO1 p.Glu433Ter)"
    );
    expect(body.error.message).toContain("Nonsense / stop-gain variant detected");
  });

  it("rejects a coordinate that resolves to a synonymous substitution", async () => {
    const { statusCode, body, calledUrl } = await invokeTranslate("chr1:g.25484258G>A", {
      ...MISSENSE_CONSEQUENCE,
      hgvsp: "ENSP00000363463.4:p.Glu433Glu"
    });

    expect(calledUrl).toContain("chr1:g.25484258G>A");
    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("Synonymous");
  });

  it("rejects a coordinate that resolves to a protein-level indel", async () => {
    const { statusCode, body, calledUrl } = await invokeTranslate("chr1:g.25484258G>A", {
      ...MISSENSE_CONSEQUENCE,
      hgvsp: "ENSP00000363463.4:p.Glu433del"
    });

    expect(calledUrl).toContain("chr1:g.25484258G>A");
    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("Insertion/deletion");
  });

  it("explains a coordinate with no protein-mapping consequence instead of a bare 404", async () => {
    const { statusCode, body, calledUrl } = await invokeTranslate("chr1:g.25484258G>A", {
      transcript_id: "ENST00000374343",
      gene_symbol: "MACO1",
      consequence_terms: ["intron_variant"]
    });

    expect(calledUrl).toContain("chr1:g.25484258G>A");
    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("HGVSp");
    expect(body.error.message).toContain("intron_variant");
    expect(body.error.message).toContain("MACO1");
    expect(body.error.details).toMatchObject({
      gene: "MACO1",
      transcriptId: "ENST00000374343",
      consequence: ["intron_variant"],
      notation: "chr1:g.25484258G>A",
      assembly: "GRCh38"
    });
  });

  /**
   * Regression: the production fatal logged for "chr20:g.54154759C>T" (GRCh38). VEP (and
   * VariantValidator alike) resolve it to CYP24A1 MANE Select as a splice_region +
   * 3_prime_UTR change (c.*13G>A) — a real variant that provably has NO HGVSp, so the
   * pipeline must say so instead of crashing with an unexplained "not found".
   */
  it("names the gene, consequence and HGVSc for a UTR/splice coordinate (CYP24A1 regression)", async () => {
    const { statusCode, body } = await invokeTranslate("chr20:g.54154759C>T", {
      transcript_id: "ENST00000216862",
      mane_select: "NM_000782.5",
      canonical: 1,
      gene_symbol: "CYP24A1",
      consequence_terms: ["splice_region_variant", "3_prime_UTR_variant"],
      hgvsc: "ENST00000216862.8:c.*13G>A",
      swissprot: ["Q07973.209"]
    });

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain('"chr20:g.54154759C>T"');
    expect(body.error.message).toContain("CYP24A1");
    expect(body.error.message).toContain("splice_region_variant + 3_prime_UTR_variant");
    expect(body.error.message).toContain("ENST00000216862.8:c.*13G>A");
    expect(body.error.message).toContain("no protein variant (HGVSp) exists");
    expect(body.error.details).toMatchObject({
      gene: "CYP24A1",
      transcriptId: "ENST00000216862",
      hgvsc: "ENST00000216862.8:c.*13G>A",
      consequence: ["splice_region_variant", "3_prime_UTR_variant"],
      notation: "chr20:g.54154759C>T",
      assembly: "GRCh38"
    });
  });

  it("rejects a VariantValidator no-change protein prediction (p.(=)) as non-missense", async () => {
    // When VEP is down, the fallback answers UTR coordinates with `p.(=)` — a prediction
    // of NO amino-acid change. It must read as "no protein change", not as a parse error.
    const fetchImpl = async (url: string) =>
      url.includes("rest.ensembl.org")
        ? ({
            ok: false,
            status: 503,
            headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
            json: async () => ({ error: "service unavailable" }),
            text: async () => "service unavailable",
          } as any)
        : ({
            ok: true,
            status: 200,
            json: async () => ({
              "NM_000782.5:c.*13G>A": {
                gene_symbol: "CYP24A1",
                hgvs_predicted_protein_consequence: { tlr: "NP_000773.2:p.(=)", slr: "NP_000773.2:p.(=)" },
                annotations: { chromosome: "20", mane_select: true, ensembl_select: false },
                primary_assembly_loci: {
                  grch38: { vcf: { alt: "T", chr: "20", pos: "54154759", ref: "C" } },
                },
              },
            }),
            text: async () => "",
          } as any);

    const { statusCode, body } = await invokeTranslate("chr20:g.54154759C>T", MISSENSE_CONSEQUENCE, fetchImpl);

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("non-missense consequence (CYP24A1 p.(=))");
    expect(body.error.message).toContain("Synonymous / no-change variant detected");
    expect(body.error.message).toContain("no amino-acid change");
  });

  it("answers 422 with verify-guidance when the coordinate resolved but no transcript overlaps it", async () => {
    const emptyOverlap = async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          seq_region_name: "1",
          start: 25484258,
          allele_string: "G/A",
          assembly_name: "GRCh38",
          transcript_consequences: []
        }
      ]
    });

    const { statusCode, body } = await invokeTranslate("chr1:g.25484258G>A", MISSENSE_CONSEQUENCE, emptyOverlap);

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("no transcript consequence overlaps it");
    expect(body.error.message).toContain("Verify the chromosome, position, alleles and genome build");
  });

  it("still translates a genuine missense consequence successfully", async () => {
    const { statusCode, body, calledUrl } = await invokeTranslate("chr1:g.25484258G>A");

    expect(calledUrl).toContain("chr1:g.25484258G>A");
    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Glu433Lys");
    expect(body.uniprotId).toBe("Q8N5G0");
  });
});

/**
 * Isoform-numbering reconciliation.
 *
 * Production fatal (ACOT9, chrX:g.23705858C>A): VEP numbers the MANE Select consequence on
 * UniProt isoform Q9Y305-4 (p.Lys281Asn) while naming the canonical accession Q9Y305
 * (isoform Q9Y305-1, where that residue is K272 and position 281 is L). Forwarding the MANE
 * notation with the canonical accession made FoldX and the biophysics guard reject the
 * variant as a "wild-type residue mismatch" — three fatal console entries from one upstream
 * numbering error, and a silent wrong-residue analysis whenever the letters coincided.
 */
describe("POST /translate-variant — isoform numbering reconciliation", () => {
  beforeEach(() => {
    clearAllCaches(true);
  });

  /** MANE Select consequence as VEP reports it: numbered on isoform Q9Y305-4. */
  const ACOT9_MANE_CONSEQUENCE = {
    transcript_id: "ENST00000379303",
    canonical: 1,
    mane_select: "NM_001037171.2",
    gene_symbol: "ACOT9",
    hgvsp: "ENSP00000368605.5:p.Lys281Asn",
    hgvsc: "ENST00000379303.10:c.843G>T",
    amino_acids: "K/N",
    uniprot_isoform: ["Q9Y305-4"],
    swissprot: ["Q9Y305.179"],
  };

  /** The SAME substitution as VEP reports it on a canonically-numbered transcript. */
  const ACOT9_CANONICAL_CONSEQUENCE = {
    transcript_id: "ENST00000336430",
    canonical: 1,
    gene_symbol: "ACOT9",
    hgvsp: "ENSP00000336580.7:p.Lys272Asn",
    hgvsc: "ENST00000336430.12:c.816G>T",
    amino_acids: "K/N",
    uniprot_isoform: ["Q9Y305-1"],
    swissprot: ["Q9Y305.179"],
  };

  it("remaps the ACOT9 MANE notation onto canonical numbering and discloses the remap", async () => {
    const { statusCode, body } = await invokeTranslate("chrX:g.23705858C>A", [
      ACOT9_MANE_CONSEQUENCE,
      ACOT9_CANONICAL_CONSEQUENCE,
    ]);

    expect(statusCode).toBe(200);
    expect(body.gene).toBe("ACOT9");
    // Canonical numbering — the only sequence with a modellable structure.
    expect(body.variant).toBe("p.Lys272Asn");
    expect(body.uniprotId).toBe("Q9Y305");
    expect(body.uniprotIsoform).toBe("Q9Y305-1");
    expect(body.transcriptId).toBe("ENST00000336430");
    // The MANE notation the clinician would recognise is preserved in the remap record.
    expect(body.numberingRemap).toMatchObject({
      from: {
        hgvsp: "ENSP00000368605.5:p.Lys281Asn",
        transcriptId: "ENST00000379303",
        isoform: "Q9Y305-4",
        maneRefSeqId: "NM_001037171.2",
      },
      to: {
        hgvsp: "ENSP00000336580.7:p.Lys272Asn",
        transcriptId: "ENST00000336430",
        isoform: "Q9Y305-1",
      },
    });
    // Silent renumbering would be worse than the crash: the note must reach the UI.
    expect(body.transcriptWarning).toContain("p.Lys281Asn");
    expect(body.transcriptWarning).toContain("p.Lys272Asn");
    expect(body.transcriptWarning).toContain("canonical numbering");
  });

  it("leaves a canonically-numbered consequence untouched (no remap, no note)", async () => {
    const { statusCode, body } = await invokeTranslate("chrX:g.23705858C>A", [
      ACOT9_CANONICAL_CONSEQUENCE,
    ]);

    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Lys272Asn");
    expect(body.uniprotIsoform).toBe("Q9Y305-1");
    expect(body.numberingRemap).toBeUndefined();
  });

  it("refuses with 422 ISOFORM_NUMBERING_MISMATCH when no canonical-numbered sibling exists", async () => {
    const { statusCode, body, calledUrl } = await invokeTranslate("chrX:g.23705858C>A", [
      ACOT9_MANE_CONSEQUENCE,
    ]);

    expect(calledUrl).toContain("chrX:g.23705858C>A");
    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("ISOFORM_NUMBERING_MISMATCH");
    expect(body.error.message).toContain("p.Lys281Asn");
    expect(body.error.message).toContain("Q9Y305-4");
    expect(body.error.message).toContain("Q9Y305");
    expect(body.error.details).toMatchObject({
      gene: "ACOT9",
      hgvsp: "ENSP00000368605.5:p.Lys281Asn",
      isoform: "Q9Y305-4",
      uniprotId: "Q9Y305",
      notation: "chrX:g.23705858C>A",
      assembly: "GRCh38",
    });
  });

  it("never remaps onto a sibling reporting a different substitution", async () => {
    const { statusCode, body } = await invokeTranslate("chrX:g.23705858C>A", [
      ACOT9_MANE_CONSEQUENCE,
      { ...ACOT9_CANONICAL_CONSEQUENCE, hgvsp: "ENSP00000336580.7:p.Lys272Glu", amino_acids: "K/E" },
    ]);

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("ISOFORM_NUMBERING_MISMATCH");
  });

  it("inherits gene-level metadata when the remap target's record is sparse", async () => {
    // A canonically-numbered sibling that carries only the substitution must not lose the
    // UniProt accession (which the client resolves the sequence/structure against) or fail on
    // the missing gene symbol.
    const { statusCode, body } = await invokeTranslate("chrX:g.23705858C>A", [
      ACOT9_MANE_CONSEQUENCE,
      {
        transcript_id: "ENST00000336430",
        canonical: 1,
        hgvsp: "ENSP00000336580.7:p.Lys272Asn",
        uniprot_isoform: ["Q9Y305-1"],
      },
    ]);

    expect(statusCode).toBe(200);
    expect(body.gene).toBe("ACOT9");
    expect(body.variant).toBe("p.Lys272Asn");
    expect(body.uniprotId).toBe("Q9Y305");
    expect(body.numberingRemap).toBeDefined();
  });

  /**
   * A review showed the first version treated "no isoform metadata" as "canonical": the MANE
   * numbering was returned unchanged, with no warning, and then cached. Every VariantValidator
   * answer and every unannotated VEP consequence took that path, which is exactly how the ACOT9
   * mis-numbering survived the fix. It must now be disclosed instead.
   */
  it("discloses an UNVERIFIABLE numbering basis instead of assuming canonical", async () => {
    const { statusCode, body } = await invokeTranslate("chr1:g.25484258G>A", {
      ...MISSENSE_CONSEQUENCE,
      uniprot_isoform: undefined,
    });

    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Glu433Lys");
    expect(body.numberingBasis).toBe("unverified");
    expect(body.numberingVerified).toBe(false);
    expect(body.numberingUnverifiedReason).toContain("which UniProt isoform");
    expect(body.transcriptWarning).toContain("could not be verified");
    expect(body.numberingRemap).toBeUndefined();
  });

  it("discloses an unverified basis when the provider reports no accession at all", async () => {
    // VariantValidator's shape: an HGVSp and no UniProt metadata whatsoever.
    const fetchImpl = async (url: string) =>
      url.includes("rest.ensembl.org")
        ? {
            ok: false,
            status: 503,
            headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
            json: async () => ({ error: "service unavailable" }),
            text: async () => "service unavailable",
          }
        : {
            ok: true,
            status: 200,
            json: async () => ({
              "NM_018202.6:c.1297G>A": {
                gene_symbol: "MACO1",
                hgvs_predicted_protein_consequence: { tlr: "NP_060672.2:p.(Glu433Lys)" },
                annotations: { chromosome: "1", mane_select: true, ensembl_select: false },
                primary_assembly_loci: {
                  grch38: { vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" } },
                },
              },
            }),
            text: async () => "",
          };

    const { statusCode, body } = await invokeTranslate(
      "chr1:g.25484258G>A",
      MISSENSE_CONSEQUENCE,
      fetchImpl as any
    );

    expect(statusCode).toBe(200);
    expect(body.gene).toBe("MACO1");
    expect(body.numberingBasis).toBe("unverified");
    expect(body.numberingVerified).toBe(false);
    expect(body.transcriptWarning).toContain("did not report a UniProt accession");
    expect(body.provenance.usedFallback).toBe(true);
  });

  /**
   * Regression: a provider that maps the coordinate only to non-coding consequences used to
   * end the ladder, so a 422 asserted "no protein variant exists" without the fallback — whose
   * annotation release may number the coordinate — ever being asked.
   */
  it("asks the fallback when the primary reports no protein change", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("rest.ensembl.org")
        ? {
            ok: true,
            status: 200,
            json: async () => [
              {
                seq_region_name: "1",
                start: 25484258,
                allele_string: "G/A",
                transcript_consequences: [
                  {
                    transcript_id: "ENST00000374343",
                    canonical: 1,
                    gene_symbol: "MACO1",
                    consequence_terms: ["intron_variant"],
                    hgvsc: "ENST00000374343.5:c.1297+5G>A",
                  },
                ],
              },
            ],
            text: async () => "",
          }
        : {
            ok: true,
            status: 200,
            json: async () => ({
              "NM_018202.6:c.1297G>A": {
                gene_symbol: "MACO1",
                hgvs_predicted_protein_consequence: { tlr: "NP_060672.2:p.(Glu433Lys)" },
                annotations: { chromosome: "1", mane_select: true, ensembl_select: false },
                primary_assembly_loci: {
                  grch38: { vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" } },
                },
              },
            }),
            text: async () => "",
          };

    const { statusCode, body } = await invokeTranslate(
      "chr1:g.25484258G>A",
      MISSENSE_CONSEQUENCE,
      fetchImpl as any
    );

    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Glu433Lys");
    expect(body.provenance.usedFallback).toBe(true);
    expect(body.provenance.attempts[0].reason).toBe("no protein-altering consequence reported");
  });

  it("classifies an unknown protein effect (p.?) as non-missense rather than malformed", async () => {
    const { statusCode, body } = await invokeTranslate("chr1:g.25484258G>A", {
      ...MISSENSE_CONSEQUENCE,
      hgvsp: "ENSP00000363463.4:p.?",
    });

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("Protein effect unknown");
  });

  it("classifies a start-loss (p.Met1?) as non-missense rather than malformed", async () => {
    const { statusCode, body } = await invokeTranslate("chr1:g.25484258G>A", {
      ...MISSENSE_CONSEQUENCE,
      hgvsp: "ENSP00000363463.4:p.Met1?",
    });

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(body.error.message).toContain("Start-loss");
  });
});

/**
 * Accession-qualified protein notation — how a lab reports a variant.
 *
 * Regression context: the lab pipeline's `NP_001032248.1:p.Lys281Asn` (ACOT9) was rejected as an
 * unrecognised format, and the bare `p.Lys281Asn` failed a wild-type check against canonical
 * `Q9Y305` (canonical 281 is L; the same residue is K272). UniProt's RefSeq cross-references name
 * the isoform, so the notation can be mapped onto canonical numbering exactly.
 */
describe("POST /translate-variant — accession-qualified protein notation", () => {
  beforeEach(() => {
    clearAllCaches(true);
  });

  const ISOFORM_FASTA =
    `>sp|Q9Y305|ACOT9_HUMAN Acyl-coenzyme A thioesterase 9\n${ACOT9_CANONICAL}\n` +
    `>sp|Q9Y305-4|ACOT9_HUMAN Isoform 4\n${ACOT9_ISOFORM_4}\n`;

  const REFSEQ_SEARCH = {
    results: [
      {
        primaryAccession: "Q9Y305",
        uniProtKBCrossReferences: [
          {
            database: "RefSeq",
            id: "NP_001032248.1",
            properties: [{ key: "NucleotideSequenceId", value: "NM_001037171.2" }],
            isoformId: "Q9Y305-4",
          },
        ],
        genes: [{ geneName: { value: "ACOT9" } }],
      },
    ],
  };

  const uniprotFetch = (searchBody: unknown = REFSEQ_SEARCH) => async (url: string) => {
    if (url.includes("/uniprotkb/search")) {
      return { ok: true, status: 200, json: async () => searchBody, text: async () => "" } as any;
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => ISOFORM_FASTA } as any;
  };

  it("accepts the lab's NP_-qualified notation and converts it to canonical numbering", async () => {
    const { statusCode, body } = await invokeTranslate(
      "NP_001032248.1:p.Lys281Asn",
      MISSENSE_CONSEQUENCE,
      uniprotFetch() as any
    );

    expect(statusCode).toBe(200);
    expect(body.gene).toBe("ACOT9");
    // The canonical-equivalent notation, which is what the structures are numbered on.
    expect(body.variant).toBe("p.Lys272Asn");
    expect(body.uniprotId).toBe("Q9Y305");
    // `uniprotIsoform` means "the isoform the RETURNED variant is numbered on" and the returned
    // variant is canonical, so it is absent here; the INPUT basis belongs in the remap record.
    expect(body.uniprotIsoform).toBeUndefined();
    expect(body.numberingBasis).toBe("remapped");
    expect(body.numberingVerified).toBe(true);
    expect(body.numberingProteinId).toBe("NP_001032248.1");
    expect(body.numberingRemap).toMatchObject({
      from: {
        hgvsp: "p.Lys281Asn",
        isoform: "Q9Y305-4",
        accession: "NP_001032248.1",
        transcriptId: "NM_001037171.2",
      },
      to: { hgvsp: "p.Lys272Asn", isoform: "Q9Y305" },
    });
    // The lab's notation must survive into the disclosure.
    expect(body.transcriptWarning).toContain("NP_001032248.1");
    expect(body.transcriptWarning).toContain("p.Lys281Asn");
    expect(body.transcriptWarning).toContain("p.Lys272Asn");

    // …and it must survive the CLIENT CONTRACT too: asserting the raw Express body hid a Zod
    // schema that omitted `from.accession`, silently deleting it on the client.
    const parsed = translateVariantResponseSchema.parse(body);
    expect(parsed.numberingRemap?.from.accession).toBe("NP_001032248.1");
  });

  it("accepts a UniProt isoform accession without a RefSeq lookup", async () => {
    const fetchImpl = uniprotFetch();
    const { statusCode, body } = await invokeTranslate(
      "Q9Y305-4:p.Lys281Asn",
      MISSENSE_CONSEQUENCE,
      fetchImpl as any
    );

    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Lys272Asn");
    expect(body.numberingBasis).toBe("remapped");
    expect(body.transcriptWarning).toContain("Q9Y305-4");
  });

  it("returns canonical numbering unchanged when the accession IS the canonical protein", async () => {
    const { statusCode, body } = await invokeTranslate(
      "Q9Y305:p.Lys272Asn",
      MISSENSE_CONSEQUENCE,
      uniprotFetch() as any
    );

    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Lys272Asn");
    expect(body.numberingBasis).toBe("canonical");
    expect(body.numberingRemap).toBeUndefined();
    expect(body.transcriptWarning).toBeUndefined();
  });

  it("refuses an accession UniProt does not know, naming the reason", async () => {
    const { statusCode, body } = await invokeTranslate(
      "NP_999999.9:p.Lys281Asn",
      MISSENSE_CONSEQUENCE,
      uniprotFetch({ results: [] }) as any
    );

    expect(statusCode).toBe(422);
    // The reason must be accurate about WHAT was searched: reviewed, human entries only.
    expect(body.error.message).toContain("no entry cross-referenced");
    expect(body.error.message).toContain("reviewed, human");
    expect(body.error.details.accession).toBe("NP_999999.9");
  });
});
