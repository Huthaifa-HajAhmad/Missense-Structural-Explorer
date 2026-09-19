import { describe, it, expect } from "vitest";
import {
  RASP_INDEX_SCHEMA_VERSION,
  verifyRaspIndex,
  type RaspIndexMeta,
} from "../raspIndex.ts";

/**
 * The rule that distinguishes a complete RaSP index from a truncated one.
 *
 * This was the whole defect: the loader asked "does this file have at least one row?", which the
 * truncated 6-protein prefix answered exactly like the complete 1,345-protein index. Every check
 * below is a way a plausible-looking-but-wrong index must be rejected.
 */

const agreeingMeta = (rows: number, proteins: number): RaspIndexMeta => ({
  schemaVersion: RASP_INDEX_SCHEMA_VERSION,
  rows,
  proteins,
  builtAt: "2026-09-19T00:00:00.000Z",
});

describe("verifyRaspIndex", () => {
  it("accepts an index whose record agrees with its contents", () => {
    const verdict = verifyRaspIndex({ rows: 8_331_709, proteins: 1345 }, agreeingMeta(8_331_709, 1345));
    expect(verdict.usable).toBe(true);
    expect(verdict.rows).toBe(8_331_709);
    expect(verdict.proteins).toBe(1345);
    expect(verdict.reason).toBeUndefined();
  });

  it("rejects an index with no completeness record — the shipped truncated case", () => {
    // This is precisely the failure that went unnoticed: 35,000 rows of a 8.77 M-row dataset, with
    // nothing to compare against.
    const verdict = verifyRaspIndex({ rows: 35_000, proteins: 6 }, null);
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/no completeness record/);
    expect(verdict.rows).toBe(35_000);
  });

  it("rejects an index that contradicts its own record", () => {
    // A truncated or partially-written file: the record says one thing, the table says another.
    const verdict = verifyRaspIndex({ rows: 35_000, proteins: 6 }, agreeingMeta(8_331_709, 1345));
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/truncated or corrupted/);
    // The reason names both numbers, so a log line is diagnosable without a query.
    expect(verdict.reason).toContain("8331709");
    expect(verdict.reason).toContain("35000");
  });

  it("rejects an index built by a different schema version", () => {
    const verdict = verifyRaspIndex(
      { rows: 10, proteins: 2 },
      { ...agreeingMeta(10, 2), schemaVersion: RASP_INDEX_SCHEMA_VERSION - 1 }
    );
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/schema v1 .* expects v2/);
  });

  it("rejects an empty index", () => {
    const verdict = verifyRaspIndex({ rows: 0, proteins: 0 }, agreeingMeta(0, 0));
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/no rows/);
  });

  it("rejects an index that claims rows but no proteins", () => {
    // Defensive: a corrupt table where the distinct-protein count collapses to zero.
    const verdict = verifyRaspIndex({ rows: 100, proteins: 0 }, null);
    expect(verdict.usable).toBe(false);
  });
});
