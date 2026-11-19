import { describe, it, expect, vi, afterEach } from "vitest";

// The queue's memory floor is 0 under NODE_ENV=test, so a reading below zero is what holds it here.
const freeRam = vi.hoisted(() => ({ bytes: -1 }));
vi.mock("./host-probe.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host-probe.ts")>()),
  freeRamBytes: () => freeRam.bytes,
}));

import { SQLiteQueue } from "./biophysical-queue.ts";

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const open: SQLiteQueue[] = [];
afterEach(() => {
  while (open.length) open.pop()!.shutdown();
  freeRam.bytes = -1;
});

describe("queue hold", () => {
  it("says it is held for memory while it cannot start jobs, and clears that once it can", async () => {
    const started: string[] = [];
    const q = new SQLiteQueue(":memory:", 2, async (_t, data) => { started.push(data.name); return "ok"; });
    open.push(q);
    await q.addJob("a", "foldx", { name: "a" }, { ownerId: "X" });
    await tick();
    expect(started).toEqual([]);
    expect(q.getHold()).toBe("memory");
    expect((await q.listFor("X"))[0].hold).toBe("memory");
    expect(q.holdFor("a")).toBe("memory");

    freeRam.bytes = 8 * 1024 ** 3;
    await tick(1_300);
    expect(started).toEqual(["a"]);
    expect(q.getHold()).toBeNull();
  });

  it("is not held, and does not warn, when there is nothing waiting to start", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const q = new SQLiteQueue(":memory:", 2, async () => "ok");
      open.push(q);
      await tick(1_300);
      expect(q.getHold()).toBeNull();
      expect(warn.mock.calls.some(([m]) => String(m).includes("High memory pressure"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it("gives a queued job the same position in the jobs list as in its own poll", async () => {
    freeRam.bytes = 8 * 1024 ** 3;
    const previous = process.env.BIOPHYSICAL_CONCURRENCY;
    process.env.BIOPHYSICAL_CONCURRENCY = "1";
    try {
      const release: Array<() => void> = [];
      const q = new SQLiteQueue(":memory:", 2, () => new Promise((resolve) => release.push(() => resolve("ok"))));
      open.push(q);
      await q.addJob("f1", "foldx", { name: "f1" }, { ownerId: "A" });
      await q.addJob("p1", "p2rank", { name: "p1" }, { ownerId: "B" });
      await tick();
      await q.addJob("f2", "foldx", { name: "f2" }, { ownerId: "X" });
      const listed = (await q.listFor("X")).find((j) => j.id === "f2")!;
      expect(listed.queuedAhead).toBe(q.getQueuePosition("f2"));
      expect(listed.queuedAhead).toBe(1);
      release.forEach((r) => r());
    } finally {
      if (previous === undefined) delete process.env.BIOPHYSICAL_CONCURRENCY;
      else process.env.BIOPHYSICAL_CONCURRENCY = previous;
    }
  });
});
