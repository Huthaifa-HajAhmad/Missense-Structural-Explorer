import { describe, it, expect } from "vitest";
import { buildPackingEvidence, type PackingEvidenceInput } from "../packingEvidence";
import { NAE1_ENERGETICS } from "./fixtures/nae1Packing";

const build = (over: Partial<PackingEvidenceInput> = {}) =>
  buildPackingEvidence({ foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, ...over });

describe("buildPackingEvidence — NAE1 p.Asp116Gly", () => {
  it("does not attach the ΔΔG SD to the VdW term, and uses only local marks", () => {
    const vdw = build().readings.find(r => r.key === "vdw")!;
    expect(vdw.text).toBe("+0.62");
    expect(vdw.text).not.toContain("±");
    expect(vdw.markKind).toBe("local");
    expect(vdw.call).toEqual({ label: "Below clash mark", tone: "neutral" });
    expect(build().runsIdentical).toBe(true);
  });

  it("reports Cα displacement on FoldX's rigid backbone as not measured, never as 0", () => {
    const ev = build({
      structuralDiff: { rmsd: 0, localRmsd: 0, windowDisplacements: [{ resSeq: 116, resName: "ASP", displacement: 0 }], clashes: { wtClashCount: 2, mutClashCount: 2, diff: 0 } }
    });
    const ca = ev.readings.find(r => r.key === "ca-max")!;
    expect(ev.rigidBackbone).toBe(true);
    expect(ca.value).toBeNull();
    expect(ca.availability.label).toBe("Not measured");
  });

  it("names what the neighbour side-chain RMSD was measured against", () => {
    const paired = build({ foldingEnergetics: { ...NAE1_ENERGETICS, localSidechainRmsd: 0.41, localSidechainRmsdReference: "foldx-paired" } });
    expect(paired.readings.find(r => r.key === "neighbour-rmsd")!.note).toBe("Against FoldX's paired wild type from the same run");
    // Results cached before the pair was kept were measured against the input template.
    const older = build({ foldingEnergetics: { ...NAE1_ENERGETICS, localSidechainRmsd: 0.41 } });
    expect(older.readings.find(r => r.key === "neighbour-rmsd")!.note).toMatch(/before RepairPDB/);
  });

  it("keeps absent contact counts absent instead of printing 0", () => {
    const contacts = build().readings.find(r => r.key === "contacts")!;
    expect(contacts.value).toBeNull();
    expect(contacts.text).toBe("—");
  });
});

describe("buildPackingEvidence — the FoldX leg's state", () => {
  it("names a failed FoldX run instead of 'not built'", () => {
    const failed = buildPackingEvidence({ foldingStatus: "failed", foldingError: "RepairPDB exceeded its time budget." });
    expect(failed.reason).toBe("The FoldX run failed: RepairPDB exceeded its time budget.");
    expect(buildPackingEvidence({}).reason).toBe("No FoldX mutant model was built for this variant.");
  });

  it("records the FoldX leg's state, so the table needs no folding flags of its own", () => {
    const state = (over: Partial<PackingEvidenceInput>) => buildPackingEvidence(over).state;
    expect(state({ isFolding: true, foldingStatus: "failed" })).toBe("pending");
    expect(state({ foldingStatus: "failed" })).toBe("failed");
    expect(state({ foldingError: "RepairPDB exceeded its time budget." })).toBe("failed");
    expect(state({})).toBe("absent");
    expect(state({ foldingEnergetics: NAE1_ENERGETICS })).toBe("computed");
  });
});

describe("buildPackingEvidence — method, input confidence and figures", () => {
  const diff = { rmsd: 0, localRmsd: 0, windowDisplacements: [], clashes: { wtClashCount: 2, mutClashCount: 5, diff: 3 } };

  it("states FoldX's fixed backbone from the recorded method, not from a zero RMSD", () => {
    const recorded = build({ structuralDiff: { ...diff, rmsd: 0.4, mutantModel: "foldx-buildmodel" } });
    expect(recorded.rigidBackbone).toBe(true);
    expect(recorded.method).toMatch(/^FoldX BuildModel/);
    expect(build({ structuralDiff: diff }).method).toMatch(/RMSD 0/);
  });

  it("carries clash counts and contact change as numbers for the figures", () => {
    const ev = build({ structuralDiff: diff, metrics: { lostContacts: 3, gainedContacts: 1, deltaSasa: 4.2 } });
    expect(ev.clashCounts).toEqual({ wt: 2, mut: 5 });
    expect(ev.contactChange).toEqual({ lost: 3, gained: 1 });
  });

  it("reads the site pLDDT only when the B-factor column holds pLDDT", () => {
    const at = (bFactorKind: string) => build({ site: { plddt: 42.1, bFactorKind } }).inputConfidence;
    expect(at("plddt")).toEqual({ plddt: 42.1, band: expect.any(String) });
    expect(at("temperature-factor")).toBeNull();
  });
});
