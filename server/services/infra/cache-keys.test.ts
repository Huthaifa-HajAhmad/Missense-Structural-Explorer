import { describe, expect, it } from "vitest";
import { buildConservationKey, CACHE_SCHEMA_VERSION } from "./cache-keys.ts";

describe("buildConservationKey", () => {
  it("does not reuse a conservation record cached while MetaRNN and ClinPred were read", () => {
    // Records cached before the primary-predictor rule carry ClinPred. Served again, they would be
    // saved back into the analysis and mark it stale on every visit, so they get a key of their own.
    const before = `conservation_PAH_Arg408Trp_____unknown_schema:${CACHE_SCHEMA_VERSION}`;
    const now = buildConservationKey("PAH", "p.Arg408Trp");
    expect(now).not.toBe(before);
    expect(now).toContain("_ensemble2_");
  });
});
