import React, { useState, useMemo } from "react";
import { Activity, Layers, Sparkles, RefreshCw, AlertCircle, Terminal, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { PerturbationModelCards, PerturbModelDef } from "./perturbation/PerturbationModelCards";
import { PerturbationMetricsBar } from "./perturbation/PerturbationMetricsBar";
import { ResiduePreferenceList } from "./perturbation/ResiduePreferenceList";
import { EmbeddingShiftChart } from "./perturbation/EmbeddingShiftChart";
import { PhysicalPerturbationSection } from "./perturbation/PhysicalPerturbationSection";
import { Esm3ExploratorySection } from "./perturbation/Esm3ExploratorySection";
import { useApiClient } from "../../apiClient";

export function PerturbationTab({
  analysisState,
  foldingEnergetics,
  structuralDiff,
  metrics,
  onOpenSettings,
  onRetryStructural
}: TabComponentProps) {
  const result = analysisState.result;
  const { settings } = useSettings();
  const { apiClient } = useApiClient();
  const [activePerturbModel, setActivePerturbModel] = useState<"saprot" | "esm2" | "esmc">(
    settings.defaultPerturbationModel
  );
  const [isRetrying, setIsRetrying] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [healthCheckStatus, setHealthCheckStatus] = useState<string | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

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
      name: "ESM-2 650M",
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

  const activeList = models.filter(m => !!m.data && !m.data.error);
  const hasAnyToken = !!settings.hfToken || !!settings.biohubApiToken;
  const allFailedOrEmpty = models.every(m => !m.data || Boolean(m.data.error));

  const handleRetry = async () => {
    if (onRetryStructural) {
      setIsRetrying(true);
      try {
        await onRetryStructural();
      } catch (err) {
        console.error("[PerturbationTab] Retry failed:", err);
      } finally {
        setIsRetrying(false);
      }
      return;
    }
    if (!result?.metadata?.gene || !result?.metadata?.variant || !result?.metadata?.uniprotId) return;
    setIsRetrying(true);
    try {
      await apiClient.getStructuralAssessments({
        gene: result.metadata.gene,
        variant: result.metadata.variant,
        uniprotId: result.metadata.uniprotId,
        acmgWeighting: settings.acmgWeighting,
        saprotEngine: settings.saprotEngine
      });
    } catch (err) {
      console.error("[PerturbationTab] Retry failed:", err);
    } finally {
      setIsRetrying(false);
    }
  };

  const checkSidecarHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const health = await apiClient.getSidecarHealth();
      if (health.reachable) {
        setHealthCheckStatus(`✓ Sidecar Connected (${health.latencyMs}ms) — models: ${health.activeModels ?? 0} loaded`);
        await handleRetry();
      } else {
        setHealthCheckStatus(`✗ Sidecar Offline at ${health.baseUrl || "port 8000"}: ${health.error || "Connection refused"}`);
      }
    } catch (err: any) {
      setHealthCheckStatus(`✗ Sidecar Unreachable: ${err.message}`);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedCommand(label);
        setTimeout(() => setCopiedCommand(null), 2000);
      } catch {
        // Safe clipboard rejection handling
      }
    }
  };

  const errorStatuses = models.map(m => m.data?.status).filter(Boolean);
  const errorMsgs = models.map(m => m.data?.error).filter(Boolean);
  const isOffline = errorStatuses.includes("offline") || errorMsgs.some((msg: string) => /unreachable|ECONNREFUSED|connect|offline|fetch failed/i.test(msg));
  const isTimeout = errorStatuses.includes("timeout") || errorMsgs.some((msg: string) => /timed out|timeout/i.test(msg));
  const isWarming = errorStatuses.includes("warming_up") || errorMsgs.some((msg: string) => /warming|initializing/i.test(msg));

  let bannerTitle = "Protein Language Model Sidecar in Standby";
  let bannerDesc = "The local Python biophysics sidecar microservice (tools/model_server.py) is currently in standby. Core biophysical stability models remain 100% operational.";
  
  if (isTimeout) {
    bannerTitle = "Language Model Loading / Inference Timeout";
    bannerDesc = "Large language models (SaProt 650M, ESM-2 650M) may still be compiling on CPU or downloading weights. Re-run after weights initialize.";
  } else if (isWarming) {
    bannerTitle = "Biophysics Model Sidecar Initializing";
    bannerDesc = "The sidecar engine is currently warming up and loading model weights into memory. Inference will become active momentarily.";
  } else if (!isOffline && !hasAnyToken) {
    bannerTitle = "Optional Language Model Tokens Unconfigured";
    bannerDesc = "Local VESM-150M runs without keys. For remote cloud inference on SaProt or ESM-2 3B, configure a Hugging Face or Biohub token.";
  }

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
              disabled={isCheckingHealth || isRetrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-xs disabled:opacity-50"
              style={{ background: "var(--cs-accent-clay)", color: "#fff", borderColor: "transparent" }}
            >
              <RefreshCw className={`w-3 h-3 ${isCheckingHealth || isRetrying ? "animate-spin" : ""}`} />
              {isCheckingHealth ? "Testing..." : isRetrying ? "Retrying..." : "Check & Retry"}
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
        <div className="flex flex-col items-center justify-center p-6 text-center rounded-xl border border-dashed my-3" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
          <span className="font-mono text-xs font-semibold mb-1" style={{ color: "var(--cs-text-primary)" }}>
            {currentModel.name} Standby
          </span>
          <p className="text-xs text-slate-400 max-w-md font-sans mb-3">
            Inference engine is in standby. Configure an API token in Settings or launch the local sidecar to compute zero-shot evolutionary likelihoods and residue disruptions.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-xs"
              style={{ background: "var(--cs-accent-clay)", color: "#fff", borderColor: "transparent" }}
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
            allEvaluations={[result.esmcEval, result.esm2Eval, result.saprotEval].filter(Boolean)}
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
