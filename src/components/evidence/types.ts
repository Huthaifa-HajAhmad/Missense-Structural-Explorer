import { AnalysisState, PocketResult, EnergeticsData, StructuralDiffResult, StructuralMetrics } from "../../types";

export type TabType = "clinical" | "predictors" | "structure" | "perturbation" | "function" | "interactions" | "guidelines";

export interface EvidenceDashboardCardProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  classBorderSec: string;
  classTextBody: string;
  classTextMute: string;
  analysisState: AnalysisState;
  foldingDdG: number | null;
  foldingStatus: "success" | "failed" | null;
  foldingEnergetics?: EnergeticsData | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
  disruptionPredictor?: { level: "high" | "low" | "unknown"; reason: string; plddt: number | null } | null;
  isFolding?: boolean;
  foldingError?: string | null;
  structuralDiff?: StructuralDiffResult | null;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  active3dModelTab?: "alphafold2" | "esm3";
  metrics?: StructuralMetrics | null;
  onOpenSettings?: () => void;
}

export interface TabComponentProps extends EvidenceDashboardCardProps {
  energyUnit: "kcal/mol" | "kJ/mol";
  formatDdGValue: (val: number | null, unit: "kcal/mol" | "kJ/mol") => string;
  setSelectedMetric: (metric: string | null) => void;
}
