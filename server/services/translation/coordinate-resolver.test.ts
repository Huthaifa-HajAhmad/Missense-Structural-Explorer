import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCoordinate, buildResolutionUnavailableMessage } from "./coordinate-resolver.ts";
import { CoordinateResolutionError } from "./types.ts";
import { clearAllCaches } from "../infra/cache.ts";

const NOTATION = "chr1:g.25484258G>A";

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
        gene_symbol: "MACO1",
        swissprot: ["Q8N5G2.1"],
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

describe("coordinate-resolver provider ladder", () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAllCaches(true);
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
    expect(second.attempts).toEqual([
      { provider: "ensembl-vep", ok: true, durationMs: 0, reason: "cache_hit" },
    ]);
    // The immutable mapping must not have triggered a second network call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps reporting usedFallback=true when a fallback answer is served from cache", async () => {
    // The first call fails over to VariantValidator, and that DEGRADED answer (no
    // transcript_id / UniProt) is cached for ~10 years. A later cache read previously
    // reported usedFallback:false, presenting the fallback result as a first-choice one.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) =>
      String(url).includes("rest.ensembl.org")
        ? jsonResponse({ error: "reference allele mismatch" }, 400)
        : jsonResponse(VV_PAYLOAD)
    );

    const first = await resolveCoordinate(NOTATION, "GRCh38");
    expect(first.consequence.provider).toBe("variant-validator");
    expect(first.cacheHit).toBe(false);
    expect(first.usedFallback).toBe(true);

    const second = await resolveCoordinate(NOTATION, "GRCh38");
    expect(second.cacheHit).toBe(true);
    expect(second.consequence.provider).toBe("variant-validator");
    // Provenance must survive the cache round-trip.
    expect(second.usedFallback).toBe(true);
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
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      (_url: any, init: any) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }) as any
    );

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
   * that was slow (rather than failing fast) consumed all of it — VEP's own retry envelope is
   * 3 attempts x 15s — and the loop broke before VariantValidator was ever called. Clinicians
   * were told "all reference providers are unreachable" for a primary-only problem, while the
   * independent fallback the ladder exists to provide never ran.
   */
  it("still attempts the fallback when the primary hangs instead of failing", async () => {
    const vepCalls: string[] = [];
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation((url: any, init: any) => {
      if (String(url).includes("rest.ensembl.org")) {
        vepCalls.push(String(url));
        // A hanging primary: never answers, honours the abort its window eventually sends.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }) as any;
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
    // reached; now each rung gets a share, so both are at least attempted and recorded.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      (_url: any, init: any) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }) as any
    );

    const error: any = await resolveCoordinate(NOTATION, "GRCh38", undefined, { budgetMs: 200 }).catch((e) => e);

    expect(error).toBeInstanceOf(CoordinateResolutionError);
    expect(error.attempts.map((a: any) => a.provider)).toEqual(["ensembl-vep", "variant-validator"]);
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
});