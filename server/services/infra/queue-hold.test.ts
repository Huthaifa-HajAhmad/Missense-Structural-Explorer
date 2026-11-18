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

    freeRam.bytes = 8 * 1024 ** 3;
    await tick(1_300);
    expect(started).toEqual(["a"]);
    expect(q.getHold()).toBeNull();
  });
});
