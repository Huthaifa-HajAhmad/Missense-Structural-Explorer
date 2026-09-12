export type {
  StructureProvenance,
  GenerateMutantResponse,
  AnalyzeVariantResponse,
  PdbHomolog,
  DisruptionPredictorResult,
  UniprotFeaturesData,
  UniprotFeatureItem,
  UniprotFeatureType,
  NearestResidue
} from "../shared/contracts.ts";

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
