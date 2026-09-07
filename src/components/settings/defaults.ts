import type { UserSettings } from "../../types";

/**
 * Single source of truth for user-settings defaults.
 *
 * Both the SettingsContext initializer and resetSettingsToDefault() consume
 * this constant. Previously the defaults literal was duplicated inline in the
 * two code paths and drifted apart (hfToken was missing from both copies,
 * tamarindApiKey from the reset copy), which is how settings could end up
 * undefined after a reset.
 */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  residueColor: "#F97316",
  primaryAccent: "indigo",
  geminiApiKey: "",
  geminiSessionId: "",
  geminiSessionExpiresAt: 0,
  appApiToken: "",
  biohubApiToken: "",
  tamarindApiKey: "",
  hfToken: "",
  cameraDuration: 1200,
  autoZoomOnSelect: true,
  showAtomInteractions: true,
  acmgWeighting: "standard",
  energyUnit: "kcal/mol",
  seqColorScheme: "chemical",
  seqScrollStep: 31,
  autoShowAlerts: true,
  maxHistoryItems: 5,
  neonHighContrast: false,
  show3DLabels: true,
  saveHistory: false,
  reducedMotion: false,
  defaultPerturbationModel: "saprot",
  defaultStructureModel: "alphafold",
  saprotEngine: "saprot-650m",
  biophysicsConditions: {
    ph: 7.4,
    temperature: 25,
    ionicStrength: 150
  }
};

/** Credential fields that must never reach localStorage. */
export const TRANSIENT_SETTING_KEYS = [
  "geminiApiKey",
  "geminiSessionId",
  "geminiSessionExpiresAt",
  "appApiToken",
  "biohubApiToken",
  "tamarindApiKey",
  "hfToken"
] as const;

export type TransientSettingKey = (typeof TRANSIENT_SETTING_KEYS)[number];

/** First-run default for reduced motion honors the OS-level preference. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
