import { describe, expect, it, vi } from "vitest";
import { AgentHttpError } from "./client.ts";
import { deliverWithRetry } from "./deliver.ts";

const noWait = { waitsMs: [1, 1], sleep: async () => {} };

describe("delivering a finished job", () => {
  it("tries again after a network failure or a temporary server error", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new AgentHttpError(503, null, "busy"))
      .mockResolvedValueOnce({ accepted: true });
    await expect(deliverWithRetry(send, { stillOurs: () => true, ...noWait })).resolves.toEqual({ accepted: true });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("stops at a final answer, after the last try, or once the job is no longer ours", async () => {
    const refused = vi.fn().mockRejectedValue(new AgentHttpError(409, "LEASE_LOST", "not yours"));
    await expect(deliverWithRetry(refused, { stillOurs: () => true, ...noWait })).rejects.toMatchObject({ status: 409 });
    expect(refused).toHaveBeenCalledTimes(1);

    const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(deliverWithRetry(down, { stillOurs: () => true, ...noWait })).rejects.toThrow("fetch failed");
    expect(down).toHaveBeenCalledTimes(3);

    const lost = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(deliverWithRetry(lost, { stillOurs: () => false, ...noWait })).rejects.toThrow("fetch failed");
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
