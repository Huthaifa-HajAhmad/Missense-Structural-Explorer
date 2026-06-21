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

export interface ACMGCriteriaItem {
  code: string;
  reason: string;
}

export interface ClinicalInsight {
  biochemicalShift: string;
  structuralImpact: string;
  acmgCriteria: ACMGCriteriaItem[];
}

export interface ClinVarData {
  classification: string;
  lastEvaluated: string;
  reviewStatus: string;
  alleleFrequencies: { source: string; value: string }[];
  trait: string;
  uid: string | null;
}

export interface AnalysisResult {
  analysis: string;
  insights?: ClinicalInsight | null;
  clinvar?: ClinVarData | null;
  metadata: {
    gene: string;
    variant: string;
    uniprotId: string;
    residueIndex: number | null;
    wildType: string;
    mutant: string;
  };
}

export interface AnalysisState {
  isLoading: boolean;
  error: string | null;
  result: AnalysisResult | null;
}

export interface NearestResidue {
  name: string;
  distance: string;
  properties: string;
  role: string;
  classBadge: string;
}

export interface UserSettings {
  residueColor: string; // e.g., "#F97316"
  cameraDuration: number; // e.g., 1200
  autoZoomOnSelect: boolean;
  showAtomInteractions: boolean;
  acmgWeighting: "standard" | "conservative" | "strict-structural";
  energyUnit: "kcal/mol" | "kJ/mol";
  seqColorScheme: "chemical" | "hydrophobic" | "minimal";
  seqScrollStep: number; // e.g., 21, 31, 41
  autoShowAlerts: boolean;
  bentoLeftControls: boolean;
  maxHistoryItems: number;
  neonHighContrast: boolean;
  show3DLabels: boolean;
}


