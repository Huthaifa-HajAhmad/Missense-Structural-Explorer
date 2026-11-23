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
