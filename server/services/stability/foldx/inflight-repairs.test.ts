import { afterEach, describe, expect, it } from "vitest";
import { JOIN_GRACE_MS, announceInflightRepair, inflightRepair, joinWaitMs, resetInflightRepairsForTests } from "./inflight-repairs.ts";

afterEach(() => resetInflightRepairsForTests());

/** 6N7E under Box64: 44 incomplete residues cost BuildModel ~206 s; the background repair takes ~660 s. */
const SIX_N7E = { unrepairedExtraMs: 44 * 5_000, jobRemainingMs: 880_000, fallbackMs: 600_000 };

describe("joinWaitMs", () => {
  it("waits for a repair that ends before an unrepaired BuildModel would, plus a grace", () => {
    expect(joinWaitMs({ ...SIX_N7E, now: 0, expectedEndAt: 48_000 })).toBe(48_000 + JOIN_GRACE_MS);
  });

  it("does not wait when the repair would end later than BuildModel finishing unrepaired", () => {
    expect(joinWaitMs({ ...SIX_N7E, now: 0, expectedEndAt: 262_000 })).toBe(0);
    expect(joinWaitMs({ ...SIX_N7E, now: 0, expectedEndAt: 220_000 })).toBe(0);
  });

  it("never waits longer than waiting could save", () => {
    expect(joinWaitMs({ ...SIX_N7E, now: 0, expectedEndAt: 200_000 })).toBe(220_000);
  });

  it("always leaves the job its unrepaired fallback", () => {
    expect(joinWaitMs({ ...SIX_N7E, jobRemainingMs: 650_000, now: 0, expectedEndAt: 48_000 })).toBe(50_000);
    expect(joinWaitMs({ ...SIX_N7E, jobRemainingMs: 590_000, now: 0, expectedEndAt: 48_000 })).toBe(0);
  });

  it("still gives an overdue repair the grace (the envelope is an upper bound, rarely passed)", () => {
    expect(joinWaitMs({ ...SIX_N7E, now: 700_000, expectedEndAt: 690_000 })).toBe(JOIN_GRACE_MS);
  });

  it("does not wait for a template with nothing to rebuild", () => {
    expect(joinWaitMs({ ...SIX_N7E, unrepairedExtraMs: 0, now: 0, expectedEndAt: 1 })).toBe(0);
  });
});

describe("announceInflightRepair", () => {
  it("is visible until settled, and settling resolves its waiters", async () => {
    const settle = announceInflightRepair("k", 1, 2);
    const flight = inflightRepair("k");
    expect(flight).toMatchObject({ startedAt: 1, expectedEndAt: 2 });
    settle();
    await flight!.done;
    expect(inflightRepair("k")).toBeNull();
  });

  it("a stale settle does not remove a newer announcement for the same key", () => {
    const first = announceInflightRepair("k2", 1, 2);
    const second = announceInflightRepair("k2", 3, 4);
    first();
    expect(inflightRepair("k2")).toMatchObject({ startedAt: 3 });
    second();
  });
});
