import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The server's self-description for the placement engine (WP-0 acceptance: "the probe, with mocked
 * values"). The detectors are mocked so the answer does not depend on what this machine has installed.
 */

const foldxBin = { value: "foldx" as string };
const p2rankReady = { value: true, calls: 0 };

vi.mock("../stability/foldx/detector.ts", () => ({
  detectFoldxBinaryAndDir: () => ({ foldxBin: foldxBin.value, foldxDir: "" }),
  getFoldxExecutionTarget: (bin: string) => ({ file: bin, args: [] }),
}));
vi.mock("../structure/pocket/java-detector.ts", () => ({
  checkP2RankCapability: async () => {
    p2rankReady.calls++;
    await new Promise((r) => setTimeout(r, 20));
    return { ready: p2rankReady.value };
  },
}));

const { probeServerHost, serverTools, _resetHostProbe, SERVER_HOST_ID } = await import("./host-probe.ts");
const { routingMode } = await import("./admission.ts");

beforeEach(() => {
  _resetHostProbe();
  foldxBin.value = "foldx";
  p2rankReady.value = true;
  p2rankReady.calls = 0;
});

describe("server host probe", () => {
  it("reports the tools it finds, as the server host", async () => {
    const host = await probeServerHost({ runningJobs: 2, runningCostMs: 10, queuedCostMs: 20 });
    expect(host).toMatchObject({ id: SERVER_HOST_ID, kind: "server", ownerId: null, online: true, runningJobs: 2, runningCostMs: 10, queuedCostMs: 20 });
    expect(host.tools.map((t) => t.name).sort()).toEqual(["foldx", "p2rank"]);
    expect(host.cores).toBeGreaterThan(0);
    expect(host.totalRamBytes).toBeGreaterThan(0);
  });

  it("leaves out a tool that is not installed", async () => {
    foldxBin.value = "/nowhere/foldx-missing";
    p2rankReady.value = false;
    expect(await serverTools()).toEqual([]);
  });

  it("probes once for a burst of cold calls (P2Rank's check starts Java)", async () => {
    await Promise.all([serverTools(), serverTools(), serverTools(), serverTools()]);
    expect(p2rankReady.calls).toBe(1);
  });
});

describe("COMPUTE_ROUTING", () => {
  const saved = { mode: process.env.COMPUTE_ROUTING, env: process.env.NODE_ENV };
  afterEach(() => {
    if (saved.mode === undefined) delete process.env.COMPUTE_ROUTING;
    else process.env.COMPUTE_ROUTING = saved.mode;
    process.env.NODE_ENV = saved.env;
  });

  it("is off/on only when said exactly; anything else is the safe shadow; unset under test is off", () => {
    process.env.COMPUTE_ROUTING = "on";
    expect(routingMode()).toBe("on");
    process.env.COMPUTE_ROUTING = " OFF ";
    expect(routingMode()).toBe("off");
    process.env.COMPUTE_ROUTING = "shadwo"; // a typo never turns refusals on
    expect(routingMode()).toBe("shadow");
    delete process.env.COMPUTE_ROUTING;
    expect(routingMode()).toBe("off");
    process.env.NODE_ENV = "production";
    expect(routingMode()).toBe("shadow");
  });
});
