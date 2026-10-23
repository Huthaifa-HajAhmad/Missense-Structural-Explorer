import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  coreSingleflightKey,
  coreSingleflightStats,
  isCoreFetchInFlight,
  resetCoreSingleflightForTests,
  runSharedCoreFetch
} from "./core-singleflight.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";
import { newCacheScope, noteRateLimited, runInCacheScope } from "../infra/cache-scope.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE RUNNING CORE FETCH PER SCIENTIFIC IDENTITY
 * ─────────────────────────────────────────────────────────────────────────────
 * The routes that need core data are fired together by the UI: the stream, then the structural tab,
 * then the landscape/multimer requests. They miss the same database row at the same instant, and
 * before this module each launched all eleven providers. These tests pin both halves of the rule:
 * the same identity shares ONE run, and anything that differs — weighting, credential, context —
 * does not.
 */
vi.mock("../external-api/core-data-fetcher.ts", () => ({
  fetchCoreVariantData: vi.fn(async () => ({ clinvar: { classification: "Pathogenic" }, serviceStatus: {} }))
}));

const baseContext: ParsedVariantContext = {
  gene: "PAH",
  variant: "p.Arg408Trp",
  uniprotId: "P00439",
  originalNotation: "p.Arg408Trp",
  acmgWeighting: "standard",
  sequence: "MKVLIVGLGNCGVFSLLDKN",
  pos: 408,
  residueIndex: "408",
  wildType: "Arg",
  mutant: "Trp",
  wt1Letter: "R",
  mut1Letter: "W"
};

const fetchCore = async () => {
  const mod = await import("../external-api/core-data-fetcher.ts");
  return vi.mocked(mod.fetchCoreVariantData as any);
};

describe("core singleflight", () => {
  beforeEach(async () => {
    resetCoreSingleflightForTests();
    const mocked = await fetchCore();
    mocked.mockClear();
    mocked.mockImplementation(async () => ({ clinvar: { classification: "Pathogenic" }, serviceStatus: {} }));
  });

  /** A promise plus the handle that settles it, so a run can be held open deliberately. */
  const deferred = <T,>() => {
    let release!: (value: T) => void;
    const promise = new Promise<T>(resolve => { release = resolve; });
    return { promise, release };
  };

  it("tells every caller of a shared run what its fetches met (WP-I2)", async () => {
    const gate = deferred<any>();
    const mocked = await fetchCore();
    mocked.mockImplementationOnce(async () => {
      const value = await gate.promise;
      noteRateLimited("eutils.ncbi.nlm.nih.gov");
      return value;
    });
    const a = newCacheScope();
    const b = newCacheScope();
    const first = runInCacheScope(a, () => runSharedCoreFetch(baseContext));
    const second = runInCacheScope(b, () => runSharedCoreFetch(baseContext));
    gate.release({ clinvar: { classification: "Pathogenic" } });
    await Promise.all([first, second]);
    expect([...a.rateLimitedHosts]).toEqual(["eutils.ncbi.nlm.nih.gov"]);
    expect([...b.rateLimitedHosts]).toEqual(["eutils.ncbi.nlm.nih.gov"]);
  });

  it("immediately replays the latest cumulative evidence to a late subscriber", async () => {
    const gate = deferred<any>();
    const mocked = await fetchCore();
    const snapshot = { data: { uniprotFeatures: { domains: [] } }, serviceStatus: { uniprotFeatures: "ok", clinvar: "pending" }, serviceTimings: {}, serviceTimingOffsets: {} };
    mocked.mockImplementationOnce((_ctx: any, _timeout: any, _pre: any, publish: any) => {
      publish(snapshot);
      return gate.promise;
    });
    const first = runSharedCoreFetch(baseContext);
    const seen = vi.fn();
    const second = runSharedCoreFetch(baseContext, { onPartial: seen });
    expect(seen).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(mocked).toHaveBeenCalledTimes(1);
    gate.release({ serviceStatus: {} });
    await Promise.all([first, second]);
  });

  it("starts ONE fetch for two concurrent callers with the same identity", async () => {
    const gate = deferred<any>();
    const mocked = await fetchCore();
    mocked.mockImplementationOnce(() => gate.promise);

    const first = runSharedCoreFetch(baseContext);
    const second = runSharedCoreFetch(baseContext);

    expect(mocked).toHaveBeenCalledTimes(1);
    expect(coreSingleflightStats().inFlight).toBe(1);

    gate.release({ clinvar: { classification: "Pathogenic" } });
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(coreSingleflightStats()).toMatchObject({ started: 1, joined: 1, completed: 1 });
    // Only RUNNING runs are shared: the entry is gone once it settles.
    expect(isCoreFetchInFlight(baseContext)).toBe(false);
    expect(coreSingleflightStats().inFlight).toBe(0);
  });

  it("fans a run's progress out to every listener, and retires only the one that throws", async () => {
    const firstPartial = { data: { esm2: { llr: -1 } }, serviceStatus: {}, serviceTimings: {}, serviceTimingOffsets: {} };
    const secondPartial = { data: { gnomadFrequency: null }, serviceStatus: {}, serviceTimings: {}, serviceTimingOffsets: {} };
    const mocked = await fetchCore();
    mocked.mockImplementationOnce(async (_ctx: any, _timeout: any, _pre: any, onPartial: any) => {
      // Asynchronously, so BOTH callers have registered by the time the first source settles — which
      // is the real shape: a joiner attaches while the run is still in flight.
      await Promise.resolve();
      onPartial(firstPartial);
      await Promise.resolve();
      onPartial(secondPartial);
      return { clinvar: null, serviceStatus: {} };
    });

    const seenByFirst: any[] = [];
    const seenBySecond: any[] = [];
    const first = runSharedCoreFetch(baseContext, {
      onPartial: partial => {
        seenByFirst.push(partial);
        throw new Error("torn socket");
      }
    });
    const second = runSharedCoreFetch(baseContext, { onPartial: partial => seenBySecond.push(partial) });

    await Promise.all([first, second]);

    // The failing writer is retired alone: the other caller of the same run still gets both previews.
    expect(seenByFirst.length, "the failing listener must not be called again").toBe(1);
    expect(seenBySecond.length).toBe(2);
    expect(seenBySecond[0]).toBe(firstPartial);
    expect(seenBySecond[1]).toBe(secondPartial);
  });

  /**
   * THE SAPROT SPLIT. The client sends `saprotEngine` on the structural request and nowhere else, so a
   * flight key that included it started a SECOND full core fetch for every non-default checkpoint —
   * while the core evidence for both is the same, because the core graph does not run SaProt.
   */
  it("shares ONE core fetch for identical science and auth across different SaProt checkpoints", async () => {
    const gate = deferred<any>();
    const mocked = await fetchCore();
    mocked.mockImplementation(() => gate.promise);

    const coreRequest = runSharedCoreFetch(baseContext); // no saprotEngine, as the client sends it
    const structural35 = runSharedCoreFetch({ ...baseContext, saprotEngine: "saprot-35m" });
    const structural650 = runSharedCoreFetch({ ...baseContext, saprotEngine: "saprot-650m" });
    const structuralDefault = runSharedCoreFetch({ ...baseContext, saprotEngine: "saprot-650m" });

    expect(mocked, "one checkpoint is not three core fetches").toHaveBeenCalledTimes(1);
    expect(coreSingleflightStats()).toMatchObject({ started: 1, joined: 3 });

    gate.release({ clinvar: { classification: "Pathogenic" }, serviceStatus: {} });
    const [a, b, c, d] = await Promise.all([coreRequest, structural35, structural650, structuralDefault]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
  });

  it("refuses to share across a different weighting, sequence or coordinate trail", async () => {
    const gate = deferred<any>();
    const mocked = await fetchCore();
    mocked.mockImplementation(() => gate.promise);

    const standard = runSharedCoreFetch(baseContext);
    const conservative = runSharedCoreFetch({ ...baseContext, acmgWeighting: "conservative" });
    const strict = runSharedCoreFetch({ ...baseContext, acmgWeighting: "strict-structural" });
    const otherSequence = runSharedCoreFetch({ ...baseContext, sequence: "MKVLIVGLGNCGVFSLLDKM" });
    const lifted = runSharedCoreFetch({
      ...baseContext,
      assembly: "GRCh37",
      genomicCoordinates: "1-1256452-C-A",
      resolvedAssembly: "GRCh38",
      liftedGenomicCoordinates: "1-1321072-C-A"
    });

    // Five distinct scientific identities: five runs, not one.
    expect(mocked).toHaveBeenCalledTimes(5);
    expect(coreSingleflightStats()).toMatchObject({ started: 5, joined: 0 });

    gate.release({ clinvar: null, serviceStatus: {} });
    await Promise.all([standard, conservative, strict, otherSequence, lifted]);
  });

  /**
   * Auth capability scoping, and the boundary that no key material crosses.
   *
   * A run made with a token is not the same evidence as a run made without one (the token gates
   * GPN-Star, ESM-2 650M, VESM, SaProt, ESM3, and the live AlphaGenome score), so the two must not
   * share. Two DIFFERENT Hugging Face or Biohub tokens do share (WP-I4): the answer does not depend on
   * whose token asked, so two people make one upstream call. The flight key never contains a token.
   */
  it("scopes runs by whether a credential is present, not by which one, without putting it in the key", async () => {
    const gate = deferred<any>();
    const mocked = await fetchCore();
    mocked.mockImplementation(() => gate.promise);

    const tokenA = "hf_secret_token_alpha_9000";
    const tokenB = "hf_secret_token_beta_9001";

    const withoutToken = runSharedCoreFetch(baseContext);
    const withA = runSharedCoreFetch({ ...baseContext, hfToken: tokenA });
    const withA2 = runSharedCoreFetch({ ...baseContext, hfToken: tokenA });
    const withB = runSharedCoreFetch({ ...baseContext, hfToken: tokenB });

    expect(mocked).toHaveBeenCalledTimes(2);
    expect(coreSingleflightStats()).toMatchObject({ started: 2, joined: 2 });

    const keyWithA = coreSingleflightKey({ ...baseContext, hfToken: tokenA });
    expect(keyWithA).not.toContain(tokenA);
    expect(keyWithA).not.toContain("hf_secret_token");
    expect(keyWithA).toBe(coreSingleflightKey({ ...baseContext, hfToken: tokenB }));
    expect(keyWithA).not.toBe(coreSingleflightKey(baseContext));

    gate.release({ clinvar: null, serviceStatus: {} });
    await Promise.all([withoutToken, withA, withA2, withB]);
  });

  it("delivers a run's failure to every caller awaiting it", async () => {
    const mocked = await fetchCore();
    mocked.mockImplementationOnce(async () => {
      throw new Error("fatal provider fault");
    });

    const first = runSharedCoreFetch(baseContext);
    const second = runSharedCoreFetch(baseContext);

    await expect(first).rejects.toThrow("fatal provider fault");
    await expect(second).rejects.toThrow("fatal provider fault");
    expect(coreSingleflightStats()).toMatchObject({ failed: 1 });
    expect(coreSingleflightStats().inFlight).toBe(0);
  });
});
