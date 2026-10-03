import { describe, it, expect } from "vitest";
import {
  ABSOLUTE_ZERO_CELSIUS,
  BIOPHYSICS_CONDITION_UNIT_VERSION,
  BIOPHYSICS_NATIVE_DEFAULT_VERSION,
  DEFAULT_NATIVE_FOLDX_CONDITIONS,
  DEFAULT_UI_BIOPHYSICS_CONDITIONS,
  describeConditionRejection,
  readUiBiophysicsConditions,
  toNativeFoldxConditions,
} from "../biophysicsConditions";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE UNIT BOUNDARY — 25 °C IS NOT 25 K, AND 150 mM IS NOT 150 M
 * ─────────────────────────────────────────────────────────────────────────────
 * The Settings panel collects °C and mM; FoldX takes K and M, and the server forwards what it is
 * given straight to `--temperature` / `--ionStrength`. Sending the panel's numbers verbatim asked
 * FoldX for 25 K and 150 M — a temperature below any experiment and a salt concentration three
 * orders of magnitude too high — while the cache key recorded the panel's numbers, so the
 * wrong-units result was cached as though it were the requested condition.
 *
 * These tests pin the conversion, the direction, and the refusal to invent a usable value.
 */
describe("toNativeFoldxConditions", () => {
  it("converts the panel's defaults: 25 °C → 298.15 K, 150 mM → 0.15 M, pH unchanged", () => {
    const result = toNativeFoldxConditions({ ph: 7.4, temperature: 25, ionicStrength: 150 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a conversion");

    // 298.15 K is the physiological temperature in the unit FoldX documents; 25 was the bug.
    expect(result.native.temperature).toBe(298.15);
    expect(result.native.temperature).not.toBe(25);
    expect(result.native.ionicStrength).toBe(0.15);
    expect(result.native.ionicStrength).not.toBe(150);
    // pH is unit-free: it is neither converted nor scaled.
    expect(result.native.pH).toBe(7.4);
  });

  it("uses the panel's documented defaults for absent fields", () => {
    for (const input of [undefined, null, {}, { ph: undefined }]) {
      const result = toNativeFoldxConditions(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected a conversion");
      expect(result.native.pH).toBe(DEFAULT_UI_BIOPHYSICS_CONDITIONS.ph);
      expect(result.native.temperature).toBe(298.15);
      expect(result.native.ionicStrength).toBe(0.15);
    }
  });

  it("accepts numeric strings, which settings persisted by an older build can hold", () => {
    const result = toNativeFoldxConditions({ ph: "8", temperature: "30", ionicStrength: "200" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a conversion");
    expect(result.native).toEqual({ pH: 8, temperature: 303.15, ionicStrength: 0.2 });
  });

  it("clamps nothing: an out-of-panel-range value is converted as given", () => {
    // The panel's inputs carry min/max attributes but do not enforce them, and a value outside them
    // is still the value the reader chose — quietly pulling it into range would be an undisclosed
    // change to the condition the result was produced under.
    const hot = toNativeFoldxConditions({ temperature: 100, ionicStrength: 2000 });
    expect(hot.ok).toBe(true);
    if (!hot.ok) throw new Error("expected a conversion");
    expect(hot.native.temperature).toBe(373.15);
    expect(hot.native.ionicStrength).toBe(2);
  });

  it("rejects a value it cannot convert instead of substituting a plausible one", () => {
    const rejections: Array<[unknown, string, string]> = [
      [{ temperature: Number.NaN }, "not-finite", "temperature"],
      [{ temperature: Number.POSITIVE_INFINITY }, "not-finite", "temperature"],
      [{ ionicStrength: "not-a-number" }, "not-finite", "ionicStrength"],
      [{ ph: Number.NaN }, "not-finite", "ph"],
      [{ temperature: ABSOLUTE_ZERO_CELSIUS }, "below-absolute-zero", "temperature"],
      [{ temperature: -300 }, "below-absolute-zero", "temperature"],
      [{ ionicStrength: -1 }, "negative-ionic-strength", "ionicStrength"],
    ];

    for (const [input, reason, field] of rejections) {
      const result = toNativeFoldxConditions(input);
      expect(result.ok, `${JSON.stringify(input)} must be rejected`).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe(reason);
      expect(result.field).toBe(field);
      // Nothing usable is returned, so no caller can accidentally submit a fabricated condition.
      expect("native" in result).toBe(false);
      // The message names the field a reader must fix, in prose rather than as a code identifier.
      expect(describeConditionRejection(result).length).toBeGreaterThan(0);
      expect(describeConditionRejection(result)).not.toContain("undefined");
    }
  });

  it("keeps the UI and native defaults distinct, and documents both", () => {
    // The whole defect in one assertion: the panel's default temperature and FoldX's are different
    // numbers in different units, so "just pass the setting through" cannot be right.
    expect(DEFAULT_UI_BIOPHYSICS_CONDITIONS).toEqual({ ph: 7.4, temperature: 25, ionicStrength: 150 });
    expect(DEFAULT_NATIVE_FOLDX_CONDITIONS).toEqual({ pH: 7.0, temperature: 298, ionicStrength: 0.05 });
    expect(DEFAULT_UI_BIOPHYSICS_CONDITIONS.temperature).not.toBe(DEFAULT_NATIVE_FOLDX_CONDITIONS.temperature);
    expect(DEFAULT_UI_BIOPHYSICS_CONDITIONS.ionicStrength).not.toBe(DEFAULT_NATIVE_FOLDX_CONDITIONS.ionicStrength);
  });

  it("carries a unit version for the stored condition identity", () => {
    // Stored conditions are compared verbatim, so this is what makes an artifact computed while
    // `temperature: 25` meant Kelvin unusable rather than merely stale-looking.
    expect(BIOPHYSICS_CONDITION_UNIT_VERSION).toContain("celsius");
    expect(BIOPHYSICS_CONDITION_UNIT_VERSION).toContain("millimolar");
  });

  it("versions the native-default identity separately, so the two runs cannot share one stamp", () => {
    // "No conditions submitted" means the server's own defaults (Kelvin/molar); "the panel's
    // defaults" means 25 °C / 150 mM. Different runs, so different identities.
    expect(BIOPHYSICS_NATIVE_DEFAULT_VERSION).not.toBe(BIOPHYSICS_CONDITION_UNIT_VERSION);
    expect(BIOPHYSICS_NATIVE_DEFAULT_VERSION).toContain("native");
  });
});

describe("readUiBiophysicsConditions", () => {
  it("normalizes the panel's values without changing their units", () => {
    expect(readUiBiophysicsConditions({ ph: "8", temperature: "30", ionicStrength: "200" })).toEqual({
      ok: true,
      ui: { ph: 8, temperature: 30, ionicStrength: 200 },
    });
    expect(readUiBiophysicsConditions({})).toEqual({
      ok: true,
      ui: { ...DEFAULT_UI_BIOPHYSICS_CONDITIONS },
    });
  });

  it("reports the same rejections the converter does, so a caller can record what was given", () => {
    const read = readUiBiophysicsConditions({ temperature: Number.NaN });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read).toMatchObject({ reason: "not-finite", field: "temperature" });
    // The raw value travels with the rejection: a stamp can record it verbatim instead of
    // substituting a default that nobody chose.
    expect(Number.isNaN(read.value as number)).toBe(true);
  });
});
