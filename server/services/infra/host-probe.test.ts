import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The server's self-description for the placement engine (WP-0 acceptance: "the probe, with mocked
 * values"). The detectors and the tool runs are faked, so the answer does not depend on what this
 * machine has installed.
 */

const foldxBin = { value: "foldx" as string };
const p2rankReady = { value: true, calls: 0 };

vi.mock("../stability/foldx/detector.ts", () => ({
  detectFoldxBinaryAndDir: () => ({ foldxBin: foldxBin.value, foldxDir: "" }),
  getFoldxExecutionTarget: (bin: string, args: string[]) => ({ file: bin, args }),
}));
vi.mock("../structure/pocket/java-detector.ts", () => ({
  checkP2RankCapability: async () => {
    p2rankReady.calls++;
    await new Promise((r) => setTimeout(r, 20));
    return { installed: true, path: "/opt/p2rank/prank", ready: p2rankReady.value };
  },
  discoverJavaHome: async () => "",
}));

const {
  probeServerHost, serverTools, serverToolsCached, serverToolVersion, serverProvenance, _resetHostProbe, _setToolRunner,
  _lastHostProbeReport, SERVER_HOST_ID,
  parseFoldxBanner, parseP2RankVersion, foldxBuildExpiry, foldxExpiryNote, foldxBuildExpired, foldxRanNormally, judgeSelfTest,
} = await import("./host-probe.ts");
const { routingMode } = await import("./admission.ts");
type ToolRun = import("./host-probe.ts").ToolRun;

const FOLDX_BANNER = [
  "   ********************************************",
  "   ***             FoldX 5.1 (c)            ***",
  "   ********************************************",
  "",
  "No pdbs for the run found at:",
  "Foldx will end",
].join("\n");
const ok = (output: string): ToolRun => ({ code: 0, output, timedOut: false, spawnError: null });
/** FoldX's normal banner run exits with -1 (4294967295 on Windows). */
const foldxRun = (output: string): ToolRun => ({ code: 4294967295, output, timedOut: false, spawnError: null });

/** What each faked tool prints when run: FoldX its banner, P2Rank its version line. */
const runs = { foldx: foldxRun(FOLDX_BANNER), p2rank: ok("P2Rank 2.6-alpha\n") };
const started: string[] = [];

beforeEach(() => {
  _resetHostProbe();
  foldxBin.value = "foldx";
  p2rankReady.value = true;
  p2rankReady.calls = 0;
  runs.foldx = foldxRun(FOLDX_BANNER);
  runs.p2rank = ok("P2Rank 2.6-alpha\nJVM: OpenJDK 64-Bit Server VM 17.0.20\n");
  started.length = 0;
  _setToolRunner(async (file) => {
    started.push(file);
    return /prank/.test(file) ? runs.p2rank : runs.foldx;
  });
});
afterEach(() => _setToolRunner(null));

describe("server host probe", () => {
  it("reports the tools it finds, as the server host", async () => {
    const host = await probeServerHost({ runningJobs: 2, runningCostMs: 10, queuedCostMs: 20 });
    expect(host).toMatchObject({ id: SERVER_HOST_ID, kind: "server", ownerId: null, online: true, runningJobs: 2, runningCostMs: 10, queuedCostMs: 20 });
    expect(host.tools.map((t) => t.name).sort()).toEqual(["foldx", "p2rank"]);
    expect(host.cores).toBeGreaterThan(0);
    expect(host.totalRamBytes).toBeGreaterThan(0);
  });

  it("leaves out a tool that is not installed, without trying to run it", async () => {
    foldxBin.value = "/nowhere/foldx-missing";
    p2rankReady.value = false;
    expect(await serverTools()).toEqual([]);
    expect(started).toEqual([]);
  });

  it("probes once for a burst of cold calls (P2Rank's check starts Java)", async () => {
    await Promise.all([serverTools(), serverTools(), serverTools(), serverTools()]);
    expect(p2rankReady.calls).toBe(1);
  });
});

describe("tool self-tests", () => {
  it("reads each tool's version from its own output and marks it verified", async () => {
    expect(await serverTools()).toEqual([
      { name: "foldx", version: "5.1", verified: true, selfTest: "passed" },
      { name: "p2rank", version: "2.6-alpha", verified: true, selfTest: "passed" },
    ]);
    expect(serverToolVersion("foldx")).toBe("5.1");
    expect(serverToolVersion("p2rank")).toBe("2.6-alpha");
    expect(serverProvenance("u1", "foldx")).toMatchObject({ computedOn: "server", toolVersion: "5.1", ownerId: "u1" });
    expect(serverProvenance(null).toolVersion).toBeNull();
  });

  it("keeps a clean answer for the life of the process", async () => {
    await serverTools(1_000);
    await serverTools(1_000 + 24 * 3_600_000);
    expect(p2rankReady.calls).toBe(1);
  });

  it("a bare 'foldx' that cannot be started is missing, not assumed present", async () => {
    runs.foldx = { code: null, output: "", timedOut: false, spawnError: "ENOENT: spawn foldx ENOENT" };
    expect((await serverTools()).map((t) => t.name)).toEqual(["p2rank"]);
  });

  it("a tool that runs but fails (an expired licence) is unverified, and is tested again after 10 minutes", async () => {
    runs.foldx = foldxRun("   ***  FoldX 5.1 (c)  ***\nYour FoldX license has expired\nFoldx will end\n");
    expect((await serverTools(0)).find((t) => t.name === "foldx")).toEqual({ name: "foldx", version: "5.1", verified: false, selfTest: "failed" });
    runs.foldx = foldxRun(FOLDX_BANNER);
    expect((await serverTools(5 * 60_000)).find((t) => t.name === "foldx")?.verified).toBe(false);
    expect((await serverTools(11 * 60_000)).find((t) => t.name === "foldx")?.verified).toBe(true);
  });

  it("a self-test that only times out keeps the tool usable (a busy host proves nothing)", async () => {
    runs.p2rank = { code: null, output: "", timedOut: true, spawnError: null };
    expect((await serverTools()).find((t) => t.name === "p2rank")).toEqual({ name: "p2rank", version: "unknown", verified: true, selfTest: "timeout" });
    expect(serverToolVersion("p2rank")).toBeNull();
  });

  it("marks FoldX failed once its build date has passed, and says when the name carries no date", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-exp-"));
    const expired = path.join(dir, "foldx_20200101");
    fs.writeFileSync(expired, "");
    foldxBin.value = expired;
    const now = Date.parse("2026-06-01T12:00:00Z"); // after the 2020 build date, before the dateless check
    // The name's date is authoritative: even though the tool starts and prints a banner, it is not usable.
    expect((await serverTools(now)).find((t) => t.name === "foldx")?.verified).toBe(false);
    expect(_lastHostProbeReport()).toMatch(/stopped working on 2020-01-01/);

    _resetHostProbe();
    const undated = path.join(dir, "foldx");
    fs.writeFileSync(undated, "");
    foldxBin.value = undated;
    expect((await serverTools(now)).find((t) => t.name === "foldx")?.verified).toBe(true);
    expect(_lastHostProbeReport()).toMatch(/carries no build date/);
  });

  it("serves a stale tool list to a request path without waiting for the re-probe", async () => {
    runs.foldx = foldxRun("   ***  FoldX 5.1 (c)  ***\nYour FoldX license has expired\nFoldx will end\n");
    await serverTools(0); // cold: foldx fails, so the cache is never "clean"
    runs.foldx = foldxRun(FOLDX_BANNER); // now it would pass
    // Past the 10-minute TTL: the stale answer is served at once instead of awaiting a 60 s self-test.
    expect((await serverToolsCached(11 * 60_000)).find((t) => t.name === "foldx")?.verified).toBe(false);
    await new Promise((r) => setTimeout(r, 80)); // the background refresh completes
    expect((await serverToolsCached(11 * 60_000)).find((t) => t.name === "foldx")?.verified).toBe(true);
  });
});

describe("version parsing", () => {
  it("reads FoldX's banner, P2Rank's -v line and the FoldX build date", () => {
    expect(parseFoldxBanner(FOLDX_BANNER)).toBe("5.1");
    expect(parseFoldxBanner("No pdbs for the run found")).toBeNull();
    expect(parseP2RankVersion("P2Rank 2.6-alpha\nHome: /opt")).toBe("2.6-alpha");
    expect(parseP2RankVersion("P2Rank 2.4.2")).toBe("2.4.2");
    expect(foldxBuildExpiry("/app/tools/foldx_linux/foldx_20261231")).toBe("2026-12-31");
    expect(foldxBuildExpiry("C:/tools/foldx/foldx_1_20270131.exe")).toBe("2027-01-31");
    expect(foldxBuildExpiry("/usr/bin/foldx")).toBeNull();
    expect(foldxBuildExpiry("/x/foldx_20269999")).toBeNull(); // impossible month/day, not a fake date
  });

  it("says how long the FoldX build has left: quiet when far, a warning when near, an error when past", () => {
    const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
    expect(foldxExpiryNote("2026-12-31", day("2026-06-01"))).toBe(" (build valid until 2026-12-31)");
    expect(foldxExpiryNote("2026-12-31", day("2026-12-01"))).toMatch(/stops working on 2026-12-31 \(in 30 days\)/);
    expect(foldxExpiryNote("2026-12-31", day("2027-01-02"))).toMatch(/stopped working on 2026-12-31/);
    // The build still works ON its named day (the old prior said it had already stopped at noon).
    expect(foldxExpiryNote("2026-12-31", day("2026-12-31"))).toMatch(/stops working today \(2026-12-31\)/);
    expect(foldxExpiryNote("2026-12-31", day("2026-12-30"))).toMatch(/\(in 1 day\)/);
    expect(foldxExpiryNote("2026-99-99", day("2026-06-01"))).toBe(""); // never print "valid until 2026-99-99"
    expect(foldxBuildExpired("2026-12-31", day("2026-12-31"))).toBe(false);
    expect(foldxBuildExpired("2026-12-31", day("2027-01-01"))).toBe(true);
  });

  it("FoldX passes on reaching its own ending, whatever the exit code; a crash under emulation does not", () => {
    const normal = foldxRun(FOLDX_BANNER);
    expect(judgeSelfTest("foldx", normal, "5.1", foldxRanNormally(normal)).tool?.verified).toBe(true);
    const crash = foldxRun("   ***  FoldX 5.1 (c)  ***\nUnhandled signal caught\n");
    const check = judgeSelfTest("foldx", crash, "5.1", foldxRanNormally(crash));
    expect(check.tool).toEqual({ name: "foldx", version: "5.1", verified: false, selfTest: "failed" });
    expect(check.detail).toContain("Unhandled signal caught");
  });

  it("judges a run that printed no version as unverified, with its last line as the reason", () => {
    const check = judgeSelfTest("foldx", ok("something\nunexpected end\n"), null);
    expect(check.tool?.verified).toBe(false);
    expect(check.detail).toContain("unexpected end");
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
