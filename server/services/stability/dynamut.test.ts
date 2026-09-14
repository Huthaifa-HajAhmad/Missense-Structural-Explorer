import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollBioSigJob, httpGetWithBody } from "./dynamut.ts";
import https from "node:https";
import { EventEmitter } from "node:events";

describe("BioSig Polling Engine (server/services/dynamut.ts)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
