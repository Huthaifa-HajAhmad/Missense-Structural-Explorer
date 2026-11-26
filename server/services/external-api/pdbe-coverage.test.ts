import { describe, it, expect } from "vitest";
import { entriesModelling, parseUnipdbCoverage, unmodelledStretches } from "./pdbe-coverage.ts";

// PDBe unipdb/P45844, read 2026-11-26: the observed ranges of two of ABCG1's five entries (best chain).
const ABCG1_UNIPDB = {
  P45844: {
    length: 678,
    data: [
      {
        accession: "7oz1",
        residues: [
          { startIndex: 1, endIndex: 73, observed: "N" },
          { startIndex: 74, endIndex: 88, observed: "Y" },
          { startIndex: 89, endIndex: 95, observed: "N" },
          { startIndex: 96, endIndex: 345, observed: "Y" },
          { startIndex: 346, endIndex: 374, observed: "N" },
          { startIndex: 387, endIndex: 397, observed: "N" },
          { startIndex: 398, endIndex: 676, observed: "Y" },
          { startIndex: 677, endIndex: 678, observed: "N" },
          // A mutation row carries no `observed` flag and is not a range of coordinates.
          { startIndex: 242, endIndex: 242, mutation: true },
        ],
      },
      {
        accession: "7FDV",
        residues: [
          { startIndex: 72, endIndex: 87, observed: "Y" },
          { startIndex: 96, endIndex: 333, observed: "Y" },
          { startIndex: 334, endIndex: 400, observed: "N" },
          { startIndex: 401, endIndex: 675, observed: "Y" },
        ],
      },
    ],
  },
};

describe("PDBe residue coverage (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, C1)", () => {
  const coverage = parseUnipdbCoverage(ABCG1_UNIPDB, "P45844");

  it("reads observed ranges per entry, lower-case ids, ignoring unobserved and mutation rows", () => {
    expect(coverage.length).toBe(678);
    expect(coverage.entries.get("7oz1")).toEqual([[74, 88], [96, 345], [398, 676]]);
    expect(coverage.entries.get("7fdv")).toEqual([[72, 87], [96, 333], [401, 675]]);
  });

  it("finds no entry that models Gly358, and both model Leu300", () => {
    expect(entriesModelling(coverage, ["7oz1", "7fdv"], 358)).toEqual([]);
    expect(entriesModelling(coverage, ["7oz1", "7fdv"], 300)).toEqual(["7oz1", "7fdv"]);
  });

  it("keeps an entry PDBe did not list: no data is not 'not modelled'", () => {
    expect(entriesModelling(coverage, ["7oz1", "9xyz"], 358)).toEqual(["9xyz"]);
  });

  it("returns the stretches no entry of the pair models, the union of their gaps", () => {
    expect(unmodelledStretches(coverage, ["7oz1", "7fdv"])).toEqual([
      { start: 1, end: 71 },
      { start: 89, end: 95 },
      { start: 346, end: 397 },
      { start: 677, end: 678 },
    ]);
    expect(unmodelledStretches(coverage, ["9xyz"])).toEqual([]);
  });
});

// PDBe unipdb/P45844, read live 2026-11-26: the observed ranges of all five ABCG1 entries (unobserved rows only
// where the entry lists them). The synthetic two-entry payload above gives 346–397; this is the captured one.
const ABCG1_CAPTURED = (rows: Array<[string, Array<[number, number, "Y" | "N"]>]>) => ({
  P45844: { length: 678, data: rows.map(([accession, r]) => ({ accession, residues: r.map(([startIndex, endIndex, observed]) => ({ startIndex, endIndex, observed })) })) },
});

describe("PDBe residue coverage on the captured ABCG1 payload", () => {
  const coverage = parseUnipdbCoverage(ABCG1_CAPTURED([
    ["7r8d", [[1, 71, "N"], [72, 86, "Y"], [87, 99, "N"], [100, 347, "Y"], [348, 374, "N"], [387, 396, "N"], [397, 678, "Y"]]],
    ["7r8c", [[1, 71, "N"], [72, 86, "Y"], [87, 99, "N"], [100, 347, "Y"], [348, 374, "N"], [387, 396, "N"], [397, 678, "Y"]]],
    ["7fdv", [[1, 71, "N"], [72, 87, "Y"], [88, 95, "N"], [96, 333, "Y"], [334, 400, "N"], [401, 675, "Y"], [676, 678, "N"]]],
    ["7r8e", [[1, 71, "N"], [72, 88, "Y"], [89, 97, "N"], [98, 347, "Y"], [348, 374, "N"], [387, 397, "N"], [398, 678, "Y"]]],
    ["7oz1", [[1, 73, "N"], [74, 88, "Y"], [89, 95, "N"], [96, 345, "Y"], [346, 374, "N"], [387, 397, "N"], [398, 676, "Y"], [677, 678, "N"]]],
  ]), "P45844");
  const entries = ["7r8d", "7r8c", "7fdv", "7r8e", "7oz1"];

  it("finds that none of the five entries models Gly358, and that the stretch no entry resolves is 348–396", () => {
    expect(entriesModelling(coverage, entries, 358)).toEqual([]);
    expect(unmodelledStretches(coverage, entries).find(g => g.start <= 358 && 358 <= g.end)).toEqual({ start: 348, end: 396 });
  });
});
