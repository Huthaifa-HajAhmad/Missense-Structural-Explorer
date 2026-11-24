/**
 * WP-I4: per-user credentials. Which token a call uses, whose allowance it spends, and that no token or
 * credential hash reaches a log, a key or `/capabilities`.
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  credentialAvailable,
  credentialForCall,
  credentialPolicyHealth,
  currentCredentialUses,
  governedForCredential,
  newCredentialRecord,
  noteRefusal,
  ownCredential,
  resetCredentialsForTests,
  resolveCredential,
  runWithCredentialRecord,
  teamShareLeft,
} from "./credentials.ts";
import { runWithEgressOwner } from "./egress-context.ts";
import { governorHealth, pauseKeyFor, resetEgressGovernorForTests } from "./egress-governor.ts";
import { pauseRemainingMs, resetProviderPausesForTests } from "./provider-pause.ts";
import { governedFetch } from "./http-client.ts";
import { closeAccountsDb, createUser } from "../../auth/store.ts";
import { saveUserSecret } from "../../auth/user-secrets.ts";
import * as cacheKeys from "./cache-keys.ts";

const TEAM = "team-japanfold-token-0123456789";
const OWN = "own-japanfold-token-abcdefghij";
const ENV_KEYS = ["JAPANFOLD_API_KEY", "SHARED_TOKEN_FALLBACK", "SHARED_TOKEN_SHARE_PER_HOUR", "EGRESS_GOVERNOR", "APP_SESSION_SECRET", "EGRESS_PROVIDER_LIMITS_JSON"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.JAPANFOLD_API_KEY = TEAM;
  process.env.APP_SESSION_SECRET = "test-session-secret-fixed-32-chars!";
  resetCredentialsForTests();
  resetEgressGovernorForTests();
  resetProviderPausesForTests();
  closeAccountsDb();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

const person = () => createUser({ email: `p${Math.random()}@lab.org`, displayName: "P", passwordHash: null, role: "member", now: Date.now() }).id;

describe("resolveCredential", () => {
  it("uses the request's own token, and classifies the team token by value", () => {
    expect(resolveCredential("japanfold", OWN)).toMatchObject({ token: OWN, source: "own" });
    expect(resolveCredential("japanfold", TEAM)).toMatchObject({ token: TEAM, source: "team" });
  });

  it("uses a person's saved token before the team's, and never lends the team token to an anonymous legacy caller", () => {
    const id = person();
    saveUserSecret(id, "japanfold", OWN);
    expect(runWithEgressOwner(id, () => resolveCredential("japanfold"))).toMatchObject({ token: OWN, source: "own" });
    expect(runWithEgressOwner("legacy", () => resolveCredential("japanfold"))).toEqual({
      kind: "japanfold",
      token: null,
      source: "none",
      refusal: "team-signin-required",
    });
    expect(runWithEgressOwner("legacy", () => resolveCredential("japanfold", OWN))).toMatchObject({ token: OWN, source: "own" });
    expect(runWithEgressOwner("legacy", () => credentialAvailable("japanfold"))).toBe(false);
    expect(runWithEgressOwner("legacy", () => teamShareLeft("japanfold"))).toBe(0);
    // Authenticated service callers (APP_API_TOKEN) and system prewarm still use the team token.
    expect(runWithEgressOwner("service", () => resolveCredential("japanfold"))).toMatchObject({ token: TEAM, source: "team" });
    expect(runWithEgressOwner("system", () => resolveCredential("japanfold"))).toMatchObject({ token: TEAM, source: "team" });
  });

  it("lends the team token under on and limited, never under off", () => {
    process.env.SHARED_TOKEN_FALLBACK = "on";
    expect(resolveCredential("japanfold")).toMatchObject({ source: "team" });
    process.env.SHARED_TOKEN_FALLBACK = "off";
    expect(resolveCredential("japanfold")).toEqual({ kind: "japanfold", token: null, source: "none", refusal: "team-token-off" });
    process.env.SHARED_TOKEN_FALLBACK = "nonsense";
    expect(resolveCredential("japanfold")).toMatchObject({ source: "team" });
  });

  it("limited: a person may make the hourly share of team calls, then is refused; legacy anonymous cannot borrow it", async () => {
    process.env.SHARED_TOKEN_SHARE_PER_HOUR = "2";
    process.env.EGRESS_GOVERNOR = "off";
    const id = person();
    const call = () =>
      runWithEgressOwner(id, () => {
        const r = resolveCredential("japanfold");
        return r.token ? governedForCredential("japanfold", r.token, async () => "ok") : Promise.resolve(r.refusal);
      });
    expect(await call()).toBe("ok");
    expect(await call()).toBe("ok");
    expect(await call()).toBe("team-share-used");
    expect(runWithEgressOwner(id, () => teamShareLeft("japanfold"))).toBe(0);
    // Another signed-in person and authenticated service callers are unaffected; anonymous legacy is refused.
    expect(runWithEgressOwner(person(), () => resolveCredential("japanfold").source)).toBe("team");
    expect(runWithEgressOwner("service", () => resolveCredential("japanfold").source)).toBe("team");
    expect(runWithEgressOwner("legacy", () => resolveCredential("japanfold"))).toMatchObject({
      source: "none",
      refusal: "team-signin-required",
    });
    expect(runWithEgressOwner("legacy", () => resolveCredential("japanfold", null, { statusOnly: true }))).toMatchObject({
      token: null,
      source: "none",
    });
  });

  it("a person with their own token is never charged to the team's share", async () => {
    process.env.SHARED_TOKEN_SHARE_PER_HOUR = "1";
    process.env.EGRESS_GOVERNOR = "off";
    const id = person();
    for (let i = 0; i < 3; i++) {
      await runWithEgressOwner(id, () => governedForCredential("japanfold", OWN, async () => "ok"));
    }
    expect(runWithEgressOwner(id, () => teamShareLeft("japanfold"))).toBe(1);
  });

  it("a status poll is not refused by the share, and charges nothing", async () => {
    process.env.SHARED_TOKEN_SHARE_PER_HOUR = "1";
    process.env.EGRESS_GOVERNOR = "off";
    const id = person();
    await runWithEgressOwner(id, () => governedForCredential("japanfold", TEAM, async () => "ok"));
    expect(runWithEgressOwner(id, () => resolveCredential("japanfold").refusal)).toBe("team-share-used");
    expect(runWithEgressOwner(id, () => resolveCredential("japanfold", null, { statusOnly: true }))).toMatchObject({ token: TEAM, source: "team" });
    await runWithEgressOwner(id, () => governedForCredential("japanfold", TEAM, async () => "poll", { charge: false }));
    expect(runWithEgressOwner(id, () => teamShareLeft("japanfold"))).toBe(0);
  });

  it("ownCredential never returns the team token (Test connection)", () => {
    expect(ownCredential("japanfold")).toBeNull();
    expect(ownCredential("japanfold", TEAM)).toBeNull();
    expect(ownCredential("japanfold", OWN)).toBe(OWN);
  });

  it("credentialAvailable reflects own, saved and lendable team tokens", () => {
    expect(credentialAvailable("japanfold")).toBe(true);
    process.env.SHARED_TOKEN_FALLBACK = "off";
    expect(credentialAvailable("japanfold")).toBe(false);
    expect(credentialAvailable("japanfold", OWN)).toBe(true);
  });
});

describe("the response record", () => {
  it("records each call sent (own or team) and a refusal, the call outranking an earlier refusal", async () => {
    process.env.EGRESS_GOVERNOR = "off";
    const record = newCredentialRecord();
    await runWithCredentialRecord(record, async () => {
      process.env.SHARED_TOKEN_FALLBACK = "off";
      resolveCredential("japanfold");
      noteRefusal("japanfold");
      expect(currentCredentialUses()).toEqual([{ kind: "japanfold", source: "none", refusal: "team-token-off" }]);
      await governedForCredential("japanfold", OWN, async () => 1);
      expect(currentCredentialUses()).toEqual([{ kind: "japanfold", source: "own" }]);
    });
  });

  it("records nothing for a call that is never sent (no token)", async () => {
    const record = newCredentialRecord();
    await runWithCredentialRecord(record, () => governedForCredential("japanfold", null, async () => 1));
    expect(record.uses.size).toBe(0);
  });
});

describe("governor buckets", () => {
  it("a person's own token does not occupy the team token's slots", async () => {
    process.env.EGRESS_GOVERNOR = "on";
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ "api.japanfold.aiand.com": { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    let release!: () => void;
    const held = new Promise<void>(r => (release = r));
    const teamCall = governedForCredential("japanfold", TEAM, () => held);
    // The team bucket is full; an own-token call still goes at once.
    const own = await governedForCredential("japanfold", OWN, async () => "own done", { deadlineAt: Date.now() + 1000 });
    expect(own).toBe("own done");
    release();
    await teamCall;
  });

  it("a 429 on a person's own token pauses that token, not the team's", async () => {
    process.env.EGRESS_GOVERNOR = "on";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("slow down", { status: 429, headers: { "Retry-After": "3" } }));
    const credential = credentialForCall("japanfold", "own-japanfold-key-123456");
    await governedFetch("https://api.japanfold.aiand.com/v1/predictions", { credential });
    expect(pauseRemainingMs(pauseKeyFor("api.japanfold.aiand.com", credential.bucket))).toBeGreaterThan(0);
    expect(pauseRemainingMs("api.japanfold.aiand.com")).toBe(0);
  });

  it("/capabilities folds own-token buckets into one line per provider, with no id from the token", async () => {
    process.env.EGRESS_GOVERNOR = "on";
    await governedForCredential("japanfold", OWN, async () => 1);
    await governedForCredential("japanfold", "another-own-token-xyz", async () => 1);
    await governedForCredential("japanfold", TEAM, async () => 1);
    const lines = governorHealth({ publicView: true });
    const own = lines.find(l => l.id.endsWith("#own-tokens"));
    expect(own).toMatchObject({ calls: 2 });
    expect(own?.ownTokens).toBeUndefined();
    const adminLines = governorHealth();
    const adminOwn = adminLines.find(l => l.id.endsWith("#own-tokens"));
    expect(adminOwn).toMatchObject({ ownTokens: 2, calls: 2 });
    expect(lines.filter(l => l.id.includes("#own:"))).toHaveLength(0);
    const text = JSON.stringify({ lines, policy: credentialPolicyHealth() });
    for (const secret of [OWN, TEAM, sha(OWN), sha(OWN).slice(0, 16), sha(TEAM).slice(0, 16)]) expect(text).not.toContain(secret);
  });

  it("isolates overflowing own tokens into one per-owner bucket instead of spilling into the team bucket", () => {
    const owner = person();
    runWithEgressOwner(owner, () => {
      const buckets = [1, 2, 3, 4, 5].map((i) => credentialForCall("japanfold", `own-token-${i}-xxxxxxxxxxxx`).bucket);
      expect(buckets.every((b) => typeof b === "string" && b.length > 0)).toBe(true);
      expect(buckets[3]).toBe(buckets[4]);
      expect(buckets[3]).not.toBe(buckets[0]);
    });
  });
});

function sha(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex");
}

describe("no token or credential hash in logs", () => {
  it("is not logged by the resolver, the governor (shadow lines) or a refusal", async () => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    }
    process.env.EGRESS_GOVERNOR = "shadow";
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ "api.japanfold.aiand.com": { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    process.env.SHARED_TOKEN_FALLBACK = "bogus";
    resolveCredential("japanfold");
    await Promise.all([1, 2, 3].map(() => governedForCredential("japanfold", OWN, async () => 1)));
    await Promise.all([1, 2, 3].map(() => governedForCredential("japanfold", TEAM, async () => 1)));
    const all = lines.join("\n");
    for (const secret of [OWN, TEAM, sha(OWN), sha(OWN).slice(0, 16), sha(TEAM).slice(0, 16)]) expect(all).not.toContain(secret);
  });
});

describe("changing the user or the token never changes a cache key (property)", () => {
  const tokens = [null, OWN, TEAM, "zz-third-token-000000"];
  const owners = ["legacy", "system", "user-a", "user-b"];

  /** Every exported `build*Key` in cache-keys.ts, called with fixed sample arguments. */
  function allKeys(): string[] {
    const out: string[] = [];
    for (const [name, fn] of Object.entries(cacheKeys)) {
      if (!/^build\w*Key$/.test(name) || typeof fn !== "function") continue;
      const args = ["TP53", "p.Arg273His", "P04637", "273", "A", "GRCh38", "1", "2"];
      try {
        out.push(`${name}=${(fn as (...a: unknown[]) => string)(...args)}`);
      } catch {
        // A builder that needs other argument shapes is skipped; the rest still cover the property.
      }
    }
    return out;
  }

  it("holds for every key builder under every owner and every team token", () => {
    const baseline = allKeys();
    expect(baseline.length).toBeGreaterThan(5);
    for (const owner of owners) {
      for (const token of tokens) {
        if (token) process.env.JAPANFOLD_API_KEY = token;
        else delete process.env.JAPANFOLD_API_KEY;
        expect(runWithEgressOwner(owner, allKeys)).toEqual(baseline);
      }
    }
  });

});
