/**
 * host-probe.ts — the server described as a `HostFeatures`, for the placement engine.
 *
 * Facts only, read the same way the code that RUNS the tools reads them: emulation from the FoldX
 * runner's Box64 check, FoldX from its binary detector, P2Rank from its capability check. A tool the
 * server cannot find is reported missing, so in `COMPUTE_ROUTING=on` a job it cannot run is refused
 * with that reason up front instead of failing minutes later.
 *
 * SELF-TESTS (WP-0). Each tool is RUN once, the way its runner runs it, and its own output names the
 * version: FoldX prints a banner when started without a command (under Box64 on the ARM server, so the
 * emulator is tested too), and P2Rank answers `-v` (so Java is tested too). A tool that runs and prints
 * its banner is `verified`. One that cannot start is missing; one that starts but exits with an error
 * or prints no banner is unverified; either way the reason is logged. A self-test that only TIMES OUT
 * (a busy host) proves nothing: the tool is kept as present with version "unknown", exactly as before
 * self-tests existed, and is tested again on the next probe.
 *
 * A clean result is kept for the life of the process (tools change only on redeploy, and a redeploy is
 * a new process); anything less is probed again after 10 minutes.
 */
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { hostClassOf, type HostFeatures, type HostTool, type JobType, type ToolName } from "../../../src/shared/computeRouting.ts";
import type { ComputeProvenance } from "../../../src/shared/computeProvenance.ts";
import { CONFIG } from "../../config.ts";
import { killProcessTree } from "../../utils/process-tree.ts";
import { detectFoldxBinaryAndDir, getFoldxExecutionTarget } from "../stability/foldx/detector.ts";
import { foldxRunsEmulated } from "../stability/foldx/estimate.ts";
import { checkP2RankCapability, discoverJavaHome } from "../structure/pocket/java-detector.ts";

export const SERVER_HOST_ID = "server";

/** A probe that was not clean is repeated after this long; a clean one is kept for the process. */
const TOOL_TTL_MS = 10 * 60 * 1000;
/** Box64 start-up on the 2-core server, or a JVM start, on a busy host. */
const SELF_TEST_TIMEOUT_MS = 60_000;
/** Warn this many days before the FoldX build stops working. */
const FOLDX_EXPIRY_WARN_DAYS = 45;

let toolCache: { at: number; tools: HostTool[]; clean: boolean } | null = null;

// ── Running a tool ──────────────────────────────────────────────────────────────────────────────────

export interface ToolRun {
  /** Exit code; null when it did not exit by itself. */
  code: number | null;
  output: string;
  timedOut: boolean;
  /** The tool could not be started at all (ENOENT, EACCES …). */
  spawnError: string | null;
}

export type ToolRunner = (
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; verbatim?: boolean },
) => Promise<ToolRun>;

const runTool: ToolRunner = (file, args, opts) =>
  new Promise((resolve) => {
    let timedOut = false;
    let cap: NodeJS.Timeout;
    const child = execFile(
      file,
      args,
      { cwd: opts.cwd || undefined, env: opts.env, windowsHide: true, maxBuffer: 1024 * 1024, windowsVerbatimArguments: opts.verbatim },
      (err, stdout, stderr) => {
        clearTimeout(cap);
        const output = `${stdout ?? ""}${stderr ?? ""}`;
        if (timedOut) return resolve({ code: null, output, timedOut: true, spawnError: null });
        if (!err) return resolve({ code: 0, output, timedOut: false, spawnError: null });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        if (typeof e.code === "string") return resolve({ code: null, output, timedOut: false, spawnError: `${e.code}: ${e.message}` });
        resolve({ code: typeof e.code === "number" ? e.code : null, output, timedOut: Boolean(e.killed), spawnError: null });
      },
    );
    // Our own timeout, so the whole tool TREE can be killed: execFile's own `timeout` signals only the
    // direct child, which for P2Rank is a script (or a `.bat` through cmd.exe) whose JVM would survive
    // and, on a host whose probe repeats every 10 minutes, accumulate.
    cap = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, opts.timeoutMs);
    cap.unref?.();
  });

let toolRunner: ToolRunner = runTool;

// ── Reading versions ────────────────────────────────────────────────────────────────────────────────

/** "5.1" from FoldX's banner (`***   FoldX 5.1 (c)   ***`). */
export function parseFoldxBanner(output: string): string | null {
  return output.match(/FoldX\s+(\d+(?:\.\d+)+)/i)?.[1] ?? null;
}

/**
 * The date in a FoldX binary's name (`foldx_20261231`, `foldx_1_20270131.exe`) as YYYY-MM-DD. The
 * academic builds are time-limited and named for the day they stop working, so this is the date by
 * which the next build must be installed.
 */
export function foldxBuildExpiry(binaryPath: string): string | null {
  const m = path.basename(binaryPath).match(/(20\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Reject an impossible month/day (a stray 8-digit run in a file name) rather than print a fake date.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** "2.6-alpha" from `prank -v` (`P2Rank 2.6-alpha`). */
export function parseP2RankVersion(output: string): string | null {
  return output.match(/P2Rank\s+(\d+(?:\.\d+)*(?:[-+][\w.]+)?)/i)?.[1] ?? null;
}

/** What a self-test found. */
export interface ToolCheck {
  tool: HostTool | null;
  /** Reader-facing: what was found, or why the tool is not usable. */
  detail: string;
  /** Final for this process: nothing to gain from testing again. */
  clean: boolean;
}

function lastLine(output: string): string {
  return output.trim().split(/\r?\n/).filter(Boolean).pop()?.trim().slice(0, 200) ?? "";
}

/**
 * FoldX started with no command prints its banner, "No pdbs for the run found" and "Foldx will end",
 * and exits with -1: that IS the normal run, so the exit code cannot be the test. It passed if it reached
 * its own ending and said nothing about an expired licence.
 */
export function foldxRanNormally(run: ToolRun): boolean {
  return /Foldx will end/i.test(run.output) && !/expired|licen[cs]e is not valid/i.test(run.output);
}

/**
 * Judge one self-test run. Pure, so every outcome is unit-tested without the tool. `ranNormally`
 * defaults to a zero exit code (P2Rank); FoldX passes `foldxRanNormally`.
 */
export function judgeSelfTest(name: ToolName, run: ToolRun, version: string | null, ranNormally = run.code === 0): ToolCheck {
  const label = name === "foldx" ? "FoldX" : "P2Rank";
  if (run.spawnError) return { tool: null, detail: `${label} could not be started (${run.spawnError})`, clean: false };
  if (run.timedOut) {
    return {
      // Present and assumed usable (a busy host proves nothing), but `selfTest` records that this was a
      // timeout rather than a pass, so the field cannot be read as "it ran successfully".
      tool: { name, version: "unknown", verified: true, selfTest: "timeout" },
      detail: `${label}'s self-test did not finish in time; it is assumed usable and will be tested again`,
      clean: false,
    };
  }
  if (ranNormally && version) {
    return { tool: { name, version, verified: true, selfTest: "passed" }, detail: `${label} ${version} passed its self-test`, clean: true };
  }
  const why = lastLine(run.output) || `exit code ${run.code}`;
  return { tool: { name, version: version ?? "unknown", verified: false, selfTest: "failed" }, detail: `${label} ran but failed its self-test: ${why}`, clean: false };
}

/**
 * True once the day named by a FoldX build has fully PASSED — the build still works ON that day, so at
 * noon on the expiry date it is not yet expired (the old prior said it was).
 */
export function foldxBuildExpired(expiry: string, now: number): boolean {
  const end = Date.parse(`${expiry}T23:59:59.999Z`);
  return Number.isFinite(end) && now > end;
}

/** The expiry sentence for a FoldX build: silent when far off, a warning when near, an error when past. */
export function foldxExpiryNote(expiry: string, now: number): string {
  const msLeft = Date.parse(`${expiry}T23:59:59.999Z`) - now;
  if (!Number.isFinite(msLeft)) return ""; // foldxBuildExpiry rejects malformed dates, but never print "NaN"
  if (msLeft < 0) return `. This FoldX build stopped working on ${expiry}; install the current build from foldxsuite.crg.eu`;
  const daysLeft = Math.floor(msLeft / 86_400_000);
  if (daysLeft === 0) return `. This FoldX build stops working today (${expiry}); install the next build from foldxsuite.crg.eu before then`;
  if (daysLeft <= FOLDX_EXPIRY_WARN_DAYS) {
    return `. This FoldX build stops working on ${expiry} (in ${daysLeft} day${daysLeft === 1 ? "" : "s"}); install the next build from foldxsuite.crg.eu before then`;
  }
  return ` (build valid until ${expiry})`;
}

async function checkFoldx(now: number): Promise<ToolCheck> {
  const { foldxBin, foldxDir } = detectFoldxBinaryAndDir();
  // A bare "foldx" means "whatever is on PATH": the self-test decides whether there is one.
  if (foldxBin !== "foldx" && !fs.existsSync(foldxBin)) {
    return { tool: null, detail: `FoldX is not installed (looked for ${foldxBin})`, clean: false };
  }
  // Started with no command it prints its banner and exits, through the runner's Box64 routing.
  const target = getFoldxExecutionTarget(foldxBin, []);
  const run = await toolRunner(target.file, target.args, { cwd: foldxDir || undefined, timeoutMs: SELF_TEST_TIMEOUT_MS });
  const check = judgeSelfTest("foldx", run, parseFoldxBanner(run.output), foldxRanNormally(run));
  if (!check.tool) return check;
  const expiry = foldxBuildExpiry(foldxBin);
  if (!expiry) {
    // The runbook tells the owner to watch this line as the renewal trigger, so say when it is unarmed.
    check.detail += ". This FoldX binary's name carries no build date, so no expiry warning is possible";
    return check;
  }
  check.detail += foldxExpiryNote(expiry, now);
  if (foldxBuildExpired(expiry, now)) {
    // The date in the name is authoritative. FoldX's own wording is not guaranteed to match /expired/,
    // so a build whose name has passed must not stay `verified`: otherwise, with COMPUTE_ROUTING=on,
    // an expired build keeps admitting jobs.
    check.tool = { ...check.tool, verified: false, selfTest: "failed" };
    check.clean = false;
  }
  return check;
}

async function checkP2Rank(): Promise<ToolCheck> {
  const cap = await checkP2RankCapability();
  if (!cap.installed || !cap.path) return { tool: null, detail: "P2Rank is not installed", clean: false };
  if (!cap.ready) return { tool: null, detail: "P2Rank is installed but no Java 17 or newer was found", clean: false };
  // The Java the runner injects (pocket/runner.ts): JAVA_HOME set to the discovered home, or removed.
  const env = { ...process.env };
  const javaHome = await discoverJavaHome();
  if (javaHome) env.JAVA_HOME = javaHome;
  else if (javaHome === "") delete env.JAVA_HOME;
  // Run the batch file EXACTLY as the runner does (pocket/runner.ts): quoted command line, `/s`, and
  // windowsVerbatimArguments, so a path containing a space passes the self-test instead of looking
  // broken (which would refuse every pocket job under COMPUTE_ROUTING=on).
  const isBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(cap.path);
  const run = isBatch
    ? await toolRunner(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", `"${[cap.path, "-v"].map((a) => `"${a.replace(/"/g, '""')}"`).join(" ")}"`],
        { env, timeoutMs: SELF_TEST_TIMEOUT_MS, verbatim: true },
      )
    : await toolRunner(cap.path, ["-v"], { env, timeoutMs: SELF_TEST_TIMEOUT_MS });
  return judgeSelfTest("p2rank", run, parseP2RankVersion(run.output));
}

let probing: Promise<HostTool[]> | null = null;

function startProbe(now: number): Promise<HostTool[]> {
  // One probe at a time: a burst of callers must not start one self-test each.
  if (!probing) probing = probeTools(now).finally(() => { probing = null; });
  return probing;
}

export async function serverTools(now = Date.now()): Promise<HostTool[]> {
  if (toolCache && (toolCache.clean || now - toolCache.at < TOOL_TTL_MS)) return toolCache.tools;
  return startProbe(now);
}

/**
 * The tool list for a request path that must not WAIT on a self-test. A stale-but-present answer is
 * returned at once and refreshed in the background, so a submission never pays up to the 60 s self-test
 * timeout every 10 minutes on a host whose tools are missing or failing (which, after the FoldX licence
 * date, is permanent). A completely cold cache still waits once, so early submissions are never
 * refused for tools this server actually has.
 */
export async function serverToolsCached(now = Date.now()): Promise<HostTool[]> {
  if (!toolCache) return startProbe(now);
  if (!toolCache.clean && now - toolCache.at >= TOOL_TTL_MS) void startProbe(now);
  return toolCache.tools;
}

let lastReport = "";

async function probeTools(now: number): Promise<HostTool[]> {
  const failed = (label: string) => (err: unknown): ToolCheck => ({
    tool: null,
    detail: `${label}'s self-test could not run (${(err as Error)?.message ?? err})`,
    clean: false,
  });
  const checks = await Promise.all([checkFoldx(now).catch(failed("FoldX")), checkP2Rank().catch(failed("P2Rank"))]);
  const tools = checks.flatMap((c) => (c.tool ? [c.tool] : []));
  toolCache = { at: now, tools, clean: checks.every((c) => c.clean) };
  // One line whenever the answer changes, so `docker logs` shows what the server can run, and why not.
  const report = checks.map((c) => c.detail).join("; ");
  if (report !== lastReport && process.env.NODE_ENV !== "test") console.log(`[host-probe] ${report}.`);
  lastReport = report;
  return tools;
}

/**
 * The version of the tool a job type runs, as this server's last probe reported it; null before a
 * probe or when unknown. Synchronous, for the telemetry row written when a job ends.
 */
export function serverToolVersion(type: JobType): string | null {
  const name: ToolName = type === "foldx" ? "foldx" : "p2rank";
  const v = toolCache?.tools.find((t) => t.name === name)?.version;
  return v && v !== "unknown" ? v : null;
}

/** Probe in the background at start-up, so the first submission does not wait for the self-tests. */
export function warmServerTools(): void {
  void serverTools().catch(() => {});
}

/** For tests: forget the cached tool list, or pin it (so a test does not depend on this machine's tools). */
export function _resetHostProbe(pinned?: HostTool[]): void {
  toolCache = pinned ? { at: 0, tools: pinned, clean: true } : null;
  hostFacts = null;
  lastReport = "";
}

/** For tests: the last `[host-probe]` line (which carries the licence warning/reason). */
export function _lastHostProbeReport(): string {
  return lastReport;
}

/** For tests: run the self-tests through `runner` instead of starting the real tools. */
export function _setToolRunner(runner: ToolRunner | null): void {
  toolRunner = runner ?? runTool;
}

let hostFacts: Pick<HostFeatures, "arch" | "emulated" | "cores" | "totalRamBytes"> | null = null;

/**
 * The facts that define this server's host class, read ONCE per process. Telemetry and learned ceilings
 * are filed under the class; re-reading per call let a transient (Box64 not yet mounted, a RAM reading
 * on a bucket edge) file them under a different class and silently lose them.
 */
export function serverHostFacts(): Pick<HostFeatures, "arch" | "emulated" | "cores" | "totalRamBytes"> {
  hostFacts ??= {
    arch: process.arch === "arm64" ? "arm64" : "x64",
    emulated: foldxRunsEmulated(),
    cores: os.cpus().length,
    totalRamBytes: os.totalmem(),
  };
  return hostFacts;
}

/**
 * Provenance for a result this server computed, for `ownerId`'s job (null for unowned/background work),
 * with the version the tool reported in its self-test when the job type is known.
 */
export function serverProvenance(ownerId: string | null, type?: JobType): ComputeProvenance {
  let hostClass: string | null = null;
  try {
    hostClass = hostClassOf(serverHostFacts());
  } catch {
    // Provenance must never fail the result it describes.
  }
  return { computedOn: "server", hostClass, toolVersion: type ? serverToolVersion(type) : null, ownerId };
}

/**
 * Memory this process can still use. Once memory is measured the engine compares a job's predicted peak
 * against it, so in a container it must be the container's limit, not the host's: `os.freemem()` reads
 * the host, `process.availableMemory()` honours the cgroup limit (production caps the app at 10 GiB).
 */
export function freeRamBytes(): number {
  const host = os.freemem();
  if (typeof process.availableMemory !== "function") return host;
  const available = process.availableMemory();
  // 0 is a real reading (the cgroup is exhausted), not "unknown": report it, so the engine refuses
  // rather than falling back to the host's free memory at the one moment the container has none left.
  return Number.isFinite(available) ? Math.min(host, available) : host;
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
    freeRamBytes: freeRamBytes(),
    // Cached so the submission path never blocks on a self-test (see serverToolsCached).
    tools: await serverToolsCached(),
    runningJobs: load.runningJobs,
    runningCostMs: load.runningCostMs,
    queuedCostMs: load.queuedCostMs,
    linkRttMs: null,
    leaseLossRate: 0,
    minFreeBytes: CONFIG.memory.minFreeBytes,
  };
}
