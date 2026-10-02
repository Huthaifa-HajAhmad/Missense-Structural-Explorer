import type { BiophysicsConditions } from "./biophysics.ts";
import type { AnalysisResult } from "../shared/contracts.ts";

export type {
  VariantMetadata,
  TranscriptMetadata,
  AnalysisResult
} from "../shared/contracts.ts";

export interface VariantPreset {
  gene: string;
  variant: string;
  uniprotId: string;
  description: string;
}

export interface SearchHistoryItem {
  gene: string;
  variant: string;
  uniprotId: string;
}

export interface AnalysisState {
  isLoading: boolean;
  error: string | null;
  result: AnalysisResult | null;
  isDemoData?: boolean;
}

export interface UserSettings {
  residueColor: string; // e.g., "#F97316"
  primaryAccent: "clay" | "indigo" | "purple" | "rose" | "emerald" | "amber" | "blue";
  geminiApiKey?: string;
  geminiSessionId?: string;
  geminiSessionExpiresAt?: number;
  appApiToken?: string;
  biohubApiToken?: string;
  hfToken?: string;
  tamarindApiKey?: string;
  gpnApiUrl?: string;
  alphagenomeApiKey?: string;
  alphagenomeApiUrl?: string;
  cameraDuration: number; // e.g., 1200
  autoZoomOnSelect: boolean;
  showAtomInteractions: boolean;
  acmgWeighting: "standard" | "conservative" | "strict-structural";
  /** AI is optional; it never determines workspace readiness. */
  narrativeMode?: "automatic" | "on-demand" | "off";
  energyUnit: "kcal/mol" | "kJ/mol";
  seqColorScheme: "chemical" | "hydrophobic" | "minimal";
  seqScrollStep: number; // e.g., 21, 31, 41
  autoShowAlerts: boolean;
  maxHistoryItems: number;
  neonHighContrast: boolean;
  show3DLabels: boolean;
  saveHistory: boolean;
  reducedMotion: boolean;
  defaultPerturbationModel: "saprot" | "esm2" | "esmc";
  defaultStructureModel: "alphafold" | "esmfold";
  saprotEngine?: "saprot-650m" | "saprot-35m" | "remote-hf";
  /**
   * SpliceAI's reporting window (-D): how far from the variant a gained or lost splice site may be
   * reported. Sent with each analysis; the server clamps it to the service's 50–10,000 bp range.
   */
  spliceaiWindow?: number;
  biophysicsConditions: BiophysicsConditions;
}
