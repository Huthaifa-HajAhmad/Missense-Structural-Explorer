import { describe, expect, it } from "vitest";
import { otherRefusedChainsText, unmodelledSiteText } from "../refusedTemplate";

describe("unmodelledSiteText", () => {
  it("counts the structures that span the residue without coordinates for it", () => {
    expect(unmodelledSiteText({ unmodelledResidue: 358, entries: 5 })).toBe("none of the 5 entries that span residue 358 has coordinates for it");
    expect(unmodelledSiteText({ unmodelledResidue: 358, entries: 1 })).toBe("the only entry that spans residue 358 has no coordinates for it");
  });
});

describe("otherRefusedChainsText", () => {
  it("says how many other examined chains were not usable, so one named chain does not read as the only one", () => {
    expect(otherRefusedChainsText({ otherChainsRefused: 11 })).toBe("11 other examined chains were not usable either.");
    expect(otherRefusedChainsText({ otherChainsRefused: 1 })).toBe("1 other examined chain was not usable either.");
  });

  it("says nothing when only one chain was refused", () => {
    expect(otherRefusedChainsText({ otherChainsRefused: 0 })).toBe("");
    expect(otherRefusedChainsText({})).toBe("");
  });
});
