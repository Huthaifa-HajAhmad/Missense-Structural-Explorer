import { describe, it, expect, vi } from "vitest";
import { executeFoldxPipeline } from "../foldxService";

/** The biophysical sink surface `executeFoldxPipeline` is allowed to write to. */
const makeSink = () => ({
  setIsFolding: vi.fn(),
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
  setThermompnnError: vi.fn()
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
    expect(sink.setDynamut2Status).toHaveBeenCalledWith("unavailable");
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith("unavailable");
    // ...while an engine with a live poller is left to report its own outcome.
    expect(sink.setDdmutStatus).not.toHaveBeenCalledWith("unavailable");
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
    expect(sink.setDynamut2Status).toHaveBeenCalledWith("unavailable");
    expect(sink.setThermompnnStatus).toHaveBeenCalledWith("unavailable");
    // An engine whose poller is live is still left alone.
    expect(sink.setDdmutStatus).not.toHaveBeenCalledWith("unavailable");
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

    expect(sink.setDynamut2Status).toHaveBeenCalledWith("unavailable");
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("failed");
  });
});
