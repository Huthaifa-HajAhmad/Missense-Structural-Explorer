/**
 * WP-I4: a Tamarind ThermoMPNN submission is shared between concurrent callers on the same token, and
 * never between different tokens (a pending job is only pollable with the key that submitted it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEnergyModelCaches, resetTamarindSubmissionsForTests, submitThermoMpnnJob } from "./energy-models.ts";
import { resetCredentialsForTests } from "../infra/credentials.ts";
import { resetEgressGovernorForTests } from "../infra/egress-governor.ts";

const ENV = ["TAMARIND_API_KEY", "THERMOMPNN_PROVIDER", "SHARED_TOKEN_FALLBACK", "EGRESS_GOVERNOR"] as const;
let saved: Record<string, string | undefined>;
const PDB = "ATOM      1  CA  ALA A   1       1.000   1.000   1.000  1.00 20.00           C\nEND";

beforeEach(() => {
  saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.TAMARIND_API_KEY = "tamarind-team-key-000000";
  process.env.THERMOMPNN_PROVIDER = "remote";
  resetCredentialsForTests();
  resetEgressGovernorForTests();
  resetTamarindSubmissionsForTests();
  clearEnergyModelCaches();
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function stubTamarind() {
  const keys: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: any, init?: any) => {
    const key = String(init?.headers?.["x-api-key"]);
    keys.push(key);
    await new Promise(r => setTimeout(r, 5));
    return new Response(JSON.stringify({ jobId: `job-for-${key}` }), { status: 200 });
  });
  return keys;
}

describe("Tamarind submissions", () => {
  it("two callers on the team token share one job", async () => {
    const keys = stubTamarind();
    const [a, b] = await Promise.all([submitThermoMpnnJob(PDB, "AA1V"), submitThermoMpnnJob(PDB, "AA1V")]);
    expect(keys).toHaveLength(1);
    expect(a.jobId).toBe("job-for-tamarind-team-key-000000");
    expect(b.jobId).toBe(a.jobId);
  });

  it("callers on different tokens get their own jobs, each submitted with its own key", async () => {
    const keys = stubTamarind();
    const [own, team] = await Promise.all([
      submitThermoMpnnJob(PDB, "AA1V", "tamarind-own-key-111111"),
      submitThermoMpnnJob(PDB, "AA1V"),
    ]);
    expect(keys.sort()).toEqual(["tamarind-own-key-111111", "tamarind-team-key-000000"]);
    expect(own.jobId).not.toBe(team.jobId);
  });
});
