// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CACHE_VERSION } from "../variantCache";

/**
 * F5. The purge's own claim was false.
 *
 * `purgeLegacyCaches()` returns immediately when `typeof window === "undefined"`, and it runs at MODULE
 * SCOPE on every import. The other test file for this module runs under `environment: node`, so that
 * guard was always true there and the purge body was UNREACHABLE — which meant a previous commit's
 * claim that "these two tests cover BOTH the reader and the purge allowlist" was wrong. The evidence was
 * consistent with the purge being untested: with the allowlist and without it, the attempt key survived
 * identically, and a mutation that stopped sparing `ATTEMPT_PREFIX` passed the entire suite.
 *
 * This file runs in jsdom, where the guard is false and the purge actually executes. It is separate
 * rather than a pragma on the existing file because that file installs its own `sessionStorage` shim for
 * the node environment, and switching its environment would put the shim and jsdom's own storage in
 * conflict for reasons that have nothing to do with what is being tested here.
 */
describe("purgeLegacyCaches (jsdom, where the purge actually runs)", () => {
  const bundleKey = `mrx_bundle_${CACHE_VERSION}_GENEX_p.Ala1Val`;
  const attemptKey = `mrx_attempt_${CACHE_VERSION}_GENEX_p.Ala1Val`;

  beforeEach(() => {
    window.sessionStorage.clear();
    // The purge runs at module scope, so a cached module instance would never re-run it.
    vi.resetModules();
  });

  it("purges legacy keys on import, and spares the bundle cache and the cooldown", async () => {
    const legacyAnalysis = "mre_analysis_GENEX_p.Ala1Val";
    const legacyMismatchedVersion = "mrx_bundle_v1.0_GENEX_p.Ala1Val";

    for (const key of [bundleKey, attemptKey, legacyAnalysis, legacyMismatchedVersion]) {
      window.sessionStorage.setItem(key, "present");
    }

    await import("../variantCache");

    expect(
      window.sessionStorage.getItem(legacyAnalysis),
      "a legacy analysis key must be purged on load"
    ).toBeNull();
    expect(
      window.sessionStorage.getItem(legacyMismatchedVersion),
      "a bundle from an older cache version must be purged"
    ).toBeNull();

    expect(
      window.sessionStorage.getItem(bundleKey),
      "the current bundle cache must survive its own purge"
    ).toBe("present");
    expect(
      window.sessionStorage.getItem(attemptKey),
      "the cooldown store must survive the reload it exists to survive — deleting it re-burns the FoldX run it prevents"
    ).toBe("present");
  });

  it("is a no-op when there is nothing legacy to remove", async () => {
    window.sessionStorage.setItem(bundleKey, "present");

    await import("../variantCache");

    expect(window.sessionStorage.getItem(bundleKey)).toBe("present");
    expect(window.sessionStorage.length).toBe(1);
  });
});
