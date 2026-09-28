/**
 * guidelines.test.ts — Threshold Guide shared row model.
 *
 * The payload mirrors the MACO1 p.Glu433Lys analysis so the statuses the table
 * and the inspector roll-up render can be pinned against known values. The
 * builder is the single source both panes consume; these tests keep the
 * cut-point logic from drifting when either surface is edited.
 */
import { describe, it, expect } from "vitest";
import {
  buildGuidelinesRows,
  summarizeGuidelinesRows,
  guidelinesGroup,
  guidelinesBandPct,
  type GuidelinesRow
} from "./guidelines.ts";

const MACO1_RESULT: any = {
  predictorData: {
    caddPhred: 32.0,
    amPathogenicity: 0.933,
    amClass: "pathogenic"
  },
  conservationData: {
    revel: 0.527,
    bayesdel: 0.125,
    metarnn: 0.836,
    clinpred: 0.923,
    eigenPhred: 11.7,
    dann: 0.999,
    popeve: -4.235,
    esm1b: -13.54,
    gerp: 6.03,
    phylop: 9.57
  },
  esmcEval: { llr: -8.43 },
  dynamut2: null,
  ddmut: null,
  rasp: null,
  thermompnn: null,
  misZ: 3.13,
  loeuf: null
};

function rowMap(rows: GuidelinesRow[]): Record<string, GuidelinesRow> {
  return Object.fromEntries(rows.map(r => [r.key, r]));
}

describe("buildGuidelinesRows", () => {
  it("builds the full 20-metric table in the three documented categories", () => {
    const rows = buildGuidelinesRows({ result: MACO1_RESULT, foldingDdG: -0.97 });
    expect(rows).toHaveLength(20);
    expect(rows.filter(r => r.category === 1)).toHaveLength(11);
    expect(rows.filter(r => r.category === 2)).toHaveLength(5);
    expect(rows.filter(r => r.category === 3)).toHaveLength(4);
  });

  it("reproduces the MACO1 verdicts printed in the guide", () => {
    const byKey = rowMap(buildGuidelinesRows({ result: MACO1_RESULT, foldingDdG: -0.97 }));

    // In-silico rows read the ClinGen bands (calibration.ts): Pejaver 2022, Bergquist 2025.
    expect(byKey.revel.status).toBe("vus");           // 0.527: between BP4 ≤ 0.290 and PP3 ≥ 0.644
    expect(byKey.revel.matchLabel).toBe("Indeterminate");
    expect(byKey.am.status).toBe("path_strong");      // 0.933 ≥ 0.906 → PP3 Moderate
    expect(byKey.am.matchLabel).toBe("PP3 Moderate");
    expect(byKey.cadd.status).toBe("path_strong");    // 32 ≥ 28.1 → PP3 Moderate
    expect(byKey.bayesdel.status).toBe("vus");        // 0.125 < 0.13
    expect(byKey.popeve.status).toBe("vus");          // -4.235 > the authors' -4.617
    expect(byKey.esm.status).toBe("path_strong");     // -13.54 ≤ -12.2 → PP3 Moderate
    expect(byKey.eigen.matchLabel).toBe("Informational"); // no published cut-point
    expect(byKey.dann.band).toBeNull();
    expect(byKey.esmc.matchLabel).toBe("Informational");
    expect(byKey.esmc.band).toBeNull();               // no calibrated scale
    expect(byKey.foldx.status).toBe("neutral");       // -0.97 stabilizing
    expect(byKey.foldx.matchLabel).toBe("Stabilizing");
    expect(byKey.misZ.status).toBe("path_strong");    // 3.13 >= 3.09
    expect(byKey.gerp.status).toBe("vus");            // GERP++ has no PP3 band (Pejaver 2022)
    expect(byKey.phylop.status).toBe("path");         // 9.57 ≥ 7.367 → PP3 Supporting
  });

  it("falls back through the energetics payload the same way the tab did", () => {
    const byKey = rowMap(buildGuidelinesRows({
      result: MACO1_RESULT,
      foldingDdG: null,
      foldingEnergetics: { dynamut2: -1.42, ddmut: -0.09, rasp: 0.8, thermompnn: -0.03 } as any
    }));
    expect(byKey.foldx.value).toBeNull();
    expect(byKey.dynamut2.status).toBe("path");       // -1.42 <= -1.0
    expect(byKey.ddmut.status).toBe("benign");        // -0.09 > -1.0
    expect(byKey.rasp.status).toBe("path");           // 0.8 > 0.5
    expect(byKey.thermompnn.status).toBe("benign");   // -0.03 < 1.0
  });

  it("marks missing scores as no-data rather than benign", () => {
    const emptyResult: any = {};
    const byKey = rowMap(buildGuidelinesRows({ result: emptyResult, foldingDdG: null }));
    expect(byKey.revel.value).toBeNull();
    expect(guidelinesGroup(byKey.revel)).toBe("nodata");
    expect(byKey.loeuf.value).toBeNull();
  });
});

describe("summarizeGuidelinesRows", () => {
  it("partitions the MACO1 payload into groups that sum to the total", () => {
    const rows = buildGuidelinesRows({ result: MACO1_RESULT, foldingDdG: -0.97 });
    const s = summarizeGuidelinesRows(rows);
    expect(s.total).toBe(20);
    expect(
      s.pathSupporting.length + s.benignSupporting.length + s.vus.length +
      s.informational.length + s.noData.length
    ).toBe(s.total);

    // Every populated score lands in a matched group; the unset ΔΔG engines
    // and LOEUF are awaiting data.
    expect(s.noData.map(r => r.key)).toEqual(["dynamut2", "ddmut", "rasp", "thermompnn", "loeuf"]);
    expect(s.informational.map(r => r.key)).toEqual(["eigen", "dann", "esmc"]);
    expect(s.pathSupporting).toContainEqual(expect.objectContaining({ key: "cadd" }));
    expect(s.benignSupporting).toContainEqual(expect.objectContaining({ key: "foldx" }));
  });
});

describe("guidelinesBandPct", () => {
  const band = { min: 0, max: 1, segments: [], ticks: [] };
  it("positions values inside the window", () => {
    expect(guidelinesBandPct(0.5, band)).toBeCloseTo(50);
  });
  it("clamps values outside the display window", () => {
    expect(guidelinesBandPct(-15, { ...band, min: -14, max: 0 })).toBe(0);
    expect(guidelinesBandPct(32, { ...band, min: 0, max: 30 })).toBe(100);
  });
  it("degenerates safely on a zero-span window", () => {
    expect(guidelinesBandPct(5, { ...band, min: 3, max: 3 })).toBe(0);
  });
});
