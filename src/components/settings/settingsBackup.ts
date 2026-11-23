import { z } from "zod";
import { SPLICEAI_WINDOWS } from "../../shared/splicingEvidence";
import type { ThemeMode } from "../../context/SettingsContext";
import type { UserSettings } from "../../types";

const oneOf = <T extends string | number>(values: readonly T[]) =>
  z.custom<T>((v) => (values as readonly unknown[]).includes(v));

/**
 * What an imported settings file may set: every non-credential setting, each limited to the values
 * Settings itself offers. A file is outside data, so a value the app cannot show is skipped rather
 * than stored.
 */
const IMPORTABLE = {
  residueColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  primaryAccent: oneOf(["clay", "indigo", "purple", "rose", "emerald", "amber", "blue"] as const),
  cameraDuration: oneOf([0, 800, 1200, 2000] as const),
  autoZoomOnSelect: z.boolean(),
  showAtomInteractions: z.boolean(),
  acmgWeighting: oneOf(["standard", "conservative", "strict-structural"] as const),
  narrativeMode: oneOf(["automatic", "on-demand", "off"] as const),
  energyUnit: oneOf(["kcal/mol", "kJ/mol"] as const),
  seqColorScheme: oneOf(["chemical", "hydrophobic", "minimal"] as const),
  seqScrollStep: oneOf([15, 21, 31, 41] as const),
  autoShowAlerts: z.boolean(),
  maxHistoryItems: oneOf([5, 10, 20, 50] as const),
  neonHighContrast: z.boolean(),
  show3DLabels: z.boolean(),
  saveHistory: z.boolean(),
  reducedMotion: z.boolean(),
  spliceaiWindow: oneOf(SPLICEAI_WINDOWS),
  // The ranges the Analysis section's inputs allow.
  biophysicsConditions: z.object({
    ph: z.number().min(0).max(14),
    temperature: z.number().min(0).max(100),
    ionicStrength: z.number().min(0).max(2000)
  }).strict()
} satisfies Partial<Record<keyof UserSettings, z.ZodType>>;

const THEMES = ["light", "dark", "system"] as const;

const FILE_SCHEMA = z.object({
  __type: z.string().optional(),
  version: z.number().optional(),
  theme: z.unknown().optional(),
  settings: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export interface SettingsBackup {
  settings: Partial<UserSettings>;
  /** Known settings whose value the app does not offer. */
  skipped: string[];
  theme: ThemeMode | null;
}

/** Reads a settings file a reader chose to import. Throws when the text is not a JSON object. */
export function readSettingsBackup(text: string): SettingsBackup {
  const parsed = FILE_SCHEMA.parse(JSON.parse(text));
  const { __type: _t, version: _v, theme, settings: nested, ...flat } = parsed;
  // Older exports wrote the settings at the top level instead of under `settings`.
  const incoming: Record<string, unknown> = nested && Object.keys(nested).length > 0 ? nested : flat;

  const settings: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const [key, schema] of Object.entries(IMPORTABLE)) {
    if (incoming[key] === undefined) continue;
    const result = (schema as z.ZodType).safeParse(incoming[key]);
    if (result.success) settings[key] = result.data;
    else skipped.push(key);
  }
  return {
    settings: settings as Partial<UserSettings>,
    skipped,
    theme: (THEMES as readonly unknown[]).includes(theme) ? (theme as ThemeMode) : null
  };
}

/** The file Export writes. Credentials are not settings here, so they are never in it. */
export function writeSettingsBackup(settings: UserSettings, theme: ThemeMode): string {
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(IMPORTABLE)) payload[key] = settings[key as keyof UserSettings];
  return JSON.stringify({ __type: "missense-settings", version: 1, theme, settings: payload }, null, 2);
}

/** Credential fields a reader types; the Gemini session fields are derived from the Gemini key. */
const TYPED_KEYS = ["geminiApiKey", "appApiToken", "japanfoldApiKey", "tamarindApiKey", "alphagenomeApiKey"] as const;

/** What a reset deletes beyond preferences, for its confirmation; null when it deletes nothing else. */
export function resetLossNote(settings: UserSettings): string | null {
  const keys = TYPED_KEYS.filter((key) => Boolean(settings[key]?.trim())).length;
  const parts = [
    keys > 0 ? `${keys} key${keys === 1 ? "" : "s"} in this tab` : null,
    settings.saveHistory ? "saved search history" : null
  ].filter(Boolean);
  return parts.length > 0 ? `also clears ${parts.join(" and ")}` : null;
}
