import React, { useState, useMemo, useEffect } from "react";
import { Activity, Layers, Sparkles, RefreshCw, Zap } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { PerturbationModelCards, PerturbModelDef } from "./perturbation/PerturbationModelCards";
import { PerturbationMetricsBar } from "./perturbation/PerturbationMetricsBar";
import { ResiduePreferenceList } from "./perturbation/ResiduePreferenceList";
import { EmbeddingShiftChart } from "./perturbation/EmbeddingShiftChart";
import { PhysicalPerturbationSection } from "./perturbation/PhysicalPerturbationSection";
import { Esm3ExploratorySection } from "./perturbation/Esm3ExploratorySection";
import { useApiClient } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { resolveModelCalibration } from "../../shared/modelCalibration";
import {
  resolveModelDisplayName,
  type PerturbationModelId
} from "../../shared/perturbationModels";

interface SaProtLoadingProgressBannerProps {
  modelName: string;
  saprotEngine?: string;
  hasHfToken: boolean;
  onSwitchTo35M: () => void;
  onSwitchToRemoteHf: () => void;
  onOpenSettings?: () => void;
}

const SAPROT_STAGES = [
  { id: 1, label: "Environment & Setup", minSec: 0, desc: "Checking sidecar readiness and authentication tokens." },
  { id: 2, label: "Loading SaProt Weights", minSec: 4, desc: "Loading model weights into RAM (SaProt 650M ~2.6GB) or warming serverless cloud worker." },
  { id: 3, label: "3Di Backbone Tokenization", minSec: 18, desc: "Converting 3D coordinates into discrete 3Di structural geometric tokens." },
  { id: 4, label: "Perturbation Scoring", minSec: 28, desc: "Calculating zero-shot mutation log-odds, embedding shift, and local conformation." }
];

const SaProtLoadingProgressBanner = React.memo(function SaProtLoadingProgressBanner({
  modelName,
  saprotEngine,
  hasHfToken,
  onSwitchTo35M,
  onSwitchToRemoteHf,
  onOpenSettings
}: SaProtLoadingProgressBannerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentStageIndex = useMemo(() => {
    if (elapsed < 4) return 0;
    if (elapsed < 18) return 1;
    if (elapsed < 28) return 2;
    return 3;
  }, [elapsed]);

  const currentStage = SAPROT_STAGES[currentStageIndex];
  const progressPercent = Math.min(95, Math.max(10, Math.round((elapsed / 35) * 100)));

  return (
    <div
      className="p-5 rounded-xl border my-3 space-y-4 text-left transition-all"
      style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 animate-spin text-purple-500" style={{ background: "rgba(147, 51, 234, 0.1)" }}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                {modelName}: {currentStage.label}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-medium border bg-purple-500/10 text-purple-400 border-purple-500/20">
                {elapsed}s elapsed
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans mt-0.5">
              {currentStage.desc}
            </p>
          </div>
        </div>

        {/* Action button to switch to fast model */}
        {saprotEngine !== "saprot-35m" && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSwitchTo35M}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-xs"
              style={{ background: "var(--cs-accent-clay)", color: "#fff", borderColor: "transparent" }}
              title="Switch to SaProt 35M AF2 which evaluates in ~1.5s on CPU"
            >
              <Zap className="w-3.5 h-3.5" />
              Switch to Fast 35M (~1.5s)
            </button>
            {hasHfToken && saprotEngine !== "remote-hf" && (
              <button
                type="button"
                onClick={onSwitchToRemoteHf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface)] cursor-pointer transition-colors shadow-xs"
                style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
              >
                Use Cloud HF
              </button>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="w-full h-1.5 rounded-full overflow-hidden bg-slate-700/30">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-purple-500 via-indigo-500 to-[var(--cs-accent-clay)]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
          {SAPROT_STAGES.map((st, idx) => (
            <span
              key={st.id}
              className={`transition-colors ${idx === currentStageIndex ? "text-purple-400 font-semibold" : idx < currentStageIndex ? "text-slate-300" : "text-slate-500"}`}
            >
              {idx + 1}. {st.label.split(" ")[0]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});

export function PerturbationTab({
  analysisState,
  foldingEnergetics,
  structuralDiff,
  metrics,
  onOpenSettings,
  onRetryStructural
}: TabComponentProps) {
  const result = analysisState.result;
  const { settings, updateSetting } = useSettings();
  const { apiClient } = useApiClient();
  const activePerturbModel = useVariantAnalysisStore(state => state.activePerturbationModel);
  const setActivePerturbModel = useVariantAnalysisStore(state => state.setActivePerturbationModel);
  const [isRetrying, setIsRetrying] = useState(false);

  /**
   * Seed the selected model from the user's configured default whenever a new variant is
   * analysed. The setting is labelled "Pre-selects these models when a new analysis
   * session starts", and lifting the selection into the store had left it unread.
   */
  useEffect(() => {
    setActivePerturbModel(settings.defaultPerturbationModel);
  }, [settings.defaultPerturbationModel, setActivePerturbModel, result?.metadata?.gene, result?.metadata?.variant]);

  /**
   * Evaluated before the null guard below. `result` can become null on an instance that
   * has already rendered with data, and returning early ahead of a hook would change the
   * hook count between renders.
   */
  const saprotDisplayName = useMemo(
    () =>
      resolveModelDisplayName("saprot", {
        saprotEngine: settings.saprotEngine,
        provenance: result?.saprotEval?.provenance
      }),
    [result?.saprotEval?.provenance, settings.saprotEngine]
  );

  if (!result) return null;
  const wtRes = result.metadata?.wildType || "R";
  const mutRes = result.metadata?.mutant || "H";
  const pos = result.metadata?.residueIndex || 408;

  const handleSwitchTo35M = async () => {
    updateSetting("saprotEngine", "saprot-35m");
    if (onRetryStructural) {
      setIsRetrying(true);
      try {
        await onRetryStructural({ saprotEngine: "saprot-35m" });
      } finally {
        setIsRetrying(false);
      }
    }
  };

  const handleSwitchToRemoteHf = async () => {
    updateSetting("saprotEngine", "remote-hf");
    if (onRetryStructural) {
      setIsRetrying(true);
      try {
        await onRetryStructural({ saprotEngine: "remote-hf" });
      } finally {
        setIsRetrying(false);
      }
    }
  };

  const models: PerturbModelDef[] = [
    {
      id: "saprot",
      name: saprotDisplayName,
      description: "Structure-Aware Residue & Conformation Predictor",
      data: result.saprotEval,
      icon: Layers,
      tokenName: "Hugging Face Access Token",
      tokenSettingKey: "hfToken",
      hasKey: !!settings.hfToken,
      conformation: result.saprotEval?.conformationState || null,
      calibration: resolveModelCalibration("saprot", { saprotEngine: settings.saprotEngine })
    },
    {
      id: "esm2",
      name: "ESM-2 650M",
      description: "Genomic Sequence Evolutionary Scale Transformer",
      data: result.esm2Eval,
      icon: Activity,
      tokenName: "Hugging Face Access Token",
      tokenSettingKey: "hfToken",
      hasKey: !!settings.hfToken,
      calibration: resolveModelCalibration("esm2")
    },
    {
      id: "esmc",
      name: "ESMC 6B / VESM-150M",
      description: "Evolutionary Scale Foundation Model",
      data: result.esmcEval,
      icon: Sparkles,
      tokenName: "Biohub API Token",
      tokenSettingKey: "biohubApiToken",
      hasKey: !!settings.biohubApiToken,
      calibration: resolveModelCalibration("esmc")
    }
  ];

  const activeList = models.filter(m => !!m.data && !m.data.error);

  /**
   * The pooled tuple and its families are derived together, in one pass, so the family at
   * index i always describes the evaluation at index i. `computeMultiModelLlr` only uses
   * the families when the counts match, so a mismatch degrades to the spread heuristic
   * rather than mis-attributing a family to the wrong model.
   */
  const pooledTuple = useMemo<{ evaluations: any[]; families: string[] }>(() => {
    const entries: { data: any; family: string }[] = [];
    const candidates: [any, string][] = [
      [result?.esm2Eval, "esm2"],
      [result?.esmcEval, "esmc"],
      [result?.saprotEval, "saprot"]
    ];
    for (const [data, family] of candidates) {
      if (data) entries.push({ data, family });
    }
    return {
      evaluations: entries.map(e => e.data),
      families: entries.map(e => e.family)
    };
  }, [result?.esm2Eval, result?.esmcEval, result?.saprotEval]);
  const hasAnyToken = !!settings.hfToken || !!settings.biohubApiToken;
  const allFailedOrEmpty = models.every(m => !m.data || Boolean(m.data.error));

  const handleRetry = async () => {
    if (!onRetryStructural) return;
    setIsRetrying(true);
    try {
      await onRetryStructural();
    } catch (err) {
      console.error("[PerturbationTab] Retry failed:", err);
    } finally {
      setIsRetrying(false);
    }
  };

  const errorStatuses = models.map(m => m.data?.status).filter(Boolean);
  const errorMsgs = models.map(m => m.data?.error).filter(Boolean);
  const isWarming = errorStatuses.includes("warming_up") || errorMsgs.some((msg: string) => /warming|initializing/i.test(msg));

  const currentModel = models.find(m => m.id === activePerturbModel) || activeList[0] || models[0];
  const activeEval = currentModel?.data;

  const { allShifts, maxShift, shiftScale, points, pathD, meanShift } = useMemo(() => {
    const shifts = (!activeEval?.loading && !activeEval?.error && activeEval?.localShiftMap || []).map((d: any) => d.shift);
    const max = shifts.length > 0 ? Math.max(...shifts) : 1.0;
    const scale = max > 0 ? (110 / (max * 1.15)) : 110;
    const pts = (!activeEval?.loading && !activeEval?.error && activeEval?.localShiftMap || []).map((d: any, index: number) => {
      const x = 40 + index * 24;
      const rawY = 140 - d.shift * scale;
      const y = Math.max(12, Math.min(138, rawY));
      return { x, y, position: d.position, residue: d.residue, shift: d.shift };
    });
    const dStr = pts.map((p: any, i: number) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const mean = shifts.length > 0 ? (shifts.reduce((a: number, b: number) => a + b, 0) / shifts.length) : 0;
    return { allShifts: shifts, maxShift: max, shiftScale: scale, points: pts, pathD: dStr, meanShift: mean };
  }, [activeEval]);

  const isEsmc = activePerturbModel === "esmc";
  const shiftMetric = isEsmc ? "Cosine Distance" : "Euclidean Distance";

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

      {/* SECTION A HEADER / ENGINE STATUS */}
      {allFailedOrEmpty && (
        <div className="px-4 py-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(196, 104, 73, 0.1)", color: "var(--cs-accent-clay)" }}>
              <Activity className={`w-4 h-4 ${isWarming ? "animate-spin" : ""}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                  {isWarming ? "Biophysics Engine Warming Up" : "Protein Language Models in Standby"}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-medium border bg-slate-500/10 text-slate-400 border-slate-500/20">
                  {isWarming ? "Loading Weights" : "Standby"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                {isWarming 
                  ? "Pre-loading model tensors into memory. Forward inference will activate once initialized." 
                  : "Models run via local sidecar or remote API tokens. Core biophysical stability models remain operational."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-xs disabled:opacity-50"
              style={{ background: "var(--cs-accent-clay)", color: "#fff", borderColor: "transparent" }}
            >
              <RefreshCw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
              {isRetrying ? "Retrying..." : "Check & Retry"}
            </button>
            <button
              type="button"
              onClick={() => onOpenSettings?.()}
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface)] cursor-pointer transition-colors shadow-xs"
              style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
            >
              Configure Tokens
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
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
        activePerturbModel === "saprot" ? (
          <SaProtLoadingProgressBanner
            modelName={currentModel.name}
            saprotEngine={settings.saprotEngine}
            hasHfToken={Boolean(settings.hfToken)}
            onSwitchTo35M={handleSwitchTo35M}
            onSwitchToRemoteHf={handleSwitchToRemoteHf}
            onOpenSettings={onOpenSettings}
          />
        ) : (
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
        )
      ) : activeEval?.error ? (
        <div className="flex flex-col items-center justify-center p-6 text-center rounded-xl border border-dashed my-3" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
          <span className="font-mono text-xs font-semibold mb-1" style={{ color: "var(--cs-text-primary)" }}>
            {currentModel.name} Standby
          </span>
          <p className="text-xs text-slate-400 max-w-md font-sans mb-3">
            {activeEval.error?.includes("timeout")
              ? `${currentModel.name} timed out on CPU. Switch to the fast 35M model (~1.5s) or run via Hugging Face Cloud Inference.`
              : activeEval.error || "Inference engine is in standby. Configure an API token in Settings or launch the local sidecar to compute zero-shot evolutionary likelihoods and residue disruptions."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {activePerturbModel === "saprot" && settings.saprotEngine !== "saprot-35m" && (
              <button
                type="button"
                onClick={handleSwitchTo35M}
                disabled={isRetrying}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-xs"
                style={{ background: "var(--cs-accent-clay)", color: "#fff", borderColor: "transparent" }}
              >
                <Zap className="w-3.5 h-3.5" />
                Switch to Fast 35M (~1.5s)
              </button>
            )}
            {activePerturbModel === "saprot" && Boolean(settings.hfToken) && settings.saprotEngine !== "remote-hf" && (
              <button
                type="button"
                onClick={handleSwitchToRemoteHf}
                disabled={isRetrying}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface)] cursor-pointer transition-colors shadow-xs"
                style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
              >
                Run via Remote HF
              </button>
            )}
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-xs"
              style={{ background: activePerturbModel === "saprot" && settings.saprotEngine !== "saprot-35m" ? "var(--cs-surface)" : "var(--cs-accent-clay)", color: activePerturbModel === "saprot" && settings.saprotEngine !== "saprot-35m" ? "var(--cs-text-primary)" : "#fff", borderColor: activePerturbModel === "saprot" && settings.saprotEngine !== "saprot-35m" ? "var(--cs-border)" : "transparent" }}
            >
              <RefreshCw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
              {isRetrying ? "Retrying..." : "Retry Analysis"}
            </button>
            <button
              type="button"
              onClick={() => onOpenSettings?.()}
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface)] cursor-pointer transition-colors shadow-xs"
              style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
            >
              {hasAnyToken ? "Settings & Tokens" : "Configure Tokens"}
            </button>
          </div>
        </div>
      ) : activeEval ? (
        <>
          {/* Grid 2: Core Metrics of Selected Model */}
          <PerturbationMetricsBar
            activeEval={activeEval}
            wtRes={wtRes}
            mutRes={mutRes}
            calibration={currentModel.calibration ?? null}
          />

          {/* Grid 3: Preference list & embedding shift chart — two views of the same
              residue position, so they share a palette and stretch to one height. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
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
            allEvaluations={pooledTuple.evaluations}
            poolFamilies={pooledTuple.families}
            foldingEnergetics={foldingEnergetics}
            structuralDiff={structuralDiff}
            metrics={metrics}
            pos={pos}
            calibration={currentModel.calibration ?? null}
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
