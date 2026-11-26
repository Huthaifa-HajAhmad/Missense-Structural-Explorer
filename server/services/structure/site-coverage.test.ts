import { describe, it, expect } from "vitest";
import { chainCounts, entryModelsSite, rowsModellingSite } from "./site-coverage.ts";
import type { ResidueCoverage } from "../external-api/pdbe-coverage.ts";

// Observed ranges of PDBe's best chain, as around ABCG1's unresolved linker (348-396).
const coverage: ResidueCoverage = {
  length: 678,
  entries: new Map([
    ["7r8d", [[100, 347], [397, 678]]],
    ["1one", [[100, 347]]],
  ]),
};
const rows = [
  { pdb_id: "7r8d", chain_id: "A" }, { pdb_id: "7r8d", chain_id: "B" },
  { pdb_id: "1one", chain_id: "A" },
  { pdb_id: "9unk", chain_id: "A" },
];

describe("chainCounts", () => {
  it("counts each entry's distinct chains, whatever the case of its id", () => {
    expect(chainCounts([...rows, { pdb_id: "7R8D", chain_id: "A" }])).toEqual(new Map([["7r8d", 2], ["1one", 1], ["9unk", 1]]));
  });
});

describe("entryModelsSite", () => {
  it("is true where PDBe's best chain has coordinates", () => {
    expect(entryModelsSite(coverage, "7R8D", 200, 2)).toBe(true);
  });

  it("is false where the only chain has none, even next to the gap", () => {
    expect(entryModelsSite(coverage, "1one", 350, 1)).toBe(false);
  });

  // PDBe reports one chain per entry; another copy can resolve a few residues more at a gap's edge.
  it("cannot say at the edge of a gap when the entry holds more copies of the chain", () => {
    expect(entryModelsSite(coverage, "7r8d", 352, 2)).toBeUndefined();
    expect(entryModelsSite(coverage, "7r8d", 392, 2)).toBeUndefined();
  });

  it("is false deeper inside a gap, however many copies there are", () => {
    expect(entryModelsSite(coverage, "7r8d", 353, 2)).toBe(false);
    expect(entryModelsSite(coverage, "7r8d", 358, 2)).toBe(false);
  });

  it("cannot say for an entry PDBe did not list", () => {
    expect(entryModelsSite(coverage, "9unk", 358, 1)).toBeUndefined();
  });
});

describe("rowsModellingSite", () => {
  const kept = (position: number) => rowsModellingSite(rows, coverage, position).map(r => `${r.pdb_id}:${r.chain_id}`);

  it("drops only the rows PDBe's coverage rules out", () => {
    expect(kept(358)).toEqual(["9unk:A"]);
    expect(kept(350)).toEqual(["7r8d:A", "7r8d:B", "9unk:A"]);
  });
});
