import { describe, expect, it } from "vitest";
import { availableMemoryBytes } from "./available-memory.ts";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

/** A fake file system holding only the files the function reads. */
function files(map: Record<string, string>) {
  return (path: string): string => {
    if (!(path in map)) throw new Error(`ENOENT ${path}`);
    return map[path];
  };
}

const meminfo = (availableKb: number) => `MemTotal:       12213568 kB\nMemFree:          524288 kB\nMemAvailable:   ${availableKb} kB\n`;

describe("availableMemoryBytes", () => {
  it("does not count reclaimable file cache as used inside a container", () => {
    // Test container, 2026-11-18: limit 5 GiB, 5.2 GB "current", of which 3.66 GB was file cache.
    // The old reading said 117 MB were free and the queue stopped starting jobs.
    const read = files({
      "/sys/fs/cgroup/memory.max": `${5 * GiB}\n`,
      "/sys/fs/cgroup/memory.current": `${5214896128}\n`,
      "/sys/fs/cgroup/memory.stat": "anon 1500450816\nfile 3662573568\ninactive_file 3400000000\nactive_file 262573568\n",
      "/proc/meminfo": meminfo(7_700_000),
    });
    const available = availableMemoryBytes(read);
    expect(available).toBe(5 * GiB - (5214896128 - 3400000000));
    expect(available).toBeGreaterThan(3 * GiB);
  });

  it("is limited by the host when the host has less available than the container limit allows", () => {
    const read = files({
      "/sys/fs/cgroup/memory.max": `${10 * GiB}\n`,
      "/sys/fs/cgroup/memory.current": `${400 * MiB}\n`,
      "/sys/fs/cgroup/memory.stat": "inactive_file 0\n",
      "/proc/meminfo": meminfo(300 * 1024),
    });
    expect(availableMemoryBytes(read)).toBe(300 * 1024 * 1024);
  });

  it("uses the host's available memory when the container has no limit", () => {
    const read = files({
      "/sys/fs/cgroup/memory.max": "max\n",
      "/sys/fs/cgroup/memory.current": `${400 * MiB}\n`,
      "/sys/fs/cgroup/memory.stat": "inactive_file 0\n",
      "/proc/meminfo": meminfo(2 * 1024 * 1024),
    });
    expect(availableMemoryBytes(read)).toBe(2 * GiB);
  });

  it("returns null where none of these files exist, so the caller keeps its own fallback", () => {
    expect(availableMemoryBytes(files({}))).toBeNull();
  });
});
