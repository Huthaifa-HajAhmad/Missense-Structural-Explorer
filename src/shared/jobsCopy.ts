/**
 * jobsCopy.ts — the words the interface uses for queued compute jobs (WP-G1).
 *
 * One place, so the jobs panel, the Energetics progress card and Settings → Account say the same thing
 * about the same state, and so an agent changing the wording changes it everywhere. Pure (no imports),
 * like `foldxPhase.ts` and `foldingLimits.ts`; enforced by `scripts/check-boundaries.ts`.
 *
 * The server's numbers are estimates and are presented as such ("about"); a missing estimate is said
 * plainly rather than replaced by a guess.
 */

/** The exact error the queue writes when a job is cancelled (`SQLiteQueue.stopJob`). */
export const CANCELLED_JOB_ERROR = "Cancelled.";

export function isCancelledJobError(error: unknown): boolean {
  return typeof error === "string" && error.trim() === CANCELLED_JOB_ERROR;
}

/** What a cancelled FoldX or pocket run says instead of an error. */
export const CANCELLED_RUN_MESSAGE = "This run was cancelled. Nothing was computed; run it again whenever you like.";

/**
 * A rough duration for a waiting person: "under a minute", "about 4 min", "about 1.5 h".
 * Rounded on purpose; a precise number would promise more than an estimate can.
 */
export function formatApproxDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `about ${minutes} min`;
  const hours = Math.round((ms / 3_600_000) * 2) / 2;
  return `about ${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} h`;
}

/** Seconds of server time as a short total: "0 min", "12 min", "1.4 h". */
export function formatServerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} min`;
  return `${(minutes / 60).toFixed(1).replace(/\.0$/, "")} h`;
}

/**
 * The queue line for a waiting job: "Next in line", "3 jobs ahead", plus the wait when the server
 * could estimate it ("· about 4 min"). Null when the job is not waiting or nothing is known.
 */
export function describeQueueWait(queuedAhead: number | null | undefined, etaMs: number | null | undefined): string | null {
  const ahead = typeof queuedAhead === "number" && Number.isFinite(queuedAhead) && queuedAhead >= 0 ? queuedAhead : null;
  const eta = typeof etaMs === "number" && Number.isFinite(etaMs) && etaMs >= 0 ? etaMs : null;
  if (ahead === null && eta === null) return null;
  const position = ahead === null ? "Waiting" : ahead === 0 ? "Next in line" : `${ahead} job${ahead === 1 ? "" : "s"} ahead`;
  if (eta === null) return position;
  return `${position} · starts in ${formatApproxDuration(eta)}`;
}

export type JobTone = "waiting" | "running" | "done" | "failed" | "cancelled";

export interface JobStatusView {
  label: string;
  tone: JobTone;
}

/** The status chip for one job in the jobs panel. */
export function describeJobStatus(status: "queued" | "running" | "completed" | "failed", error?: string | null): JobStatusView {
  switch (status) {
    case "queued":
      return { label: "Waiting", tone: "waiting" };
    case "running":
      return { label: "Running", tone: "running" };
    case "completed":
      return { label: "Done", tone: "done" };
    default:
      return isCancelledJobError(error) ? { label: "Cancelled", tone: "cancelled" } : { label: "Failed", tone: "failed" };
  }
}

/** The tool a job runs, as a reader knows it. */
export function describeJobTool(type: "foldx" | "p2rank"): string {
  return type === "foldx" ? "Stability (FoldX)" : "Binding pocket (P2Rank)";
}

/** What happened after pressing Cancel (`POST /jobs/:id/cancel`). */
export function describeCancelOutcome(outcome: { cancelled: boolean; remainingWatchers?: number }): string {
  if (outcome.cancelled) return "Cancelled. The server has stopped this job.";
  const others = outcome.remainingWatchers ?? 1;
  return `Removed from your jobs. It keeps running for ${others === 1 ? "one other person" : `${others} other people`} who asked for the same result.`;
}

/** The confirmation shown before cancelling a job other people are also waiting for. */
export const SHARED_JOB_NOTE = "Someone else asked for the same result, so this run is shared. Cancelling removes it from your list; it only stops if nobody else is waiting.";

export interface UsageView {
  today: string;
  week: string;
}

export function describeUsage(usage: { todaySeconds: number; weekSeconds: number } | null | undefined): UsageView | null {
  if (!usage) return null;
  return { today: formatServerTime(usage.todaySeconds), week: formatServerTime(usage.weekSeconds) };
}

/**
 * The limits as a person meets them. The waiting-jobs limit is a share that only binds while others
 * are waiting too (WP-B); the daily cap exists only when an admin set one.
 */
export function describeLimits(quota: { queuedPerUser: number; serverSecondsPerDay: number | null } | null | undefined): string[] {
  if (!quota) return [];
  const lines = [
    `Up to ${quota.queuedPerUser} jobs waiting at once while other people are also waiting. When the server is otherwise idle you can queue more.`,
  ];
  lines.push(
    quota.serverSecondsPerDay == null
      ? "No daily limit on server time."
      : `Daily server time: ${formatServerTime(quota.serverSecondsPerDay)} (resets at 00:00 UTC).`,
  );
  return lines;
}

/**
 * The second line of a job row: where it stands now. Waiting → queue line; running → how long so far;
 * finished → how long ago. `now` is passed in so the module stays pure and testable.
 */
export function describeJobTiming(
  job: { status: "queued" | "running" | "completed" | "failed"; queuedAhead: number | null; etaMs: number | null; startedAt: number | null; completedAt: number | null; createdAt: number },
  now: number,
): string {
  if (job.status === "queued") return describeQueueWait(job.queuedAhead, job.etaMs) ?? "Waiting for a free slot";
  if (job.status === "running") {
    const since = job.startedAt ?? job.createdAt;
    return `Running for ${formatApproxDuration(Math.max(0, now - since)).replace(/^about /, "")}`;
  }
  const at = job.completedAt ?? job.createdAt;
  const ago = Math.max(0, now - at);
  return ago < 60_000 ? "Just now" : `${formatApproxDuration(ago).replace(/^about /, "")} ago`;
}
