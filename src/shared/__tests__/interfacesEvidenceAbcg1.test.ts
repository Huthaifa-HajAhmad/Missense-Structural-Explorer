import { describe, it, expect } from "vitest";
import { buildInterfacesEvidence, isSelfRow, isStaleAssembly, type BuildInterfacesInput } from "../interfacesEvidence";
import { LOCALFOLD_MAX_RESIDUES } from "../multimerHandoff";
import { ABCG1_INTERFACES as F } from "./fixtures/abcg1Interfaces";

const abcg1 = (over: Partial<BuildInterfacesInput> = {}) =>
  buildInterfacesEvidence({ result: F.result, assembly: F.assembly, assemblyStatus: "ready", ppi: F.ppi, ppiStatus: "ready", shift: null, shiftLoading: false, ...over });

/** Every sentence the screen and the rail can show about the variant residue. */
const said = (ev: ReturnType<typeof abcg1>) =>
  JSON.stringify([ev.finding, ev.facts, ev.trace, ev.binding.reason, ev.model.reason, ev.interface, ev.track.filter(l => l.kind === "solved")]);

describe("Interfaces & PPI — ABCG1 p.Gly358Arg, a residue no solved structure models (audit 2026-11-26, C1)", () => {
  it("says Gly358 is not modelled in any of the 5 structures, never 'not at the interface' or '0 of 5'", () => {
    const ev = abcg1();
    expect(ev.interface).toMatchObject({ verdict: "not-modelled", label: "Not modelled" });
    expect(ev.interface.unmodelled).toMatchObject({ total: 5, gap: { start: 348, end: 396 } });
    expect(ev.finding.headline).toBe("Gly358 is not modelled in any of the 5 solved structures of ABCG1, so they cannot show whether it is at an interface.");
    expect(ev.finding.predicate).toBe("Residues 348–396 have no coordinates in any of them: a stretch the experiments did not resolve");
    expect(said(ev)).not.toMatch(/not at (the|an|any) interface|0 of 5|Not at it/i);
  });

  it("places the residue for orientation: cytoplasmic, between the domains the map draws (InterPro)", () => {
    expect(abcg1().finding.context).toBe(
      "Gly358 lies in the cytoplasmic part, between ABC transporter family G domain (274–332) and ABC-2 type transporter, transmembrane domain (403–612)."
    );
  });

  it("states the denominator as structures that model the residue, in the fact strip and the trace", () => {
    const ev = abcg1();
    expect(ev.facts.find(f => f.label === "Interface support")).toMatchObject({ value: "Not modelled", sub: "in none of 5 solved structures" });
    expect(ev.trace.find(t => t.label === "Variant residue")?.value).toBe("Not modelled in any of 5 solved structures");
  });

  it("draws the unmodelled stretch on the solved lane and reads its variant cell as not modelled", () => {
    const lane = abcg1().track.find(l => l.kind === "solved")!;
    expect(lane.gaps).toContainEqual({ start: 348, end: 396 });
    expect(lane.readout).toEqual({ k: 0, n: 0, total: 5 });
  });

  it("stops citing the solved structures as an answer for the model and the binding change", () => {
    const ev = abcg1();
    expect(ev.model.reason).not.toMatch(/already answer/);
    expect(ev.model.reason).toMatch(/do not model Gly358/);
    expect(ev.binding).toMatchObject({ state: "not-applicable" });
    expect(ev.binding.reason).toBe("Gly358 is not modelled in any solved complex of ABCG1, so there is no solved wild type to score on.");
  });

  it("knows the complex is too large to fold in a browser before anyone clicks", () => {
    const ev = abcg1();
    expect(ev.model.residues).toBe(1356);
    expect(ev.model.browserFoldable).toBe(false);
    expect(LOCALFOLD_MAX_RESIDUES).toBeLessThan(1356);
  });

  it("re-reads a stored assembly written before residue coverage", () => {
    const old = { ...F.assembly, experimental: { ...F.assembly.experimental, coverageChecked: undefined } };
    expect(isStaleAssembly(old)).toBe(true);
    expect(isStaleAssembly(F.assembly)).toBe(false);
  });

  it("says plainly when coverage could not be read, and keeps the old denominator", () => {
    const partners = F.assembly.experimental.partners.map(({ modelledEntries, unmodelled, ...p }: any) => p);
    const ev = abcg1({ assembly: { ...F.assembly, experimental: { ...F.assembly.experimental, partners, coverageChecked: false } } });
    expect(ev.interface.verdict).toBe("not-at-interface");
    expect(ev.trace.find(t => t.label === "Solved structures")).toMatchObject({ warn: true });
    expect(ev.trace.find(t => t.label === "Solved structures")?.sub).toMatch(/could not say which structures model/);
    // The binding card reads the same rule as the rail: no "that models it" for a denominator nobody measured.
    expect(ev.binding.reason).not.toMatch(/that models it/);
    expect(ev.binding.reason).toMatch(/PDBe could not say which of them model it/);
  });

  // Review of the Interfaces refactor, HIGH: a built model with no contact at Gly358 used to credit the five
  // structures as a second, agreeing witness ("Model and solved structures"), though none has coordinates for it.
  it("never credits the solved structures when a built model has no contact at the residue", () => {
    const built = { ...F.assembly, status: "success", ipTm: 0.5, pTm: 0.6, interfaceContacts: [] } as typeof F.assembly;
    const ev = abcg1({ assembly: built });
    expect(ev.model.state).toBe("built");
    expect(ev.interface).toMatchObject({ verdict: "not-at-interface", support: "In the predicted complex only" });
    expect(ev.interface.unmodelled).toMatchObject({ total: 5 });
    expect(ev.finding.headline).toBe("Gly358 is not at an interface in the predicted complex. None of the 5 solved structures of ABCG1 has coordinates for it, so they cannot confirm that.");
    expect(ev.finding.figure).toMatchObject({ isCount: false, caption: expect.stringMatching(/^Predicted complex only\. 5 solved structures .*none has coordinates for Gly358/) });
    expect(ev.binding.reason).toBe("Gly358 is not modelled in any solved complex of ABCG1, so there is no solved wild type to score on.");
    expect(ev.trace.find(t => t.label === "Variant residue")?.value).toBe("Not at an interface in the predicted complex; not modelled in any of 5 solved structures");
    expect(said(ev)).not.toMatch(/Model and solved structures|0 of 5|any solved complex of ABCG1 that models it|in solved structures of ABCG1/);
  });
});

describe("Interfaces & PPI — one definition of the protein's own row", () => {
  it("counts an isoform-suffixed accession as the protein itself", () => {
    expect(isSelfRow({ family: false, accession: "P45844-2" }, "P45844")).toBe(true);
    expect(isSelfRow({ family: false, accession: "Q9UNQ0" }, "P45844")).toBe(false);
    expect(isSelfRow({ family: true, accession: null }, "P45844")).toBe(false);
    expect(isSelfRow({ family: false, accession: "P45844" }, null)).toBe(false);
  });
});

describe("Interfaces & PPI — ABCG1 partners (audit 2026-11-26, H1/H2)", () => {
  it("shows the ABCG subfamily as an unresolved family, with no STRING link or score", () => {
    const ev = abcg1();
    expect(ev.partners.some(p => p.gene === "ABCG" && !p.family)).toBe(false);
    expect(ev.partners.find(p => p.family)).toMatchObject({ gene: "ABCG subfamily", group: "assembly" });
  });

  it("counts six partner proteins once, in the facts, the trace and the summary the chips sit under", () => {
    const ev = abcg1();
    expect(ev.facts.find(f => f.label === "Reported partners")?.value).toBe("6");
    expect(ev.trace.find(t => t.label === "Partners")?.value).toMatch(/^6 reported partners/);
    expect(ev.partnerSummary).toMatchObject({ binding: 6, association: 500, capped: true });
  });
});
