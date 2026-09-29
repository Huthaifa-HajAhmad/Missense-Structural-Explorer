import type { LandscapeResidueItem } from "../../shared/contracts";
import type { SummaryMode } from "../../shared/landscapeEvidence";

export interface TargetMutation {
  wt: string;
  pos: number;
  mut: string;
}

/** The queried variant's own scores, drawn apart from the residue summaries. */
export interface VariantScores {
  revel: number | null;
  am: number | null;
  gerp: number | null;
  phylop: number | null;
}

export interface DomainSpan {
  name: string;
  start: number;
  end: number;
}

export interface SequenceRowGridProps {
  wildWindow: string[];
  relativeStartIndex: number;
  mutation: TargetMutation;
  residueIndex: number | null;
  hoveredResidueIndex?: number | null;
  landscapeMap: Map<number, LandscapeResidueItem>;
  metricMode: SummaryMode;
  variantScores: VariantScores;
  domains: DomainSpan[];
  residueClass: (res: string) => string;
  onResidueClick?: (index: number) => void;
  onResidueHover: (index: number | null) => void;
  /** Window positions that are still being fetched (the grid shows them as loading, not absent). */
  loadingWindow: boolean;
}
