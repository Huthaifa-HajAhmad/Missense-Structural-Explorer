import { NearestResidue } from "../../types";

export interface HoveredResidueInfo {
  symbol: string;
  pos: number;
  type: "wild" | "mutant" | "normal";
}

export interface SequenceRowGridProps {
  wildWindow: string[];
  relativeStartIndex: number;
  mutationIndex: number;
  residueIndex: number | null;
  hoveredResidueIndex?: number | null;
  mutation: { wt: string; pos: number; mut: string };
  landscapeMap: Map<number, any>;
  metricMode: "mean" | "max";
  getResidueBaseColor: (res: string) => string;
  getGerpScore: (pos: number) => number | null;
  getPhyloPScore: (pos: number) => number | null;
  getRevelScore?: (pos: number) => number | null;
  getAmScore?: (pos: number) => number | null;
  onResidueClick?: (index: number) => void;
  hoveredResidue: HoveredResidueInfo | null;
  setHoveredResidue: (res: HoveredResidueInfo | null) => void;
}

export interface ResidueDetailTooltipProps {
  hoveredResidue: HoveredResidueInfo | null;
  hoveredResidueIndex?: number | null;
  residueIndex: number | null;
  mutationIndex: number;
  sequence: string;
  mutation: { wt: string; pos: number; mut: string };
  uniprotId: string;
  variant: string;
  landscapeMap: Map<number, any>;
  conservationData?: any;
  predictorData?: any;
  computedResiduesCache?: Record<string, NearestResidue[]>;
  getGerpScore: (pos: number) => number | null;
  getPhyloPScore: (pos: number) => number | null;
  getBiophysicalConsequence: (symbol: string, pos: number) => string;
  getSubstitutionalConsequences: (symbol: string, pos: number) => any[];
}
