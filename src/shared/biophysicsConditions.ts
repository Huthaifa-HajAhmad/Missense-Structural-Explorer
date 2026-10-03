/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SIMULATION CONDITIONS — THE PANEL'S UNITS ARE NOT FOLDX'S UNITS
 * ─────────────────────────────────────────────────────────────────────────────
 * The Settings panel collects pH, temperature in **°C** and ionic strength in **mM** — the units a
 * reader thinks in, and the units its own labels state (`AnalysisSection.tsx`).
 *
 * FoldX takes temperature in **KELVIN** and ionic strength in **MOLAR**:
 *
 *   • https://foldxsuite.crg.eu/parameter/temperature   — default 298 (K)
 *   • https://foldxsuite.crg.eu/parameter/ionStrength   — default 0.05 (M)
 *
 * and the server forwards what it is given straight into `--temperature` / `--ionStrength`
 * (`server/services/stability/foldx/runner.ts`). So forwarding the panel's numbers verbatim asked
 * FoldX for **25 K** and **150 M**: a temperature below any physical experiment and a salt
 * concentration three orders of magnitude too high — while the cache key recorded the same numbers,
 * so the wrong-units result was cached and re-served as if it were the requested condition.
 *
 * This module is the ONE place that converts, and it states its direction explicitly:
 * `toNativeFoldxConditions` produces what the wire needs, `DEFAULT_UI_BIOPHYSICS_CONDITIONS` is what
 * the panel shows. The server's API keeps its native semantics (Kelvin, molar) — the fix belongs at
 * the client boundary, not in the contract.
 *
 * NO CLAMPING, NO SUBSTITUTION
 * ----------------------------
 * A field that is ABSENT is filled from the documented UI default, because the panel presents those
 * defaults and the cache context records them (`biophysicsContextOf`). A field that is PRESENT and
 * unusable is REJECTED with a reason: squeezing `-300 °C` into a physical range, or quietly dropping
 * a bad value so the server's own default applies, would both be an undisclosed change to how the
 * result was produced — the same class of defect as the unit error itself.
 */

/** What the Settings panel collects. Temperature is °C; ionic strength is mM. */
export interface UiBiophysicsConditions {
  ph: number;
  /** °C */
  temperature: number;
  /** mM */
  ionicStrength: number;
}

/** What FoldX (and therefore the `/generate-mutant` contract) takes. */
export interface NativeFoldxConditions {
  pH: number;
  /** Kelvin */
  temperature: number;
  /** Molar */
  ionicStrength: number;
}

/** The panel's defaults — the values its own labels and "Reset to physiological" present. */
export const DEFAULT_UI_BIOPHYSICS_CONDITIONS: Readonly<UiBiophysicsConditions> = Object.freeze({
  ph: 7.4,
  temperature: 25,
  ionicStrength: 150,
});

/**
 * FoldX's own defaults, i.e. what the server applies when the client sends no conditions at all.
 * Kept here so the two sets of defaults are readable side by side; they are deliberately NOT equal.
 */
export const DEFAULT_NATIVE_FOLDX_CONDITIONS: Readonly<NativeFoldxConditions> = Object.freeze({
  pH: 7.0,
  temperature: 298,
  ionicStrength: 0.05,
});

export const ABSOLUTE_ZERO_CELSIUS = -273.15;

/**
 * Version of the STORED condition identity, for the conditions a caller SUBMITS in panel units.
 *
 * The client cache compares a stored conditions context with the current one VERBATIM, so this
 * string is what makes an artifact computed under a different meaning of the same three numbers
 * unusable. It is bumped here, once, for the °C/mM → K/M boundary fix: every bundle cached before it
 * carries no `unitVersion` and therefore no longer matches, so it is recomputed instead of being
 * served as though it had been produced under the conditions the panel shows today.
 */
export const BIOPHYSICS_CONDITION_UNIT_VERSION = "ui-celsius-millimolar/1";

/**
 * Version of the stored condition identity for a run that submitted NO conditions at all.
 *
 * A SEPARATE identity, because those are a different run: when the client sends no conditions the
 * server applies its OWN defaults — 7.0 pH, 298 K, 0.05 M — which are not the panel's 7.4 / 25 °C /
 * 150 mM in different clothing, they are different numbers. Labelling that run "UI defaults" made a
 * native-default artifact and a panel-default artifact share one identity, so one could be served
 * for the other.
 */
export const BIOPHYSICS_NATIVE_DEFAULT_VERSION = "foldx-native-kelvin-molar/1";

/** Why a condition could not be converted. Named so a caller can say which rule was broken. */
export type ConditionRejection = "not-finite" | "below-absolute-zero" | "negative-ionic-strength";

export type ConditionConversion =
  | { ok: true; native: NativeFoldxConditions }
  | { ok: false; reason: ConditionRejection; field: keyof UiBiophysicsConditions; value: unknown };

/** The panel's own values, normalized: numeric strings become numbers, absent fields become defaults. */
export type UiConditionRead =
  | { ok: true; ui: UiBiophysicsConditions }
  | { ok: false; reason: ConditionRejection; field: keyof UiBiophysicsConditions; value: unknown };

/** A field may arrive as a number or as a numeric string (settings persisted by an older build). */
function readNumber(raw: unknown, fallback: number): { ok: true; value: number } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: fallback };
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/**
 * Reads panel conditions into their canonical values, WITHOUT changing units.
 *
 * This is the shared reader behind both `toNativeFoldxConditions` (which then converts) and the
 * stored-condition identity (`biophysicsContextOf`, which must record the panel's own numbers). A
 * numeric string is canonicalized to the number it denotes, so `"25"` and `25` are ONE condition
 * rather than two; an unusable value is rejected, never replaced by a default.
 */
export function readUiBiophysicsConditions(input: unknown): UiConditionRead {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const ph = readNumber(source.ph, DEFAULT_UI_BIOPHYSICS_CONDITIONS.ph);
  if (!ph.ok) return { ok: false, reason: "not-finite", field: "ph", value: source.ph };

  const temperature = readNumber(source.temperature, DEFAULT_UI_BIOPHYSICS_CONDITIONS.temperature);
  if (!temperature.ok) {
    return { ok: false, reason: "not-finite", field: "temperature", value: source.temperature };
  }
  if (temperature.value <= ABSOLUTE_ZERO_CELSIUS) {
    return { ok: false, reason: "below-absolute-zero", field: "temperature", value: source.temperature };
  }

  const ionicStrength = readNumber(source.ionicStrength, DEFAULT_UI_BIOPHYSICS_CONDITIONS.ionicStrength);
  if (!ionicStrength.ok) {
    return { ok: false, reason: "not-finite", field: "ionicStrength", value: source.ionicStrength };
  }
  if (ionicStrength.value < 0) {
    return { ok: false, reason: "negative-ionic-strength", field: "ionicStrength", value: source.ionicStrength };
  }

  return {
    ok: true,
    ui: { ph: ph.value, temperature: temperature.value, ionicStrength: ionicStrength.value },
  };
}

/**
 * Converts panel conditions (°C, mM) into the native FoldX conditions (K, M).
 *
 * pH is unit-free and passes through unchanged.
 */
export function toNativeFoldxConditions(input: unknown): ConditionConversion {
  const read = readUiBiophysicsConditions(input);
  if (!read.ok) return read;

  return {
    ok: true,
    native: {
      pH: read.ui.ph,
      temperature: read.ui.temperature + 273.15,
      ionicStrength: read.ui.ionicStrength / 1000,
    },
  };
}

/** Human labels for the rejection messages — the field names are code, the messages are not. */
const CONDITION_FIELD_LABELS: Record<keyof UiBiophysicsConditions, string> = {
  ph: "pH",
  temperature: "temperature",
  ionicStrength: "ionic strength",
};

/**
 * A short, user-facing reason for a rejection — used by the client to say WHAT to fix rather than
 * failing the run with a bare "invalid conditions".
 */
export function describeConditionRejection(rejection: Extract<ConditionConversion, { ok: false }>): string {
  const label = CONDITION_FIELD_LABELS[rejection.field] ?? rejection.field;
  switch (rejection.reason) {
    case "not-finite":
      return `${label} is not a number`;
    case "below-absolute-zero":
      return `${label} must be above ${ABSOLUTE_ZERO_CELSIUS} °C (absolute zero)`;
    case "negative-ionic-strength":
      return `${label} cannot be negative`;
  }
}
