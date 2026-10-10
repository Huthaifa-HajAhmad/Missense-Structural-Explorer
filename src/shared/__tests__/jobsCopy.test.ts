import { describe, it, expect } from "vitest";
import {
  CANCELLED_JOB_ERROR,
  describeCancelOutcome,
  describeJobStatus,
  describeJobTiming,
  describeLimits,
  describeQueueWait,
  describeUsage,
  formatApproxDuration,
  formatServerTime,
  isCancelledJobError,
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
