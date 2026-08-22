import { describe, it, expect, vi } from "vitest";
import { submitDynaMut2Job, pollDynaMut2Job, submitDdmutJob, pollDdmutJob } from "./dynamut.ts";

describe("DynaMut & DDMut Service Unit Tests", () => {
  it("should handle submitDynaMut2Job success and failure", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job_id: "12345" })
    } as any);

    const jobId = await submitDynaMut2Job("DUMMY_PDB", "A", 10, "R", "W");
    expect(jobId).toBe("12345");

    fetchSpy.mockRestore();
  });

  it("should handle pollDynaMut2Job DONE status", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ prediction: "-0.426" })
    } as any);

    const res = await pollDynaMut2Job("12345");
    expect(res?.status).toBe("DONE");
    expect(res?.prediction).toBe(-0.426);

    fetchSpy.mockRestore();
  });

  it("should handle submitDdmutJob success", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job_id: "67890" })
    } as any);

    const jobId = await submitDdmutJob("DUMMY_PDB", "A", 10, "R", "W");
    expect(jobId).toBe("67890");

    fetchSpy.mockRestore();
  });

  it("should handle pollDdmutJob DONE status with numeric prediction", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ prediction: "-1.67", chain: "A", res_number: 461 })
    } as any);

    const res = await pollDdmutJob("67890");
    expect(res?.status).toBe("DONE");
    expect(res?.prediction).toBe(-1.67);

    fetchSpy.mockRestore();
  });

  it("should handle pollDdmutJob RUNNING status", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: "RUNNING" })
    } as any);

    const res = await pollDdmutJob("67890");
    expect(res?.status).toBe("RUNNING");
    expect(res?.prediction).toBeNull();

    fetchSpy.mockRestore();
  });

  it("should handle pollDdmutJob QUEUED / PENDING status", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "QUEUED" })
    } as any);

    const res = await pollDdmutJob("67890");
    expect(res?.status).toBe("RUNNING");
    expect(res?.prediction).toBeNull();

    fetchSpy.mockRestore();
  });

  it("should handle pollDdmutJob 429 upstream rate limiting", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers()
    } as any);

    await expect(pollDdmutJob("67890")).rejects.toThrow();

    fetchSpy.mockRestore();
  }, 15000);

  it("should handle pollDdmutJob upstream error status", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers()
    } as any);

    const res = await pollDdmutJob("67890");
    expect(res?.status).toBe("ERROR");
    expect(res?.prediction).toBeNull();

    fetchSpy.mockRestore();
  }, 15000);
});
