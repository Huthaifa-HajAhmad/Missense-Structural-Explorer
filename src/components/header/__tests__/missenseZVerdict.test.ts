import { describe, it, expect } from "vitest";
import { buildMissenseZMetric } from "../constraintMetrics";

// Fixed in 93ee30b and lost in the header merge (14f1bf2 / 7746935); found again auditing SOD1 (Z +0.84).
describe("Missense Z verdict", () => {
  it("does not call a positive Z below the constraint range tolerant", () => {
    for (const z of [0.84, 1.09, 1.99]) expect(buildMissenseZMetric(z).verdict).toBe("Not constrained");
  });
  it("calls Z of 0 or less nondepleted, 2 to 3.09 constrained, and 3.09 or more severe", () => {
    expect(buildMissenseZMetric(0).verdict).toBe("No depletion");
    expect(buildMissenseZMetric(-1.4).verdict).toBe("No depletion");
    expect(buildMissenseZMetric(2.04).verdict).toBe("Constrained");
    expect(buildMissenseZMetric(3.2).verdict).toBe("Severe intolerance");
  });
});
