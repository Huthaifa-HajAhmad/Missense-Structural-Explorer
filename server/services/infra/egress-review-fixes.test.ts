import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import {
  fetchWithRetry,
  governedFetch,
  redactUrl,
  resetHostStateForTests,
  setBackoffScaleForTests,
} from "./http-client.ts";
import { EGRESS_SYSTEM_OWNER, currentEgressOwner, runWithEgressOwner } from "./egress-context.ts";
import {
  DECREASE_COOLDOWN_MS,
  LEARNED_RATE_TTL_MS,
  MAX_RUNTIME_HOSTS,
  SYSTEM_AGING_MS,
  governed,
  governorHealth,
  isEgressRefusal,
  isEgressWaitExceeded,
  isLocalHost,
  noteEgressAnswer,
  resetEgressGovernorForTests,
} from "./egress-governor.ts";
import { ProviderRateLimitedError, resetProviderPausesForTests } from "./provider-pause.ts";
import { SYSTEM_OWNER } from "./queue-owners.ts";
import { SQLiteQueue } from "./biophysical-queue.ts";

/**
 * WP-I1 review fixes: each test pins one finding from the four-reviewer pass (2026-10-13).
 */

const ENSEMBL = "rest.ensembl.org";
const HOST = "provider.example.org";

function answer(status = 200, retryAfter: string | null = null) {
  return {
    ok: status < 400,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

const health = (id: string) => governorHealth().find(p => p.id === id)!;
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

describe("rate adaptation (review: a burst of 429s collapsed a published rate)", () => {
  it("five 429s to calls already in flight are ONE halving, not five", () => {
    const t = Date.now();
    for (let i = 0; i < 5; i++) noteEgressAnswer(ENSEMBL, 429, null, t + i * 100);
    expect(health("ensembl")).toMatchObject({ ratePerMin: 450, rateLimits: 5 });
  });

  it("a published rate is never cut below a tenth of itself", () => {
    let t = Date.now();
    for (let i = 0; i < 12; i++) {
      noteEgressAnswer(ENSEMBL, 429, null, t);
      t += DECREASE_COOLDOWN_MS + 1;
    }
    expect(health("ensembl").ratePerMin).toBe(90);
  });

  it("a 503 with Retry-After is a rate-limit answer; a bare 503 is not", () => {
    const t = Date.now();
    noteEgressAnswer(ENSEMBL, 503, null, t);
    expect(health("ensembl").ratePerMin).toBe(900);
    noteEgressAnswer(ENSEMBL, 503, "4", t);
    expect(health("ensembl").ratePerMin).toBe(450);
  });

  it("successes raise a rate by 5% (at least 1/min) per 20", () => {
    const t = Date.now();
    noteEgressAnswer(ENSEMBL, 429, null, t); // 900 -> 450
    for (let i = 0; i < 20; i++) noteEgressAnswer(ENSEMBL, 200, null, t);
    expect(health("ensembl").ratePerMin).toBe(472.5);
  });
});

describe("learning a rate (review: boundaries untested; a non-volume 429 pinned a host)", () => {
  async function calls(n: number) {
    vi.spyOn(global, "fetch").mockImplementation(async () => answer());
    for (let i = 0; i < n; i++) await governedFetch(`https://${HOST}/${i}`);
  }

  it("9 calls in a minute then a 429: nothing is learned", async () => {
    await calls(9);
    noteEgressAnswer(HOST, 429);
    expect(health(HOST)).toMatchObject({ ratePerMin: null, limitBasis: "unmeasured" });
  });

  it("12 calls in a minute then a 429: half that pace, observed", async () => {
    await calls(12);
    noteEgressAnswer(HOST, 429);
    expect(health(HOST)).toMatchObject({ ratePerMin: 6, limitBasis: "observed" });
  });

  it("a learned rate is forgotten after an hour without another rate-limit answer", async () => {
    await calls(12);
    const t = Date.now();
    noteEgressAnswer(HOST, 429, null, t);
    noteEgressAnswer(HOST, 200, null, t + LEARNED_RATE_TTL_MS + 1);
    expect(health(HOST)).toMatchObject({ ratePerMin: null, limitBasis: "unmeasured" });
  });
});

describe("EGRESS_PROVIDER_LIMITS_JSON (review: a hostname key replaced a published limit)", () => {
  it("a hostname key merges into the registry entry: source kept, and the override is the new ceiling", () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ "rest.ensembl.org": { ratePerMin: 600 } });
    resetEgressGovernorForTests();
    for (let i = 0; i < 800; i++) noteEgressAnswer(ENSEMBL, 200);
    expect(health("ensembl")).toMatchObject({ ratePerMin: 600, limitBasis: "documented" });
    expect(health("ensembl").source).toMatch(/Ensembl/);
  });

  it("an override above the published rate is held to the published rate", () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ ensembl: { ratePerMin: 5000 } });
    resetEgressGovernorForTests();
    noteEgressAnswer(ENSEMBL, 200);
    expect(health("ensembl").ratePerMin).toBe(900);
  });

  it("a bad entry is skipped on its own; the good ones still apply", () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({
      ensembl: { ratePerMin: 1e-9 },
      [HOST]: { ratePerMin: 30 },
    });
    resetEgressGovernorForTests();
    noteEgressAnswer(ENSEMBL, 200);
    for (let i = 0; i < 200; i++) noteEgressAnswer(HOST, 200);
    expect(health("ensembl").ratePerMin).toBe(900);
    expect(health(HOST)).toMatchObject({ ratePerMin: 30, limitBasis: "configured" });
  });
});

describe("fairness (review: prewarm was refused, not delayed, under steady person load)", () => {
  it("a system call that has waited 30 s is served in turn with the people", async () => {
    vi.useFakeTimers();
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const order: string[] = [];
    const call = (owner: string, name: string, ms: number) =>
      runWithEgressOwner(owner, () =>
        governed(HOST, () => new Promise<void>(r => setTimeout(r, ms)).then(() => void order.push(name)))
      );
    // A person keeps 30 two-second calls queued: without aging, prewarm would wait a minute behind them.
    const person = Promise.all(Array.from({ length: 30 }, (_, i) => call("user-x", `x${i}`, 2_000)));
    await vi.advanceTimersByTimeAsync(10);
    const sys = call(EGRESS_SYSTEM_OWNER, "prewarm", 10);
    await vi.advanceTimersByTimeAsync(SYSTEM_AGING_MS + 4_100);
    expect(order).toContain("prewarm");
    expect(order.filter(n => n.startsWith("x")).length).toBeLessThan(20);
    await vi.advanceTimersByTimeAsync(70_000);
    await Promise.all([person, sys]);
  });

  it("the governor's system owner is the queue's", () => {
    expect(EGRESS_SYSTEM_OWNER).toBe(SYSTEM_OWNER);
  });
});

describe("retries (review: a retry held its slot through the backoff and took one turn)", () => {
  it("the backoff between attempts frees the slot for someone else", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    setBackoffScaleForTests(1);
    const seen: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      seen.push(url.endsWith("/slow") ? "slow" : "other");
      if (url.endsWith("/slow") && seen.filter(s => s === "slow").length === 1) {
        await new Promise(r => setTimeout(r, 1_100)); // slow 500: retried
        return answer(500);
      }
      return answer(200);
    });
    const slow = runWithEgressOwner("user-x", () => fetchWithRetry(`https://${HOST}/slow`, { timeout: 5_000 }, 2, 300));
    await new Promise(r => setTimeout(r, 1_150)); // the first attempt has failed; its backoff is running
    await runWithEgressOwner("user-y", () => fetchWithRetry(`https://${HOST}/other`, { timeout: 5_000 }, 1, 0));
    expect((await slow).status).toBe(200);
    expect(seen).toEqual(["slow", "other", "slow"]);
    expect(health(HOST).calls).toBe(3); // one turn per attempt
  });

  it("a call without a deadline waits for its turn no longer than its own timeout", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    let release!: () => void;
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      () => new Promise<Response>(r => (release = () => r(answer())))
    );
    const blocker = fetchWithRetry(`https://${HOST}/a`, { timeout: 60_000 }, 1, 0);
    await new Promise(r => setTimeout(r, 5));
    const t0 = Date.now();
    const err = await fetchWithRetry(`https://${HOST}/b`, { timeout: 100 }, 3, 0).catch(e => e);
    expect(isEgressWaitExceeded(err)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1_000);
    // Not retried and not counted against the provider: nothing was sent.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    release();
    await blocker;
  });

  it("logs and errors never carry the query string (NCBI's api_key)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => answer(500));
    const url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&api_key=SECRET123";
    const err = await fetchWithRetry(url, { timeout: 50 }, 1, 0).catch(e => e);
    expect(err.message).not.toContain("SECRET123");
    expect(redactUrl(url)).toBe("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    const logged = (console.warn as any).mock.calls.flat().join(" ");
    expect(logged).not.toContain("SECRET123");
  });
});

describe("lanes (review: a long fold held the slots short calls needed)", () => {
  it("a compute-lane call does not take a slot from short calls to the same host", async () => {
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ [HOST]: { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    const releases: (() => void)[] = [];
    vi.spyOn(global, "fetch").mockImplementation(
      (input: any) =>
        String(input).endsWith("/fold")
          ? new Promise<Response>(r => releases.push(() => r(answer())))
          : Promise.resolve(answer())
    );
    const fold = governedFetch(`https://${HOST}/fold`, { lane: "compute" });
    await new Promise(r => setTimeout(r, 5));
    const short = await governedFetch(`https://${HOST}/embed`, { deadlineAt: Date.now() + 3_000 });
    expect(short.status).toBe(200);
    releases.forEach(r => r());
    await fold;
    expect(governorHealth().map(p => p.id).sort()).toEqual([HOST, `${HOST}#compute`]);
  });

  it("a lane is refused for a provider with a published rate (it would double the rate)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => answer());
    await governedFetch(`https://${ENSEMBL}/x`, { lane: "compute" });
    expect(governorHealth().map(p => p.id)).toEqual(["ensembl"]);
  });
});

describe("hosts (review: unbounded state, public names, local-host parsing)", () => {
  it("forgets idle hosts met at run time past the cap", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => answer());
    for (let i = 0; i < MAX_RUNTIME_HOSTS + 25; i++) await governedFetch(`https://h${i}.example.org/`);
    await governedFetch(`https://${ENSEMBL}/x`);
    const ids = governorHealth().map(p => p.id);
    expect(ids.length).toBeLessThanOrEqual(MAX_RUNTIME_HOSTS + 1);
    expect(ids).toContain("ensembl");
  });

  it("the public view names known providers and folds request-chosen hosts into one line", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => answer());
    await governedFetch("https://my-private-alphagenome.lab.example/predict");
    await governedFetch(`https://${ENSEMBL}/x`);
    const pub = governorHealth({ publicView: true });
    expect(pub.map(p => p.id)).toEqual(["ensembl", "other"]);
    expect(JSON.stringify(pub)).not.toContain("my-private-alphagenome");
    expect(pub[1]).toMatchObject({ provider: "Other hosts", hostnames: [], calls: 1 });
  });

  it("isLocalHost parses addresses instead of matching prefixes", () => {
    for (const h of ["10.0.0.1", "127.0.0.1", "172.16.0.9", "192.168.0.2", "100.64.1.1", "[::1]", "fd12:3456::1",
      "fe80::1", "::ffff:127.0.0.1", "printer.local", "nas.lan", "sidecar", "localhost"]) {
      expect(isLocalHost(h), h).toBe(true);
    }
    for (const h of ["10.evil.example", "127.0.0.1.nip.io", "192.168.x.example", "172.32.0.1", "8.8.8.8", "2001:db8::1",
      "rest.ensembl.org"]) {
      expect(isLocalHost(h), h).toBe(false);
    }
  });
});

describe("caller-facing refusals", () => {
  it("isEgressRefusal is true for both of the server's own refusals and nothing else", () => {
    expect(isEgressRefusal(new ProviderRateLimitedError("h", "H", 3))).toBe(true);
    expect(isEgressRefusal(Object.assign(new Error("x"), { code: "EGRESS_WAIT_EXCEEDED" }))).toBe(true);
    expect(isEgressRefusal(Object.assign(new Error("x"), { statusCode: 503 }))).toBe(false);
  });
});

describe("attribution (review: untested)", () => {
  it("the API router attributes a request to its signed-in person, else to legacy", async () => {
    const { attributeEgressOwner } = await import("../../auth/egress-owner.ts");
    const app = express();
    app.use((req: any, _res, next) => {
      if (req.headers["x-test-user"]) req.principal = { kind: "user", userId: String(req.headers["x-test-user"]) };
      next();
    });
    app.use(attributeEgressOwner);
    app.get("/who", async (_req, res) => {
      await new Promise(r => setTimeout(r, 5)); // across an await, as a real handler would be
      res.json({ owner: currentEgressOwner() });
    });
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const signedIn = await (await fetch(`${base}/who`, { headers: { "x-test-user": "u-42" } })).json();
      const anonymous = await (await fetch(`${base}/who`)).json();
      expect(signedIn.owner).toBe("u-42");
      expect(anonymous.owner).toBe("legacy");
    } finally {
      server.close();
    }
  });

  it("the queue runs each job as its owner, so prewarm jobs are `system`", async () => {
    const seen: string[] = [];
    const q = new SQLiteQueue(":memory:", 2, async () => {
      await new Promise(r => setTimeout(r, 1));
      seen.push(currentEgressOwner());
      return "done";
    });
    try {
      await q.addJob("a", "foldx", { name: "a" }, { ownerId: "u-7" });
      await q.addJob("b", "foldx", { name: "b" }, { ownerId: SYSTEM_OWNER });
      await vi.waitFor(() => expect(seen).toHaveLength(2));
      expect(seen.sort()).toEqual(["system", "u-7"]);
    } finally {
      q.shutdown();
    }
  });
});
