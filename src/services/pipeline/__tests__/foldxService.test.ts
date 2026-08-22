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
        provenance: { structureSource: "alphafold", foldxVersion: "5.0" }
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
            dynamut2JobId: "dyn-123"
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
    expect(sink.setMutantPdb).toHaveBeenCalledWith("ATOM MUT ...");
    expect(sink.setFoldingDdG).toHaveBeenCalledWith(1.8);
    expect(sink.setFoldingStatus).toHaveBeenCalledWith("success");
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
