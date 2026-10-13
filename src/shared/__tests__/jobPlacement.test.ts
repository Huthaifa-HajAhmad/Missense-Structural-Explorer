import { describe, it, expect } from "vitest";
import { describeRunsOn, hostPhrase, parseRoutingRecord, runsOnFor, serverRecordAfter, type RoutingRecord } from "../jobPlacement";
import { describeFoldxPhase } from "../foldxPhase";
import { describeAgentRecent } from "../agentProtocol";

const placed: RoutingRecord = {
  host: "agent:a1",
  computerName: "Lab PC",
  expectedMs: { p50: 9000, p90: 18000 },
  basis: "prior",
  samples: 0,
  reasons: ["It runs on Lab PC, which is expected to finish first."],
  decidedAt: 1,
  note: null,
};

describe("runsOnFor", () => {
  it("tells the owner which computer, and why, while it waits and while it runs", () => {
    const waiting = runsOnFor({ status: "queued", claimedBy: null, placement: "agent:a1", record: placed, viewerIsOwner: true })!;
    expect(waiting).toMatchObject({ where: "your_computer", computerName: "Lab PC", started: false, expectedMs: { p50: 9000, p90: 18000 }, basis: "prior" });
    expect(waiting.reasons).toEqual(placed.reasons);
    const running = runsOnFor({ status: "running", claimedBy: "agent:a1", placement: "agent:a1", record: placed, viewerIsOwner: true })!;
    expect(running).toMatchObject({ where: "your_computer", started: true });
  });

  it("tells anyone else only where: no name, no reasons, no prediction", () => {
    const seen = runsOnFor({ status: "running", claimedBy: "agent:a1", placement: "agent:a1", record: placed, viewerIsOwner: false })!;
    expect(seen).toEqual({ where: "teammate_computer", computerName: null, started: true, expectedMs: null, basis: null, samples: null, reasons: [] });
  });

  it("never says a computer ran a job it never claimed (cancelled while it waited for it)", () => {
    const r = runsOnFor({ status: "failed", claimedBy: null, placement: "agent:a1", record: placed, viewerIsOwner: true })!;
    expect(r).toMatchObject({ where: "server", started: false, computerName: null, reasons: [] });
    expect(describeRunsOn(r, "failed")).toBeNull();
    // A computer that finished it keeps its claim, so the finished job still names it.
    expect(runsOnFor({ status: "completed", claimedBy: "agent:a1", placement: null, record: placed, viewerIsOwner: true })).toMatchObject({ where: "your_computer", computerName: "Lab PC", started: true });
  });

  it("never shows a prediction that belonged to another host", () => {
    // Placed on the computer, but the server is running it now (released without a fresh record).
    const r = runsOnFor({ status: "running", claimedBy: null, placement: null, record: placed, viewerIsOwner: true })!;
    expect(r).toMatchObject({ where: "server", expectedMs: null, reasons: [] });
  });

  it("says why a job moved to the server", () => {
    const released = runsOnFor({ status: "queued", claimedBy: null, placement: null, record: serverRecordAfter("released", 5), viewerIsOwner: true })!;
    expect(released.where).toBe("server");
    expect(released.reasons[0]).toMatch(/did not pick it up/);
    const back = runsOnFor({ status: "queued", claimedBy: null, placement: "server", record: serverRecordAfter("handed_back", 5), viewerIsOwner: true })!;
    expect(back.reasons[0]).toMatch(/could not finish/);
  });

  it("is null for a job routing never touched, so nothing new is shown", () => {
    expect(runsOnFor({ status: "queued", claimedBy: null, placement: null, record: null, viewerIsOwner: true })).toBeNull();
    expect(runsOnFor({ status: "completed", claimedBy: null, placement: null, record: null, viewerIsOwner: true })).toBeNull();
  });

  it("names a computer that took the job from the backlog", () => {
    const taken: RoutingRecord = { ...placed, expectedMs: null, basis: null, reasons: [], note: "taken_from_backlog" };
    const r = runsOnFor({ status: "running", claimedBy: "agent:a1", placement: null, record: taken, viewerIsOwner: true })!;
    expect(r.where).toBe("your_computer");
    expect(r.reasons[0]).toMatch(/server was busy/);
  });
});

describe("the words", () => {
  it("phrases each host", () => {
    expect(hostPhrase(null)).toBe("the shared server");
    expect(describeRunsOn({ where: "your_computer", computerName: "Lab PC", started: false, expectedMs: null, basis: null, samples: null, reasons: [] }, "queued"))
      .toBe("Waiting for your computer (Lab PC) to pick it up");
    expect(describeRunsOn({ where: "your_computer", computerName: null, started: true, expectedMs: null, basis: null, samples: null, reasons: [] }, "running"))
      .toBe("Running on your computer");
    expect(describeRunsOn({ where: "teammate_computer", computerName: null, started: true, expectedMs: null, basis: null, samples: null, reasons: [] }, "completed"))
      .toBe("Ran on a teammate's computer");
    expect(describeRunsOn(null, "running")).toBeNull();
  });

  it("the FoldX queued stage no longer says 'compute server' when a computer of the person's own will run it", () => {
    const runsOn = runsOnFor({ status: "queued", claimedBy: null, placement: "agent:a1", record: placed, viewerIsOwner: true });
    expect(describeFoldxPhase("queued", runsOn)?.detail).toBe("Waiting for your computer (Lab PC) to pick it up.");
    expect(describeFoldxPhase("queued")?.detail).toContain("compute server");
    expect(describeFoldxPhase("repairing", runsOn)?.label).toBe("Structure repair");
  });

  it("describes a computer's recent work, and says nothing before its first job", () => {
    expect(describeAgentRecent(null)).toBeNull();
    expect(describeAgentRecent({ days: 30, completed: 0, handedBack: 0, foldx: null, p2rank: null })).toBeNull();
    expect(
      describeAgentRecent({
        days: 30,
        completed: 12,
        handedBack: 1,
        foldx: { jobs: 9, medianMs: 9_400, medianResidues: 305 },
        p2rank: { jobs: 3, medianMs: 21_000, medianResidues: 400 },
      }),
    ).toBe(
      "In the last 30 days it finished 12 of your jobs. FoldX took about 9 s (structures around 305 residues); pocket detection about 21 s (structures around 400 residues). One job went to the shared server instead, because this computer could not finish it.",
    );
    expect(describeAgentRecent({ days: 30, completed: 1, handedBack: 0, foldx: null, p2rank: { jobs: 1, medianMs: 400, medianResidues: null } }))
      .toBe("In the last 30 days it finished one of your jobs. Pocket detection took under a second.");
  });

  it("drops a malformed stored record instead of trusting it", () => {
    expect(parseRoutingRecord("not json")).toBeNull();
    expect(parseRoutingRecord(JSON.stringify({ host: 3 }))).toBeNull();
    expect(parseRoutingRecord(JSON.stringify({ host: "server", note: "bogus", reasons: [1, "ok"] }))).toMatchObject({ host: "server", note: null, reasons: ["ok"] });
  });
});
