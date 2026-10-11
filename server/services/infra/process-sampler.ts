/**
 * process-sampler.ts — peak resident memory of a process TREE, sampled while it runs
 * (doc/COMPUTE_ROUTING_PLAN.md, WP-0).
 *
 * WHY A TREE
 * ----------
 * The process Node starts is rarely the one that uses the memory: P2Rank is a shell script that
 * starts Java, FoldX on the ARM server runs under Box64, and on Windows a `.bat` goes through
 * `cmd.exe`. The number that predicts an out-of-memory death is the whole tree's resident memory,
 * so each sample sums every tracked root and all of its descendants.
 *
 * HOW, PER PLATFORM
 * -----------------
 *   Linux   — `/proc/<pid>/status`, read directly: no subprocess, cheap at 1 s. It uses `VmHWM`, the
 *             kernel's own high-water mark per process, so a spike between two samples is not missed.
 *   macOS   — one `ps -A -o pid=,ppid=,rss=`. `rss` is a sampled instantaneous value (a lower bound).
 *   Windows — one PowerShell `Get-CimInstance Win32_Process` (`wmic` is gone from current Windows).
 *             It reads `PeakWorkingSetSize` (the same high-water meaning as Linux's `VmHWM`, falling
 *             back to the live `WorkingSetSize`), converted to bytes. It costs a few hundred
 *             milliseconds per call, so Windows samples every 2 s and never overlaps two calls.
 *
 * All platforms therefore report a per-process high-water mark, so a peak is comparable across host
 * classes. macOS is the exception: `ps` has no high-water column, so its numbers are a lower bound.
 *
 * A sample that fails (a process exited mid-read, PowerShell is slow) is skipped, never thrown:
 * measuring a job must not be able to change how the job ends.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";

export interface ProcessEntry {
  pid: number;
  ppid: number;
  /** Resident bytes; on Linux the process's own peak so far (`VmHWM`). */
  rssBytes: number;
}

export type ProcessLister = () => Promise<ProcessEntry[]>;

/**
 * `PPid` and resident memory from a Linux `/proc/<pid>/status`: the high-water mark `VmHWM` where the
 * kernel reports one, else `VmRSS`. A kernel thread has neither: 0 bytes.
 */
export function parseProcStatus(pid: number, text: string): ProcessEntry | null {
  const ppid = text.match(/^PPid:\s+(\d+)/m);
  if (!ppid) return null;
  const rss = text.match(/^VmHWM:\s+(\d+)\s+kB/m) ?? text.match(/^VmRSS:\s+(\d+)\s+kB/m);
  return { pid, ppid: Number(ppid[1]), rssBytes: rss ? Number(rss[1]) * 1024 : 0 };
}

/** `pid ppid rss-in-KiB` lines, as printed by `ps -A -o pid=,ppid=,rss=`. */
export function parsePsOutput(text: string): ProcessEntry[] {
  const out: ProcessEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), rssBytes: Number(m[3]) * 1024 });
  }
  return out;
}

/** `pid,ppid,working-set-bytes` lines, as printed by the PowerShell command below. */
export function parseWindowsProcessList(text: string): ProcessEntry[] {
  const out: ProcessEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+),(\d+),(\d+)$/);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), rssBytes: Number(m[3]) });
  }
  return out;
}

/**
 * Resident bytes of the given roots and every descendant. Each process counts once, however many
 * roots reach it, and a parent-pid cycle (Windows reuses pids) cannot loop.
 */
export function treeRssBytes(entries: ProcessEntry[], roots: Iterable<number>): number {
  const children = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const e of entries) {
    rss.set(e.pid, e.rssBytes);
    if (e.pid === e.ppid) continue;
    const list = children.get(e.ppid);
    if (list) list.push(e.pid);
    else children.set(e.ppid, [e.pid]);
  }
  const seen = new Set<number>();
  const stack: number[] = [];
  for (const r of roots) if (rss.has(r)) stack.push(r);
  let total = 0;
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  return total;
}

async function listLinux(): Promise<ProcessEntry[]> {
  const names = await fs.readdir("/proc");
  const reads = names
    .filter((n) => /^\d+$/.test(n))
    .map(async (n) => {
      try {
        return parseProcStatus(Number(n), await fs.readFile(`/proc/${n}/status`, "utf8"));
      } catch {
        return null; // exited between readdir and read
      }
    });
  return (await Promise.all(reads)).filter((e): e is ProcessEntry => e !== null);
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });
}

/** `PeakWorkingSetSize` is Windows' high-water mark, in KiB; fall back to the live set when absent. */
const WINDOWS_LIST =
  "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2}' -f $_.ProcessId, $_.ParentProcessId, $(if ($_.PeakWorkingSetSize -gt 0) { $_.PeakWorkingSetSize * 1KB } else { $_.WorkingSetSize }) }";

/** Every process on this machine with its parent and resident bytes, by the cheapest means available. */
export const listProcesses: ProcessLister = async () => {
  if (process.platform === "linux") return listLinux();
  if (process.platform === "win32") {
    return parseWindowsProcessList(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_LIST], 15_000));
  }
  return parsePsOutput(await run("ps", ["-A", "-o", "pid=,ppid=,rss="], 5_000));
};

/**
 * One process listing shared by every sampler that samples at the same instant. Without it, N concurrent
 * jobs run N full enumerations per tick (a `/proc` scan each, or one PowerShell/CIM call each), which
 * competes with the very jobs the measurement exists to observe. Concurrent samplers get one snapshot;
 * sequential ones each get a fresh one, so nothing reads a stale table.
 */
let tableInFlight: Promise<ProcessEntry[]> | null = null;
export function listProcessesShared(): Promise<ProcessEntry[]> {
  if (!tableInFlight) {
    tableInFlight = listProcesses().finally(() => {
      tableInFlight = null;
    });
  }
  return tableInFlight;
}

/** For tests: forget a listing that is still in flight. */
export function _resetProcessTableCache(): void {
  tableInFlight = null;
}

/** 1 s where a sample is a few file reads; 2 s where it is a PowerShell process. */
export const DEFAULT_SAMPLE_MS = process.platform === "win32" ? 2_000 : 1_000;

/**
 * Samples the summed tree memory of the tracked roots until stopped, and keeps the peak.
 *
 * One timer for all roots, so two processes running AT THE SAME TIME are added together (a job's
 * true peak), while processes that run one after another are not.
 */
export class ProcessTreeSampler {
  private readonly roots = new Set<number>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private peak: number | null = null;
  private stopped = false;

  constructor(
    private readonly opts: { intervalMs?: number; list?: ProcessLister } = {},
  ) {}

  /** The highest summed resident memory seen so far, or null before the first successful sample. */
  get peakBytes(): number | null {
    return this.peak;
  }

  /** Start following `pid` and its descendants. The first sample is taken at once. */
  track(pid: number | undefined): void {
    if (!pid || this.stopped) return;
    this.roots.add(pid);
    if (!this.timer) {
      // A tick while a slow listing is still running is skipped, so a backlog can never build up.
      this.timer = setInterval(() => { if (!this.inFlight) void this.sample(); }, this.opts.intervalMs ?? DEFAULT_SAMPLE_MS);
      this.timer.unref();
    }
    void this.sample();
  }

  /** Stop following `pid` (it exited). The timer stops when nothing is left to follow. */
  untrack(pid: number | undefined): void {
    if (!pid) return;
    this.roots.delete(pid);
    if (this.roots.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One sample now. Never throws, and never runs two listings at once: asked while one is running, it
   * takes another after it, because the running one may predate a root just added.
   */
  sample(): Promise<void> {
    if (this.inFlight) return this.inFlight.then(() => this.sample());
    if (this.roots.size === 0) return Promise.resolve();
    const roots = [...this.roots];
    this.inFlight = (async () => {
      try {
        const total = treeRssBytes(await (this.opts.list ?? listProcessesShared)(), roots);
        if (total > 0 && (this.peak === null || total > this.peak)) this.peak = total;
      } catch {
        // Skipped: a lost sample only makes the peak less exact.
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Stop sampling (waiting for a sample in progress) and return the peak. */
  async stop(): Promise<number | null> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.roots.clear();
    if (this.inFlight) await this.inFlight;
    return this.peak;
  }
}
