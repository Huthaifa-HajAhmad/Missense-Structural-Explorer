import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { runInJobMeter, meterChildProcess } from "./job-meter.ts";
import {
  ProcessTreeSampler,
  parseProcStatus,
  parsePsOutput,
  parseWindowsProcessList,
  treeRssBytes,
  type ProcessEntry,
} from "./process-sampler.ts";

/**
 * WP-0 acceptance: "a spawned child that allocates a known amount". The real-process tests run on this
 * machine's own lister (Linux `/proc`, macOS `ps`, Windows PowerShell); the rest is pure.
 */

const MiB = 1024 * 1024;
const children: ChildProcess[] = [];

/** A Node child that fills `mib` MiB, says "ready", and stays alive until killed. */
function allocatingChild(mib: number): Promise<ChildProcess> {
  const code = `const b = Buffer.alloc(${mib} * 1024 * 1024, 1); process.stdout.write("ready"); setInterval(() => b[0]++, 1000);`;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  return new Promise((resolve, reject) => {
    child.stdout!.once("data", () => resolve(child));
    child.once("error", reject);
  });
}

afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

describe("process tree memory", () => {
  it("parses Linux /proc status, preferring the kernel's high-water mark", () => {
    const status = "Name:\tjava\nPPid:\t41\nVmHWM:\t  204800 kB\nVmRSS:\t  102400 kB\n";
    expect(parseProcStatus(42, status)).toEqual({ pid: 42, ppid: 41, rssBytes: 200 * MiB });
    expect(parseProcStatus(43, "Name:\tbash\nPPid:\t1\nVmRSS:\t 1024 kB\n")).toEqual({ pid: 43, ppid: 1, rssBytes: 1 * MiB });
    expect(parseProcStatus(2, "Name:\tkthreadd\nPPid:\t0\n")).toEqual({ pid: 2, ppid: 0, rssBytes: 0 });
    expect(parseProcStatus(9, "garbage")).toBeNull();
  });

  it("parses ps and the Windows process list", () => {
    expect(parsePsOutput("  10     1   2048\n  11    10   1024\nbad line\n")).toEqual([
      { pid: 10, ppid: 1, rssBytes: 2 * MiB },
      { pid: 11, ppid: 10, rssBytes: 1 * MiB },
    ]);
    expect(parseWindowsProcessList("4,0,1048576\r\n500,4,2097152\r\n\r\n")).toEqual([
      { pid: 4, ppid: 0, rssBytes: 1 * MiB },
      { pid: 500, ppid: 4, rssBytes: 2 * MiB },
    ]);
  });

  it("sums a root and all its descendants, once each, and survives a parent-pid cycle", () => {
    const list: ProcessEntry[] = [
      { pid: 1, ppid: 0, rssBytes: 999 * MiB }, // not part of the tree
      { pid: 10, ppid: 1, rssBytes: 1 * MiB }, // the shell script
      { pid: 11, ppid: 10, rssBytes: 300 * MiB }, // the JVM it starts
      { pid: 12, ppid: 11, rssBytes: 5 * MiB }, // a grandchild
      { pid: 20, ppid: 21, rssBytes: 7 * MiB }, // a reused-pid cycle
      { pid: 21, ppid: 20, rssBytes: 7 * MiB },
    ];
    expect(treeRssBytes(list, [10])).toBe(306 * MiB);
    expect(treeRssBytes(list, [10, 11])).toBe(306 * MiB); // overlapping roots count once
    expect(treeRssBytes(list, [20])).toBe(14 * MiB);
    expect(treeRssBytes(list, [404])).toBe(0); // already exited
  });

  it("adds trees that run at the same time, and keeps the highest total", async () => {
    let phase = 0;
    const frames: ProcessEntry[][] = [
      [{ pid: 10, ppid: 1, rssBytes: 100 }, { pid: 20, ppid: 1, rssBytes: 50 }],
      [{ pid: 10, ppid: 1, rssBytes: 40 }],
    ];
    const sampler = new ProcessTreeSampler({ intervalMs: 60_000, list: async () => frames[Math.min(phase, 1)] });
    sampler.track(10);
    sampler.track(20);
    await sampler.sample();
    expect(sampler.peakBytes).toBe(150);
    phase = 1;
    await sampler.sample();
    expect(await sampler.stop()).toBe(150);
  });

  it("never throws when listing fails; the peak simply stays unknown", async () => {
    const sampler = new ProcessTreeSampler({ intervalMs: 60_000, list: async () => { throw new Error("EPERM"); } });
    sampler.track(10);
    await sampler.sample();
    expect(await sampler.stop()).toBeNull();
  });

  it("measures a real child that allocates a known amount", async () => {
    const sampler = new ProcessTreeSampler({ intervalMs: 200 });
    const child = await allocatingChild(256);
    sampler.track(child.pid);
    await sampler.sample();
    const peak = await sampler.stop();
    expect(peak).not.toBeNull();
    // The buffer plus Node's own footprint: at least the 256 MiB written, and not wildly more.
    expect(peak!).toBeGreaterThanOrEqual(240 * MiB);
    expect(peak!).toBeLessThan(1024 * MiB);
  }, 30_000);
});

describe("job meter", () => {
  it("counts a child started inside a metered job, and ignores one started outside", async () => {
    const outside = await allocatingChild(64);
    meterChildProcess(outside); // no job: a no-op, nothing to assert but that it does not throw

    const sampler = new ProcessTreeSampler({ intervalMs: 200 });
    await runInJobMeter(sampler, async () => {
      // Across an await, as in the runners: the job still owns what it starts.
      await new Promise((r) => setTimeout(r, 10));
      const child = await allocatingChild(192);
      meterChildProcess(child);
      await sampler.sample();
    });
    const peak = await sampler.stop();
    expect(peak!).toBeGreaterThanOrEqual(180 * MiB);
  }, 30_000);
});
