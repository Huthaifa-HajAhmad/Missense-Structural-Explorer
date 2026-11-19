import { describe, expect, it } from "vitest";
import { createVersionWatch, REJECTED_CHECK_GAP_MS } from "../appVersionWatch";

/**
 * A page keeps running the code it loaded until it is reloaded, so after a deploy it can talk to a
 * server that expects something else. The watch compares the server's revision now with the revision
 * the page first saw, and says when they differ.
 */
function watchWith(readings: Array<string | null | undefined>) {
  let clock = 0;
  let i = 0;
  const watch = createVersionWatch(async () => readings[Math.min(i++, readings.length - 1)], () => clock);
  return { watch, reads: () => i, advance: (ms: number) => { clock += ms; } };
}

describe("version watch", () => {
  it("treats the first reading as the version this page loaded with", async () => {
    const { watch } = watchWith(["aaa"]);
    await watch.check();
    expect(watch.isStale()).toBe(false);
  });

  it("stays quiet while the server's version is unchanged", async () => {
    const { watch } = watchWith(["aaa", "aaa", "aaa"]);
    await watch.check();
    await watch.check();
    await watch.check();
    expect(watch.isStale()).toBe(false);
  });

  it("says the page is out of date once the server's version differs, and tells subscribers once", async () => {
    const { watch } = watchWith(["aaa", "bbb", "ccc"]);
    const seen: boolean[] = [];
    watch.subscribe(stale => seen.push(stale));
    await watch.check();
    await watch.check();
    await watch.check();
    expect(watch.isStale()).toBe(true);
    expect(seen).toEqual([true]);
  });

  it("never says out of date when the server reports no version (a development server)", async () => {
    const { watch } = watchWith([null, null]);
    await watch.check();
    await watch.check();
    expect(watch.isStale()).toBe(false);
  });

  it("ignores a failed reading and keeps the version the page loaded with", async () => {
    const { watch } = watchWith(["aaa", undefined, "aaa"]);
    await watch.check();
    await watch.check();
    await watch.check();
    expect(watch.isStale()).toBe(false);
  });

  it("does not take a failed first reading as the loaded version", async () => {
    const { watch } = watchWith([undefined, "aaa", "bbb"]);
    await watch.check();
    await watch.check();
    expect(watch.isStale()).toBe(false);
    await watch.check();
    expect(watch.isStale()).toBe(true);
  });

  it("checks after a request the server refused as malformed, at most once per gap", async () => {
    const { watch, reads } = watchWith(["aaa", "bbb"]);
    await watch.check();
    watch.noteRejectedRequest(400);
    watch.noteRejectedRequest(422);
    await Promise.resolve();
    await Promise.resolve();
    expect(reads()).toBe(2);
    expect(watch.isStale()).toBe(true);

    const second = watchWith(["aaa", "aaa", "aaa"]);
    await second.watch.check();
    second.watch.noteRejectedRequest(400);
    await Promise.resolve();
    await Promise.resolve();
    expect(second.reads()).toBe(2);
    second.advance(REJECTED_CHECK_GAP_MS - 1);
    second.watch.noteRejectedRequest(400);
    await Promise.resolve();
    expect(second.reads()).toBe(2);
    second.advance(2);
    second.watch.noteRejectedRequest(400);
    await Promise.resolve();
    await Promise.resolve();
    expect(second.reads()).toBe(3);
  });

  it("does not check after other statuses: a missing resource or a server fault is not a version problem", async () => {
    const { watch, reads } = watchWith(["aaa", "bbb"]);
    await watch.check();
    for (const status of [200, 401, 403, 404, 429, 500, 503]) watch.noteRejectedRequest(status);
    await Promise.resolve();
    expect(reads()).toBe(1);
  });
});
