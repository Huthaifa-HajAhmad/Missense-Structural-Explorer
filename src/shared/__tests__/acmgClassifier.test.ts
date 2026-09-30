import { describe, it, expect } from "vitest";
import { classifyVariant, codeWeight, WEIGHT } from "../acmgClassifier";

const c = (...codes: string[]) => codes.map(code => ({ code, reason: "" }));

/**
 * Richards et al. 2015, Table 5. Each row below is one combination the table names; the tier is the
 * table's, not the engine's previous behaviour.
 */
describe("classifyVariant — Richards 2015 Table 5, Pathogenic (i) with PVS1", () => {
  it.each([
    ["(a) PVS1 + 1 Strong", c("PVS1", "PS1")],
    ["(b) PVS1 + 2 Moderate", c("PVS1", "PM1", "PM4")],
    ["(c) PVS1 + 1 Moderate + 1 Supporting", c("PVS1", "PM1", "PP3")],
    ["(d) PVS1 + 2 Supporting", c("PVS1", "PP3", "PP2")],
    ["(d) PVS1 + 3 Supporting", c("PVS1", "PP3", "PP2", "PP1")],
  ])("%s is Pathogenic", (_row, criteria) => {
    expect(classifyVariant(criteria)).toBe("Pathogenic");
  });

  it("PVS1 + 1 Moderate is Likely Pathogenic (LP (i))", () => {
    expect(classifyVariant(c("PVS1", "PM1"))).toBe("Likely Pathogenic");
  });

  it("PVS1 + 1 Supporting is Likely Pathogenic (ClinGen SVI PM2 recommendation's added combination)", () => {
    expect(classifyVariant(c("PVS1", "PP3"))).toBe("Likely Pathogenic");
    expect(classifyVariant(c("PVS1", "PM2"))).toBe("Likely Pathogenic");
  });

  it("PVS1 alone stays uncertain", () => {
    expect(classifyVariant(c("PVS1"))).toBe("Variant of Uncertain Significance (VUS)");
  });

  it("conflicting evidence stays uncertain: PVS1 + 2 PP with BS1 + BP4", () => {
    expect(classifyVariant(c("PVS1", "PP3", "PP2", "BS1", "BP4"))).toBe("Variant of Uncertain Significance (VUS)");
  });
});

describe("classifyVariant — rows the change must not have disturbed", () => {
  it("2 Strong is Pathogenic; 1 Strong + 1 Moderate is Likely Pathogenic", () => {
    expect(classifyVariant(c("PS1", "PS3"))).toBe("Pathogenic");
    expect(classifyVariant(c("PS1", "PM1"))).toBe("Likely Pathogenic");
  });

  it("3 Moderate is Likely Pathogenic; 1 Moderate + 1 Supporting is not enough", () => {
    expect(classifyVariant(c("PM1", "PM4", "PM5"))).toBe("Likely Pathogenic");
    expect(classifyVariant(c("PM1", "PP3"))).toBe("Variant of Uncertain Significance (VUS)");
  });

  it("1 Moderate + 2 Supporting meets no Table 5 row; 2 Moderate + 2 Supporting is Likely Pathogenic", () => {
    expect(classifyVariant(c("PM1", "PP2", "PP3"))).toBe("Variant of Uncertain Significance (VUS)");
    expect(classifyVariant(c("PM1", "PM4", "PP2", "PP3"))).toBe("Likely Pathogenic");
  });

  it("BA1 is stand-alone benign", () => {
    expect(classifyVariant(c("BA1", "PVS1", "PS1"))).toBe("Benign");
  });
});

/** ClinGen SVI PM2 recommendation v1.0 (Sept 2020): PM2 is Supporting, not Moderate. */
describe("classifyVariant — PM2 is applied at Supporting strength", () => {
  it("counts as one Supporting criterion, never as a Moderate one", () => {
    expect(codeWeight("PM2")).toBe(WEIGHT.PP);
    expect(codeWeight("PM2_Supporting")).toBe(WEIGHT.PP);
    expect(codeWeight("PM1")).toBe(WEIGHT.PM);
  });

  it("does not satisfy a Moderate slot", () => {
    // Richards: 3 Moderate is Likely Pathogenic. PM1 + PM4 + PM2 is now 2 Moderate + 1 Supporting.
    expect(classifyVariant(c("PM1", "PM4", "PM2"))).toBe("Variant of Uncertain Significance (VUS)");
    // 1 Strong + 1 Moderate is Likely Pathogenic; 1 Strong + PM2 (Supporting) is not.
    expect(classifyVariant(c("PS1", "PM2"))).toBe("Variant of Uncertain Significance (VUS)");
  });

  it("re-tiers PM2 combinations toward less pathogenic, and only those", () => {
    // PVS1 + PM1 + PM2 is now PVS1 + 1 Moderate + 1 Supporting: still Pathogenic via Table 5 (i)(c).
    expect(classifyVariant(c("PVS1", "PM1", "PM2"))).toBe("Pathogenic");
    // PS1 + PM2 was Likely Pathogenic (1 Strong + 1 Moderate); Strong + Supporting is not.
    expect(classifyVariant(c("PS1", "PM2"))).toBe("Variant of Uncertain Significance (VUS)");
    // PM1 + PM4 + PM2 was Likely Pathogenic (3 Moderate).
    expect(classifyVariant(c("PM1", "PM4", "PM2"))).toBe("Variant of Uncertain Significance (VUS)");
    // The NAE1 shape is unchanged: PM2 + PP3 was uncertain and still is.
    expect(classifyVariant(c("PM2", "PP3"))).toBe("Variant of Uncertain Significance (VUS)");
  });
});
