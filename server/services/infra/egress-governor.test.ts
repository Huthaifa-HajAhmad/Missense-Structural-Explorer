import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchWithRetry, governedFetch, resetHostStateForTests, setBackoffScaleForTests } from "./http-client.ts";
import { runWithEgressOwner, EGRESS_SYSTEM_OWNER } from "./egress-context.ts";
import {
  governed,
  governorHealth,
  isEgressWaitExceeded,
  isLocalHost,
  limitBasisFor,
  noteEgressAnswer,
  resetEgressGovernorForTests,
} from "./egress-governor.ts";
import { isProviderRateLimited, pauseRemainingMs, resetProviderPausesForTests } from "./provider-pause.ts";

/**
 * WP-I1: the fair-share egress governor (doc/COMPUTE_ROUTING_PLAN.md).
 *
 * Calls are held open with deferred promises, so the order in which the governor lets them through is
 * observed directly instead of inferred from timing.
 */

const HOST = "provider.example.org";
const URL_ = (n: number | string) => `https://${HOST}/item/${n}`;

function ok(status = 200, retryAfter: string | null = null) {
  return {
    ok: status < 400,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

/** A fetch mock whose calls stay open until released, in any order. */
function heldFetch() {
  const pending: { url: string; release: () => void }[] = [];
  const spy = vi.spyOn(global, "fetch").mockImplementation(
    (input: any) =>
      new Promise<Response>(resolve => {
        pending.push({ url: String(input), release: () => resolve(ok()) });
      })
  );
  return { pending, spy };
}

const flush = () => new Promise(r => setTimeout(r, 0));

const saved = { mode: process.env.EGRESS_GOVERNOR, limits: process.env.EGRESS_PROVIDER_LIMITS_JSON };

beforeEach(() => {
  process.env.EGRESS_GOVERNOR = "on";
  delete process.env.EGRESS_PROVIDER_LIMITS_JSON;
  resetEgressGovernorForTests();
  resetProviderPausesForTests();
  resetHostStateForTests();
  setBackoffScaleForTests(0);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setBackoffScaleForTests(1);
  for (const [k, v] of [["EGRESS_GOVERNOR", saved.mode], ["EGRESS_PROVIDER_LIMITS_JSON", saved.limits]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEgressGovernorForTests();
});

describe("fair share", () => {
  it("user X issues 100 calls, user Y issues 1: Y's call completes before X's third", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const { pending } = heldFetch();
    const done: string[] = [];

    const xs = Array.from({ length: 100 }, (_, i) =>
      runWithEgressOwner("user-x", () => fetchWithRetry(URL_(`x${i}`), { timeout: 5_000 }, 1, 0)).then(() =>
        done.push(`x${i}`)
      )
    );
    await flush();
    const y = runWithEgressOwner("user-y", () => fetchWithRetry(URL_("y"), { timeout: 5_000 }, 1, 0)).then(() =>
      done.push("y")
    );

    for (let i = 0; i < 101; i++) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0), { interval: 1, timeout: 2_000 });
      pending.shift()!.release();
    }
    await Promise.all([...xs, y]);

    expect(done.indexOf("y")).toBeLessThan(done.indexOf("x2"));
    expect(done.indexOf("y")).toBe(1);
  });

  it("a person alone gets every slot: no idle capacity", async () => {
    const { pending } = heldFetch();
    const calls = Array.from({ length: 5 }, (_, i) =>
      runWithEgressOwner("user-x", () => fetchWithRetry(URL_(i), { timeout: 5_000 }, 1, 0))
    );
    await flush();
    expect(pending).toHaveLength(5);
    pending.forEach(p => p.release());
    await Promise.all(calls);
  });

  it("unrequested work (system) waits until no person is waiting", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const { pending } = heldFetch();
    const order: string[] = [];
    const first = runWithEgressOwner("user-x", () => governedFetch(URL_("first"))).then(() => order.push("first"));
    await flush();
    const sys = runWithEgressOwner(EGRESS_SYSTEM_OWNER, () => governedFetch(URL_("prewarm"))).then(() =>
      order.push("prewarm")
    );
    const person = runWithEgressOwner("user-y", () => governedFetch(URL_("person"))).then(() => order.push("person"));
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0), { interval: 1, timeout: 2_000 });
      pending.shift()!.release();
    }
    await Promise.all([first, sys, person]);
    expect(order).toEqual(["first", "person", "prewarm"]);
  });
});

describe("waiting against a deadline", () => {
  it("a call whose turn would come after its deadline fails with the typed error and is never sent", async () => {
    vi.useFakeTimers();
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const { pending, spy } = heldFetch();
    const blocker = governedFetch(URL_("blocker"));
    await vi.advanceTimersByTimeAsync(0);

    const late = governedFetch(URL_("late"), { deadlineAt: Date.now() + 3_000 }).catch(e => e);
    await vi.advanceTimersByTimeAsync(1_600);
    const err = await late;
    expect(isEgressWaitExceeded(err)).toBe(true);
    expect(err.message).toBe(`${HOST} is busy with other requests from the team; try again in a moment.`);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(governorHealth()[0]).toMatchObject({ refused: 1, held: 1, waiting: 0 });

    pending[0].release();
    await blocker;
  });

  it("an aborted waiter leaves the queue without being sent", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const { pending, spy } = heldFetch();
    const blocker = governedFetch(URL_("blocker"));
    await flush();
    const ac = new AbortController();
    const aborted = governedFetch(URL_("aborted"), { signal: ac.signal }).catch(e => e);
    ac.abort(new Error("caller gave up"));
    expect((await aborted).message).toBe("caller gave up");
    pending[0].release();
    await blocker;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(governorHealth()[0].waiting).toBe(0);
  });
});

describe("rates: documented, observed, adaptive", () => {
  it("Ensembl's published 15/s: a burst of 15 goes at once and the 16th waits for a token", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => ok());
    const calls = Array.from({ length: 16 }, (_, i) => governed("rest.ensembl.org", () => fetch(`https://rest.ensembl.org/${i}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(15);
    await vi.advanceTimersByTimeAsync(70); // one token at 900/min = 66.7 ms
    expect(spy).toHaveBeenCalledTimes(16);
    await Promise.all(calls);
    const ensembl = governorHealth().find(p => p.id === "ensembl")!;
    // 11 waited: calls 6-15 for one of the 5 slots (each answer frees one at once), and the 16th for a token.
    expect(ensembl).toMatchObject({ ratePerMin: 900, limitBasis: "documented", held: 11, maxConcurrent: 5 });
    expect(ensembl.source).toMatch(/^https:\/\/github\.com\/Ensembl/);
  });

  it("a 429 halves a documented rate; successes raise it again but never above the published limit", () => {
    noteEgressAnswer("rest.ensembl.org", 200); // creates the state
    noteEgressAnswer("rest.ensembl.org", 429);
    expect(governorHealth()[0].ratePerMin).toBe(450);
    for (let i = 0; i < 20 * 40; i++) noteEgressAnswer("rest.ensembl.org", 200);
    expect(governorHealth()[0].ratePerMin).toBe(900);
    expect(limitBasisFor("rest.ensembl.org")).toBe("documented");
  });

  it("an unmeasured provider learns a rate from its first 429 and says so", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => ok());
    for (let i = 0; i < 10; i++) await governedFetch(URL_(i));
    expect(limitBasisFor(HOST)).toBe("unmeasured");
    expect(governorHealth()[0].ratePerMin).toBeNull();

    noteEgressAnswer(HOST, 429);
    expect(limitBasisFor(HOST)).toBe("observed");
    expect(governorHealth()[0].ratePerMin).toBe(5); // half of the 10 calls in the last minute
  });

  it("NCBI's limit follows the API key", () => {
    delete process.env.NCBI_API_KEY;
    noteEgressAnswer("eutils.ncbi.nlm.nih.gov", 200);
    expect(governorHealth()[0]).toMatchObject({ ratePerMin: 180, maxConcurrent: 3, credentialKind: "ip" });
    process.env.NCBI_API_KEY = "k";
    resetEgressGovernorForTests();
    noteEgressAnswer("eutils.ncbi.nlm.nih.gov", 200);
    expect(governorHealth()[0]).toMatchObject({ ratePerMin: 600, credentialKind: "server-key" });
    delete process.env.NCBI_API_KEY;
  });

  it("a malformed EGRESS_PROVIDER_LIMITS_JSON is ignored, not fatal", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = '{"ensembl":{"ratePerMin":-3}}';
    resetEgressGovernorForTests();
    noteEgressAnswer("rest.ensembl.org", 200);
    expect(governorHealth()[0].ratePerMin).toBe(900);
  });
});

describe("governedFetch and the team-wide pause", () => {
  it("a 429 received through governedFetch pauses the provider for everyone and teaches the governor", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => ok(429, "6"));
    const res = await runWithEgressOwner("user-x", () => governedFetch(URL_(1)));
    expect(res.status).toBe(429); // the caller still sees its own answer
    expect(pauseRemainingMs(HOST)).toBeGreaterThan(5_000);

    const other = await runWithEgressOwner("user-y", () => governedFetch(URL_(2))).catch(e => e);
    expect(isProviderRateLimited(other)).toBe(true);
    expect(governorHealth()[0]).toMatchObject({ rateLimits: 1, limitBasis: "unmeasured", ratePerMin: null });
  });

  it("loopback, private and dotless hosts (the model sidecar) are never governed", async () => {
    for (const h of ["127.0.0.1", "localhost", "sidecar", "10.0.0.4", "172.20.1.1", "192.168.1.9", "::1"]) {
      expect(isLocalHost(h)).toBe(true);
    }
    expect(isLocalHost("172.32.0.1")).toBe(false);
    vi.spyOn(global, "fetch").mockImplementation(async () => ok());
    await governedFetch("http://127.0.0.1:8000/predict/esmfold", { method: "POST" });
    expect(governorHealth()).toEqual([]);
  });
});

describe("modes", () => {
  it("off: straight through, nothing recorded", async () => {
    process.env.EGRESS_GOVERNOR = "off";
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const { pending } = heldFetch();
    const calls = [governedFetch(URL_(1)), governedFetch(URL_(2)), governedFetch(URL_(3))];
    await flush();
    expect(pending).toHaveLength(3);
    pending.forEach(p => p.release());
    await Promise.all(calls);
    expect(governorHealth()).toEqual([]);
  });

  it("shadow: nothing waits, and every call that would have waited is counted", async () => {
    process.env.EGRESS_GOVERNOR = "shadow";
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const { pending } = heldFetch();
    const calls = [governedFetch(URL_(1)), governedFetch(URL_(2)), governedFetch(URL_(3))];
    await flush();
    expect(pending).toHaveLength(3);
    pending.forEach(p => p.release());
    await Promise.all(calls);
    expect(governorHealth()[0]).toMatchObject({ calls: 3, wouldHold: 2, held: 0, inFlight: 0 });
  });

  it("health probes are not governed", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const { pending } = heldFetch();
    const blocker = governedFetch(URL_("blocker"));
    await flush();
    const probe = fetchWithRetry(URL_("ping"), { timeout: 5_000, probe: true }, 1, 0);
    await flush();
    expect(pending).toHaveLength(2);
    pending.forEach(p => p.release());
    await Promise.all([blocker, probe]);
  });
});
