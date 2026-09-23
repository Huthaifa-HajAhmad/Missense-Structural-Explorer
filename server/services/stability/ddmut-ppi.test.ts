import { describe, it, expect, vi, beforeEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";
import {
  getUniqueChainsFromPdb,
  classifyDdgBind,
  submitDdmutPpiJob,
  pollDdmutPpiJob,
  evaluateDdmutPpi,
  clearDdmutPpiCache
} from "./ddmut-ppi.ts";

const SAMPLE_SINGLE_CHAIN_PDB = `
ATOM      1  N   ALA A   1      11.100  12.200  13.300  1.00 20.00           N
ATOM      2  CA  ALA A   1      12.100  13.200  14.300  1.00 20.00           C
TER
END
`.trim();

const SAMPLE_MULTI_CHAIN_PDB = `
ATOM      1  N   ALA A   1      11.100  12.200  13.300  1.00 20.00           N
ATOM      2  CA  ALA A   1      12.100  13.200  14.300  1.00 20.00           C
TER
ATOM      3  N   ASP B   1      25.100  26.200  27.300  1.00 20.00           N
ATOM      4  CA  ASP B   1      26.100  27.200  28.300  1.00 20.00           C
HETATM    5  MG   MG B   2      30.000  31.000  32.000  1.00 20.00          MG
TER
END
`.trim();

describe("DDMut-PPI Service Unit Tests", () => {
  beforeEach(() => {
    clearDdmutPpiCache();
    vi.restoreAllMocks();
  });

  describe("PDB Chain Extraction", () => {
    it("extracts single chain accurately", () => {
      const chains = getUniqueChainsFromPdb(SAMPLE_SINGLE_CHAIN_PDB);
      expect(chains).toEqual(["A"]);
    });

    it("extracts multiple distinct chains from ATOM and HETATM records", () => {
      const chains = getUniqueChainsFromPdb(SAMPLE_MULTI_CHAIN_PDB);
      expect(chains).toEqual(["A", "B"]);
    });

    it("returns empty array for empty or header-only PDB", () => {
      const chains = getUniqueChainsFromPdb("REMARK 220\nTITLE TEST PDB");
      expect(chains).toEqual([]);
    });
  });

  describe("Binding Affinity Classification", () => {
    it("classifies >= 1.0 kcal/mol as INTERFACE_DISRUPTIVE", () => {
      expect(classifyDdgBind(1.0)).toBe("INTERFACE_DISRUPTIVE");
      expect(classifyDdgBind(2.45)).toBe("INTERFACE_DISRUPTIVE");
    });

    it("classifies 0.5 <= ddg < 1.0 kcal/mol as ALLOSTERIC_PERTURBATION", () => {
      expect(classifyDdgBind(0.5)).toBe("ALLOSTERIC_PERTURBATION");
      expect(classifyDdgBind(0.99)).toBe("ALLOSTERIC_PERTURBATION");
    });

    it("classifies < 0.5 kcal/mol as SURFACE_NEUTRAL", () => {
      expect(classifyDdgBind(0.49)).toBe("SURFACE_NEUTRAL");
      expect(classifyDdgBind(0.0)).toBe("SURFACE_NEUTRAL");
      expect(classifyDdgBind(-1.2)).toBe("SURFACE_NEUTRAL");
    });

    it("classifies non-finite numbers as UNKNOWN", () => {
      expect(classifyDdgBind(NaN)).toBe("UNKNOWN");
      expect(classifyDdgBind(Infinity)).toBe("UNKNOWN");
      expect(classifyDdgBind(-Infinity)).toBe("UNKNOWN");
    });
  });

  describe("submitDdmutPpiJob", () => {
    it("rejects single-chain structure without submitting to network", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const jobId = await submitDdmutPpiJob(SAMPLE_SINGLE_CHAIN_PDB, "A", "A1V");
      expect(jobId).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("submits multi-chain structure and returns job ID", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ job_id: "17901962000000001" })
      } as any);

      const jobId = await submitDdmutPpiJob(SAMPLE_MULTI_CHAIN_PDB, "A", "A1V");
      expect(jobId).toBe("17901962000000001");
    });

    it("returns null when upstream responds with error object", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ error: "Residue out of bounds" })
      } as any);

      const jobId = await submitDdmutPpiJob(SAMPLE_MULTI_CHAIN_PDB, "A", "A999V");
      expect(jobId).toBeNull();
    });

    it("returns null when network throws an error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection reset"));

      const jobId = await submitDdmutPpiJob(SAMPLE_MULTI_CHAIN_PDB, "A", "A1V");
      expect(jobId).toBeNull();
    });
  });

  describe("pollDdmutPpiJob", () => {
    it("handles DONE status with prediction and interface distance", async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      mockReq.destroy = vi.fn();

      vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
        expect(options.method).toBe("GET");
        const mockRes = new EventEmitter() as any;
        mockRes.statusCode = 200;
        mockRes.setEncoding = vi.fn();

        process.nextTick(() => {
          callback(mockRes);
          mockRes.emit("data", JSON.stringify({
            status: "DONE",
            job_id: "17901962000000001",
            prediction: "-1.85",
            distance_to_interface: "3.24",
            results_page: "https://biosig.lab.uq.edu.au/ddmut_ppi/results/17901962000000001"
          }));
          mockRes.emit("end");
        });

        return mockReq;
      });

      const res = await pollDdmutPpiJob("17901962000000001");
      expect(res).toEqual({
        status: "DONE",
        ddgBind: -1.85,
        distanceToInterface: 3.24,
        resultsPage: "https://biosig.lab.uq.edu.au/ddmut_ppi/results/17901962000000001"
      });
    });

    it("handles RUNNING status cleanly", async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      mockReq.destroy = vi.fn();

      vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
        const mockRes = new EventEmitter() as any;
        mockRes.statusCode = 200;
        mockRes.setEncoding = vi.fn();

        process.nextTick(() => {
          callback(mockRes);
          mockRes.emit("data", JSON.stringify({
            status: "RUNNING",
            job_id: "17901962000000001"
          }));
          mockRes.emit("end");
        });

        return mockReq;
      });

      const res = await pollDdmutPpiJob("17901962000000001");
      expect(res).toEqual({
        status: "RUNNING",
        ddgBind: null,
        distanceToInterface: null
      });
    });

    it("handles explicit ERROR status without falsely marking RUNNING", async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      mockReq.destroy = vi.fn();

      vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
        const mockRes = new EventEmitter() as any;
        mockRes.statusCode = 200;
        mockRes.setEncoding = vi.fn();

        process.nextTick(() => {
          callback(mockRes);
          mockRes.emit("data", JSON.stringify({
            status: "ERROR",
            job_id: "17901962000000001",
            error: "Residue not located at interaction interface"
          }));
          mockRes.emit("end");
        });

        return mockReq;
      });

      const res = await pollDdmutPpiJob("17901962000000001");
      expect(res).toEqual({
        status: "ERROR",
        ddgBind: null,
        distanceToInterface: null
      });
    });
  });

  describe("evaluateDdmutPpi", () => {
    it("submits, polls, and caches completed calculation", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ job_id: "17901962000000001" })
      } as any);

      // Mock poll via https.request
      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      mockReq.destroy = vi.fn();

      const pollSpy = vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
        const mockRes = new EventEmitter() as any;
        mockRes.statusCode = 200;
        mockRes.setEncoding = vi.fn();

        process.nextTick(() => {
          callback(mockRes);
          mockRes.emit("data", JSON.stringify({
            status: "DONE",
            prediction: "1.45",
            distance_to_interface: "2.10",
            results_page: "https://biosig.lab.uq.edu.au/ddmut_ppi/results/17901962000000001"
          }));
          mockRes.emit("end");
        });

        return mockReq;
      });

      const result = await evaluateDdmutPpi(SAMPLE_MULTI_CHAIN_PDB, "A", "A1V", 5000, undefined, 50);
      expect(result).not.toBeNull();
      expect(result?.ddgBind).toBe(1.45);
      expect(result?.distanceToInterface).toBe(2.10);
      expect(result?.classification).toBe("INTERFACE_DISRUPTIVE");

      // Verify second call is served from cache without submitting or polling
      fetchSpy.mockClear();
      pollSpy.mockClear();
      const cachedResult = await evaluateDdmutPpi(SAMPLE_MULTI_CHAIN_PDB, "A", "A1V", 5000, undefined, 50);
      expect(cachedResult).toEqual(result);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(pollSpy).not.toHaveBeenCalled();
    });

    it("resumes polling existing job ID across request budgets instead of duplicate submissions", async () => {
      let submitCallCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        submitCallCount++;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ job_id: "17901962000000002" })
        } as any;
      });

      // First run: budget expires while job is RUNNING
      const mockReq1 = new EventEmitter() as any;
      mockReq1.write = vi.fn();
      mockReq1.end = vi.fn();
      mockReq1.destroy = vi.fn();

      vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
        const mockRes = new EventEmitter() as any;
        mockRes.statusCode = 200;
        mockRes.setEncoding = vi.fn();

        process.nextTick(() => {
          callback(mockRes);
          mockRes.emit("data", JSON.stringify({
            status: "RUNNING",
            job_id: "17901962000000002"
          }));
          mockRes.emit("end");
        });

        return mockReq1;
      });

      // Run with short maxWaitMs (120ms with 50ms interval => polls twice then times out)
      const firstRun = await evaluateDdmutPpi(SAMPLE_MULTI_CHAIN_PDB, "A", "A1V", 120, undefined, 50);
      expect(firstRun).toBeNull();
      expect(submitCallCount).toBe(1);

      // Second run: should NOT submit again; should resume polling the existing job
      const mockReq2 = new EventEmitter() as any;
      mockReq2.write = vi.fn();
      mockReq2.end = vi.fn();
      mockReq2.destroy = vi.fn();

      vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
        const mockRes = new EventEmitter() as any;
        mockRes.statusCode = 200;
        mockRes.setEncoding = vi.fn();

        process.nextTick(() => {
          callback(mockRes);
          mockRes.emit("data", JSON.stringify({
            status: "DONE",
            prediction: "0.72",
            distance_to_interface: "4.50"
          }));
          mockRes.emit("end");
        });

        return mockReq2;
      });

      const secondRun = await evaluateDdmutPpi(SAMPLE_MULTI_CHAIN_PDB, "A", "A1V", 5000, undefined, 50);
      expect(secondRun).not.toBeNull();
      expect(secondRun?.ddgBind).toBe(0.72);
      expect(secondRun?.classification).toBe("ALLOSTERIC_PERTURBATION");
      // Key assertion: submitDdmutPpiJob was NOT called a second time!
      expect(submitCallCount).toBe(1);
    });
  });
});
