import type {
  EnergeticsData,
  EsmcPreference,
  EsmcLocalShift,
  EsmcEvalResult
} from "../shared/contracts.ts";

export type {
  EnergeticsData,
  EsmcPreference,
  EsmcLocalShift,
  EsmcEvalResult
};

export interface BiophysicalApiResponse {
  biochemicalShift: string;
  structuralImpact: string;
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

export interface LanguageModelEvaluations {
  esm3Eval?: Esm3EvalResult | { error: string } | null;
  esmcEval?: EsmcEvalResult | null;
  esm2Eval?: EsmcEvalResult | null;
  saprotEval?: (EsmcEvalResult & { conformationState?: string | null; klDivergence?: number | null; hfError?: string | null }) | null;
  esm2?: Esm2ScoreData | null;
}

export interface PpiBindingData {
  status: "success" | "unavailable" | "failed";
  gene: string;
  variant: string;
  uniprotId?: string;
  stringPartners: Array<{ partner: string; score: number }>;
  bindingShift: {
    ddgBind: number | null;
    unit: string;
    classification: "INTERFACE_DISRUPTIVE" | "ALLOSTERIC_PERTURBATION" | "SURFACE_NEUTRAL" | "UNKNOWN";
    provenance: string;
  } | null;
  interfaceResidues: Array<{
    pos: number;
    description: string;
    isVariantPosition: boolean;
  }>;
  error?: string;
}

export interface MultimerData {
  status: "success" | "monomeric" | "failed";
  gene: string;
  uniprotId: string;
  oligomericState: string;
  chainCount: number;
  chainIds: string[];
  complexPdb: string | null;
  ipTm: number | null;
  pTm: number | null;
  interfaceContacts: Array<{ resA: number; resB: number; distance: number }>;
  mutationInterfaceDisrupted: boolean;
  provenance: string;
  subunitComment?: string | null;
  error?: string;
}

export interface BiophysicsConditions {
  ph: number;
  temperature: number; // °C
  ionicStrength: number; // mM
}
