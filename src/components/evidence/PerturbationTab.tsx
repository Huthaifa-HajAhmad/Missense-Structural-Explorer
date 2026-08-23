import React, { useState } from "react";
import { Activity, Layers, Sparkles } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { PerturbationModelCards, PerturbModelDef } from "./perturbation/PerturbationModelCards";
import { PerturbationMetricsBar } from "./perturbation/PerturbationMetricsBar";
import { ResiduePreferenceList } from "./perturbation/ResiduePreferenceList";
import { EmbeddingShiftChart } from "./perturbation/EmbeddingShiftChart";
import { PhysicalPerturbationSection } from "./perturbation/PhysicalPerturbationSection";
import { Esm3ExploratorySection } from "./perturbation/Esm3ExploratorySection";

export function PerturbationTab({
  analysisState,
  foldingEnergetics,
  structuralDiff,
  metrics,
  onOpenSettings
}: TabComponentProps) {
  const result = analysisState.result;
  const { settings } = useSettings();
  const [activePerturbModel, setActivePerturbModel] = useState<"saprot" | "esm2" | "esmc">(
    settings.defaultPerturbationModel
  );

  if (!result) return null;

  const wtRes = result.metadata?.wildType || "R";
  const mutRes = result.metadata?.mutant || "H";
  const pos = result.metadata?.residueIndex || 408;

  const models: PerturbModelDef[] = [
    {
      id: "saprot",
      name: "SaProt 650M AF2",
      description: "Structure-Aware Residue & Conformation Predictor",
      data: result.saprotEval,
      icon: Layers,
      tokenName: "Hugging Face Access Token",
      tokenSettingKey: "hfToken",
      hasKey: !!settings.hfToken,
      conformation: result.saprotEval?.conformationState || null
    },
    {
      id: "esm2",
      name: "ESM-2 3B",
      description: "Genomic Sequence Evolutionary Scale Transformer",
      data: result.esm2Eval,
      icon: Activity,
      tokenName: "Hugging Face Access Token",
      tokenSettingKey: "hfToken",
      hasKey: !!settings.hfToken
    },
    {
      id: "esmc",
      name: "ESMC 6B / VESM-150M",
      description: "Evolutionary Scale Foundation Model",
      data: result.esmcEval,
      icon: Sparkles,
      tokenName: "Biohub API Token",
      tokenSettingKey: "biohubApiToken",
      hasKey: !!settings.biohubApiToken
    }
  ];

  const activeList = models.filter(m => !!m.data);
  const hasAnyToken = !!settings.hfToken || !!settings.biohubApiToken;

  if (models.every(m => !m.data)) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed my-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center mb-2.5" style={{ background: "var(--cs-bg-subtle)", color: "var(--cs-text-muted)" }}>
          <Activity className="w-4 h-4 animate-pulse" />
        </div>
        <span className="font-mono text-xs font-semibold mb-1" style={{ color: "var(--cs-text-primary)" }}>
          {hasAnyToken ? "Structural Perturbation Analysis Unavailable" : "Structural Perturbation Analysis Offline"}
        </span>
        <p className="text-[11px] max-w-md font-sans leading-relaxed mb-3" style={{ color: "var(--cs-text-secondary)" }}>
          {hasAnyToken
            ? "The local ML model server (VESM-150M / SaProt) did not return results. It may still be loading or the analysis timed out. Try re-running the analysis."
            : "Deep transformer representation metrics (SaProt, ESM-2 3B, ESMC-6B) require an active Hugging Face Access Token or Biohub API Token."}
        </p>
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="px-4 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface-2)] cursor-pointer transition-colors shadow-sm"
          style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
        >
          {hasAnyToken ? "Review API Keys" : "Configure API Keys"}
        </button>
      </div>
    );
  }

  const currentModel = models.find(m => m.id === activePerturbModel) || activeList[0];
  const activeEval = currentModel.data;

  const allShifts = (!activeEval?.loading && !activeEval?.error && activeEval?.localShiftMap || []).map((d: any) => d.shift);
  const maxShift = allShifts.length > 0 ? Math.max(...allShifts) : 1.0;
  const shiftScale = maxShift > 0 ? (110 / (maxShift * 1.15)) : 110;
  const points = (!activeEval?.loading && !activeEval?.error && activeEval?.localShiftMap || []).map((d: any, index: number) => {
    const x = 40 + index * 24;
    const rawY = 140 - d.shift * shiftScale;
    const y = Math.max(12, Math.min(138, rawY));
    return { x, y, position: d.position, residue: d.residue, shift: d.shift };
  });
  const pathD = points.map((p: any, i: number) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  const isEsmc = activePerturbModel === "esmc";
  const shiftMetric = isEsmc ? "Cosine Distance" : "Euclidean Distance";
  const meanShift = allShifts.length > 0 ? (allShifts.reduce((a: number, b: number) => a + b, 0) / allShifts.length) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="screen-title flex items-center gap-1.5 text-left">
          <Activity className="w-5 h-5 text-[var(--cs-accent-clay)]" />
          Structural &amp; Evolutionary Perturbations
        </h1>
        <p className="screen-tab-description text-left">
          Zero-shot evolutionary sequence likelihoods, local embedding disruptions, and structural conformation state predictions from language models.
        </p>
      </div>

      {/* SECTION A HEADER */}
      <div className="flex items-center gap-3 pt-1">
        <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
          Section A: Sequence-Language-Model representation perturbation
        </span>
        <div className="flex-1 border-t" style={{ borderColor: "var(--cs-border-subtle)" }} />
      </div>

      {/* Grid 1: Model Selection Cards */}
      <PerturbationModelCards
        models={models}
        activeModelId={currentModel.id}
        onSelectModel={setActivePerturbModel}
        onOpenSettings={onOpenSettings}
      />

      {activeEval?.loading ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed my-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3 animate-spin text-purple-500" style={{ background: "rgba(147, 51, 234, 0.1)" }}>
            <Sparkles className="w-5 h-5 shrink-0" />
          </div>
          <span className="font-mono text-xs font-semibold mb-1" style={{ color: "var(--cs-text-primary)" }}>
            Calculating Deep Structural Representations...
          </span>
          <p className="text-[11px] max-w-sm font-sans leading-relaxed text-slate-400">
            Querying deep representation metrics and structure-aware embedding disruptions for {currentModel.name}.
          </p>
        </div>
      ) : activeEval?.error ? (
        <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed my-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
          <span className="font-mono text-xs font-semibold mb-1 text-rose-500">
            Failed to Load {currentModel.name}
          </span>
          <p className="text-[11px] max-w-sm font-sans leading-relaxed text-slate-400">
            {activeEval.error || "An error occurred while loading this model."}
          </p>
        </div>
      ) : activeEval ? (
        <>
          {/* Grid 2: Core Metrics of Selected Model */}
          <PerturbationMetricsBar
            activeEval={activeEval}
            wtRes={wtRes}
            mutRes={mutRes}
          />

          {/* Grid 3: Preference list & embedding shift chart */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ResiduePreferenceList
              preferences={activeEval.preferences || []}
              wtRes={wtRes}
              mutRes={mutRes}
              pos={pos}
            />

            <EmbeddingShiftChart
              activeEval={activeEval}
              activePerturbModel={activePerturbModel}
              pos={pos}
              points={points}
              pathD={pathD}
              shiftMetric={shiftMetric}
              meanShift={meanShift}
            />
          </div>

          {/* Section B: Physical Structural Geometry */}
          <PhysicalPerturbationSection
            activeEval={activeEval}
            currentModelName={currentModel.name}
            foldingEnergetics={foldingEnergetics}
            structuralDiff={structuralDiff}
            metrics={metrics}
            pos={pos}
          />

          {/* Section C: ESM3 exploratory structural hypotheses */}
          <Esm3ExploratorySection
            esm3Eval={result.esm3Eval}
          />
        </>
      ) : null}
    </div>
  );
}
