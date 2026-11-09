// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createAnalysisCacheContext } from "../analysisContext";
import { clearClientVariantCache, getBiophysicsAttemptedAt, recordBiophysicsAttempt } from "../variantCache";

describe("provider configuration in the cache identity", () => {
  const base = createAnalysisCacheContext("P1", {}).providerConfiguration;

  it.each([
    ["alphagenomeApiKey", { alphagenomeApiKey: "k" }],
    ["alphagenomeApiUrl", { alphagenomeApiUrl: "https://example.test" }],
    ["hfToken", { hfToken: "t" }],
    ["biohubApiToken", { biohubApiToken: "b" }],
    ["gpnApiUrl", { gpnApiUrl: "https://example.test" }],
  ])("changes when %s is set, so a new credential does not reuse the old answer", (_name, settings) => {
    expect(createAnalysisCacheContext("P1", settings).providerConfiguration).not.toBe(base);
  });

  it("never stores a credential's value", () => {
    expect(createAnalysisCacheContext("P1", { hfToken: "secret-token" }).providerConfiguration).not.toContain("secret-token");
  });
});

describe("FoldX attempt store", () => {
  beforeEach(() => clearClientVariantCache());

  it("keeps an attempt under the conditions it ran with", () => {
    recordBiophysicsAttempt("PAH", "p.Arg408Trp", "ph7");
    expect(getBiophysicsAttemptedAt("PAH", "p.Arg408Trp", "ph7")).toBeGreaterThan(0);
    expect(getBiophysicsAttemptedAt("PAH", "p.Arg408Trp", "ph5")).toBeNull();
  });
});
