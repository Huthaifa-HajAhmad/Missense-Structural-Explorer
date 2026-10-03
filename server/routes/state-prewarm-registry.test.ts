import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { CONFIG } from "../config.ts";
import { PREWARM_CLAIM_TTL_MS, PREWARM_CLAIM_TTL_MARGIN_MS, inFlightPrewarms } from "./state.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE IN-FLIGHT PREWARM REGISTRY: ONE ATOMIC CLAIM, ONE OWNER, ONE DERIVED TTL
 * ─────────────────────────────────────────────────────────────────────────────
 * This registry is what stops one variant from running two FoldX jobs. Three properties carry that
 * job, and each of them was wrong before:
 *
 *   1. `add()` is the claim, and its return value is the mutual exclusion. `has()` is inspection
 *      only — a caller that checks `has()` and then calls `add()` has no exclusion at all.
 *   2. A claim can be released BY ITS OWNER only. Without a token, a caller whose claim had expired
 *      and been re-claimed would delete the new owner's claim, admitting a third job.
 *   3. The TTL must outlive the wait its holder is allowed to perform. It was a flat 30 minutes,
 *      exactly `foldxQueuedLeaseMs`, so a claim could expire while its job was still queued.
 */
describe("prewarm claim registry", () => {
  const KEY = `TEST_CLAIM_${crypto.randomUUID()}`;
  const OTHER_KEY = `TEST_CLAIM_${crypto.randomUUID()}`;

  afterEach(async () => {
    await inFlightPrewarms.delete(KEY);
    await inFlightPrewarms.delete(OTHER_KEY);
  });

  describe("TTL", () => {
    it("outlives the queue leases its holder waits on, with a margin", () => {
      const longestLegitimateWait = CONFIG.timeouts.foldxQueuedLeaseMs + CONFIG.timeouts.foldxReaperLeaseMs;
      expect(PREWARM_CLAIM_TTL_MS).toBe(longestLegitimateWait + PREWARM_CLAIM_TTL_MARGIN_MS);
      expect(PREWARM_CLAIM_TTL_MS).toBeGreaterThan(longestLegitimateWait);
      // The specific defect: the TTL used to EQUAL the queued lease, so a claim expired while its
      // job was still legitimately waiting for a worker slot.
      expect(PREWARM_CLAIM_TTL_MS).toBeGreaterThan(CONFIG.timeouts.foldxQueuedLeaseMs);
    });

    it("derives the TTL from CONFIG instead of a literal", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "server", "routes", "state.ts"), "utf-8");
      expect(
        /30 \* 60 \* 1000|1800 \* 1000|1_800_000/.test(source),
        "a hardcoded claim TTL is back; derive it from CONFIG.timeouts.foldx*"
      ).toBe(false);
      expect(source).toContain("CONFIG.timeouts.foldxQueuedLeaseMs + CONFIG.timeouts.foldxReaperLeaseMs");
      // Both backends must read the same constant, Redis in seconds.
      expect(source).toContain("Math.ceil(PREWARM_CLAIM_TTL_MS / 1000)");
    });
  });

  describe("owner-checked release", () => {
    it("admits one owner per key and refuses a second claim", async () => {
      expect(await inFlightPrewarms.add(KEY, "owner-1")).toBe(true);
      expect(await inFlightPrewarms.add(KEY, "owner-2")).toBe(false);
      expect(await inFlightPrewarms.has(KEY)).toBe(true);
    });

    it("does not let a stale owner release a claim that now belongs to someone else", async () => {
      await inFlightPrewarms.add(KEY, "owner-1");
      // owner-1's claim expired and owner-2 re-claimed the key (simulated by a direct re-add after
      // the first release, which is the only way the key can change hands).
      expect(await inFlightPrewarms.delete(KEY, "owner-2")).toBe(false);
      expect(await inFlightPrewarms.has(KEY), "a non-owner's release must not free the key").toBe(true);
      expect(await inFlightPrewarms.delete(KEY, "owner-1")).toBe(true);
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
    });

    it("keeps the tokenless API working for callers that never had a token", async () => {
      expect(await inFlightPrewarms.add(OTHER_KEY)).toBe(true);
      expect(await inFlightPrewarms.add(OTHER_KEY)).toBe(false);
      expect(await inFlightPrewarms.delete(OTHER_KEY)).toBe(true);
      expect(await inFlightPrewarms.has(OTHER_KEY)).toBe(false);
    });
  });

  /**
   * The in-memory fallback is what runs when the shared database cannot be opened or a write fails.
   * It is exercised through a fresh module instance whose database path is unusable, because the
   * fallback is otherwise unreachable from a test.
   */
  describe("in-memory fallback", () => {
    afterEach(() => {
      vi.resetModules();
    });

    it("claims with a single operation and releases by owner", async () => {
      const blocker = path.join(os.tmpdir(), `prewarm-db-blocker-${crypto.randomUUID()}`);
      fs.writeFileSync(blocker, "a file where a directory is needed");
      const previousPath = process.env.SHARED_STATE_DB_PATH;
      // The parent "directory" is a FILE, so the database cannot be created and the class falls back.
      process.env.SHARED_STATE_DB_PATH = path.join(blocker, "shared_state.sqlite");

      try {
        vi.resetModules();
        const fresh = await import("./state.ts");
        const registry = fresh.inFlightPrewarms;
        const hasSpy = vi.spyOn(registry, "has");

        expect(await registry.add("MEM_KEY", "owner-1")).toBe(true);
        expect(
          hasSpy,
          "the fallback must decide with one atomic operation, not has() then add()"
        ).not.toHaveBeenCalled();
        expect(await registry.add("MEM_KEY", "owner-2")).toBe(false);
        expect(await registry.delete("MEM_KEY", "owner-2")).toBe(false);
        expect(await registry.has("MEM_KEY")).toBe(true);
        expect(await registry.delete("MEM_KEY", "owner-1")).toBe(true);
        expect(await registry.has("MEM_KEY")).toBe(false);
      } finally {
        if (previousPath === undefined) delete process.env.SHARED_STATE_DB_PATH;
        else process.env.SHARED_STATE_DB_PATH = previousPath;
        fs.rmSync(blocker, { force: true });
      }
    });
  });
});
