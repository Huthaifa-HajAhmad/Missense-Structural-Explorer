/**
 * Memory the server can still use, in bytes, on Linux.
 *
 * "Free" memory is the wrong measure: Linux keeps recently read files in memory (the page cache) and
 * gives that memory back the moment a program needs it. The server reads large files (the 19 GB RaSP
 * table, model weights), so the cache grows until it fills the container's limit. Counting it as used
 * made the job queue believe 117 MB were left while 3.4 GB were reclaimable, and it stopped starting
 * jobs (test container, 2026-11-18).
 *
 * This reads what the kernel itself calls available: on the host, `MemAvailable` in /proc/meminfo;
 * in a container (cgroup v2), the limit minus the working set, where the working set is the memory in
 * use minus the inactive file cache (the part the kernel reclaims first). The smaller of the two wins.
 */
import fs from "fs";

type ReadFile = (path: string) => string;
const readText: ReadFile = path => fs.readFileSync(path, "utf8");

function readNumber(read: ReadFile, path: string): number | null {
  try {
    const value = Number(read(path).trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null; // The file does not exist here (not Linux, or cgroup v1): no reading.
  }
}

function hostAvailable(read: ReadFile): number | null {
  try {
    const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(read("/proc/meminfo"));
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function containerAvailable(read: ReadFile): number | null {
  const limit = readNumber(read, "/sys/fs/cgroup/memory.max"); // "max" (no limit) reads as null
  const current = readNumber(read, "/sys/fs/cgroup/memory.current");
  if (limit === null || current === null) return null;
  let inactiveFile = 0;
  try {
    const match = /^inactive_file\s+(\d+)/m.exec(read("/sys/fs/cgroup/memory.stat"));
    if (match) inactiveFile = Number(match[1]);
  } catch { /* without the breakdown, count everything as used: the cautious reading */ }
  return Math.max(0, limit - Math.max(0, current - inactiveFile));
}

/** Available bytes, or null when this system offers neither reading. */
export function availableMemoryBytes(read: ReadFile = readText): number | null {
  const readings = [hostAvailable(read), containerAvailable(read)].filter((v): v is number => v !== null);
  return readings.length ? Math.min(...readings) : null;
}
