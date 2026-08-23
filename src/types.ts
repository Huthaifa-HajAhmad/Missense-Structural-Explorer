import type {
  AcmgEvidenceCode,
  ClinicalSignificance,
  ACMGCriteriaItem,
  ClinVarData,
  StructureProvenance,
  EnergeticsData,
  EsmcPreference,
  EsmcLocalShift,
  EsmcEvalResult,
  PredictorData,
  ConservationData,
  GenerateMutantResponse,
  AnalyzeVariantResponse
} from "./shared/contracts.ts";

export type {
  AcmgEvidenceCode,
  ClinicalSignificance,
  ACMGCriteriaItem,
  ClinVarData,
  StructureProvenance,
  EnergeticsData,
  EsmcPreference,
  EsmcLocalShift,
  EsmcEvalResult,
  PredictorData,
  ConservationData,
  GenerateMutantResponse,
  AnalyzeVariantResponse
};

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

export type AcmgVerdict = "Pathogenic" | "Likely Pathogenic" | "VUS" | "Likely Benign" | "Benign";

export interface BiophysicalApiResponse {
  biochemicalShift: string;
  structuralImpact: string;
}

export type UniprotFeatureType = 
  | "DOMAIN" | "REGION" | "ACTIVE_SITE" | "BINDING" | "MUTAGEN" | "DISULFID" | "METAL" | "SITE" 
  | (string & {});

export interface ClinicalInsight {
  biochemicalShift: string;
  structuralImpact: string;
  acmgCriteria: ACMGCriteriaItem[];
  pathogenicity?: string;
  plausibility?: string;
  acmgVerdict?: AcmgVerdict;
  partialEvidence?: { available: string[]; unavailable: string[] };
}

export interface RuleBasedInsights {
  plausibility: string;
  acmgVerdict: AcmgVerdict;
  acmgCriteria: ACMGCriteriaItem[];
  partialEvidence?: { available: string[]; unavailable: string[] };
}

export interface LandscapeResidueItem {
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
}

export interface StringInteractionItem {
  partner: string;
  score: number;
}

export interface Esm3EvalResult {
  uniprotId: string;
  position: number;
  wtResidue: string;
  mutResidue: string;
  pdbText: string | null;
  perturbationScores: number[];
  maxDriftResidue: number;
  structuralChangeLevel: "none" | "minor" | "moderate" | "major";
  microenvironments: string[];
  putativeStructuralChanges: string[];
  confidence: {
    level: "high" | "moderate" | "low";
    plddt?: number | null;
    sequenceCoverage?: number | null;
  };
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
}

export interface DisruptionPredictorResult {
  level: "high" | "low" | "unknown";
  reason: string;
  plddt: number | null;
  burialStatus?: "core" | "surface" | "boundary";
  neighborCount?: number;
  rsa?: number | null;
  sasa?: number | null;
}

export interface UniprotFeatureItem {
  type: UniprotFeatureType;
  description: string;
  start: number;
  end: number;
}

export interface UniprotFeaturesData {
  features: UniprotFeatureItem[];
  geneName?: string;
  subunitComment?: string | null;
  isMultimer?: boolean;
}

export interface GnomadConstraintData {
  missense_z: number | null;
  oe_mis: number | null;
  pli: number | null;
  loeuf?: number | null;
  isPP2Constrained: boolean;
  hasRegionalData?: boolean;
  regionalConstraint?: {
    isConstrained: boolean;
    oeRatio: number | null;
    pValue: number | null;
    regionText: string | null;
  } | null;
}

export interface GnomadFrequencyData {
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
  groupMaxAFIsFallback?: boolean;
}

export interface AouFrequencyData {
  aouAC: number | null;
  aouAN: number | null;
  aouHet: number | null;
  aouHom: number | null;
}

export interface Esm2ScoreData {
  llr: number | null;
  verdict: string | null;
}

export interface BiophysicalModelingData {
  dynamut2?: number | null;
  dynamut2Status?: string | null;
  dynamut2JobId?: string | null;
  ddmut?: number | null;
  ddmutStatus?: string | null;
  ddmutJobId?: string | null;
  rasp?: number | null;
  thermompnn?: number | null;
  thermompnnStatus?: string | null;
  thermompnnJobId?: string | null;
  foldingEnergetics?: EnergeticsData | null;
  biophysicalEnergetics?: any;
}

export interface TranscriptMetadata {
  transcriptId?: string;
  isManeSelect?: boolean;
  isManePlusClinical?: boolean;
  isCanonical?: boolean;
  maneRefSeqId?: string;
  transcriptWarning?: string;
}

export interface LanguageModelEvaluations {
  esm3Eval?: Esm3EvalResult | { error: string } | null;
  esmcEval?: EsmcEvalResult | null;
  esm2Eval?: EsmcEvalResult | null;
  saprotEval?: (EsmcEvalResult & { conformationState?: string | null; klDivergence?: number | null }) | null;
  esm2?: Esm2ScoreData | null;
}

export interface AnalysisResult extends BiophysicalModelingData, TranscriptMetadata, LanguageModelEvaluations {
  analysis?: string | null;
  insights?: ClinicalInsight | null;
  ruleBasedInsights?: RuleBasedInsights | null;
  clinvar?: ClinVarData | null;
  predictorData?: PredictorData | null;
  conservationData?: ConservationData | null;
  landscapeData?: LandscapeResidueItem[] | null;
  stringInteractions?: StringInteractionItem[] | null;
  isDemoData?: boolean;
  metadata?: VariantMetadata;
  disruptionPredictor?: DisruptionPredictorResult;
  uniprotFeatures?: UniprotFeaturesData | null;
  gnomadConstraint?: GnomadConstraintData | null;
  gnomadFrequency?: GnomadFrequencyData | null;
  aouFrequency?: AouFrequencyData | null;
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

export interface BiophysicsConditions {
  ph: number;
  temperature: number; // °C
  ionicStrength: number; // mM
}

export interface UserSettings {
  residueColor: string; // e.g., "#F97316"
  primaryAccent: "indigo" | "purple" | "rose" | "emerald" | "amber" | "blue";
  geminiApiKey?: string;
  geminiSessionId?: string;
  geminiSessionExpiresAt?: number;
  appApiToken?: string;
  biohubApiToken?: string;
  tamarindApiKey?: string;
  hfToken?: string;
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
  biophysicsConditions: BiophysicsConditions;
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

export interface StructuralMetrics {
  // Flat properties
  localWindowRmsd?: number;
  globalRmsd?: number;
  chi1Deviation?: number | null;
  sasaChange?: number;
  lostHBonds?: number;
  gainedHBonds?: number;
  lostContacts?: number;
  gainedContacts?: number;
  displacements?: { resSeq: number; resName: string; displacement: number }[];
  wtSasa?: number;
  mutSasa?: number;
  wtChi1?: number | null;
  mutChi1?: number | null;

  // Nested structures for viewer rendering compatibility
  sasaDiff?: { delta: number };
  hBondsDiff?: { lostCount: number; gainedCount: number };
  contactsDiff?: { lostCount: number; gainedCount: number };

  // Mapped/deprecated properties
  localBackboneRmsd?: number;
  maxCaDisplacement?: number;
  sidechainRmsd?: number;
  deltaSasa?: number;
  hbondDelta?: number;
  saltBridgeDelta?: number;
  foldxSd?: number;
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
}

export interface PdbHomolog {
  pdbId: string;
  score: number;
  identity: number;
  coverage: number;
  title: string;
  organism: string;
  method: string;
  resolution: number | null;
  isHuman: boolean;
  unpStart?: number;
  structStart?: number;
  /** Start position in the query (UniProt) sequence covered by the RCSB alignment (1-indexed) */
  querySeqFrom?: number;
  /** End position in the query (UniProt) sequence covered by the RCSB alignment (1-indexed) */
  querySeqTo?: number;
  /** True if the aligned region covers the requested mutation position */
  coversPosition?: boolean;
}
