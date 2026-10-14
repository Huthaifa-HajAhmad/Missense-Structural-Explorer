/**
 * WP-I4 at a real call site: the ESM-2 sidecar call carries the person's own token when there is one,
 * the team's only when there is not (and the policy lends it), and none when the policy refuses. The
 * sidecar goes remote only with a token, so the token it receives is the one that is spent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEsm2Analysis } from "./esm2.ts";
import { newCredentialRecord, resetCredentialsForTests, runWithCredentialRecord } from "../infra/credentials.ts";
import { resetEgressGovernorForTests } from "../infra/egress-governor.ts";

const TEAM = "hf_team_token_000000000";
const OWN = "hf_own_token_111111111";
const ENV = ["HF_TOKEN", "HUGGINGFACE_API_KEY", "SHARED_TOKEN_FALLBACK", "EGRESS_GOVERNOR"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.HF_TOKEN = TEAM;
  process.env.EGRESS_GOVERNOR = "on";
  resetCredentialsForTests();
  resetEgressGovernorForTests();
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

/** Captures the token each sidecar call carries. */
function stubSidecar(): (string | null)[] {
  const tokens: (string | null)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: any, init?: any) => {
    tokens.push(JSON.parse(String(init?.body ?? "{}")).hfToken ?? null);
    return new Response(JSON.stringify({ status: "success", llr: -1.5 }), { status: 200 });
  });
  return tokens;
}

const run = (token?: string | null) => runEsm2Analysis("TP53", "R273H", "P04637", "M".repeat(272) + "R" + "A".repeat(20), token);

describe("ESM-2 through the sidecar", () => {
  it("sends the person's own token, never swapping in the team's", async () => {
    const tokens = stubSidecar();
    const record = newCredentialRecord();
    await runWithCredentialRecord(record, () => run(OWN));
    expect(tokens).toEqual([OWN]);
    expect([...record.uses.values()]).toEqual([{ kind: "huggingface", source: "own" }]);
  });

  it("lends the team token when the person has none", async () => {
    const tokens = stubSidecar();
    const record = newCredentialRecord();
    await runWithCredentialRecord(record, () => run(null));
    expect(tokens).toEqual([TEAM]);
    expect([...record.uses.values()]).toEqual([{ kind: "huggingface", source: "team" }]);
  });

  it("sends no token when the team token is not lent, and says why", async () => {
    process.env.SHARED_TOKEN_FALLBACK = "off";
    const tokens = stubSidecar();
    const record = newCredentialRecord();
    await runWithCredentialRecord(record, () => run(null));
    expect(tokens).toEqual([null]);
    expect([...record.uses.values()]).toEqual([{ kind: "huggingface", source: "none", refusal: "team-token-off" }]);
  });
});
