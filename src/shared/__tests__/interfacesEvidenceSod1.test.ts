import { describe, it, expect } from "vitest";
import { buildInterfacesEvidence, filterPartnerGroups, isStaleAssembly } from "../interfacesEvidence";
import { subunitStatements } from "../multimerAssembly";
import { SOD1_INTERFACES as F } from "./fixtures/sod1Interfaces";

/** SOD1 p.Ala5Val (legacy A4V), the densest real case for this tab: doc/INTERFACES_PPI_REVIEW.md. */
const sod1 = () =>
  buildInterfacesEvidence({ result: F.result, assembly: F.assembly, assemblyStatus: "ready", ppi: F.ppi, ppiStatus: "ready", shift: null, shiftLoading: false });

describe("SOD1 p.Ala5Val — fibrils are not the native interface", () => {
  it("tests Ala5 against the 142 native structures and finds it at the dimer interface in none", () => {
    // Before: "Ala5 is at the interface with the other SOD1 chain in 4 of 157 solved structures (7VZF, 9JBO, 9JBP, 9LI1)",
    // all four amyloid fibrils, drawn on the homodimer seam.
    const ev = sod1();
    expect(ev.interface.verdict).toBe("not-at-interface");
    expect(ev.interface.label).toBe("Not at an interface");
    expect(ev.interface.reference).toEqual({ n: 142, partner: "SOD1, other chain" });
    expect(ev.finding.headline).toBe("Ala5 is not at the interface with the other SOD1 chain in any of 142 native solved structures.");
    expect(ev.facts.find(f => f.label === "Interface support")).toMatchObject({ value: "0 of 142", sub: "native solved structures · 4 of 15 fibrils" });
    expect(JSON.stringify(ev)).not.toMatch(/of 157/);
  });

  it("names the core neighbour so 'not at the interface' is not read as 'far from it'", () => {
    const ev = sod1();
    expect(ev.interface.nearest).toMatchObject({ residue: 6, name: "Val6", gap: 1, n: 142 });
    expect(ev.finding.predicate).toMatch(/Val6, 1 residue away, is at that interface in \d+ of 142/);
  });

  it("states the fibril contact apart, with its own denominator and entries", () => {
    const ev = sod1();
    expect(ev.interface.fibril).toMatchObject({ k: 4, n: 15, entries: ["7vzf", "9jbo", "9jbp", "9li1"] });
    expect(ev.interface.fibril?.sentence).toMatch(/^In 4 of 15 amyloid fibril structures \(7VZF, 9JBO, 9JBP, 9LI1\) Ala5 touches a neighbouring chain of the fibril\./);
    expect(ev.observed.fibrils.map(f => f.label)).toEqual(["SOD1 fibril"]);
    const lanes = ev.track.filter(l => l.kind === "solved");
    expect(lanes.at(-1)).toMatchObject({ label: "SOD1 fibril", readout: { k: 4, n: 15 } });
    expect(lanes[0]).toMatchObject({ label: "SOD1, other chain", readout: { k: 0, n: 142 } });
  });

  it("plans no binding change: no native complex has Ala5 at its interface, and a fibril is never a wild type", () => {
    const ev = sod1();
    expect(ev.binding.state).toBe("not-applicable");
    expect(ev.binding.plan).toBeNull();
    expect(ev.binding.reason).toBe("Ala5 is not at the interface in any solved complex of SOD1, so no binding change is estimated.");
  });

  it("re-reads a stored payload from before the fibril split", () => {
    const old = { ...F.assembly, experimental: { ...F.assembly.experimental, partners: F.assembly.experimental.partners.map(({ context, ...p }: any) => p) } };
    expect(isStaleAssembly(old)).toBe(true);
    expect(isStaleAssembly(F.assembly)).toBe(false);
  });
});

describe("SOD1 p.Ala5Val — who counts as a partner", () => {
  it("sets the nanobody and the unmapped chain aside, once each", () => {
    const ev = sod1();
    expect(ev.observed.artefacts.map(a => [a.name, a.artefact])).toEqual([
      ["NB1", "antibody or nanobody, a tool binder"],
      ["Other", "chain with no UniProt record"],
    ]);
    expect(ev.partners.some(p => /NB1|^Other$/.test(p.gene))).toBe(false);
  });

  it("keeps CCS as one row: SUBUNIT's heterodimer, the 3 solved structures and IntAct's methods together", () => {
    const ev = sod1();
    const ccs = [...ev.groups.flatMap(g => [...g.rows, ...(g.folded?.rows ?? [])])].filter(p => p.accession === "O14618" || p.gene === "CCS");
    expect(ccs).toHaveLength(1);
    expect(ccs[0]).toMatchObject({ group: "assembly", accession: "O14618" });
    expect(ccs[0].evidence).toMatch(/^Heterodimer · Solved: 3 structures · Anti tag coimmunoprecipitation/);
  });

  it("names other species and does not give them a human STRING score", () => {
    const ev = sod1();
    const structural = ev.groups.find(g => g.id === "structural")!.rows;
    expect(structural.map(r => [r.gene, r.organism])).toEqual([
      ["CCS1", "Baker's yeast"],
      ["Sod1", "Mouse"],
    ]);
    const hspa5 = ev.partners.find(p => p.gene === "Hspa5")!;
    expect(hspa5.organism).toBe("other species");
    expect(hspa5.functional).toMatchObject({ score: null, note: "Not scored (not human)" });
    expect(ev.partners.find(p => p.gene === "Chga")?.organism).toBe("mouse");
  });

  it("counts reported partners once, human apart from other species", () => {
    const ev = sod1();
    expect(ev.facts.find(f => f.label === "Reported partners")).toMatchObject({ value: "77", sub: "66 from a two-hybrid screen only; 6 more from other species" });
  });

  it("reads SUBUNIT's CCS:SOD1:SLC31A1 sentence as a heterotrimer, not a second heterodimer", () => {
    const st = subunitStatements(F.result.uniprotFeatures.subunitComment, "SOD1");
    expect(st.map(s => s.label)).toEqual(["Homodimer", "Heterodimer", "Heterotrimer"]);
    expect(st[2].partnerGenes).toEqual(["CCS", "SLC31A1"]);
  });
});

describe("SOD1 p.Ala5Val — the partner list is delivered, not dumped", () => {
  it("folds the single-screen tail and says the study once", () => {
    // Before: 66 rows reading "Yeast two-hybrid · 1 study (PubMed 32814053)".
    const screen = sod1().groups.find(g => g.id === "screen")!;
    expect(screen.meta).toBe("Yeast two-hybrid in one study (PubMed 32814053), no other method");
    expect(screen.total).toBe(66);
    expect(screen.rows.map(r => r.gene)).toEqual(["BCL2", "RNF19A", "KARS1"]);
    expect(screen.rows.every(r => (r.physical.score ?? 0) >= 0.4)).toBe(true);
    expect(screen.folded?.rows).toHaveLength(63);
    expect(screen.folded?.summary).toBe("63 more partners from the same screen, none with STRING physical support of 0.40 or more");
  });

  it("shows at most about twenty rows per tier by default", () => {
    const ev = sod1();
    for (const g of ev.groups) expect(g.rows.length).toBeLessThanOrEqual(20);
    expect(ev.partners.length).toBeLessThan(40);
  });

  it("marks STRING's capped list with a plus, in the tier and the trace", () => {
    const ev = sod1();
    const functional = ev.groups.find(g => g.id === "functional")!;
    expect(functional.capped).toBe(true);
    expect(functional.folded?.summary).toMatch(/\+ more on STRING, which returns its top 500$/);
    expect(ev.trace.find(t => t.label === "STRING")?.value).toBe("213 physical partners and 500+ functional ≥ 0.15");
  });

  it("filters by tier and by name, reaching folded rows", () => {
    const ev = sod1();
    const onlyScreen = filterPartnerGroups(ev.groups, { tier: "screen", query: "" });
    expect(onlyScreen.map(g => g.id)).toEqual(["screen"]);
    expect(onlyScreen[0].folded?.rows).toHaveLength(63);
    const zxdc = filterPartnerGroups(ev.groups, { tier: null, query: "zxdc" });
    expect(zxdc.map(g => [g.id, g.rows.map(r => r.gene), g.folded])).toEqual([["screen", ["ZXDC"], null]]);
    expect(filterPartnerGroups(ev.groups, { tier: "assembly", query: "zxdc" })).toEqual([]);
  });
});
