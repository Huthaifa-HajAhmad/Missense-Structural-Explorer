import { describe, it, expect, vi } from "vitest";
import { executeFoldxPipeline } from "../foldxService";

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

    const sink: any = {
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

    const sink: any = {
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

    const sink: any = {
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
});
