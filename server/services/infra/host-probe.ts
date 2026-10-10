/**
 * host-probe.ts — the server described as a `HostFeatures`, for the placement engine.
 *
 * Facts only, read the same way the code that RUNS the tools reads them: emulation from the FoldX
 * runner's Box64 check, FoldX from its binary detector, P2Rank from its capability check. A tool the
 * server cannot find is reported missing, so in `COMPUTE_ROUTING=on` a job it cannot run is refused
 * with that reason up front instead of failing minutes later.
 *
 * Tool versions are not probed yet ("unknown") and no job requires a minimum version. `verified` means
 * "present", until WP-0's per-tool self-test exists; the shadow log is how a wrong answer is caught
 * before `on`.
 */
import fs from "fs";
import os from "os";
import type { HostFeatures, HostTool } from "../../../src/shared/computeRouting.ts";
import { CONFIG } from "../../config.ts";
import { detectFoldxBinaryAndDir } from "../stability/foldx/detector.ts";
import { foldxRunsEmulated } from "../stability/foldx/estimate.ts";
import { checkP2RankCapability } from "../structure/pocket/java-detector.ts";

export const SERVER_HOST_ID = "server";

/** Tool presence changes only on redeploy; probing P2Rank spawns Java, so it is cached. */
const TOOL_TTL_MS = 10 * 60 * 1000;
let toolCache: { at: number; tools: HostTool[] } | null = null;

function foldxPresent(): boolean {
  try {
    const { foldxBin } = detectFoldxBinaryAndDir();
    // A bare "foldx" means "whatever is on PATH"; the detector cannot tell, so it is not called missing.
    return foldxBin === "foldx" || fs.existsSync(foldxBin);
  } catch {
    return false;
  }
}

export async function serverTools(now = Date.now()): Promise<HostTool[]> {
  if (toolCache && now - toolCache.at < TOOL_TTL_MS) return toolCache.tools;
  const tools: HostTool[] = [];
  if (foldxPresent()) tools.push({ name: "foldx", version: "unknown", verified: true });
  try {
    if ((await checkP2RankCapability()).ready) tools.push({ name: "p2rank", version: "unknown", verified: true });
  } catch {
    // Treated as missing: the job would fail the same way.
  }
  toolCache = { at: now, tools };
  return tools;
}

/** For tests: forget the cached tool list, or pin it (so a test does not depend on this machine's tools). */
export function _resetHostProbe(pinned?: HostTool[]): void {
  toolCache = pinned ? { at: Number.MAX_SAFE_INTEGER / 2, tools: pinned } : null;
}

/** The facts that define this server's host class; cheap and synchronous, so the scheduler can use them per claim. */
export function serverHostFacts(): Pick<HostFeatures, "arch" | "emulated" | "cores" | "totalRamBytes"> {
  return {
    arch: process.arch === "arm64" ? "arm64" : "x64",
    emulated: foldxRunsEmulated(),
    cores: os.cpus().length,
    totalRamBytes: os.totalmem(),
  };
}

export async function probeServerHost(load: { runningJobs: number; runningCostMs: number; queuedCostMs: number }): Promise<HostFeatures> {
  return {
    id: SERVER_HOST_ID,
    kind: "server",
    ownerId: null,
    label: "the shared server",
    online: true,
    ...serverHostFacts(),
    os: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
    freeRamBytes: os.freemem(),
    tools: await serverTools(),
    runningJobs: load.runningJobs,
    runningCostMs: load.runningCostMs,
    queuedCostMs: load.queuedCostMs,
    linkRttMs: null,
    leaseLossRate: 0,
    minFreeBytes: CONFIG.memory.minFreeBytes,
  };
}
