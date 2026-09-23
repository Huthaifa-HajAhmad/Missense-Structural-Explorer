import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollBioSigJob, httpGetWithBody, submitDdmutJob, submitDynaMut2Job } from "./dynamut.ts";
import https from "node:https";
import { EventEmitter } from "node:events";

describe("BioSig Polling and Submission Engine (server/services/dynamut.ts)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("submitBioSigJob", () => {
    it("submits DynaMut2 job to API endpoint with JSON response", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ job_id: "1790123456" })
      } as any);

      try {
        const jobId = await submitDynaMut2Job("ATOM      1  CA  ALA A   1       1.000   1.000   1.000  1.00 20.00           C\nEND", "A", 1, "A", "V");
        expect(jobId).toBe("1790123456");
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single",
          expect.objectContaining({
            method: "POST"
          })
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("submits DDMut job to web route and extracts job_id from followed redirect URL", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://biosig.lab.uq.edu.au/ddmut/results_prediction/17901952599297054",
        text: async () => "<html>We are processing your submission</html>"
      } as any);

      try {
        const jobId = await submitDdmutJob("ATOM      1  CA  ALA A   1       1.000   1.000   1.000  1.00 20.00           C\nEND", "A", 1, "A", "V");
        expect(jobId).toBe("17901952599297054");
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "https://biosig.lab.uq.edu.au/ddmut/run_single_prediction",
          expect.objectContaining({
            method: "POST"
          })
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("submits DDMut job and extracts job_id from Location header when 302 is received", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        url: "https://biosig.lab.uq.edu.au/ddmut/run_single_prediction",
        headers: {
          get: (name: string) => name.toLowerCase() === "location" ? "http://biosig.lab.uq.edu.au/ddmut/results_prediction/1790199999" : null
        },
        text: async () => "Redirecting..."
      } as any);

      try {
        const jobId = await submitDdmutJob("ATOM      1  CA  ALA A   1       1.000   1.000   1.000  1.00 20.00           C\nEND", "A", 1, "A", "V");
        expect(jobId).toBe("1790199999");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("handles DDMut RUNNING status correctly via GET body protocol", async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.write = vi.fn();
    mockReq.end = vi.fn();
    mockReq.destroy = vi.fn();

    vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
      expect(options.method).toBe("GET");
      expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.setEncoding = vi.fn();

      process.nextTick(() => {
        callback(mockRes);
        mockRes.emit("data", JSON.stringify({ job_id: "17893192007005534", status: "RUNNING" }));
        mockRes.emit("end");
      });

      return mockReq;
    });

    const result = await pollBioSigJob("ddmut", "17893192007005534");
    expect(result).toEqual({
      status: "RUNNING",
      prediction: null
    });
    expect(mockReq.write).toHaveBeenCalledWith("job_id=17893192007005534");
  });

  it("handles DDMut DONE status with completed prediction", async () => {
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
          job_id: "17893192007005534",
          prediction: "-0.45",
          chain: "A",
          mutant: "CYS",
          wild_type: "SER"
        }));
        mockRes.emit("end");
      });

      return mockReq;
    });

    const result = await pollBioSigJob("ddmut", "17893192007005534");
    expect(result).toEqual({
      status: "DONE",
      prediction: -0.45
    });
  });

  it("handles upstream ERROR status without falsely marking it as RUNNING", async () => {
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
          job_id: "17893192007005534",
          status: "ERROR",
          message: "Job failed: mutation residue out of chain bounds"
        }));
        mockRes.emit("end");
      });

      return mockReq;
    });

    const result = await pollBioSigJob("ddmut", "17893192007005534");
    expect(result).toEqual({
      status: "ERROR",
      prediction: null
    });
  });

  it("throws rate limit error when upstream returns HTTP 429", async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.write = vi.fn();
    mockReq.end = vi.fn();
    mockReq.destroy = vi.fn();

    vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 429;
      mockRes.setEncoding = vi.fn();

      process.nextTick(() => {
        callback(mockRes);
        mockRes.emit("data", "Rate limit exceeded");
        mockRes.emit("end");
      });

      return mockReq;
    });

    await expect(pollBioSigJob("ddmut", "17893192007005534")).rejects.toThrow("DDMut upstream rate limit reached");
  });

  it("handles DynaMut2 DONE status via query string polling with URL encoding", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: "DONE",
        job_id: 178931919574,
        prediction: -0.387,
        wild_type: "SER",
        mutant: "CYS"
      })
    } as any);

    try {
      const result = await pollBioSigJob("dynamut2", "178931919574");
      expect(result).toEqual({
        status: "DONE",
        prediction: -0.387
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single?job_id=178931919574"),
        expect.anything()
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects when response stream emits an error mid-stream", async () => {
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
        mockRes.emit("data", "partial-data");
        mockRes.emit("error", new Error("ECONNRESET"));
      });

      return mockReq;
    });

    await expect(httpGetWithBody("https://biosig.lab.uq.edu.au/test", "a=1", {}, 5000))
      .rejects.toThrow("ECONNRESET");
    expect(mockReq.destroy).toHaveBeenCalled();
  });

  it("rejects and destroys request when payload exceeds 5MB size limit", async () => {
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
        mockRes.emit("data", "x".repeat(6 * 1024 * 1024));
      });

      return mockReq;
    });

    await expect(httpGetWithBody("https://biosig.lab.uq.edu.au/test", "a=1", {}, 5000))
      .rejects.toThrow("BioSig response exceeded maximum allowed payload size (5MB)");
    expect(mockReq.destroy).toHaveBeenCalled();
  });

  it("rejects when request exceeds overall timeout deadline", async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.write = vi.fn();
    mockReq.end = vi.fn();
    mockReq.destroy = vi.fn();

    vi.spyOn(https, "request").mockImplementation((url: any, options: any, callback: any) => {
      return mockReq;
    });

    await expect(httpGetWithBody("https://biosig.lab.uq.edu.au/test", "a=1", {}, 50))
      .rejects.toThrow("BioSig request timed out after 50ms");
    expect(mockReq.destroy).toHaveBeenCalled();
  });

  it("cropPdbWindowAroundMutation crops large structures around target residue and keeps residue numbering", async () => {
    const { cropPdbWindowAroundMutation } = await import("./dynamut.ts");
    // Generate a synthetic PDB with 1600 residues
    const lines: string[] = ["HEADER    TEST"];
    for (let i = 1; i <= 1600; i++) {
      const resSeqStr = String(i).padStart(4, " ");
      lines.push(`ATOM   ${String(i).padStart(4, " ")}  CA  ALA A${resSeqStr}       1.000   1.000   1.000  1.00 20.00           C`);
    }
    lines.push("END");
    const syntheticPdb = lines.join("\n");

    const cropped = cropPdbWindowAroundMutation(syntheticPdb, "A", 408, 750);
    const caLines = cropped.match(/^ATOM\s+.*?CA\s+/gm) || [];
    expect(caLines.length).toBeLessThanOrEqual(751);
    expect(caLines.length).toBeGreaterThanOrEqual(700);

    // Verify target residue 408 is present in the cropped output
    expect(cropped).toContain("ALA A 408");
    expect(cropped).toContain("TER");
    expect(cropped).toContain("END");
  });

  it("cropPdbWindowAroundMutation handles blank chain whitespace in PDB line", async () => {
    const { cropPdbWindowAroundMutation } = await import("./dynamut.ts");
    const lines: string[] = ["HEADER    TEST_BLANK_CHAIN"];
    for (let i = 1; i <= 1600; i++) {
      const resSeqStr = String(i).padStart(4, " ");
      // Blank chain in column 22 (index 21)
      lines.push(`ATOM   ${String(i).padStart(4, " ")}  CA  ALA  ${resSeqStr}       1.000   1.000   1.000  1.00 20.00           C`);
    }
    lines.push("END");
    const syntheticPdb = lines.join("\n");

    const cropped = cropPdbWindowAroundMutation(syntheticPdb, "A", 408, 750);
    expect(cropped).toContain("ALA   408");
    const caLines = cropped.match(/^ATOM\s+.*?CA\s+/gm) || [];
    expect(caLines.length).toBeLessThanOrEqual(751);
    expect(caLines.length).toBeGreaterThanOrEqual(700);
  });

  it("cropPdbWindowAroundMutation returns original PDB if target residue is not found", async () => {
    const { cropPdbWindowAroundMutation } = await import("./dynamut.ts");
    const syntheticPdb = "HEADER TEST\nATOM      1  CA  ALA A   1       1.000   1.000   1.000  1.00 20.00           C\nEND";
    const cropped = cropPdbWindowAroundMutation(syntheticPdb, "A", 999, 750);
    expect(cropped).toBe(syntheticPdb);
  });
});

