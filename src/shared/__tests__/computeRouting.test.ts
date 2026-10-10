import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROUTING_POLICY,
  FOLDX_REPAIR_MAX_RESIDUES,
  compareVersions,
  costModelKey,
  decidePlacement,
  foldxPriorP50Ms,
  foldxRepairApplies,
  hostClassOf,
  type CostModels,
  type HostFeatures,
  type JobFeatures,
  type RoutingPolicy,
} from "../computeRouting";

const GIB = 1024 ** 3;

function foldxJob(residues: number, over: Partial<JobFeatures> = {}): JobFeatures {
  return {
    type: "foldx",
    residues,
    chains: 1,
    numberOfRuns: 5,
    repair: foldxRepairApplies(residues, false),
    ownerId: "u1",
    requires: [{ tool: "foldx" }],
    ...over,
  };
}

const server: HostFeatures = {
  id: "server",
  kind: "server",
  ownerId: null,
  label: "the shared server",
  online: true,
  arch: "arm64",
  emulated: true,
  os: "linux",
  cores: 2,
  totalRamBytes: 12 * GIB,
  freeRamBytes: 6 * GIB,
  tools: [
    { name: "foldx", version: "5.1", verified: true },
    { name: "p2rank", version: "2.4.2", verified: true },
  ],
  runningJobs: 0,
  runningCostMs: 0,
  queuedCostMs: 0,
  linkRttMs: null,
  leaseLossRate: 0,
  minFreeBytes: 500 * 1024 ** 2,
};

const desktop: HostFeatures = {
  ...server,
  id: "agent:a1",
  kind: "agent",
  ownerId: "u1",
  label: "Huthaifa's desktop",
  arch: "x64",
  emulated: false,
  os: "win32",
  cores: 8,
  totalRamBytes: 16 * GIB,
  freeRamBytes: 10 * GIB,
  linkRttMs: 40,
};

const policy = (over: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_ROUTING_POLICY, ...over });
const NONE: CostModels = {};

describe("priors (plan section 2.3)", () => {
  it("native x64, 154 residues, 5 runs: ~2.3 s", () => {
    const ms = foldxPriorP50Ms({ residues: 154, numberOfRuns: 5, repair: false }, false);
    expect(ms).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(3000);
  });

  it("native x64, 875 residues, 5 runs: ~4.7 s", () => {
    expect(foldxPriorP50Ms({ residues: 875, numberOfRuns: 5, repair: false }, false)).toBeCloseTo(4700, -2);
  });

  it("emulated, 1,085 residues: 167.2 s for 5 runs and ~44 s for 1 run", () => {
    expect(foldxPriorP50Ms({ residues: 1085, numberOfRuns: 5, repair: false }, true)).toBeCloseTo(167_200, -2);
    expect(foldxPriorP50Ms({ residues: 1085, numberOfRuns: 1, repair: false }, true)).toBeCloseTo(44_100, -2);
  });

  it("emulated SOD1 (154 residues) lands near the measured 9.6 s", () => {
    const ms = foldxPriorP50Ms({ residues: 154, numberOfRuns: 5, repair: false }, true);
    expect(ms).toBeGreaterThan(8000);
    expect(ms).toBeLessThan(12_000);
  });

  it("the decision for 1,085 residues on the server is a prior with p90 = 2 x p50", () => {
    const d = decidePlacement(foldxJob(1085), [server], policy(), NONE);
    expect(d.prediction?.basis).toBe("prior");
    expect(d.prediction?.wallMs?.p50).toBeCloseTo(167_200, -2);
    expect(d.prediction?.wallMs?.p90).toBe((d.prediction?.wallMs?.p50 ?? 0) * 2);
  });

  it("the 400/401 boundary switches RepairPDB, and an AlphaFold DB model never repairs", () => {
    expect(foldxRepairApplies(FOLDX_REPAIR_MAX_RESIDUES, false)).toBe(true);
    expect(foldxRepairApplies(FOLDX_REPAIR_MAX_RESIDUES + 1, false)).toBe(false);
    expect(foldxRepairApplies(200, true)).toBe(false);
    const withRepair = foldxPriorP50Ms({ residues: 400, numberOfRuns: 5, repair: true }, true);
    const without = foldxPriorP50Ms({ residues: 401, numberOfRuns: 5, repair: false }, true);
    expect(withRepair).toBeGreaterThan(without);
  });
});

describe("hard filters", () => {
  it("drops a host whose FoldX is missing, and says so", () => {
    const d = decidePlacement(foldxJob(154), [server, { ...desktop, tools: [] }], policy(), NONE);
    expect(d.placement).toEqual({ kind: "server" });
    expect(d.rejected).toEqual([{ hostId: "agent:a1", because: "FoldX is not set up on it" }]);
  });

  it("never relies on an unverified tool", () => {
    const d = decidePlacement(foldxJob(154), [{ ...desktop, tools: [{ name: "foldx", version: "5.1", verified: false }] }], policy(), NONE);
    expect(d.placement.kind).toBe("reject");
    expect(d.reasons[0]).toMatch(/has not passed its self-test/);
  });

  it("enforces a minimum tool version", () => {
    const job = foldxJob(154, { requires: [{ tool: "foldx", minVersion: "5.10" }] });
    const d = decidePlacement(job, [server], policy(), NONE);
    expect(d.placement.kind).toBe("reject");
    expect(compareVersions("5.10", "5.9")).toBe(1);
  });

  it("never offers another user's computer", () => {
    const d = decidePlacement(foldxJob(154), [server, { ...desktop, ownerId: "u2" }], policy({ placementPref: "my_machine" }), NONE);
    expect(d.placement).toEqual({ kind: "server" });
    expect(d.rejected[0].because).toMatch(/another user/);
  });

  it("server_only keeps the job on the server even when the desktop is faster", () => {
    const d = decidePlacement(foldxJob(1085), [server, desktop], policy({ placementPref: "server_only" }), NONE);
    expect(d.placement).toEqual({ kind: "server" });
  });

  it("skips offline hosts", () => {
    const d = decidePlacement(foldxJob(1085), [server, { ...desktop, online: false }], policy(), NONE);
    expect(d.placement).toEqual({ kind: "server" });
  });

  it("rejects when the measured memory does not fit, naming the closest miss", () => {
    const models: CostModels = {
      [costModelKey("foldx", hostClassOf(server))]: {
        samples: 10,
        wall: { a: 0, b: 1, p90Ratio: 1.2 },
        peakRam: { a: Math.log(8 * GIB), b: 0, p90Ratio: 1 },
        maxCompletedResidues: 1100,
        oomCeilingResidues: null,
      },
    };
    const d = decidePlacement(foldxJob(500), [server], policy(), models);
    expect(d.placement.kind).toBe("reject");
    expect(d.reasons).toHaveLength(1);
    expect(d.reasons[0]).toMatch(/needs about 10\.0 GB of free memory; the most any host has free is 5\.5 GB \(the shared server\)/);
  });

  it("an OOM ceiling refuses that size and above", () => {
    const models: CostModels = {
      [costModelKey("foldx", hostClassOf(server))]: { samples: 2, wall: null, peakRam: null, maxCompletedResidues: 900, oomCeilingResidues: 1000 },
    };
    expect(decidePlacement(foldxJob(1000), [server], policy(), models).placement.kind).toBe("reject");
    expect(decidePlacement(foldxJob(999), [server], policy(), models).placement.kind).toBe("server");
  });

  it("with memory unmeasured, refuses beyond 1.25 x the largest completed size, but never the first job", () => {
    const models: CostModels = {
      [costModelKey("foldx", hostClassOf(server))]: { samples: 3, wall: null, peakRam: null, maxCompletedResidues: 400, oomCeilingResidues: null },
    };
    expect(decidePlacement(foldxJob(500), [server], policy(), models).placement.kind).toBe("server");
    const d = decidePlacement(foldxJob(501), [server], policy(), models);
    expect(d.placement.kind).toBe("reject");
    expect(d.reasons[0]).toMatch(/memory use is not measured yet/);
    expect(decidePlacement(foldxJob(5000), [server], policy(), NONE).placement.kind).toBe("server");
  });

  it("with every host offline, says exactly that", () => {
    const d = decidePlacement(foldxJob(154), [{ ...server, online: false }], policy(), NONE);
    expect(d.reasons).toEqual(["No computer that could run this job is online."]);
  });
});

describe("ranking and near ties", () => {
  it("auto sends a large job to the native desktop, which finishes far sooner", () => {
    const d = decidePlacement(foldxJob(1085), [server, desktop], policy(), NONE);
    expect(d.placement).toEqual({ kind: "agent", agentId: "a1" });
    expect(d.ranked.map((r) => r.hostId)).toEqual(["agent:a1", "server"]);
    expect(d.reasons.join(" ")).toMatch(/expected to finish first/);
  });

  // Make the server effectively native so the two hosts are within the 20% margin.
  const fastServer: HostFeatures = { ...server, arch: "x64", emulated: false };

  it("auto: a near tie stays on the shared server", () => {
    // The desktop is marginally ahead (the server has a short job queued), but within the margin.
    const nearlyIdle: HostFeatures = { ...fastServer, queuedCostMs: 300 };
    const d = decidePlacement(foldxJob(154), [nearlyIdle, { ...desktop, linkRttMs: 0 }], policy({ placementPref: "auto" }), NONE);
    expect(d.ranked[0].hostId).toBe("agent:a1");
    expect(d.placement).toEqual({ kind: "server" });
    expect(d.reasons[0]).toMatch(/about the same time/);
  });

  it("my_machine: a near tie goes to the owner's computer", () => {
    const loaded: HostFeatures = { ...desktop, queuedCostMs: 300 };
    const d = decidePlacement(foldxJob(154), [fastServer, loaded], policy({ placementPref: "my_machine" }), NONE);
    expect(d.placement).toEqual({ kind: "agent", agentId: "a1" });
    expect(d.reasons[0]).toMatch(/as you prefer/);
  });

  it("my_machine does not override a clear loss", () => {
    const busy: HostFeatures = { ...desktop, runningCostMs: 600_000 };
    const d = decidePlacement(foldxJob(154), [fastServer, busy], policy({ placementPref: "my_machine" }), NONE);
    expect(d.placement).toEqual({ kind: "server" });
  });

  it("a fitted curve replaces the prior once the class has enough samples", () => {
    const key = costModelKey("foldx", hostClassOf(server));
    const fit = { a: Math.log(1000), b: 0, p90Ratio: 1.5 };
    const few: CostModels = { [key]: { samples: 7, wall: fit, peakRam: null, maxCompletedResidues: null, oomCeilingResidues: null } };
    const enough: CostModels = { [key]: { ...few[key], samples: 8 } };
    expect(decidePlacement(foldxJob(154), [server], policy(), few).prediction?.basis).toBe("prior");
    const d = decidePlacement(foldxJob(154), [server], policy(), enough);
    expect(d.prediction).toEqual({ wallMs: { p50: 1000, p90: 1500 }, peakRamBytes: null, basis: "measured", samples: 8 });
  });

  it("P2Rank has no prior: hosts are ranked by load and the reason says so", () => {
    const job: JobFeatures = { type: "p2rank", residues: 300, chains: 1, numberOfRuns: 0, repair: false, ownerId: "u1", requires: [{ tool: "p2rank" }] };
    const d = decidePlacement(job, [{ ...server, runningJobs: 2 }, desktop], policy(), NONE);
    expect(d.placement).toEqual({ kind: "agent", agentId: "a1" });
    expect(d.prediction?.wallMs).toBeNull();
    expect(d.reasons[0]).toMatch(/no run-time estimate/);
  });

  it("a host with no time estimate is never treated as tied (mixed timed and untimed hosts)", () => {
    const job: JobFeatures = { type: "p2rank", residues: 300, chains: 1, numberOfRuns: 0, repair: false, ownerId: "u1", requires: [{ tool: "p2rank" }] };
    const models: CostModels = {
      [costModelKey("p2rank", hostClassOf(server))]: { samples: 10, wall: { a: Math.log(1000), b: 0, p90Ratio: 1.2 }, peakRam: null, maxCompletedResidues: 400, oomCeilingResidues: null },
    };
    const busyDesktop: HostFeatures = { ...desktop, runningJobs: 1 };
    const d = decidePlacement(job, [server, busyDesktop], policy({ placementPref: "my_machine" }), models);
    expect(d.placement).toEqual({ kind: "server" });
    expect(d.reasons.join(" ")).not.toMatch(/about the same time/);
  });

  it("is pure: the same input gives the same Decision regardless of host order", () => {
    const a = decidePlacement(foldxJob(700), [server, desktop], policy(), NONE);
    const b = decidePlacement(foldxJob(700), [desktop, server], policy(), NONE);
    expect(a).toEqual(b);
    expect(decidePlacement(foldxJob(700), [server, desktop], policy(), NONE)).toEqual(a);
  });
});

describe("hostClassOf", () => {
  it("rounds RAM so a machine reporting slightly under its installed size shares the class", () => {
    expect(hostClassOf(server)).toBe("arm64-emulated-2c-12g");
    expect(hostClassOf({ ...desktop, totalRamBytes: 15.6 * GIB })).toBe("x64-native-8c-16g");
    expect(hostClassOf(desktop)).toBe("x64-native-8c-16g");
  });
});
