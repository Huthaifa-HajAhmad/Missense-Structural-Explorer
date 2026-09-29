import { describe, it, expect } from "vitest";
import { buildInteractionsEvidence, stringNetworkUrl } from "../interactionsEvidence";

/** NAE1 p.Asp116Gly, from the user's screenshot and UniProtKB Q13564 (SUBUNIT, INTERACTION, sites). */
const RESULT: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", residueIndex: 116 },
  uniprotFeatures: { subunitComment: "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2.", sequenceLength: 534 },
  multimerData: {
    status: "success",
    chains: [
      { id: "A", accession: "Q13564", gene: "NAE1", length: 534, carriesVariant: true },
      { id: "B", accession: "Q8TBC4", gene: "UBA3", length: 463, carriesVariant: false },
    ],
  },
};

const PPI: any = {
  status: "success",
  gene: "NAE1",
  variant: "p.Asp116Gly",
  uniprotId: "Q13564",
  position: 116,
  stringPartners: [
    { partner: "NEDD8", score: 0.999 },
    { partner: "UBE2M", score: 0.999 },
    { partner: "UBA3", score: 0.999 },
    { partner: "APP", score: 0.998 },
    { partner: "UBE2F", score: 0.976 },
  ],
  subunitComment: "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2.",
  curatedInteractions: [
    { accession: "P05067", gene: "APP", experiments: 3 },
    { accession: "P07686", gene: "HEXB", experiments: 3 },
    { accession: "Q8TBC4", gene: "UBA3", experiments: 3 },
  ],
  interactionSites: [
    { type: "Site", start: 211, end: 211, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: false },
    { type: "Region", start: 331, end: 344, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: false },
  ],
  observedInterfaces: [],
  sequenceLength: 534,
  lookups: { stringPartners: "ok", uniprot: "ok", pdbe: "failed" },
};

const build = (over: Partial<Parameters<typeof buildInteractionsEvidence>[0]> = {}) =>
  buildInteractionsEvidence({ result: RESULT, ppi: PPI, ppiStatus: "ready", shift: null, shiftLoading: false, ...over });

describe("buildInteractionsEvidence — NAE1 p.Asp116Gly", () => {
  it("places Asp116 outside UniProt's two UBA3 sites, and says solved structures were not read", () => {
    const ev = build();
    expect(ev.finding.figure).toBe("Outside mapped sites");
    expect(ev.finding.headline).toBe("Asp116 does not fall in any binding site UniProt maps for NAE1.");
    expect(ev.finding.predicate).toBe("Solved structures were not read, so a contact at Asp116 is not ruled out");
    expect(ev.facts.find(f => f.label === "Mapped sites")).toMatchObject({ value: "2", sub: "None contains Asp116" });
  });

  it("joins SUBUNIT, IntAct and STRING into one row per partner, physical before functional", () => {
    const ev = build();
    const byGene = Object.fromEntries(ev.partners.map(p => [p.gene, p]));
    expect(byGene.UBA3).toMatchObject({ group: "physical", evidence: "Assembly partner", intactExperiments: 3, accession: "Q8TBC4" });
    expect(byGene.UBA3.sites).toHaveLength(2);
    expect(byGene.UBA3.string?.score).toBe(0.999);
    expect(byGene.NEDD8).toMatchObject({ group: "physical", evidence: "Binds the NAE1–UBA3 complex" });
    expect(byGene.HEXB).toMatchObject({ group: "physical", evidence: "Binary interaction", string: null });
    expect(byGene.TP53BP2).toMatchObject({ group: "physical", evidence: "Binds" });
    // Known only from STRING: functional association, never listed as a binding partner.
    expect(byGene.UBE2F).toMatchObject({ group: "functional", evidence: "No curated interaction" });
    expect(ev.partners[0].gene).toBe("UBA3");
    expect(ev.partners[ev.partners.length - 1].gene).toBe("UBE2F");
    expect(ev.partners.some(p => p.gene === "NAE1")).toBe(false);
  });

  it("never names a monomer: the tab does not restate the assembly", () => {
    const ev = build();
    expect(JSON.stringify(ev)).not.toMatch(/monomer|intramolecular/i);
  });

  it("draws UBA3's sites on the track, with no hit at 116", () => {
    const ev = build();
    expect(ev.track).toHaveLength(1);
    expect(ev.track[0]).toMatchObject({ label: "UBA3", hit: false });
    expect(ev.track[0].mapped.map(m => [m.start, m.end])).toEqual([[211, 211], [331, 344]]);
  });

  it("offers the binding change on the modelled chains, not run by default", () => {
    const ev = build();
    expect(ev.binding.state).toBe("ready");
    expect(ev.binding.canRequest).toBe(true);
    expect(ev.binding.chains.map(c => c.accession)).toEqual(["Q13564", "Q8TBC4"]);
    expect(ev.facts.find(f => f.label === "Binding change")?.value).toBe("Not measured");
  });

  it("reads a negative ΔΔG_bind as weaker binding (DDMut-PPI's sign), with no class", () => {
    const ev = build({
      shift: {
        status: "ok", gene: "NAE1", variant: "p.Asp116Gly", ddgBind: -1.42, unit: "kcal/mol", signConvention: "negative-weakens",
        predictor: "DDMut-PPI", mutation: "D116G",
        wildType: { source: "boltz-2-model", provenance: "Boltz-2 via JapanFold", ipTm: 0.86, chains: [{ id: "A", accession: "Q13564", gene: "NAE1" }, { id: "B", accession: "Q8TBC4", gene: "UBA3" }] },
      },
    });
    expect(ev.binding).toMatchObject({ state: "ok", direction: "weaker", directionText: "Weaker binding", valueText: "−1.42 kcal/mol", partnerText: "to UBA3" });
    expect(JSON.stringify(ev.binding)).not.toMatch(/disruptive|allosteric|neutral/i);
  });

  it("does not render a binding value stored by the earlier service", () => {
    const ev = build({ ppi: { ...PPI, bindingShift: { ddgBind: 1.85, classification: "INTERFACE_DISRUPTIVE" } }, result: { ...RESULT, multimerData: null } });
    expect(ev.binding.value).toBeNull();
    expect(ev.binding.reason).toMatch(/earlier version .* not shown/);
  });

  it("says a monomer has no partner chain rather than offering a model", () => {
    const ev = build({ result: { ...RESULT, multimerData: { status: "monomeric" } } });
    expect(ev.binding).toMatchObject({ state: "needs-model", canRequest: false });
    expect(ev.binding.reason).toMatch(/monomer/);
  });

  it("marks a hit when the variant falls in a mapped site or a solved interface", () => {
    const ev = build({
      ppi: {
        ...PPI,
        interactionSites: [{ type: "Region", start: 100, end: 120, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: true }],
        observedInterfaces: [{ accession: "Q8TBC4", name: "NEDD8-activating enzyme E1 catalytic subunit", residues: [115, 116, 117], pdbEntries: 4, homomeric: false, variantAtInterface: true }],
        lookups: { stringPartners: "ok", uniprot: "ok", pdbe: "ok" },
      },
    });
    expect(ev.finding.figure).toBe("In a mapped site");
    expect(ev.finding.headline).toBe("Asp116 is in UniProt's UBA3 interaction site (100–120), and at the interface with UBA3 in 4 solved structures.");
    expect(ev.partners[0]).toMatchObject({ gene: "UBA3", variantInSite: true, variantAtObservedInterface: true });
  });

  it("keeps failures as states, not empty answers", () => {
    const ev = build({ ppi: null, ppiStatus: "error", ppiError: "HTTP 502" });
    expect(ev.sections.string.state).toBe("failed");
    expect(ev.sections.uniprot.state).toBe("failed");
    expect(ev.finding.figure).toBe("Not checked");
  });

  it("links STRING with its documented URL form", () => {
    expect(stringNetworkUrl("NAE1", "UBA3")).toBe("https://string-db.org/cgi/network?identifiers=NAE1%0dUBA3&species=9606");
  });
});
