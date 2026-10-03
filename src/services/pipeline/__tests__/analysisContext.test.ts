import { describe, it, expect } from "vitest";
import { biophysicsContextOf, createAnalysisCacheContext } from "../analysisContext";
import { getCachedVariant, setCachedVariant, clearClientVariantCache } from "../variantCache";
import {
  BIOPHYSICS_CONDITION_UNIT_VERSION,
  BIOPHYSICS_NATIVE_DEFAULT_VERSION,
  DEFAULT_NATIVE_FOLDX_CONDITIONS,
  DEFAULT_UI_BIOPHYSICS_CONDITIONS,
} from "../../../shared/biophysicsConditions";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE STAMP PER SEMANTICS — "NO CONDITIONS" IS NOT "THE PANEL'S DEFAULTS"
 * ─────────────────────────────────────────────────────────────────────────────
 * A cached bundle is reused only when its conditions context matches verbatim, so the stamp decides
 * whether an artifact may be served. Two runs that produce different numbers must never share one
 * stamp:
 *
 *   • no conditions object  → `foldxService` sends no condition fields → the SERVER applies
 *     pH 7.0 / 298 K / 0.05 M;
 *   • an object (`{}`)      → the PANEL's defaults, 7.4 / 25 °C / 150 mM → sent as 298.15 K / 0.15 M.
 *
 * The previous stamp called BOTH of them "7.4 / 25 / 150", so a native-default artifact could be
 * served for a panel-default request, and the reverse.
 */
describe("biophysicsContextOf", () => {
  const uiStamp = () => JSON.parse(biophysicsContextOf({}));
  const nativeStamp = () => JSON.parse(biophysicsContextOf(undefined));

  it("stamps an OMITTED conditions object as the server's native defaults", () => {
    for (const omitted of [undefined, null]) {
      const stamp = JSON.parse(biophysicsContextOf(omitted));
      expect(stamp).toEqual({
        unitVersion: BIOPHYSICS_NATIVE_DEFAULT_VERSION,
        basis: "server-native-defaults",
        ph: DEFAULT_NATIVE_FOLDX_CONDITIONS.pH,
        temperature: DEFAULT_NATIVE_FOLDX_CONDITIONS.temperature,
        ionicStrength: DEFAULT_NATIVE_FOLDX_CONDITIONS.ionicStrength,
      });
      // The native numbers, not the panel's wearing a different label.
      expect(stamp.temperature).toBe(298);
      expect(stamp.ionicStrength).toBe(0.05);
    }
  });

  it("stamps an EMPTY object as the panel's defaults — a different run from the omitted one", () => {
    expect(uiStamp()).toEqual({
      unitVersion: BIOPHYSICS_CONDITION_UNIT_VERSION,
      basis: "submitted-ui",
      ph: DEFAULT_UI_BIOPHYSICS_CONDITIONS.ph,
      temperature: DEFAULT_UI_BIOPHYSICS_CONDITIONS.temperature,
      ionicStrength: DEFAULT_UI_BIOPHYSICS_CONDITIONS.ionicStrength,
    });

    // The distinction this test exists for: one string per semantics.
    expect(biophysicsContextOf({})).not.toBe(biophysicsContextOf(undefined));
    expect(uiStamp().unitVersion).not.toBe(nativeStamp().unitVersion);
    expect(uiStamp().temperature).not.toBe(nativeStamp().temperature);
  });

  it("canonicalizes numeric strings, so \"25\" and 25 are ONE condition", () => {
    expect(biophysicsContextOf({ ph: "8", temperature: "30", ionicStrength: "200" }))
      .toBe(biophysicsContextOf({ ph: 8, temperature: 30, ionicStrength: 200 }));
    // …and it is not the same condition as the defaults it was mistaken for.
    expect(biophysicsContextOf({ temperature: "30" })).not.toBe(biophysicsContextOf({}));
  });

  it("records an unusable value as given rather than substituting a default", () => {
    const unusable = JSON.parse(biophysicsContextOf({ ph: 7.4, temperature: Number.NaN, ionicStrength: 150 }));
    expect(unusable.basis).toBe("unusable");
    // A default is NOT written in place of the bad value…
    expect(unusable.temperature).not.toBe(DEFAULT_UI_BIOPHYSICS_CONDITIONS.temperature);
    expect(unusable.temperature).toBeNull();
    // …and the stamp cannot collide with the valid one.
    expect(biophysicsContextOf({ temperature: Number.NaN })).not.toBe(biophysicsContextOf({}));
    expect(biophysicsContextOf({ temperature: Number.NaN })).not.toBe(biophysicsContextOf(undefined));
  });

  it("takes the settings object verbatim from createAnalysisCacheContext", () => {
    // No biophysicsConditions at all: nothing will be sent, so the native defaults are the truth.
    expect(createAnalysisCacheContext("P00439").simulationConditions).toBe(biophysicsContextOf(undefined));
    // An (empty) conditions object: the panel's defaults are the truth.
    expect(createAnalysisCacheContext("P00439", { biophysicsConditions: {} }).simulationConditions)
      .toBe(biophysicsContextOf({}));
  });
});

describe("reference-scoped artifact reuse", () => {
  it("waits for an established reference and never borrows another isoform", () => {
    clearClientVariantCache();
    setCachedVariant("PAH", "p.Arg408Trp", "P00439", { pdbText: "ATOM reference", biophysicsContext: biophysicsContextOf(undefined) });
    expect(getCachedVariant("PAH", "p.Arg408Trp", createAnalysisCacheContext(""))).toBeNull();
    expect(getCachedVariant("PAH", "p.Arg408Trp", createAnalysisCacheContext("P00439-2"))).toBeNull();
    expect(getCachedVariant("PAH", "p.Arg408Trp", createAnalysisCacheContext("P00439"))?.pdbText).toBe("ATOM reference");
    expect(getCachedVariant("PAH", "p.Arg408Trp")?.pdbText).toBe("ATOM reference"); // compatibility reader
    clearClientVariantCache();
  });
});

describe("the stamp decides whether an artifact may be reused", () => {
  const bundleFor = (conditions: unknown) => ({
    biophysicsContext: biophysicsContextOf(conditions),
    mutantPdb: "ATOM mutant",
    foldingDdG: 1.25,
    foldingStatus: "success" as const,
    foldingEnergetics: { foldx: 1.25 },
  });

  it("refuses a NATIVE-default artifact for a request whose panel shows the UI defaults", () => {
    clearClientVariantCache();
    // Computed with no conditions submitted: the server used 7.0 / 298 K / 0.05 M.
    setCachedVariant("P00439", "p.Arg408Trp", "P00439", bundleFor(undefined));

    // The request now carries the panel's defaults (7.4 / 25 °C / 150 mM) — a different condition.
    const expected = createAnalysisCacheContext("P00439", { biophysicsConditions: {} });
    const cached = getCachedVariant("P00439", "p.Arg408Trp", expected);

    expect(cached?.foldingEnergetics, "a different condition must not be served").toBeUndefined();
    expect(cached?.mutantPdb).toBeUndefined();
    expect(cached?.foldingDdG).toBeUndefined();
  });

  it("still reuses a NATIVE-default artifact for another native-default request", () => {
    clearClientVariantCache();
    setCachedVariant("P00439", "p.Arg408Trp", "P00439", bundleFor(undefined));

    const expected = createAnalysisCacheContext("P00439"); // no biophysicsConditions ⇒ nothing submitted
    const cached = getCachedVariant("P00439", "p.Arg408Trp", expected);

    expect(cached?.foldingEnergetics).toEqual({ foldx: 1.25 });
    expect(cached?.foldingDdG).toBe(1.25);
  });
});
