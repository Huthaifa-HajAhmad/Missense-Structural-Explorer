/**
 * WP-I2: serve stale on rate limit, no caching of what was built from stale data, retention of expired
 * rows, the response header, and the shared single-flight helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LRUCache } from "lru-cache";
import { AnalysisDatabase } from "./analysis-db.ts";
import { EXPIRED_CACHE_RETENTION_MS, executePurgeExpiredExternalCache } from "./analysis-db-core.ts";
import { createCacheRegistry } from "./cache-registry.ts";
import { currentCacheScope, newCacheScope, noteBusy, noteRateLimited, runInCacheScope } from "./cache-scope.ts";
import { rateLimitedErrorFor, recordRateLimit, resetProviderPausesForTests } from "./provider-pause.ts";
import { sharedFlight, type SharedFlights } from "./shared-flight.ts";
import { markStaleResponses, staleNotes } from "./stale-response.ts";
import {
  STALE_DATA_HEADER,
  encodeStaleData,
  formatDataAge,
  parseStaleData,
  staleDataSentence,
} from "../../../src/shared/providerLimits.ts";

const HOUR = 3600_000;
const savedMode = process.env.EGRESS_GOVERNOR;

/** Writes `data` under `key` so that it expired `expiredAgoMs` ago, having been fetched `ttlMs` before that. */
function saveExpired(key: string, data: unknown, expiredAgoMs = HOUR, ttlMs = HOUR): void {
  const now = Date.now();
  vi.setSystemTime(now - expiredAgoMs - ttlMs);
  AnalysisDatabase.getInstance().saveExternalCache(key, data, "test-source", ttlMs / 1000);
  vi.setSystemTime(now);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  AnalysisDatabase.resetInstance(":memory:");
  resetProviderPausesForTests();
  process.env.EGRESS_GOVERNOR = "on";
});

afterEach(() => {
  vi.useRealTimers();
  if (savedMode === undefined) delete process.env.EGRESS_GOVERNOR;
  else process.env.EGRESS_GOVERNOR = savedMode;
});

describe("getCachedOrFetch: stale on rate limit", () => {
  it("serves the expired entry when the provider answered 429 and the fetcher swallowed it", async () => {
    const reg = createCacheRegistry();
    saveExpired("k1", { value: "old" });
    const scope = newCacheScope();
    const result = await runInCacheScope(scope, () =>
      reg.getCachedOrFetch({
        key: "k1",
        source: "UniProt FASTA",
        ttlSeconds: 3600,
        fetcher: async () => {
          recordRateLimit("rest.uniprot.org", 429, "2");
          return null;
        },
      })
    );
    expect(result).toEqual({ value: "old" });
    expect(scope.stale).toHaveLength(1);
    expect(scope.stale[0]).toMatchObject({ source: "UniProt FASTA", hosts: ["rest.uniprot.org"], busy: false });
    expect(scope.stale[0].ageSec).toBe(7200);
    expect(reg.staleServeCounts()).toEqual({ "UniProt FASTA": { served: 1, wouldServe: 0 } });
  });

  it("serves the expired entry when the team pause refused the call", async () => {
    const reg = createCacheRegistry();
    saveExpired("k2", ["old"]);
    const result = await reg.getCachedOrFetch({
      key: "k2",
      source: "s",
      fetcher: async () => {
        throw rateLimitedErrorFor("rest.ensembl.org");
      },
    });
    expect(result).toEqual(["old"]);
  });

  it("rethrows when nothing was rate limited, even with an expired entry present", async () => {
    const reg = createCacheRegistry();
    saveExpired("k3", { value: "old" });
    await expect(
      reg.getCachedOrFetch({ key: "k3", source: "s", fetcher: async () => { throw new Error("boom"); } })
    ).rejects.toThrow("boom");
  });

  it("does not serve an entry older than nothing: no expired row means the failure stands", async () => {
    const reg = createCacheRegistry();
    const result = await reg.getCachedOrFetch({
      key: "absent",
      source: "s",
      fetcher: async () => {
        noteRateLimited("rest.uniprot.org");
        return null;
      },
    });
    expect(result).toBeNull();
  });

  it("under shadow only counts what it would have served", async () => {
    process.env.EGRESS_GOVERNOR = "shadow";
    const reg = createCacheRegistry();
    saveExpired("k4", { value: "old" });
    const scope = newCacheScope();
    const result = await runInCacheScope(scope, () =>
      reg.getCachedOrFetch({
        key: "k4",
        source: "s",
        fetcher: async () => {
          recordRateLimit("rest.uniprot.org", 429, null);
          return null;
        },
      })
    );
    expect(result).toBeNull();
    expect(scope.stale).toHaveLength(0);
    expect(reg.staleServeCounts()).toEqual({ s: { served: 0, wouldServe: 1 } });
  });

  it("under off does nothing", async () => {
    process.env.EGRESS_GOVERNOR = "off";
    const reg = createCacheRegistry();
    saveExpired("k5", { value: "old" });
    const result = await reg.getCachedOrFetch({
      key: "k5",
      source: "s",
      fetcher: async () => {
        recordRateLimit("rest.uniprot.org", 429, null);
        // Even a rate limit noted by another path is not acted on under `off`.
        noteRateLimited("rest.uniprot.org");
        return null;
      },
    });
    expect(result).toBeNull();
    expect(reg.staleServeCounts()).toEqual({});
  });

  it("respects serveStale: false and isUsable", async () => {
    const reg = createCacheRegistry();
    saveExpired("k6", { value: "old" });
    const limited = async () => {
      noteRateLimited("rest.uniprot.org");
      return null;
    };
    expect(await reg.getCachedOrFetch({ key: "k6", source: "s", serveStale: false, fetcher: limited })).toBeNull();
    expect(
      await reg.getCachedOrFetch({ key: "k6", source: "s", isUsable: () => false, fetcher: limited })
    ).toBeNull();
  });

  it("serves an expired L1-only entry, aged from when it was stored", async () => {
    const reg = createCacheRegistry();
    // lru-cache ages entries by its own clock, not Date, so this waits for real.
    const l1 = new LRUCache<string, any>({ max: 10, ttl: 1000 });
    l1.set("k7", { value: "mem" });
    await new Promise(r => setTimeout(r, 1500));
    expect(l1.has("k7")).toBe(false);
    const scope = newCacheScope();
    const result = await runInCacheScope(scope, () =>
      reg.getCachedOrFetch({
        key: "k7",
        source: "s",
        l1Cache: l1,
        bypassSqlite: true,
        fetcher: async () => {
          noteRateLimited("rest.uniprot.org");
          return null;
        },
      })
    );
    expect(result).toEqual({ value: "mem" });
    expect(scope.stale).toHaveLength(1);
    // Stored 1.5 s ago (lru-cache's `info` reports the time left, not when it was stored).
    expect(scope.stale[0].ageSec).toBeGreaterThanOrEqual(1);
    expect(scope.stale[0].ageSec).toBeLessThanOrEqual(3);
  });

  it("does not cache a result built from a stale inner entry, and the outer caller sees the note", async () => {
    const reg = createCacheRegistry();
    saveExpired("inner", { seq: "OLD" });
    const scope = newCacheScope();
    const outer = await runInCacheScope(scope, () =>
      reg.getCachedOrFetch({
        key: "outer",
        source: "outer-src",
        ttlSeconds: 3600,
        fetcher: async () => {
          const inner = await reg.getCachedOrFetch<{ seq: string } | null>({
            key: "inner",
            source: "inner-src",
            fetcher: async () => {
              noteRateLimited("rest.uniprot.org");
              return null;
            },
          });
          return { built: inner?.seq };
        },
      })
    );
    expect(outer).toEqual({ built: "OLD" });
    expect(scope.stale.map(s => s.source)).toEqual(["inner-src"]);
    expect(AnalysisDatabase.getInstance().getExternalCache("outer")).toBeNull();
  });

  it("still caches a fresh result normally", async () => {
    const reg = createCacheRegistry();
    await reg.getCachedOrFetch({ key: "fresh", source: "s", ttlSeconds: 60, fetcher: async () => ({ ok: 1 }) });
    expect(AnalysisDatabase.getInstance().getExternalCache("fresh")?.data).toEqual({ ok: 1 });
  });

  it("gives a caller that joined the shared fill the same stale note as the one that started it", async () => {
    const reg = createCacheRegistry();
    saveExpired("k8", { value: "old" });
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    let calls = 0;
    const opts = {
      key: "k8",
      source: "s",
      fetcher: async () => {
        calls++;
        await gate;
        noteRateLimited("rest.uniprot.org");
        return null;
      },
    };
    const a = newCacheScope();
    const b = newCacheScope();
    const pa = runInCacheScope(a, () => reg.getCachedOrFetch(opts));
    const pb = runInCacheScope(b, () => reg.getCachedOrFetch(opts));
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    release();
    expect(await pa).toEqual({ value: "old" });
    expect(await pb).toEqual({ value: "old" });
    expect(calls).toBe(1);
    expect(a.stale).toHaveLength(1);
    expect(b.stale).toHaveLength(1);
  });
});

describe("expired rows", () => {
  it("are kept for the retention window and readable only on request", () => {
    saveExpired("recent", { v: 1 }, HOUR);
    saveExpired("ancient", { v: 2 }, EXPIRED_CACHE_RETENTION_MS + HOUR);
    const db = AnalysisDatabase.getInstance();
    expect(db.purgeExpiredExternalCache()).toBe(1);
    expect(db.getExternalCache("recent")).toBeNull();
    const row = db.getExternalCache("recent", true);
    expect(row?.data).toEqual({ v: 1 });
    expect(row?.expiresAt).not.toBeNull();
    expect(db.getExternalCache("ancient", true)).toBeNull();
  });

  it("purge takes an explicit clock", () => {
    saveExpired("x", { v: 1 }, HOUR);
    const raw = (AnalysisDatabase.getInstance() as any).db;
    expect(executePurgeExpiredExternalCache(raw, Date.now() + EXPIRED_CACHE_RETENTION_MS)).toBe(1);
  });
});

describe("cache scopes", () => {
  it("note into every enclosing scope", () => {
    const outer = newCacheScope();
    const inner = newCacheScope(outer);
    runInCacheScope(inner, () => noteRateLimited("h"));
    expect([...outer.rateLimitedHosts]).toEqual(["h"]);
    expect(currentCacheScope()).toBeNull();
  });
});

describe("X-MSE-Stale", () => {
  it("is set on a response whose request was served stale data", () => {
    const headers: Record<string, string> = {};
    const res: any = {
      headersSent: false,
      setHeader: (k: string, v: string) => (headers[k] = v),
      writeHead: vi.fn(),
    };
    const originalWriteHead = res.writeHead;
    markStaleResponses({} as any, res, () => {
      currentCacheScope()!.stale.push({ source: "UniProt FASTA", hosts: ["rest.uniprot.org"], busy: false, ageSec: 7200 });
    });
    res.writeHead(200);
    expect(originalWriteHead).toHaveBeenCalledWith(200);
    expect(parseStaleData(headers[STALE_DATA_HEADER])).toEqual([{ data: "UniProt FASTA", provider: "UniProt", ageSec: 7200 }]);
  });

  it("is absent when nothing stale was served", () => {
    const setHeader = vi.fn();
    const res: any = { headersSent: false, setHeader, writeHead: vi.fn() };
    markStaleResponses({} as any, res, () => {});
    res.writeHead(200);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it("never names a host the deployment does not call on its own account", () => {
    expect(staleNotes([{ source: "s", hosts: ["my-own-proxy.example.org"], busy: true, ageSec: 5 }])).toEqual([
      { data: "s", provider: "A remote provider", ageSec: 5, busy: true },
    ]);
  });

  it("round-trips, keeps the oldest age per data and provider, caps at five and rejects junk", () => {
    const value = encodeStaleData([
      { data: "UniProt FASTA", provider: "UniProt", ageSec: 10 },
      { data: "UniProt FASTA", provider: "UniProt", ageSec: 7200 },
      { data: "VEP", provider: "Ensembl", ageSec: 90, busy: true },
    ]);
    expect(parseStaleData(value)).toEqual([
      { data: "UniProt FASTA", provider: "UniProt", ageSec: 7200 },
      { data: "VEP", provider: "Ensembl", ageSec: 90, busy: true },
    ]);
    const many = Array.from({ length: 8 }, (_, i) => ({ data: `d${i}`, provider: "P", ageSec: i }));
    expect(parseStaleData(encodeStaleData(many))).toHaveLength(5);
    expect(parseStaleData("not json")).toEqual([]);
    expect(parseStaleData('[{"data":"d","provider":"","ageSec":1},{"data":"d","provider":"X","ageSec":-1},{"provider":"X","ageSec":1}]')).toEqual([]);
    expect(parseStaleData(null)).toEqual([]);
  });

  it("reads as a sentence naming the data, its age and the hold-up", () => {
    expect(formatDataAge(0)).toBe("under a minute");
    expect(formatDataAge(40)).toBe("under a minute");
    expect(formatDataAge(720)).toBe("12 min");
    expect(formatDataAge(3 * 3600 + 5)).toBe("3 h");
    expect(formatDataAge(2 * 86_400)).toBe("2 d");
    expect(staleDataSentence([{ data: "UniProt FASTA", provider: "UniProt", ageSec: 3 * 3600 }])).toBe(
      "Showing UniProt FASTA data saved 3 h ago; UniProt is limiting requests."
    );
    expect(staleDataSentence([{ data: "VEP", provider: "Ensembl", ageSec: 120, busy: true }])).toBe(
      "Showing VEP data saved 2 min ago; Ensembl is busy with other requests from the team."
    );
    expect(
      staleDataSentence([
        { data: "UniProt FASTA", provider: "UniProt", ageSec: 3 * 3600 },
        { data: "UniProt features", provider: "UniProt", ageSec: 120 },
      ])
    ).toBe("Showing saved data: UniProt FASTA (3 h old), UniProt features (2 min old); UniProt is limiting requests.");
    expect(staleDataSentence([])).toBe("");
  });

  it("names the stale data, not a sibling call's provider", () => {
    expect(staleNotes([{ source: "UniProt FASTA", hosts: ["rest.ensembl.org"], busy: false, ageSec: 60 }])).toEqual([
      { data: "UniProt FASTA", provider: "Ensembl", ageSec: 60 },
    ]);
  });
});

describe("sharedFlight", () => {
  it("makes one call for concurrent callers", async () => {
    const flights: SharedFlights<number> = new Map();
    let calls = 0;
    const run = async () => {
      calls++;
      await new Promise(r => setImmediate(r));
      return 7;
    };
    const results = await Promise.all([sharedFlight(flights, "k", run), sharedFlight(flights, "k", run)]);
    expect(results).toEqual([7, 7]);
    expect(calls).toBe(1);
    expect(flights.size).toBe(0);
  });

  it("lets one caller give up without failing the others", async () => {
    const flights: SharedFlights<string> = new Map();
    let release!: (v: string) => void;
    const run = () => new Promise<string>(r => (release = r));
    const ctrl = new AbortController();
    const quitter = sharedFlight(flights, "k", run, { signal: ctrl.signal });
    const stayer = sharedFlight(flights, "k", run);
    ctrl.abort(new Error("closed tab"));
    await expect(quitter).rejects.toThrow("closed tab");
    release("done");
    await expect(stayer).resolves.toBe("done");
  });

  it("lingers only results lingerIf accepts, and never failures", async () => {
    vi.useFakeTimers();
    const flights: SharedFlights<string | null> = new Map();
    const opts = { lingerMs: 60_000, lingerIf: (v: string | null) => v !== null };
    await sharedFlight(flights, "job", async () => "job-1", opts);
    expect(flights.has("job")).toBe(true);
    expect(await sharedFlight(flights, "job", async () => "job-2", opts)).toBe("job-1");
    await vi.advanceTimersByTimeAsync(60_001);
    expect(flights.has("job")).toBe(false);

    await sharedFlight(flights, "none", async () => null, opts);
    await Promise.resolve();
    expect(flights.has("none")).toBe(false);

    await sharedFlight(flights, "err", async () => { throw new Error("x"); }, opts).catch(() => {});
    await Promise.resolve();
    expect(flights.has("err")).toBe(false);
  });
});

describe("shared work reports to every caller (review 5)", () => {
  it("sharedFlight: a joiner learns of the rate limit the shared call met", async () => {
    const flights: SharedFlights<null> = new Map();
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const run = async () => {
      await gate;
      noteRateLimited("rest.uniprot.org");
      return null;
    };
    const a = newCacheScope();
    const b = newCacheScope();
    const pa = runInCacheScope(a, () => sharedFlight(flights, "k", run));
    const pb = runInCacheScope(b, () => sharedFlight(flights, "k", run));
    release();
    await Promise.all([pa, pb]);
    expect([...a.rateLimitedHosts]).toEqual(["rest.uniprot.org"]);
    expect([...b.rateLimitedHosts]).toEqual(["rest.uniprot.org"]);
  });

  it("sharedFlight: a caller whose signal already aborted starts nothing", async () => {
    const flights: SharedFlights<number> = new Map();
    const run = vi.fn(async () => 1);
    const ctrl = new AbortController();
    ctrl.abort(new Error("gone"));
    await expect(sharedFlight(flights, "k", run, { signal: ctrl.signal })).rejects.toThrow("gone");
    expect(run).not.toHaveBeenCalled();
    expect(flights.size).toBe(0);
  });

  it("registry singleFlight: a joiner learns of the stale serve inside the shared work", async () => {
    const reg = createCacheRegistry();
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const work = async () => {
      await gate;
      currentCacheScope()!.stale.push({ source: "s", hosts: ["h"], busy: false, ageSec: 1 });
      return 1;
    };
    const a = newCacheScope();
    const b = newCacheScope();
    const pa = runInCacheScope(a, () => reg.singleFlight("k", work));
    const pb = runInCacheScope(b, () => reg.singleFlight("k", work));
    release();
    await Promise.all([pa, pb]);
    expect(a.stale).toHaveLength(1);
    expect(b.stale).toHaveLength(1);
  });

  it("a turn that did not come in time is 'busy', and still lets the cache serve its saved copy", async () => {
    const reg = createCacheRegistry();
    saveExpired("busy", { value: "old" });
    const scope = newCacheScope();
    const result = await runInCacheScope(scope, () =>
      reg.getCachedOrFetch({
        key: "busy",
        source: "VEP",
        fetcher: async () => {
          noteBusy("rest.ensembl.org");
          return null;
        },
      })
    );
    expect(result).toEqual({ value: "old" });
    expect(scope.stale[0]).toMatchObject({ hosts: ["rest.ensembl.org"], busy: true });
  });

  it("a caller that refuses stale data does not join a fill that may serve it", async () => {
    const reg = createCacheRegistry();
    saveExpired("fresh-only", { value: "old" });
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await gate;
      noteRateLimited("rest.uniprot.org");
      return null;
    };
    const lenient = reg.getCachedOrFetch({ key: "fresh-only", source: "s", fetcher });
    const strict = reg.getCachedOrFetch({ key: "fresh-only", source: "s", serveStale: false, fetcher });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    release();
    expect(await lenient).toEqual({ value: "old" });
    expect(await strict).toBeNull();
    expect(calls).toBe(2);
  });
});

