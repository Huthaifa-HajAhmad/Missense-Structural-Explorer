import { describe, it, expect } from "vitest";
import {
  CANCELLED_JOB_ERROR,
  cancelActionLabel,
  describeCancelOutcome,
  describeJobError,
  describeJobStatus,
  describeJobTiming,
  describeLimits,
  describeQueueWait,
  describeUsage,
  formatApproxDuration,
  formatServerTime,
  isCancelledJobError,
  isSharedJob,
} from "../jobsCopy";

describe("jobsCopy", () => {
  it("rounds durations the way a waiting person reads them", () => {
    expect(formatApproxDuration(20_000)).toBe("under a minute");
    expect(formatApproxDuration(4 * 60_000 + 10_000)).toBe("about 4 min");
    expect(formatApproxDuration(100 * 60_000)).toBe("about 1.5 h");
    expect(formatApproxDuration(2 * 3_600_000)).toBe("about 2 h");
    expect(formatApproxDuration(-1)).toBe("");
  });

  it("totals server time", () => {
    expect(formatServerTime(0)).toBe("0 min");
    expect(formatServerTime(20)).toBe("1 min");
    expect(formatServerTime(12 * 60)).toBe("12 min");
    expect(formatServerTime(84 * 60)).toBe("84 min");
    expect(formatServerTime(100 * 60)).toBe("1.7 h");
  });

  it("says where a waiting job stands, with the estimate only when there is one", () => {
    expect(describeQueueWait(0, null)).toBe("Next in line");
    expect(describeQueueWait(3, 4 * 60_000)).toBe("3 jobs ahead · starts in about 4 min");
    expect(describeQueueWait(1, null)).toBe("1 job ahead");
    expect(describeQueueWait(null, 30_000)).toBe("Waiting · starts in under a minute");
    expect(describeQueueWait(null, null)).toBeNull();
    expect(describeQueueWait(Number.NaN, -5)).toBeNull();
  });

  it("names a cancelled job as cancelled, not failed", () => {
    expect(isCancelledJobError(CANCELLED_JOB_ERROR)).toBe(true);
    expect(isCancelledJobError("Job execution timed out")).toBe(false);
    expect(describeJobStatus("failed", "Cancelled.")).toEqual({ label: "Cancelled", tone: "cancelled" });
    expect(describeJobStatus("failed", "boom")).toEqual({ label: "Failed", tone: "failed" });
    expect(describeJobStatus("queued")).toEqual({ label: "Waiting", tone: "waiting" });
  });

  it("describes the job's timing for its status", () => {
    const now = 1_000_000_000;
    const base = { queuedAhead: null, etaMs: null, startedAt: null, completedAt: null, createdAt: now - 10_000 };
    expect(describeJobTiming({ ...base, status: "queued", queuedAhead: 2, etaMs: 120_000 }, now)).toBe("2 jobs ahead · starts in about 2 min");
    expect(describeJobTiming({ ...base, status: "queued" }, now)).toBe("Waiting for a free slot");
    expect(describeJobTiming({ ...base, status: "running", startedAt: now - 5 * 60_000 }, now)).toBe("Running for 5 min");
    expect(describeJobTiming({ ...base, status: "completed", completedAt: now - 10_000 }, now)).toBe("Just now");
    expect(describeJobTiming({ ...base, status: "completed", completedAt: now - 3 * 60_000 }, now)).toBe("3 min ago");
  });

  it("explains what a cancel did, including a shared job that keeps running", () => {
    expect(describeCancelOutcome({ cancelled: true })).toMatch(/stopped this job/);
    expect(describeCancelOutcome({ cancelled: false, remainingWatchers: 1 })).toMatch(/one other person/);
    expect(describeCancelOutcome({ cancelled: false, remainingWatchers: 3 })).toMatch(/3 other people/);
  });

  it("states usage and limits plainly", () => {
    expect(describeUsage({ todaySeconds: 720, weekSeconds: 6000 })).toEqual({ today: "12 min", week: "1.7 h" });
    expect(describeUsage(null)).toBeNull();
    const none = describeLimits({ queuedPerUser: 25, serverSecondsPerDay: null });
    expect(none[0]).toMatch(/Up to 25 jobs waiting at once while other people are also waiting/);
    expect(none[1]).toBe("No daily limit on server time.");
    expect(describeLimits({ queuedPerUser: 10, serverSecondsPerDay: 3600 })[1]).toBe("Daily server time: 60 min (resets at 00:00 UTC).");
  });
});

/**
 * The Review-3 additions: shared work is judged by the server's watcher count (so the OWNER is warned
 * too), a failed row no longer prints the engine's prose, the limits sentence respects an admin-set
 * quota, and a running row prefers the server's measured elapsed time over the client's clock.
 */
describe("jobsCopy — Review 3 additions", () => {
  it("treats a job as shared from the watcher count, not from ownership", () => {
    expect(isSharedJob(2)).toBe(true);
    expect(isSharedJob(3)).toBe(true);
    expect(isSharedJob(1)).toBe(false);
    expect(isSharedJob(0)).toBe(false);
    expect(isSharedJob(null)).toBe(false);
    expect(isSharedJob(undefined)).toBe(false);
    expect(cancelActionLabel(2)).toBe("Remove from my jobs");
    expect(cancelActionLabel(1)).toBe("Stop this job");
  });

  it("translates the queue's error prose instead of printing paths and binary names", () => {
    expect(describeJobError("FoldX binary not found or not executable at: /app/tools/foldx_linux/FoldX"))
      .toBe("The tool this job needs is not installed on the server that ran it.");
    expect(describeJobError("FoldX parameter files missing: rotabase.txt not found in /app/tools"))
      .toBe("The server's FoldX installation is incomplete, so the run could not start.");
    expect(describeJobError("Job execution timed out"))
      .toBe("The run took longer than its time budget and was stopped.");
    expect(describeJobError("Killed for using too much memory"))
      .toBe("The structure needed more memory than the server had, so the run was stopped.");
    // The queue's own out-of-memory sentence (`DID_NOT_FIT_IN_MEMORY` in failure-class.ts).
    expect(describeJobError("did not fit in memory on the server"))
      .toBe("The structure needed more memory than the server had, so the run was stopped.");
    // A deliberate cancel is not an error at all: the chip already says Cancelled.
    expect(describeJobError(CANCELLED_JOB_ERROR)).toBeNull();
    expect(describeJobError("")).toBeNull();
    expect(describeJobError(null)).toBeNull();
    expect(describeJobError("Box64 Signal 11")).toBe("The run stopped with an internal error. The server log has the details.");
  });

  it("does not promise queue headroom an admin-set quota removes", () => {
    const shared = describeLimits({ queuedPerUser: 25, serverSecondsPerDay: null })[0];
    expect(shared).toMatch(/while other people are also waiting/);
    expect(shared).toMatch(/otherwise idle you can queue more/);

    const fixed = describeLimits({ queuedPerUser: 4, serverSecondsPerDay: null, queuedPerUserExplicit: true })[0];
    expect(fixed).toMatch(/^Up to 4 jobs waiting at once\./);
    expect(fixed).toMatch(/administrator set this limit/);
    expect(fixed).not.toMatch(/otherwise idle/);
  });

  it("prefers the server's measured elapsed time for a running job", () => {
    const base = {
      status: "running" as const, queuedAhead: null, etaMs: null,
      startedAt: 1_000, completedAt: null, createdAt: 1_000,
    };
    // Client clock far behind the server's: without elapsedMs this clamped to "under a minute".
    expect(describeJobTiming({ ...base, elapsedMs: 3 * 60_000 }, 2_000)).toBe("Running for 3 min");
    // No server measurement: fall back to the local difference, as before.
    expect(describeJobTiming({ ...base, elapsedMs: null }, 1_000 + 5 * 60_000)).toBe("Running for 5 min");
    expect(describeJobTiming({ ...base, elapsedMs: -1 }, 1_000 + 7 * 60_000)).toBe("Running for 7 min");
  });
});
