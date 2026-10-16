import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../../routes.ts";
import { clearAllCaches } from "../../services/infra/cache.ts";
import { resetHostStateForTests } from "../../services/infra/http-client.ts";
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
  const headers: Record<string, string> = {};
  const req: any = { body: { variant }, headers: {} };
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(payload: any) { body = payload; return this; },
    // Captured so a test can assert the cooldown header the client's retry policy keys on.
    setHeader(name: string, value: string) { headers[name] = value; return this; },
    getHeader(name: string) { return headers[name]; }
  };

  await handler(req, res, () => {});

  const rawUrl = fetchSpy.mock.calls[0]?.[0];
  const calledUrl = rawUrl ? decodeURIComponent(String(rawUrl)) : "";
  /**
   * EVERY upstream call, in order.
   *
   * The first call is no longer always the annotation query: a submitted GRCh37 coordinate is
   * lifted onto the canonical build first (assembly map + reference base), so a test that means
   * "which host answered the annotation" must filter for the VEP call rather than read call[0].
   */
  const calledUrls = fetchSpy.mock.calls.map((call: any[]) =>
    decodeURIComponent(String(call[0]))
  );
  fetchSpy.mockRestore();

  return { statusCode, body, calledUrl, calledUrls, headers };
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

  it.each(['chr1:g.25484258_25484259delinsAA', 'NM_018202.6:c.1297_1298delinsAA'])('keeps a supported equal-length replacement reachable through the semantic gate (%s)', async (notation) => {
    const result = await invokeTranslate(notation);
    expect(result.statusCode).toBe(200);
    expect(result.calledUrls.some(url => url.includes(notation))).toBe(true);
  });
  it.each(['chr1:g.100_110delinsAA', 'NM_018202.6:c.100_110delinsAA'])('refuses an unsupported span before querying a provider (%s)', async (notation) => {
    const result = await invokeTranslate(notation);
    expect(result.statusCode).toBe(422);
    expect(result.body.error.code).toBe('NON_MISSENSE_VARIANT');
    expect(result.calledUrls).toHaveLength(0);
  });
  it.each(['chr23-100-A-G', 'chr1-0-A-G'])('uses the shared parser to refuse invalid delimited coordinates (%s)', async (notation) => {
    const result = await invokeTranslate(notation);
    expect(result.statusCode).toBe(400);
    expect(result.calledUrls).toHaveLength(0);
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

  /**
   * Regression (reported from the DevConsole):
   *
   *   POST /api/v1/translate-variant -> 422
   *   Resolved variant values are invalid: Invalid UniProt accession ID format: "INT11_HUMAN".
   *
   * Ensembl's GRCh37 archive answers VEP with an annotation release that predates three things this
   * pipeline needs: `swissprot` carries the UniProt entry NAME (`INT11_HUMAN`) instead of the
   * accession (`Q5TA45.162` on the GRCh38 host), `uniprot_isoform` is absent, and the gene is named
   * with its RETIRED symbol (`CPSF3L`, now `INTS11`). All of it is verified live for
   * `Chr1(GRCh37):g.1256452C>A`, whose archive-canonical transcript is numbered on isoform
   * `Q5TA45-5` (`p.Arg23Leu`) while the canonical sequence carries `S` at position 23.
   */
  const GRCH37_CONS = (overrides: Record<string, any> = {}) => ({
    transcript_id: "ENST00000540437",
    canonical: 1,
    consequence_terms: ["missense_variant"],
    hgvsp: "ENSP00000445001.1:p.Arg23Leu",
    amino_acids: "R/L",
    gene_symbol: "CPSF3L",
    swissprot: ["INT11_HUMAN"],
    ...overrides,
  });

  /** Same substitution on the canonical isoform — present in the payload, but unmarked by GRCh37. */
  const GRCH37_CANONICAL_SIBLING = GRCH37_CONS({
    transcript_id: "ENST00000435064",
    canonical: undefined,
    hgvsp: "ENSP00000413493.2:p.Arg17Leu",
  });

  const grch37Payload = (consequences: any[]) => [
    {
      seq_region_name: "1",
      start: 1256452,
      allele_string: "C/A",
      assembly_name: "GRCh37",
      transcript_consequences: consequences,
    },
  ];

  const ENTRY_NAME_SEARCH_HIT = {
    ok: true,
    status: 200,
    json: async () => ({ results: [{ primaryAccession: "Q5TA45", uniProtkbId: "INT11_HUMAN" }] }),
    text: async () => "",
  };

  /** `GET /uniprotkb/Q5TA45.json?fields=xref_ensembl,gene_primary,gene_synonym`, verbatim. */
  const ENTRY_REFERENCE_HIT = {
    ok: true,
    status: 200,
    json: async () => ({
      genes: [{ geneName: { value: "INTS11" }, synonyms: [{ value: "CPSF3L" }] }],
      uniProtKBCrossReferences: [
        {
          database: "Ensembl",
          id: "ENST00000435064.6",
          properties: [{ key: "ProteinId", value: "ENSP00000413493.2" }],
          isoformId: "Q5TA45-1",
        },
        {
          database: "Ensembl",
          id: "ENST00000540437.5",
          properties: [{ key: "ProteinId", value: "ENSP00000445001.1" }],
          isoformId: "Q5TA45-5",
        },
      ],
    }),
    text: async () => "",
  };

  const grch37Fetch = (consequences: any[], uniprot: { name?: any; entry?: any }) => async (url: string) => {
    if (url.includes("rest.uniprot.org")) {
      return (url.includes("/search?") ? uniprot.name : uniprot.entry) as any;
    }
    return { ok: true, status: 200, json: async () => grch37Payload(consequences), text: async () => "" } as any;
  };

  it("resolves the reported GRCh37 coordinate to canonical numbering, not a 422", async () => {
    const { statusCode, body, calledUrls } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      MISSENSE_CONSEQUENCE,
      grch37Fetch([GRCH37_CONS(), GRCH37_CANONICAL_SIBLING], {
        name: ENTRY_NAME_SEARCH_HIT,
        entry: ENTRY_REFERENCE_HIT,
      })
    );

    // No lift can be verified from this mock (the map endpoint answers the VEP payload), so the
    // inline annotation still routes the annotation to the GRCh37 host.
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl).toContain("grch37.rest.ensembl.org");
    expect(statusCode).toBe(200);
    // The retired symbol is refreshed; the swap is recorded rather than hidden.
    expect(body.gene).toBe("INTS11");
    expect(body.geneSymbolUpdated).toEqual({ from: "CPSF3L", to: "INTS11" });
    // Canonical numbering — the only sequence the structural pipeline can model.
    expect(body.variant).toBe("p.Arg17Leu");
    expect(body.uniprotId).toBe("Q5TA45");
    expect(body.uniprotIsoform).toBe("Q5TA45-1");
    expect(body.numberingBasis).toBe("remapped");
    expect(body.numberingVerified).toBe(true);
    // And the remap is disclosed in full, both machine-readably and in prose.
    expect(body.numberingRemap).toMatchObject({
      from: { hgvsp: "ENSP00000445001.1:p.Arg23Leu", isoform: "Q5TA45-5" },
      to: { hgvsp: "ENSP00000413493.2:p.Arg17Leu", isoform: "Q5TA45-1" },
    });
    expect(body.transcriptWarning).toContain("p.Arg23Leu");
    expect(body.transcriptWarning).toContain("p.Arg17Leu");
  });

  it("still resolves that coordinate when the entry-name lookup is unavailable", async () => {
    // The accession is optional enrichment: losing it costs the client one gene -> UniProt
    // resolution, whereas a 422 would cost the whole analysis.
    const { statusCode, body } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      MISSENSE_CONSEQUENCE,
      grch37Fetch([GRCH37_CONS(), GRCH37_CANONICAL_SIBLING], {
        name: {
          ok: false,
          status: 503,
          json: async () => ({ error: "service unavailable" }),
          text: async () => "service unavailable",
        },
      })
    );

    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Arg23Leu");
    expect(body.uniprotId).toBe("");
    expect(body.gene).toBe("CPSF3L");
    expect(body.numberingBasis).toBe("unverified");
  });

  /**
   * The unpredictable end of the repair: the numbering is provably non-canonical and the payload
   * offers no canonically-numbered sibling to renumber onto. Refusing is the doctrine (forwarding
   * the numbers models a residue the canonical sequence does not have), but the refusal must offer
   * a route that works for someone who already entered a coordinate.
   */
  it("refuses with a usable escape hatch when the isoform basis cannot be renumbered here", async () => {
    const { statusCode, body } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      MISSENSE_CONSEQUENCE,
      grch37Fetch([GRCH37_CONS()], { name: ENTRY_NAME_SEARCH_HIT, entry: ENTRY_REFERENCE_HIT })
    );

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("ISOFORM_NUMBERING_MISMATCH");
    expect(body.error.message).toContain("Q5TA45-5");
    expect(body.error.message).toContain("Q5TA45-5:p.Arg23Leu");
    expect(body.error.details).toMatchObject({
      isoform: "Q5TA45-5",
      uniprotId: "Q5TA45",
    });
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

  it("answers a degraded-provider 502 with a cooldown, so the client stops retrying the ladder", async () => {
    /**
     * A degraded provider sometimes answers with an UNUSABLE payload rather than timing out, which the
     * taxonomy reports as 502 — and a 502 with no Retry-After is retried by the client. Observed in
     * production: three whole ladder runs (12.3s) for one query, each re-asking two failing providers.
     * The advertised cooldown is what ends that; the message must still carry the workaround.
     */
    const unusable = () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ not: "a vep response" }),
      text: async () => '{"not":"a vep response"}',
    });

    const { statusCode, body, headers } = await invokeTranslate(
      "chr1:g.25484258G>A",
      MISSENSE_CONSEQUENCE,
      unusable
    );

    expect(statusCode).toBe(502);
    expect(body.error.message).toContain("protein-level substitution");
    expect(headers["Retry-After"]).toBe("60");
  });

  it("routes a (GRCh37) annotation to the GRCh37 Ensembl host", async () => {
    const { statusCode, calledUrls, body } = await invokeTranslate("chr1(GRCh37):g.25484258G>A");

    expect(statusCode).toBe(200);
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(body.assembly).toBe("GRCh37");
  });

  it("treats the hg19 alias as GRCh37 (hg19 does not contain '37')", async () => {
    const { calledUrls, body } = await invokeTranslate("chr1(hg19):g.25484258G>A");

    // The pairwise default mock answers the assembly map with a VEP payload, so no lift can be
    // verified and the annotation runs on the submitted build.
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(body.assembly).toBe("GRCh37");
    expect(body.resolvedAssembly).toBe("GRCh37");
    expect(body.coordinateLift?.status).toBe("unavailable");
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

  /**
   * cDNA with a stated build.
   *
   * A transcript is read against a reference sequence, so an hg19 transcript against GRCh38 is the
   * same wrong-reference hazard a genomic coordinate has — and the build annotation goes on the
   * transcript accession rather than on the coordinate. The route has honoured this spelling since
   * the annotation was read off the raw request; what did not was the shared grammar the CLIENT
   * classifies with, so the field silently stopped stating the build it had been given.
   */
  it("honours a build annotation on a cDNA notation's transcript accession", async () => {
    const { statusCode, calledUrls, body } = await invokeTranslate("NM_000277.5(GRCh37):c.1222C>T");

    expect(statusCode).toBe(200);
    // The archive host, chosen by the annotation — and the annotation itself is NOT in the query.
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(vepUrl).toContain("/vep/human/hgvs/NM_000277.5:c.1222C>T");
    expect(vepUrl).not.toContain("GRCh37");

    // The build the caller stated is reported, and the note says the annotation ran against it.
    expect(body.assembly).toBe("GRCh37");
    expect(body.resolvedAssembly).toBe("GRCh37");
    // A cDNA position carries no genomic locus, so there is nothing to lift — stated, not implied.
    expect(body.coordinateLift.status).toBe("not-applicable");
    expect(body.coordinateLift.buildDeclared).toBe(true);
    expect(body.assemblyNote).toContain("GRCh37");
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

  /**
   * A chromosome accession states the build for a cDNA notation too.
   *
   * `NC_000001.10` IS GRCh37 — the module's own table says so — so reading the build only from the
   * genomic parser sent this request to the GRCh38 host while its own text named a GRCh37 sequence.
   */
  it("routes a cDNA notation on a GRCh37 chromosome accession to the archive", async () => {
    const { statusCode, calledUrls, body } = await invokeTranslate("NC_000001.10:c.1222C>T");

    expect(statusCode).toBe(200);
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(body.assembly).toBe("GRCh37");
    expect(body.coordinateLift.status).toBe("not-applicable");
    expect(body.coordinateLift.buildDeclared).toBe(true);
  });

  /**
   * The cDNA admission gate: three notations no provider can parse, refused with the FIX in the
   * message rather than after a ladder run that could only answer "the providers returned unusable
   * responses … check the genome build".
   *
   * Measured live: Ensembl VEP answers `Unable to parse HGVS notation 'c.1799T>A'` and
   * VariantValidator answers `VariantSyntaxError: Unable to identify a colon (:)`, neither of which
   * names the missing transcript.
   */
  it.each([
    ["c.1222C>T", /must name the reference sequence/i],
    ["NP_001032248.1:c.1222C>T", /PROTEIN accession/i],
    ["C.1222C>T", /type prefix in lower case/i],
  ])("refuses the unanswerable cDNA notation %s before any provider call", async (notation, expected) => {
    const { statusCode, body, calledUrl } = await invokeTranslate(notation);

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(expected);
    expect(calledUrl).toBe("");
  });

  /**
   * Two build annotations are a contradiction, and both families are refused rather than resolved to
   * whichever came first — the reading that put one build in the query string and the other in the
   * response's own note.
   */
  it.each([
    "NM_004333.6(GRCh37)(GRCh38):c.1799T>A",
    "chr1(GRCh37)(GRCh38):g.1256452C>A",
  ])("refuses the doubly-annotated %s", async (notation) => {
    const { statusCode, body, calledUrl } = await invokeTranslate(notation);

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("more than one genome build");
    expect(body.error.message).toContain("GRCh37");
    expect(body.error.message).toContain("GRCh38");
    expect(calledUrl).toBe("");
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

/**
 * Lift-first intake: a GRCh37 coordinate is annotated on the canonical build.
 *
 * POLICY UNDER TEST (`src/shared/assembly.ts`): "Coordinates are LIFTED to the canonical build when
 * the input build differs, and the lift is REVERSE-VERIFIED before use."
 *
 * WHY IT MATTERS: Ensembl's GRCh37 host serves a frozen archive — no MANE Select, no
 * `uniprot_isoform`, retired gene symbols — while every consumer below this route is pinned to
 * GRCh38. Measured on the reported coordinate `Chr1(GRCh37):g.1256452C>A`, the archive numbers it
 * `p.Arg23Leu` on isoform `Q5TA45-5` while MANE numbers the same substitution `p.Arg17Leu` on
 * canonical `Q5TA45-1`; annotating on the canonical build makes a GRCh37 and a GRCh38 spelling of
 * one variant converge on one answer, and it is the answer the structural pipeline can model.
 */
describe("POST /translate-variant — lift-first genome-build intake", () => {
  beforeEach(() => {
    clearAllCaches(true);
  });

  /** MANE Select consequence for INTS11 at the canonical locus, as the GRCh38 host reports it. */
  const INTS11_MANE_CONSEQUENCE = {
    transcript_id: "ENST00000435064",
    canonical: 1,
    mane_select: "NM_017871.6",
    consequence_terms: ["missense_variant"],
    hgvsp: "ENSP00000413493.2:p.Arg17Leu",
    amino_acids: "R/L",
    uniprot_isoform: ["Q5TA45-1"],
    gene_symbol: "INTS11",
    swissprot: ["Q5TA45.162"],
  };

  const jsonResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as any;

  /** The canonical-build VEP answer for the LIFTED locus (chr1:1,321,072 C>A). */
  const vepPayloadAtLiftedLocus = () =>
    jsonResponse([
      {
        seq_region_name: "1",
        start: 1321072,
        allele_string: "C/A",
        assembly_name: "GRCh38",
        transcript_consequences: [INTS11_MANE_CONSEQUENCE],
      },
    ]);

  /** Ensembl assembly-map answers: forward chr1:1,256,452 → 1,321,072 and the exact reverse. */
  const liftAwareFetch = (mapOverride?: any) => async (url: string) => {
    if (url.includes("/map/human/GRCh37/")) {
      return mapOverride ?? jsonResponse({ mappings: [{ mapped: { seq_region_name: "1", start: 1321072, end: 1321072, strand: 1 } }] });
    }
    if (url.includes("/map/human/GRCh38/")) {
      return jsonResponse({ mappings: [{ mapped: { seq_region_name: "1", start: 1256452, end: 1256452, strand: 1 } }] });
    }
    if (url.includes("/sequence/region/human/")) {
      // The GRCh38 reference base at the lifted position must equal the submitted REF allele.
      return { ok: true, status: 200, json: async () => ({}), text: async () => "C" } as any;
    }
    return vepPayloadAtLiftedLocus();
  };

  /**
   * ── HOST-AWARE provider transport ───────────────────────────────────────────────
   *
   * `liftAwareFetch` above is HOST-BLIND: it answers EVERY VEP query with the GRCh38-locus
   * INTS11 answer, so a request that (by regression) queried `grch37.rest.ensembl.org` still
   * received the canonical-build payload and every convergence assertion passed. That certified
   * convergence by URL assertion only — the very thing the fix is about (the GRCh37 archive
   * answers with a DIFFERENT release: the retired symbol, the entry NAME where an accession
   * belongs, and no isoform metadata at all).
   *
   * This transport answers each host with its own release's payload, so a mis-routed request
   * produces the archive's answer and the assertions below fail on the CONTENT.
   */
  const UNIPROT_ENTRY_NAME_ACCESSIONS: Record<string, string> = {
    INT11_HUMAN: "Q5TA45",
    CPTP_HUMAN: "Q5TA50",
  };

  /**
   * `GET /uniprotkb/Q5TA45.json?fields=xref_ensembl,gene_primary,gene_synonym`, trimmed to the two
   * Ensembl cross-references the archive's rows need (the live entry carries five, one per
   * isoform Q5TA45-1…-5; `coordinate-resolver.test.ts` holds the full set).
   */
  const UNIPROT_Q5TA45_REFERENCE = {
    genes: [{ geneName: { value: "INTS11" }, synonyms: [{ value: "CPSF3L" }, { value: "RC68" }] }],
    uniProtKBCrossReferences: [
      {
        database: "Ensembl",
        id: "ENST00000435064.6",
        properties: [{ key: "ProteinId", value: "ENSP00000413493.2" }],
        isoformId: "Q5TA45-1",
      },
      {
        database: "Ensembl",
        id: "ENST00000540437.5",
        properties: [{ key: "ProteinId", value: "ENSP00000445001.1" }],
        isoformId: "Q5TA45-5",
      },
    ],
  };

  /**
   * The REAL GRCh37 archive answer for the submitted locus, trimmed to the two consequences that
   * matter out of the live 40: the archive's own canonical transcript (numbered on isoform
   * `Q5TA45-5`) and the canonically-numbered sibling it does not mark. It carries the archive's
   * three signature defects — `swissprot: ["INT11_HUMAN"]` (an entry NAME), no `uniprot_isoform`,
   * and the retired symbol `CPSF3L`.
   */
  const grch37ArchivePayload = () =>
    jsonResponse([
      {
        seq_region_name: "1",
        start: 1256452,
        allele_string: "C/A",
        assembly_name: "GRCh37",
        transcript_consequences: [
          {
            transcript_id: "ENST00000540437",
            canonical: 1,
            consequence_terms: ["missense_variant"],
            hgvsp: "ENSP00000445001.1:p.Arg23Leu",
            amino_acids: "R/L",
            gene_symbol: "CPSF3L",
            swissprot: ["INT11_HUMAN"],
          },
          {
            transcript_id: "ENST00000435064",
            consequence_terms: ["missense_variant"],
            hgvsp: "ENSP00000413493.2:p.Arg17Leu",
            amino_acids: "R/L",
            gene_symbol: "CPSF3L",
            swissprot: ["INT11_HUMAN"],
          },
        ],
      },
    ]);

  /**
   * Host-aware transport. `calls` (optional) records every URL, so a test can count the VEP
   * queries a request actually made instead of diffing the whole call list.
   */
  const hostAwareFetch = (options: { calls?: string[]; liftRefused?: boolean } = {}) => async (url: string) => {
    options.calls?.push(url);
    if (url.includes("/map/human/GRCh37/")) {
      return options.liftRefused
        ? jsonResponse({
            // Two mappings for one point: a paralogous/ambiguous region. The lift is REFUSED,
            // never guessed at — so the annotation must stay on the submitted build.
            mappings: [
              { mapped: { seq_region_name: "1", start: 1321072, end: 1321072, strand: 1 } },
              { mapped: { seq_region_name: "1", start: 1321073, end: 1321073, strand: 1 } },
            ],
          })
        : jsonResponse({ mappings: [{ mapped: { seq_region_name: "1", start: 1321072, end: 1321072, strand: 1 } }] });
    }
    if (url.includes("/map/human/GRCh38/")) {
      return jsonResponse({ mappings: [{ mapped: { seq_region_name: "1", start: 1256452, end: 1256452, strand: 1 } }] });
    }
    if (url.includes("/sequence/region/human/")) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "C" } as any;
    }
    // The frozen archive answers its own release's payload…
    if (url.includes("grch37.rest.ensembl.org")) return grch37ArchivePayload();
    // …and the current site answers the current one.
    if (url.includes("rest.uniprot.org")) {
      if (url.includes("/search?")) {
        const name = Object.keys(UNIPROT_ENTRY_NAME_ACCESSIONS).find((entry) => url.includes(entry));
        return name
          ? jsonResponse({
              results: [{ primaryAccession: UNIPROT_ENTRY_NAME_ACCESSIONS[name], uniProtkbId: name }],
            })
          : jsonResponse({ results: [] });
      }
      return jsonResponse(UNIPROT_Q5TA45_REFERENCE);
    }
    return vepPayloadAtLiftedLocus();
  };

  /** Count of annotation queries (as opposed to assembly-map / sequence / UniProt traffic). */
  const vepCallCount = (calls: string[]) =>
    calls.filter((url) => url.includes("/vep/human/hgvs/")).length;

  it("verifies the coordinate on GRCh38, annotates there, and reports both builds", async () => {
    const { statusCode, body, calledUrls } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      INTS11_MANE_CONSEQUENCE,
      liftAwareFetch()
    );

    expect(statusCode).toBe(200);

    // The annotation ran on the CURRENT release, not the frozen archive.
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://rest.ensembl.org")).toBe(true);
    expect(vepUrl).toContain("chr1:g.1321072C>A");
    expect(calledUrls.some((u) => u.includes("grch37.rest.ensembl.org"))).toBe(false);

    // Submitted build and locus are preserved; the verified canonical locus travels beside them.
    expect(body.assembly).toBe("GRCh37");
    expect(body.resolvedAssembly).toBe("GRCh38");
    expect(body.genomicCoordinates).toBe("1-1256452-C-A");
    expect(body.liftedGenomicCoordinates).toBe("1-1321072-C-A");
    expect(body.coordinateLift).toMatchObject({
      status: "lifted",
      fromAssembly: "GRCh37",
      toAssembly: "GRCh38",
      fromCoordinates: "1-1256452-C-A",
      toCoordinates: "1-1321072-C-A",
      reverseVerified: true,
    });
    expect(body.assemblyNote).toContain("GRCh38");

    // Canonical numbering arrived directly from MANE — the whole point of annotating on GRCh38.
    expect(body.variant).toBe("p.Arg17Leu");
    expect(body.gene).toBe("INTS11");
    expect(body.uniprotId).toBe("Q5TA45");
    expect(body.uniprotIsoform).toBe("Q5TA45-1");
    expect(body.numberingBasis).toBe("canonical");
    expect(body.numberingVerified).toBe(true);
    // No remap note: nothing had to be renumbered, so nothing needs disclosing beyond the lift.
    expect(body.numberingRemap).toBeUndefined();
    expect(body.transcriptWarning).toBeUndefined();
  });

  /**
   * A GRCh37 and a GRCh38 spelling of the SAME variant must produce the SAME answer. Before
   * lift-first they could not: the archive's numbering came from its own (older) canonical
   * transcript set, so one spelling resolved `p.Arg23Leu` and the other `p.Arg17Leu`.
   */
  it("gives a GRCh37 and a GRCh38 spelling of one variant the same answer", async () => {
    const fromGRCh37 = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      INTS11_MANE_CONSEQUENCE,
      liftAwareFetch()
    );
    const fromGRCh38 = await invokeTranslate(
      "Chr1(GRCh38):g.1321072C>A",
      INTS11_MANE_CONSEQUENCE,
      liftAwareFetch()
    );

    expect(fromGRCh38.body.coordinateLift.status).toBe("not-needed");
    for (const field of ["gene", "variant", "uniprotId", "uniprotIsoform", "numberingBasis"]) {
      expect(fromGRCh37.body[field]).toBe(fromGRCh38.body[field]);
    }
    // …and the canonical query still resolves against the same (lifted) locus.
    expect(fromGRCh38.body.genomicCoordinates).toBe("1-1321072-C-A");
    expect(fromGRCh37.body.liftedGenomicCoordinates).toBe(fromGRCh38.body.genomicCoordinates);
  });

  /**
   * The SAME convergence, certified against a HOST-AWARE provider.
   *
   * The test above asserts convergence while every host returns the GRCh38 answer, so it proves
   * the ANSWER converges — not that the annotation ran on the canonical release. A regression that
   * queried the frozen archive (or a lift that stopped rewriting the notation) would still pass it.
   * Here each host serves its own release, so the assertions are on content the archive cannot
   * produce: MANE Select, a UniProt ACCESSion, isoform `Q5TA45-1` and `numberingBasis: "canonical"`.
   * The archive's answer is `remapped` (its own canonical transcript is numbered on `Q5TA45-5`),
   * carries the retired symbol `CPSF3L` and the entry NAME `INT11_HUMAN`.
   */
  it("converges a GRCh37 and a GRCh38 spelling on one canonical answer against host-specific payloads", async () => {
    const fromGRCh37 = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      INTS11_MANE_CONSEQUENCE,
      hostAwareFetch()
    );
    const fromGRCh38 = await invokeTranslate(
      "Chr1(GRCh38):g.1321072C>A",
      INTS11_MANE_CONSEQUENCE,
      hostAwareFetch()
    );

    // ── The GRCh37 request: lifted, then annotated on the CURRENT release ──────────
    expect(fromGRCh37.statusCode).toBe(200);
    const vepUrl = fromGRCh37.calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://rest.ensembl.org")).toBe(true);
    expect(vepUrl).toContain("chr1:g.1321072C>A");
    // The frozen archive was never asked: it can neither lift nor number this variant canonically.
    expect(fromGRCh37.calledUrls.some((u) => u.includes("grch37.rest.ensembl.org"))).toBe(false);

    expect(fromGRCh37.body.assembly).toBe("GRCh37");
    expect(fromGRCh37.body.resolvedAssembly).toBe("GRCh38");
    expect(fromGRCh37.body.coordinateLift.status).toBe("lifted");
    expect(fromGRCh37.body.coordinateLift.buildDeclared).toBe(true);
    /**
     * THE GUARD, with a host-aware echo. The GRCh38 payload's echo is the CANONICAL locus
     * (chr1:1,321,072) while the caller submitted chr1:1,256,452, so a route that forwarded the
     * echo would answer `genomicCoordinates: "1-1321072-C-A"` under `assembly: "GRCh37"` — a
     * canonical position wearing the submitted build's tag.
     */
    expect(fromGRCh37.body.genomicCoordinates).toBe("1-1256452-C-A");
    expect(fromGRCh37.body.liftedGenomicCoordinates).toBe("1-1321072-C-A");

    // ── The GRCh38 request: no lift involved ──────────────────────────────────────
    expect(fromGRCh38.statusCode).toBe(200);
    expect(fromGRCh38.body.coordinateLift.status).toBe("not-needed");
    expect(fromGRCh38.body.resolvedAssembly).toBe("GRCh38");
    // Its own locus IS the canonical one, echoed by the provider it asked.
    expect(fromGRCh38.body.genomicCoordinates).toBe("1-1321072-C-A");
    expect(fromGRCh38.body.liftedGenomicCoordinates).toBeUndefined();

    // ── One answer, on every field a consumer keys on ─────────────────────────────
    expect(fromGRCh37.body.gene).toBe("INTS11");
    expect(fromGRCh37.body.variant).toBe("p.Arg17Leu");
    expect(fromGRCh37.body.uniprotId).toBe("Q5TA45");
    expect(fromGRCh37.body.uniprotIsoform).toBe("Q5TA45-1");
    expect(fromGRCh37.body.numberingBasis).toBe("canonical");

    for (const field of ["gene", "variant", "uniprotId", "uniprotIsoform", "numberingBasis"]) {
      expect(fromGRCh37.body[field]).toBe(fromGRCh38.body[field]);
    }
    // Canonical numbering arrived directly from MANE, so there is nothing to renumber.
    expect(fromGRCh37.body.numberingRemap).toBeUndefined();

    /**
     * The disclosure must name the release the annotation came from — and must NOT assert the
     * submitted build in a sentence that reads as "resolved against the GRCh37 reference", which is
     * the wrong-release claim this note exists to avoid.
     */
    expect(fromGRCh37.body.assemblyNote).toContain(
      "The coordinate is stated in GRCh37 and was verified on the GRCh38 reference"
    );
    expect(fromGRCh37.body.assemblyNote).not.toContain("resolved against the GRCh37 reference");
    /**
     * The GRCh38 spelling is ANNOTATED, so it keeps the historical note — which names the build
     * the annotation ran on (GRCh38, the same one) and mentions no lift.
     */
    expect(fromGRCh38.body.assemblyNote).toContain("resolved against the GRCh38 reference assembly");
    expect(fromGRCh38.body.assemblyNote).not.toContain("verified on the GRCh38 reference");
    expect(fromGRCh38.body.assemblyNote).not.toContain("GRCh37");
  });

  /**
   * THE NO-LIFT PAIRING, on the branch where no lift verifies.
   *
   * A refused lift leaves the annotation on the SUBMITTED build (`resolvedAssembly === "GRCh37"`),
   * and `genomicCoordinates` must then be the coordinate the CALLER submitted — paired with
   * `assembly: "GRCh37"` — never the canonical locus. That pairing is what a report cites and what
   * the client forwards to the build-pinned predictors, so a canonical position wearing the
   * submitted build's tag would be the wrong-locus hazard itself.
   *
   * The transport here is HOST-AWARE, so the body under test is genuinely the archive's answer:
   * the retired symbol, the entry NAME in `swissprot`, no isoform metadata — and the archive's own
   * canonical numbering, which is why the protein change arrives via a disclosed remap.
   */
  it("keeps the submitted locus and the submitted build when the lift is refused", async () => {
    const { statusCode, body, calledUrls } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      MISSENSE_CONSEQUENCE,
      hostAwareFetch({ liftRefused: true })
    );

    expect(statusCode).toBe(200);

    // ── The lift was refused, and the decision says why ───────────────────────────
    expect(body.coordinateLift.status).toBe("unavailable");
    expect(body.coordinateLift.reason).toContain("could not be verified");
    expect(body.coordinateLift.fromAssembly).toBe("GRCh37");
    // `toAssembly` is the build the annotation ACTUALLY ran against, so a refused lift reports the
    // submitted build on both sides — not the canonical build the lift could not reach.
    expect(body.coordinateLift.toAssembly).toBe("GRCh37");
    expect(body.assembly).toBe("GRCh37");
    expect(body.resolvedAssembly).toBe("GRCh37");
    expect(body.liftedGenomicCoordinates).toBeUndefined();

    // ── It was asked at the SUBMITTED locus, on the submitted build's host ────────
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(vepUrl).toContain("chr1:g.1256452C>A");

    /**
     * …and the pair the response publishes is the SUBMITTED one: the submitted locus beside the
     * submitted build. The canonical locus is a different string, and it appears NOWHERE in the
     * pair — `liftedGenomicCoordinates` is absent, and `genomicCoordinates` is not it.
     */
    expect(body.genomicCoordinates).toBe("1-1256452-C-A");
    expect(body.genomicCoordinates).not.toBe("1-1321072-C-A");

    /**
     * The archive branch really is the one under test (so a future change that silently lifted
     * anyway, or that routed this request to the current release, cannot pass): the retired symbol
     * arrives from the archive, and the numbering is the archive's own — `remapped` onto canonical
     * `Q5TA45-1`, never the direct `canonical` verdict MANE Select gives.
     */
    expect(body.gene).toBe("INTS11");
    expect(body.variant).toBe("p.Arg17Leu");
    expect(body.uniprotIsoform).toBe("Q5TA45-1");
    expect(body.numberingBasis).toBe("remapped");
    expect(body.numberingRemap).toBeDefined();
    expect(body.assemblyNote).toContain("predates MANE Select");
    // The note says the lift could NOT be verified — it must not claim one was.
    expect(body.assemblyNote).not.toContain("was verified on");
  });

  /**
   * The resolution cache is keyed by (assembly, notation) — and after lift-first, a GRCh37 request
   * and a GRCh38 request for the SAME variant share ONE entry, because the lift rewrites the
   * notation onto the canonical build before the cache is consulted. The easy order (identical
   * spelling twice) was covered; this covers the order a real user produces, and the thing that
   * order breaks: EVERY other response field is served from the shared entry, but the build trail
   * must still be PER REQUEST — the second response is a GRCh37 submission whose lift is its own
   * fact, not the cached GRCh38 one's.
   */
  it("shares the resolution cache with the lift, while each request keeps its own build trail", async () => {
    const calls: string[] = [];
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async (url: any) => hostAwareFetch({ calls })(String(url)) as any);

    try {
      // 1. The canonical spelling first: no lift, one VEP query, one cache entry.
      const first = await invokeTranslateWithSpy("Chr1(GRCh38):g.1321072C>A");
      const vepCallsAfterFirst = vepCallCount(calls);

      // 2. The GRCh37 spelling of the SAME variant: lifted, then served from that entry.
      const second = await invokeTranslateWithSpy("Chr1(GRCh37):g.1256452C>A");

      expect(first.statusCode).toBe(200);
      expect(first.body.provenance.cacheHit).toBe(false);
      expect(vepCallsAfterFirst).toBe(1);

      expect(second.statusCode).toBe(200);
      // Served from the shared entry …
      expect(second.body.provenance.cacheHit).toBe(true);
      // … so the lift it performed was the ONLY provider traffic left: zero further VEP queries.
      expect(vepCallCount(calls)).toBe(vepCallsAfterFirst);
      // …and the shared answer is the same answer.
      expect(second.body.gene).toBe("INTS11");
      expect(second.body.variant).toBe("p.Arg17Leu");
      expect(second.body.uniprotIsoform).toBe("Q5TA45-1");
      expect(second.body.numberingBasis).toBe("canonical");

      // Its OWN build trail, though — the lift happened for THIS request.
      expect(second.body.assembly).toBe("GRCh37");
      expect(second.body.resolvedAssembly).toBe("GRCh38");
      expect(second.body.coordinateLift).toMatchObject({
        status: "lifted",
        fromAssembly: "GRCh37",
        toAssembly: "GRCh38",
        fromCoordinates: "1-1256452-C-A",
        toCoordinates: "1-1321072-C-A",
        reverseVerified: true,
      });
      expect(second.body.liftedGenomicCoordinates).toBe("1-1321072-C-A");
      // …and the submitted locus, not the cache entry's canonical one.
      expect(second.body.genomicCoordinates).toBe("1-1256452-C-A");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the submitted build and explains the older annotation when no lift verifies", async () => {
    // An ambiguous mapping (a paralogous region maps more than once) is a REFUSAL, not a guess.
    const ambiguous = jsonResponse({
      mappings: [
        { mapped: { seq_region_name: "1", start: 1321072, end: 1321072, strand: 1 } },
        { mapped: { seq_region_name: "1", start: 1321073, end: 1321073, strand: 1 } },
      ],
    });

    const { statusCode, body, calledUrls } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      MISSENSE_CONSEQUENCE,
      liftAwareFetch(ambiguous)
    );

    expect(statusCode).toBe(200);
    expect(calledUrls.some((u) => u.includes("/map/human/GRCh37/"))).toBe(true);
    const vepUrl = calledUrls.find((u) => u.includes("/vep/human/hgvs/"));
    expect(vepUrl?.startsWith("https://grch37.rest.ensembl.org")).toBe(true);

    expect(body.assembly).toBe("GRCh37");
    expect(body.resolvedAssembly).toBe("GRCh37");
    expect(body.liftedGenomicCoordinates).toBeUndefined();
    expect(body.coordinateLift.status).toBe("unavailable");
    expect(body.coordinateLift.reason).toContain("could not be verified");
    // The reader is told WHY this answer may be numbered on an older transcript set.
    // The note must say the release is OLDER, without naming a provider (the build-aware fallback
    // may have answered) and without claiming the annotation came from the submitted build.
    expect(body.assemblyNote).toContain("predates MANE Select");
    expect(body.assemblyNote).not.toContain("Ensembl");
    expect(body.assemblyNote).not.toContain("resolved against the GRCh37 reference");
    expect(body.coordinateLift.buildDeclared).toBe(true);
    expect(body.assemblyNote).toContain("MANE");
  });

  it("survives an unreachable assembly map and still answers on the submitted build", async () => {
    const mapDown = async (url: string) => {
      if (url.includes("/map/human/")) {
        throw new Error("fetch failed");
      }
      return url.includes("/vep/human/hgvs/")
        ? ({ ok: true, status: 200, json: async () => [{
            seq_region_name: "1",
            start: 1256452,
            allele_string: "C/A",
            transcript_consequences: [{ ...MISSENSE_CONSEQUENCE, gene_symbol: "CPSF3L" }],
          }], text: async () => "" } as any)
        : jsonResponse({ results: [{ primaryAccession: "Q8N5G0", uniProtkbId: "MACO1_HUMAN" }] });
    };

    const { statusCode, body } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      MISSENSE_CONSEQUENCE,
      mapDown
    );

    // A lift is auxiliary: losing it must never lose the variant.
    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Glu433Lys");
    expect(body.coordinateLift.status).toBe("unavailable");
  });

  it("states the resolved build when a lifted coordinate turns out to have no protein change", async () => {
    const noProteinChange = async (url: string) => {
      if (url.includes("/map/human/GRCh37/")) {
        return jsonResponse({ mappings: [{ mapped: { seq_region_name: "1", start: 1321072, end: 1321072, strand: 1 } }] });
      }
      if (url.includes("/map/human/GRCh38/")) {
        return jsonResponse({ mappings: [{ mapped: { seq_region_name: "1", start: 1256452, end: 1256452, strand: 1 } }] });
      }
      if (url.includes("/sequence/region/human/")) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => "C" } as any;
      }
      if (url.includes("/vep/human/hgvs/")) {
        return jsonResponse([{
          seq_region_name: "1",
          start: 1321072,
          allele_string: "C/A",
          transcript_consequences: [{
            transcript_id: "ENST00000435064",
            canonical: 1,
            gene_symbol: "INTS11",
            consequence_terms: ["intron_variant"],
            hgvsc: "ENST00000435064.6:c.50+5G>A",
          }],
        }]);
      }
      return jsonResponse({ error: "not a transcript envelope" });
    };

    const { statusCode, body } = await invokeTranslate(
      "Chr1(GRCh37):g.1256452C>A",
      MISSENSE_CONSEQUENCE,
      noProteinChange
    );

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("NON_MISSENSE_VARIANT");
    // The message names the build the ANNOTATION came from (GRCh38), while `details` keeps the
    // build the caller submitted — the two build questions must never be conflated.
    expect(body.error.message).toContain("GRCh38");
    expect(body.error.details.assembly).toBe("GRCh37");
    expect(body.error.details.resolvedAssembly).toBe("GRCh38");
    expect(body.error.details.coordinateLift.status).toBe("lifted");
  });
});

/**
 * The reference-allele mismatch.
 *
 * THE COORDINATE HERE IS LIVE-VERIFIED, and the earlier version of this suite was not: it used
 * `chr1:g.1256452C>A` and asserted a 400 that CANNOT occur for it — the GRCh38 reference base at
 * chr1:1,256,452 is `C`, and Ensembl answers that query 200 with an intron_variant in UBE2J2. A
 * fixture that no provider can produce proves nothing about the case it names, and it documented the
 * opposite of the truth for whoever read it next.
 *
 * The real shape, measured on `chrX:g.23723975C>A` (an hg19 ACOT9 allele): the GRCh38 base at that
 * position is `A` while the submitted REF is `C`, so Ensembl VEP answers 400 "Reference allele
 * extracted from chrX:23723975-23723975 (A) does not match …", and GRCh37 carries `C` — which is why
 * offering the GRCh37 spelling is a remedy rather than a guess.
 */
describe("POST /translate-variant — reference-allele mismatch", () => {
  beforeEach(() => {
    clearAllCaches(true);
    // Caches, breakers and semaphores are per-host module-globals: without this, a rung SKIPPED by an
    // open breaker from an earlier test can pass these assertions for the wrong reason.
    resetHostStateForTests();
  });

  const MISMATCH_NOTATION = "chrX:g.23723975C>A";

  /** VERBATIM live Ensembl VEP 400 body for the coordinate above. */
  const VEP_MISMATCH_400 = (notation: string) =>
    `Unable to parse HGVS notation '${notation}': Reference allele extracted from ` +
    `chrX:23723975-23723975 (A) does not match reference allele given by HGVS notation ${notation} (C)`;

  /** VERBATIM live VariantValidator 200 body: no payload, the finding only inside the warning list. */
  const vvMismatch200 = (notation: string) =>
    new Response(
      JSON.stringify({
        flag: "warning",
        validation_warning_1: {
          gene_symbol: "",
          annotations: {},
          hgvs_predicted_protein_consequence: {},
          primary_assembly_loci: {},
          submitted_variant: notation,
          validation_warnings: [
            "This is not a valid HGVS variant description, because no reference sequence ID has been provided",
            "ReferenceMismatchError: NC_000023.11:g.23723975C>A: Variant reference (C) does not agree with reference sequence (A)",
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  /**
   * Every provider refuses the coordinate, and the reference bases the hint check reads are supplied
   * per host — `grch37` carries the submitted allele (as it really does), `grch38` does not.
   */
  const mismatchFetch = (
    options: { calls?: string[]; otherBuildBase?: string; sameBuildBase?: string; notation?: string } = {}
  ) => async (url: string) => {
    const notation = options.notation ?? MISMATCH_NOTATION;
    options.calls?.push(url);
    if (url.includes("/map/human/")) {
      return new Response(JSON.stringify({ mappings: [] }), { status: 200 });
    }
    if (url.includes("/sequence/region/human/")) {
      // The archive is the build being OFFERED, so it is the one that must carry the submitted REF.
      const base = url.includes("grch37.rest.ensembl.org")
        ? options.otherBuildBase ?? "C"
        : options.sameBuildBase ?? "A";
      return new Response(base, { status: 200 });
    }
    if (url.includes("rest.uniprot.org")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    // The ladder: the primary answers the live 400, the fallback the live 200-with-warnings.
    if (url.includes("variantvalidator")) return vvMismatch200(notation);
    return new Response(JSON.stringify({ error: VEP_MISMATCH_400(notation) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  };

  it("answers 422 COORDINATE_REFERENCE_MISMATCH and hands back the other build's spelling", async () => {
    const { statusCode, body, headers } = await invokeTranslate(
      MISMATCH_NOTATION,
      MISSENSE_CONSEQUENCE,
      mismatchFetch()
    );

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("COORDINATE_REFERENCE_MISMATCH");
    // A fact about the request, so the reader is told what to change — not to retry.
    expect(body.error.message).toContain("reference allele does not match");
    expect(body.error.message).toContain("genome-build mismatch");
    /**
     * The remedy, ready to submit: the SAME coordinate stated in the other build. Composed by the
     * server, so the client never splices a build into a coordinate grammar of its own.
     */
    expect(body.error.details.buildHint).toEqual({
      assembly: "GRCh37",
      triedAssembly: "GRCh38",
      notation: "ChrX(GRCh37):g.23723975C>A",
      reason: expect.stringContaining("reference allele"),
    });
    // The build trail travels with the failure, including the fact that no lift was involved.
    expect(body.error.details.assembly).toBe("GRCh38");
    expect(body.error.details.resolvedAssembly).toBe("GRCh38");
    expect(body.error.details.coordinateLift.status).toBe("not-needed");
    // Both rungs really were asked — a single-rung run would pass the assertions above by accident.
    expect(body.error.details.attempts.map((a: any) => a.provider)).toEqual([
      "ensembl-vep",
      "variant-validator",
    ]);
    /**
     * No cooldown: `Retry-After` is what stops the client re-running a whole ladder, and here the
     * client must NOT re-run it — the same coordinate will be refused identically.
     */
    expect(headers["Retry-After"]).toBeUndefined();
  });

  /**
   * The offer is CHECKED, not assumed.
   *
   * `chr1:g.999999999A>G` has no base in either build — chr1 ends at 248,956,422 — yet the first
   * version offered "Chr1(GRCh37):g.999999999A>G" with equal confidence, a coordinate nobody can
   * resolve. Neither build carrying the allele means the POSITION or the ALLELES are wrong, and the
   * message must say so rather than lead with the build.
   */
  it("withholds the offer when neither build carries the submitted allele", async () => {
    const { statusCode, body } = await invokeTranslate(
      "chr1:g.999999999A>G",
      MISSENSE_CONSEQUENCE,
      mismatchFetch({ notation: "chr1:g.999999999A>G", otherBuildBase: "N", sameBuildBase: "N" })
    );

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("COORDINATE_REFERENCE_MISMATCH");
    expect(body.error.details.buildHint).toBeUndefined();
    expect(body.error.message).toContain("neither carries the submitted allele");
    // The build trail still travels: the refusal states what it was read against either way.
    expect(body.error.details.coordinateLift.status).toBe("not-needed");
  });

  /**
   * …and the mirror case, which is the one a retry would make worse: if the build ALREADY read against
   * carries the submitted allele, then the build is not what disagrees, whatever the provider said.
   */
  it("withholds the offer when the build it was read against already carries the allele", async () => {
    const { body } = await invokeTranslate(
      MISMATCH_NOTATION,
      MISSENSE_CONSEQUENCE,
      mismatchFetch({ sameBuildBase: "C", otherBuildBase: "C" })
    );

    expect(body.error.details.buildHint).toBeUndefined();
    expect(body.error.message).toContain("the build is not what disagrees here");
  });

  /**
   * A coordinate can legitimately belong to the OTHER build and be annotated with the wrong one. The
   * evidence — the allele matching the other build — points at the annotation being the mistake, so the
   * offer stands even though a build was stated; withdrawing it here would remove the remedy from
   * exactly the case the evidence supports.
   */
  it("offers the other build even when the caller stated one, while saying which build was tried", async () => {
    const calls: string[] = [];
    const archiveMismatch = async (url: string) => {
      calls.push(url);
      const notation = "chrX:g.23723975C>A";
      if (url.includes("/map/human/GRCh37/")) {
        // An ambiguous mapping: the lift is refused, so the annotation stays on the STATED build.
        return new Response(JSON.stringify({
          mappings: [
            { mapped: { seq_region_name: "X", start: 23705858, end: 23705858, strand: 1 } },
            { mapped: { seq_region_name: "X", start: 23705859, end: 23705859, strand: 1 } },
          ],
        }), { status: 200 });
      }
      if (url.includes("/sequence/region/human/")) {
        // GRCh38 (the offered build) carries C; GRCh37 (the stated one) does not.
        return new Response(url.includes("grch37.rest.ensembl.org") ? "A" : "C", { status: 200 });
      }
      if (url.includes("rest.uniprot.org")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.includes("variantvalidator")) return vvMismatch200(notation);
      return new Response(JSON.stringify({ error: VEP_MISMATCH_400(notation) }), { status: 400 });
    };

    const { statusCode, body } = await invokeTranslate(
      "ChrX(GRCh37):g.23723975C>A",
      MISSENSE_CONSEQUENCE,
      archiveMismatch
    );

    expect(statusCode).toBe(422);
    // The hint points at the build that was NOT tried, and names the one that WAS.
    expect(body.error.details.buildHint).toMatchObject({
      assembly: "GRCh38",
      triedAssembly: "GRCh37",
      notation: "ChrX(GRCh38):g.23723975C>A",
    });
    // …and the trail explains why it was read on GRCh37 at all.
    expect(body.error.details.coordinateLift.status).toBe("unavailable");
    expect(body.error.details.coordinateLift.buildDeclared).toBe(true);
    expect(calls.some((u) => u.includes("grch37.rest.ensembl.org"))).toBe(true);
  });

  /**
   * cDNA carries a build on the TRANSCRIPT, and the route accepts it from either notation field — but a
   * `c.` position is a place in a transcript, not in a reference assembly, so there is no base to check
   * an alternative against. The offer is therefore WITHHELD (rather than made unverified, which is what
   * the first version did and what the copy then overclaimed), and the remedy is stated in words.
   */
  it("withholds the offer for cDNA, naming the transcript-level remedy instead", async () => {
    const cdna = "NM_000277.5:c.1222C>A";
    const fetchImpl = async (url: string) => {
      if (url.includes("/sequence/region/human/")) return new Response("C", { status: 200 });
      if (url.includes("rest.uniprot.org")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.includes("variantvalidator")) return vvMismatch200(cdna);
      return new Response(JSON.stringify({ error: VEP_MISMATCH_400(cdna) }), { status: 400 });
    };

    const { statusCode, body } = await invokeTranslate(cdna, MISSENSE_CONSEQUENCE, fetchImpl);

    expect(statusCode).toBe(422);
    expect(body.error.code).toBe("COORDINATE_REFERENCE_MISMATCH");
    expect(body.error.details.buildHint).toBeUndefined();
    // The actionable half is in the message, since there is no verified spelling to offer.
    expect(body.error.message).toContain("no alternative spelling could be verified");
    expect(body.error.message).toContain("NM_000277.5(GRCh37):c.1222C>A");
  });

  it("keeps a genuinely unusable provider answer as a 502 with no build hint", async () => {
    // The hint must be a statement about THIS failure, not decoration every refusal carries: without
    // this case, attaching it unconditionally would still pass the tests above. A generic 4xx (a
    // validation refusal that names no reference) stays `invalid_response` — 502 — exactly as before.
    const { statusCode, body, headers } = await invokeTranslate(
      MISMATCH_NOTATION,
      MISSENSE_CONSEQUENCE,
      async (url: string) =>
        url.includes("rest.uniprot.org")
          ? new Response(JSON.stringify({ results: [] }), { status: 200 })
          : new Response(JSON.stringify({ error: "Invalid region notation" }), { status: 400 })
    );

    expect(statusCode).toBe(502);
    expect(body.error.code).toBe("TRANSLATION_FAILED");
    expect(body.error.details.buildHint).toBeUndefined();
    // The temporary-failure cooldown still applies where it should.
    expect(headers["Retry-After"]).toBe("60");
  });

  /**
   * The two other failure kinds that must NOT carry a build hint. A 404's own text asks the reader to
   * "verify the chromosome, position, alleles and genome build", and a hint whose `reason` claims the
   * alleles matched no reference base would be a false statement bolted to it.
   */
  it("never attaches a build hint to a not-found or an outage", async () => {
    const noProtein = async (url: string) => {
      if (url.includes("rest.uniprot.org")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.includes("variantvalidator")) {
        return new Response(JSON.stringify({ flag: "intergenic", intergenic_variant_1: {} }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify([
          {
            seq_region_name: "X",
            start: 23723975,
            allele_string: "C/A",
            transcript_consequences: [
              {
                transcript_id: "ENST00000347370",
                gene_symbol: "UBE2J2",
                consequence_terms: ["intron_variant"],
                hgvsc: "ENST00000347370.8:c.415-327G>T",
              },
            ],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const notFound = await invokeTranslate(MISMATCH_NOTATION, MISSENSE_CONSEQUENCE, noProtein);
    expect(notFound.body.error.details.buildHint).toBeUndefined();

    const outage = await invokeTranslate(
      MISMATCH_NOTATION,
      MISSENSE_CONSEQUENCE,
      async () => new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 })
    );
    expect(outage.statusCode).toBe(503);
    expect(outage.body.error.details.buildHint).toBeUndefined();
  });

  it("correctly complements minus-strand VEP allele_string to forward-strand genomicCoordinates (e.g. NAE1)", async () => {
    const nae1Consequence = {
      transcript_id: "ENST00000290810",
      canonical: 1,
      hgvsp: "ENSP00000290810.3:p.Asp116Gly",
      amino_acids: "D/G",
      uniprot_isoform: ["Q13564-1"],
      gene_symbol: "NAE1",
      swissprot: ["Q13564.1"],
      hgvsc: "ENST00000290810.8:c.347A>G",
    };

    const nae1Vep = async () =>
      new Response(
        JSON.stringify([
          {
            seq_region_name: "16",
            start: 66823281,
            strand: -1,
            allele_string: "A/G",
            assembly_name: "GRCh38",
            transcript_consequences: [nae1Consequence],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const result = await invokeTranslate("ENST00000290810:c.347A>G", nae1Consequence, nae1Vep);
    expect(result.statusCode).toBe(200);
    // cDNA input has no genomic locus of its own, so it takes the provider echo.
    // Forward strand GRCh38 genomic coordinate is 16-66823281-T-C (A->T, G->C).
    expect(result.body.genomicCoordinates).toBe("16-66823281-T-C");
  });
});

/**
 * Transcript versions. RefSeq: VariantValidator holds every version's sequence and resolves the
 * stated one, so the answer stands and the reader is told a newer version exists. Ensembl: a retired
 * version's sequence is not served anywhere, so the failure is explained and the current-version
 * notation OFFERED — never substituted, because its numbering cannot be checked.
 */
describe("POST /translate-variant — transcript versions", () => {
  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
  });

  const vep400 = { ok: false, status: 400, json: async () => ({ error: "Could not get a Transcript object" }), text: async () => "Could not get a Transcript object" } as any;

  it("tells the reader a newer RefSeq version exists when VariantValidator resolved the stated one", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("rest.ensembl.org")
        ? vep400
        : ({
            ok: true,
            status: 200,
            json: async () => ({
              "NM_018202.5:c.1297G>A": {
                gene_symbol: "MACO1",
                hgvs_predicted_protein_consequence: { tlr: "NP_060672.2:p.(Glu433Lys)" },
                annotations: { chromosome: "1", mane_select: false, ensembl_select: false },
                primary_assembly_loci: { grch38: { vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" } } },
                validation_warnings: [
                  "TranscriptVersionWarning: A more recent version of the selected reference sequence NM_018202.5 is available for genome build GRCh38 (NM_018202.6)",
                ],
              },
            }),
            text: async () => "",
          } as any);

    const { statusCode, body } = await invokeTranslate("NM_018202.5:c.1297G>A", MISSENSE_CONSEQUENCE, fetchImpl);

    expect(statusCode).toBe(200);
    expect(body.variant).toBe("p.Glu433Lys");
    expect(body.transcriptVersionNote).toContain("(NM_018202.6)");
    // Shown where transcript caveats are shown, ahead of the others.
    expect(body.transcriptWarning).toMatch(/^A more recent version .*\(NM_018202\.6\)\. Resolved on the version you entered\./);
    expect(translateVariantResponseSchema.safeParse(body).success).toBe(true);
  });

  it("explains a retired Ensembl version and offers the current one instead of 'verify the build'", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/lookup/id/ENST00000646891")) {
        return { ok: true, status: 200, json: async () => ({ id: "ENST00000646891", version: 2 }) } as any;
      }
      // Neither provider knows the retired version (live: both end the ladder as "not found").
      return vep400;
    };

    const { statusCode, body, headers } = await invokeTranslate("ENST00000646891.1:c.1799T>A", MISSENSE_CONSEQUENCE, fetchImpl);

    expect(statusCode).toBe(422);
    // A request-side answer: no provider cooldown that would tell the client to wait and retry.
    expect(headers["Retry-After"]).toBeUndefined();
    expect(body.error.code ?? body.code).toBe("TRANSCRIPT_VERSION_RETIRED");
    const message = body.error?.message ?? body.message;
    expect(message).toContain("ENST00000646891.1 is not in the current Ensembl release");
    expect(message).toContain("ENST00000646891.2:c.1799T>A");
    expect(JSON.stringify(body)).toContain('"candidates":["ENST00000646891.2:c.1799T>A"]');
  });
});

/**
 * Multi-base dashed / VCF alleles. `GAG>A` is not HGVS; written as the delins it is, an indel is
 * refused as non-missense (with the scope note) and an equal-length codon-scale change reaches VEP.
 */
describe("POST /translate-variant — multi-base delimited alleles", () => {
  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
  });

  it("refuses a VCF deletion row as non-missense instead of a format error", async () => {
    const { statusCode, body } = await invokeTranslate("20 23365054 . GAG A");
    expect(statusCode).toBe(422);
    expect(JSON.stringify(body)).toContain("NON_MISSENSE_VARIANT");
  });

  it("sends an equal-length 2 bp change to VEP as an in-frame delins", async () => {
    const { calledUrls } = await invokeTranslate("7-140753335-CA-TT");
    expect(calledUrls.some((u: string) => u.includes("/vep/human/hgvs/chr7:g.140753335_140753336delinsTT"))).toBe(true);
  });

  it("still sends a single-base row as a substitution", async () => {
    const { calledUrls } = await invokeTranslate("chr1 25484258 . G A");
    expect(calledUrls.some((u: string) => u.includes("/vep/human/hgvs/chr1:g.25484258G>A"))).toBe(true);
  });

  it("recognises a retired Ensembl version written with a build annotation", async () => {
    const vep400 = { ok: false, status: 400, json: async () => ({ error: "x" }), text: async () => "x" } as any;
    const { statusCode, body } = await invokeTranslate("ENST00000646891.1(GRCh38):c.1799T>A", MISSENSE_CONSEQUENCE, async (url: string) =>
      url.includes("/lookup/id/ENST00000646891")
        ? ({ ok: true, status: 200, json: async () => ({ id: "ENST00000646891", version: 2 }) } as any)
        : vep400
    );
    expect(statusCode).toBe(422);
    expect(JSON.stringify(body)).toContain("ENST00000646891.2:c.1799T>A");
  });
});
