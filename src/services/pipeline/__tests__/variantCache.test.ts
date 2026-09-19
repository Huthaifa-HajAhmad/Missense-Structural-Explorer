import { describe, it, expect, beforeEach } from "vitest";
import {
  setCachedVariant,
  clearClientVariantCache,
  CACHE_VERSION,
  type CachedVariantBundle,
} from "../variantCache";

/**
 * The biophysics retry cooldown must survive a page reload.
 *
 * WHY THIS EXISTS
 * ---------------
 * `workflowOrchestrator` records `biophysicsAttemptedAt` before dispatching a backfill, so that an
 * abort or a crash still starts the cooldown rather than letting the next visit launch another
 * multi-minute FoldX run. But it records it through `setCachedVariant`, whose persistence filter
 * deliberately refuses to store a failed or still-partial bundle — which is exactly the state that
 * triggers a retry. So the timestamp reached module memory only, and the single most likely user
 * action (giving up on the spinner and pressing F5) discarded it: memory is gone, sessionStorage has
 * no record of the attempt, `retryCooldownElapsed` reads `undefined` as "elapsed", and the full run
 * is dispatched again. That is the compute burn the cooldown was written to prevent.
 *
 * The guarantee was never asserted, which is why nothing failed.
 */

/** Every persisted entry, so the tests can inspect what actually reached sessionStorage. */
function persistedEntries(): Array<{ key: string; value: Record<string, unknown> }> {
  const entries: Array<{ key: string; value: Record<string, unknown> }> = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key) continue;
    try {
      entries.push({ key, value: JSON.parse(sessionStorage.getItem(key) ?? "{}") });
    } catch {
      // A non-JSON entry belongs to another part of the app; ignore it.
    }
  }
  return entries;
}

function persistedFor(gene: string): Record<string, unknown> | null {
  const hit = persistedEntries().find(e => e.value.gene === gene);
  return hit ? hit.value : null;
}

/**
 * A minimal in-memory `sessionStorage`.
 *
 * This suite runs in the node environment (component tests get jsdom), where the global does not
 * exist — and `variantCache` guards its storage access with try/catch, so without a shim every
 * assertion would pass vacuously against a no-op. The module resolves `sessionStorage` from the
 * global scope at call time, so installing this exercises the real code path.
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

describe("variantCache — the biophysics attempt timestamp", () => {
  beforeEach(() => {
    installSessionStorageShim();
    clearClientVariantCache();
    sessionStorage.clear();
  });

  const FAILED_BUNDLE: Partial<CachedVariantBundle> = {
    foldingStatus: "failed",
    foldingEnergetics: { foldxError: "FoldX binary not found" } as never,
  };

  it("still refuses to persist a failed bundle", () => {
    // The behaviour the new option must not weaken.
    setCachedVariant("GENEA", "p.Ala1Val", "P00001", FAILED_BUNDLE);
    const stored = persistedFor("GENEA");
    expect(stored?.foldingStatus).toBeUndefined();
    expect(stored?.foldingEnergetics).toBeUndefined();
  });

  it("persists the attempt timestamp for a failed bundle when asked", () => {
    setCachedVariant(
      "GENEB",
      "p.Ala1Val",
      "P00001",
      { ...FAILED_BUNDLE, biophysicsAttemptedAt: 1_700_000_000_000 },
      { persistAttemptTimestamp: true }
    );

    const stored = persistedFor("GENEB");
    expect(stored).not.toBeNull();
    expect(stored!.biophysicsAttemptedAt).toBe(1_700_000_000_000);
    // ...and ONLY the cooldown metadata: the failure itself must not be persisted by this path.
    expect(stored!.foldingStatus).toBeUndefined();
    expect(stored!.foldingEnergetics).toBeUndefined();
  });

  it("writes a record the loader will accept after a reload", () => {
    setCachedVariant(
      "GENEC",
      "p.Ala1Val",
      "P00001",
      { ...FAILED_BUNDLE, biophysicsAttemptedAt: 1_700_000_000_000 },
      { persistAttemptTimestamp: true }
    );

    // A direct "reload" cannot be simulated: the only reset export, `clearClientVariantCache()`,
    // clears sessionStorage as well as memory — so it would destroy the record under test. Instead
    // the stored record is checked against the exact predicate `getCachedVariant` applies before it
    // will hand an entry back: version match, a `timestamp` within 24h, and the field itself.
    const stored = persistedFor("GENEC");
    expect(stored).not.toBeNull();
    expect(stored!.version).toBe(CACHE_VERSION);
    expect(typeof stored!.timestamp).toBe("number");
    expect(Date.now() - (stored!.timestamp as number)).toBeLessThan(24 * 60 * 60 * 1000);
    expect(stored!.biophysicsAttemptedAt).toBe(1_700_000_000_000);
  });

  it("does not invent a timestamp when none was supplied", () => {
    setCachedVariant("GENED", "p.Ala1Val", "P00001", FAILED_BUNDLE, {
      persistAttemptTimestamp: true,
    });
    expect(persistedFor("GENED")).toBeNull();
  });

  it("merges into an existing record rather than replacing it", () => {
    // A successful run is persisted normally...
    setCachedVariant("GENEE", "p.Ala1Val", "P00001", { foldingDdG: 1.2 });
    expect(persistedFor("GENEE")?.foldingDdG).toBe(1.2);

    // ...and a later failed attempt adds only the cooldown, keeping the good data.
    setCachedVariant(
      "GENEE",
      "p.Ala1Val",
      "P00001",
      { ...FAILED_BUNDLE, biophysicsAttemptedAt: 42 },
      { persistAttemptTimestamp: true }
    );

    const stored = persistedFor("GENEE");
    expect(stored?.foldingDdG).toBe(1.2);
    expect(stored?.biophysicsAttemptedAt).toBe(42);
    expect(stored?.foldingStatus).toBeUndefined();
  });
});
