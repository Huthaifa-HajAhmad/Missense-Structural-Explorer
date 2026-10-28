import { describe, expect, it } from "vitest";
import { computeStabilityConsensus } from "../thresholds";
import {
  AGREEMENT_CHIP,
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

  it("calls a two-thirds majority with one moderate exception 'mostly no destabilization'", () => {
    // UROD p.Gly318Arg, the run that produced the exception: four engines below their supporting
    // mark, DynaMut2 at +0.528 against its +0.50 moderate mark. One engine past a weaker mark is not
    // "the engines disagree", but the exception must stay visible.
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: {
        dynamut2: -0.528, ddmut: -0.03, rasp: -1.4533, thermompnn: -0.106, stabilityoracle: -0.5034,
        stabilityoracleStatus: "done", raspStatus: "done",
      },
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });
    expect(ev.agreement.nCounted).toBe(5);
    expect(ev.agreement.moderate.map(r => r.key)).toEqual(["dynamut2"]);
    expect(ev.agreement.direction).toBe("mostly-not-destabilizing");
    expect(ev.agreement.verdict).toBe("No Destabilization Predicted (Most Engines)");
    expect(AGREEMENT_CHIP[ev.agreement.direction].label).toBe("Mostly no destabilization");
    const s = energeticsSummary(ev);
    expect(s.lead).toContain("4 of the 5 counted engines");
    expect(s.lead).toContain("DynaMut2 (+0.53 kcal/mol)");
    expect(s.lead).toContain("moderately destabilizing band");
    // A majority reading is still something to reconcile.
    expect(s.tone).toBe("warning");
  });

  it("keeps a genuine contradiction split: one engine past a DESTABILIZING mark is not a majority", () => {
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: { foldx: 2.6, dynamut2: 0.21, ddmut: 0.03, thermompnn: -0.1, stabilityoracle: 0.2, stabilityoracleStatus: "done" },
      foldingStatus: "success",
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });
    expect(ev.agreement.nCounted).toBe(5);
    expect(ev.agreement.direction).toBe("split");
    expect(energeticsSummary(ev).lead).toContain("engines disagree");
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
    expect(s.lead).toBe("FoldX (+2.00 kcal/mol) is the only counted engine, and it is past its destabilizing mark.");
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

/**
 * ProtVar's precomputed FoldX is FoldX again, on EBI's AlphaFold model: a reference row. It must be
 * visible with its own provenance and never change what the counted engines say.
 */
describe("ProtVar FoldX reference row", () => {
  const withProtvar = (extra: Record<string, unknown> = {}) =>
    buildEnergeticsEvidence({
      foldingStatus: "success",
      foldingEnergetics: {
        foldx: 2.62, foldxMean: 2.62, dynamut2: -1.9, ddmut: -1.4,
        protvar: 2.09, protvarStatus: "done", protvarPlddt: 49.5, protvarModel: "AF-P15056-F1",
        ...extra,
      },
    });

  it("shows the value, marked not counted, with its model and pLDDT", () => {
    const row = withProtvar().readings.find(r => r.key === "protvar")!;
    expect(row.ddg).toBe(2.09);
    expect(row.counted).toBe(false);
    expect(row.callLabel).toBe("Not counted");
    expect(row.outcome.risk).toBeNull();
    expect(row.caveats).toEqual(["excluded", "low-plddt"]);
    expect(row.note).toContain("AF-P15056-F1");
    expect(row.note).toContain("pLDDT 49.5");
    // It is FoldX, so it sits in the force-field group beside the local run.
    expect(row.group).toBe("physics");
  });

  it("changes neither the agreement nor the coverage of the counted engines", () => {
    const withIt = withProtvar();
    const without = withProtvar({ protvar: null, protvarStatus: null });
    expect(withIt.agreement).toEqual(without.agreement);
    expect(withIt.coverage.label).toBe("3 of 6 engines");
    expect(withIt.coverage).toEqual(without.coverage);
  });

  it("takes the pLDDT caveat from ProtVar's own model, not this run's template", () => {
    const confident = withProtvar({ protvarPlddt: 92 }).readings.find(r => r.key === "protvar")!;
    expect(confident.caveats).not.toContain("low-plddt");
  });

  it("never holds the run 'running' or reports it missing", () => {
    expect(withProtvar({ protvar: null, protvarStatus: "pending" }).running).toEqual([]);
    const errored = withProtvar({ protvar: null, protvarStatus: "error", protvarError: "ProtVar answered HTTP 503" });
    expect(errored.missing.map(r => r.key)).not.toContain("protvar");
    // …while the row itself still says what happened.
    expect(errored.readings.find(r => r.key === "protvar")!.outcome.state).toBe("upstream-error");
  });

  it("says why there is no value when ProtVar answered without one", () => {
    const row = withProtvar({ protvar: null, protvarReason: "ProtVar's AlphaFold fragment models disagree at this residue" })
      .readings.find(r => r.key === "protvar")!;
    expect(row.ddg).toBeNull();
    expect(row.outcome.state).toBe("not-covered");
  });
});

/**
 * One FoldX reading counts, and two FoldX values are a cross-check. The local run is the FoldX reading
 * whenever it has a value; ProtVar's precomputed value is it only when there is no local value and the
 * template is the AlphaFold model (see FOLDX_STAND_IN_RULE).
 */
describe("FoldX on two templates", () => {
  const experimental = { source: "experimental", pdbId: "1yov", chainId: "A", resolution: 2.8, foldxRuns: 5 };
  const alphafold = { source: "alphafold", foldxRuns: 5 };
  const build = (energetics: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    buildEnergeticsEvidence({
      foldingStatus: "success",
      foldingEnergetics: {
        dynamut2: 0.8, ddmut: 0.6, thermompnn: 0.4,
        protvarStatus: "done", protvarPlddt: 91, protvarModel: "AF-Q13564-F1",
        ...energetics,
      },
      ...extra,
    });

  describe("cross-check (both values exist)", () => {
    it('keeps the summary numerator and denominator on the same engine set when ProtVar is present', () => {
      const ev = build({ foldx: 2.6, foldxMean: 2.6, protvar: 2.4, rasp: 1.7, stabilityoracle: 1.8, structureProvenance: experimental });
      expect(ev.coverage.intended).toBe(6);
      expect(ev.agreement.nCounted).toBe(6);
      expect(energeticsSummary(ev).rest.join(' ')).toContain('6 of 6 engines returned a value');
      expect(energeticsSummary(ev).rest.join(' ')).not.toContain('7 of 6');
    });
    const check = (local: number, protvar: number, structureProvenance: object = experimental) =>
      build({ foldx: local, foldxMean: local, protvar, structureProvenance }).foldxTemplateCheck!;

    it("is consistent when close and in the same band", () => {
      const c = check(1.6, 1.9);
      expect(c.state).toBe("consistent");
      expect(c.delta).toBeCloseTo(0.3);
      expect(c.tone).toBe("neutral");
    });

    it("differs when the gap reaches the local difference mark, or the values land in different bands", () => {
      expect(check(2.6, 1.4).state).toBe("differs"); // 1.2 apart
      expect(check(1.4, 1.6).state).toBe("differs"); // 0.2 apart, but across the destabilizing mark (1.5)
      expect(check(2.6, 1.4).tone).toBe("warning");
    });

    it("is opposite only when the signs differ and both are clear of zero", () => {
      expect(check(1.2, -1.1).state).toBe("opposite");
      expect(check(0.3, -0.2).state).not.toBe("opposite");
    });

    it("names both templates and says a gap is not an error bar", () => {
      const c = check(2.62, 1.12);
      expect(c.localTemplate).toBe("1YOV:A (experimental, 2.8 Å)");
      expect(c.protvarTemplate).toBe("AF-Q13564-F1");
      expect(c.detail).toContain("not an error bar");
      expect(c.sameTemplateKind).toBe(false);
    });

    it("blames the pipeline, not the template, when both ran on an AlphaFold model", () => {
      const c = check(2.0, 0.9, alphafold);
      expect(c.sameTemplateKind).toBe(true);
      expect(c.detail).toContain("pipeline");
    });

    it("never adds a second FoldX vote to the agreement or the coverage", () => {
      const withBoth = build({ foldx: 2.6, foldxMean: 2.6, protvar: 2.4, structureProvenance: experimental });
      const localOnly = build({ foldx: 2.6, foldxMean: 2.6, structureProvenance: experimental });
      expect(withBoth.agreement).toEqual(localOnly.agreement);
      expect(withBoth.coverage).toEqual(localOnly.coverage);
      expect(withBoth.foldxStandIn).toBeNull();
    });

    it("is absent when either value is missing", () => {
      expect(build({ foldx: 2.6, foldxMean: 2.6, structureProvenance: experimental }).foldxTemplateCheck).toBeNull();
      expect(build({ protvar: 2.4, structureProvenance: experimental }).foldxTemplateCheck).toBeNull();
    });

    it("puts ProtVar's row straight after FoldX's, and says so in the finding", () => {
      const ev = build({ foldx: 2.6, foldxMean: 2.6, protvar: 1.2, structureProvenance: experimental });
      expect(ev.readings.slice(0, 2).map(r => r.key)).toEqual(["foldx", "protvar"]);
      expect(energeticsSummary(ev).rest.join(" ")).toContain("The two FoldX values differ by 1.40 kcal/mol");
      expect(energeticsSummary(ev).tone).toBe("warning");
    });
  });

  describe("stand-in (no local value)", () => {
    const standIn = (structureProvenance: object, extra: Record<string, unknown> = {}) =>
      build({ foldx: null, foldxMean: null, protvar: 1.9, structureProvenance, ...extra }, { foldingStatus: "failed" });

    it("counts ProtVar as THE FoldX reading when the template is the AlphaFold model", () => {
      const ev = standIn(alphafold);
      const foldx = ev.readings.find(r => r.key === "foldx")!;
      expect(foldx.ddg).toBe(1.9);
      expect(foldx.counted).toBe(true);
      expect(foldx.caveats).toContain("protvar-stand-in");
      expect(foldx.note).toContain("AF-Q13564-F1");
      expect(ev.foldxStandIn).toEqual({ model: "AF-Q13564-F1", plddt: 91 });
      // 4 counted: FoldX (as ProtVar) + DynaMut2 + DDMut + ThermoMPNN. Never 7 engines.
      expect(ev.agreement.nCounted).toBe(4);
      expect(ev.coverage.label).toBe("4 of 6 engines");
    });

    it("shows the value once: ProtVar's own row is not listed a second time", () => {
      expect(standIn(alphafold).readings.map(r => r.key)).not.toContain("protvar");
      expect(standIn(alphafold).foldxTemplateCheck).toBeNull();
    });

    it("is not an excluded value even when the local run's repair failed or its binary is missing", () => {
      const ev = standIn(alphafold, { foldxRepairFailed: true, foldxBinaryMissing: true });
      expect(ev.readings.find(r => r.key === "foldx")!.counted).toBe(true);
    });

    it("does NOT apply on an experimental or homology template: ProtVar would describe another structure", () => {
      for (const source of ["experimental", "homolog", "client-provided"]) {
        const ev = standIn({ source });
        expect(ev.foldxStandIn).toBeNull();
        expect(ev.readings.find(r => r.key === "foldx")!.ddg).toBeNull();
        expect(ev.readings.find(r => r.key === "protvar")!.counted).toBe(false);
      }
    });

    it("does NOT apply when the template is unknown", () => {
      expect(build({ foldx: null, protvar: 1.9 }).foldxStandIn).toBeNull();
    });

    it("never replaces a local value, even an excluded one", () => {
      const ev = build({ foldx: 0.4, foldxMean: 0.4, protvar: 1.9, foldxRepairFailed: true, structureProvenance: alphafold });
      expect(ev.foldxStandIn).toBeNull();
      expect(ev.readings.find(r => r.key === "foldx")!.ddg).toBe(0.4);
    });

    it("gives the stored verdict, the export and the screen the same answer", () => {
      const energetics = { foldx: null, foldxMean: null, protvar: 1.9, dynamut2: -0.8, ddmut: -0.6, thermompnn: 0.4, structureProvenance: alphafold };
      const screen = buildEnergeticsEvidence({ foldingEnergetics: energetics }).agreement;
      const stored = computeStabilityConsensus(energetics);
      expect(stored.consensusVerdict).toBe(screen.verdict);
      expect(stored.enginesCounted).toBe(screen.nCounted);
      expect(stored.enginesCounted).toBe(4);
    });
  });
});
