import React, { useState } from "react";
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

  const activeList = models.filter(m => !!m.data && !m.data.error);
  const hasAnyToken = !!settings.hfToken || !!settings.biohubApiToken;
  const allFailedOrEmpty = models.every(m => !m.data || Boolean(m.data.error));

  const handleRetry = async () => {
    if (onRetryStructural) {
      onRetryStructural();
      return;
    }
    if (!result?.metadata?.gene || !result?.metadata?.variant || !result?.metadata?.uniprotId) return;
    setIsRetrying(true);
    try {
      const structRes = await apiClient.getStructuralAssessments({
        gene: result.metadata.gene,
        variant: result.metadata.variant,
        uniprotId: result.metadata.uniprotId,
        acmgWeighting: settings.acmgWeighting
      });
      if (structRes) {
        result.esm3Eval = structRes.esm3Eval;
        result.esmcEval = structRes.esmcEval;
        result.esm2Eval = structRes.esm2Eval;
        result.saprotEval = structRes.saprotEval;
      }
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

  const copyToClipboard = (text: string, label: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedCommand(label);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const errorStatuses = models.map(m => m.data?.status).filter(Boolean);
  const errorMsgs = models.map(m => m.data?.error).filter(Boolean);
  const isOffline = errorStatuses.includes("offline") || errorMsgs.some((msg: string) => /unreachable|ECONNREFUSED|connect|offline|fetch failed/i.test(msg));
  const isTimeout = errorStatuses.includes("timeout") || errorMsgs.some((msg: string) => /timed out|timeout/i.test(msg));

  let bannerTitle = "Deep Language Models (SaProt, ESM-2, VESM) Offline";
  let bannerDesc = "The Python biophysics sidecar microservice (tools/model_server.py) is currently disconnected. Primary biophysical stability models remain 100% operational.";
  
  if (isTimeout) {
    bannerTitle = "Language Model Loading / Inference Timeout";
    bannerDesc = "Large language models (SaProt 650M, ESM-2 3B) may still be downloading weights or compiling on CPU. Re-run after weights initialize.";
  } else if (!isOffline && !hasAnyToken) {
    bannerTitle = "Optional Language Model Tokens Unconfigured";
    bannerDesc = "Local VESM-150M runs without keys. For remote cloud inference on SaProt or ESM-2 3B, configure a Hugging Face or Biohub token.";
  }

  const currentModel = models.find(m => m.id === activePerturbModel) || activeList[0] || models[0];
  const activeEval = currentModel?.data;

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
      {allFailedOrEmpty && (
        <div className="p-4 rounded-xl border flex flex-col gap-3 my-2 text-left" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: isOffline ? "rgba(239, 68, 68, 0.1)" : "rgba(234, 179, 8, 0.1)", color: isOffline ? "var(--cs-text-danger)" : "var(--cs-accent-clay)" }}>
                {isOffline ? <AlertCircle className="w-4 h-4" /> : <Activity className="w-4 h-4 animate-pulse" />}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold" style={{ color: "var(--cs-text-primary)" }}>
                    {bannerTitle}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    Primary Biophysics Active
                  </span>
                </div>
                <p className="text-[11px] font-sans leading-relaxed text-slate-400 mt-1">
                  {bannerDesc}
                </p>
                <p className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
                  ✓ Core FoldX energetics, Consensus ΔΔG stability, and 3D PDB structure are fully operational in their tabs.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={checkSidecarHealth}
                disabled={isCheckingHealth || isRetrying}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
                style={{ background: "var(--cs-accent-clay)", color: "#fff", borderColor: "transparent" }}
              >
                <RefreshCw className={`w-3 h-3 ${isCheckingHealth || isRetrying ? "animate-spin" : ""}`} />
                {isCheckingHealth ? "Testing..." : isRetrying ? "Retrying..." : "Check & Retry"}
              </button>
              <button
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface)] cursor-pointer transition-colors shadow-sm"
                style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
              >
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                <span>Connection Clues</span>
                {showGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {healthCheckStatus && (
            <div className="text-[11px] font-mono px-3 py-1.5 rounded-md bg-slate-900 text-slate-200 border border-slate-800">
              {healthCheckStatus}
            </div>
          )}

          {showGuide && (
            <div className="mt-2 pt-3 border-t grid grid-cols-1 md:grid-cols-2 gap-3" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <div className="p-3 rounded-lg border bg-slate-950/60 border-slate-800 text-left">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-300">Local Development Startup</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard("python -m uv run --project tools python tools/model_server.py", "local")}
                    className="flex items-center gap-1 text-[10px] text-amber-500 hover:text-amber-400 cursor-pointer font-mono"
                  >
                    {copiedCommand === "local" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedCommand === "local" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <code className="text-[10px] font-mono text-slate-300 block select-all bg-slate-900 px-2 py-1 rounded">
                  python -m uv run --project tools python tools/model_server.py
                </code>
                <p className="text-[9px] text-slate-400 mt-1">Starts the Python model server on port 8000 with pre-loaded VESM-150M weights.</p>
              </div>

              <div className="p-3 rounded-lg border bg-slate-950/60 border-slate-800 text-left">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-300">OCI Cloud Deployment Setup</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard("export SIDECAR_URL=http://<oci-private-or-public-ip>:8000", "oci")}
                    className="flex items-center gap-1 text-[10px] text-amber-500 hover:text-amber-400 cursor-pointer font-mono"
                  >
                    {copiedCommand === "oci" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedCommand === "oci" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <code className="text-[10px] font-mono text-slate-300 block select-all bg-slate-900 px-2 py-1 rounded">
                  export SIDECAR_URL=http://&lt;oci-ip&gt;:8000
                </code>
                <p className="text-[9px] text-slate-400 mt-1">Point your Node.js application to your deployed OCI ARM64 Python sidecar.</p>
              </div>
            </div>
          )}
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
        <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed my-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
          <span className="font-mono text-xs font-semibold mb-1 text-rose-500">
            {currentModel.name} Disconnected / Error
          </span>
          <p className="text-[11px] max-w-md font-mono text-slate-400 mb-3 break-all">
            {activeEval.error || "An error occurred while loading this model."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={checkSidecarHealth}
              disabled={isCheckingHealth || isRetrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:opacity-90 cursor-pointer transition-colors shadow-sm"
              style={{ background: "var(--cs-accent-clay)", color: "#fff", borderColor: "transparent" }}
            >
              <RefreshCw className={`w-3 h-3 ${isCheckingHealth || isRetrying ? "animate-spin" : ""}`} />
              {isCheckingHealth ? "Testing..." : isRetrying ? "Retrying..." : "Check & Retry"}
            </button>
            <button
              type="button"
              onClick={() => onOpenSettings?.()}
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface)] cursor-pointer transition-colors shadow-sm"
              style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
            >
              {hasAnyToken ? "Review Settings / Tokens" : "Configure API Keys"}
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
