import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

/**
 * With Redis configured, one failed Redis command makes a pre-warm claim fall back to SQLite. Redis
 * then answers again. The claim must still be released by its owner, and must still keep others out:
 * otherwise it blocks pre-warming that variant for its whole lifetime (47 minutes), or lets a second
 * pre-warm start beside it.
 */
const store = new Map<string, string>();
let failNext = false;
vi.mock("ioredis", () => ({
  default: class FakeRedis {
    on() { return this; }
    async subscribe() {}
    async set(key: string, value: string) {
      if (failNext) { failNext = false; throw new Error("Command timed out"); }
      if (store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }
    async get(key: string) { return store.get(key) ?? null; }
    async del(key: string) { return store.delete(key) ? 1 : 0; }
    async eval(_script: string, _n: number, key: string, token: string) {
      if (store.get(key) !== token) return 0;
      store.delete(key);
      return 1;
    }
  },
}));

let registry: typeof import("./state.ts").inFlightPrewarms;

beforeAll(async () => {
  vi.stubEnv("REDIS_URL", "redis://fake:6379");
  vi.stubEnv("SHARED_STATE_DB_PATH", ":memory:");
  vi.resetModules();
  registry = (await import("./state.ts")).inFlightPrewarms;
});

afterAll(() => vi.unstubAllEnvs());

describe("a pre-warm claim made while Redis failed once", () => {
  it("keeps others out and is released by its owner once Redis answers again", async () => {
    const key = `K_${crypto.randomUUID()}`;
    failNext = true;
    expect(await registry.add(key, "owner")).toBe(true); // stored in SQLite
    expect(await registry.add(key, "someone-else")).toBe(false);

    expect(await registry.delete(key, "owner")).toBe(true);
    expect(await registry.add(key, "next")).toBe(true);
    await registry.delete(key, "next");
  });
});
