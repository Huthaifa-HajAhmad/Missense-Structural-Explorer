import { describe, it, expect } from "vitest";
import { buildInterfacesEvidence, iptmBand, isStaleAssembly, isStalePpi, stringNetworkUrl, supportText, type BuildInterfacesInput } from "../interfacesEvidence";
import { SLC12A4 } from "./fixtures/slc12a4";

const slc = (over: Partial<BuildInterfacesInput> = {}) =>
  buildInterfacesEvidence({
    result: SLC12A4.result,
    assembly: SLC12A4.assembly,
    assemblyStatus: "ready",
    ppi: SLC12A4.ppi,
    ppiStatus: "ready",
    shift: null,
    shiftLoading: false,
    ...over,
  });

describe("Interfaces & PPI — SLC12A4 p.Gln867His (doc/INTERFACES_AUDIT.md)", () => {
  it("states the support: at the dimer interface in 1 of 8 solved structures (7AIQ), never 'in 8'", () => {
    const ev = slc();
    expect(ev.interface).toMatchObject({ verdict: "at-interface", support: "1 of 8 solved structures" });
    expect(ev.interface.observed).toMatchObject({ k: 1, n: 8, entries: ["7aiq"], maxSupport: 5 });
    expect(ev.finding.headline).toBe("Gln867 is at the interface with the other SLC12A4 chain in 1 of 8 solved structures (7AIQ).");
    expect(ev.finding.predicate).toMatch(/depends on the conformation or construct captured/);
    expect(JSON.stringify(ev.finding)).not.toMatch(/in 8 solved structures/);
    expect(ev.facts.find(f => f.label === "Interface support")).toMatchObject({ value: "1 of 8" });
  });

  it("keeps SUBUNIT's second statement and its qualifier: a probable heterodimer with a family, unresolved", () => {
    const ev = slc();
    expect(ev.assembly.statements.map(s => [s.label, s.qualifier, s.family])).toEqual([
      ["Homodimer", null, null],
      ["Heterodimer", "Probable", "other K-Cl cotransporters"],
    ]);
    const family = ev.partners.find(p => p.family)!;
    expect(family).toMatchObject({ group: "assembly", qualifier: "Probable" });
    expect(family.evidence).toMatch(/named as a family; not resolved to genes/);
    // The cotransporters STRING links physically are never told "no curated interaction".
    expect(JSON.stringify(ev.partners)).not.toMatch(/No curated interaction/);
    expect(ev.partners.find(p => p.gene === "SLC12A6")).toMatchObject({ group: "physical" });
  });

  it("says the eight IntAct partners are one two-hybrid screen, not replicated binding", () => {
    const ev = slc();
    const screen = ev.partners.filter(p => p.group === "screen");
    expect(screen.map(p => p.gene).sort()).toEqual(["AP3M1", "CNFN", "CYSRT1", "KRTAP12-2", "KRTAP19-2", "MB21D2", "TMEM102", "ZNF655"]);
    // One study for the whole tier: said once in the group head, not on every row.
    expect(screen.every(p => p.evidence === "Yeast two-hybrid")).toBe(true);
    expect(ev.groups.find(g => g.id === "screen")?.meta).toBe("Yeast two-hybrid in one study (PubMed 32296183), no other method");
    expect(ev.facts.find(f => f.label === "Reported partners")).toMatchObject({ value: "8", sub: "all two-hybrid, one study (PubMed 32296183)" });
    expect(JSON.stringify(ev)).not.toMatch(/Curated physical interaction|3 experiments/);
  });

  it("asks STRING about every partner: a score, or absence at its lowest band, never 'not in the top five'", () => {
    const ev = slc();
    const byGene = Object.fromEntries(ev.partners.map(p => [p.gene, p]));
    expect(byGene.TMEM102.physical.score).toBeCloseTo(0.529, 3);
    expect(byGene.AP3M1.physical).toMatchObject({ score: null, note: "None ≥ 0.15" });
    expect(JSON.stringify(ev)).not.toMatch(/top five/);
    expect(ev.string.version).toBe("12.5");
  });

  it("draws membrane topology and the scissor helix, and no empty 'No domains annotated' lane", () => {
    const ev = slc();
    expect(ev.track.map(l => l.kind)).toEqual(["topology", "domains", "solved"]);
    expect(ev.track[0].summary).toBe("12 membrane segments; Gln867 is in the cytoplasmic part");
    expect(ev.track[1].ranges.map(r => r.name)).toContain("Scissor helix");
    const solved = ev.track[2];
    const at867 = solved.marks.find(m => m.residue === 867)!;
    expect(at867.weight).toBeCloseTo(1 / 8, 5);
    expect(Math.max(...solved.marks.map(m => m.weight))).toBeCloseTo(5 / 8, 5);
  });

  it("leaves the model on request and plans the binding change on the solved complex", () => {
    const ev = slc();
    expect(ev.model).toMatchObject({ state: "not-requested", canRequest: true });
    expect(ev.binding).toMatchObject({ state: "ready", canRequest: true });
    expect(ev.binding.plan).toMatch(/solved complex where Gln867 is at the interface \(7AIQ\)/);
  });

  it("keeps a running model as running and a failed one as retryable, never as 'no contact'", () => {
    const running = slc({ assembly: { ...SLC12A4.assembly, status: "running", jobId: "j1" } });
    expect(running.model).toMatchObject({ state: "running", stateLabel: "Running" });
    expect(running.interface.verdict).toBe("at-interface");
    const failed = slc({ assembly: { ...SLC12A4.assembly, status: "failed", failure: { kind: "timeout" }, error: "Boltz-2 did not answer in time." } });
    expect(failed.model).toMatchObject({ state: "failed", retryable: true, canRequest: true, reason: "Boltz-2 did not answer in time." });
    expect(failed.interface.verdict).toBe("at-interface");
    const rejected = slc({ assembly: { ...SLC12A4.assembly, status: "failed", failure: { kind: "rejected", httpStatus: 413 }, error: "Boltz-2 refused this complex (HTTP 413)." } });
    expect(rejected.model).toMatchObject({ retryable: false, canRequest: false });
  });

  it("says so when the model and the solved structures disagree", () => {
    const ev = slc({
      assembly: {
        ...SLC12A4.assembly,
        status: "success",
        ipTm: 0.71,
        pTm: 0.7,
        interfaceContacts: [{ resA: 700, resB: 700, distance: 3.4 }],
      },
    });
    expect(ev.interface.verdict).toBe("at-interface");
    expect(ev.interface.disagreement).toBe("The predicted complex places Gln867 outside its interface; the solved structures are the stronger evidence.");
  });

  it("reads the binding change in DDMut-PPI's sign, inside its error when small, on the solved entry", () => {
    const ev = slc({
      shift: {
        status: "ok", gene: "SLC12A4", variant: "p.Gln867His", ddgBind: -0.42, unit: "kcal/mol", signConvention: "negative-weakens",
        predictor: "DDMut-PPI", mutation: "Q867H",
        wildType: { source: "experimental", provenance: "PDB 7AIQ, electron microscopy 3.72 Å", ipTm: null, chains: [], pdbId: "7aiq", method: "Electron Microscopy", resolution: 3.72, chain: "A", authorResidue: 867 },
      },
    });
    expect(ev.binding).toMatchObject({ state: "ok", direction: "weaker", valueText: "−0.42 kcal/mol", withinError: true });
    expect(ev.facts.find(f => f.label === "Binding change")?.sub).toBe("Weaker binding, within the method's error");
    expect(ev.trace.find(t => t.label === "Binding change")?.value).toBe("−0.42 kcal/mol on PDB 7AIQ");
  });

  it("ends the trace with the engine record and draws no ACMG code", () => {
    const ev = slc();
    expect(ev.trace[ev.trace.length - 1]).toMatchObject({ label: "Engine record", value: "None" });
    expect(JSON.stringify(ev)).not.toMatch(/\b(PP3|BP4|PM1|PS3)\b/);
  });
});

describe("Interfaces & PPI — states and staleness", () => {
  it("re-reads payloads written before per-structure support and the IntAct/STRING fields", () => {
    const old: any = { ...SLC12A4.assembly, experimental: { status: "ok", partners: [{ accession: "Q9UP95", name: "x", residues: [867], pdbEntries: ["7aiq"], homomeric: true, variantAtInterface: true }] } };
    expect(isStaleAssembly(old)).toBe(true);
    expect(isStaleAssembly(SLC12A4.assembly)).toBe(false);
    const ev = slc({ assembly: old });
    expect(ev.interface.verdict).toBe("pending");
    expect(JSON.stringify(ev.finding)).not.toMatch(/in 1 of|in 8/);
    expect(isStalePpi({ ...SLC12A4.ppi, lookups: { uniprot: "ok" }, string: undefined })).toBe(true);
    expect(isStalePpi(SLC12A4.ppi)).toBe(false);
  });

  it("keeps failures as states, not empty answers", () => {
    const ev = slc({ ppi: null, ppiStatus: "error", ppiError: "HTTP 502", assembly: { ...SLC12A4.assembly, experimental: { status: "error", reason: "PDBe answered HTTP 503.", partners: [] } } });
    expect(ev.sections.uniprot.state).toBe("failed");
    expect(ev.sections.stringPhysical.state).toBe("failed");
    expect(ev.observed.availability).toMatchObject({ state: "failed", label: "Provider error", reason: "PDBe answered HTTP 503." });
    expect(ev.interface.verdict).toBe("not-measured");
    expect(ev.finding.predicate).toBe("Solved structures could not be read, so a contact is not ruled out");
  });

  it("sets construct tags aside and does not count them as interfaces", () => {
    const tag = { accession: "P0AEX9", name: "Maltose-binding periplasmic protein", residues: [867], support: [1], pdbEntries: ["9zzz"], homomeric: false, artefact: "maltose-binding protein fusion tag", context: "native", variantAtInterface: true, variantEntries: ["9zzz"] };
    const ev = slc({ assembly: { ...SLC12A4.assembly, experimental: { status: "ok", partners: [tag] } } });
    expect(ev.observed.partners).toHaveLength(0);
    expect(ev.interface.verdict).toBe("not-measured");
    expect(ev.interface.setAside).toMatch(/Maltose-binding .*\(maltose-binding protein fusion tag\) is not a biological interface and is not counted/);
  });
});

/** NAE1 p.Asp116Gly, ported from the earlier tabs' suites (UniProtKB Q13564). */
const NAE1_SUBUNIT = "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2";
const NAE1: any = {
  result: {
    metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", residueIndex: 116 },
    uniprotFeatures: { subunitComment: NAE1_SUBUNIT, sequenceLength: 534, features: [{ type: "Domain", description: "ThiF", start: 20, end: 180 }] },
  },
  assembly: {
    status: "not-requested", gene: "NAE1", uniprotId: "Q13564", subunitComment: NAE1_SUBUNIT, oligomericState: "Heterodimer",
    chainIds: ["A", "B"], chainCount: 2, complexPdb: null, ipTm: null, pTm: null, interfaceContacts: [], provenance: "Boltz-2 via JapanFold",
    variantPosition: 116, variantAtInterface: null,
    chains: [
      { id: "A", accession: "Q13564", gene: "NAE1", length: 534, carriesVariant: true },
      { id: "B", accession: "Q8TBC4", gene: "UBA3", length: 463, carriesVariant: false },
    ],
    assembly: {
      kind: "heteromer", label: "Heterodimer", copies: 2, homoAssumed: false, sentence: "Heterodimer of UBA3 and NAE1.", alsoStated: [], qualifier: null,
      partners: [{ gene: "UBA3", accession: "Q8TBC4", resolvedBy: "interaction" }],
    },
    experimental: { status: "none", partners: [] },
  },
  ppi: {
    status: "success", gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", position: 116,
    stringPartners: [],
    string: { physical: [{ partner: "UBA3", score: 0.999 }, { partner: "NEDD8", score: 0.999 }], functional: [{ partner: "UBA3", score: 0.999 }, { partner: "NEDD8", score: 0.999 }, { partner: "UBE2F", score: 0.976 }], limit: 500, minScore: 0.15 },
    subunitComment: NAE1_SUBUNIT,
    curatedInteractions: [
      { accession: "P05067", gene: "APP", experiments: 3, evidence: { methods: ["anti tag coimmunoprecipitation"], pubmed: ["1"], twoHybridOnly: false } },
      { accession: "P07686", gene: "HEXB", experiments: 3, evidence: { methods: ["two hybrid"], pubmed: ["2"], twoHybridOnly: true } },
      { accession: "Q8TBC4", gene: "UBA3", experiments: 3, evidence: null },
    ],
    interactionSites: [
      { type: "Site", start: 211, end: 211, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: false },
      { type: "Region", start: 331, end: 344, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: false },
    ],
    sequenceLength: 534,
    lookups: { stringPartners: "ok", stringPhysical: "ok", intact: "ok", uniprot: "ok" },
  },
};
const nae1 = (over: Partial<BuildInterfacesInput> = {}) =>
  buildInterfacesEvidence({ result: NAE1.result, assembly: NAE1.assembly, assemblyStatus: "ready", ppi: NAE1.ppi, ppiStatus: "ready", shift: null, shiftLoading: false, ...over });

describe("Interfaces & PPI — NAE1 p.Asp116Gly", () => {
  it("states the heterodimer and never calls NAE1 a monomer", () => {
    const ev = nae1();
    expect(ev.assembly.label).toBe("Heterodimer");
    expect(ev.chains.map(c => c.label)).toEqual(["NAE1", "UBA3"]);
    expect(JSON.stringify(ev)).not.toMatch(/monomer|intramolecular/i);
  });

  it("groups partners by evidence: assembly, SUBUNIT binders, co-purified, screen, association", () => {
    const ev = nae1();
    const byGene = Object.fromEntries(ev.partners.map(p => [p.gene, p]));
    expect(byGene.UBA3).toMatchObject({ group: "assembly", accession: "Q8TBC4" });
    expect(byGene.UBA3.sites).toHaveLength(2);
    expect(byGene.NEDD8).toMatchObject({ group: "curated" });
    expect(byGene.NEDD8.evidence).toBe("Binds the NAE1–UBA3 complex (SUBUNIT)");
    expect(byGene.TP53BP2.evidence).toBe("Binds (SUBUNIT)");
    expect(byGene.APP).toMatchObject({ group: "curated" });
    expect(byGene.HEXB).toMatchObject({ group: "screen" });
    expect(byGene.UBE2F).toMatchObject({ group: "functional" });
    expect(ev.partners[0].gene).toBe("UBA3");
    expect(ev.partners.some(p => p.gene === "NAE1")).toBe(false);
  });

  it("places Asp116 outside UniProt's two UBA3 sites and says the interface was not measured", () => {
    const ev = nae1();
    const sites = ev.track.find(l => l.kind === "sites")!;
    expect(sites.ranges.map(r => [r.start, r.end])).toEqual([[211, 211], [331, 344]]);
    expect(sites.hit).toBe(false);
    expect(ev.interface.verdict).toBe("not-measured");
    expect(ev.finding.headline).toBe("Whether Asp116 touches another protein has not been measured.");
  });

  it("models the heterodimer as the wild type only because no solved complex exists", () => {
    const ev = nae1();
    expect(ev.binding.state).toBe("ready");
    expect(ev.binding.plan).toMatch(/No solved complex of NAE1 exists, so Boltz-2 models the heterodimer all wild type/);
  });

  it("marks a hit in a mapped site", () => {
    const ev = nae1({ ppi: { ...NAE1.ppi, interactionSites: [{ type: "Region", start: 100, end: 120, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: true }] } });
    expect(ev.partners[0]).toMatchObject({ gene: "UBA3", variantInSite: true });
    expect(ev.finding.headline).toBe("Asp116 is inside UniProt's mapped binding site 100–120.");
  });

  it("reports model contacts as contacts, never as disruption; a heteromer's resB is never the variant", () => {
    const ev = nae1({
      assembly: { ...NAE1.assembly, status: "success", ipTm: 0.84, pTm: 0.8, complexPdb: "ATOM", interfaceContacts: [{ resA: 116, resB: 40, distance: 3.2 }, { resA: 118, resB: 116, distance: 3.0 }] },
    });
    expect(ev.model.state).toBe("built");
    expect(ev.model.variantContacts).toEqual([{ resA: 116, resB: 40, distance: 3.2 }]);
    expect(ev.interface).toMatchObject({ verdict: "at-interface", support: "In the predicted complex only" });
    expect(ev.finding.headline).toBe("In the predicted complex, Asp116 makes 1 contact with another chain (ipTM 0.84, confident interface).");
    expect(JSON.stringify(ev.finding)).not.toMatch(/disrupt/i);
  });
});

describe("helpers", () => {
  it("follows AlphaFold-Multimer's published ipTM guidance at the edges", () => {
    expect(iptmBand(0.81)).toBe("confident");
    expect(iptmBand(0.8)).toBe("grey");
    expect(iptmBand(0.6)).toBe("grey");
    expect(iptmBand(0.59)).toBe("low");
    expect(iptmBand(null)).toBeNull();
  });

  it("words support as a fraction", () => {
    expect(supportText(1, 8)).toBe("1 of 8 solved structures");
    expect(supportText(8, 8)).toBe("all 8 solved structures");
    expect(supportText(1, 1)).toBe("the one solved structure");
  });

  it("links STRING with its documented URL form", () => {
    expect(stringNetworkUrl("NAE1", "UBA3")).toBe("https://string-db.org/cgi/network?identifiers=NAE1%0dUBA3&species=9606");
  });
});
