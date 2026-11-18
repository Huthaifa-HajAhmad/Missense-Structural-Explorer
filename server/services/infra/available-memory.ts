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
 * in a container (cgroup v2, or v1 on older hosts), the limit minus the working set, where the working
 * set is the memory in use minus the inactive file cache (the part the kernel reclaims first). The
 * smaller of the two wins.
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

/** cgroup v1 writes a number near 2^63 for "no limit"; anything this large is no limit at all. */
const NO_LIMIT_BYTES = 2 ** 60;

/** Memory not yet used under a cgroup limit, leaving out the inactive file cache the kernel reclaims first. */
function underLimit(read: ReadFile, files: { limit: string; usage: string; stat: string; inactiveKey: string }): number | null {
  const limit = readNumber(read, files.limit); // v2 "max" (no limit) reads as null
  const usage = readNumber(read, files.usage);
  if (limit === null || usage === null || limit >= NO_LIMIT_BYTES) return null;
  let inactiveFile = 0;
  try {
    const match = new RegExp(`^${files.inactiveKey}\\s+(\\d+)`, "m").exec(read(files.stat));
    if (match) inactiveFile = Number(match[1]);
  } catch { /* without the breakdown, count everything as used: the cautious reading */ }
  return Math.max(0, limit - Math.max(0, usage - inactiveFile));
}

function containerAvailable(read: ReadFile): number | null {
  return underLimit(read, { limit: "/sys/fs/cgroup/memory.max", usage: "/sys/fs/cgroup/memory.current", stat: "/sys/fs/cgroup/memory.stat", inactiveKey: "inactive_file" })
    // cgroup v1 (older hosts): the same reading under the memory controller's own folder.
    ?? underLimit(read, {
      limit: "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      usage: "/sys/fs/cgroup/memory/memory.usage_in_bytes",
      stat: "/sys/fs/cgroup/memory/memory.stat",
      inactiveKey: "total_inactive_file",
    });
}

/** Available bytes, or null when this system offers neither reading. */
export function availableMemoryBytes(read: ReadFile = readText): number | null {
  const readings = [hostAvailable(read), containerAvailable(read)].filter((v): v is number => v !== null);
  return readings.length ? Math.min(...readings) : null;
}
