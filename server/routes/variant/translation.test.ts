import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../../routes.ts";
import { clearAllCaches } from "../../services/infra/cache.ts";

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

const MISSENSE_CONSEQUENCE = {
  transcript_id: "ENST00000374343",
  canonical: 1,
  hgvsp: "ENSP00000363463.4:p.Glu433Lys",
  gene_symbol: "MACO1",
  swissprot: ["Q8N5G0.1"]
};

/** Builds a VEP HGVS payload carrying the supplied transcript consequence. */
const vepPayload = (consequence: Record<string, any>) => ({
  ok: true,
  json: async () => [
    {
      seq_region_name: "1",
      start: 25484258,
      allele_string: "G/A",
      assembly_name: "GRCh38",
      transcript_consequences: [consequence]
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
  consequence: Record<string, any> = MISSENSE_CONSEQUENCE,
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
