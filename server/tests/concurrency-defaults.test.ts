import { describe, it, expect, afterEach, vi } from "vitest";
import os from "os";
import { resolveBiophysicalConcurrency, resolveFoldxConcurrency } from "../config.ts";

/**
 * The queue and FoldX limits on the production shape (2 cores). A single shared `min(4, cpus - 1)`
 * made the queue run ONE job at a time there, so P2Rank (which does not take the FoldX semaphore)
 * waited behind every FoldX run. Pinned so it cannot come back.
 */
const saved = process.env.BIOPHYSICAL_CONCURRENCY;
afterEach(() => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.BIOPHYSICAL_CONCURRENCY;
  else process.env.BIOPHYSICAL_CONCURRENCY = saved;
});

const cores = (n: number) => vi.spyOn(os, "cpus").mockReturnValue(new Array(n).fill({}) as any);

describe("biophysical concurrency defaults", () => {
  it("2-core host, nothing set: queue 4, FoldX 1 (as before WP-B)", () => {
    delete process.env.BIOPHYSICAL_CONCURRENCY;
    cores(2);
    expect(resolveBiophysicalConcurrency()).toBe(4);
    expect(resolveFoldxConcurrency()).toBe(1);
  });

  it("FoldX never exceeds the queue bound", () => {
    delete process.env.BIOPHYSICAL_CONCURRENCY;
    cores(16);
    expect(resolveFoldxConcurrency()).toBe(4);
  });

  it("an explicit BIOPHYSICAL_CONCURRENCY sets both", () => {
    process.env.BIOPHYSICAL_CONCURRENCY = "3";
    cores(2);
    expect(resolveBiophysicalConcurrency()).toBe(3);
    expect(resolveFoldxConcurrency()).toBe(3);
  });

  it("a nonsense value falls back to the defaults", () => {
    process.env.BIOPHYSICAL_CONCURRENCY = "lots";
    cores(2);
    expect(resolveBiophysicalConcurrency()).toBe(4);
    expect(resolveFoldxConcurrency()).toBe(1);
  });
});
