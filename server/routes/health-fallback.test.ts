import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  attachNotationFallback,
  currentFallbackVerdict,
  resetFallbackVerdictCache,
  type FallbackProbe,
} from "./health.ts";
import type { HealthStatus } from "../services/adapters/types.ts";
import * as variantValidator from "../services/translation/variant-validator.ts";

/**
 * The fallback verdict is conditional and, critically, off the request path: `/diagnostics` is a
 * general health poll, and awaiting an eleventh external probe on it made the endpoint
 * multi-second in exactly the outage it exists to describe. These tests pin both properties.
 */

const health = (over: Partial<HealthStatus> = {}): HealthStatus => ({
  healthy: true,
  latencyMs: 12,
  message: "ok",
  timestamp: "2026-01-01T00:00:00.000Z",
  ...over,
});

const verdict = (healthy: boolean) => ({
  healthy,
  latencyMs: 800,
  message: healthy ? "Resolved MACO1 probe" : "VariantValidator unreachable",
  timestamp: "2026-01-01T00:00:01.000Z",
});

describe("attachNotationFallback", () => {
  it("does not attach a verdict when the primary is healthy", () => {
    const result = attachNotationFallback({ ensembl: health() }, verdict(true));

    expect(result.ensembl.fallback).toBeUndefined();
  });

  it("attaches the verdict once the primary has failed", () => {
    const result = attachNotationFallback(
      { ensembl: health({ healthy: false, message: "timeout" }) },
      verdict(true)
    );

    expect(result.ensembl.fallback).toMatchObject({
      id: "variant-validator",
      name: "VariantValidator",
      healthy: true,
    });
    // The primary's own verdict must survive alongside the fallback.
    expect(result.ensembl.healthy).toBe(false);
    expect(result.ensembl.message).toBe("timeout");
  });

  it("records an uncovered outage when the fallback is down too", () => {
    const result = attachNotationFallback({ ensembl: health({ healthy: false }) }, verdict(false));

    expect(result.ensembl.fallback?.healthy).toBe(false);
  });

  it("omits the fallback when no verdict is known yet", () => {
    // The first poll after an outage lands here; the client issues one follow-up fetch for it.
    const result = attachNotationFallback({ ensembl: health({ healthy: false }) }, null);

    expect(result.ensembl.fallback).toBeUndefined();
    expect(result.ensembl.healthy).toBe(false);
  });

  it("leaves the adapters' cached record untouched", () => {
    // `checkAllHealth` returns its cache entry by reference (15s TTL). Mutating it would bake
    // the fallback into that cache and keep showing it after Ensembl recovered.
    const cached = { ensembl: health({ healthy: false }), clinvar: health() };
    const cachedEnsembl = cached.ensembl;

    const result = attachNotationFallback(cached, verdict(true));

    expect(cachedEnsembl.fallback).toBeUndefined();
    expect(cached.ensembl).not.toBe(result.ensembl);
    // Untouched entries may be shared; only the affected one is replaced.
    expect(result.clinvar).toBe(cached.clinvar);
  });

  it("does not attach a fallback when the payload has no ensembl entry", () => {
    const result = attachNotationFallback({ clinvar: health() }, verdict(true));

    expect(result.ensembl).toBeUndefined();
  });
});

describe("currentFallbackVerdict", () => {
  let probeSpy: any;

  beforeEach(() => {
    resetFallbackVerdictCache();
    probeSpy = vi.spyOn(variantValidator, "checkVariantValidatorHealth");
  });

  afterEach(() => {
    probeSpy?.mockRestore();
    resetFallbackVerdictCache();
  });

  it("returns immediately while the probe runs in the background", async () => {
    let release: (v: any) => void = () => {};
    probeSpy.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    // Must not return a promise: an awaited probe is what made the endpoint slow.
    const first = currentFallbackVerdict();
    expect(first).toBeNull();
    expect(probeSpy).toHaveBeenCalledTimes(1);

    release(verdict(true));
    await Promise.resolve();
    await Promise.resolve();

    expect(currentFallbackVerdict()).toMatchObject({ healthy: true });
    // A cached verdict means no second probe.
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight probe across concurrent callers", () => {
    probeSpy.mockReturnValue(new Promise(() => {}));

    currentFallbackVerdict();
    currentFallbackVerdict();
    currentFallbackVerdict();

    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows a failing probe so the endpoint still answers", async () => {
    probeSpy.mockRejectedValue(new Error("ETIMEDOUT"));

    expect(currentFallbackVerdict()).toBeNull();
    await Promise.resolve();
    await Promise.resolve();

    expect(currentFallbackVerdict()).toBeNull();
  });
});
