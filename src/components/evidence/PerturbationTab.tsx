import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import type { ModelAction } from "../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../shared/perturbationModels";
import { selectLmReading } from "../../shared/perturbationSummary";
import { evidenceTab } from '../../shared/evidenceTabs';
import { EvidencePanel, EvidenceViewTabs, useEvidenceWorkspace } from './EvidenceWorkspace';
import { EmbeddingProfile } from './perturbation/EmbeddingProfile';
import { FindingCard } from "./perturbation/FindingCard";
import { ReadingsTable } from "./perturbation/ReadingsTable";
import { ResidueDetail } from "./perturbation/ResidueDetail";
import { usePerturbationEvidence } from "./perturbation/usePerturbationEvidence";
import { ViewIntro } from "./perturbation/ViewIntro";

/**
 * Structural perturbation.
 *
 * ONE QUESTION: how do sequence and structure models read this substitution at its own position,
 * and what does that license? The answer is context: nothing here is an ACMG input. Three tiers,
 * the shape Population Data and Predictors set:
 *
 *   1. THE FINDING — the cross-model statement (which way each language model reads the substitution,
 *      from its own output), the finding sentence with each model's own odds, one strip of the three
 *      models, the caveats that change how to read them, and a fact strip ending in the engine record.
 *   2. READINGS — one table: language models, FoldX energy terms, ESM3 — every source a row on its
 *      own axis, every mark drawn dashed because none is published.
 *   3. RESIDUE DETAIL — one model's residue distribution and embedding-shift trace.
 *
 * INVARIANTS
 *   • Every reading comes from `buildPerturbationEvidence`; no file under this tab tests a score.
 *   • No composite. The 0–100 "Local perturbation score" was removed (owner decision, 2026-09-29):
 *     its weights, transform and bands were app-defined, and it averaged three model-native ΔLLRs.
 *   • No red or green: nothing on this tab is an ACMG code.
 *   • A rank is never shown without the native residue's rank beside it, and a flat distribution's
 *     rank is never read (SLC12A4 p.Gln867His: "most preferred" beside a ΔLLR of −6.98).
 *   • Clay is the variant residue everywhere (pips, rulers, bars); a hollow ink ring is the native.
 *
 * Replaced: model cards + metric bar + "Section A/B/C" card grids, a timed fake progress bar for
 * SaProt (stages guessed from elapsed seconds), and a hooks-after-early-return bug.
 */

/**
 * Which sections a view shows. `all` is the single-page layout used outside the workspace;
 * `comparison`, `records` and `embeddings` are the workspace's Model comparison, Packing & geometry
 * and Sequence embeddings views.
 */
type PerturbationView = "all" | "comparison" | "records" | "embeddings";

export function PerturbationTab({
  analysisState,
  foldingEnergetics,
  foldingStatus,
  foldingError,
  structuralDiff,
  metrics,
  isFolding,
  onOpenSettings,
  onRetryStructural,
  onNavigateToView
}: TabComponentProps) {
  const result = analysisState.result;
  const workspace = useEvidenceWorkspace('perturbation');
  const { settings, updateSetting, openSettingsTab } = useSettings();
  const activeModel = useVariantAnalysisStore(s => s.activePerturbationModel);
  const setActiveModel = useVariantAnalysisStore(s => s.setActivePerturbationModel);
  const selectModel = (id: PerturbationModelId) => { setActiveModel(id); workspace.setOptions({ section: id }); workspace.select(id); };
  const [busy, setBusy] = useState(false);

  // Seed the selection from the configured default when a new variant is analysed.
  useEffect(() => {
    if (!workspace.enabled) setActiveModel(settings.defaultPerturbationModel);
  }, [settings.defaultPerturbationModel, setActiveModel, result?.metadata?.gene, result?.metadata?.variant]);

  // All hooks run before the null guard: `result` can turn null on an instance that has rendered.
  const evidence = usePerturbationEvidence(result, {
    foldingEnergetics,
    structuralDiff,
    metrics,
    saprotEngine: settings.saprotEngine,
    isFolding,
    foldingStatus,
    foldingError
  });
  const preferred = workspace.enabled ? (workspace.section || settings.defaultPerturbationModel) as PerturbationModelId : activeModel;
  const selected = evidence ? selectLmReading(evidence, preferred) : null;
  // The legacy rail and 3D consumers follow the model actually displayed, including fallbacks.
  useEffect(() => {
    if (workspace.enabled && selected) setActiveModel(selected.id);
  }, [workspace.enabled, selected?.id, setActiveModel]);
  if (!result || !evidence) return null;

  const rerun = async (overrides?: { saprotEngine?: string }) => {
    if (!onRetryStructural) return;
    setBusy(true);
    try {
      await onRetryStructural(overrides);
    } finally {
      setBusy(false);
    }
  };
  const onAction = (action: ModelAction) => {
    if (busy) return;
    if (action === "switch-saprot-35m") {
      updateSetting("saprotEngine", "saprot-35m");
      void rerun({ saprotEngine: "saprot-35m" });
    } else if (action === "retry") {
      void rerun();
    } else if (onOpenSettings) {
      onOpenSettings();
    } else {
      openSettingsTab("connections");
    }
  };

  const view: PerturbationView = !workspace.enabled
    ? "all"
    : workspace.comparison
      ? "comparison"
      : workspace.view === "embeddings" ? "embeddings" : "records";
  const showsFinding = view === "all" || view === "comparison";
  const selectedId = selected?.id ?? null;

  return (
    <div data-evidence-screen className="ptb-screen" data-comparison={workspace.comparison || undefined}>
      <header className="ptb-header">
        <h1 className="screen-title">{evidenceTab('perturbation').label}</h1>
        <p className="screen-tab-description">
          Sequence preferences, modelled packing and changes in sequence representations. These results provide context, not clinical evidence.
        </p>
      </header>
      <EvidenceViewTabs tab="perturbation" comparisonLabel="Model comparison" />
      <EvidencePanel tab="perturbation">
        {showsFinding && (
          <FindingCard evidence={evidence} selectedId={selectedId} onSelect={selectModel} onAction={onAction} />
        )}
        {(view === "records" || view === "embeddings") && <ViewIntro evidence={evidence} view={view} />}
        {view === "embeddings" && <EmbeddingProfile evidence={evidence} />}
        {(view === "all" || view === "records" || (view === "embeddings" && evidence.esm3)) && (
          <ReadingsTable evidence={evidence} view={view} selectedId={selectedId} onAction={onAction} onNavigateToView={onNavigateToView} />
        )}
        {view === "embeddings" && !evidence.esm3 && <p>No sequence embedding measurements were returned for this variant.</p>}
        {showsFinding && <ResidueDetail evidence={evidence} selected={selected} />}
        {busy && (
          <p role="status" className="ptb-callout" data-tone="neutral">
            <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Re-running the structural models…</span>
          </p>
        )}
      </EvidencePanel>
    </div>
  );
}

export default PerturbationTab;
