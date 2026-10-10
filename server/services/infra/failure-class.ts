/**
 * failure-class.ts — why a queued job ended, in the vocabulary telemetry and the cost models use.
 *
 * `oom` matters most: an out-of-memory death teaches the server a size ceiling (cost-models.ts
 * `oomCeiling`) so the next larger structure is refused with a reason instead of being run, killed
 * and reported as a timeout. The patterns are the ways each runtime reports it:
 *   - the kernel's OOM killer: SIGKILL that Node did not send (Node's own timeout kill sets `killed`),
 *     or a shell's exit status 137 (128 + 9)
 *   - Java (P2Rank): `java.lang.OutOfMemoryError`
 *   - Node: "JavaScript heap out of memory"
 *   - C/C++ (FoldX) and the OS: `std::bad_alloc`, "Cannot allocate memory", ENOMEM
 */
import type { TelemetryOutcome } from "./cost-models.ts";

/** The sentence FoldX's own failure description uses for this case; matched here as well. */
export const DID_NOT_FIT_IN_MEMORY = "did not fit in memory on the server";

const OOM_TEXT = /OutOfMemoryError|heap out of memory|std::bad_alloc|Cannot allocate memory|\bENOMEM\b|exit code 137|did not fit in memory/i;
const TIMEOUT_TEXT = /timed out|exceeded its execution budget|\bETIMEDOUT\b/i;

export function isOutOfMemory(error: any): boolean {
  if (!error) return false;
  if (error.signal === "SIGKILL" && !error.killed) return true;
  if (error.code === 137 || error.status === 137) return true;
  const text = [error.message, error.stderr].filter(Boolean).join(" ");
  return OOM_TEXT.test(text);
}

/** `Cancelled.` is the exact error `SQLiteQueue.stopJob` writes. */
export function classifyJobFailure(error: any): Exclude<TelemetryOutcome, "completed"> {
  const message = typeof error === "string" ? error : String(error?.message ?? "");
  if (message === "Cancelled." || error?.name === "AbortError") return "cancelled";
  if (isOutOfMemory(typeof error === "string" ? { message: error } : error)) return "oom";
  if (TIMEOUT_TEXT.test(message) || error?.killed) return "timeout";
  return "failed";
}
