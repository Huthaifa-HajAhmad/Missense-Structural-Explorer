import type {
  BiophysicalModelingData,
  LanguageModelEvaluations,
  LandscapeResidueItem,
  StringInteractionItem,
  MultimerData,
  PpiBindingData,
  BiophysicsConditions
} from "./biophysics.ts";
import type {
  ClinicalInsight,
  RuleBasedInsights,
  ClinVarData,
  PredictorData,
  ConservationData,
  GnomadConstraintData,
  GnomadFrequencyData,
  AouFrequencyData
} from "./clinical.ts";
import type {
  DisruptionPredictorResult,
  UniprotFeaturesData
} from "./structure.ts";

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

export interface VariantMetadata {
  gene: string;
  variant: string;
  uniprotId: string;
  residueIndex: number | null;
  wildType: string;
  mutant: string;
  acmgWeighting?: string;
  pdbId?: string | null;
  pdbSource?: string | null;
  alternativeVariants?: any;
  mutatedSequence?: string | null;
  analysisVersion?: {
    thresholds: string;
    geminiModel: string;
    foldxVersion: string;
    timestamp: string;
  } | null;
  serviceStatus?: Record<string, string>;
}

export interface TranscriptMetadata {
  transcriptId?: string | null;
  isManeSelect?: boolean;
  isManePlusClinical?: boolean;
  isCanonical?: boolean;
  maneRefSeqId?: string | null;
  transcriptWarning?: string | null;
}

export interface AnalysisResult extends BiophysicalModelingData, TranscriptMetadata, LanguageModelEvaluations {
  analysis?: string | null;
  isFallback?: boolean;
  fallbackReason?: string;
  insights?: ClinicalInsight | null;
  ruleBasedInsights?: RuleBasedInsights | null;
  clinvar?: ClinVarData | null;
  predictorData?: PredictorData | null;
  conservationData?: ConservationData | null;
  landscapeData?: LandscapeResidueItem[] | null;
  stringInteractions?: StringInteractionItem[] | null;
  multimerData?: MultimerData | null;
  ppiBindingData?: PpiBindingData | null;
  isDemoData?: boolean;
  metadata?: VariantMetadata;
  disruptionPredictor?: DisruptionPredictorResult;
  uniprotFeatures?: UniprotFeaturesData | null;
  gnomadConstraint?: GnomadConstraintData | null;
  gnomadFrequency?: GnomadFrequencyData | null;
  aouFrequency?: AouFrequencyData | null;
  serviceStatus?: Record<string, string>;
}

export interface AnalysisState {
  isLoading: boolean;
  error: string | null;
  result: AnalysisResult | null;
  isDemoData?: boolean;
}

export interface UserSettings {
  residueColor: string; // e.g., "#F97316"
  primaryAccent: "indigo" | "purple" | "rose" | "emerald" | "amber" | "blue";
  geminiApiKey?: string;
  geminiSessionId?: string;
  geminiSessionExpiresAt?: number;
  appApiToken?: string;
  biohubApiToken?: string;
  hfToken?: string;
  gpnApiUrl?: string;
  cameraDuration: number; // e.g., 1200
  autoZoomOnSelect: boolean;
  showAtomInteractions: boolean;
  acmgWeighting: "standard" | "conservative" | "strict-structural";
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
  biophysicsConditions: BiophysicsConditions;
}
