import { describe, it, expect, vi, beforeEach } from "vitest";
import { liftCoordinateToCanonical, parseSingleMapping } from "./liftover.ts";

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

describe("liftCoordinateToCanonical", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    const { clearAllCaches } = await import("../infra/cache.ts");
    clearAllCaches(true);
  });

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
