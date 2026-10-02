import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSpliceAiBroad,
  fetchSpliceAiBroadOutcome,
  normaliseSpliceAiDistance,
  clearSpliceAiCache,
  buildSpliceAiCacheKey,
  SPLICEAI_DEFAULT_DISTANCE,
  SPLICEAI_DEFAULT_MASK,
} from "./spliceai_broad.ts";

/**
 * Offline unit tests for the Broad SpliceAI client.
 *
 * The network is stubbed throughout: the live API is rate-limited to a handful of
 * queries per user per minute, so the suite must never depend on it. The recorded
 * payload below is the real response for MACO1 p.Glu433Lys, trimmed to two transcript
 * records — one MANE Select, one not — so transcript selection is genuinely exercised.
 */

/** Real shape, trimmed. Values are strings on the wire; delta positions are numbers. */
function maco1Payload(overrides: Record<string, unknown> = {}) {
  const mane = {
    DS_AG: "0.000", DS_AL: "0.000", DS_DG: "0.000", DS_DL: "0.004",
    DP_AG: -142, DP_AL: -172, DP_DG: 19, DP_DL: 123,
    g_id: "ENSG00000204178.12", g_name: "MACO1",
    t_id: "ENST00000374343.5", t_priority: "MS",
    t_refseq_ids: ["NM_018202.6"], t_type: "protein_coding", t_strand: "+",
  };
  const nonMane = {
    ...mane,
    DS_DL: "0.9", // deliberately different, so a wrong selection is visible
    t_id: "ENST00000897267.1", t_priority: "N", t_refseq_ids: null,
  };
  return {
    variant: "chr1-25484258-G-A", hg: "38", distance: 500, mask: 0, raw: "1",
    genomeVersion: "38", chrom: "1", pos: 25484258, ref: "G", alt: "A",
    scores: [nonMane, mane],
    source: "spliceai:model",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  } as unknown as Response;
}

let fetchSpy: any;

beforeEach(() => {
  clearSpliceAiCache();
});

afterEach(() => {
  fetchSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe("fetchSpliceAiBroad — request construction", () => {
  it("requests the correct endpoint with variant, build, distance and mask", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("https://spliceai-38-xwkwwwxdwq-uc.a.run.app/spliceai/");
    expect(url).toContain("variant=chr1-25484258-G-A");
    expect(url).toContain("hg=38");
    expect(url).toContain(`distance=${SPLICEAI_DEFAULT_DISTANCE}`);
    expect(url).toContain(`mask=${SPLICEAI_DEFAULT_MASK}`);
  });

  it("normalises a chr-prefixed contig and routes GRCh37 to its own service", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    await fetchSpliceAiBroad("chr1", 25484258, "g", "a", { assembly: "GRCh37", skipCache: true });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("https://spliceai-37-xwkwwwxdwq-uc.a.run.app/");
    // One "chr" prefix only, and alleles upper-cased.
    expect(url).toContain("variant=chr1-25484258-G-A");
    expect(url).not.toContain("chrchr");
    expect(url).toContain("hg=37");
  });

  it("honours an explicit distance so a wider window can be requested", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    await fetchSpliceAiBroad("1", 25484258, "G", "A", { distance: 2000, skipCache: true });
    expect(String(fetchSpy.mock.calls[0][0])).toContain("distance=2000");
  });

  it("rejects incomplete coordinates without calling the network", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    expect(await fetchSpliceAiBroad("", 25484258, "G", "A", { skipCache: true })).toBeNull();
    expect(await fetchSpliceAiBroad("1", NaN, "G", "A", { skipCache: true })).toBeNull();
    expect(await fetchSpliceAiBroad("1", 25484258, "", "A", { skipCache: true })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchSpliceAiBroad — parsing and transcript selection", () => {
  it("selects the MANE Select record, not merely the first one", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    const score = await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });

    expect(score!.isManeSelect).toBe(true);
    expect(score!.transcriptId).toBe("ENST00000374343.5");
    // The non-MANE record carried DS_DL 0.9; selecting wrongly would surface that.
    expect(score!.ds_dl).toBeCloseTo(0.004, 5);
    expect(score!.transcriptRefSeqIds).toEqual(["NM_018202.6"]);
  });

  it("parses string scores to numbers and derives max_ds from the four channels", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    const score = await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });

    expect(score!.ds_ag).toBe(0);
    expect(score!.ds_al).toBe(0);
    expect(score!.ds_dg).toBe(0);
    expect(score!.ds_dl).toBeCloseTo(0.004, 5);
    expect(score!.max_ds).toBeCloseTo(0.004, 5);
  });

  it("carries the delta positions, which localise where splicing shifts", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    const score = await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });

    expect(score!.dp.ds_dl).toBe(123);
    expect(score!.dp.ds_ag).toBe(-142);
  });

  it("records provenance: window, masking and live computation", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    const score = await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });

    expect(score!.computedLive).toBe(true);
    expect(score!.source).toBe("spliceai:model");
    expect(score!.distance).toBe(500);
  });

  it("treats a precomputed table answer as not live-computed", async () => {
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse(maco1Payload({ source: "spliceai:precomputed" })));
    const score = await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });
    expect(score!.computedLive).toBe(false);
  });

  it("reports null rather than zeros when a channel is absent", async () => {
    const payload = maco1Payload();
    (payload.scores[1] as any).DS_DL = ".";
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(payload));
    const score = await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });
    expect(score!.ds_dl).toBeNull();
  });
});

describe("fetchSpliceAiBroad — degradation (must never throw, never fabricate)", () => {
  it("returns null on an HTTP error", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "nope" }, 503));
    expect(await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true })).toBeNull();
  });

  it("returns null on a network failure", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true })).toBeNull();
  });

  it("returns null on a malformed payload", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ unexpected: true }));
    expect(await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true })).toBeNull();
  });

  it("returns null when the service reports no transcript", async () => {
    // Outside any gene / near a chromosome end: an empty score list is a real
    // "cannot score", and must not be rendered as a zero delta score.
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload({ scores: [] })));
    expect(await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true })).toBeNull();
  });
});

describe("fetchSpliceAiBroadOutcome — says why there is no score", () => {
  const ask = () => fetchSpliceAiBroadOutcome("1", 25484258, "G", "A", { skipCache: true });

  it("names a refused coordinate, with the service's own words", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "REF does not match" }, 400));
    const out = await ask();
    expect(out.record).toBeNull();
    expect(out.failure).toMatchObject({ kind: "coordinate-rejected", httpStatus: 400 });
    expect(out.failure!.detail).toMatch(/REF does not match/);
  });

  it("names a rate limit and a server error, which the shared client surfaces as a throw carrying the status", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "slow down" }, 429));
    expect((await ask()).failure).toMatchObject({ kind: "rate-limited", httpStatus: 429 });
    clearSpliceAiCache();
    fetchSpy.mockResolvedValue(jsonResponse({ error: "bad gateway" }, 502));
    expect((await ask()).failure).toMatchObject({ kind: "upstream-error", httpStatus: 502 });
  });

  it("names a timeout and a dropped connection apart", async () => {
    const t: any = new Error("The operation timed out");
    t.name = "TimeoutError";
    fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(t);
    expect((await ask()).failure?.kind).toBe("timeout");
    clearSpliceAiCache();
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await ask()).failure?.kind).toBe("network");
  });

  it("separates a malformed body from an empty gene list", async () => {
    // Every field in the contract is optional, so "unreadable" needs a wrong TYPE, not a missing key.
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ scores: "not-a-list" }));
    expect((await ask()).failure?.kind).toBe("unreadable");
    fetchSpy.mockResolvedValue(jsonResponse(maco1Payload({ scores: [] })));
    expect((await ask()).failure?.kind).toBe("no-transcript");
  });

  it("keeps the reason when a cached miss is replayed", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "REF does not match" }, 422));
    await fetchSpliceAiBroadOutcome("1", 25484258, "G", "A");
    const again = await fetchSpliceAiBroadOutcome("1", 25484258, "G", "A");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(again.failure?.kind).toBe("coordinate-rejected");
  });

  it("reports no failure for a score, or when nothing was asked", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    const ok = await ask();
    expect(ok.record).not.toBeNull();
    expect(ok.failure).toBeNull();
    expect((await fetchSpliceAiBroadOutcome("", 1, "G", "A", { skipCache: true })).failure).toBeNull();
  });
});

describe("SpliceAI reporting window", () => {
  it("normalises a requested window into the service's range, and refuses what is not a number", () => {
    expect(normaliseSpliceAiDistance("200")).toBe(200);
    expect(normaliseSpliceAiDistance(" 1000 ")).toBe(1000);
    expect(normaliseSpliceAiDistance(["500"])).toBe(500);
    expect(normaliseSpliceAiDistance(5)).toBe(50);
    expect(normaliseSpliceAiDistance(99999)).toBe(10000);
    expect(normaliseSpliceAiDistance("abc")).toBeNull();
    expect(normaliseSpliceAiDistance("12.5e3")).toBeNull();
    expect(normaliseSpliceAiDistance(undefined)).toBeNull();
  });

  it("sends the requested window to the service, and keeps windows apart in the cache", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const d = Number(new URL(String(url)).searchParams.get("distance"));
      return jsonResponse(maco1Payload({ distance: d }));
    });
    const narrow = await fetchSpliceAiBroad("1", 25484258, "G", "A", { distance: 50 });
    const wide = await fetchSpliceAiBroad("1", 25484258, "G", "A", { distance: 2000 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/distance=50&/);
    expect(String(fetchSpy.mock.calls[1][0])).toMatch(/distance=2000&/);
    expect(narrow!.distance).toBe(50);
    expect(wide!.distance).toBe(2000);
  });
});

describe("fetchSpliceAiBroad — caching", () => {
  it("serves a repeat request from cache without a second call", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    const first = await fetchSpliceAiBroad("1", 25484258, "G", "A");
    const second = await fetchSpliceAiBroad("1", 25484258, "G", "A");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("caches a negative result but re-queries it briefly", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload({ scores: [] })));
    expect(await fetchSpliceAiBroad("1", 25484258, "G", "A")).toBeNull();
    expect(await fetchSpliceAiBroad("1", 25484258, "G", "A")).toBeNull();
    // Negative results are cached, so a burst of repeat queries does not hammer the API.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("separates cache entries by mask and distance", () => {
    const base = buildSpliceAiCacheKey("1", 25484258, "G", "A", "GRCh38", 500, 1);
    expect(base).not.toBe(buildSpliceAiCacheKey("1", 25484258, "G", "A", "GRCh38", 500, 0));
    expect(base).not.toBe(buildSpliceAiCacheKey("1", 25484258, "G", "A", "GRCh38", 2000, 1));
    expect(base).not.toBe(buildSpliceAiCacheKey("1", 25484258, "G", "A", "GRCh37", 500, 1));
    expect(base).not.toBe(buildSpliceAiCacheKey("2", 25484258, "G", "A", "GRCh38", 500, 1));
  });

  it("distinguishes mask variants over the wire", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(maco1Payload()));
    await fetchSpliceAiBroad("1", 25484258, "G", "A", { mask: 1 });
    await fetchSpliceAiBroad("1", 25484258, "G", "A", { mask: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("mask=1");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("mask=0");
  });
});
