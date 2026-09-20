import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_RESOLUTION_BUDGET_MS,
  ENSEMBL_VEP_TIMEOUT_MS,
  computeRungWindowMs,
  resolveCoordinate,
  buildResolutionUnavailableMessage,
} from "./coordinate-resolver.ts";
import { CoordinateResolutionError } from "./types.ts";
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

describe("buildResolutionUnavailableMessage", () => {
  it("keeps messages free of strings that the 5xx sanitizer would rewrite", () => {
    // `sendError` rewrites any status>=500 message containing words like "fetch"/"upstream".
    // Embedding raw provider reasons would silently replace this actionable guidance.
    for (const kind of ["upstream_unavailable", "invalid_response", "not_found"] as const) {
      const message = buildResolutionUnavailableMessage(kind);
      expect(message).not.toMatch(/fetch|upstream|rate limit|ENOENT|spawn/i);
    }
  });

  it("tells the user how to work around a total outage", () => {
    const message = buildResolutionUnavailableMessage("upstream_unavailable");
    expect(message).toContain("protein-level substitution");
    expect(message).toContain("p.Glu433Lys");
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
});
