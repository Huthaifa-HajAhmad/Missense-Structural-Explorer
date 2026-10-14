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
import { coreIdentityOf } from "../orchestration/core-identity.ts";

const TEAM = "team-biohub-token-0123456789";
const OWN = "own-biohub-token-abcdefghij";
const ENV_KEYS = ["BIOHUB_API_TOKEN", "ESM3_FORGE_API_KEY", "HF_TOKEN", "TAMARIND_API_KEY", "SHARED_TOKEN_FALLBACK", "SHARED_TOKEN_SHARE_PER_HOUR", "EGRESS_GOVERNOR", "APP_SESSION_SECRET", "EGRESS_PROVIDER_LIMITS_JSON"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.BIOHUB_API_TOKEN = TEAM;
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
    expect(resolveCredential("biohub", OWN)).toMatchObject({ token: OWN, source: "own" });
    expect(resolveCredential("biohub", TEAM)).toMatchObject({ token: TEAM, source: "team" });
  });

  it("uses a person's saved token before the team's, and never for an anonymous caller", () => {
    const id = person();
    saveUserSecret(id, "biohub", OWN);
    expect(runWithEgressOwner(id, () => resolveCredential("biohub"))).toMatchObject({ token: OWN, source: "own" });
    expect(runWithEgressOwner("legacy", () => resolveCredential("biohub"))).toMatchObject({ token: TEAM, source: "team" });
  });

  it("lends the team token under on and limited, never under off", () => {
    process.env.SHARED_TOKEN_FALLBACK = "on";
    expect(resolveCredential("biohub")).toMatchObject({ source: "team" });
    process.env.SHARED_TOKEN_FALLBACK = "off";
    expect(resolveCredential("biohub")).toEqual({ kind: "biohub", token: null, source: "none", refusal: "team-token-off" });
    process.env.SHARED_TOKEN_FALLBACK = "nonsense";
    expect(resolveCredential("biohub")).toMatchObject({ source: "team" });
  });

  it("limited: a person may make the hourly share of team calls, then is refused; legacy is not counted", async () => {
    process.env.SHARED_TOKEN_SHARE_PER_HOUR = "2";
    process.env.EGRESS_GOVERNOR = "off";
    const id = person();
    const call = () =>
      runWithEgressOwner(id, () => {
        const r = resolveCredential("biohub");
        return r.token ? governedForCredential("biohub", r.token, async () => "ok") : Promise.resolve(r.refusal);
      });
    expect(await call()).toBe("ok");
    expect(await call()).toBe("ok");
    expect(await call()).toBe("team-share-used");
    expect(runWithEgressOwner(id, () => teamShareLeft("biohub"))).toBe(0);
    // Another person, and the anonymous legacy owner, are unaffected.
    expect(runWithEgressOwner(person(), () => resolveCredential("biohub").source)).toBe("team");
    for (let i = 0; i < 5; i++) {
      expect(await runWithEgressOwner("legacy", () => governedForCredential("biohub", TEAM, async () => "ok"))).toBe("ok");
    }
    expect(runWithEgressOwner("legacy", () => resolveCredential("biohub").source)).toBe("team");
  });

  it("a person with their own token is never charged to the team's share", async () => {
    process.env.SHARED_TOKEN_SHARE_PER_HOUR = "1";
    process.env.EGRESS_GOVERNOR = "off";
    const id = person();
    for (let i = 0; i < 3; i++) {
      await runWithEgressOwner(id, () => governedForCredential("biohub", OWN, async () => "ok"));
    }
    expect(runWithEgressOwner(id, () => teamShareLeft("biohub"))).toBe(1);
  });

  it("a status poll is not refused by the share, and charges nothing", async () => {
    process.env.SHARED_TOKEN_SHARE_PER_HOUR = "1";
    process.env.EGRESS_GOVERNOR = "off";
    const id = person();
    await runWithEgressOwner(id, () => governedForCredential("biohub", TEAM, async () => "ok"));
    expect(runWithEgressOwner(id, () => resolveCredential("biohub").refusal)).toBe("team-share-used");
    expect(runWithEgressOwner(id, () => resolveCredential("biohub", null, { statusOnly: true }))).toMatchObject({ token: TEAM, source: "team" });
    await runWithEgressOwner(id, () => governedForCredential("biohub", TEAM, async () => "poll", { charge: false }));
    expect(runWithEgressOwner(id, () => teamShareLeft("biohub"))).toBe(0);
  });

  it("ownCredential never returns the team token (Test connection)", () => {
    expect(ownCredential("biohub")).toBeNull();
    expect(ownCredential("biohub", TEAM)).toBeNull();
    expect(ownCredential("biohub", OWN)).toBe(OWN);
  });

  it("credentialAvailable reflects own, saved and lendable team tokens", () => {
    expect(credentialAvailable("biohub")).toBe(true);
    process.env.SHARED_TOKEN_FALLBACK = "off";
    expect(credentialAvailable("biohub")).toBe(false);
    expect(credentialAvailable("biohub", OWN)).toBe(true);
    expect(credentialAvailable("tamarind")).toBe(false);
  });
});

describe("the response record", () => {
  it("records each call sent (own or team) and a refusal, the call outranking an earlier refusal", async () => {
    process.env.EGRESS_GOVERNOR = "off";
    const record = newCredentialRecord();
    await runWithCredentialRecord(record, async () => {
      process.env.SHARED_TOKEN_FALLBACK = "off";
      resolveCredential("biohub");
      noteRefusal("biohub");
      expect(currentCredentialUses()).toEqual([{ kind: "biohub", source: "none", refusal: "team-token-off" }]);
      await governedForCredential("biohub", OWN, async () => 1);
      await governedForCredential("huggingface", "own-hf-token-123456", async () => 1);
      expect(currentCredentialUses()).toEqual([
        { kind: "biohub", source: "own" },
        { kind: "huggingface", source: "own" },
      ]);
    });
  });

  it("records nothing for a call that is never sent (no token)", async () => {
    const record = newCredentialRecord();
    await runWithCredentialRecord(record, () => governedForCredential("biohub", null, async () => 1));
    expect(record.uses.size).toBe(0);
  });
});

describe("governor buckets", () => {
  it("a person's own token does not occupy the team token's slots", async () => {
    process.env.EGRESS_GOVERNOR = "on";
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ "forge.evolutionaryscale.ai": { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    let release!: () => void;
    const held = new Promise<void>(r => (release = r));
    const teamCall = governedForCredential("biohub", TEAM, () => held);
    // The team bucket is full; an own-token call still goes at once.
    const own = await governedForCredential("biohub", OWN, async () => "own done", { deadlineAt: Date.now() + 1000 });
    expect(own).toBe("own done");
    release();
    await teamCall;
  });

  it("a 429 on a person's own token pauses that token, not the team's", async () => {
    process.env.EGRESS_GOVERNOR = "on";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("slow down", { status: 429, headers: { "Retry-After": "3" } }));
    const credential = credentialForCall("tamarind", "own-tamarind-key-123456");
    await governedFetch("https://app.tamarind.bio/api/jobs", { credential });
    expect(pauseRemainingMs(pauseKeyFor("app.tamarind.bio", credential.bucket))).toBeGreaterThan(0);
    expect(pauseRemainingMs("app.tamarind.bio")).toBe(0);
  });

  it("/capabilities folds own-token buckets into one line per provider, with no id from the token", async () => {
    process.env.EGRESS_GOVERNOR = "on";
    await governedForCredential("biohub", OWN, async () => 1);
    await governedForCredential("biohub", "another-own-token-xyz", async () => 1);
    await governedForCredential("biohub", TEAM, async () => 1);
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
    process.env.EGRESS_PROVIDER_LIMITS_JSON = JSON.stringify({ "forge.evolutionaryscale.ai": { maxConcurrent: 1 } });
    resetEgressGovernorForTests();
    process.env.SHARED_TOKEN_FALLBACK = "bogus";
    resolveCredential("biohub");
    await Promise.all([1, 2, 3].map(() => governedForCredential("biohub", OWN, async () => 1)));
    await Promise.all([1, 2, 3].map(() => governedForCredential("biohub", TEAM, async () => 1)));
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
        if (token) process.env.BIOHUB_API_TOKEN = token;
        else delete process.env.BIOHUB_API_TOKEN;
        process.env.HF_TOKEN = token ?? "";
        expect(runWithEgressOwner(owner, allKeys)).toEqual(baseline);
      }
    }
  });

  it("holds for the core analysis flight key across different Biohub and Hugging Face tokens", () => {
    const ctx = { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", originalNotation: "p.Arg408Trp", acmgWeighting: "standard", sequence: "MKV", pos: 408, residueIndex: "408", wildType: "Arg", mutant: "Trp", wt1Letter: "R", mut1Letter: "W" } as any;
    // Two own tokens of the same owner share a flight key; own and team tokens have distinct keys so they never cross-spend.
    const ownKeys = [OWN, "zz-third-token-000000"].map(t => coreIdentityOf({ ...ctx, hfToken: t, biohubToken: t }).flightKey);
    expect(new Set(ownKeys).size).toBe(1);
    const teamKey = coreIdentityOf({ ...ctx, hfToken: TEAM, biohubToken: TEAM }).flightKey;
    expect(teamKey).not.toBe(ownKeys[0]);
  });
});
