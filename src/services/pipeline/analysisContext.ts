import {
  BIOPHYSICS_CONDITION_UNIT_VERSION,
  BIOPHYSICS_NATIVE_DEFAULT_VERSION,
  DEFAULT_NATIVE_FOLDX_CONDITIONS,
  DEFAULT_UI_BIOPHYSICS_CONDITIONS,
  readUiBiophysicsConditions,
} from "../../shared/biophysicsConditions";

export interface AnalysisCacheContext {
  uniprotId: string;
  acmgWeighting: string;
  saprotEngine: string;
  assembly: string;
  genomicCoordinates: string;
  resolvedAssembly: string;
  liftedGenomicCoordinates: string;
  numberingBasis: string;
  userDirections: string;
  simulationConditions: string;
  providerConfiguration: string;
}

/** Local cache identity, never an authorization boundary or an encrypted secret. */
export function opaqueInputIdentity(text: string): string {
  if (!text) return "";
  return "ctx1:" + [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => {
    let value = seed;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
    return (value >>> 0).toString(16).padStart(8, "0");
  }).join("");
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STORED CONDITION IDENTITY — ONE STAMP PER SEMANTICS
 * ─────────────────────────────────────────────────────────────────────────────
 * A cached bundle is reused only when its conditions context matches the current one VERBATIM
 * (`variantCache.ts`), so this string decides whether an artifact may be served. Three cases, and
 * they are three different runs:
 *
 *   1. NO conditions object (`undefined` / `null`) — `foldxService` sends no condition fields, so the
 *      SERVER applies its own defaults: pH 7.0, 298 K, 0.05 M. The stamp records those numbers under
 *      the native version. Labelling this case "the panel's defaults" was the defect: 7.0/298/0.05
 *      and 7.4/25 °C/150 mM are different conditions, and one stamp for both meant a native-default
 *      artifact could be served for a panel-default request (and the reverse).
 *   2. A conditions OBJECT (including `{}`) — the panel's numbers, defaulted per field and
 *      canonicalized (a numeric string is the number it denotes). Stamped under the UI version.
 *   3. A conditions object whose values cannot be converted — recorded AS GIVEN, under the UI version
 *      with an `unusable` basis, so it can never collide with a valid stamp. A default is never
 *      substituted for an invalid value: that would claim a condition nobody chose.
 */
export function biophysicsContextOf(conditions?: unknown): string {
  if (conditions === undefined || conditions === null) {
    return JSON.stringify({
      unitVersion: BIOPHYSICS_NATIVE_DEFAULT_VERSION,
      basis: "server-native-defaults",
      ph: DEFAULT_NATIVE_FOLDX_CONDITIONS.pH,
      temperature: DEFAULT_NATIVE_FOLDX_CONDITIONS.temperature,
      ionicStrength: DEFAULT_NATIVE_FOLDX_CONDITIONS.ionicStrength
    });
  }

  const read = readUiBiophysicsConditions(conditions);
  if (read.ok) {
    return JSON.stringify({
      unitVersion: BIOPHYSICS_CONDITION_UNIT_VERSION,
      basis: "submitted-ui",
      ph: read.ui.ph,
      temperature: read.ui.temperature,
      ionicStrength: read.ui.ionicStrength
    });
  }

  /**
   * Unusable input: the submitted values are recorded verbatim (absent fields keep the panel default,
   * because absent is not invalid), so two different bad inputs cannot share one stamp and no bad
   * input can masquerade as a good one. In practice a run with unusable conditions never reaches the
   * cache — `foldxService` refuses before submitting — but this side of the comparison must still be
   * deterministic.
   */
  const source = (conditions && typeof conditions === "object" ? conditions : {}) as Record<string, unknown>;
  return JSON.stringify({
    unitVersion: BIOPHYSICS_CONDITION_UNIT_VERSION,
    basis: "unusable",
    ph: source.ph ?? DEFAULT_UI_BIOPHYSICS_CONDITIONS.ph,
    temperature: source.temperature ?? DEFAULT_UI_BIOPHYSICS_CONDITIONS.temperature,
    ionicStrength: source.ionicStrength ?? DEFAULT_UI_BIOPHYSICS_CONDITIONS.ionicStrength
  });
}

/** Public scientific inputs only. Credentials must never enter persisted metadata. */
export function createAnalysisCacheContext(uniprotId: string, settings: any = {}, notation: any = {}, userDirections = "", numberingBasis?: string): AnalysisCacheContext {
  return {
    uniprotId: uniprotId.trim().toUpperCase(),
    acmgWeighting: ["standard", "conservative", "strict-structural"].includes(settings.acmgWeighting) ? settings.acmgWeighting : "standard",
    saprotEngine: settings.saprotEngine || "saprot-650m",
    assembly: notation.assembly || "",
    genomicCoordinates: notation.genomicCoordinates || "",
    resolvedAssembly: notation.resolvedAssembly || "",
    liftedGenomicCoordinates: notation.liftedGenomicCoordinates || "",
    numberingBasis: numberingBasis || "",
    userDirections: opaqueInputIdentity(userDirections.trim()),
    simulationConditions: biophysicsContextOf(settings.biophysicsConditions),
    providerConfiguration: JSON.stringify({
      hf: Boolean(settings.huggingfaceApiKey),
      biohub: Boolean(settings.biohubToken),
      alphagenome: Boolean(settings.alphaGenomeApiKey),
      gpnEndpoint: opaqueInputIdentity(settings.gpnStarEndpoint || ""),
      alphagenomeEndpoint: opaqueInputIdentity(settings.alphaGenomeEndpoint || "")
    })
  };
}

export function analysisContextMatches(actual: unknown, expected: AnalysisCacheContext): boolean {
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value);
}

export type NarrativeMode = "automatic" | "on-demand" | "off";
export function narrativeModeOf(settings: any): NarrativeMode {
  return settings?.narrativeMode === "off" || settings?.narrativeMode === "on-demand" ? settings.narrativeMode : "automatic";
}
