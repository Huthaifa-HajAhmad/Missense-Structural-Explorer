import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { executeFoldxPipeline, setPollDelayScaleForTests, LOST_CONTACT_MESSAGE } from "../foldxService";
import { getCachedVariant, setCachedVariant, clearClientVariantCache } from "../variantCache";
import { biophysicsContextOf, createAnalysisCacheContext } from "../analysisContext";
import {
  BIOPHYSICS_CONDITION_UNIT_VERSION,
  BIOPHYSICS_NATIVE_DEFAULT_VERSION,
  DEFAULT_UI_BIOPHYSICS_CONDITIONS,
} from "../../../shared/biophysicsConditions";
import { DEFAULT_USER_SETTINGS } from "../../../components/settings/defaults";

// The poll loop waits 2-5 s of real time between polls; these tests assert what it publishes, not how
// long it waits.
beforeAll(() => setPollDelayScaleForTests(0.01));
afterAll(() => setPollDelayScaleForTests(1));

/** The biophysical sink surface `executeFoldxPipeline` is allowed to write to. */
const makeSink = () => ({
  setIsFolding: vi.fn(),
  setFoldingProgress: vi.fn(),
  setFoldingError: vi.fn(),
  setFoldingStatus: vi.fn(),
  setMutantPdb: vi.fn(),
  setFoldedResidueIndex: vi.fn(),
  setFoldingDdG: vi.fn(),
  setFoldingEnergetics: vi.fn(),
  setThermompnnStatus: vi.fn(),
  setThermompnnError: vi.fn(),
  setFoldxWtPdb: vi.fn()
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PROGRESS PLUMBING — what the store learns about a running FoldX job
 * ─────────────────────────────────────────────────────────────────────────────
 * The banner's stage, age and queue position all come from here, and none of it was tested: the
 * submit response's phase, the per-poll phase, the drop of an unrecognised phase, and the clear on
 * the terminal frame. A regression in any of them is invisible — the UI simply says "not reported by
 * the compute server yet" forever, which is exactly the state this change exists to end.
 */
function progressRun(pollPayloads: any[]): any {
  let pollIndex = 0;
  return vi.fn(async (url: string) => {
    if (url.includes("/generate-mutant")) {
      return {
        ok: true,
        json: async () => ({
          status: "queued",
          foldxJobId: "job-1",
          phase: "queued",
          startedAt: null,
          elapsedMs: null,
          queuedAhead: 2
        })
      };
    }
    const payload = pollPayloads[Math.min(pollIndex++, pollPayloads.length - 1)];
    return {
      ok: true,
      json: async () => payload
    };
  });
}

describe("foldxService progress", () => {
  it("publishes the submit phase, each poll phase, and clears on the terminal frame", async () => {
    const sink: any = makeSink();
    const fetchWithAuth = progressRun([
      { status: "queued", phase: "queued", elapsedMs: null, queuedAhead: 1 },
      { status: "running", phase: "repairing", elapsedMs: 12_000, queuedAhead: 0 },
      {
        status: "completed",
        phase: "finalizing",
        elapsedMs: 212_000,
        result: { status: "success", pdb: "ATOM", ddG: 1.1, foldedResidueIndex: 408 }
      }
    ]);

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    const published = sink.setFoldingProgress.mock.calls.map(([p]: [any]) => p);
    // The first report is an explicit "nothing known yet", not silence: `null` clears whatever a
    // previous run left on screen.
    expect(published[0]).toBeNull();
    const phases = published.filter(Boolean).map((p: any) => p.phase);
    // Every stage the worker reported, in the order it reported them. "finalizing" arrives on the
    // terminal frame and is published before the clear — the stage did happen.
    expect(phases).toEqual(["queued", "queued", "repairing", "finalizing"]);
    // The last write clears progress, so a finished run cannot leave a stage on screen.
    expect(published[published.length - 1]).toBeNull();
    // Durations are carried as durations, and the age baseline is a local receipt time.
    const repairing = published.find((p: any) => p?.phase === "repairing");
    expect(repairing.elapsedMs).toBe(12_000);
    expect(typeof repairing.receivedAt).toBe("number");
    // The queue position is reported while queued — from the submit response and from the poll. A
    // running job's payload carries 0 (there is no queue position to report), and the banner renders
    // the chip only when the phase IS "queued", which the banner test pins from the other side.
    const queuedPositions = published.filter((p: any) => p?.phase === "queued").map((p: any) => p.queuePosition);
    expect(queuedPositions).toEqual([2, 1]);
    expect(repairing.queuePosition).toBe(0);
  });

  it("sends the run's numbering proof, so the server can name how the mutated position was numbered", async () => {
    const fetchWithAuth = progressRun([{ status: "completed", result: { status: "success", pdb: "ATOM", ddG: 1.1, foldedResidueIndex: 408 } }]);

    await executeFoldxPipeline({
      uniprotId: "P00439", variant: "p.Arg408Trp", residueIndex: 408, numberingProof: "np1.b.s",
      fetchWithAuth, sink: makeSink(), signal: new AbortController().signal, requestId: 1, getActiveRequestId: () => 1
    });

    const submit = fetchWithAuth.mock.calls.find(([url]: [string]) => url.includes("/generate-mutant"));
    expect(JSON.parse(submit[1].body)).toMatchObject({ uniprotId: "P00439", numberingProof: "np1.b.s" });
  });

  it("drops a phase it cannot name instead of rendering it", async () => {
    const sink: any = makeSink();
    // The submit response carries no phase at all, so the only phase source is the poll — and the
    // poll names a stage this client's vocabulary does not know.
    const fetchWithAuth = vi.fn(async (url: string) => {
      if (url.includes("/generate-mutant")) {
        return { ok: true, json: async () => ({ status: "queued", foldxJobId: "job-1" }) };
      }
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          phase: "quantum-refolding",
          elapsedMs: 5_000,
          result: { status: "success", pdb: "ATOM", ddG: 1.1, foldedResidueIndex: 408 }
        })
      };
    }) as any;

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    const published = sink.setFoldingProgress.mock.calls
      .map(([progress]: [any]) => progress)
      .filter(Boolean);
    // The payload WAS read — the duration travelled — while the stage name was refused.
    expect(published.some((p: any) => p.elapsedMs === 5_000)).toBe(true);
    expect(
      published.every((p: any) => p.phase === null),
      "a phase the client cannot name must render as unreported, never as a guessed stage"
    ).toBe(true);
  });
});

describe("foldxService", () => {
  it("handles immediate completion response", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N ...",
        foldedResidueIndex: 408,
        ddG: 2.34,
        energetics: { totalEnergy: 10.5 },
        provenance: { structureSource: "alphafold", foldxVersion: "5.0" },
        thermompnnStatus: "done",
        thermompnnError: null
      })
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(sink.setIsFolding).toHaveBeenCalledWith(true);
    expect(sink.setMutantPdb).toHaveBeenCalledWith("ATOM 1 N ...");
    expect(sink.setFoldingDdG).toHaveBeenCalledWith(2.34);
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("success");
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith("done");
    expect(sink.setIsFolding).toHaveBeenLastCalledWith(false);
  });

  /**
   * Test container, 2026-11-18: a restart cut the server off for about a minute. Three failed polls
   * (about 15 s) ended the run as "Failed to fetch" while the server went on to finish FoldX.
   */
  describe("losing contact while polling", () => {
    const queuedThen = (poll: () => Promise<any>) => vi.fn(async (url: string) => {
      if (url === "/api/v1/generate-mutant") {
        return { ok: true, json: async () => ({ status: "queued", foldxJobId: "job-lc" }) };
      }
      return poll();
    });
    const run = (fetchWithAuth: any, sink: any) => executeFoldxPipeline({
      uniprotId: "P00439", variant: "p.Arg408Trp", residueIndex: 408, fetchWithAuth, sink,
      signal: new AbortController().signal, requestId: 1, getActiveRequestId: () => 1,
    });
    const done = { ok: true, json: async () => ({ status: "completed", result: { status: "completed", pdb: "ATOM", ddG: 1.2 } }) };

    it("keeps polling through network errors and gateway errors, then takes the result", async () => {
      let polls = 0;
      const answers = [
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => Promise.resolve({ ok: false, status: 502, json: async () => ({}) }),
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }),
      ];
      const sink: any = makeSink();
      const end = await run(queuedThen(() => (polls < answers.length ? answers[polls++]() : Promise.resolve(done))), sink);
      expect(end).toBeUndefined();
      expect(sink.setFoldingStatus).toHaveBeenCalledWith("success");
      expect(sink.setFoldingStatus).not.toHaveBeenCalledWith("failed");
    });

    it("reports lost contact, not a timeout, when the queue deadline passes while the server is unreachable", async () => {
      // Contact lost 29 min into the queue wait: the 30-min deadline arrives before the 5-min contact window.
      let now = 1_000_000;
      let polls = 0;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      try {
        const sink: any = makeSink();
        const end = await run(queuedThen(() => {
          polls += 1;
          now += polls === 1 ? 29 * 60_000 : 30_000;
          return polls === 1
            ? Promise.resolve({ ok: true, json: async () => ({ status: "queued" }) })
            : Promise.reject(new TypeError("Failed to fetch"));
        }), sink);
        expect(end).toBe("lost-contact");
        expect(sink.setFoldingError).toHaveBeenCalledWith(LOST_CONTACT_MESSAGE);
      } finally {
        clock.mockRestore();
      }
    });

    it("keeps polling when the connection drops after the headers, before the body arrives", async () => {
      let polls = 0;
      const sink: any = makeSink();
      const end = await run(queuedThen(() => {
        polls += 1;
        if (polls <= 2) return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new TypeError("network error while reading body")) });
        return Promise.resolve(done);
      }), sink);
      expect(end).toBeUndefined();
      expect(sink.setFoldingStatus).toHaveBeenCalledWith("success");
    });

    it("ends with an honest lost-contact message after five minutes without an answer", async () => {
      let now = 1_000_000;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 60_000));
      try {
        const sink: any = makeSink();
        const end = await run(queuedThen(() => Promise.reject(new TypeError("Failed to fetch"))), sink);
        expect(end).toBe("lost-contact");
        expect(sink.setFoldingError).toHaveBeenCalledWith(LOST_CONTACT_MESSAGE);
        expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
      } finally {
        clock.mockRestore();
      }
    });
  });

  it("handles queued FoldX job and polls until completion", async () => {
    let callCount = 0;
    const mockFetchWithAuth = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/v1/generate-mutant") {
        return {
          ok: true,
          json: async () => ({
            status: "queued",
            foldxJobId: "job-999",
            thermompnnStatus: "pending"
          })
        };
      }
      if (url === "/api/v1/foldx-job/job-999") {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            status: "completed",
            result: {
              status: "completed",
              pdb: "ATOM MUT ...",
              ddG: 1.8
            }
          })
        };
      }
      throw new Error("Unknown route");
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(sink.setThermompnnStatus).toHaveBeenCalledWith("pending");
    expect(sink.setMutantPdb).toHaveBeenCalledWith("ATOM MUT ...");
    expect(sink.setFoldingDdG).toHaveBeenCalledWith(1.8);
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("success");
  });

  it("restarts its clocks when a job goes back to the queue, instead of timing out a second run", async () => {
    // A paired computer ran the job for 15 minutes and gave it back; the server queued it, then ran it
    // for another 10 minutes. Neither run is over its own budget, so the reader must get the result.
    let clock = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const minute = 60_000;
    const polls: [number, any][] = [
      [0, { status: "running", phase: "repairing" }],
      [15 * minute, { status: "running", phase: "modelling" }],
      [1 * minute, { status: "queued", phase: null }],
      [1 * minute, { status: "running", phase: "repairing" }],
      [10 * minute, { status: "running", phase: "modelling" }],
      [1 * minute, { status: "completed", result: { status: "completed", pdb: "ATOM MUT ...", ddG: 0.9 } }],
    ];
    let i = 0;
    const fetchWithAuth: any = vi.fn(async (url: string) => {
      if (url === "/api/v1/generate-mutant") return { ok: true, json: async () => ({ status: "queued", foldxJobId: "job-back" }) };
      const [advance, payload] = polls[Math.min(i++, polls.length - 1)];
      clock += advance;
      return { ok: true, json: async () => payload };
    });
    const sink: any = makeSink();
    try {
      await executeFoldxPipeline({
        uniprotId: "P00439", variant: "p.Arg408Trp", residueIndex: 408, fetchWithAuth, sink,
        signal: new AbortController().signal, requestId: 1, getActiveRequestId: () => 1,
      });
    } finally {
      nowSpy.mockRestore();
    }
    expect(sink.setFoldingError.mock.calls.filter(([message]: [string | null]) => message)).toEqual([]);
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("success");
  });

  it("propagates remote job IDs immediately even when background FoldX simulation fails", async () => {
    const mockFetchWithAuth = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/v1/generate-mutant") {
        return {
          ok: true,
          json: async () => ({
            status: "queued",
            foldxJobId: "job-fail-1",
            thermompnnStatus: "pending"
          })
        };
      }
      if (url === "/api/v1/foldx-job/job-fail-1") {
        return {
          ok: true,
          json: async () => ({
            status: "failed",
            error: "FoldX process crashed"
          })
        };
      }
      throw new Error("Unknown route");
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
  });

  it("handles invalid variant format safely", async () => {
    const sink: any = {
      setIsFolding: vi.fn(),
      setFoldingError: vi.fn(),
      setFoldingStatus: vi.fn()
    };

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "invalid-mutation",
      residueIndex: null,
      fetchWithAuth: vi.fn(),
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(sink.setFoldingError).toHaveBeenCalledWith("Invalid mutation format for FoldX simulation.");
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
    expect(sink.setIsFolding).toHaveBeenCalledWith(false);
  });

  it("handles HTTP error on /generate-mutant gracefully", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal cluster error" })
    });

    const sink: any = {
      setIsFolding: vi.fn(),
      setFoldingError: vi.fn(),
      setFoldingStatus: vi.fn()
    };

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(sink.setFoldingError).toHaveBeenCalledWith("Internal cluster error");
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
    expect(sink.setIsFolding).toHaveBeenLastCalledWith(false);
  });

  it("exits early without mutation if abort signal is already triggered", async () => {
    const controller = new AbortController();
    controller.abort();

    const mockFetchWithAuth = vi.fn();
    const sink: any = {
      setIsFolding: vi.fn(),
      setFoldingError: vi.fn(),
      setFoldingStatus: vi.fn()
    };

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: controller.signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(mockFetchWithAuth).not.toHaveBeenCalled();
    expect(sink.setIsFolding).toHaveBeenCalledWith(false);
    expect(sink.setFoldingStatus).not.toHaveBeenCalled();
  });

  /**
   * Synchronous ThermoMPNN runs inside the FoldX job or background remote-submissions token wait;
   * a "pending" status that reaches the end of the FoldX pipeline without a value must not stay
   * stuck as "Simulating…".
   */
  it("settles a pending ThermoMPNN status on a completed run when no value arrived", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N ...",
        ddG: 1.5,
        energetics: { foldx: 1.5 },
        thermompnnStatus: "pending"
      })
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    // Unreachable pending status settles cleanly instead of staying "pending".
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
  });

  it("collects background ThermoMPNN results a cache-hit response carried via token", async () => {
    const fetchWithAuth: any = vi.fn(async (url: string): Promise<any> => {
      if (url.includes("/generate-mutant")) {
        return {
          ok: true,
          json: async () => ({
            status: "success",
            pdb: "ATOM",
            ddG: 1.5,
            energetics: { foldx: 1.5 },
            thermompnnStatus: "pending",
            remoteSubmissionToken: "11111111-2222-4333-8444-555555555555"
          })
        };
      }
      expect(url).toBe("/api/v1/remote-submissions/11111111-2222-4333-8444-555555555555");
      return {
        ok: true,
        json: async () => ({
          settled: true,
          thermompnnStatus: "done",
          thermompnnVal: 1.2
        })
      };
    });
    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith("done");
    expect(sink.setThermompnnStatus).not.toHaveBeenCalledWith(null);
    const updates = sink.setFoldingEnergetics.mock.calls.map((call: any[]) => call[0]);
    const finalEnergetics = updates.reduce(
      (acc: any, updater: any) => (typeof updater === "function" ? updater(acc) : updater),
      undefined
    );
    expect(finalEnergetics?.thermompnn).toBe(1.2);
  });

  it("marks ThermoMPNN when a refused session severs its wait, and clears the record when a fresh run starts", async () => {
    const fetchWithAuth: any = vi.fn(async (url: string): Promise<any> => {
      if (url.includes("/generate-mutant")) {
        return {
          ok: true,
          json: async () => ({
            status: "success",
            pdb: "ATOM",
            ddG: 1.5,
            energetics: { foldx: 1.5 },
            thermompnnStatus: "pending",
            remoteSubmissionToken: "c0ffee00-2222-4333-8444-555555555555"
          })
        };
      }
      expect(url).toBe("/api/v1/remote-submissions/c0ffee00-2222-4333-8444-555555555555");
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: { code: "UNAUTHORIZED", message: "Unauthorized: Invalid or missing API token." } })
      };
    });
    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    const updates = sink.setFoldingEnergetics.mock.calls.map((call: any[]) => call[0]);
    const finalEnergetics = updates.reduce(
      (acc: any, updater: any) => (typeof updater === "function" ? updater(acc) : updater),
      undefined
    );
    expect(finalEnergetics.energeticsAuthLapsed).toEqual({ thermompnn: true });
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
  });

  it("does not claim a pause when the session lapse touches no interrupted engine", async () => {
    const fetchWithAuth: any = vi.fn(async (url: string): Promise<any> => {
      if (url.includes("/generate-mutant")) {
        return {
          ok: true,
          json: async () => ({
            status: "success",
            pdb: "ATOM",
            ddG: 1.5,
            energetics: { foldx: 1.5 },
            thermompnnStatus: "done",
            remoteSubmissionToken: "beefcafe-2222-4333-8444-555555555555"
          })
        };
      }
      expect(url).toBe("/api/v1/remote-submissions/beefcafe-2222-4333-8444-555555555555");
      return { ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHORIZED" } }) };
    });
    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    const updates = sink.setFoldingEnergetics.mock.calls.map((call: any[]) => call[0]);
    const finalEnergetics = updates.reduce(
      (acc: any, updater: any) => (typeof updater === "function" ? updater(acc) : updater),
      undefined
    );
    expect(finalEnergetics.energeticsAuthLapsed).toEqual({});
  });

  it("settles pending engines on the ERROR exits, not only on the terminal commits", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "queued",
        foldxJobId: null,
        thermompnnStatus: "pending",
      }),
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1,
    });

    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
  });

  it("settles engines the variant already had pending, even on an exit that throws before the POST returns", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "bad gateway" }),
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1,
      initialRemoteState: {
        thermompnnStatus: "pending",
      },
    });

    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
  });

  it("settles pending engines when the queued job fails before they resolve", async () => {
    const mockFetchWithAuth = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/v1/generate-mutant") {
        return {
          ok: true,
          json: async () => ({
            status: "queued",
            foldxJobId: "job-fail-2",
            thermompnnStatus: "pending",
          })
        };
      }
      if (url === "/api/v1/foldx-job/job-fail-2") {
        return { ok: true, json: async () => ({ status: "failed", error: "FoldX process crashed" }) };
      }
      throw new Error("Unknown route");
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
  });

  it("normalizes canonical provenance onto the run's energetics, and nowhere else", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N ...",
        foldedResidueIndex: 489,
        ddG: 1.25,
        energetics: { totalEnergy: 12.0 },
        provenance: {
          source: "experimental",
          pdbId: "6N7E",
          chainId: "A",
          resolution: 3.5,
          method: "X-RAY DIFFRACTION",
          identity: 100,
          foldxVersion: "5.0"
        }
      })
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "Q9H8M5",
      variant: "p.Ser489Cys",
      residueIndex: 489,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    // Every foldingEnergetics write in order — the store applies updaters sequentially, and a
    // run now starts by clearing any previous session-lapse record before the payload arrives.
    const finalEnergetics = sink.setFoldingEnergetics.mock.calls
      .map((call: any[]) => call[0])
      .reduce((acc: any, updater: any) => (typeof updater === "function" ? updater(acc) : updater), {});

    expect(finalEnergetics.structureProvenance).toEqual(
      expect.objectContaining({
        source: "experimental",
        pdbId: "6N7E",
        chainId: "A",
        resolution: 3.5,
        method: "X-RAY DIFFRACTION",
        identity: 100,
        foldxVersion: "5.0"
      })
    );
    // FoldX's template names no other structure: the store field it once overwrote is gone.
    expect(sink.setStructureProvenance).toBeUndefined();
  });

  it("passes FoldX's paired wild type to the sink with the variant", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N MUTANT",
        wtReferencePdb: "ATOM 1 N PAIRED WT",
        foldedResidueIndex: 489,
        ddG: 1.25,
        energetics: { totalEnergy: 12.0 },
        provenance: { source: "experimental", pdbId: "6N7E", chainId: "A" }
      })
    });
    const sink: any = makeSink();
    await executeFoldxPipeline({
      uniprotId: "Q9H8M5",
      variant: "p.Ser489Cys",
      residueIndex: 489,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });
    expect(sink.setMutantPdb).toHaveBeenCalledWith("ATOM 1 N MUTANT");
    expect(sink.setFoldxWtPdb).toHaveBeenCalledWith("ATOM 1 N PAIRED WT");
  });

  it("normalizes legacy prefixed keys and string resolutions safely", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N ...",
        foldedResidueIndex: 489,
        ddG: 1.25,
        energetics: { totalEnergy: 12.0 },
        provenance: {
          structureSource: "experimental",
          structurePdbId: "6n7e",
          structureChainId: "A",
          structureResolution: "3.5",
          structureMethod: "X-RAY DIFFRACTION",
          structureIdentity: "100"
        }
      })
    });

    const sink: any = makeSink();

    await executeFoldxPipeline({
      uniprotId: "Q9H8M5",
      variant: "p.Ser489Cys",
      residueIndex: 489,
      fetchWithAuth: mockFetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

    const finalEnergetics = sink.setFoldingEnergetics.mock.calls
      .map((call: any[]) => call[0])
      .reduce((acc: any, updater: any) => (typeof updater === "function" ? updater(acc) : updater), {});

    expect(finalEnergetics.structureProvenance).toEqual(
      expect.objectContaining({
        source: "experimental",
        pdbId: "6n7e",
        chainId: "A",
        resolution: 3.5,
        identity: 100
      })
    );
  });

  it("keeps the wild-type gate's disclosure when it rebuilds the template provenance (regression: F1 was stripped)", async () => {
    const run = async (provenance: Record<string, unknown>) => {
      const sink: any = makeSink();
      await executeFoldxPipeline({
        uniprotId: "P06132",
        variant: "p.Gly318Arg",
        residueIndex: 318,
        fetchWithAuth: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            status: "completed",
            pdb: "ATOM 1 N ...",
            foldedResidueIndex: 318,
            ddG: -1.75,
            energetics: { totalEnergy: 12.0 },
            provenance,
          }),
        }),
        sink,
        signal: new AbortController().signal,
        requestId: 1,
        getActiveRequestId: () => 1,
      });
      return sink.setFoldingEnergetics.mock.calls
        .map((call: any[]) => call[0])
        .reduce((acc: any, updater: any) => (typeof updater === "function" ? updater(acc) : updater), {});
    };

    // The whitelist in `applyEnergetics` rebuilt these objects; a missing field here means the screen
    // can no longer say why the mutant crystal is not the template.
    const refused = await run({
      source: "alphafold",
      afdbVersion: "v6",
      excludedExperimental: { pdbId: "1R3S", chainId: "A", differences: ["D86G (engineered mutation)"] },
    });
    expect(refused.structureProvenance).toEqual(
      expect.objectContaining({
        source: "alphafold",
        afdbVersion: "v6",
        excludedExperimental: { pdbId: "1R3S", chainId: "A", differences: ["D86G (engineered mutation)"] },
      })
    );

    const kept = await run({
      source: "experimental",
      pdbId: "1R3S",
      chainId: "A",
      sequenceDifferences: ["D86G (engineered mutation)"],
    });
    expect(kept.structureProvenance).toEqual(
      expect.objectContaining({
        source: "experimental",
        sequenceDifferences: ["D86G (engineered mutation)"],
      })
    );
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SIMULATION CONDITIONS CROSS THE UNIT BOUNDARY HERE
 * ─────────────────────────────────────────────────────────────────────────────
 * The Settings panel collects °C and mM. `/generate-mutant` takes FoldX's units — Kelvin and molar —
 * and forwards them straight to `--temperature` / `--ionStrength`. Forwarding the panel's numbers
 * verbatim asked FoldX for 25 K and 150 M, and the cache key recorded the panel's numbers, so the
 * wrong-units result was cached under a key that claimed the requested condition.
 *
 * `foldxService` is the adapter, so these tests assert the WIRE, the CACHE and the REFUSAL.
 */
describe("foldxService simulation conditions", () => {
  const UI_CONDITIONS = { ph: 7.4, temperature: 25, ionicStrength: 150 };

  const completingFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N ...",
        ddG: 1.5,
        foldedResidueIndex: 408,
        energetics: { foldx: 1.5 }
      })
    });

  const run = (fetchWithAuth: any, sink: any, conditions?: any) =>
    executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      ...(conditions ? { conditions } : {}),
      fetchWithAuth,
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1
    });

  const submittedBody = (fetchWithAuth: any) => JSON.parse(fetchWithAuth.mock.calls[0][1].body);

  it("sends FoldX's native units: 25 °C → 298.15 K, 150 mM → 0.15 M, pH unchanged", async () => {
    clearClientVariantCache();
    const fetchWithAuth = completingFetch();
    await run(fetchWithAuth, makeSink(), UI_CONDITIONS);

    const body = submittedBody(fetchWithAuth);
    expect(body.temperature).toBe(298.15);
    expect(body.ionicStrength).toBe(0.15);
    expect(body.pH).toBe(7.4);
    // The defect itself, stated as an assertion: the panel's numbers must never reach the wire.
    expect(body.temperature).not.toBe(25);
    expect(body.ionicStrength).not.toBe(150);
  });

  it("sends no conditions at all when the caller has none, leaving the server's defaults in force", async () => {
    clearClientVariantCache();
    const fetchWithAuth = completingFetch();
    await run(fetchWithAuth, makeSink());

    expect(submittedBody(fetchWithAuth)).toEqual({ uniprotId: "P00439", mutation: "RA408W" });
  });

  it("stamps a no-conditions run as the SERVER's native defaults, not the panel's", async () => {
    clearClientVariantCache();
    await run(completingFetch(), makeSink());

    // Nothing was sent, so the numbers FoldX actually used are its own defaults — and the stamp has
    // to say so, or a native-default artifact could be served for a panel-default request.
    expect(JSON.parse(getCachedVariant("P00439", "p.Arg408Trp")!.biophysicsContext!)).toEqual({
      unitVersion: BIOPHYSICS_NATIVE_DEFAULT_VERSION,
      basis: "server-native-defaults",
      ph: 7.0,
      temperature: 298,
      ionicStrength: 0.05
    });
    expect(getCachedVariant("P00439", "p.Arg408Trp")!.biophysicsContext)
      .not.toBe(biophysicsContextOf(UI_CONDITIONS));
  });

  it("stamps the cache with the SUBMITTED panel conditions, plus the unit version", async () => {    clearClientVariantCache();
    await run(completingFetch(), makeSink(), UI_CONDITIONS);

    const cached = getCachedVariant("P00439", "p.Arg408Trp");
    // The record keeps what the reader chose in the units the reader chose — the conversion belongs
    // to the wire, not to the stored context, which is what the Settings panel is compared against.
    expect(JSON.parse(cached!.biophysicsContext!)).toEqual({
      unitVersion: BIOPHYSICS_CONDITION_UNIT_VERSION,
      basis: "submitted-ui",
      ph: 7.4,
      temperature: 25,
      ionicStrength: 150
    });
    expect(cached!.biophysicsContext).toBe(biophysicsContextOf(UI_CONDITIONS));
  });

  it("refuses unusable conditions instead of submitting a fabricated one", async () => {
    clearClientVariantCache();
    const fetchWithAuth = completingFetch();
    const sink: any = makeSink();

    await run(fetchWithAuth, sink, { ph: 7.4, temperature: Number.NaN, ionicStrength: 150 });

    expect(fetchWithAuth, "an unusable condition must not be submitted at all").not.toHaveBeenCalled();
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
    // The run clears any previous error first, so the reason is the LAST error written.
    const errors = sink.setFoldingError.mock.calls.map(([e]: [any]) => String(e));
    expect(errors[errors.length - 1]).toContain("temperature");
    expect(errors[errors.length - 1]).toContain("not a number");
    expect(sink.setIsFolding).toHaveBeenLastCalledWith(false);
  });

  it("ships the same defaults the converter fills absent fields from", () => {
    /**
     * "The default" used to exist in more than one place — the Settings defaults, the panel's own
     * PHYSIOLOGICAL reset constant, and the cache-context fallbacks. A drift between them makes the
     * panel show one condition while the wire carries another, so the shipped default is pinned to
     * the converter's here.
     */
    expect(DEFAULT_USER_SETTINGS.biophysicsConditions).toEqual(DEFAULT_UI_BIOPHYSICS_CONDITIONS);
  });

  it("cannot reuse an artifact stamped before the unit version existed", () => {    /**
     * The pre-fix artifact: the same three numbers and no `unitVersion` — computed while
     * `temperature: 25` meant 25 KELVIN. It must not be served for a request whose panel shows 25 °C.
     */
    clearClientVariantCache();
    setCachedVariant("P00439", "p.Arg408Trp", "P00439", {
      biophysicsContext: JSON.stringify({ ph: 7.4, temperature: 25, ionicStrength: 150 }),
      mutantPdb: "ATOM old",
      foldingDdG: 9.9,
      foldingStatus: "success"
    } as any);

    const expected = createAnalysisCacheContext("P00439", { biophysicsConditions: UI_CONDITIONS });
    const cached = getCachedVariant("P00439", "p.Arg408Trp", expected);

    expect(cached?.mutantPdb, "the wrong-units mutant must not be reused").toBeUndefined();
    expect(cached?.foldingDdG).toBeUndefined();
  });
});

describe("foldxService reports its outcome to the Console", () => {
  const immediate = (payload: any): any =>
    vi.fn(async () => ({ ok: true, json: async () => payload }));

  const run = async (payload: any, traceContext?: any) => {
    const sink: any = makeSink();
    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: immediate(payload),
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1,
      traceContext,
    });
    return sink;
  };

  it("logs a failed result the server returned with HTTP 200, which no interceptor can see", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run({ status: "failed", ddG: null, error: "RepairPDB did not converge" });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[FoldX\] calculation failed for p\.Arg408Trp: RepairPDB did not converge/));
    warn.mockRestore();
  });

  it("calls a deployment without the binary 'unavailable', not a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run({ status: "unavailable", ddG: null, energetics: { foldxError: "FoldX binary is missing" } });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[FoldX\] unavailable for p\.Arg408Trp: FoldX binary is missing/));
    warn.mockRestore();
  });

  it("stays quiet on success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run({ status: "success", ddG: 1.2, pdb: "ATOM", foldedResidueIndex: 408 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("surfaces a ThermoMPNN error string instead of leaving it in the tab alone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run({ status: "success", ddG: 1.2, pdb: "ATOM", thermompnnError: "model service offline" });
    expect(warn).toHaveBeenCalledWith("[ThermoMPNN] model service offline");
    warn.mockRestore();
  });

  /**
   * The job record keeps `thermompnnError` for the rest of the run, and every FoldX poll re-reads it.
   * Un-deduplicated logging wrote one warning per tick (13 in the reported run, aggregated by the
   * DevConsole into `count: 13`), which read as thirteen failures.
   */
  it("repeats a ThermoMPNN error once, not once per FoldX poll", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const busy = "ThermoMPNN did not answer within 150 s.";
    const polls = [
      { status: "running", thermompnnStatus: "busy", thermompnnError: busy },
      { status: "running", thermompnnStatus: "busy", thermompnnError: busy },
      { status: "running", thermompnnStatus: "busy", thermompnnError: busy },
      { status: "completed", result: { status: "completed", pdb: "ATOM MUT ...", ddG: 0.9 } },
    ];
    let i = 0;
    const sink = makeSink();
    const fetchWithAuth: any = vi.fn(async (url: string) => {
      if (url === "/api/v1/generate-mutant") return { ok: true, json: async () => ({ status: "queued", foldxJobId: "job-tm" }) };
      return { ok: true, json: async () => polls[Math.min(i++, polls.length - 1)] };
    });
    await executeFoldxPipeline({
      uniprotId: "P00439", variant: "p.Arg408Trp", residueIndex: 408, fetchWithAuth, sink,
      signal: new AbortController().signal, requestId: 1, getActiveRequestId: () => 1,
    });
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith("busy");
    expect(warn.mock.calls.filter(([line]) => String(line).startsWith("[ThermoMPNN]"))).toEqual([[`[ThermoMPNN] ${busy}`]]);
    warn.mockRestore();
  });

  it("records a trace span carrying the same outcome the Energetics tab shows", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const addTraceSpan = vi.fn();
    await run({ status: "failed", ddG: null, error: "boom" }, { activeTraceId: "t1", traceStart: performance.now(), addTraceSpan });
    expect(addTraceSpan).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "t1", name: "FoldX Mutagenesis (ΔΔG)", stage: "structure", status: "failed", error: "boom" })
    );

    addTraceSpan.mockClear();
    await run({ status: "success", ddG: 1.2, pdb: "ATOM", foldedResidueIndex: 408 }, { activeTraceId: "t1", traceStart: performance.now(), addTraceSpan });
    expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
    expect(addTraceSpan.mock.calls[0][0].error).toBeUndefined();

    addTraceSpan.mockClear();
    await run({ status: "unavailable", ddG: null }, { activeTraceId: "t1", traceStart: performance.now(), addTraceSpan });
    expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({ status: "unavailable" }));
    vi.restoreAllMocks();
  });

  it("records no span for a superseded run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const addTraceSpan = vi.fn();
    const sink: any = makeSink();
    await executeFoldxPipeline({
      uniprotId: "P00439",
      variant: "p.Arg408Trp",
      residueIndex: 408,
      fetchWithAuth: immediate({ status: "failed", ddG: null }),
      sink,
      signal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 2,
      traceContext: { activeTraceId: "t1", traceStart: 0, addTraceSpan },
    });
    expect(addTraceSpan).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
