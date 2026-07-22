import React, { useState } from "react";
import { Brain, Cpu, Database, HeartHandshake, HelpCircle, Layers, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { THRESHOLDS, THRESHOLD_NOTES } from "../shared/thresholds";

interface PredictorSpecialistPanelsProps {
  predictorData?: {
    amPathogenicity: number | null;
    amClass: string | null;
    caddPhred: number | null;
    eveScore?: number | null;
    eveClass?: string | null;
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
  } | null;
  esm2Score?: number | null;
}

type TabType = "lms" | "meta" | "annotations" | "evolution";

export const PredictorSpecialistPanels: React.FC<PredictorSpecialistPanelsProps> = ({
  predictorData,
  conservationData,
  esm2Score
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("lms");

  const amScore = predictorData?.amPathogenicity ?? null;
  const amClass = predictorData?.amClass ?? null;
  const caddVal = predictorData?.caddPhred ?? null;
  const eveScore = predictorData?.eveScore ?? null;
  const eveClass = predictorData?.eveClass ?? null;

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

  // Helper to render score bars
  const renderScoreBar = (val: number | null, min: number, max: number, threshLow: number, threshHigh: number, invert = false) => {
    if (val === null) return null;
    const percentage = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    const lowPercent = ((threshLow - min) / (max - min)) * 100;
    const highPercent = ((threshHigh - min) / (max - min)) * 100;

    const isPathogenic = invert ? val <= threshLow : val >= threshHigh;
    const isBenign = invert ? val >= threshHigh : val <= threshLow;

    let barColor = "bg-amber-500/80";
    if (isPathogenic) barColor = "bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
    if (isBenign) barColor = "bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.5)]";

    return (
      <div className="w-full mt-2.5">
        <div className="relative w-full h-2 rounded-full overflow-hidden border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          {/* Threshold markers */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-emerald-500/50" style={{ left: `${invert ? highPercent : lowPercent}%` }} title="Benign Cutoff" />
          <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/50" style={{ left: `${invert ? lowPercent : highPercent}%` }} title="Pathogenic Cutoff" />
          {/* Fill Bar */}
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${percentage}%` }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1 px-0.5" style={{ color: "var(--cs-text-muted)" }}>
          <span>Min: {min}</span>
          <span>Max: {max}</span>
        </div>
      </div>
    );
  };

  // Helper to render evaluation badges
  const renderBadge = (type: "pathogenic" | "benign" | "vus" | "unavailable", text?: string) => {
    switch (type) {
      case "pathogenic":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/10 text-rose-455 border border-rose-500/20">
            <ShieldAlert className="w-3.5 h-3.5 mr-1 text-rose-500" />
            {text || "Deleterious"}
          </span>
        );
      case "benign":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-450 border border-emerald-500/20">
            <HeartHandshake className="w-3.5 h-3.5 mr-1 text-emerald-500" />
            {text || "Tolerated"}
          </span>
        );
      case "vus":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-450 border border-amber-500/20">
            <Layers className="w-3.5 h-3.5 mr-1 text-amber-500" />
            {text || "VUS / Indeterminate"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
            <HelpCircle className="w-3.5 h-3.5 mr-1 text-slate-400" />
            Unavailable
          </span>
        );
    }
  };

  const getEsmSignal = (llr: number | null): "pathogenic" | "benign" | "vus" | "unavailable" => {
    if (llr === null) return "unavailable";
    if (llr <= THRESHOLDS.esm1b.pathogenic) return "pathogenic";
    if (llr >= THRESHOLDS.esm1b.benign) return "benign";
    return "vus";
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
          <span>Protein LMs</span>
        </button>

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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* VESM++ / VESM3 */}
            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }} title="VESM++ Co-distilled Ensemble (ESM2-3B + ESM3) zero-shot Log-Likelihood Ratio (LLR)">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-sm flex items-center" style={{ color: "var(--cs-text-primary)" }}>
                    VESM++
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal" style={{ background: "rgba(196,104,73,0.1)", color: "var(--cs-accent-clay)" }}>Co-distilled LM</span>
                  </h4>
                  <p className="text-xs mt-1" style={{ color: "var(--cs-text-muted)" }}>Co-distilled ESM-3/ESM2 LLR score</p>
                </div>
                {renderBadge(getEsmSignal(esm2Score ?? null))}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>
                  {esm2Score !== null && esm2Score !== undefined ? esm2Score.toFixed(2) : "N/A"}
                </span>
                {esm2Score !== null && esm2Score !== undefined && renderScoreBar(esm2Score, -25, 5, -7.5, -5.0, true)}
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
                {renderBadge(getAmSignal(amScore), amClass || undefined)}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{amScore !== null ? amScore.toFixed(3) : "N/A"}</span>
                {amScore !== null && renderScoreBar(amScore, 0.0, 1.0, 0.564, 0.983)}
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
                {renderBadge(
                  popeve === null
                    ? "unavailable"
                    : popeve < 0
                    ? (popeve <= THRESHOLDS.popEve.pathogenicSupporting ? "pathogenic" : popeve >= THRESHOLDS.popEve.benignLlr ? "benign" : "vus")
                    : (popeve >= THRESHOLDS.popEve.pathogenicNormalized ? "pathogenic" : popeve <= THRESHOLDS.popEve.benignNormalized ? "benign" : "vus")
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Score: </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{popeve !== null ? popeve.toFixed(3) : "N/A"}</span>
                {popeve !== null && (
                  popeve < 0
                    ? renderScoreBar(popeve, -7.2, 0.0, -1.0, -2.0)
                    : renderScoreBar(popeve, 0.0, 1.0, THRESHOLDS.popEve.benignNormalized, THRESHOLDS.popEve.pathogenicNormalized)
                )}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{revel !== null ? revel.toFixed(3) : "N/A"}</span>
                {revel !== null && renderScoreBar(revel, 0.0, 1.0, THRESHOLDS.revel.benign, THRESHOLDS.revel.pathogenicStrong)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{bayesdel !== null ? bayesdel.toFixed(3) : "N/A"}</span>
                {bayesdel !== null && renderScoreBar(bayesdel, -1.0, 1.0, THRESHOLDS.bayesdel.benign, THRESHOLDS.bayesdel.pathogenic)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{clinpred !== null ? clinpred.toFixed(3) : "N/A"}</span>
                {clinpred !== null && renderScoreBar(clinpred, 0.0, 1.0, 0.5, 0.5)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{metarnn !== null ? metarnn.toFixed(3) : "N/A"}</span>
                {metarnn !== null && renderScoreBar(metarnn, 0.0, 1.0, 0.5, 0.5)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{caddVal !== null ? caddVal.toFixed(1) : "N/A"}</span>
                {caddVal !== null && renderScoreBar(caddVal, 0.0, 40.0, THRESHOLDS.cadd.benign, THRESHOLDS.cadd.pathogenicStrong)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{dann !== null ? dann.toFixed(3) : "N/A"}</span>
                {dann !== null && renderScoreBar(dann, 0.0, 1.0, 0.96, 0.96)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{eigen !== null ? eigen.toFixed(2) : "N/A"}</span>
                {eigen !== null && renderScoreBar(eigen, 0.0, 15.0, 4.0, 4.0)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{gerp !== null ? gerp.toFixed(2) : "N/A"}</span>
                {gerp !== null && renderScoreBar(gerp, -12.0, 6.17, 2.0, 4.0)}
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
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{phylop !== null ? phylop.toFixed(2) : "N/A"}</span>
                {phylop !== null && renderScoreBar(phylop, -20.0, 10.0, 1.5, 4.0)}
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
                  consurf === null ? "unavailable" : consurf >= 7 ? "pathogenic" : consurf <= 3 ? "benign" : "vus"
                )}
              </div>
              <div className="mt-4">
                <span className="text-xs font-medium" style={{ color: "var(--cs-text-secondary)" }}>Grade (1-9): </span>
                <span className="font-bold text-sm" style={{ color: "var(--cs-text-primary)" }}>{consurf !== null ? consurf : "N/A"}</span>
                {consurf !== null ? (
                  renderScoreBar(consurf, 1, 9, 3, 7)
                ) : (
                  <p className="text-[10px] mt-1.5 leading-relaxed text-amber-500/95 font-medium">
                    ⚠ ConSurfDB scores require an experimental RCSB PDB structure. Predicted AlphaFold models are not indexed.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
