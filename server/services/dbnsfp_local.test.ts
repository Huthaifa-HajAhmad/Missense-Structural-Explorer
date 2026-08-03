import { describe, it, expect, vi } from "vitest";
import * as dbnsfpLocal from "./dbnsfp_local.ts";
import { fetchPopEVEScoreOnline } from "./external.ts";

describe("Local dbNSFP Amino Acid Filtering", () => {
  it("should match amino acid change representations properly using matchAminoAcidChange logic", async () => {
    const dbInstanceSpy = vi.spyOn(dbnsfpLocal as any, "getDbInstance").mockReturnValue({
      prepare: () => ({
        all: () => [
          { gene: "GZF1", pos: 586, aa_change: "p.Asp586Val", revel: 0.1 },
          { gene: "GZF1", pos: 586, aa_change: "p.Asp586Ala", revel: 0.9 }
        ]
      })
    });

    const res = await dbnsfpLocal.queryLocalDbnsfpVariant("GZF1", 586, null, null, "p.Asp586Ala");
    expect(res).toBeDefined();
    expect(res?.revel).toBe(0.9);
    expect(res?.aa_change).toBe("p.Asp586Ala");

    dbInstanceSpy.mockRestore();
  });

  it("should fetch popEVE score online for GZF1 p.Asp586Ala via fetchPopEVEScoreOnline", async () => {
    const score = await fetchPopEVEScoreOnline("GZF1", "p.Asp586Ala");
    expect(score).not.toBeNull();
    if (score !== null) {
      expect(score).toBeCloseTo(-3.775, 2);
    }
  }, 15000);
});
