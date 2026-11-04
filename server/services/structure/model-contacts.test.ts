import { describe, it, expect } from "vitest";
import { INTERFACE_CONTACT_CUTOFF, MAX_MODEL_ATOMS, interfaceContactsFromPdb } from "./model-contacts.ts";

/**
 * Interface contacts read off a model the reader brought back from LocalFold.
 *
 * What matters: a contact is a residue pair with any heavy-atom pair inside the cutoff, measured at
 * the closest atoms; chain A is the variant's chain and only its partners make contacts; and a file
 * that cannot answer the question (mmCIF, one chain, no coordinates) is refused by name instead of
 * reading as "no contacts at the variant".
 */

function atom(
  serial: number,
  name: string,
  resName: string,
  chain: string,
  resSeq: number,
  x: number,
  y: number,
  z: number,
  element: string,
  record = "ATOM"
): string {
  return `${record.padEnd(6)}${String(serial).padStart(5)} ${name.padStart(4)} ${resName.padStart(3)} ${chain}${String(resSeq).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 90.00          ${element.padStart(2)}`;
}

/** A two-chain model: residue 116 of A beside residue 40 of B, at `distance` Å along x. */
function twoChains(distance: number, { partnerChain = "B" } = {}): string {
  return [
    atom(1, "CA", "ASP", "A", 116, 0, 0, 0, "C"),
    atom(2, "CA", "ALA", partnerChain, 40, distance, 0, 0, "C"),
  ].join("\n");
}

describe("interfaceContactsFromPdb", () => {
  it("reads a contact at the closest heavy-atom pair, within 4.5 Å", () => {
    const read = interfaceContactsFromPdb(twoChains(3.1));
    expect(read.chainIds).toEqual(["A", "B"]);
    expect(read.contacts).toEqual([{ resA: 116, resB: 40, distance: 3.1 }]);
    expect(read.residuesByChain).toEqual({ A: [116], B: [40] });
  });

  it("is not a contact past the cutoff", () => {
    expect(interfaceContactsFromPdb(twoChains(INTERFACE_CONTACT_CUTOFF + 0.1)).contacts).toEqual([]);
    expect(interfaceContactsFromPdb(twoChains(4.4)).contacts).toHaveLength(1);
  });

  it("keeps the nearest atom pair for a residue pair rather than the first one read", () => {
    const pdb = [
      atom(1, "CA", "ASP", "A", 116, 0, 0, 0, "C"),
      atom(2, "CB", "ASP", "A", 116, 3.5, 0, 0, "C"),
      atom(3, "CA", "ALA", "B", 40, 4.4, 0, 0, "C"),
    ].join("\n");
    expect(interfaceContactsFromPdb(pdb).contacts).toEqual([{ resA: 116, resB: 40, distance: 0.9 }]);
  });

  it("never counts a residue against its own chain", () => {
    const pdb = [
      atom(1, "CA", "ASP", "A", 116, 0, 0, 0, "C"),
      atom(2, "CA", "GLY", "A", 117, 3, 0, 0, "C"),
    ].join("\n");
    // Chain A alone reads as no contact rather than as a residue contacting itself; the caller decides
    // whether a one-chain file can answer the question it was asked.
    const read = interfaceContactsFromPdb(pdb);
    expect(read.chainIds).toEqual(["A"]);
    expect(read.contacts).toEqual([]);
  });

  it("leaves ligands and hydrogens out", () => {
    const pdb = [
      atom(1, "CA", "ASP", "A", 116, 0, 0, 0, "C"),
      atom(2, "CA", "ALA", "B", 40, 9, 0, 0, "C"),
      atom(3, "C1", "GOL", "C", 1, 0, 0, 1, "C", "HETATM"),
      atom(4, "H", "ALA", "B", 40, 0, 0, 1, "H"),
    ].join("\n");
    const read = interfaceContactsFromPdb(pdb);
    expect(read.chainIds).toEqual(["A", "B"]);
    expect(read.contacts).toEqual([]);
  });

  it("refuses a file that is mmCIF rather than reading it as an empty interface", () => {
    expect(() => interfaceContactsFromPdb("data_test\n#\nATOM 1 N MET A 1 1.0 2.0 3.0\n")).toThrow(/mmCIF/);
  });

  it("refuses a file with no coordinates", () => {
    expect(() => interfaceContactsFromPdb("REMARK nothing here\n")).toThrow(/no protein coordinates/);
  });

  it("refuses a model whose chain A is missing", () => {
    expect(() => interfaceContactsFromPdb(atom(1, "CA", "ALA", "B", 40, 0, 0, 0, "C"))).toThrow(/no chain A/);
  });

  it("keeps the three-letter name of every residue, so a construct can be checked", () => {
    const read = interfaceContactsFromPdb(twoChains(3.1));
    expect(read.residueNames.A[116]).toBe("ASP");
    expect(read.residueNames.B[40]).toBe("ALA");
  });

  it("accepts a third chain here — refusing the wrong complex is the caller's job, which knows the plan", () => {
    const pdb = [
      atom(1, "CA", "ASP", "A", 116, 0, 0, 0, "C"),
      atom(2, "CA", "ALA", "B", 40, 9, 0, 0, "C"),
      atom(3, "CA", "ALA", "C", 40, 0, 9, 0, "C"),
    ].join("\n");
    const read = interfaceContactsFromPdb(pdb);
    expect(read.chainIds).toEqual(["A", "B", "C"]);
    expect(read.contacts).toEqual([]);
  });

  it("says ATOM records carry no chain identifier rather than 'no coordinates'", () => {
    const pdb = [
      atom(1, "CA", "ASP", " ", 116, 0, 0, 0, "C"),
      atom(2, "CA", "ALA", " ", 40, 3, 0, 0, "C"),
    ].join("\n");
    expect(() => interfaceContactsFromPdb(pdb)).toThrow(/no chain identifier/);
  });

  it("refuses a file past the atom bound instead of spending minutes on it", () => {
    const lines = Array.from({ length: MAX_MODEL_ATOMS + 1 }, (_, i) =>
      atom(i + 1, "CA", "ALA", "A", 1, i, 0, 0, "C"));
    expect(() => interfaceContactsFromPdb(lines.join("\n"))).toThrow(/takes up to/);
  });

  it("stops a superimposed coordinate set inside the scan, not after it", () => {
    // Every atom in one cell: the result caps bound memory, so the work needs its own bound. Without
    // the in-loop check this file takes minutes and blocks every other request.
    const lines: string[] = [];
    for (let i = 1; i <= 16_000; i += 1) {
      lines.push(atom(i, "CA", "ALA", i % 2 === 0 ? "A" : "B", 1 + (i % 3), 0, 0, 0, "C"));
    }
    const started = Date.now();
    expect(() => interfaceContactsFromPdb(lines.join("\n"))).toThrow(/superimposed/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
