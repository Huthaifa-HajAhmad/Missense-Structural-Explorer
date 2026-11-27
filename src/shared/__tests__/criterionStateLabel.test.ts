import { describe, expect, it } from "vitest";
import { criterionStateLabel } from "../insightsEvidence";

describe("criterionStateLabel", () => {
  it("gives each criterion state one capitalised word, so the Insights table and the report say the same thing", () => {
    expect(criterionStateLabel("met")).toBe("Met");
    expect(criterionStateLabel("not met")).toBe("Not met");
    expect(criterionStateLabel("withheld")).toBe("Withheld");
    expect(criterionStateLabel("not recorded")).toBe("Not recorded");
  });
});
