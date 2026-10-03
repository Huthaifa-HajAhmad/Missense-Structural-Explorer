import { AnalysisState, PocketResult, EnergeticsData, StructuralDiffResult, StructuralMetrics } from "../../types";
import { MasterView } from "../MasterSidebar";

export type TabType = "clinical" | "predictors" | "structure" | "perturbation" | "function" | "interfaces" | "splicing" | "alphagenome";

/**
 * Ids of evidence tabs that no longer exist, and the tab that took over. "Score thresholds" repeated
 * the Predictors tab; its strength ladder now lives there. "Multimer assembly" and "Protein
 * interactions" answered the same interface question twice and became Interfaces & PPI
 * (doc/INTERFACES_AUDIT.md). A stale id (a bookmark, a palette recent, a link from an older build)
 * lands on the successor rather than on a blank pane.
 */
const RETIRED_EVIDENCE_TABS: Record<string, TabType> = {
  guidelines: "predictors",
  thresholds: "predictors",
  multimers: "interfaces",
  interactions: "interfaces",
};

/** The tab id to render for `tab`: a retired id becomes its successor, anything else passes through. */
export function normalizeEvidenceTab(tab: string): string {
  return RETIRED_EVIDENCE_TABS[tab.toLowerCase()] ?? tab;
}

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
