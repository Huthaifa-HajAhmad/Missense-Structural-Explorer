import { execFile } from "node:child_process";

/**
 * Kill a process AND its descendants.
 *
 * A Node `child.kill()` or an `execFile({ timeout })` signals only the direct child, but the tools this
 * project launches are wrappers: Box64, a `.bat`/shell script that starts a JVM, or `docker run`. The
 * process that must actually die is usually a grandchild, so signalling only the wrapper leaks it.
 *
 * On POSIX, `process.kill(-pid, ...)` reaches the child's process GROUP; that only contains the wrapper's
 * children if it was spawned `detached: true`, so callers that need the tree killed must set it. On
 * Windows there is no process group to signal, so we ask `taskkill /T`.
 */
export function killProcessTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execFile("taskkill", ["/F", "/T", "/PID", String(pid)], () => {});
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
