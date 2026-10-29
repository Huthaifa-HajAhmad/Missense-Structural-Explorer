import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setCachedVariant,
  getCachedVariant,
  clearClientVariantCache,
  recordBiophysicsAttempt,
  getBiophysicsAttemptedAt,
  CACHE_VERSION,
  type CachedVariantBundle,
} from "../variantCache";

/**
 * The biophysics retry cooldown, and the store it lives in.
 *
 * WHY THIS EXISTS
 * ---------------
 * `workflowOrchestrator` records an attempt BEFORE dispatching a backfill, so an abort or a crash
 * still starts the cooldown rather than letting the next visit launch another multi-minute FoldX
 * run. Two separate defects made that intent useless, both found by measuring the shipped code
 * rather than reading it:
 *
 *   1. The timestamp was first kept in module memory only — the cache's persistence guard refuses
 *      failed/preliminary bundles, which is exactly the state that retries — so pressing F5
 *      discarded it.
 *   2. It was then written as a payload-free *bundle* record, which failed twice more: the only
 *      reader sits inside the cached-bundle branch such a record can never enter (so the cooldown
 *      was written and ignored), and `getCachedVariant` returned it as a truthy "cached variant",
 *      making four call sites skip `resetViewerState()` and leave the previous variant's structure
 *      on screen.
 *
 * So the cooldown now has its own store. These tests call the REAL reader and writer — the previous
 * version hand-copied the loader's predicate and would have passed against a `getCachedVariant` that
 * returned null for everything.
 */

function installSessionStorageShim(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

/** Keys of the persisted attempt records, so a rename of the prefix is caught. */
function attemptKeys(): string[] {
  return persistedKeys("mrx_attempt_");
}

/** Every persisted key under a prefix. */
function persistedKeys(prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

const FAILED_BUNDLE: Partial<CachedVariantBundle> = {
  foldingStatus: "failed",
  foldingEnergetics: { foldxError: "FoldX binary not found" } as never,
};

describe("biophysics attempt cooldown", () => {
  beforeEach(() => {
    installSessionStorageShim();
    clearClientVariantCache();
  });

  it("preserves a provisional FoldX snapshot for all cache consumers", () => {
    setCachedVariant("GATA4", "p.Ser159Cys", "P43694", {
      foldingStatus: "done",
      foldingEnergetics: { foldxMean: 0.5761, foldxRepairSkipped: true } as never
    });
    expect(getCachedVariant("GATA4", "p.Ser159Cys")?.foldingEnergetics?.foldxMean).toBe(0.5761);
  });

  it("reads back what it recorded, through the real reader", () => {
    recordBiophysicsAttempt("GENEA", "p.Ala1Val", "P00001");
    const at = getBiophysicsAttemptedAt("GENEA", "p.Ala1Val");
    expect(typeof at).toBe("number");
    expect(at).toBeGreaterThan(0);
  });

  it("persists under its own key, so it can outlive the session's memory", () => {
    recordBiophysicsAttempt("GENEB", "p.Ala1Val", "P00001");

    const keys = attemptKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(CACHE_VERSION);
    // ...and it is not stored as a bundle.
    expect(keys[0].startsWith("mrx_bundle_")).toBe(false);
  });

  it("writes no bundle record for a failed attempt, so a reload cannot mistake it for a variant", () => {
    // The regression: a payload-free bundle record made `getCachedVariant` truthy AFTER A RELOAD
    // (in memory it is truthy anyway — `setCachedVariant` writes memory before its guards), so
    // `if (!cached) resetViewerState()` was skipped and the previous variant's structure stayed on
    // screen until the new fetch landed. The invariant that prevents it is that nothing is
    // persisted under a bundle key.
    setCachedVariant("GENEC", "p.Ala1Val", "P00001", FAILED_BUNDLE);
    recordBiophysicsAttempt("GENEC", "p.Ala1Val", "P00001");

    expect(persistedKeys("mrx_bundle_")).toEqual([]);
    expect(attemptKeys()).toHaveLength(1);
  });

  it("still refuses to persist a failed bundle", () => {
    setCachedVariant("GENED", "p.Ala1Val", "P00001", FAILED_BUNDLE);
    expect(persistedKeys("mrx_bundle_")).toEqual([]);
  });

  it("does not disturb a good bundle for the same variant", () => {
    setCachedVariant("GENEE", "p.Ala1Val", "P00001", { foldingDdG: 1.2 });
    recordBiophysicsAttempt("GENEE", "p.Ala1Val", "P00001");

    const restored = getCachedVariant("GENEE", "p.Ala1Val");
    expect(restored?.foldingDdG).toBe(1.2);
    expect(getBiophysicsAttemptedAt("GENEE", "p.Ala1Val")).toBeGreaterThan(0);
  });

  it("keeps the cooldown independent per variant", () => {
    recordBiophysicsAttempt("GENEF", "p.Ala1Val", "P00001");
    expect(getBiophysicsAttemptedAt("GENEF", "p.Gly2Asp")).toBeNull();
    expect(getBiophysicsAttemptedAt("OTHERGENE", "p.Ala1Val")).toBeNull();
  });

  it("returns null when nothing has been recorded", () => {
    expect(getBiophysicsAttemptedAt("GENEG", "p.Ala1Val")).toBeNull();
  });

  it("still honours a timestamp written into a bundle by the previous release", () => {
    // Backwards compatibility: bundles persisted before the dedicated store existed carry the field.
    setCachedVariant("GENEH", "p.Ala1Val", "P00001", { foldingDdG: 1.2, biophysicsAttemptedAt: 1_700_000_000_000 });
    expect(getBiophysicsAttemptedAt("GENEH", "p.Ala1Val")).toBe(1_700_000_000_000);
  });
});

/**
 * The reload — which is the store's entire reason to exist.
 *
 * The tests above verify the WRITE. `getBiophysicsAttemptedAt` short-circuits on its in-memory map
 * before touching storage, so no test in this file ever reached the sessionStorage branch: a review
 * showed that a reader which never reads the store at all, or reads the wrong key prefix, passed every
 * one of them. The guarantee that actually matters — "pressing F5 does not re-dispatch the
 * multi-minute FoldX run" — was uncertified.
 *
 * A fresh module instance is a faithful reload: module memory is discarded while the storage shim
 * stands in for the browser's sessionStorage and persists. It also re-runs the module's own
 * `purgeLegacyCaches()` on import, so these two tests cover BOTH the reader and the purge allowlist —
 * a purge that deletes the attempt store makes the reloaded read return null, which is exactly the
 * defect a review found and the reason `ATTEMPT_PREFIX` is spared.
 */
describe("biophysics attempt cooldown — across a reload", () => {
  beforeEach(() => {
    installSessionStorageShim();
  });

  it("reads the persisted attempt after the module's memory is discarded", async () => {
    recordBiophysicsAttempt("RELOADA", "p.Ala1Val", "P00001");
    const written = getBiophysicsAttemptedAt("RELOADA", "p.Ala1Val");
    expect(typeof written).toBe("number");

    vi.resetModules();
    const reloaded = await import("../variantCache");

    /**
     * F14: the load-bearing assumption of the two reload tests, previously unasserted. If
     * `vi.resetModules()` were a no-op, or the dynamic import resolved to the cached instance, both
     * tests would pass while certifying nothing — the reader assertions would be satisfied by the very
     * module whose memory was supposed to have been discarded.
     */
    expect(
      reloaded.getBiophysicsAttemptedAt,
      "resetModules did not yield a fresh instance, so this test would certify nothing"
    ).not.toBe(getBiophysicsAttemptedAt);

    expect(
      reloaded.getBiophysicsAttemptedAt("RELOADA", "p.Ala1Val"),
      "the cooldown did not survive a reload — the next visit re-dispatches the full FoldX run"
    ).toBe(written);
  });

  it("survives a reload for a FAILED attempt, which is the case it exists for", async () => {
    // `setCachedVariant` refuses to persist a failed or preliminary bundle, so the cooldown must not
    // depend on one having been stored.
    setCachedVariant("RELOADB", "p.Ala1Val", "P00001", {
      foldingStatus: "failed",
      foldingEnergetics: { foldxError: "FoldX binary not found" } as never,
    });
    recordBiophysicsAttempt("RELOADB", "p.Ala1Val", "P00001");
    const written = getBiophysicsAttemptedAt("RELOADB", "p.Ala1Val");
    expect(typeof written).toBe("number");

    vi.resetModules();
    const reloaded = await import("../variantCache");

    /**
     * F14: the load-bearing assumption of the two reload tests, previously unasserted. If
     * `vi.resetModules()` were a no-op, or the dynamic import resolved to the cached instance, both
     * tests would pass while certifying nothing — the reader assertions would be satisfied by the very
     * module whose memory was supposed to have been discarded.
     */
    expect(
      reloaded.getBiophysicsAttemptedAt,
      "resetModules did not yield a fresh instance, so this test would certify nothing"
    ).not.toBe(getBiophysicsAttemptedAt);

    expect(reloaded.getBiophysicsAttemptedAt("RELOADB", "p.Ala1Val")).toBe(written);
    // ...and the failed bundle is still not persisted, before or after the reload.
    expect(reloaded.getCachedVariant("RELOADB", "p.Ala1Val")).toBeNull();
  });
});
