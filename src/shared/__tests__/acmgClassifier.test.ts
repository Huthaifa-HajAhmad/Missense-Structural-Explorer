import { describe, it, expect } from "vitest";
import { classifyVariant } from "../acmgClassifier";

const c = (...codes: string[]) => codes.map(code => ({ code, reason: "" }));

/**
 * Richards et al. 2015, Table 5. Each row below is one combination the table names; the tier is the
 * table's, not the engine's previous behaviour.
 */
describe("classifyVariant — Richards 2015 Table 5, Pathogenic (i) with PVS1", () => {
  it.each([
    ["(a) PVS1 + 1 Strong", c("PVS1", "PS1")],
    ["(b) PVS1 + 2 Moderate", c("PVS1", "PM1", "PM4")],
    ["(c) PVS1 + 1 Moderate + 1 Supporting", c("PVS1", "PM2", "PP3")],
    ["(d) PVS1 + 2 Supporting", c("PVS1", "PP3", "PP2")],
    ["(d) PVS1 + 3 Supporting", c("PVS1", "PP3", "PP2", "PP1")],
  ])("%s is Pathogenic", (_row, criteria) => {
    expect(classifyVariant(criteria)).toBe("Pathogenic");
  });

  it("PVS1 + 1 Moderate is Likely Pathogenic (LP (i))", () => {
    expect(classifyVariant(c("PVS1", "PM2"))).toBe("Likely Pathogenic");
  });

  it("PVS1 + 1 Supporting meets no Table 5 row and stays uncertain", () => {
    expect(classifyVariant(c("PVS1", "PP3"))).toBe("Variant of Uncertain Significance (VUS)");
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
    expect(classifyVariant(c("PM1", "PM2", "PM4"))).toBe("Likely Pathogenic");
    expect(classifyVariant(c("PM2", "PP3"))).toBe("Variant of Uncertain Significance (VUS)");
  });

  it("1 Moderate + 2 Supporting meets no Table 5 row; 2 Moderate + 2 Supporting is Likely Pathogenic", () => {
    expect(classifyVariant(c("PM2", "PP2", "PP3"))).toBe("Variant of Uncertain Significance (VUS)");
    expect(classifyVariant(c("PM1", "PM2", "PP2", "PP3"))).toBe("Likely Pathogenic");
  });

  it("BA1 is stand-alone benign", () => {
    expect(classifyVariant(c("BA1", "PVS1", "PS1"))).toBe("Benign");
  });
});
