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
  getRevelScore: (pos: number) => number | null;
  getAmScore: (pos: number) => number | null;
  onResidueClick?: (index: number) => void;
  hoveredResidue: HoveredResidueInfo | null;
  setHoveredResidue: (res: HoveredResidueInfo | null) => void;
}
