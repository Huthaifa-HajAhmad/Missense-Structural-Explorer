import { execFile, type ChildProcess } from "child_process";
import { promisify } from "util";
import { meterChildProcess } from "../../infra/job-meter.ts";
import { killProcessTree } from "../../../utils/process-tree.ts";

export const execFileAsync = promisify(execFile);

/** Count a P2Rank run (the script and the Java it starts) toward the queue job's memory (job-meter.ts). */
export function metered<T>(run: Promise<T> & { child?: ChildProcess }): Promise<T> {
  meterChildProcess(run.child);
  return run;
}

/**
 * Stop the WHOLE tool tree when the run is aborted or times out. `prank` is a script (a `.bat` through
 * cmd.exe on Windows) that starts Java as its child; Node's own abort/timeout kill reaches only the script,
 * so the JVM (up to 2 GB) used to keep running after a cancel, a pause on a paired computer, or a timeout.
 * On POSIX the run is spawned `detached` so the script and its JVM form one process group to kill.
 */
export function treeKilledOnStop<T>(run: Promise<T> & { child?: ChildProcess }, signal?: AbortSignal): Promise<T> {
  const pid = run.child?.pid;
  const kill = () => killProcessTree(pid);
  signal?.addEventListener("abort", kill, { once: true });
  return run
    .catch((err: any) => {
      if (err?.killed || err?.name === "AbortError" || signal?.aborted) kill();
      throw err;
    })
    .finally(() => signal?.removeEventListener("abort", kill));
}
