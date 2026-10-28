import React from "react";
import type { AnalysisResult, EnergeticsData, PocketResult } from "../../types";
import type { PerturbationModelId } from "../../shared/perturbationModels";
import { findEvidenceTab, type EvidenceTabId } from "../../shared/evidenceTabs";
import SplicingRail from "./SplicingRail";
import PerturbationRail from "./PerturbationRail";
import { FunctionRail } from "./FunctionRail";
import { PopulationRail } from "./PopulationRail";
import { EvidenceContextRail } from './EvidenceContextRail';
import { InterfacesRail } from "./InterfacesRail";
import { PredictorsRail } from "./PredictorsRail";
import { normalizeEvidenceTab } from "../evidence/types";
import { AlphaGenomeRail } from "./AlphaGenomeRail";
import ResidueShiftInspector from "./ResidueShiftInspector";

/**
 * The props the heavier rails need beyond the payload. They are flat (not one object) so the
 * `React.memo` below still compares them one by one.
 */
interface EvidenceInspectorProps {
  analysisResult: AnalysisResult | null;
  activeEvidenceTab?: string;
  isBiophysicalLoading?: boolean;
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
  isNarrativeLoading?: boolean;
  onRetryPocket?: () => void | Promise<void>;
  onRetryNarrative?: () => void | Promise<void>;
  activePerturbationModel?: PerturbationModelId;
  saprotEngine?: string | null;
  foldingEnergetics?: EnergeticsData | null;
  structuralDiff?: unknown;
  metrics?: unknown;
  isFolding?: boolean;
  foldingStatus?: "success" | "failed" | "unavailable" | null;
  foldingError?: string | null;
}

type RailProps = Omit<EvidenceInspectorProps, "analysisResult" | "activeEvidenceTab"> & { analysisResult: AnalysisResult };

/**
 * One rail per Evidence tab, and the ONLY place the routing lives.
 *
 * It used to be split: `ViewInspector` routed splicing, structure and perturbation, this file routed
 * the rest, its own `structure` branch could never render, and an unknown id fell through to a
 * "placeholder telemetry" box. The map is keyed by the registry's id type, so a new tab does not
 * build until it has a rail; an unrecognised id falls back to Population, as the tab body does.
 */
const RAILS: Record<EvidenceTabId, (p: RailProps) => React.ReactNode> = {
  clinical: p => <PopulationRail analysisResult={p.analysisResult} />,
  "gene-disease": p => <EvidenceContextRail analysisResult={p.analysisResult} expression={false} species={false} />,
  "expression-models": p => <EvidenceContextRail analysisResult={p.analysisResult} expression species={false} />,
  "species-models": p => <EvidenceContextRail analysisResult={p.analysisResult} expression={false} species />,
  function: p => <FunctionRail analysisResult={p.analysisResult} />,
  predictors: p => <PredictorsRail analysisResult={p.analysisResult} />,
  alphagenome: p => <AlphaGenomeRail analysisResult={p.analysisResult} isBiophysicalLoading={p.isBiophysicalLoading} />,
  splicing: p => <SplicingRail analysisResult={p.analysisResult} isBiophysicalLoading={p.isBiophysicalLoading} />,
  structure: p => (
    <ResidueShiftInspector
      analysisResult={p.analysisResult}
      computedPocket={p.computedPocket}
      isPocketLoading={p.isPocketLoading}
      pocketError={p.pocketError}
      isBiophysicalLoading={p.isBiophysicalLoading}
      isNarrativeLoading={p.isNarrativeLoading}
      onRetryPocket={p.onRetryPocket}
      onRetryNarrative={p.onRetryNarrative}
    />
  ),
  perturbation: p => (
    <PerturbationRail
      analysisResult={p.analysisResult}
      activePerturbationModel={p.activePerturbationModel}
      saprotEngine={p.saprotEngine}
      foldingEnergetics={p.foldingEnergetics}
      structuralDiff={p.structuralDiff}
      metrics={p.metrics}
      isFolding={p.isFolding}
      foldingStatus={p.foldingStatus}
      foldingError={p.foldingError}
    />
  ),
  interfaces: p => <InterfacesRail analysisResult={p.analysisResult} />,
};

export const EvidenceInspector: React.FC<EvidenceInspectorProps> = ({
  analysisResult,
  activeEvidenceTab = "clinical",
  ...rest
}) => {
  if (!analysisResult) {
    return (
      <p className="text-xs text-cs-text-muted p-2">
        No analysis loaded. Run a variant query to see how this evidence was traced.
      </p>
    );
  }
  const tab = findEvidenceTab(normalizeEvidenceTab(activeEvidenceTab?.toLowerCase() || "clinical"))?.id ?? "clinical";
  return (
    <div className="flex flex-col gap-4 text-xs font-sans" data-evidence-rail={tab}>
      {RAILS[tab]({ ...rest, analysisResult })}
    </div>
  );
};

export default React.memo(EvidenceInspector);
