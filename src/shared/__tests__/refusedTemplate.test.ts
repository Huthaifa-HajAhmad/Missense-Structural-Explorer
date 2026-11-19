import { describe, expect, it } from "vitest";
import { otherRefusedChainsText } from "../refusedTemplate";

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
