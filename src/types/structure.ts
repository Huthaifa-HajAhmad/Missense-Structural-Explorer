import type {
  StructureProvenance,
  GenerateMutantResponse,
  AnalyzeVariantResponse
} from "../shared/contracts.ts";

export type {
  StructureProvenance,
  GenerateMutantResponse,
  AnalyzeVariantResponse
};

export type UniprotFeatureType = 
  | "DOMAIN" | "REGION" | "ACTIVE_SITE" | "BINDING" | "MUTAGEN" | "DISULFID" | "METAL" | "SITE" 
  | (string & {});

export interface UniprotFeatureItem {
  type: UniprotFeatureType;
  description: string;
  start: number;
  end: number;
  interproId?: string;
}

export interface UniprotFeaturesData {
  features: UniprotFeatureItem[];
  geneName?: string;
  subunitComment?: string | null;
  isMultimer?: boolean;
  sequenceLength?: number;
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

export interface NearestResidue {
  name: string;
  distance: string;
  properties: string;
  role: string;
  classBadge: string;
  source?: "curated" | "computed";
}

export interface PocketResidue {
  index: number;
  chain?: string;
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
  status?: "success" | "fallback" | "none_detected" | "unavailable" | string;
  sasPoints?: number;
  surfaceAtoms?: number;
}

export interface StructuralMetrics {
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
  sasaDiff?: { delta: number };
  hBondsDiff?: { lostCount: number; gainedCount: number };
  contactsDiff?: { lostCount: number; gainedCount: number };
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
  querySeqFrom?: number;
  querySeqTo?: number;
  coversPosition?: boolean;
}
