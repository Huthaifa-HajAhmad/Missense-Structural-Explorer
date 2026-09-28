import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_RESOLUTION_BUDGET_MS,
  ENSEMBL_VEP_TIMEOUT_MS,
  computeRungWindowMs,
  resolveCoordinate,
  buildResolutionUnavailableMessage,
} from "./coordinate-resolver.ts";
import { resolutionFailureToHttp } from "./types.ts";
import { CoordinateResolutionError, isReferenceMismatchMessage } from "./types.ts";
import { clearAllCaches } from "../infra/cache.ts";
import { resetHostStateForTests } from "../infra/http-client.ts";

const NOTATION = "chr1:g.25484258G>A";

/**
 * Canonically-numbered consequence: `uniprot_isoform` matching the reported accession is what
 * makes the numbering verifiable, and therefore what makes a resolution cacheable. Without it
 * the answer is `unverified` and deliberately NOT cached (see the cache tests below).
 */
const VEP_PAYLOAD = [
  {
    seq_region_name: "1",
    start: 25484258,
    allele_string: "G/A",
    transcript_consequences: [
      {
        transcript_id: "ENST00000374343",
        canonical: 1,
        hgvsp: "ENSP00000363463.4:p.Glu433Lys",
        amino_acids: "E/K",
        uniprot_isoform: ["Q8N5G2-1"],
        gene_symbol: "MACO1",
        swissprot: ["Q8N5G2.1"],
      },
    ],
  },
];

/** Non-coding consequences only: no HGVSp anywhere, so no rung can serve a protein target. */
const VEP_INTRONIC_PAYLOAD = [
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
];

const VV_PAYLOAD = {
  "NM_018202.6:c.1297G>A": {
    gene_symbol: "MACO1",
    hgvs_predicted_protein_consequence: { tlr: "NP_060672.2:p.(Glu433Lys)" },
    annotations: { chromosome: "1", mane_select: true, ensembl_select: false },
    primary_assembly_loci: { grch38: { vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" } } },
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

/** A provider that never answers and honours the abort its window eventually sends. */
const hangingFetch = (_url: any, init: any) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  }) as any;

describe("coordinate-resolver provider ladder", () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAllCaches(true);
    // Breakers and semaphores are module-global per host; without this a suite that drives a
    // host to its failure threshold leaves the breaker open for later tests (and files).
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("resolves via Ensembl VEP when the primary provider is healthy", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(VEP_PAYLOAD));

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.consequence.provider).toBe("ensembl-vep");
    expect(outcome.consequence.transcript_consequences[0].hgvsp).toBe("ENSP00000363463.4:p.Glu433Lys");
    expect(outcome.usedFallback).toBe(false);
    expect(outcome.cacheHit).toBe(false);
    expect(outcome.proteinChangeFound).toBe(true);
    expect(outcome.numbering?.status).toBe("canonical");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("rest.ensembl.org");
  });

  it("fails over to VariantValidator when Ensembl VEP rejects the request", async () => {
    // 400 is not retried by fetchWithRetry, so failover is immediate and deterministic.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) =>
      String(url).includes("rest.ensembl.org")
        ? jsonResponse({ error: "reference allele mismatch" }, 400)
        : jsonResponse(VV_PAYLOAD)
    );

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.consequence.provider).toBe("variant-validator");
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.consequence.transcript_consequences[0].gene_symbol).toBe("MACO1");
    expect(outcome.consequence.transcript_consequences[0].hgvsp).toBe("p.(Glu433Lys)");

    // The attempt trail must record BOTH providers for auditability.
    expect(outcome.attempts.map((a) => a.provider)).toEqual(["ensembl-vep", "variant-validator"]);
    expect(outcome.attempts[0].ok).toBe(false);
    expect(outcome.attempts[1].ok).toBe(true);
  });

  it("serves a repeat query from cache without contacting any provider", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(VEP_PAYLOAD));

    const first = await resolveCoordinate(NOTATION, "GRCh38");
    const second = await resolveCoordinate(NOTATION, "GRCh38");

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.consequence.provider).toBe("ensembl-vep");
    expect(second.numbering?.status).toBe("canonical");
    expect(second.attempts).toEqual([
      { provider: "ensembl-vep", ok: true, durationMs: 0, reason: "cache_hit" },
    ]);
    // The immutable mapping must not have triggered a second network call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * A review found the previous cache policy stored an UNVERIFIED numbering for ten years: the
   * VariantValidator tier reports no UniProt accession, so its answers were cached and re-served
   * as settled truth long after the primary provider (which carries the isoform metadata) had
   * recovered — pinning the ACOT9 mis-numbering in place.
   */
  it("does not cache an answer whose numbering could not be verified", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) =>
      String(url).includes("rest.ensembl.org")
        ? jsonResponse({ error: "reference allele mismatch" }, 400)
        : jsonResponse(VV_PAYLOAD)
    );

    const first = await resolveCoordinate(NOTATION, "GRCh38");
    expect(first.usedFallback).toBe(true);
    expect(first.numbering?.status).toBe("unverified");

    const second = await resolveCoordinate(NOTATION, "GRCh38");
    // Re-resolved, not served from cache: the answer can improve once VEP is reachable again.
    expect(second.cacheHit).toBe(false);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(2);
  });

  it("keys the cache by assembly so GRCh37 and GRCh38 never collide", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(VEP_PAYLOAD));

    await resolveCoordinate(NOTATION, "GRCh38");
    await resolveCoordinate(NOTATION, "GRCh37");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toContain("grch37.rest.ensembl.org");
  });

  it("does not cache failures, so an outage cannot poison the mapping", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () =>
      jsonResponse({ error: "bad request" }, 400)
    );

    await expect(resolveCoordinate(NOTATION, "GRCh38")).rejects.toBeInstanceOf(CoordinateResolutionError);
    const callsAfterFailure = fetchSpy.mock.calls.length;

    // A second attempt must hit the network again (a cached failure would show 0 new calls).
    await expect(resolveCoordinate(NOTATION, "GRCh38")).rejects.toBeInstanceOf(CoordinateResolutionError);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFailure);
  });

  it("reports an unreachable provider as upstream_unavailable within the budget", async () => {
    // Never-resolving fetch: the ladder's deadline must abort it rather than hang.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(hangingFetch);

    const error: any = await resolveCoordinate(NOTATION, "GRCh38", undefined, { budgetMs: 300 }).catch((e) => e);

    expect(error).toBeInstanceOf(CoordinateResolutionError);
    expect(error.kind).toBe("upstream_unavailable");
    // The message must tell the clinician what to do instead.
    expect(error.message).toContain("p.Glu433Lys");
    expect(error.message).toContain("temporarily unavailable");
    expect(error.attempts.length).toBeGreaterThan(0);
  });

  /**
   * Regression: the ladder handed its WHOLE budget to the primary provider, so an Ensembl VEP
   * that was slow (rather than failing fast) consumed all of it and the loop broke before
   * VariantValidator was ever called. Clinicians were told "all reference providers are
   * unreachable" for a primary-only problem.
   */
  it("still attempts the fallback when the primary hangs instead of failing", async () => {
    const vepCalls: string[] = [];
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation((url: any, init: any) => {
      if (String(url).includes("rest.ensembl.org")) {
        vepCalls.push(String(url));
        return hangingFetch(url, init);
      }
      return Promise.resolve(jsonResponse(VV_PAYLOAD));
    });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38", undefined, { budgetMs: 800 });

    // The fallback must have produced the answer.
    expect(outcome.consequence.provider).toBe("variant-validator");
    expect(outcome.usedFallback).toBe(true);
    expect(vepCalls.length).toBeGreaterThan(0);

    // Both rungs appear in the audit trail: the primary timed out on its share of the budget,
    // it was not skipped.
    expect(outcome.attempts.map((a) => a.provider)).toEqual(["ensembl-vep", "variant-validator"]);
    expect(outcome.attempts[0].ok).toBe(false);
    expect(outcome.attempts[0].reason).toContain("share of the resolution budget");
    expect(outcome.attempts[1].ok).toBe(true);
  });

  it("preserves negative strand from Ensembl VEP response", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () =>
      jsonResponse([
        {
          seq_region_name: "16",
          start: 66823281,
          strand: -1,
          allele_string: "A/G",
          transcript_consequences: [
            {
              transcript_id: "ENST00000290810",
              canonical: 1,
              hgvsp: "ENSP00000290810.3:p.Asp116Gly",
              amino_acids: "D/G",
              uniprot_isoform: ["Q13564-1"],
              gene_symbol: "NAE1",
              swissprot: ["Q13564.1"],
            },
          ],
        },
      ])
    );

    const outcome = await resolveCoordinate("ENST00000290810:c.347A>G", "GRCh38");
    expect(outcome.consequence.provider).toBe("ensembl-vep");
    expect(outcome.consequence.strand).toBe(-1);
    expect(outcome.consequence.seq_region_name).toBe("16");
    expect(outcome.consequence.start).toBe(66823281);
    expect(outcome.consequence.allele_string).toBe("A/G");
  });

  it("gives every remaining rung a positive window even on a tiny budget", async () => {
    // Before the split, the primary consumed this entire budget and the fallback was never
    // reached; now each rung gets a share, so both are attempted — and the assertions below
    // reject a run in which a rung was merely recorded as SKIPPED (durationMs 0).
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(hangingFetch);

    const error: any = await resolveCoordinate(NOTATION, "GRCh38", undefined, { budgetMs: 200 }).catch((e) => e);

    expect(error).toBeInstanceOf(CoordinateResolutionError);
    expect(error.attempts.map((a: any) => a.provider)).toEqual(["ensembl-vep", "variant-validator"]);
    expect(error.attempts.every((a: any) => a.durationMs > 0)).toBe(true);
    expect(error.attempts.every((a: any) => !String(a.reason).startsWith("skipped"))).toBe(true);
  });

  it("records WHY a rung was never tried when the budget is already spent", async () => {    // A budget this small leaves no window for any rung. The trail must SAY so rather than being
    // empty: an empty trail made `classifyTotalFailure` report an outage that named neither a
    // provider nor an attempt, which is precisely how the earlier "all providers unreachable"
    // message came to be printed for a problem that was our own arithmetic.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(hangingFetch);

    const error: any = await resolveCoordinate(NOTATION, "GRCh38", undefined, { budgetMs: 1 }).catch((e) => e);

    expect(error).toBeInstanceOf(CoordinateResolutionError);
    expect(error.attempts.length).toBeGreaterThan(0);
    // Which budget-related reason appears depends on where the 1ms lands (window skipped, tried and
    // capped, or already spent) — the INVARIANT is that no rung is dropped silently and every
    // reason names the budget rather than blaming a provider.
    for (const attempt of error.attempts) {
      expect(String(attempt.reason)).toMatch(/budget/);
    }
  });

  /**
   * The budget must be able to fit one full attempt at EVERY rung's own tolerance, or a rung is
   * killed by arithmetic rather than by the provider being slow. A review found the previous
   * 25s split (12.5s per rung) was smaller than every provider's 15s timeout, so the window —
   * not the provider — was always the binding constraint.
   *
   * Superseded by reservations: each later rung that CAN answer keeps its tolerance, and the current
   * one borrows the remainder. The even share is now only a floor for budgets too small to reserve.
   */
  it("reserves a healthy fallback's tolerance for it, and gives the primary the remainder", () => {
    const budget = DEFAULT_RESOLUTION_BUDGET_MS;
    const fallbackTolerance = 15_000;

    // Healthy fallback: the primary gets everything except the fallback's tolerance (and never less
    // than an even share).
    expect(
      computeRungWindowMs({ remainingMs: budget, providersLeft: 2, reservedForLaterRungs: fallbackTolerance })
    ).toBe(budget - fallbackTolerance);
    expect(budget - fallbackTolerance).toBeGreaterThanOrEqual(budget / 2);

    // Fallback breaker OPEN (the production case): nothing is reserved for a request that would fail
    // instantly, so the provider that can actually answer gets the whole window.
    expect(
      computeRungWindowMs({ remainingMs: budget, providersLeft: 2, reservedForLaterRungs: 0 })
    ).toBe(budget);

    // A budget too small to reserve still grants an even share to every rung.
    expect(
      computeRungWindowMs({ remainingMs: 200, providersLeft: 2, reservedForLaterRungs: fallbackTolerance })
    ).toBe(100);
  });

  /**
   * Regression: the ladder's own window abort was booked as an upstream failure, so five
   * slow-but-served resolutions ejected a healthy provider on the shared circuit breaker for
   * the whole cooldown, pushing every later request onto the fallback tier.
   */
  it("does not trip the circuit breaker when a provider misses its window", async () => {
    let vepAnswersInstantly = false;
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation((url: any, init: any) => {
      if (String(url).includes("rest.ensembl.org")) {
        return vepAnswersInstantly
          ? Promise.resolve(jsonResponse(VEP_PAYLOAD))
          : hangingFetch(url, init);
      }
      return Promise.resolve(jsonResponse(VV_PAYLOAD));
    });

    // Six consecutive resolutions where the primary misses its window every time.
    for (let i = 0; i < 6; i++) {
      clearAllCaches(true);
      const outcome = await resolveCoordinate(NOTATION, "GRCh38", undefined, { budgetMs: 200 });
      expect(outcome.consequence.provider).toBe("variant-validator");
    }

    // The primary is healthy again and MUST still be consulted (an open breaker would skip it).
    clearAllCaches(true);
    vepAnswersInstantly = true;
    const recovered = await resolveCoordinate(NOTATION, "GRCh38", undefined, { budgetMs: 400 });

    expect(recovered.consequence.provider).toBe("ensembl-vep");
    expect(recovered.attempts[0].provider).toBe("ensembl-vep");
    expect(recovered.attempts[0].ok).toBe(true);
  });

  /**
   * Regression: a provider that maps the coordinate only to non-coding consequences was treated
   * as having ANSWERED, so the ladder stopped and the user got a 422 asserting no protein change
   * exists — without the fallback ever being asked, even though its annotation release may
   * number the coordinate.
   */
  it("keeps asking the ladder when a provider reports no protein change", async () => {
    const calls: string[] = [];
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const target = String(url);
      calls.push(target);
      return target.includes("rest.ensembl.org")
        ? jsonResponse(VEP_INTRONIC_PAYLOAD)
        : jsonResponse(VV_PAYLOAD);
    });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(calls.some((u) => u.includes("rest.ensembl.org"))).toBe(true);
    expect(calls.some((u) => u.includes("variantvalidator.org"))).toBe(true);
    expect(outcome.proteinChangeFound).toBe(true);
    expect(outcome.consequence.provider).toBe("variant-validator");
    // The miss is recorded rather than reported as a provider failure.
    expect(outcome.attempts[0].reason).toBe("no protein-altering consequence reported");
  });

  it("returns the informative payload once EVERY rung reports no protein change", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) =>
      String(url).includes("rest.ensembl.org")
        ? jsonResponse(VEP_INTRONIC_PAYLOAD)
        : jsonResponse({ error: "not a transcript envelope" }, 400)
    );

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.proteinChangeFound).toBe(false);
    expect(outcome.numbering).toBeUndefined();
    expect(outcome.consequence.transcript_consequences[0].consequence_terms).toEqual(["intron_variant"]);
  });

  it("reports a MIXED failure as unusable-provider, not as 'nothing found anywhere'", async () => {
    // One provider says "nothing here"; the other returns something unusable. Claiming no
    // transcript consequence exists in ANY provider would be false.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) =>
      String(url).includes("rest.ensembl.org")
        ? jsonResponse({ not: "a vep array" }, 200)
        : jsonResponse({ error: "not a transcript envelope" }, 400)
    );

    const error: any = await resolveCoordinate(NOTATION, "GRCh38").catch((e) => e);

    expect(error).toBeInstanceOf(CoordinateResolutionError);
    expect(error.kind).toBe("invalid_response");
    expect(error.message).toContain("unusable responses");
  });
});

/**
 * Repairing the metadata Ensembl's GRCh37 archive omits.
 *
 * Production regression, `Chr1(GRCh37):g.1256452C>A`. That archive answers VEP with:
 *   - `swissprot: ["INT11_HUMAN"]` — the entry NAME, where the GRCh38 host gives `Q5TA45.162`;
 *   - `gene_symbol: "CPSF3L"` — the RETIRED symbol (now `INTS11`);
 *   - no `uniprot_isoform` at all, and `canonical: 1` on `ENST00000540437`, which is numbered on
 *     isoform `Q5TA45-5` (`p.Arg23Leu`) — NOT on canonical `Q5TA45`, where position 23 is `S`.
 *
 * Three failures followed from that one payload shape: `422 Invalid UniProt accession ID format:
 * "INT11_HUMAN"` for a perfectly resolved coordinate; the analysis refusing `p.Arg23Leu` with a
 * wild-type mismatch (or, had the letters coincided, modelling the wrong residue); and every
 * gene-keyed lookup downstream being handed the retired symbol. UniProt states all three facts, so
 * the payload is repaired from the entry rather than guessed at.
 */
describe("coordinate-resolver — GRCh37 archive payload repair", () => {
  let fetchSpy: any;

  /** The real GRCh37 answer for that locus, trimmed to the two consequences that matter. */
  const GRCH37_PAYLOAD = [
    {
      seq_region_name: "1",
      start: 1256452,
      allele_string: "C/A",
      assembly_name: "GRCh37",
      transcript_consequences: [
        {
          // The archive's own canonical transcript, numbered on isoform Q5TA45-5.
          transcript_id: "ENST00000540437",
          canonical: 1,
          consequence_terms: ["missense_variant"],
          hgvsp: "ENSP00000445001.1:p.Arg23Leu",
          amino_acids: "R/L",
          gene_symbol: "CPSF3L",
          swissprot: ["INT11_HUMAN"],
        },
        {
          // Same substitution, numbered on the CANONICAL isoform — unmarked by this release.
          transcript_id: "ENST00000435064",
          consequence_terms: ["missense_variant"],
          hgvsp: "ENSP00000413493.2:p.Arg17Leu",
          amino_acids: "R/L",
          gene_symbol: "CPSF3L",
          swissprot: ["INT11_HUMAN"],
        },
      ],
    },
  ];

  /** The entry-name search answer (`INT11_HUMAN` -> `Q5TA45`). */
  const ENTRY_NAME_HIT = {
    results: [{ primaryAccession: "Q5TA45", uniProtkbId: "INT11_HUMAN" }],
  };

  /** `GET /uniprotkb/Q5TA45.json?fields=xref_ensembl,gene_primary,gene_synonym`, verbatim. */
  const ENTRY_REFERENCE = {
    genes: [{ geneName: { value: "INTS11" }, synonyms: [{ value: "CPSF3L" }, { value: "RC68" }] }],
    uniProtKBCrossReferences: [
      {
        database: "Ensembl",
        id: "ENST00000419704.5",
        properties: [{ key: "ProteinId", value: "ENSP00000404886.1" }],
        isoformId: "Q5TA45-2",
      },
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

  /** Routes each upstream by host: the VEP payload, the entry-name search, or the entry itself. */
  const providerFetch = (overrides: { entryName?: any; entry?: any } = {}) =>
    async (url: any) => {
      const target = String(url);
      if (target.includes("rest.uniprot.org")) {
        if (target.includes("/search?")) {
          return overrides.entryName ?? jsonResponse(ENTRY_NAME_HIT);
        }
        return overrides.entry ?? jsonResponse(ENTRY_REFERENCE);
      }
      return jsonResponse(GRCH37_PAYLOAD);
    };

  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("remaps onto canonical numbering once UniProt states the isoform the provider left out", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(providerFetch());

    const outcome = await resolveCoordinate("chr1:g.1256452C>A", "GRCh37");
    const verdict = outcome.numbering!;

    expect(verdict.status).toBe("remapped");
    expect(verdict.canonicalAccession).toBe("Q5TA45");
    // Canonical numbering, the only sequence AlphaFold DB / PDB can model.
    expect(verdict.consequence.hgvsp).toBe("ENSP00000413493.2:p.Arg17Leu");
    expect(verdict.consequence.transcript_id).toBe("ENST00000435064");
    expect(verdict.numberingIsoform).toBe("Q5TA45-1");
    expect(verdict.fromIsoform).toBe("Q5TA45-5");

    // The retired symbol is replaced everywhere in the payload, and the swap is recorded.
    const symbols = outcome.consequence.transcript_consequences.map((tc) => tc.gene_symbol);
    expect(symbols).toEqual(["INTS11", "INTS11"]);
    expect(outcome.consequence.geneSymbolUpdated).toEqual({ from: "CPSF3L", to: "INTS11" });

    // Entry name -> accession, then the entry. Both are UniProt, and both are cached.
    const urls = fetchSpy.mock.calls.map((call: any[]) => String(call[0]));
    expect(urls.some((u: string) => u.includes("grch37.rest.ensembl.org"))).toBe(true);
    expect(urls.some((u: string) => u.includes("/search?"))).toBe(true);
    expect(urls.some((u: string) => u.includes("Q5TA45.json"))).toBe(true);
  });

  it("leaves the provider's own isoform metadata authoritative when it is present", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(VEP_PAYLOAD));

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("canonical");
    expect(outcome.consequence.geneSymbolUpdated).toBeUndefined();
    // One call: a payload that declares its isoform costs no enrichment lookup at all.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("rest.ensembl.org");
  });

  /**
   * The accession is METADATA. A UniProt outage may cost it (the client resolves gene -> UniProt
   * itself), but it must never fail a coordinate that the reference provider resolved.
   */
  it("keeps the resolution, unenriched, when the entry-name lookup fails", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      providerFetch({
        entryName: jsonResponse({ error: "service unavailable" }, 503),
      })
    );

    const outcome = await resolveCoordinate("chr1:g.1256452C>A", "GRCh37", undefined, {
      budgetMs: 4000,
    });

    expect(outcome.proteinChangeFound).toBe(true);
    expect(outcome.consequence.transcript_consequences[0].hgvsp).toBe(
      "ENSP00000445001.1:p.Arg23Leu"
    );
    // Never forwarded: a non-accession is what broke the request.
    expect(outcome.consequence.transcript_consequences[0].swissprot).toEqual([]);
    expect(outcome.numbering?.status).toBe("unverified");
    expect(outcome.numbering?.canonicalAccession).toBeUndefined();
    expect(outcome.consequence.transcript_consequences[0].gene_symbol).toBe("CPSF3L");
  });

  /**
   * A UniProt failure while reading the entry must leave today's honest disclosure in place — never
   * a fabricated numbering basis, and never a failed request.
   */
  it("keeps the numbering unverified when the entry lookup itself fails", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      providerFetch({ entry: jsonResponse({ error: "service unavailable" }, 503) })
    );

    const outcome = await resolveCoordinate("chr1:g.1256452C>A", "GRCh37", undefined, {
      budgetMs: 4000,
    });

    expect(outcome.numbering?.status).toBe("unverified");
    expect(outcome.numbering?.canonicalAccession).toBe("Q5TA45");
    expect(outcome.consequence.transcript_consequences[0].gene_symbol).toBe("CPSF3L");
  });

  /**
   * The proof is the isoform ID, not a position guess. When the payload offers no transcript UniProt
   * places on the canonical isoform, the numbering is known to be non-canonical but not convertible
   * here — the verdict says so instead of forwarding numbers the analysis must reject.
   */
  it("reports the basis as unsupported when no canonical-numbered sibling exists", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) =>
      String(url).includes("rest.uniprot.org")
        ? String(url).includes("/search?")
          ? jsonResponse(ENTRY_NAME_HIT)
          : jsonResponse(ENTRY_REFERENCE)
        : jsonResponse([{ ...GRCH37_PAYLOAD[0], transcript_consequences: [GRCH37_PAYLOAD[0].transcript_consequences[0]] }])
    );

    const outcome = await resolveCoordinate("chr1:g.1256452C>A", "GRCh37");

    expect(outcome.numbering?.status).toBe("unsupported");
    expect(outcome.numbering?.numberingIsoform).toBe("Q5TA45-5");
    expect(outcome.numbering?.canonicalAccession).toBe("Q5TA45");
  });

  /**
   * A symbol UniProt does not list for this entry is NOT this entry's retired name: rewriting it
   * would attribute the payload to the wrong gene, so it is left exactly as reported.
   */
  it("never renames a gene symbol UniProt does not list for the entry", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) =>
      String(url).includes("rest.uniprot.org")
        ? String(url).includes("/search?")
          ? jsonResponse(ENTRY_NAME_HIT)
          : jsonResponse({
              ...ENTRY_REFERENCE,
              genes: [{ geneName: { value: "INTS11" }, synonyms: [{ value: "RC68" }] }],
            })
        : jsonResponse(GRCH37_PAYLOAD)
    );

    const outcome = await resolveCoordinate("chr1:g.1256452C>A", "GRCh37");

    expect(outcome.consequence.transcript_consequences[0].gene_symbol).toBe("CPSF3L");
    expect(outcome.consequence.geneSymbolUpdated).toBeUndefined();
    // The isoform annotation still lands: the two repairs are independent.
    expect(outcome.numbering?.status).toBe("remapped");
  });

  /**
   * The repair is per ENTRY NAME, and a real VEP answer carries MORE THAN ONE.
   *
   * The live GRCh37 payload has 40 consequences, and the locus is upstream of the neighbouring
   * gene CPTP: its canonical transcript (`ENST00000343938`, retired symbol `GLTPD1`) reports
   * `swissprot: ["CPTP_HUMAN"]` — a second entry name, on a gene that is NOT the one being
   * analysed. The trimmed two-consequence fixture used above therefore could not reach this: the
   * entry-name lookup was effectively "one name, one accession", and a payload where only the
   * FIRST name is converted leaves `CPTP_HUMAN` in the row list — where `validateUniProt`
   * (`/^[A-Z0-9]{6,10}$/` style checks downstream) rejects it, and where the retired symbol would
   * also be attributed to the wrong UniProt entry had the rename been driven by position or by the
   * first row rather than by UniProt's own gene list for the SELECTED entry.
   *
   * Pins all three halves: EVERY entry name in the payload is converted (no `_HUMAN` survives
   * anywhere), the neighbouring gene's symbol is left ALONE (UniProt lists it for a DIFFERENT
   * entry, so this entry's current symbol must not be stamped onto it), and one lookup is made per
   * distinct name — not one per payload.
   */
  it("converts every entry name in a multi-gene payload, and renames only the selected entry's gene", async () => {
    /** The real archive answer, trimmed to the two INTS11 rows plus the neighbouring CPTP row. */
    const MULTI_GENE_PAYLOAD = [
      {
        seq_region_name: "1",
        start: 1256452,
        allele_string: "C/A",
        assembly_name: "GRCh37",
        transcript_consequences: [
          {
            // The archive's own canonical transcript, numbered on isoform Q5TA45-5.
            transcript_id: "ENST00000540437",
            canonical: 1,
            consequence_terms: ["missense_variant"],
            hgvsp: "ENSP00000445001.1:p.Arg23Leu",
            amino_acids: "R/L",
            gene_symbol: "CPSF3L",
            swissprot: ["INT11_HUMAN"],
          },
          {
            // Same substitution, numbered on the CANONICAL isoform — unmarked by this release.
            transcript_id: "ENST00000435064",
            consequence_terms: ["missense_variant"],
            hgvsp: "ENSP00000413493.2:p.Arg17Leu",
            amino_acids: "R/L",
            gene_symbol: "CPSF3L",
            swissprot: ["INT11_HUMAN"],
          },
          {
            // Neighbouring gene CPTP (retired symbol GLTPD1): a DIFFERENT UniProt entry, and the
            // locus is merely upstream of it, so its row carries no protein consequence.
            transcript_id: "ENST00000343938",
            canonical: 1,
            consequence_terms: ["upstream_gene_variant"],
            gene_symbol: "GLTPD1",
            swissprot: ["CPTP_HUMAN"],
          },
        ],
      },
    ];

    /** Two REAL name→accession answers (`GET /uniprotkb/search?query=id:<name>`). */
    const nameToAccession: Record<string, string> = {
      INT11_HUMAN: "Q5TA45",
      CPTP_HUMAN: "Q5TA50",
    };

    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const target = String(url);
      if (target.includes("rest.uniprot.org")) {
        if (target.includes("/search?")) {
          const name = Object.keys(nameToAccession).find((key) => target.includes(key));
          return name
            ? jsonResponse({
                results: [{ primaryAccession: nameToAccession[name], uniProtkbId: name }],
              })
            : jsonResponse({ results: [] });
        }
        return jsonResponse(ENTRY_REFERENCE);
      }
      return jsonResponse(MULTI_GENE_PAYLOAD);
    });

    const outcome = await resolveCoordinate("chr1:g.1256452C>A", "GRCh37");
    const rows = outcome.consequence.transcript_consequences;

    // NOTHING mnemonic survives anywhere in the payload.
    expect(JSON.stringify(outcome.consequence)).not.toContain("_HUMAN");
    expect(rows[0].swissprot).toEqual(["Q5TA45"]);
    expect(rows[1].swissprot).toEqual(["Q5TA45"]);
    // The neighbouring gene's row is repaired too — it is part of the same payload.
    expect(rows[2].swissprot).toEqual(["Q5TA50"]);

    // …but only the SELECTED entry's gene is renamed: GLTPD1 belongs to Q5TA50, not to Q5TA45.
    expect(rows[0].gene_symbol).toBe("INTS11");
    expect(rows[1].gene_symbol).toBe("INTS11");
    expect(rows[2].gene_symbol).toBe("GLTPD1");
    expect(outcome.consequence.geneSymbolUpdated).toEqual({ from: "CPSF3L", to: "INTS11" });

    // The numbering repair is unchanged by the neighbouring row.
    expect(outcome.numbering?.status).toBe("remapped");
    expect(outcome.numbering?.consequence.hgvsp).toBe("ENSP00000413493.2:p.Arg17Leu");

    // ONE lookup per DISTINCT entry name — two names, two lookups, however many rows report them.
    const searches = fetchSpy.mock.calls
      .map((call: any[]) => decodeURIComponent(String(call[0])))
      .filter((url: string) => url.includes("/search?"));
    expect(searches).toHaveLength(2);
    expect(searches.some((url: string) => url.includes("id:INT11_HUMAN"))).toBe(true);
    expect(searches.some((url: string) => url.includes("id:CPTP_HUMAN"))).toBe(true);
  });
});

describe("buildResolutionUnavailableMessage", () => {
  it("keeps messages free of strings that the 5xx sanitizer would rewrite", () => {
    // `sendError` rewrites any status>=500 message containing words like "fetch"/"upstream".
    // Embedding raw provider reasons would silently replace this actionable guidance.
    //
    // `reference_mismatch` is deliberately NOT in this list: it maps to 422, and the sanitiser only
    // runs for status >= 500. Listing it here read as coverage that does not exist.
    for (const kind of ["upstream_unavailable", "invalid_response", "not_found"] as const) {
      const message = buildResolutionUnavailableMessage(kind);
      expect(message).not.toMatch(/fetch|upstream|rate limit|ENOENT|spawn/i);
    }
  });

  /**
   * The one failure whose remedy is a different COORDINATE.
   *
   * It must (a) be a 422 with its own code, so a client can act on it rather than retry, and (b) say
   * what the reader has to change. The status matters as much as the words: reported as 502 it invited
   * a retry that could never succeed, and the build remedy stayed invisible.
   */
  it("reports a reference-allele mismatch as a 422 about the coordinate, not as a degraded provider", () => {
    const { status, code } = resolutionFailureToHttp("reference_mismatch");
    expect(status).toBe(422);
    expect(code).toBe("COORDINATE_REFERENCE_MISMATCH");

    const message = buildResolutionUnavailableMessage("reference_mismatch");
    expect(message).toContain("genome-build mismatch");
    expect(message).toContain("Chr1(GRCh37):g.1256452C>A");
    // Not a temporary condition, so it must not borrow the outage vocabulary.
    expect(message).not.toContain("retry in a minute");
    expect(message).not.toContain("degraded");
  });

  /**
   * …and it survives a ladder where the OTHER rung says something else.
   *
   * VEP refuses the allele while VariantValidator answers a payload with no protein change
   * (`not_found`). Both are true, but only one tells the reader what to do, and this platform has
   * already been here: `not_found` produced "verify the chromosome, position, alleles and genome
   * build" without ever saying that the build WAS the problem.
   */
  it("prefers a stated reference mismatch over another rung's not-found", async () => {
    clearAllCaches(true);
    resetHostStateForTests();
    const localSpy = vi.spyOn(global, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      // The fallback answers an envelope with no usable payload: classified `not_found`.
      if (url.includes("variantvalidator")) {
        return new Response(JSON.stringify({ flag: "no transcript consequence" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ error: "Reference allele does not match the reference sequence at 1:25484258" }),
        { status: 400 }
      );
    });

    try {
      const error: any = await resolveCoordinate(NOTATION, "GRCh38").catch((e) => e);

      expect(error).toBeInstanceOf(CoordinateResolutionError);
      expect(error.kind).toBe("reference_mismatch");
      expect(error.message).toContain("genome-build mismatch");
    } finally {
      localSpy.mockRestore();
      resetHostStateForTests();
    }
  });

  /**
   * …and it outranks a rate limit as well.
   *
   * The rate limit is about OUR request rate; the mismatch is about the coordinate, and it is the one
   * that tells the reader what to change. Answering "wait a minute" first costs a round trip to learn
   * a fact the ladder already had — and the 429 rung's body is never trusted for the mismatch either,
   * because a 429 is classified by STATUS before its text is read.
   */
  it("prefers a stated reference mismatch over another rung's rate limit", async () => {
    clearAllCaches(true);
    resetHostStateForTests();
    const localSpy = vi.spyOn(global, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes("variantvalidator")) {
        return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ error: "Reference allele does not match the reference sequence at 1:25484258" }),
        { status: 400 }
      );
    });

    try {
      const error: any = await resolveCoordinate(NOTATION, "GRCh38").catch((e) => e);

      expect(error.kind).toBe("reference_mismatch");
      // The rate-limited rung is still reported, so the operator can see why it did not answer.
      expect(error.attempts.some((a: any) => a.failureKind === "rate_limited")).toBe(true);
    } finally {
      localSpy.mockRestore();
      resetHostStateForTests();
    }
  });

  it("tells the user how to work around a total outage", () => {
    const message = buildResolutionUnavailableMessage("upstream_unavailable");
    expect(message).toContain("protein-level substitution");
    expect(message).toContain("p.Glu433Lys");
  });

  it("reports a rate limit as a rate limit, not as an outage", () => {
    // Diagnosed in production: VariantValidator answered HTTP 429 and Ensembl 500-for-everything
    // (including `/info/ping`, in ~90ms) while the message told the user every provider was
    // unreachable — pointing at a provider outage instead of at our own request rate.
    const message = buildResolutionUnavailableMessage("rate_limited", [
      {
        provider: "variant-validator",
        ok: false,
        durationMs: 5219,
        reason: "VariantValidator returned status 429",
        failureKind: "rate_limited",
      },
    ]);

    expect(message).toContain("rate-limiting");
    expect(message).toContain("protein-level substitution");
    // Still temporary and still retryable, so the client backs off rather than reporting a bug.
    expect(resolutionFailureToHttp("rate_limited").status).toBe(503);
  });

  it("classifies a ladder where every rung was rate-limited", async () => {
    clearAllCaches(true);
    resetHostStateForTests();
    const localSpy = vi.spyOn(global, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
      json: async () => ({ error: "rate limited" }),
      text: async () => "rate limited",
    }) as any);

    try {
      const error: any = await resolveCoordinate(NOTATION, "GRCh38").catch((e) => e);

      expect(error).toBeInstanceOf(CoordinateResolutionError);
      expect(error.kind).toBe("rate_limited");
      expect(error.message).toContain("rate-limiting");
    } finally {
      localSpy.mockRestore();
      resetHostStateForTests();
    }
  });

  it("asks for verification when the coordinate is genuinely absent", () => {
    const message = buildResolutionUnavailableMessage("not_found");
    expect(message).toContain("Verify the chromosome, position, alleles and genome build");
  });

  /**
   * Measured in production: a 503 told the user every provider was "unreachable" while Ensembl VEP was
   * reachable and serving, just taking 20-34s per query. The two situations need different words: a
   * slow service is fixed by retrying, an unreachable one is not.
   */
  it("distinguishes a too-slow provider from an unreachable one", () => {
    const slow = buildResolutionUnavailableMessage("upstream_unavailable", [
      { provider: "ensembl-vep", ok: false, durationMs: 20_949, reason: "No time left for another attempt within the caller's deadline.", failureKind: "upstream_unavailable" },
      { provider: "variant-validator", ok: false, durationMs: 18_985, reason: "resolution budget of 40000ms exceeded", failureKind: "upstream_unavailable" },
    ]);
    expect(slow).toContain("too slowly");
    expect(slow).not.toContain("could not be reached");

    const transport = buildResolutionUnavailableMessage("upstream_unavailable", [
      { provider: "ensembl-vep", ok: false, durationMs: 40, reason: "fetch failed", failureKind: "upstream_unavailable" },
    ]);
    expect(transport).toContain("could not be reached");

    // Both keep the actionable escape hatch, and neither promises a fallback that does not exist.
    for (const message of [slow, transport]) {
      expect(message).toContain("protein-level substitution");
      expect(message).not.toContain("the rest of the analysis runs");
    }
  });

  it("keeps the failure message free of internal provider detail", () => {
    for (const kind of ["upstream_unavailable", "invalid_response", "not_found"] as const) {
      const message = buildResolutionUnavailableMessage(kind, [
        { provider: "ensembl-vep", ok: false, durationMs: 40, reason: "fetch failed", failureKind: "upstream_unavailable" },
      ]);
      expect(message).not.toMatch(/fetch|upstream|rate limit|ENOENT|spawn/i);
    }
  });

  /**
   * The recognizer that decides whether a provider's refusal is about the COORDINATE or about itself.
   *
   * It is a text match because neither provider gives this its own status, so it has to be narrow:
   * over-matching would turn a genuine provider fault into "fix your coordinate", and under-matching
   * leaves the build remedy invisible — the bug this exists to remove. Both directions are pinned.
   */
  describe("isReferenceMismatchMessage", () => {
    it("recognizes the real refusal wordings", () => {
      for (const text of [
        /**
         * BOTH OF THESE ARE VERBATIM, captured live on `chrX:g.23723975C>A` — an hg19 ACOT9 allele
         * whose GRCh38 reference base at that position is `A`. This coordinate is the case the whole
         * feature exists for: read against GRCh38 it is refused, and read against GRCh37 it is a real
         * missense variant. The two providers report it in completely different shapes — a 400 with a
         * sentence, and a 200 with a warning list — which is precisely why classification reads the
         * text rather than the status.
         */
        "Unable to parse HGVS notation 'chrX:g.23723975C>A': Reference allele extracted from chrX:23723975-23723975 (A) does not match reference allele given by HGVS notation chrX:g.23723975C>A (C)",
        "ReferenceMismatchError: NC_000023.11:g.23723975C>A: Variant reference (C) does not agree with reference sequence (A)",
        "Reference allele does not match the reference sequence at 1:1256452",
        "The reference allele does not match. Please check your variants.",
        "Reference sequence does not agree with the supplied reference sequence",
        "WARNING: ref allele mismatch against reference sequence",
        "not the reference base at that position",
        // The verb variants a reworded provider message may use; each is the same finding, and missing
        // it silently returns the reader to the pre-fix advice ("the providers are degraded").
        "Submitted ref/alt do not match the reference genome",
        "The reference allele differs from the reference sequence",
        "The submitted allele is not present in the reference sequence",
        "Wrong reference base at position 100",
      ]) {
        expect(isReferenceMismatchMessage(text), text).toBe(true);
      }
    });

    it("leaves every other refusal alone", () => {
      for (const text of [
        "",
        "Invalid region notation",
        "Unknown chromosome: chr99",
        "Internal Server Error",
        "No transcript consequences found for the provided variant.",
        // A REAL VariantValidator warning that travels with perfectly good answers: it names a
        // reference sequence id without saying anything disagrees with it.
        "This is not a valid HGVS variant description, because no reference sequence ID has been provided",
        "Setting select_transcripts to 'all' or 'raw' is deprecated for genomic variant processing",
        /**
         * A REAL VariantValidator warning about the DNA TYPE, and the reason the dot-bounded spans are
         * load-bearing rather than stylistic: the sentence reads "reference sequence (NC_012920.1) does
         * not match the DNA type (g)", and the accession's full stop is the only thing keeping the first
         * pattern from reading "reference sequence … does not match" straight across it. Widen those
         * spans to `[\s\S]{0,N}` and a resolvable mitochondrial variant is refused with build advice.
         */
        "The given reference sequence (NC_012920.1) does not match the DNA type (g).",
        // Names a reference without a mismatch, or a mismatch without a reference: neither is this.
        "Reference genome build GRCh38",
        "Allele mismatch between genotypes",
        "The transcript does not match the requested identifier",
      ]) {
        expect(isReferenceMismatchMessage(text), text).toBe(false);
      }
      expect(isReferenceMismatchMessage(undefined)).toBe(false);
      expect(isReferenceMismatchMessage(500)).toBe(false);
    });
  });
});
