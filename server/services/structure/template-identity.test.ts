import { describe, expect, it } from "vitest";
import { formatTemplateDifference, templateSequenceDifferences } from "./template-identity.ts";

/**
 * The wild-type gate rests on this comparison, so its two risky inputs are pinned here: the SEQADV
 * columns (a mutation's own reason, keyed by the DATABASE residue number) and the residue reading of
 * a modified residue / insertion code / out-of-range number.
 */

const atom = (resSeq: number, resName: string, chain = "A", iCode = " ") =>
  `ATOM      1  CA  ${resName} ${chain}${String(resSeq).padStart(4)}${iCode}      1.000   2.000   3.000  1.00 20.00           C`;

/** UniProt P06132 positions 1-100, with D at 86 and M at 10. */
const sequence = "AAAAAAAAAM" + "A".repeat(75) + "DA" + "A".repeat(13);

describe("templateSequenceDifferences", () => {
  it("reads the engineered mutation and its reason from SEQADV", () => {
    const pdb = [
      "SEQADV 1R3S GLY A   86  UNP  P06132    ASP    86 ENGINEERED MUTATION",
      atom(86, "GLY"),
    ].join("\n");

    const differences = templateSequenceDifferences(pdb, "A", sequence);

    expect(differences).toEqual([{ pos: 86, wt: "D", found: "G", kind: "engineered mutation" }]);
    expect(differences.map(formatTemplateDifference)).toEqual(["D86G (engineered mutation)"]);
  });

  it("prints a difference without a reason when the entry gives none", () => {
    const differences = templateSequenceDifferences(atom(86, "GLY"), "A", sequence);
    expect(differences).toEqual([{ pos: 86, wt: "D", found: "G", kind: null }]);
    expect(formatTemplateDifference(differences[0])).toBe("D86G");
  });

  it("reads a modified residue as its parent, so MSE is Met and not a mutation", () => {
    const pdb = [atom(10, "MSE"), atom(86, "ASP")].join("\n");
    expect(templateSequenceDifferences(pdb, "A", sequence)).toEqual([]);
  });

  it("skips an insertion-coded residue and one outside the sequence, which have no UniProt position", () => {
    const pdb = [atom(20, "GLY", "A", "A"), atom(101, "GLY")].join("\n");
    expect(templateSequenceDifferences(pdb, "A", sequence)).toEqual([]);
  });

  it("ignores another chain's atoms", () => {
    const pdb = [atom(86, "GLY", "B"), atom(86, "ASP", "A")].join("\n");
    expect(templateSequenceDifferences(pdb, "A", sequence)).toEqual([]);
  });
});
