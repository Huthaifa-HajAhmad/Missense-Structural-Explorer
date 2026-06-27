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
  pathogenicity?: string;
}

export interface ClinVarData {
  classification: string;
  lastEvaluated: string;
  reviewStatus: string;
  alleleFrequencies: { source: string; value: any }[];
  trait: string;
  uid: string | null;
}

export interface AnalysisResult {
  analysis: string;
  insights?: ClinicalInsight | null;
  clinvar?: ClinVarData | null;
  predictorData?: {
    amPathogenicity: number | null;
    amClass: string | null;
    caddPhred: number | null;
    available?: boolean;
  } | null;
  conservationData?: {
    revel: number | null;
    gerp: number | null;
    phylop: number | null;
    consurf: number | null;
    available?: boolean;
  } | null;
  stringInteractions?: {
    partner: string;
    score: number;
  }[] | null;
  isDemoData?: boolean;
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
  isDemoData?: boolean;
}

export interface NearestResidue {
  name: string;
  distance: string;
  properties: string;
  role: string;
  classBadge: string;
  source?: "curated" | "computed";
}

export interface UserSettings {
  residueColor: string; // e.g., "#F97316"
  primaryAccent: "indigo" | "purple" | "rose" | "emerald" | "amber" | "blue";
  geminiApiKey?: string;
  geminiSessionId?: string;
  geminiSessionExpiresAt?: number;
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
  saveHistory: boolean;
}

export interface PocketResidue {
  index: number;
  name: string;
  distance: number;
  score: number;
  role: string;
  type: string;
}

export interface PocketResult {
  pocketResidues: PocketResidue[];
  pocketScore: number;
  pocketVolume: number;
  likelyCofactor: string;
  pocketDistance: number | null;
  status?: string;
}

export interface EnergeticsData {
  foldx: number | null;
  dynamut2: number | null;
  ddgun: number | null;
  maestro: number | null;
}



