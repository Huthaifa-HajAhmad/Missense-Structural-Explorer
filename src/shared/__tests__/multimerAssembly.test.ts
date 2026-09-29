import { describe, it, expect } from "vitest";
import { interfaceFootprint, parseSubunitAssembly, statesMultimer, variantContacts } from "../multimerAssembly";

describe("parseSubunitAssembly", () => {
  it("reads NAE1's record as a heterodimer with UBA3, and not the complex it binds", () => {
    const a = parseSubunitAssembly("Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2", "NAE1");
    expect(a.kind).toBe("heteromer");
    expect(a.label).toBe("Heterodimer");
    expect(a.copies).toBe(2);
    expect(a.partnerGenes).toEqual(["UBA3"]);
    expect(a.sentence).toBe("Heterodimer of UBA3 and NAE1.");
  });

  it("treats no record as not stated, never as a monomer", () => {
    for (const text of [null, undefined, "", "   "]) {
      const a = parseSubunitAssembly(text);
      expect(a.kind).toBe("unstated");
      expect(a.copies).toBeNull();
      expect(statesMultimer(a)).toBe(false);
    }
  });

  it("does not invent a stoichiometry from the word 'complex'", () => {
    const a = parseSubunitAssembly("The complex binds NEDD8.");
    expect(a.kind).not.toBe("homomer");
    expect(a.copies).toBeNull();
  });

  it("uses the first assembly named and keeps later ones", () => {
    const a = parseSubunitAssembly("Homodimer. Can also form a homotetramer upon ligand binding.");
    expect(a.kind).toBe("homomer");
    expect(a.copies).toBe(2);
    expect(a.alsoStated).toEqual(["Homotetramer"]);
  });

  it("does not let 'hetero' later in the record override a homodimer", () => {
    const a = parseSubunitAssembly("Homodimer. Forms a heterodimer with PAX3 in some cells.");
    expect(a.kind).toBe("homomer");
    expect(a.alsoStated).toContain("Heterodimer");
  });

  it("reads a bare dimer as identical chains and says so", () => {
    const a = parseSubunitAssembly("Dimer.");
    expect(a.kind).toBe("homomer");
    expect(a.homoAssumed).toBe(true);
  });

  it("recognises complex membership and interaction-only records", () => {
    expect(parseSubunitAssembly("Component of the Mediator complex.").kind).toBe("complex");
    expect(parseSubunitAssembly("Interacts with TP53 and MDM2.").kind).toBe("interactions-only");
  });

  it("reads monomers, including one stated before an oligomer", () => {
    const a = parseSubunitAssembly("Monomer; homodimerizes upon activation. Homodimer in the crystal.");
    expect(a.kind).toBe("monomer");
    expect(a.alsoStated).toContain("Homodimer");
  });
});

describe("variantContacts", () => {
  const contacts = [
    { resA: 116, resB: 40, distance: 3.9 },
    { resA: 50, resB: 116, distance: 3.1 },
    { resA: 114, resB: 42, distance: 3.0 },
  ];

  it("counts only the variant residue itself, not sequence neighbours", () => {
    expect(variantContacts(contacts, 116, false).map(c => c.resA)).toEqual([116]);
  });

  it("reads resB as the same numbering only in a homomer, nearest first", () => {
    expect(variantContacts(contacts, 116, true).map(c => c.distance)).toEqual([3.1, 3.9]);
  });

  it("returns nothing without a position", () => {
    expect(variantContacts(contacts, null, true)).toEqual([]);
    expect(variantContacts(contacts, 0, true)).toEqual([]);
  });

  it("builds the footprint from the variant's chain", () => {
    expect(interfaceFootprint(contacts, false)).toEqual([50, 114, 116]);
    expect(interfaceFootprint(contacts, true)).toEqual([40, 42, 50, 114, 116]);
  });
});
