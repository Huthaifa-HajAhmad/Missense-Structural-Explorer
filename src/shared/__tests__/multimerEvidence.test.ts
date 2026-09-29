import { describe, it, expect } from "vitest";
import { buildMultimerEvidence, iptmBand } from "../multimerEvidence";

/** NAE1 p.Asp116Gly, the variant on the user's screenshot. */
const SUBUNIT = "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2";
const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", residueIndex: 116 },
  uniprotFeatures: {
    subunitComment: SUBUNIT,
    sequenceLength: 534,
    features: [{ type: "Domain", description: "ThiF", start: 20, end: 180 }],
  },
};

const base = {
  gene: "NAE1",
  uniprotId: "Q13564",
  subunitComment: SUBUNIT,
  oligomericState: "Heterodimer",
  chainIds: ["A"],
  chainCount: 1,
  complexPdb: null,
  ipTm: null,
  pTm: null,
  interfaceContacts: [],
  provenance: "UniProt SUBUNIT",
  variantPosition: 116,
  variantAtInterface: null,
  assembly: {
    kind: "heteromer" as const,
    label: "Heterodimer",
    copies: 2,
    homoAssumed: false,
    sentence: "Heterodimer of UBA3 and NAE1.",
    alsoStated: [],
    partners: [{ gene: "UBA3", accession: "Q8TBC4", resolvedBy: "interaction" as const }],
  },
};

describe("buildMultimerEvidence", () => {
  it("never renders the old payload that called NAE1 a monomer", () => {
    const stale: any = { status: "monomeric", gene: "NAE1", uniprotId: "Q13564", oligomericState: "Monomer (Single Chain)", chainCount: 1, chainIds: ["A"], complexPdb: null, ipTm: null, pTm: null, interfaceContacts: [], provenance: "UniProt Curated (Monomeric)", subunitComment: null };
    const ev = buildMultimerEvidence({ result, data: stale, isLoading: false, error: null });
    expect(ev.status).toBe("stale");
    // Curation still comes through from the main analysis' SUBUNIT text.
    expect(ev.assembly.kind).toBe("heteromer");
    expect(ev.finding.headline).not.toMatch(/monomer/i);
  });

  it("states the heterodimer before any model, and says the interface is not measured", () => {
    const ev = buildMultimerEvidence({ result, data: null, isLoading: false, error: null });
    expect(ev.assembly.label).toBe("Heterodimer");
    expect(ev.finding.headline).toBe("NAE1 works as a heterodimer with UBA3, not as a single chain.");
    expect(ev.interface.verdict).toBe("not-measured");
    expect(ev.chains.map(c => c.label)).toEqual(["NAE1", "UBA3"]);
    expect(ev.chains.every(c => !c.modelled)).toBe(true);
  });

  it("lets a solved structure decide the interface, and names the partner and entries", () => {
    const ev = buildMultimerEvidence({
      result,
      data: {
        ...base,
        status: "failed",
        error: "timeout",
        experimental: {
          status: "ok",
          partners: [{ accession: "Q8TBC4", name: "NEDD8-activating enzyme E1 catalytic subunit", residues: [114, 115, 116], pdbEntries: ["1r4m", "1yov"], homomeric: false, variantAtInterface: true }],
        },
      },
      isLoading: false,
      error: null,
    });
    expect(ev.interface).toMatchObject({ verdict: "at-interface", source: "Seen in solved structures" });
    expect(ev.finding.predicate).toContain("Asp116 is at the interface with NEDD8-activating enzyme E1 catalytic subunit in 2 solved structures");
    expect(ev.model.state).toBe("failed");
  });

  it("reports model contacts as contacts, never as disruption", () => {
    const ev = buildMultimerEvidence({
      result,
      data: {
        ...base,
        status: "success",
        chainCount: 2,
        chainIds: ["A", "B"],
        chains: [
          { id: "A", accession: "Q13564", gene: "NAE1", length: 534, carriesVariant: true },
          { id: "B", accession: "Q8TBC4", gene: "UBA3", length: 463, carriesVariant: false },
        ],
        ipTm: 0.84,
        pTm: 0.8,
        complexPdb: "ATOM",
        interfaceContacts: [{ resA: 116, resB: 40, distance: 3.2 }, { resA: 118, resB: 116, distance: 3.0 }],
        provenance: "JapanFold Boltz-2 (Tier 1)",
        variantAtInterface: true,
        experimental: { status: "none", partners: [] },
      },
      isLoading: false,
      error: null,
    });
    expect(ev.model.state).toBe("built");
    // Heteromer: resB is UBA3's numbering, so its 116 is not the variant.
    expect(ev.model.variantContacts).toEqual([{ resA: 116, resB: 40, distance: 3.2 }]);
    expect(ev.finding.predicate).toMatch(/makes 1 contact with another chain \(ipTM 0\.84, confident interface\)/);
    expect(ev.finding.predicate).not.toMatch(/disrupt/i);
    expect(ev.finding.predicate).toMatch(/whether a contact is lost is not measured/);
  });

  it("keeps a failure distinct from not stated and from a monomer", () => {
    const unstated = buildMultimerEvidence({
      result: { ...result, uniprotFeatures: { ...result.uniprotFeatures, subunitComment: null } },
      data: { ...base, subunitComment: null, status: "not-modelled", notModelledReason: "unstated", assembly: { ...base.assembly, kind: "unstated", label: "Not stated", copies: null, sentence: null, partners: [] }, experimental: { status: "error", reason: "PDBe did not answer.", partners: [] } },
      isLoading: false,
      error: null,
    });
    expect(unstated.finding.headline).toBe("UniProt states no assembly for NAE1.");
    expect(unstated.model.stateLabel).toBe("Not available here");
    expect(unstated.experimental.stateLabel).toBe("Provider error");
    expect(unstated.interface.verdict).toBe("not-measured");
  });
});

describe("iptmBand", () => {
  it("follows AlphaFold-Multimer's published guidance at the edges", () => {
    expect(iptmBand(0.81)).toBe("confident");
    expect(iptmBand(0.8)).toBe("grey");
    expect(iptmBand(0.6)).toBe("grey");
    expect(iptmBand(0.59)).toBe("low");
    expect(iptmBand(null)).toBeNull();
  });
});
