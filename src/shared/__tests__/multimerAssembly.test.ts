import { describe, it, expect } from "vitest";
import { interfaceFootprint, parseSubunitAssembly, resolveConditionalAssembly, statesMultimer, subunitStatements, variantContacts } from "../multimerAssembly";

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

  it("promotes conditional oligomers (e.g. FGFR3 P22607 monomer -> homodimer upon ligand binding) for complex modelling (missense#15)", () => {
    const text = "Monomer. Homodimer after binding to ligand (By similarity). Homodimer (Probable).";
    const parsed = parseSubunitAssembly(text, "FGFR3");
    const statements = subunitStatements(text, "FGFR3");
    const resolved = resolveConditionalAssembly(parsed, statements);
    expect(resolved.kind).toBe("homomer");
    expect(resolved.copies).toBe(2);
    expect(resolved.label).toContain("Homodimer");
    expect(resolved.alsoStated).toContain("Monomer");
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

describe("subunitStatements — a family named by its symbol (ABCG1, doc/INTERFACES_PPI_AUDIT_2026-11-26.md H1)", () => {
  // UniProt P45844 SUBUNIT, read 2026-11-26.
  const ABCG1 =
    "Homodimer; disulfide-linked (PubMed:16702602). Homooligomer (PubMed:16702602). May form heterodimers with several heterologous partners of the ABCG subfamily. Forms heterodimers with ABCG4 (PubMed:27228027). Interacts with CAV1; this interaction regulates ABCG1-mediated cholesterol efflux (PubMed:24576892)";

  it("reads 'partners of the ABCG subfamily' as a family, never as a gene called ABCG", () => {
    const heteromers = subunitStatements(ABCG1, "ABCG1").filter(s => s.kind === "heteromer");
    expect(heteromers.map(s => [s.family, s.partnerGenes])).toEqual([
      ["ABCG subfamily", []],
      [null, ["ABCG4"]],
    ]);
  });

  it("still reads a gene beside the word 'family' elsewhere in the sentence as a gene", () => {
    const [s] = subunitStatements("Heterodimer with SLC3A2, a member of the solute carrier family.", "SLC7A5");
    expect(s).toMatchObject({ partnerGenes: ["SLC3A2"], family: null });
  });
});
