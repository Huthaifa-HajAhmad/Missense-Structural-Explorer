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
  /** "database_verified" = rule engine; "ai_suggested" = Gemini inference */
  source?: "database_verified" | "ai_suggested";
}

export interface ClinicalInsight {
  biochemicalShift: string;
  structuralImpact: string;
  acmgCriteria: ACMGCriteriaItem[];
  pathogenicity?: string;
  plausibility?: string;
  acmgVerdict?: string;
  partialEvidence?: { available: string[]; unavailable: string[] };
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
  analysis?: string | null;
  insights?: ClinicalInsight | null;
  ruleBasedInsights?: {
    plausibility: string;
    acmgVerdict: string;
    acmgCriteria: ACMGCriteriaItem[];
    partialEvidence?: { available: string[]; unavailable: string[] };
  } | null;
  clinvar?: ClinVarData | null;
  predictorData?: {
    amPathogenicity: number | null;
    amClass: string | null;
    caddPhred: number | null;
    available?: boolean;
    eveScore?: number | null;
    eveClass?: string | null;
    proteinName?: string | null;
  } | null;
  conservationData?: {
    revel: number | null;
    gerp: number | null;
    phylop: number | null;
    consurf: number | null;
    available?: boolean;
  } | null;
  landscapeData?: {
    residx: number;
    revelMax: number | null;
    amMax: number | null;
    gerp: number | null;
    phylop: number | null;
  }[] | null;
  stringInteractions?: {
    partner: string;
    score: number;
  }[] | null;
  isDemoData?: boolean;
  dynamut2?: number | null;
  dynamut2Status?: string | null;
  dynamut2JobId?: string | null;
  metadata: {
    gene: string;
    variant: string;
    uniprotId: string;
    residueIndex: number | null;
    wildType: string;
    mutant: string;
    pdbId?: string | null;
    pdbSource?: string | null;
  };
  disruptionPredictor?: {
    level: "high" | "low";
    reason: string;
    plddt: number;
    burialStatus?: "core" | "surface" | "boundary";
    neighborCount?: number;
  };
  uniprotFeatures?: {
    features: {
      type: string;
      description: string;
      start: number;
      end: number;
    }[];
    geneName?: string;
  } | null;
  gnomadConstraint?: {
    missense_z: number | null;
    oe_mis: number | null;
    pli: number | null;
    isPP2Constrained: boolean;
  } | null;
  /** Transcript metadata from /translate-variant (populated only when VCF/cDNA input is used) */
  transcriptId?: string;
  isCanonical?: boolean;
  transcriptWarning?: string;
  gnomadFrequency?: {
    maxAF: number | null;
    genomeAF: number | null;
    exomeAF: number | null;
    genomeAC: number | null;
    exomeAC: number | null;
    genomeAN: number | null;
    exomeAN: number | null;
    nHomozygous: number | null;
    dataset: string;
  } | null;
  esm2?: {
    llr: number | null;
    verdict: string | null;
  } | null;
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
  appApiToken?: string;
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
  foldxMean?: number | null;
  foldxSd?: number | null;
  vdw?: number | null;
  electrostatics?: number | null;
  stericClashWarning?: boolean;
  localSidechainRmsd?: number | null;
  dynamut2: number | null;
  ddgun: number | null;
  maestro?: number | null;
  consensusVerdict?: string | null;
}



