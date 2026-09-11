import React from "react";
import {
  Database,
  Dna,
  ShieldAlert,
  Scale,
  ExternalLink,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Settings,
  Info
} from "lucide-react";
import { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { useDiagnostics } from "../../hooks/useDiagnostics";

interface EvidenceInspectorProps {
  analysisResult: AnalysisResult | null;
  activeEvidenceTab?: string;
  onSelectEvidenceTab?: (tab: string) => void;
  foldingDdG?: number | null;
}

export const EvidenceInspector: React.FC<EvidenceInspectorProps> = ({
  analysisResult,
  activeEvidenceTab = "clinical",
  onSelectEvidenceTab,
  foldingDdG = null
}) => {
  const { settings, setIsSettingsOpen, setSettingsTab, serverGeminiReady } = useSettings();
  const { diagnostics } = useDiagnostics();

  if (!analysisResult) {
    return (
      <div className="text-xs text-cs-text-muted italic p-2">
        Awaiting variant analysis data...
      </div>
    );
  }

  const transcriptId = analysisResult.transcriptId ?? analysisResult.predictorData?.transcriptId ?? null;
  const isManeSelect = analysisResult.isManeSelect ?? analysisResult.predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult.isManePlusClinical ?? analysisResult.predictorData?.isManePlusClinical ?? false;
  const isCanonical = analysisResult.isCanonical ?? analysisResult.predictorData?.isCanonical ?? false;
  const maneRefSeqId = analysisResult.maneRefSeqId ?? analysisResult.predictorData?.maneRefSeqId ?? null;
  const transcriptWarning = analysisResult.transcriptWarning ?? analysisResult.predictorData?.transcriptWarning ?? null;
  const clinvar = analysisResult.clinvar;
  const conservationData = analysisResult.conservationData;

  const isThresholdsActive = activeEvidenceTab === "thresholds" || activeEvidenceTab === "guidelines";

  const clinvarUid = clinvar?.uid;
  const clinvarVcv = clinvarUid ? (clinvarUid.startsWith("VCV") ? clinvarUid : `VCV${clinvarUid.padStart(9, "0")}`) : null;

  // Compute dynamic concordance state for threshold view
  const revel = conservationData?.revel ?? null;
  const ddG = foldingDdG;
  let statusStyle = { color: "var(--cs-text-primary)", backgroundColor: "var(--cs-surface-2)", borderColor: "var(--cs-border)" };
  let statusBadgeStyle = "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
  let statusText = "Concordance Uncertain";
  let statusDesc = "The scores and stability changes fall into intermediate ranges or present conflicting evidence, requiring further functional validation.";
  
  if (revel !== null && revel >= 0.75 && ddG !== null && ddG > 1.5) {
    statusText = "Destabilization + Conservation Concordant (High Risk)";
    statusBadgeStyle = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
    statusDesc = "Both sequence conservation (REVEL >= 0.75) and structural energetics (FoldX ddG > 1.5 kcal/mol) suggest severe risk of misfolding loss-of-function.";
  } else if ((revel !== null && revel >= 0.5) || (ddG !== null && ddG > 1.5)) {
    statusText = "Moderate-Risk Concordance (Pathogenic Support)";
    statusBadgeStyle = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    statusDesc = "At least one biophysical indicator (REVEL >= 0.5 or FoldX ddG > 0.5 kcal/mol) shows significant aberration, supporting potential functional disruption.";
  } else if (revel !== null && revel < 0.15 && ddG !== null && ddG < 0.5 && ddG > -0.5) {
    statusText = "Low-Risk Concordance (Likely Benign)";
    statusBadgeStyle = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    statusDesc = "Consensus indicators fall within benign boundaries. The variant is structurally neutral and evolutionary conservation shows no strict constraint.";
  }

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Dynamic Threshold Concordance Card (Rendered when Threshold tab selected) ── */}
      {isThresholdsActive && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-cs-accent-clay" />
            Concordance & Calibration Guide
          </span>

          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[9.5px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${statusBadgeStyle}`}>
                {statusText}
              </span>
            </div>
            <p className="text-[10.5px] text-cs-text-secondary leading-snug font-sans">
              {statusDesc}
            </p>
            <div className="pt-2 border-t border-cs-border-subtle flex flex-col gap-1 text-[10px] font-mono text-cs-text-muted">
              <div className="flex justify-between">
                <span>REVEL Conservation:</span>
                <span className="font-semibold text-cs-text-primary">{revel !== null ? revel.toFixed(3) : "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span>FoldX ΔΔG Stability:</span>
                <span className="font-semibold text-cs-text-primary">{ddG !== null ? `${ddG.toFixed(2)} kcal/mol` : "N/A"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. Genomic & Transcript Lineage ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Dna className="w-3.5 h-3.5 text-cs-accent-clay" />
          Genomic & Transcript Lineage
        </span>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-cs-text-secondary">Genome Assembly:</span>
            <span className="font-mono font-bold text-cs-text-primary">GRCh38 / hg38</span>
          </div>

          <div className="flex justify-between items-center text-[11px]">
            <span className="text-cs-text-secondary">Transcript ID:</span>
            <span className="font-mono font-bold text-cs-text-primary">{transcriptId || "Not resolved"}</span>
          </div>

          {maneRefSeqId && (
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-cs-text-secondary">RefSeq Accession:</span>
              <span className="font-mono text-cs-text-secondary">{maneRefSeqId}</span>
            </div>
          )}

          <div className="flex justify-between items-center text-[11px] pt-1 border-t border-cs-border-subtle">
            <span className="text-cs-text-secondary">Transcript Tier:</span>
            <span className={`text-[9.5px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
              isManeSelect
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                : isManePlusClinical
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                : isCanonical
                ? "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20"
                : transcriptId
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20"
            }`}>
              {isManeSelect ? "MANE Select (Gold)" : isManePlusClinical ? "MANE Plus Clinical" : isCanonical ? "Ensembl Canonical" : transcriptId ? "Non-canonical" : "Unassigned"}
            </span>
          </div>

          {!transcriptId && (
            <div className="text-[10px] text-cs-text-muted pt-1 leading-snug">
              ℹ️ Canonical transcript mapping unresolved from Ensembl REST.
            </div>
          )}

          {transcriptWarning && (
            <div className="text-[10px] text-amber-600 dark:text-amber-400 pt-1 leading-snug">
              ⚠️ {transcriptWarning}
            </div>
          )}
        </div>
      </div>

      {/* ── 3. Database Lineage & Provenance ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-cs-accent-clay" />
          Data Sources & Provenance
        </span>

        <div className="space-y-2">
          {/* ClinVar Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <span className="font-bold text-[11px] text-cs-text-primary flex items-center gap-1">
                NCBI ClinVar
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border text-cs-text-muted">
                E-Fetch API
              </span>
            </div>
            <div className="flex justify-between items-center text-[10.5px] mt-0.5">
              <span className="text-cs-text-secondary">VCV Accession:</span>
              {clinvarVcv ? (
                <a
                  href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${clinvarUid || ""}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-cs-accent-clay hover:underline flex items-center gap-1"
                >
                  {clinvarVcv}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ) : (
                <span className="font-mono text-[10px] text-cs-text-muted italic">
                  Unindexed in ClinVar
                </span>
              )}
            </div>
            {clinvar?.lastEvaluated && (
              <div className="flex justify-between items-center text-[10px] text-cs-text-muted">
                <span>Evaluation Date:</span>
                <span className="font-mono">{new Date(clinvar.lastEvaluated).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/* Predictor Registry */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">AlphaMissense</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v2023 · Google DeepMind</span>
            </div>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">REVEL</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v2016 · Ioannidis et al.</span>
            </div>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">SpliceAI</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v1.3.1 · Illumina</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">CADD</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v1.6 · Rentzsch et al.</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 4. ACMG Evidence Strength Breakdown ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5 text-cs-accent-clay" />
          ACMG/AMP Evidence Codes
        </span>

        {(() => {
          const criteria = analysisResult.ruleBasedInsights?.acmgCriteria || [];
          const pathCount = criteria.filter((c: any) => c.category === "pathogenic" || c.type === "pathogenic").length;
          const benCount = criteria.filter((c: any) => c.category === "benign" || c.type === "benign").length;

          return (
            <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
              <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
                <span className="text-cs-text-secondary">Pathogenic Rules Evaluated:</span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                  {pathCount > 0 ? `${pathCount} active` : "0 triggered"}
                </span>
              </div>
              <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
                <span className="text-cs-text-secondary">Benign Rules Evaluated:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {benCount > 0 ? `${benCount} active` : "0 triggered"}
                </span>
              </div>
              <div className="flex justify-between items-center text-[10px] text-cs-text-muted pt-0.5">
                <span>Framework Baseline:</span>
                <span className="font-mono">Richards et al. 2015 / ClinGen</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── 5. Live Service & Connection Telemetry ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cs-accent-clay" />
            Live Service & Connection Telemetry
          </span>
          <button
            type="button"
            onClick={() => {
              setSettingsTab("connections");
              setIsSettingsOpen(true);
            }}
            className="text-[9.5px] font-mono text-cs-accent-clay hover:underline flex items-center gap-1"
          >
            <Settings className="w-2.5 h-2.5" />
            Configure
          </button>
        </div>

        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2 text-[10.5px]">
          {/* Ensembl VEP / Fallback */}
          <div className="flex justify-between items-center pb-1.5 border-b border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${analysisResult.predictorData?.available ? "bg-emerald-500" : "bg-blue-400"}`} />
              <span className="font-semibold text-cs-text-primary">Ensembl VEP</span>
            </div>
            <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
              analysisResult.predictorData?.source?.includes("Fallback")
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                : analysisResult.predictorData?.available
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
            }`}>
              {analysisResult.predictorData?.source?.includes("Fallback")
                ? "MyVariant / dbNSFP"
                : analysisResult.predictorData?.available
                ? "REST Live"
                : "Unavailable"}
            </span>
          </div>

          {/* NCBI ClinVar */}
          <div className="flex justify-between items-center pb-1.5 border-b border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${clinvarUid ? "bg-emerald-500" : "bg-slate-400"}`} />
              <span className="font-semibold text-cs-text-primary">NCBI ClinVar</span>
            </div>
            <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
              clinvarUid
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
            }`}>
              {clinvarUid ? "Indexed" : "Unindexed (Novel)"}
            </span>
          </div>

          {/* Gemini AI */}
          <div className="flex justify-between items-center pb-1.5 border-b border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${
                serverGeminiReady || (settings.geminiSessionId && Date.now() < (settings.geminiSessionExpiresAt || 0))
                  ? "bg-emerald-500"
                  : settings.geminiApiKey
                  ? "bg-amber-500"
                  : "bg-slate-400"
              }`} />
              <span className="font-semibold text-cs-text-primary">Gemini Clinical AI</span>
            </div>
            <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
              serverGeminiReady || (settings.geminiSessionId && Date.now() < (settings.geminiSessionExpiresAt || 0))
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : settings.geminiApiKey
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
            }`}>
              {serverGeminiReady
                ? "Server Key Active"
                : settings.geminiSessionId && Date.now() < (settings.geminiSessionExpiresAt || 0)
                ? "Session Active"
                : settings.geminiApiKey
                ? "Key Ready"
                : "Key Required"}
            </span>
          </div>

          {/* Arc Institute Evo 2 */}
          <div className="flex justify-between items-center pb-1.5 border-b border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${
                conservationData?.evo2 !== null && conservationData?.evo2 !== undefined
                  ? "bg-emerald-500"
                  : conservationData?.evo2Message
                  ? "bg-amber-500"
                  : settings.nvidiaApiKey
                  ? "bg-blue-400"
                  : "bg-slate-400"
              }`} />
              <span className="font-semibold text-cs-text-primary">Arc Evo 2 (40B)</span>
            </div>
            <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
              conservationData?.evo2 !== null && conservationData?.evo2 !== undefined
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : conservationData?.evo2Message
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                : settings.nvidiaApiKey
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
            }`}>
              {conservationData?.evo2 !== null && conservationData?.evo2 !== undefined
                ? "Scored"
                : conservationData?.evo2Message
                ? "Notice"
                : settings.nvidiaApiKey
                ? "Key Linked"
                : "Unconfigured"}
            </span>
          </div>

          {/* Song Lab GPN-Star */}
          <div className="flex justify-between items-center pb-1.5 border-b border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${
                conservationData?.gpnStar !== null && conservationData?.gpnStar !== undefined
                  ? "bg-emerald-500"
                  : conservationData?.gpnStarMessage
                  ? "bg-amber-500"
                  : settings.hfToken
                  ? "bg-blue-400"
                  : "bg-slate-400"
              }`} />
              <span className="font-semibold text-cs-text-primary">Song Lab GPN-Star</span>
            </div>
            <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
              conservationData?.gpnStar !== null && conservationData?.gpnStar !== undefined
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : conservationData?.gpnStarMessage
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                : settings.hfToken
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
            }`}>
              {conservationData?.gpnStar !== null && conservationData?.gpnStar !== undefined
                ? "Scored"
                : conservationData?.gpnStarMessage
                ? "Endpoint Required"
                : settings.hfToken
                ? "Token Linked"
                : "Unconfigured"}
            </span>
          </div>

          {/* Biophysical Engine Status */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${diagnostics?.foldxReady ? "bg-emerald-500" : "bg-slate-400"}`} />
              <span className="font-semibold text-cs-text-primary">Biophysical Engines</span>
            </div>
            <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
              diagnostics?.foldxReady
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
            }`}>
              {diagnostics?.foldxReady ? "FoldX Live" : "Local Standby"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(EvidenceInspector);
