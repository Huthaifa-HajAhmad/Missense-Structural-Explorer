/**
 * transcript-resolver.test.ts — the rung's retry budget, not the pipeline's.
 *
 * `getTranscriptsForProtein` sits on the critical path of EVERY locus-dependent source: the gnomAD
 * frequency and constraint fetches, the local population lookup and the conservation composite all
 * start only after the locus promise settles. A rung that takes the http-client's default 3
 * attempts (10 s each, with backoff — ~33 s worst case) can consume the whole 45 s core budget by
 * itself, which is how the FGFR3 p.Gly380Arg run (2026-11-08) expired every locus-dependent source
 * while gnomAD answered its query in 155–285 ms. Two attempts bound the rung to ~21 s and keep the
 * single flaky 5xx surviving a retry.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const fetchImpl = vi.fn();

describe("getTranscriptsForProtein — the rung does not eat the caller's budget", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", (...args: unknown[]) => fetchImpl(...args));
  });

  afterEach(() => {
    fetchImpl.mockReset();
    vi.unstubAllGlobals();
  });

  /**
   * A SLOW refusal (past the 1 s fast-refusal cutoff) is the shape that gets retried. Asserting on
   * the call count through the REAL fetchWithRetry is what pins the retry policy: a mocked client
   * would only restate the number in the argument list.
   */
  it("stops after two attempts when the provider answers slowly and badly", async () => {
    const { getTranscriptsForProtein, transcriptMappingCache } = await import("./transcript-resolver.ts");
    transcriptMappingCache.clear();
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    fetchImpl.mockImplementation(async () => {
      await delay(1100); // past FAST_REFUSAL_MS, so this shape is the retried one
      return { ok: false, status: 500, headers: new Map() };
    });

    const mapping = await getTranscriptsForProtein("Q9Y305");

    expect(mapping.refseqId).toBeNull();
    expect(mapping.ensemblId).toBeNull();
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2);
  }, 40_000);

  it("does not negative-cache transient errors on the unreviewed fallback lookup", async () => {
    const { getTranscriptsForProtein, transcriptMappingCache } = await import("./transcript-resolver.ts");
    transcriptMappingCache.clear();
    let reviewedLookups = 0;
    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).includes("reviewed%3Atrue") || String(url).includes("reviewed:true")) {
        reviewedLookups++;
        return { ok: true, status: 200, json: async () => ({ results: [] }), headers: new Map() };
      }
      if (reviewedLookups === 1) {
        return { ok: false, status: 500, headers: new Map() };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            primaryAccession: "Q9Y999",
            uniProtKBCrossReferences: [{
              database: "MANE-Select",
              id: "ENST00000999999",
              properties: [{ key: "RefSeqNucleotideId", value: "NM_000999.1" }]
            }]
          }]
        }),
        headers: new Map()
      };
    });

    const first = await getTranscriptsForProtein("TRANSIENTGENE");
    expect(first.ensemblId).toBeNull();

    const second = await getTranscriptsForProtein("TRANSIENTGENE");
    expect(second.ensemblId).toBe("ENST00000999999");
    expect(second.refseqId).toBe("NM_000999.1");
    expect(reviewedLookups).toBe(2);
  });
});
