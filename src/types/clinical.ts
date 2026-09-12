import type {
  AcmgEvidenceCode,
  ClinicalSignificance,
  ACMGCriteriaItem,
  ClinVarData,
  PredictorData,
  ConservationData
} from "../shared/contracts.ts";

export type {
  AcmgEvidenceCode,
  ClinicalSignificance,
  ACMGCriteriaItem,
  ClinVarData,
  PredictorData,
  ConservationData
};

export type AcmgVerdict = "Pathogenic" | "Likely Pathogenic" | "VUS" | "Likely Benign" | "Benign";

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
