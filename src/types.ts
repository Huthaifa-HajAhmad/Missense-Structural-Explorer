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

export type AcmgEvidenceCode = 
  | "PVS1" | "PS1" | "PS2" | "PS3" | "PS4" 
  | "PM1" | "PM2" | "PM3" | "PM4" | "PM5" | "PM6" 
  | "PP1" | "PP2" | "PP3" | "PP4" 
  | "BA1" | "BS1" | "BS2" | "BS3" | "BS4" 
  | "BP1" | "BP2" | "BP3" | "BP4" | "BP5" | "BP7";

export type ClinicalSignificance = 
  | "Pathogenic" 
  | "Likely Pathogenic" 
  | "Uncertain Significance" 
  | "Likely Benign" 
  | "Benign" 
  | "Pathogenic/Likely pathogenic" 
  | "Benign/Likely benign" 
  | "Conflicting interpretations of pathogenicity" 
  | "not found" 
  | (string & {});

export type AcmgVerdict = "Pathogenic" | "Likely Pathogenic" | "VUS" | "Likely Benign" | "Benign";

export interface BiophysicalApiResponse {
  biochemicalShift: string;
  structuralImpact: string;
}

export type UniprotFeatureType = 
  | "DOMAIN" | "REGION" | "ACTIVE_SITE" | "BINDING" | "MUTAGEN" | "DISULFID" | "METAL" | "SITE" 
  | (string & {});

export interface ACMGCriteriaItem {
  code: AcmgEvidenceCode;
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
  acmgVerdict?: AcmgVerdict;
  partialEvidence?: { available: string[]; unavailable: string[] };
}

export interface ClinVarData {
  classification: ClinicalSignificance;
  lastEvaluated: string;
  reviewStatus: string;
  alleleFrequencies: { source: string; value: number | null }[];
  trait: string;
  uid: string | null;
}

export interface AnalysisResult {
  analysis?: string | null;
  insights?: ClinicalInsight | null;
  ruleBasedInsights?: {
    plausibility: string;
    acmgVerdict: AcmgVerdict;
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
    bayesdel?: number | null;
    available?: boolean;
    metarnn?: number | null;
    metarnnPred?: string | null;
    clinpred?: number | null;
    clinpredPred?: string | null;
    eigenPhred?: number | null;
    eigenRaw?: number | null;
    dann?: number | null;
    esm1b?: number | null;
    esm1bPred?: string | null;
    popeve?: number | null;
  } | null;
  landscapeData?: {
    residx: number;
    revelMean?: number | null;
    revelMedian?: number | null;
    revelMin?: number | null;
    revelMax?: number | null;
    revelCount?: number;
    amMean?: number | null;
    amMedian?: number | null;
    amMin?: number | null;
    amMax?: number | null;
    amCount?: number;
    gerp: number | null;
    phylop: number | null;
    consurf?: number | null;
    residue?: string;
  }[] | null;
  stringInteractions?: {
    partner: string;
    score: number;
  }[] | null;
  isDemoData?: boolean;
  dynamut2?: number | null;
  dynamut2Status?: string | null;
  dynamut2JobId?: string | null;
  ddmut?: number | null;
  ddmutStatus?: string | null;
  ddmutJobId?: string | null;
  rasp?: number | null;
  foldingEnergetics?: EnergeticsData | null;
  metadata?: {
    gene: string;
    variant: string;
    uniprotId: string;
    residueIndex: number | null;
    wildType: string;
    mutant: string;
    pdbId?: string | null;
    pdbSource?: string | null;
    analysisVersion?: {
      thresholds: string;
      geminiModel: string;
      foldxVersion: string;
      timestamp: string;
    } | null;
  };
  disruptionPredictor?: {
    level: "high" | "low";
    reason: string;
    plddt: number;
    burialStatus?: "core" | "surface" | "boundary";
    neighborCount?: number;
    rsa?: number;
    sasa?: number;
  };
  uniprotFeatures?: {
    features: {
      type: UniprotFeatureType;
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
    loeuf?: number | null;
    isPP2Constrained: boolean;
    regionalConstraint?: {
      isConstrained: boolean;
      oeRatio: number | null;
      pValue: number | null;
      regionText: string | null;
    } | null;
  } | null;
  /** Transcript metadata from /translate-variant (populated only when VCF/cDNA input is used) */
  transcriptId?: string;
  isCanonical?: boolean;
  transcriptWarning?: string;
  gnomadFrequency?: {
    maxAF: number | null;
    groupMaxAF: number | null;
    genomeAF: number | null;
    exomeAF: number | null;
    genomeAC: number | null;
    exomeAC: number | null;
    genomeAN: number | null;
    exomeAN: number | null;
    nHomozygous: number | null;
    dataset: string;
  } | null;
  aouFrequency?: {
    aouAC: number | null;
    aouAN: number | null;
    aouHet: number | null;
    aouHom: number | null;
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
  ddmut?: number | null;
  rasp?: number | null;
  ddgun?: number | null;
  consensusVerdict?: string | null;
  isRaspSurrogate?: boolean;
}

export interface StructuralDiffResult {
  rmsd: number;
  localRmsd: number | null;
  windowDisplacements: { resSeq: number; resName: string; displacement: number }[];
  clashes: {
    wtClashCount: number;
    mutClashCount: number;
    diff: number;
  };
}export interface PdbHomolog {
  pdbId: string;
  score: number;
  title: string;
  organism: string;
  method: string;
  resolution: number | null;
}
