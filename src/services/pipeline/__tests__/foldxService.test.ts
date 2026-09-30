import { describe, it, expect, vi } from "vitest";
import { executeFoldxPipeline } from "../foldxService";
import { getCachedVariant, clearClientVariantCache } from "../variantCache";

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
  setDynamut2JobId: vi.fn(),
  setDynamut2Status: vi.fn(),
  setDdmutJobId: vi.fn(),
  setDdmutStatus: vi.fn(),
  setThermompnnJobId: vi.fn(),
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
        dynamut2JobId: "dyn-abc",
        dynamut2Status: "pending",
        ddmutJobId: "ddm-xyz",
        ddmutStatus: "pending",
        thermompnnJobId: "tm-123",
        thermompnnStatus: "pending",
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
    expect(sink.setDynamut2JobId).toHaveBeenCalledWith("dyn-abc");
    expect(sink.setDynamut2Status).toHaveBeenCalledWith("pending");
    expect(sink.setDdmutJobId).toHaveBeenCalledWith("ddm-xyz");
    expect(sink.setDdmutStatus).toHaveBeenCalledWith("pending");
    expect(sink.setThermompnnJobId).toHaveBeenCalledWith("tm-123");
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith("pending");
    expect(sink.setIsFolding).toHaveBeenLastCalledWith(false);
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
            dynamut2JobId: "dyn-123",
            dynamut2Status: "pending",
            ddmutJobId: "ddm-123",
            ddmutStatus: "pending"
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

    expect(sink.setDynamut2JobId).toHaveBeenCalledWith("dyn-123");
    expect(sink.setDynamut2Status).toHaveBeenCalledWith("pending");
    expect(sink.setDdmutJobId).toHaveBeenCalledWith("ddm-123");
    expect(sink.setDdmutStatus).toHaveBeenCalledWith("pending");
    expect(sink.setMutantPdb).toHaveBeenCalledWith("ATOM MUT ...");
    expect(sink.setFoldingDdG).toHaveBeenCalledWith(1.8);
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
            dynamut2JobId: "dyn-early-1",
            dynamut2Status: "pending",
            ddmutJobId: "ddm-early-1",
            ddmutStatus: "pending"
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

    expect(sink.setDynamut2JobId).toHaveBeenCalledWith("dyn-early-1");
    expect(sink.setDynamut2Status).toHaveBeenCalledWith("pending");
    expect(sink.setDdmutJobId).toHaveBeenCalledWith("ddm-early-1");
    expect(sink.setDdmutStatus).toHaveBeenCalledWith("pending");
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
   * An engine reported as "pending" with no job id can never be resolved: `useJobPoller` needs an
   * id to start, and the SSE channel for these engines is only emitted from that poller's own
   * handler. The end of the FoldX run is the last moment anything could settle it, so it must not
   * be left pending — that is what produced a permanent "Simulating…" row.
   */
  it("settles a pending engine that has no job id to poll", async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N ...",
        ddG: 1.5,
        energetics: { foldx: 1.5 },
        dynamut2Status: "pending",
        dynamut2JobId: null,
        ddmutStatus: "pending",
        ddmutJobId: "ddm-live-1",
        thermompnnStatus: "pending",
        thermompnnJobId: null
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

    // Unreachable engines become terminal...
    expect(sink.setDynamut2Status).toHaveBeenCalledWith(null);
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
    // ...while an engine with a live poller is left to report its own outcome.
    expect(sink.setDdmutStatus).not.toHaveBeenCalledWith(null);
  });

  it("collects job ids a cache-hit response could not carry, instead of settling to no result", async () => {
    // The cache-hit route answers before the BioSig submissions return an id, and now hands back a
    // token to collect them. Settling first is what turned DDMut/DynaMut2 into "No result".
    const fetchWithAuth: any = vi.fn(async (url: string): Promise<any> => {
      if (url.includes("/generate-mutant")) {
        return {
          ok: true,
          json: async () => ({
            status: "success",
            pdb: "ATOM",
            ddG: 1.5,
            energetics: { foldx: 1.5 },
            dynamut2Status: "pending",
            dynamut2JobId: null,
            ddmutStatus: "pending",
            ddmutJobId: null,
            remoteSubmissionToken: "11111111-2222-4333-8444-555555555555"
          })
        };
      }
      expect(url).toBe("/api/v1/remote-submissions/11111111-2222-4333-8444-555555555555");
      return {
        ok: true,
        json: async () => ({
          settled: true,
          dynamut2JobId: "178940463982",
          dynamut2Status: "pending",
          ddmutJobId: null,
          ddmutStatus: "unavailable"
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
    expect(sink.setDynamut2JobId).toHaveBeenCalledWith("178940463982");
    // An engine that now has a live poller is not settled away...
    expect(sink.setDynamut2Status).not.toHaveBeenCalledWith(null);
    // ...and one whose submission failed carries that fact, not a blank.
    expect(sink.setDdmutStatus).toHaveBeenCalledWith("unavailable");
  });

  it("settles pending engines on the ERROR exits, not only on the terminal commits", async () => {
    /**
     * The defect: the settle helper ran on the three terminal commits only, and it was defined
     * INSIDE the `try`, so the `catch` could not reach it at all.
     *
     * That matters because the error exits are exactly the paths that leave a remote engine at
     * "pending" with a null job id — the POST seeds that state before its submission race resolves,
     * so the id is genuinely unknown when the run dies. `useJobPoller` refuses to start without an
     * id, so nothing could ever resolve it, and the UI read "Calculation in progress" indefinitely
     * while `summarizeCoverage` kept counting the engine as running.
     *
     * This uses the queued-with-no-jobId branch, which throws immediately — no poll backoff.
     */
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "queued",
        foldxJobId: null,
        dynamut2Status: "pending",
        dynamut2JobId: null,
        ddmutStatus: "pending",
        ddmutJobId: "ddm-live-2",
        thermompnnStatus: "pending",
        thermompnnJobId: null,
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

    // The run failed...
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
    // ...and the engines it left behind are terminal rather than stuck at "pending".
    expect(sink.setDynamut2Status).toHaveBeenCalledWith(null);
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith(null);
    // An engine whose poller is live is still left alone.
    expect(sink.setDdmutStatus).not.toHaveBeenCalledWith(null);
  });

  it("does not settle an engine whose job id the variant ALREADY had", async () => {
    /**
     * Item 5 of the plan. The store can hold a live poller's id from a restored bundle while this
     * run's POST omits it — the 1.5 s submission race the settle's own comment describes. Settling
     * would write a terminal status, and `useJobPoller` is gated on `status === "pending"`, so it
     * would tear the LIVE poller down and discard the result it was about to deliver.
     */
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "queued",
        foldxJobId: null,
        dynamut2Status: "pending",
        dynamut2JobId: null,
        ddmutStatus: "pending",
        ddmutJobId: null,
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
      initialRemoteState: {
        dynamut2Status: "pending",
        dynamut2JobId: "dyn-live-9",
        ddmutStatus: "pending",
        ddmutJobId: null,
      },
    });

    // The engine with a live id is left to its poller...
    expect(sink.setDynamut2Status).not.toHaveBeenCalledWith(null);
    // ...the one without is settled, because nothing can ever resolve it.
    expect(sink.setDdmutStatus).toHaveBeenCalledWith(null);
  });

  it("does not settle an engine whose live job id the store already holds, on the TERMINAL path", async () => {
    /**
     * F4/R3-1, and the half of the settle fix that was still missing.
     *
     * Three of the four settle sites were fed this attempt's response rather than the merged view, so a
     * POST that omits an id the store is polling read as "pending with no id" — and the settle cleared
     * the status, tearing down the `useJobPoller` that was about to deliver the result. The CATCH path
     * was already correct, which is exactly why the earlier tests could not see this: they drove the
     * catch, the least important of the four.
     */
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM MUT ...",
        ddG: 1.5,
        energetics: { foldx: 1.5 },
        // The store holds both engines as pending with live ids; this response omits the ids, which is
        // the ordinary submission race.
        dynamut2Status: "pending",
        ddmutStatus: "pending",
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
      initialRemoteState: {
        dynamut2Status: "pending",
        dynamut2JobId: "dyn-live-9",
        ddmutStatus: "pending",
        ddmutJobId: "ddm-live-9",
      },
    });

    expect(
      sink.setDynamut2Status,
      "the settle cleared a status whose live poller it was about to discard the result of"
    ).not.toHaveBeenCalledWith(null);
    expect(sink.setDdmutStatus).not.toHaveBeenCalledWith(null);
  });

  it("does not let a response that omits a job id erase one the variant already had", async () => {
    /**
     * R3-2. The persisted bundle is what the restore path seeds `initialRemoteState` from, so a cache
     * write that REPLACES instead of merging loses the id the settle then needs — and the live poller
     * that id belongs to is torn down. The sink writes already guarded with
     * `if (data.xJobId != null)`, which is the evidence that omitted ids are expected.
     */
    clearClientVariantCache();

    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM 1 N ...",
        ddG: 1.5,
        energetics: { foldx: 1.5 },
        dynamut2Status: "pending",
        dynamut2JobId: null,
        ddmutStatus: "pending",
        ddmutJobId: null,
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
      initialRemoteState: { dynamut2Status: "pending", dynamut2JobId: "dyn-live-1" },
    });

    const cached = getCachedVariant("P00439", "p.Arg408Trp");
    expect(
      cached?.dynamut2JobId,
      "the cache write replaced the id instead of merging, so the settle can no longer see it"
    ).toBe("dyn-live-1");
  });

  it("settles engines the variant already had pending, even on an exit that throws before the POST returns", async () => {
    /**
     * Item 4 of the plan. A non-ok response throws before the POST's statuses can be captured, so
     * without the seeded state the catch settled an empty object and the engines stayed `pending`
     * with no poller — the original stuck-"Running" defect, still live on this path.
     */
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
        dynamut2Status: "pending",
        dynamut2JobId: null,
        thermompnnStatus: "pending",
        thermompnnJobId: null,
      },
    });

    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
    expect(sink.setDynamut2Status).toHaveBeenCalledWith(null);
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
            dynamut2Status: "pending",
            dynamut2JobId: null
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

    expect(sink.setDynamut2Status).toHaveBeenCalledWith(null);
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

    const updater = sink.setFoldingEnergetics.mock.calls[0][0];
    const prev = {};
    const updated = typeof updater === "function" ? updater(prev) : updater;
    expect(updated.structureProvenance).toEqual(
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

    const updater = sink.setFoldingEnergetics.mock.calls[0][0];
    const updated = typeof updater === "function" ? updater({}) : updater;
    expect(updated.structureProvenance).toEqual(
      expect.objectContaining({
        source: "experimental",
        pdbId: "6n7e",
        chainId: "A",
        resolution: 3.5,
        identity: 100
      })
    );
  });
});
