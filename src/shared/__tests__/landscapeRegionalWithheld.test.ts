import { describe, expect, it } from "vitest";
import type { LandscapeContext } from "../contracts";
import { withholdRegionalWhenRunDid } from "../landscapeEvidence";

const context = {
  clinvar: [],
  gnomad: [],
  regions: [{ start: 1, end: 425, oe: 0.89502, pValue: null }],
  regionsBasis: "gnomAD v4.1.1 regional missense",
  regionsStatus: "available",
} as unknown as LandscapeContext;

describe("Landscape regional O/E follows the run's withholding (B1)", () => {
  it("withholds the regional bars when the run could not verify the locus, as the header does", () => {
    const shown = withholdRegionalWhenRunDid(context, "unverified-locus");
    expect(shown?.regions).toBeNull();
    expect(shown?.regionsStatus).toBe("withheld-mapping");
  });

  it("withholds the regional bars on a transcript mismatch too", () => {
    expect(withholdRegionalWhenRunDid(context, "transcript-mismatch")?.regions).toBeNull();
  });

  it("keeps the regional bars when the run measured them", () => {
    expect(withholdRegionalWhenRunDid(context, "measured")).toBe(context);
    expect(withholdRegionalWhenRunDid(context, undefined)).toBe(context);
  });

  it("passes a missing context through unchanged", () => {
    expect(withholdRegionalWhenRunDid(null, "unverified-locus")).toBeNull();
  });
});
