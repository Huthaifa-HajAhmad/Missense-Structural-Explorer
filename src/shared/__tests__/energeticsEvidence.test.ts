import { describe, expect, it } from "vitest";
import {
  buildEnergeticsEvidence,
  energeticsAgreementText,
  energeticsSummary,
  signedDdg,
} from "../energeticsEvidence";

/**
 * The Energetics model contract, on the run in the review screenshots: NAE1 p.Asp116Gly
 * (NM_003905.4, Q13564) on experimental structure 1YOV:A.
 *
 * On screen: FoldX +2.62 "± 0.00" on a template not repaired (large structure); DynaMut2 and DDMut
 * "No result"; RaSP "Not covered"; ThermoMPNN −0.36; StabilityOracle −0.06; headline "Calibrated
 * probability of destabilization 24%, 90% conformal interval [20%–29%]", verdict "Moderate Misfolding
 * Risk (Conflicting Stability)". The probability came from hand-typed curves and is gone; what the
 * engines actually say is one of three past its own mark.
 */
const NAE1 = {
  foldx: 2.62,
  foldxMean: 2.62,
  foldxSd: 0,
  foldxRepairFailed: false,
  foldxRepairSkipped: true,
  foldxRepairSkippedReason: "large-structure",
  dynamut2: null,
  ddmut: null,
  rasp: null,
  raspReason: "Residue position is not present in the pre-computed database",
  thermompnn: -0.36,
  stabilityoracle: -0.06,
  structureProvenance: {
    source: "experimental",
    pdbId: "1yov",
    chainId: "A",
    resolution: 2.8,
    foldxRuns: 5,
    raspDatasetSnapshot: "2023-Zenodo-6835877",
    vesmModel: "VESM_150M_v1",
  },
};

function nae1(overrides: Record<string, unknown> = {}) {
  return buildEnergeticsEvidence({
    foldingDdG: 2.62,
    foldingStatus: "success",
    foldingEnergetics: NAE1,
    // Settled with no job id: the cache-hit submission race this change fixes.
    dynamut2Status: null,
    ddmutStatus: null,
    thermompnnStatus: "done",
    isFolding: false,
    plddt: 45,
    ...overrides,
  });
}

describe("energeticsEvidence — the NAE1 p.Asp116Gly reference run", () => {
  it("carries the session-lapse record into the paused outcome", () => {
    // The run remembered which engines its expired session severed (foldxService writes this
    // onto the run's energetics); the evidence model must reflect the cause, not "No result".
    const ev = nae1({
      foldingEnergetics: { ...NAE1, thermompnn: null, energeticsAuthLapsed: { dynamut2: true } },
      dynamut2Status: null,
      thermompnnStatus: null,
    });
    const dynamut2 = ev.readings.find(r => r.key === "dynamut2")!;
    expect(dynamut2.outcome.state).toBe("paused");
    expect(dynamut2.outcome.label).toBe("Paused");
    expect(dynamut2.outcome.reason).toContain("Relink");
    // An engine the session lapse never touched keeps its own truth.
    expect(ev.readings.find(r => r.key === "thermompnn")!.outcome.state).toBe("no-result");
  });

  it("counts engines by their own marks instead of averaging a probability", () => {
    const ev = nae1();
    expect(ev.coverage.computed).toBe(3);
    expect(ev.agreement.nCounted).toBe(3);
    expect(ev.agreement.destabilizing.map(r => r.key)).toEqual(["foldx"]);
    expect(ev.agreement.notDestabilizing.map(r => r.key).sort()).toEqual(["stabilityoracle", "thermompnn"]);
    expect(ev.agreement.direction).toBe("split");
    // Median of +2.62, −0.36, −0.06 is −0.06; the range is the full spread.
    expect(ev.agreement.median).toBeCloseTo(-0.06, 5);
    expect(ev.agreement.min).toBeCloseTo(-0.36, 5);
    expect(ev.agreement.max).toBeCloseTo(2.62, 5);
  });

  it("says the engines disagree, names the one past its mark, and discloses the unrepaired template", () => {
    const s = energeticsSummary(nae1());
    expect(s.tone).toBe("warning");
    expect(s.lead).toBe("The engines disagree: FoldX (+2.62 kcal/mol) is past the destabilizing mark; the other 2 are not.");
    expect(s.rest).toContain("3 of 6 engines returned a value.");
    expect(s.rest.join(" ")).toContain("FoldX ran on an unrepaired template");
    expect([s.lead, ...s.rest].join(" ")).not.toMatch(/probab|calibrat|conformal/i);
  });

  it("does not print an ensemble spread of 0.00 as an error bar", () => {
    const foldx = nae1().readings.find(r => r.key === "foldx")!;
    expect(foldx.note).toBe("Mean of 5 BuildModel runs; run-to-run spread 0.00 kcal/mol, not an error bar.");
    expect(foldx.caveats).toContain("unrepaired-template");
  });

  it("shows the run range when BuildModel's runs disagree, so a bimodal ensemble is visible", () => {
    // SOD1 p.Ala5Val on a repaired template: two rotamer outcomes, three runs near 1.6 and two near 2.9.
    const ev = nae1({ foldingEnergetics: { ...NAE1, foldxMean: 2.12, foldxSd: 0.74, rawDdGs: [2.95, 1.55, 1.61, 2.9, 1.58] } });
    const foldx = ev.readings.find(r => r.key === "foldx")!;
    expect(foldx.note).toBe("Mean of 5 BuildModel runs (+1.55 to +2.95 kcal/mol); run-to-run spread 0.74 kcal/mol, not an error bar.");
  });

  it("does not apply an AlphaFold pLDDT caveat to an experimental structure", () => {
    const ev = nae1();
    expect(ev.lowPlddt).toBeNull();
    expect(ev.readings.flatMap(r => r.caveats)).not.toContain("low-plddt");
    // ...but does on an AlphaFold model.
    const af = nae1({ foldingEnergetics: { ...NAE1, structureProvenance: { source: "alphafold" } } });
    expect(af.lowPlddt).toBe(45);
    expect(af.readings.find(r => r.key === "thermompnn")!.caveats).toContain("low-plddt");
  });

  it("reports the settled remote engines as no-result and RaSP's reported miss as not covered", () => {
    const ev = nae1();
    const state = (k: string) => ev.readings.find(r => r.key === k)!.outcome.state;
    expect(state("dynamut2")).toBe("no-result");
    expect(state("ddmut")).toBe("no-result");
    expect(state("rasp")).toBe("not-covered");
    expect(ev.missing.map(r => r.key).sort()).toEqual(["ddmut", "dynamut2", "rasp"]);
  });

  it("names a dataset or model in the sources only when the engine that uses it returned a value", () => {
    const labels = nae1().sources.map(([label]) => label);
    expect(labels).toContain("Template");
    expect(labels).toContain("FoldX runs");
    // RaSP returned nothing, so its table is not a source of anything on screen.
    expect(labels).not.toContain("RaSP table");
    expect(labels.join(" ")).not.toMatch(/embedding|VESM/i);
  });

  it("gives the report and export the same sentence the tab states", () => {
    const text = energeticsAgreementText(NAE1)!;
    expect(text).toContain("The engines disagree");
    expect(text).toContain("Median −0.06 kcal/mol");
    expect(text).not.toMatch(/P =|CI|probab/);
  });
});

describe("energeticsEvidence — edge cases", () => {
  it("normalizes DynaMut2's native sign before judging it", () => {
    const ev = buildEnergeticsEvidence({ foldingEnergetics: { foldx: null, dynamut2: -1.8 }, dynamut2Status: "done" });
    const d2 = ev.readings.find(r => r.key === "dynamut2")!;
    expect(d2.ddg).toBeCloseTo(1.8, 5);
    expect(d2.callLabel).toBe("Destabilizing");
    expect(signedDdg(d2.ddg)).toBe("+1.80 kcal/mol");
  });

  it("calls a single engine a single engine", () => {
    const ev = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.0, foldxMean: 2.0 }, foldingStatus: "success" });
    const s = energeticsSummary(ev);
    expect(ev.agreement.direction).toBe("destabilizing");
    expect(s.lead).toBe("Only FoldX (+2.00 kcal/mol) returned a value, and it is past its destabilizing mark.");
    expect(s.rest[0]).toContain("too few to read as agreement");
    expect(s.tone).toBe("warning");
  });

  it("shows an excluded FoldX value without counting it", () => {
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: { foldx: 3.1, foldxMean: 3.1, foldxRepairFailed: true, thermompnn: 0.2 },
      foldingStatus: "success",
      thermompnnStatus: "done",
    });
    const foldx = ev.readings.find(r => r.key === "foldx")!;
    expect(foldx.ddg).toBeCloseTo(3.1, 5);
    expect(foldx.counted).toBe(false);
    expect(foldx.callLabel).toBe("Not counted");
    expect(ev.agreement.nCounted).toBe(1);
    expect(ev.agreement.destabilizing).toHaveLength(0);
  });

  it("says nothing has returned while the run is in flight", () => {
    const ev = buildEnergeticsEvidence({ foldingEnergetics: null, isFolding: true });
    expect(ev.agreement.direction).toBe("none");
    expect(energeticsSummary(ev).lead).toBe("No engine has returned a ΔΔG yet.");
    expect(ev.running.length).toBeGreaterThan(0);
  });
});

describe("energeticsEvidence — RaSP coverage and source come from the installed index", () => {
  it("states the index's own coverage when the server sends it", () => {
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: {
        rasp: null,
        raspReason: "Residue position is not present in the pre-computed database",
        raspCoverage: { proteins: 23391, sources: { experimental: 1345, alphafold: 23391 } },
      },
    });
    const rasp = ev.readings.find(r => r.key === "rasp")!;
    expect(rasp.outcome.state).toBe("not-covered");
    expect(rasp.outcome.reason).toContain("cover 23,391 human proteins, including the AlphaFold proteome predictions");
  });

  it("falls back to the default experimental-set statement on older payloads", () => {
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: { rasp: null, raspReason: "Residue position is not present in the pre-computed database" },
    });
    expect(ev.readings.find(r => r.key === "rasp")!.outcome.reason).toContain("1,345 human proteins with experimental structures");
  });

  it("names the table that served a value, and only then", () => {
    const af = buildEnergeticsEvidence({ foldingEnergetics: { rasp: 1.2, raspSource: "alphafold" } });
    expect(af.readings.find(r => r.key === "rasp")!.note).toBe("From the AlphaFold proteome (UP000005640 v2) table.");
    expect(af.sources).toContainEqual(["RaSP table", "AlphaFold proteome (UP000005640 v2)"]);
    const exp = buildEnergeticsEvidence({ foldingEnergetics: { rasp: 1.2, raspSource: "experimental" } });
    expect(exp.readings.find(r => r.key === "rasp")!.note).toContain("structure numbering");
    const legacy = buildEnergeticsEvidence({ foldingEnergetics: { rasp: 1.2 } });
    expect(legacy.readings.find(r => r.key === "rasp")!.note).toBeNull();
  });
});

describe("energeticsEvidence — marks follow the display unit", () => {
  it("converts marks and axis ends to kJ/mol instead of leaving kcal beside kJ values", async () => {
    const { markText, DDG_AXIS } = await import("../energeticsEvidence");
    expect(markText(1.5)).toBe("+1.5");
    expect(markText(-3)).toBe("−3");
    expect(markText(1.5, "kJ/mol")).toBe("+6.3");
    expect(markText(DDG_AXIS.max, "kJ/mol")).toBe("+20.9");
    expect(markText(DDG_AXIS.min, "kJ/mol")).toBe("−12.6");
  });
});
