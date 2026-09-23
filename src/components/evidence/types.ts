import { AnalysisState, PocketResult, EnergeticsData, StructuralDiffResult, StructuralMetrics } from "../../types";
import { MasterView } from "../MasterSidebar";

export type TabType = "clinical" | "predictors" | "structure" | "multimers" | "perturbation" | "function" | "interactions" | "guidelines" | "splicing" | "alphagenome";

export interface EvidenceDashboardCardProps {
  isDark: boolean;
  isBiophysicalLoading?: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  classBorderSec: string;
  classTextBody: string;
  classTextMute: string;
  analysisState: AnalysisState;
  foldingDdG: number | null;
  foldingStatus: "success" | "failed" | "unavailable" | null;
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
  active3dModelTab?: "alphafold2" | "esmfold2" | "esm3";
  metrics?: StructuralMetrics | null;
  onOpenSettings?: () => void;
  onRetryStructural?: (overrides?: { saprotEngine?: string }) => void | Promise<void>;
  onRetryPocket?: () => void | Promise<void>;
  onSelectResidue?: (index: number) => void;
  onNavigateToView?: (view: MasterView) => void;
}

export interface TabComponentProps extends EvidenceDashboardCardProps {
  energyUnit: "kcal/mol" | "kJ/mol";
  formatDdGValue: (val: number | null, unit: "kcal/mol" | "kJ/mol") => string;
  setSelectedMetric: (metric: string | null) => void;
}
