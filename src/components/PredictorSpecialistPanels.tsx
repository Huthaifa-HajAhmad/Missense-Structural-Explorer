import React, { useState } from "react";
import { Brain, Cpu, Database, HeartHandshake, HelpCircle, Info, Layers, ShieldAlert, Sparkles } from "lucide-react";
import { THRESHOLDS, THRESHOLD_NOTES, evaluateGpnStar } from "../shared/thresholds";
import { ModelKnowledgeModal } from "./modals/ModelKnowledgeModal";
import { useSettings } from "../context/SettingsContext";
import type { AlphaGenomeAviData } from "../shared/contracts";

interface PredictorSpecialistPanelsProps {
  predictorData?: {
    amPathogenicity: number | null;
    amClass: string | null;
    caddPhred: number | null;
    source?: string;
  } | null;
  conservationData?: {
    revel: number | null;
    gerp: number | null;
    phylop: number | null;
    consurf: number | null;
    bayesdel?: number | null;
    metarnn?: number | null;
    metarnnPred?: string | null;
    clinpred?: number | null;
    clinpredPred?: string | null;
    eigenPhred?: number | null;
    eigenRaw?: number | null;
    dann?: number | null;
    esm1b?: number | null;
    esm1bPred?: string | null;
    popeve?: number | null;
    gpnStar?: number | null;
    gpnStarStatus?: "live" | "token_required" | "unavailable";
    gpnStarMessage?: string | null;
    alphagenome?: AlphaGenomeAviData | null;
    source?: string;
  } | null;
  vesmScore?: number | null;
  esm2Score?: number | null;
  saprotScore?: number | null;
  saprotEval?: any;
  isLoading?: boolean;
  isStructuralLoading?: boolean;
  onOpenSettings?: () => void;
  onTabChange?: (tab: string) => void;
}

type TabType = "lms" | "meta" | "annotations" | "evolution";

export const PredictorSpecialistPanels: React.FC<PredictorSpecialistPanelsProps> = ({
  predictorData,
  conservationData,
  vesmScore,
  esm2Score,
  saprotScore,
  saprotEval,
  isLoading = false,
  isStructuralLoading = false,
  onOpenSettings,
  onTabChange
}) => {
  const { openSettingsTab } = useSettings();
  const renderScoreValue = (val: number | null, decimals = 3) => {
    if (val !== null && val !== undefined) {
      return decimals === 0 ? val.toString() : val.toFixed(decimals);
    }
    if (isLoading) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400 font-medium animate-pulse">
          <span className="w-1 h-1 rounded-full bg-indigo-500 animate-ping shrink-0" />
          <span>Computing...</span>
        </span>
      );
    }
    return "N/A";
  };
  const [activeTab, setActiveTab] = useState<TabType>("meta");
  const [knowledgeModalKey, setKnowledgeModalKey] = useState<string | null>(null);

  const renderSourceLabel = (source: string) => {
    return (
      <div className="text-[10px] mt-2 font-medium" style={{ color: "var(--cs-text-muted)", opacity: 0.7 }}>
        Source: {source}
      </div>
    );
  };

  const amScore = predictorData?.amPathogenicity ?? null;
  const amClass = predictorData?.amClass ?? null;
  const caddVal = predictorData?.caddPhred ?? null;

  const revel = conservationData?.revel ?? null;
  const gerp = conservationData?.gerp ?? null;
  const phylop = conservationData?.phylop ?? null;
  const consurf = conservationData?.consurf ?? null;
  const bayesdel = conservationData?.bayesdel ?? null;
  const metarnn = conservationData?.metarnn ?? null;
  const clinpred = conservationData?.clinpred ?? null;
  const eigen = conservationData?.eigenPhred ?? null;
  const dann = conservationData?.dann ?? null;
  const esm1b = conservationData?.esm1b ?? null;
  const popeve = conservationData?.popeve ?? null;
  const gpnScore = conservationData?.gpnStar ?? null;
  const gpnStatus = conservationData?.gpnStarStatus ?? (gpnScore !== null ? "live" : "unavailable");
  const gpnMessage = conservationData?.gpnStarMessage ?? null;

  const alphagenome = conservationData?.alphagenome ?? null;
  const aviPhred = alphagenome?.aviPhred ?? null;
  const aviStrength = alphagenome?.acmgStrength ?? "indeterminate";
  const aviTopModality = alphagenome?.topModality ?? null;
  const aviPercentile = alphagenome?.topPercentile ?? null;

  // Helper to render score bars
  /**
   * Pass `null` for both cut-points when the model has no published threshold on its own
   * score scale. The value is still plotted, but on a neutral bar with no verdict colouring
   * and no cutoff markers, because a cut-point belonging to another model would mislead.
   */
  const renderScoreBar = (
    val: number | null,
    min: number,
    max: number,
    threshLow: number | null,
    threshHigh: number | null,
    invert = false
  ) => {
    if (val === null) return null;
    const percentage = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

    const hasCutPoints = threshLow !== null && threshHigh !== null;
    const lowPercent = hasCutPoints ? ((threshLow! - min) / (max - min)) * 100 : 0;
    const highPercent = hasCutPoints ? ((threshHigh! - min) / (max - min)) * 100 : 0;

    const isPathogenic = hasCutPoints && (invert ? val <= threshLow! : val >= threshHigh!);
    const isBenign = hasCutPoints && (invert ? val >= threshHigh! : val <= threshLow!);

    let barColor = hasCutPoints ? "bg-amber-500/80" : "bg-slate-500/60";
    if (isPathogenic) barColor = "bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
    if (isBenign) barColor = "bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.5)]";

    return (
      <div className="w-full mt-2.5">
        <div className="relative w-full h-2 rounded-full overflow-hidden border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          {/* Threshold markers — omitted entirely when no cut-point exists for this model */}
          {hasCutPoints && (
            <>
              <div className="absolute top-0 bottom-0 w-0.5 bg-emerald-500/50" style={{ left: `${invert ? highPercent : lowPercent}%` }} title="Benign Cutoff" />
              <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/50" style={{ left: `${invert ? lowPercent : highPercent}%` }} title="Pathogenic Cutoff" />
            </>
          )}
          {/* Fill Bar */}
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${percentage}%` }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1 px-0.5" style={{ color: "var(--cs-text-muted)" }}>
          <span>Min: {min}</span>
          {hasCutPoints ? <span>Max: {max}</span> : <span className="italic">No calibrated cut-point</span>}
        </div>
      </div>
    );
  };

  // Helper to render evaluation badges
  const renderBadge = (type: "pathogenic" | "benign" | "vus" | "unavailable", text?: string) => {
    switch (type) {
      case "pathogenic":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <ShieldAlert className="w-3.5 h-3.5 mr-1 text-rose-500" />
            {text || "Deleterious"}
          </span>
        );
      case "benign":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <HeartHandshake className="w-3.5 h-3.5 mr-1 text-emerald-500" />
            {text || "Tolerated"}
          </span>
        );
      case "vus":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Layers className="w-3.5 h-3.5 mr-1 text-amber-500" />
            {text || "VUS / Indeterminate"}
          </span>
        );
      default:
        if (isLoading) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping mr-1.5 shrink-0" />
              Streaming...
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
            <HelpCircle className="w-3.5 h-3.5 mr-1 text-slate-400" />
            {text || "Unavailable"}
          </span>
        );
    }
  };

  const getEsmSignal = (llr: number | null): "pathogenic" | "benign" | "vus" | "unavailable" => {
    if (llr === null) return "unavailable";
    return "vus";
  };

  const getGpnSignal = (score: number | null): "pathogenic" | "benign" | "vus" | "unavailable" => {
    return evaluateGpnStar(score);
  };

  const getAmSignal = (score: number | null): "pathogenic" | "benign" | "vus" | "unavailable" => {
    if (score === null) return "unavailable";
    if (score >= THRESHOLDS.alphaMissense.pathogenicStrong) return "pathogenic";
    if (score <= THRESHOLDS.alphaMissense.benign) return "benign";
    return "vus";
  };

  const getEveSignal = (score: number | null): "pathogenic" | "benign" | "vus" | "unavailable" => {
    if (score === null) return "unavailable";
    if (score >= THRESHOLDS.eve.pathogenic) return "pathogenic";
    if (score <= THRESHOLDS.eve.benign) return "benign";
    return "vus";
  };

  return (
    <div className="rounded-xl border p-5 shadow-sm transition-colors" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      {knowledgeModalKey && (
        <ModelKnowledgeModal
          isOpen={!!knowledgeModalKey}
          modelKey={knowledgeModalKey}
          onClose={() => setKnowledgeModalKey(null)}
        />
      )}
      
      {/* Section Header */}
      <div className="flex items-center justify-between mb-5 border-b pb-4" style={{ borderColor: "var(--cs-border)" }}>
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg border flex items-center justify-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-accent-clay)" }}>
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base" style={{ color: "var(--cs-text-primary)" }}>In-Silico Predictor Suite</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--cs-text-muted)" }}>Specialized panel views organized by prediction methodology</p>
          </div>
        </div>
      </div>

      {/* Tabs list */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        <button
          onClick={() => setActiveTab("meta")}
          className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-semibold border transition-all duration-200 cursor-pointer"
          style={activeTab === "meta" ? {
            background: "rgba(196,104,73,0.13)",
            color: "var(--cs-accent-clay)",
            borderColor: "rgba(196,104,73,0.25)"
          } : {
            background: "var(--cs-surface-2)",
            color: "var(--cs-text-muted)",
            borderColor: "var(--cs-border)"
          }}
        >
          <Layers className="w-4 h-4" />
          <span>Meta-Predictors</span>
        </button>

        <button
          onClick={() => setActiveTab("lms")}
          className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-semibold border transition-all duration-200 cursor-pointer"
          style={activeTab === "lms" ? {
            background: "rgba(196,104,73,0.13)",
            color: "var(--cs-accent-clay)",
            borderColor: "rgba(196,104,73,0.25)"
          } : {
            background: "var(--cs-surface-2)",
            color: "var(--cs-text-muted)",
            borderColor: "var(--cs-border)"
          }}
        >
          <Brain className="w-4 h-4" />
          <span>Genomic & Protein LMs</span>
        </button>

        <button
          onClick={() => setActiveTab("annotations")}
          className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-semibold border transition-all duration-200 cursor-pointer"
          style={activeTab === "annotations" ? {
            background: "rgba(196,104,73,0.13)",
            color: "var(--cs-accent-clay)",
            borderColor: "rgba(196,104,73,0.25)"
          } : {
            background: "var(--cs-surface-2)",
            color: "var(--cs-text-muted)",
            borderColor: "var(--cs-border)"
          }}
        >
          <Cpu className="w-4 h-4" />
          <span>Annotations</span>
        </button>

        <button
          onClick={() => setActiveTab("evolution")}
          className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-semibold border transition-all duration-200 cursor-pointer"
          style={activeTab === "evolution" ? {
            background: "rgba(196,104,73,0.13)",
            color: "var(--cs-accent-clay)",
            borderColor: "rgba(196,104,73,0.25)"
          } : {
            background: "var(--cs-surface-2)",
            color: "var(--cs-text-muted)",
            borderColor: "var(--cs-border)"
          }}
        >
          <Database className="w-4 h-4" />
          <span>Evolution</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="min-h-[220px]">
        {activeTab === "lms" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* AlphaGenome AVI (Whole-Genome Multimodal Foundation Model) */}
            <div 
              className="p-4 rounded-xl border flex flex-col justify-between relative overflow-hidden group" 
              style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} 
              title={THRESHOLD_NOTES.alphagenome}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    AlphaGenome AVI
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      Multimodal Foundation
                    </span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>
                    9,440 Tracks · 18 Biological Modalities
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setKnowledgeModalKey("alphagenome")}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
                    title="Model details & literature citation"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {aviPhred !== null ? (
                    renderBadge(
                      aviStrength.startsWith("PP3") ? "pathogenic" : aviStrength.startsWith("BP4") ? "benign" : "vus",
                      aviStrength !== "indeterminate" ? aviStrength.replace("_", " ") : "Indeterminate"
                    )
                  ) : (
                    renderBadge("unavailable", isLoading ? "Evaluating..." : "Standby")
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="flex justify-between items-baseline">
                  <div>
                    <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>AVI Phred: </span>
                    <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>
                      {aviPhred !== null ? `${aviPhred.toFixed(1)}` : (isLoading ? "Evaluating..." : "Standby")}
                    </span>
                  </div>
                  {aviPercentile !== null && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20">
                      Top {aviPercentile < 0.1 ? aviPercentile.toFixed(3) : aviPercentile.toFixed(2)}%
                    </span>
                  )}
                </div>

                {aviPhred === null && !isLoading && (
                  <p className="text-[10.5px] text-cs-text-muted mt-1.5 leading-tight">
                    Frontier foundation model in standby. Configure an API key in Settings &rarr; Connections or explore directly in the Atlas tab.
                  </p>
                )}

                {aviPhred !== null && renderScoreBar(aviPhred, 0, 60, 8.0, 15.0, false)}

                {/* Driving Modality Pill */}
                {aviTopModality && (
                  <div className="mt-2.5 flex items-center justify-between text-[11px] px-2 py-1 rounded border bg-indigo-500/5 border-indigo-500/20">
                    <span className="text-[10px] uppercase font-mono tracking-wider font-semibold text-indigo-400">
                      Primary Modality
                    </span>
                    <span className="font-bold font-mono text-[10.5px]" style={{ color: "var(--cs-text-primary)" }}>
                      {aviTopModality}
                      {alphagenome?.topFeatureImportance != null && (
                        <span className="ml-1 text-[9.5px] opacity-75">
                          ({alphagenome.topFeatureImportance > 0 ? "+" : ""}{alphagenome.topFeatureImportance.toFixed(2)})
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {/* Direct Link to AlphaGenome Atlas Tab */}
                {onTabChange && (
                  <button
                    type="button"
                    onClick={() => onTabChange("alphagenome")}
                    className="mt-3 w-full py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition-all duration-150 cursor-pointer bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/30"
                  >
                    <span>Open Full Genomic Track Studio →</span>
                  </button>
                )}

                {renderSourceLabel("Google DeepMind / AlphaGenome Atlas")}
              </div>
            </div>

            {/* VESM-150M */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.vesm}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    VESM-150M
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(196,104,73,0.1)", color: "var(--cs-accent-clay)" }}>Co-distilled LM</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Co-distilled ESM-2/3 Fitness LLR</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setKnowledgeModalKey("vesm")}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
                    title="Model details & literature citation"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {renderBadge(
                    getEsmSignal(vesmScore ?? null),
                    vesmScore !== null && vesmScore !== undefined
                      ? "Informational"
                      : (isStructuralLoading || isLoading ? "Evaluating..." : "Standby")
                  )}
                </div>
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>
                  {vesmScore !== null && vesmScore !== undefined ? (
                    renderScoreValue(vesmScore, 2)
                  ) : (isStructuralLoading || isLoading ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400 font-medium animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
                      <span>Evaluating...</span>
                    </span>
                  ) : "—")}
                </span>
                {vesmScore !== null && vesmScore !== undefined && renderScoreBar(vesmScore, -25, 5, null, null, true)}
                {renderSourceLabel("Local VESM-150M / EvolutionaryScale")}
              </div>
            </div>

            {/* ESM-2 */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.esm2}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    ESM-2
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Foundation LM</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Evolutionary scale sequence LLR</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setKnowledgeModalKey("esm2")}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
                    title="Model details & literature citation"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {renderBadge(
                    getEsmSignal(esm2Score ?? null),
                    esm2Score !== null && esm2Score !== undefined
                      ? "Informational"
                      : (isStructuralLoading || isLoading ? "Evaluating..." : "Standby")
                  )}
                </div>
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>
                  {esm2Score !== null && esm2Score !== undefined ? (
                    renderScoreValue(esm2Score, 2)
                  ) : (isStructuralLoading || isLoading ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400 font-medium animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
                      <span>Evaluating...</span>
                    </span>
                  ) : "—")}
                </span>
                {esm2Score !== null && esm2Score !== undefined && renderScoreBar(esm2Score, -25, 5, null, null, true)}
                {renderSourceLabel("Meta FAIR (ESM-2 650M/3B)")}
              </div>
            </div>

            {/* SaProt 650M AF2 */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title="Structure-aware Protein Language Model conditioned on AlphaFold 3D coordinates via Foldseek 3Di tokens">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    SaProt 650M AF2
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      Structure-Aware LM
                    </span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Foldseek 3Di structural alphabet LLR</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setKnowledgeModalKey("saprot")}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
                    title="Model details & literature citation"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {renderBadge(
                    getEsmSignal(saprotScore ?? null),
                    saprotScore !== null && saprotScore !== undefined
                      ? "Informational"
                      : (isStructuralLoading || isLoading ? "Evaluating..." : "Standby")
                  )}
                </div>
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>
                  {saprotScore !== null && saprotScore !== undefined ? (
                    renderScoreValue(saprotScore, 2)
                  ) : (isStructuralLoading || isLoading ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400 font-medium animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
                      <span>Evaluating...</span>
                    </span>
                  ) : "—")}
                </span>
                {saprotScore !== null && saprotScore !== undefined && renderScoreBar(saprotScore, -20, 5, null, null, true)}
                {renderSourceLabel("Westlake University / Hugging Face")}
              </div>
            </div>

            {/* GPN-Star */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.gpnStar}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    GPN-Star
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Phylogeny LM
                    </span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>100+ vertebrate alignment cross-attention</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setKnowledgeModalKey("gpn_star")}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
                    title="Model details & literature citation"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {gpnScore !== null ? (
                    renderBadge(
                      getGpnSignal(gpnScore),
                      gpnScore <= -2.5 ? "Conserved (Prior)" : "Tolerated"
                    )
                  ) : gpnMessage ? (
                    <span
                      title={gpnMessage}
                      className="text-[10px] px-2 py-0.5 rounded font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 max-w-36 truncate"
                    >
                      {gpnMessage.includes("Endpoint") || gpnMessage.includes("endpoint")
                        ? "Endpoint Needed"
                        : "Notice"}
                    </span>
                  ) : gpnStatus === "token_required" ? (
                    <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      Token Required
                    </span>
                  ) : (
                    renderBadge("unavailable", "Endpoint Standby")
                  )}
                </div>
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>LLR Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>
                  {gpnScore !== null ? renderScoreValue(gpnScore, 2) : "Standby"}
                </span>
                {gpnScore !== null ? (
                  renderScoreBar(gpnScore, -10, 2, -2.5, 0.0, true)
                ) : gpnMessage ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] text-amber-500/90 font-mono leading-tight">
                      {gpnMessage}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenSettings) onOpenSettings();
                        else openSettingsTab("connections");
                      }}
                      className="text-[10px] px-2 py-0.5 rounded font-medium bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer"
                    >
                      Configure GPN Endpoint
                    </button>
                  </div>
                ) : gpnStatus === "token_required" ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-amber-500/90 font-mono">
                      Song Lab GPN-Star requires HF token or dedicated endpoint
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenSettings) onOpenSettings();
                        else openSettingsTab("connections");
                      }}
                      className="text-[10px] px-2 py-0.5 rounded font-medium bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer shrink-0"
                    >
                      Configure Token
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] mt-1.5 text-slate-400 font-mono">
                    Song Lab vertebrate alignment prior (canonical coding transcripts)
                  </p>
                )}
                {renderSourceLabel("Song Lab @ UC Berkeley / Hugging Face")}
              </div>
            </div>

            {/* AlphaMissense */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.alphaMissense}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    AlphaMissense
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(196,104,73,0.1)", color: "var(--cs-accent-clay)" }}>Structural LM</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>DeepMind structural variant pathogenicity</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setKnowledgeModalKey("am")}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
                    title="Model details & literature citation"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {renderBadge(getAmSignal(amScore), amClass || undefined)}
                </div>
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(amScore, 3)}</span>
                {amScore !== null && renderScoreBar(amScore, 0.0, 1.0, 0.564, 0.983)}
                {renderSourceLabel(predictorData?.source ? `${predictorData.source} (AlphaMissense)` : "Ensembl VEP API (AlphaMissense)")}
              </div>
            </div>

            {/* popEVE */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.popEve}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    popEVE
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(20,184,166,0.1)", color: "rgb(20,184,166)" }}>Population Constraint</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>UK Biobank population depletion constraint</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setKnowledgeModalKey("popeve")}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
                    title="Model details & literature citation"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {renderBadge(
                    popeve === null
                      ? "unavailable"
                      : popeve < 0
                      ? (popeve <= THRESHOLDS.popEve.pathogenicSupporting ? "pathogenic" : popeve >= THRESHOLDS.popEve.benignLlr ? "benign" : "vus")
                      : (popeve >= THRESHOLDS.popEve.pathogenicNormalized ? "pathogenic" : popeve <= THRESHOLDS.popEve.benignNormalized ? "benign" : "vus")
                  )}
                </div>
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(popeve, 3)}</span>
                {popeve !== null && (
                  popeve < 0
                    ? renderScoreBar(popeve, -7.2, 0.0, -1.0, -2.0)
                    : renderScoreBar(popeve, 0.0, 1.0, THRESHOLDS.popEve.benignNormalized, THRESHOLDS.popEve.pathogenicNormalized)
                )}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
          </div>
        )}

        {activeTab === "meta" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* REVEL */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.revel}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    REVEL
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(16,185,129,0.1)", color: "rgb(16,185,129)" }}>Consensus Meta</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Rare Exome Variant Ensemble Learner</p>
                </div>
                {renderBadge(
                  revel === null ? "unavailable" : revel >= THRESHOLDS.revel.pathogenicStrong ? "pathogenic" : revel <= THRESHOLDS.revel.benign ? "benign" : "vus"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(revel, 3)}</span>
                {revel !== null && renderScoreBar(revel, 0.0, 1.0, THRESHOLDS.revel.benign, THRESHOLDS.revel.pathogenicStrong)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
 
            {/* BayesDel */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.bayesdel}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    BayesDel
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(16,185,129,0.1)", color: "rgb(16,185,129)" }}>Meta-Predictor</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Bayesian integration of multiple tools (no AF)</p>
                </div>
                {renderBadge(
                  bayesdel === null ? "unavailable" : bayesdel >= THRESHOLDS.bayesdel.pathogenic ? "pathogenic" : bayesdel <= THRESHOLDS.bayesdel.benign ? "benign" : "vus"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(bayesdel, 3)}</span>
                {bayesdel !== null && renderScoreBar(bayesdel, -1.0, 1.0, THRESHOLDS.bayesdel.benign, THRESHOLDS.bayesdel.pathogenic)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
 
            {/* ClinPred */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.clinPred}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    ClinPred
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(16,185,129,0.1)", color: "rgb(16,185,129)" }}>Clinical Meta</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Incorporates clinical query features</p>
                </div>
                {renderBadge(
                  clinpred === null ? "unavailable" : clinpred >= THRESHOLDS.clinPred.pathogenic ? "pathogenic" : "benign"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(clinpred, 3)}</span>
                {clinpred !== null && renderScoreBar(clinpred, 0.0, 1.0, 0.5, 0.5)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
 
            {/* MetaRNN */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.metaRnn}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    MetaRNN
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(16,185,129,0.1)", color: "rgb(16,185,129)" }}>Neural Network</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Recurrent NN integrating conservation & structures</p>
                </div>
                {renderBadge(
                  metarnn === null ? "unavailable" : metarnn >= THRESHOLDS.metaRnn.pathogenic ? "pathogenic" : "benign"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(metarnn, 3)}</span>
                {metarnn !== null && renderScoreBar(metarnn, 0.0, 1.0, 0.5, 0.5)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
          </div>
        )}

        {activeTab === "annotations" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* CADD */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.cadd}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    CADD
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(196,104,73,0.1)", color: "var(--cs-accent-clay)" }}>Genomic Annotator</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Combined Annotation Dependent Depletion</p>
                </div>
                {renderBadge(
                  caddVal === null ? "unavailable" : caddVal >= THRESHOLDS.cadd.pathogenicStrong ? "pathogenic" : caddVal <= THRESHOLDS.cadd.benign ? "benign" : "vus"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score (PHRED): </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(caddVal, 1)}</span>
                {caddVal !== null && renderScoreBar(caddVal, 0.0, 40.0, THRESHOLDS.cadd.benign, THRESHOLDS.cadd.pathogenicStrong)}
                {renderSourceLabel(predictorData?.source || "Ensembl VEP API")}
              </div>
            </div>
 
            {/* DANN */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.dann}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    DANN
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(196,104,73,0.1)", color: "var(--cs-accent-clay)" }}>Deep Learning</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Neural network scoring genome-wide features</p>
                </div>
                {renderBadge(
                  dann === null ? "unavailable" : dann >= THRESHOLDS.dann.pathogenic ? "pathogenic" : "benign"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(dann, 3)}</span>
                {dann !== null && renderScoreBar(dann, 0.0, 1.0, 0.96, 0.96)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
 
            {/* Eigen */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.eigen}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    Eigen
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(196,104,73,0.1)", color: "var(--cs-accent-clay)" }}>Unsupervised Meta</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Eigen-decomposition of annotation correlations</p>
                </div>
                {renderBadge(
                  eigen === null ? "unavailable" : eigen >= THRESHOLDS.eigen.pathogenic ? "pathogenic" : "benign"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score (Phred): </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(eigen, 2)}</span>
                {eigen !== null && renderScoreBar(eigen, 0.0, 15.0, 4.0, 4.0)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
          </div>
        )}
 
        {activeTab === "evolution" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* GERP++ */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.gerp}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    GERP++
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(20,184,166,0.1)", color: "rgb(20,184,166)" }}>Conservation</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Genomic Evolutionary Rate Profiling RS score</p>
                </div>
                {renderBadge(
                  gerp === null ? "unavailable" : gerp >= THRESHOLDS.gerp.high ? "pathogenic" : gerp <= 0 ? "benign" : "vus"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score (RS): </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(gerp, 2)}</span>
                {gerp !== null && renderScoreBar(gerp, -12.0, 6.17, 2.0, 4.0)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
 
            {/* PhyloP */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title={THRESHOLD_NOTES.phylop}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    PhyloP
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(20,184,166,0.1)", color: "rgb(20,184,166)" }}>Conservation</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Phylogenetic base-wise conservation scoring</p>
                </div>
                {renderBadge(
                  phylop === null ? "unavailable" : phylop >= THRESHOLDS.phylop.high ? "pathogenic" : phylop <= 0 ? "benign" : "vus"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(phylop, 2)}</span>
                {phylop !== null && renderScoreBar(phylop, -20.0, 10.0, 1.5, 4.0)}
                {renderSourceLabel(conservationData?.source || "myvariant.info")}
              </div>
            </div>
 
            {/* ConSurf */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    ConSurf
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(20,184,166,0.1)", color: "rgb(20,184,166)" }}>Structural Conservation</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Evolutionary rate overlaid on 3D structure</p>
                </div>
                {renderBadge(
                  consurf === null ? (isLoading ? "unavailable" : "unavailable") : consurf >= 7 ? "pathogenic" : consurf <= 3 ? "benign" : "vus"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Grade (1-9): </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{renderScoreValue(consurf, 0)}</span>
                {consurf !== null ? (
                  renderScoreBar(consurf, 1, 9, 3, 7)
                ) : (
                  <p className="text-[10px] mt-1.5 leading-relaxed text-amber-500/95 font-medium">
                    ⚠ ConSurfDB service is offline or unreachable. Precalculated scores require an experimental RCSB PDB structure (AlphaFold models are not indexed).
                  </p>
                )}
                {renderSourceLabel("ConSurfDB API")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
