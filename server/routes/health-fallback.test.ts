import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import {
  FALLBACK_PROBE_HARD_CAP_MS,
  attachNotationFallback,
  currentFallbackVerdict,
  resetFallbackVerdictCacheForTests,
  type FallbackProbe,
} from "./health.ts";
import { apiRouter } from "../routes.ts";
import { adapterRegistry } from "../services/adapters/service-adapters.ts";
import type { HealthStatus } from "../services/adapters/types.ts";
import * as variantValidator from "../services/translation/variant-validator.ts";

/**
 * The fallback verdict is conditional, off the request path, and time-bounded. Each of those is
 * load-bearing, and each was previously either untested or asserted in a way that stayed green
 * with the behaviour deleted — so these cases are written to fail on removal, not merely on a
 * change of implementation.
 */

const health = (over: Partial<HealthStatus> = {}): HealthStatus => ({
  healthy: true,
  latencyMs: 12,
  message: "ok",
  timestamp: "2026-01-01T00:00:00.000Z",
  ...over,
});

type ProbeResult = Awaited<ReturnType<FallbackProbe>>;

const verdict = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  healthy: true,
  verdict: "ready",
  latencyMs: 800,
  message: "Resolved MACO1 probe",
  timestamp: "2026-01-01T00:00:01.000Z",
  ...over,
});

describe("attachNotationFallback", () => {
  it("does not attach a verdict when the primary is healthy", () => {
    const result = attachNotationFallback({ ensembl: health() }, { ...verdict(), ageMs: 0 });

    expect(result.ensembl.fallback).toBeUndefined();
  });

  it("attaches the verdict once the primary has failed", () => {
    const result = attachNotationFallback(
      { ensembl: health({ healthy: false, message: "timeout" }) },
      { ...verdict(), ageMs: 0 }
    );

    expect(result.ensembl.fallback).toMatchObject({
      id: "variant-validator",
      name: "VariantValidator",
      verdict: "ready",
      healthy: true,
      stale: false,
    });
    // The primary's own verdict must survive alongside the fallback.
    expect(result.ensembl.healthy).toBe(false);
    expect(result.ensembl.message).toBe("timeout");
  });

  it("marks a verdict older than the refresh window as stale", () => {
    const result = attachNotationFallback(
      { ensembl: health({ healthy: false }) },
      { ...verdict(), ageMs: 45_000 }
    );

    // Without this the rail presented an arbitrarily old verdict as current, so a fallback that
    // died while the panel was open kept reading "Fallback Ready".
    expect(result.ensembl.fallback?.stale).toBe(true);
    expect(result.ensembl.fallback?.ageMs).toBe(45_000);
  });

  it("records an uncovered outage when the fallback answered that it cannot serve", () => {
    const result = attachNotationFallback(
      { ensembl: health({ healthy: false }) },
      { ...verdict({ healthy: false, verdict: "unavailable" }), ageMs: 0 }
    );

    expect(result.ensembl.fallback?.verdict).toBe("unavailable");
    expect(result.ensembl.fallback?.healthy).toBe(false);
  });

  it("omits the fallback when no verdict is known yet", () => {
    const result = attachNotationFallback({ ensembl: health({ healthy: false }) }, null);

    expect(result.ensembl.fallback).toBeUndefined();
    expect(result.ensembl.healthy).toBe(false);
  });

  it("leaves the adapters' cached record untouched", () => {
    // `checkAllHealth` returns its cache entry by reference (15s TTL). Mutating it would bake the
    // fallback into that cache and keep showing it after Ensembl had recovered.
    const cached = { ensembl: health({ healthy: false }), clinvar: health() };

    const result = attachNotationFallback(cached, { ...verdict(), ageMs: 0 });

    expect(cached.ensembl.fallback).toBeUndefined();
    expect(cached.ensembl).not.toBe(result.ensembl);
    // `toEqual`, not `toBe`: the contract is that untouched entries are unchanged, not that they
    // are shared by reference. Asserting identity forbade a safer defensive-copy refactor.
    expect(result.clinvar).toEqual(cached.clinvar);
  });

  it("does not attach a fallback when the payload has no ensembl entry", () => {
    const result = attachNotationFallback({ clinvar: health() }, { ...verdict(), ageMs: 0 });

    expect(result.ensembl).toBeUndefined();
  });
});

describe("currentFallbackVerdict", () => {
  let probeSpy: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    resetFallbackVerdictCacheForTests();
    probeSpy = vi.spyOn(variantValidator, "checkVariantValidatorHealth");
  });

  afterEach(() => {
    probeSpy?.mockRestore();
    resetFallbackVerdictCacheForTests();
    vi.useRealTimers();
  });

  /** Lets the probe's `.then`/`.finally` run under fake timers. */
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it("returns immediately while the probe runs in the background", async () => {
    let release: (v: ProbeResult) => void = () => {};
    probeSpy.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    expect(currentFallbackVerdict()).toBeNull();
    expect(probeSpy).toHaveBeenCalledTimes(1);

    release(verdict());
    await settle();

    expect(currentFallbackVerdict()).toMatchObject({ verdict: "ready" });
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight probe across concurrent callers", () => {
    probeSpy.mockReturnValue(new Promise(() => {}));

    currentFallbackVerdict();
    currentFallbackVerdict();
    currentFallbackVerdict();

    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it("bounds the probe with a hard deadline, so a stalled body cannot leave it pending", () => {
    probeSpy.mockReturnValue(new Promise(() => {}));

    currentFallbackVerdict();

    // The transport timeout only covers time-to-headers, so the deadline has to come from here.
    const signal = probeSpy.mock.calls[0][0] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("recovers after a failing probe instead of wedging single-flight forever", async () => {
    // The previous version of this test asserted only null-because-nothing-was-stored, so
    // deleting the `.finally` that releases the in-flight slot kept every test green while the
    // server could never report coverage again for the lifetime of the process.
    probeSpy.mockRejectedValueOnce(new Error("ETIMEDOUT"));

    expect(currentFallbackVerdict()).toBeNull();
    await settle();

    probeSpy.mockResolvedValue(verdict());
    vi.setSystemTime(new Date("2026-01-01T00:00:21.000Z"));

    expect(currentFallbackVerdict()).toBeNull();
    expect(probeSpy).toHaveBeenCalledTimes(2);
    await settle();

    expect(currentFallbackVerdict()).toMatchObject({ verdict: "ready" });
  });

  it("refreshes a verdict once it passes the refresh window", async () => {
    probeSpy.mockResolvedValue(verdict());
    currentFallbackVerdict();
    await settle();

    // Still inside the window: served from cache, no second probe.
    vi.setSystemTime(new Date("2026-01-01T00:00:19.000Z"));
    expect(currentFallbackVerdict()).toMatchObject({ verdict: "ready" });
    expect(probeSpy).toHaveBeenCalledTimes(1);

    // Past the window: a refresh starts, and the still-current measurement is reported meanwhile.
    vi.setSystemTime(new Date("2026-01-01T00:00:21.000Z"));
    probeSpy.mockResolvedValue(verdict({ verdict: "unavailable", healthy: false, message: "gone" }));
    expect(currentFallbackVerdict()).toMatchObject({ verdict: "ready", ageMs: 21_000 });
    expect(probeSpy).toHaveBeenCalledTimes(2);
    await settle();
    expect(currentFallbackVerdict()).toMatchObject({ verdict: "unavailable" });
  });

  it("stops serving a verdict once it exceeds the maximum age", async () => {
    // Without this bound a ten-minute-old "healthy" verdict would still render as current
    // coverage during a total outage — the misleading clinical state this feature exists to remove.
    probeSpy.mockResolvedValue(verdict());
    currentFallbackVerdict();
    await settle();
    expect(currentFallbackVerdict()).toMatchObject({ verdict: "ready" });

    vi.setSystemTime(new Date("2026-01-01T00:03:01.000Z"));
    probeSpy.mockReturnValue(new Promise(() => {})); // the refresh never settles

    expect(currentFallbackVerdict()).toBeNull();
  });

  it("releases the single-flight slot when a probe outlives the watchdog", () => {
    probeSpy.mockReturnValue(new Promise(() => {}));

    currentFallbackVerdict();
    expect(probeSpy).toHaveBeenCalledTimes(1);

    // Well past the hard cap: the slot must be released rather than locking the feature forever.
    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    currentFallbackVerdict();

    expect(probeSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * Route-level pinning of the non-blocking claim.
 *
 * The helper tests above never exercise the wiring, so re-introducing `await
 * checkVariantValidatorHealth()` inside the handler kept every existing test green. This mounts
 * the real router and asserts the endpoint's latency with a probe that never settles.
 */
describe("GET /api/v1/diagnostics — coverage reporting does not block the endpoint", () => {
  let server: Server;
  let baseUrl: string;
  let probeSpy: any;
  let healthSpy: any;

  beforeEach(async () => {
    resetFallbackVerdictCacheForTests();
    healthSpy = vi.spyOn(adapterRegistry, "checkAllHealth").mockResolvedValue({
      ensembl: health({ healthy: false, message: "ping timed out" }),
    });
    probeSpy = vi
      .spyOn(variantValidator, "checkVariantValidatorHealth")
      .mockReturnValue(new Promise(() => {}));

    const app = express();
    app.use("/api/v1", apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    probeSpy?.mockRestore();
    healthSpy?.mockRestore();
    resetFallbackVerdictCacheForTests();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers promptly with a hanging probe, and omits the verdict rather than inventing one", async () => {
    const startedAt = Date.now();
    const res = await fetch(`${baseUrl}/api/v1/diagnostics`);
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    /**
     * "Promptly" means the request path is DECOUPLED from the probe, so the bound is derived from
     * the probe's own hard cap: waiting for it would take ~25s, answering must take a fraction of
     * that. A literal 2000ms here flaked at 2068ms on a loaded CI runner while the behaviour it
     * guards was correct — and a red CI now blocks deployment, so the margin has to be real.
     */
    expect(elapsed).toBeLessThan(FALLBACK_PROBE_HARD_CAP_MS / 5);
    expect(json.serviceHealth.ensembl.fallback).toBeUndefined();
    // The probe was still started — it simply was not waited on.
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not probe at all when the primary is healthy", async () => {
    healthSpy.mockResolvedValue({ ensembl: health() });

    const res = await fetch(`${baseUrl}/api/v1/diagnostics`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(probeSpy).not.toHaveBeenCalled();
    expect(json.serviceHealth.ensembl.fallback).toBeUndefined();
  });

  it("does not spend a probe when there is no ensembl entry to report on", async () => {
    healthSpy.mockResolvedValue({ clinvar: health() });

    const res = await fetch(`${baseUrl}/api/v1/diagnostics`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(probeSpy).not.toHaveBeenCalled();
    expect(json.serviceHealth.ensembl).toBeUndefined();
  });
});
