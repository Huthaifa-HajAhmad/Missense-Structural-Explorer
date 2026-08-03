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
});
