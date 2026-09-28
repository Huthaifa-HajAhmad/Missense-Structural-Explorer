import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attemptCoordinateLift,
  classifyMapping,
  fetchAssemblyReferenceBase,
  liftCoordinateToCanonical,
  parseSingleMapping,
} from "./liftover.ts";

/**
 * Tests for the reverse-verified liftover — assembly policy #2, the recovery path whose
 * ABSENCE was the permanent half of the unmapping defect (F-3).
 *
 * The three-fold verification (single forward mapping, exact round-trip, GRCh38 REF match)
 * is the contract: a lift that passes only some of it must produce NO value, because the
 * dangerous failure mode is not a miss but a plausible coordinate for a different locus.
 */

const jsonRes = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** The real ACOT9 production case: chrX:23,723,975 C>A (GRCh37) = chrX:23,705,858 C>A (GRCh38). */
const ACOT9_HG19 = { chrom: "X", pos: 23723975, ref: "C", alt: "A", assembly: "GRCh37" } as const;
const ACOT9_HG38_POS = 23705858;

function mockAssemblyApi(opts: {
  forward?: unknown;
  back?: unknown;
  refBase?: string;
  failMap?: boolean;
} = {}) {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/map/human/GRCh37/")) {
      if (opts.failMap) return new Response("{}", { status: 500 });
      return jsonRes(opts.forward ?? {
        mappings: [{ mapped: { seq_region_name: "X", start: ACOT9_HG38_POS, end: ACOT9_HG38_POS, strand: 1 } }]
      });
    }
    if (url.includes("/map/human/GRCh38/")) {
      if (opts.failMap) return new Response("{}", { status: 500 });
      return jsonRes(opts.back ?? {
        mappings: [{ mapped: { seq_region_name: "X", start: ACOT9_HG19.pos, end: ACOT9_HG19.pos, strand: 1 } }]
      });
    }
    if (url.includes("/sequence/region/human/")) {
      return new Response(opts.refBase ?? "C", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { urls, fetchMock };
}

/**
 * Caches, breakers and semaphores are module-global, so without this reset a suite that drives a
 * host to its failure threshold leaves the breaker open for later tests (the convention
 * `coordinate-resolver.test.ts` already follows).
 */
async function resetLiftState() {
  vi.unstubAllGlobals();
  const { clearAllCaches } = await import("../infra/cache.ts");
  clearAllCaches(true);
  const { resetHostStateForTests } = await import("../infra/http-client.ts");
  resetHostStateForTests();
}

describe("liftCoordinateToCanonical", () => {
  beforeEach(resetLiftState);

  it("returns an identity lift for a canonical-build coordinate WITHOUT any network call", async () => {
    const { fetchMock } = mockAssemblyApi();
    const lifted = await liftCoordinateToCanonical({ chrom: "17", pos: 43000000, ref: "G", alt: "A", assembly: "GRCh38" });
    expect(lifted).not.toBeNull();
    expect(lifted!.pos).toBe(43000000);
    expect(lifted!.assembly).toBe("GRCh38");
    expect(lifted!.reverseVerified).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lifts the real ACOT9 hg19 locus to its verified GRCh38 position", async () => {
    mockAssemblyApi();
    const lifted = await liftCoordinateToCanonical(ACOT9_HG19);
    expect(lifted).not.toBeNull();
    expect(lifted!.chrom).toBe("X");
    expect(lifted!.pos).toBe(ACOT9_HG38_POS);
    expect(lifted!.ref).toBe("C");
    expect(lifted!.alt).toBe("A");
    expect(lifted!.originalAssembly).toBe("GRCh37");
    expect(lifted!.original).toEqual({ chrom: "X", pos: ACOT9_HG19.pos });
    expect(lifted!.reverseVerified).toBe(true);
  });

  it("refuses when the reverse map does not reproduce the original position", async () => {
    mockAssemblyApi({
      back: { mappings: [{ mapped: { seq_region_name: "X", start: 23000000, end: 23000000, strand: 1 } }] }
    });
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).toBeNull();
  });

  it("refuses when the GRCh38 base at the lifted position is not the supplied REF", async () => {
    // The exact silent-wrongness case assembly.ts warns about: a plausible coordinate whose
    // alleles were never checked. Position round-trips cleanly; the locus is still wrong.
    mockAssemblyApi({ refBase: "T" });
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).toBeNull();
  });

  it("refuses an ambiguous (multi-mapping) region rather than picking one", async () => {
    mockAssemblyApi({
      forward: {
        mappings: [
          { mapped: { seq_region_name: "X", start: ACOT9_HG38_POS, end: ACOT9_HG38_POS, strand: 1 } },
          { mapped: { seq_region_name: "X", start: 90000000, end: 90000000, strand: 1 } }
        ]
      }
    });
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).toBeNull();
  });

  it("refuses a strand-flipped mapping (the lifted alleles would need complementing)", async () => {
    mockAssemblyApi({
      forward: { mappings: [{ mapped: { seq_region_name: "X", start: ACOT9_HG38_POS, end: ACOT9_HG38_POS, strand: -1 } }] }
    });
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).toBeNull();
  });

  it("refuses indels — only single-base substitutions are liftable here", async () => {
    const { fetchMock } = mockAssemblyApi();
    expect(await liftCoordinateToCanonical({ chrom: "X", pos: 23723975, ref: "CA", alt: "A", assembly: "GRCh37" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the mapping lands on a different contig", async () => {
    mockAssemblyApi({
      forward: { mappings: [{ mapped: { seq_region_name: "3", start: 100, end: 100, strand: 1 } }] }
    });
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).toBeNull();
  });

  it("degrades to null on an upstream outage, and RETRIES the next call (failures are not cached)", async () => {
    const a = mockAssemblyApi({ failMap: true });
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).toBeNull();
    expect(a.fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
    const b = mockAssemblyApi();
    const lifted = await liftCoordinateToCanonical(ACOT9_HG19);
    expect(lifted?.pos).toBe(ACOT9_HG38_POS);
    expect(b.fetchMock).toHaveBeenCalled();
  });

  it("caches a verified lift (successes ARE cached; the second call makes no request)", async () => {
    const first = mockAssemblyApi();
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).not.toBeNull();
    const firstCallCount = first.fetchMock.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    const lifted = await liftCoordinateToCanonical(ACOT9_HG19);
    expect(lifted?.pos).toBe(ACOT9_HG38_POS);
    // Same stubbed fetch: a cache hit adds no calls.
    expect(first.fetchMock.mock.calls.length).toBe(firstCallCount);
  });

  it("normalizes the chr prefix without inventing a contig", async () => {
    mockAssemblyApi();
    const lifted = await liftCoordinateToCanonical({ ...ACOT9_HG19, chrom: "chrX" });
    expect(lifted?.chrom).toBe("X");
    expect(lifted?.original).toEqual({ chrom: "chrX", pos: ACOT9_HG19.pos });
  });

  /**
   * Review H-3: the cached value embeds ref/alt, so the KEY must carry them too — two SNVs at
   * one GRCh37 position (KRAS c.35G>A then c.35G>T shape) must never share a lift entry.
   */
  it("never serves one allele's lift for another allele at the same position", async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/map/human/GRCh37/")) {
        return jsonRes({ mappings: [{ mapped: { seq_region_name: "X", start: ACOT9_HG38_POS, end: ACOT9_HG38_POS, strand: 1 } }] });
      }
      if (url.includes("/map/human/GRCh38/")) {
        return jsonRes({ mappings: [{ mapped: { seq_region_name: "X", start: ACOT9_HG19.pos, end: ACOT9_HG19.pos, strand: 1 } }] });
      }
      if (url.includes("/sequence/region/human/")) {
        // REF check: the GRCh38 base is C regardless of the caller's alt.
        return new Response("C", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await liftCoordinateToCanonical({ chrom: "X", pos: ACOT9_HG19.pos, ref: "C", alt: "A", assembly: "GRCh37" });
    expect(first?.alt).toBe("A");
    const callsAfterFirst = fetchMock.mock.calls.length;

    // Same position, same REF, DIFFERENT ALT: must run its own verification, not reuse the
    // cached "A" answer.
    const second = await liftCoordinateToCanonical({ chrom: "X", pos: ACOT9_HG19.pos, ref: "C", alt: "T", assembly: "GRCh37" });
    expect(second?.alt).toBe("T");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("validates the identity lift too — a bogus contig or indel gets no pass-through (review M2)", async () => {
    const { fetchMock } = mockAssemblyApi();
    expect(await liftCoordinateToCanonical({ chrom: "99", pos: 100, ref: "G", alt: "A", assembly: "GRCh38" })).toBeNull();
    expect(await liftCoordinateToCanonical({ chrom: "X", pos: 100, ref: "GA", alt: "T", assembly: "GRCh38" })).toBeNull();
    expect(await liftCoordinateToCanonical({ chrom: "X", pos: 400_000_001, ref: "G", alt: "A", assembly: "GRCh38" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The reverse round-trip (check 2) and the reference-base check (check 3) are INDEPENDENT —
   * neither consumes the other's result — so `performLift` issues them together.
   *
   * WHY A TEST: measured live on the reported coordinate, the lift cost forward 1.9s, reverse
   * 9.3s and reference base 0.1s — 17.3s end to end. The cost is provider LATENCY, not the number
   * of checks, and the caller's allowance is bounded (`INTAKE_LIFT_BUDGET_MS`), so sequencing two
   * independent calls is what makes a perfectly verifiable coordinate lose its lift to a timeout.
   *
   * HOW IT IS PINNED: by OVERLAP, not by arrival order. The mock holds the reverse answer open
   * until the reference-base request has also been ISSUED (giving up after a short window, so a
   * sequential implementation fails the assertion instead of hanging the suite). A concurrent
   * implementation therefore observes the reference-base request while the reverse is still
   * unanswered; a sequential one never can. Asserting arrival order alone would not prove it: the
   * second call can be issued on the same tick and still await the first result.
   *
   * Both checks must still RUN and still pass — this is a scheduling change, not a relaxation.
   */
  it("issues the reverse round-trip and the reference-base check concurrently", async () => {
    let sequenceRequestSeen = false;
    let sequenceArrivedWhileReversePending = false;

    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/map/human/GRCh37/")) {
        return jsonRes({
          mappings: [{ mapped: { seq_region_name: "X", start: ACOT9_HG38_POS, end: ACOT9_HG38_POS, strand: 1 } }]
        });
      }
      if (url.includes("/map/human/GRCh38/")) {
        const giveUpAt = Date.now() + 250;
        while (!sequenceRequestSeen && Date.now() < giveUpAt) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        sequenceArrivedWhileReversePending = sequenceRequestSeen;
        return jsonRes({
          mappings: [{ mapped: { seq_region_name: "X", start: ACOT9_HG19.pos, end: ACOT9_HG19.pos, strand: 1 } }]
        });
      }
      if (url.includes("/sequence/region/human/")) {
        sequenceRequestSeen = true;
        return new Response("C", { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const lifted = await liftCoordinateToCanonical(ACOT9_HG19);

    expect(
      sequenceArrivedWhileReversePending,
      "the reference-base check must be in flight while the reverse round-trip is still unanswered"
    ).toBe(true);
    // …and the lift still passes BOTH checks.
    expect(sequenceRequestSeen).toBe(true);
    expect(lifted?.pos).toBe(ACOT9_HG38_POS);
    expect(lifted?.reverseVerified).toBe(true);
  });
});

/**
 * The refusal CODES.
 *
 * Separate from the tests above on purpose: those ask "was a lift produced?" — the only question
 * the predictor path asks, and `null` answers it. These pin the REASON, because the intake must
 * decide something with it: an unanswered map is worth advising a retry on, a base where the two
 * references disagree never is, and a paralogous region will not resolve however often it is asked.
 * Collapsing all of that into `null` is what made the disclosure unable to advise anything.
 */
describe("attemptCoordinateLift refusal codes", () => {
  beforeEach(resetLiftState);

  it("reports a verified lift as a value the intake can read", async () => {
    mockAssemblyApi();
    const attempt = await attemptCoordinateLift(ACOT9_HG19);

    expect("lifted" in attempt).toBe(true);
    // The boolean-shaped accessor is unchanged: the predictor path reads the same lift as before.
    if ("lifted" in attempt) expect(attempt.lifted.pos).toBe(ACOT9_HG38_POS);
    expect(await liftCoordinateToCanonical(ACOT9_HG19)).not.toBeNull();
  });

  it("names an unaddressable coordinate `invalid-coordinate` without spending a request", async () => {
    const { fetchMock } = mockAssemblyApi();
    expect(await attemptCoordinateLift({ chrom: "X", pos: 23723975, ref: "CA", alt: "A", assembly: "GRCh37" }))
      .toEqual({ failure: "invalid-coordinate" });
    // …and the same gate guards the identity branch, where nothing would otherwise be validated.
    expect(await attemptCoordinateLift({ chrom: "99", pos: 100, ref: "G", alt: "A", assembly: "GRCh38" }))
      .toEqual({ failure: "invalid-coordinate" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes `no-mapping` from `ambiguous-mapping`", async () => {
    mockAssemblyApi({ forward: { mappings: [] } });
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "no-mapping" });

    vi.unstubAllGlobals();
    mockAssemblyApi({
      forward: {
        mappings: [
          { mapped: { seq_region_name: "X", start: ACOT9_HG38_POS, end: ACOT9_HG38_POS, strand: 1 } },
          { mapped: { seq_region_name: "X", start: 90000000, end: 90000000, strand: 1 } },
        ],
      },
    });
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "ambiguous-mapping" });
  });

  it("names a mapping that lands on another chromosome `contig-changed`", async () => {
    mockAssemblyApi({ forward: { mappings: [{ mapped: { seq_region_name: "3", start: 100, end: 100, strand: 1 } }] } });
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "contig-changed" });
  });

  it("names a failed round-trip `round-trip-failed` and a disagreeing base `reference-discontinuity`", async () => {
    // Both are DEFINITIVE: retrying cannot change either answer, which is why they are separate
    // from the retryable codes rather than folded into one "lift failed".
    mockAssemblyApi({
      back: { mappings: [{ mapped: { seq_region_name: "X", start: 23000000, end: 23000000, strand: 1 } }] },
    });
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "round-trip-failed" });

    vi.unstubAllGlobals();
    mockAssemblyApi({ refBase: "T" });
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "reference-discontinuity" });
  });

  it("names an unanswered map `map-unavailable`", async () => {
    mockAssemblyApi({ failMap: true });
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "map-unavailable" });
  });

  /**
   * The other retryable code, and the one that must NOT read like a fact about the coordinate: we
   * stopped asking. `fetchWithRetry` gives even a past-deadline call its 500 ms floor, so the only
   * thing that ends this stub is our own clock — the stub never answers and rejects on abort, exactly
   * as a hanging socket does.
   */
  it("names our own elapsed deadline `budget-exceeded`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: any, init: any) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted by deadline")));
          })
      )
    );

    const started = Date.now();
    expect(await attemptCoordinateLift(ACOT9_HG19, { deadlineAt: Date.now() - 1_000 }))
      .toEqual({ failure: "budget-exceeded" });
    // Bounded by the transport's documented first-attempt floor (~500ms), so the assertion is about
    // the CODE and not about how long the suite tolerates a hanging socket.
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  /**
   * The clock may explain a RETRYABLE code, never overwrite a definitive one.
   *
   * A refusal that named a reference discontinuity is a fact about the coordinate; relabelling it
   * `budget-exceeded` because our deadline had passed made `isRetryableLiftRefusal` true for it and
   * contradicted the schema's own description of that code — advice to retry something that cannot
   * succeed, in exactly the field a report and an agent read.
   */
  it("does not relabel a definitive refusal as budget-exceeded", async () => {
    mockAssemblyApi({ refBase: "T" }); // GRCh38 base ≠ REF → reference-discontinuity

    expect(await attemptCoordinateLift(ACOT9_HG19, { deadlineAt: Date.now() - 1_000 }))
      .toEqual({ failure: "reference-discontinuity" });
  });

  /**
   * A 4xx from the map or the sequence endpoint is about the REQUEST (no such position), not about the
   * provider being unavailable — so it is definitive, not retryable. Measured live: the sequence
   * endpoint answers 400 "Cannot request a slice whose start (999999999) is greater than 248956422".
   */
  it("reads a 4xx as a definitive refusal and a 5xx as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/map/human/GRCh37/")) return new Response("{}", { status: 400 });
      return new Response("{}", { status: 200 });
    }));
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "no-mapping" });

    vi.unstubAllGlobals();
    mockAssemblyApi({ failMap: true }); // 500
    expect(await attemptCoordinateLift(ACOT9_HG19)).toEqual({ failure: "map-unavailable" });
  });

  /** The reference base is fetched from the build's OWN host — the same one the annotation path uses. */
  it("reads the reference base from the requested build's host", async () => {
    const { urls } = mockAssemblyApi();
    // mockAssemblyApi answers /sequence/region/human/ for either host with "C".
    await fetchAssemblyReferenceBase("X", 23723975, "GRCh37", Date.now() + 5_000);
    await fetchAssemblyReferenceBase("X", 23723975, "GRCh38", Date.now() + 5_000);

    const sequenceUrls = urls.filter((u) => u.includes("/sequence/region/human/"));
    expect(sequenceUrls[0]?.startsWith("https://grch37.rest.ensembl.org")).toBe(true);
    expect(sequenceUrls[1]?.startsWith("https://rest.ensembl.org")).toBe(true);
  });
});

describe("classifyMapping", () => {
  it("names the reason each unusable assembly-map answer is refused", () => {
    const one = { mapped: { seq_region_name: "X", start: 10, end: 10, strand: 1 } };

    // A body we cannot read at all — no `mappings` array — is "the map did not answer us", not
    // "the map says there is no such position". Only the second is a fact about the coordinate.
    expect(classifyMapping(null)).toEqual({ failure: "map-unavailable" });
    expect(classifyMapping({})).toEqual({ failure: "map-unavailable" });
    expect(classifyMapping({ mappings: [] })).toEqual({ failure: "no-mapping" });
    expect(classifyMapping({ mappings: [one, one] })).toEqual({ failure: "ambiguous-mapping" });
    expect(classifyMapping({ mappings: [{ mapped: { seq_region_name: "X", start: 10, end: 14, strand: 1 } }] }))
      .toEqual({ failure: "ambiguous-mapping" });
    expect(classifyMapping({ mappings: [{ mapped: { seq_region_name: "X", start: 10, end: 10, strand: -1 } }] }))
      .toEqual({ failure: "ambiguous-mapping" });
    // A mapping with no contig cannot be addressed, so it is unusable FOR US (not ambiguous).
    expect(classifyMapping({ mappings: [{ mapped: { start: 10, end: 10, strand: 1 } }] }))
      .toEqual({ failure: "map-unavailable" });
    // A `mapped` that is missing or carries no usable coordinates is unusable too — pinned because a
    // mutant returning `no-mapping` here would describe the map's answer as a fact about the position.
    expect(classifyMapping({ mappings: [{ mapped: null }] })).toEqual({ failure: "ambiguous-mapping" });
    expect(classifyMapping({ mappings: [{ mapped: { seq_region_name: "X", start: "10", end: 10, strand: 1 } }] }))
      .toEqual({ failure: "ambiguous-mapping" });

    expect(classifyMapping({ mappings: [one] })).toEqual({ mapping: { chrom: "X", start: 10, end: 10 } });
  });
});

describe("parseSingleMapping", () => {
  it("accepts exactly one single-base, strand-1 mapping", () => {
    expect(
      parseSingleMapping({ mappings: [{ mapped: { seq_region_name: "X", start: 10, end: 10, strand: 1 } }] })
    ).toEqual({ chrom: "X", start: 10, end: 10 });
  });

  it("rejects empty, multi, ranged, strand-flipped and malformed responses", () => {
    expect(parseSingleMapping({ mappings: [] })).toBeNull();
    expect(parseSingleMapping({})).toBeNull();
    expect(parseSingleMapping({ mappings: [
      { mapped: { seq_region_name: "X", start: 10, end: 10, strand: 1 } },
      { mapped: { seq_region_name: "X", start: 20, end: 20, strand: 1 } }
    ] })).toBeNull();
    expect(parseSingleMapping({ mappings: [{ mapped: { seq_region_name: "X", start: 10, end: 14, strand: 1 } }] })).toBeNull();
    expect(parseSingleMapping({ mappings: [{ mapped: { seq_region_name: "X", start: 10, end: 10, strand: -1 } }] })).toBeNull();
    expect(parseSingleMapping({ mappings: [{ mapped: { start: 10, end: 10, strand: 1 } }] })).toBeNull();
  });
});
