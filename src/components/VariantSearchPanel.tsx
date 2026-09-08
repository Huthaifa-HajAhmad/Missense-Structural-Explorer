import React, { useState } from "react";
import { 
  Search, 
  Dna, 
  Sparkles, 
  History, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  Clipboard, 
  ShieldAlert,
  CheckCircle2,
  Circle,
  Zap,
  HelpCircle,
  ArrowRight,
  Layers,
  Activity,
  BarChart2,
  Map,
  FlaskConical,
  BookOpen,
  FileText,
  AlertTriangle,
  KeyRound,
  Settings
} from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";
import { MasterView } from "./MasterSidebar";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { useSettings } from "../context/SettingsContext";
import { getWorkflowStageStatus } from "../shared/workflowStatus";

interface VariantSearchPanelProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  classInput: string;
  classBorderSec: string;
  customGene: string;
  setCustomGene: (val: string) => void;
  customVariant: string;
  setCustomVariant: (val: string) => void;
  customUniprot: string;
  setCustomUniprot: (val: string) => void;
  customGenomic: string;
  setCustomGenomic: (val: string) => void;
  analysisState: AnalysisState;
  handleSearchSubmit: (e: React.FormEvent) => void;
  gene: string;
  variant: string;
  uniprotId: string;
  history: SearchHistoryItem[];
  clearHistory: () => void;
  handleSelectHistoryItem: (item: SearchHistoryItem) => void;
  onViewChange?: (view: MasterView) => void;
}

/** Reads clipboard text and calls setter. Silently ignores permission errors. */
async function pasteFromClipboard(setter: (val: string) => void) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) setter(text.trim());
  } catch {
    // clipboard access denied or unavailable — no-op
  }
}

function VariantSearchPanel({
  isDark,
  classInput,
  classBorderSec,
  customGene,
  setCustomGene,
  customVariant,
  setCustomVariant,
  customUniprot,
  setCustomUniprot,
  customGenomic,
  setCustomGenomic,
  analysisState,
  handleSearchSubmit,
  gene,
  variant,
  history,
  clearHistory,
  handleSelectHistoryItem,
  onViewChange,
}: VariantSearchPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const userDirections = useVariantAnalysisStore(s => s.userDirections ?? "");
  const loadingStep = useVariantAnalysisStore(s => s.loadingStep ?? "");
  const isFolding = useVariantAnalysisStore(s => s.isFolding ?? false);
  const isBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading ?? false);
  const isClinicalLoading = useVariantAnalysisStore(s => s.isClinicalLoading ?? false);
  const isNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading ?? false);
  const isPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading ?? false);
  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status ?? null);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus ?? null);
  const { setUserDirections } = useVariantAnalysisActions();
  const { hasConfiguredGeminiKey, openSettingsTab } = useSettings();
  const result = analysisState.result;

  // Check if any pipeline stage or background solver is still in active execution
  const isPipelineActive = Boolean(
    analysisState.isLoading ||
    isBiophysicalLoading ||
    isClinicalLoading ||
    isNarrativeLoading ||
    isFolding ||
    isPocketLoading
  );

  const isGenomicVariant = (customVariant && (
    /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i.test(customVariant.trim()) ||
    /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i.test(customVariant.trim()) ||
    /^(?:chr)?[0-9XYMT]+-\d+-[ACGTN]+-[ACGTN]+$/i.test(customVariant.trim())
  )) || !!customGenomic.trim();
  const isGeneRequired = !isGenomicVariant;
  const isVariantRequired = !customGenomic.trim();

  const inputBase = `w-full rounded-lg px-3 py-2 text-[13px] outline-none border transition-all font-medium ${classInput}`;

  const PasteBtn = ({ setter }: { setter: (v: string) => void }) => (
    <button
      type="button"
      tabIndex={-1}
      title="Paste from clipboard"
      onClick={() => pasteFromClipboard(setter)}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded transition-opacity cursor-pointer text-cs-text-muted hover:text-cs-accent-clay active:scale-95"
    >
      <Clipboard className="w-3.5 h-3.5" />
    </button>
  );

  // Derive stage status & metrics for live workflow rail
  const getStageInfo = (stage: "evidence" | "structure" | "energetics" | "landscape" | "insights" | "literature" | "report") => {
    const raw = getWorkflowStageStatus(
      stage,
      result,
      isFolding,
      isBiophysicalLoading,
      isClinicalLoading,
      analysisState.isLoading,
      loadingStep,
      isPocketLoading,
      dynamut2Status,
      ddmutStatus,
      isNarrativeLoading
    );
    const statusMap: Record<string, string> = {
      complete: "Complete",
      progress: "In Progress",
      pending: "Pending",
      degraded: "Degraded",
      error: "Error"
    };
    return {
      status: statusMap[raw.status] || raw.status,
      desc: raw.desc
    };
  };

  return (
    <div className="w-full flex flex-col gap-6 cs-fade-in no-scrollbar" id="variant-search-workspace">
      {/* ── Screen Header & Context Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--cs-border-subtle)]">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="p-1.5 rounded-lg bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)]">
              <Dna className="w-4 h-4" />
            </span>
            <h1 
              className="text-[20px] font-medium tracking-tight"
              style={{ color: "var(--cs-text-primary)" }}
            >
              Variant Analysis Workspace
            </h1>
          </div>
          <p className="text-[13px] max-w-3xl leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
            Enter target gene symbol, HGVS variant notation, and optional UniProt accession to run real-time structural, energetic, and clinical evidence pipelines.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          {!hasConfiguredGeminiKey ? (
            <button
              type="button"
              onClick={() => openSettingsTab("api")}
              title="API key is not configured — click to open Settings"
              className="badge-data-source text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 cursor-pointer flex items-center gap-1.5 transition-all active:scale-95 shadow-xs"
            >
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              API Key Required
            </button>
          ) : (
            <span className="badge-data-source text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Pipeline Ready
            </span>
          )}
          <span className="badge-data-source font-mono text-[11px]">
            <Zap className="w-3 h-3 text-[var(--cs-accent-clay)]" />
            v1.0.0-dev
          </span>
        </div>
      </div>

      {/* ── Main Workspace Card (Flat 1px Hairline Border, No Elevation Shadow) ── */}
      <div 
        className="rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-none overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--cs-border-subtle)]">
          {/* ── LEFT COLUMN: Search Variant Form (col-span-7) ── */}
          <div className="lg:col-span-7 p-6 lg:p-7 flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "var(--cs-text-primary)" }}>
                  <Search className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                  Search Variant
                </h2>
              </div>

              <form onSubmit={handleSearchSubmit} className="flex flex-col gap-4">
                {/* Row 1: Gene + Variant */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label 
                      htmlFor="input-gene-symbol"
                      className="text-[12px] font-medium flex justify-between items-center"
                      style={{ color: "var(--cs-text-secondary)" }}
                    >
                      <span>Gene Symbol {isGeneRequired && <span className="text-rose-500">*</span>}</span>
                    </label>
                    <div className="relative">
                      <input
                        id="input-gene-symbol"
                        type="text"
                        required={isGeneRequired}
                        placeholder="e.g. CNNM2"
                        value={customGene}
                        onChange={(e) => setCustomGene(e.target.value)}
                        className={inputBase + " pr-9 font-semibold tracking-wide uppercase"}
                        style={{ fontFamily: "var(--cs-font-mono)" }}
                      />
                      <PasteBtn setter={setCustomGene} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label 
                      htmlFor="input-variant-notation"
                      className="text-[12px] font-medium flex justify-between items-center"
                      style={{ color: "var(--cs-text-secondary)" }}
                    >
                      <span>Variant Notation {isVariantRequired && <span className="text-rose-500">*</span>}</span>
                    </label>
                    <div className="relative">
                      <input
                        id="input-variant-notation"
                        type="text"
                        required={isVariantRequired}
                        placeholder="e.g. p.Gly380Arg"
                        value={customVariant}
                        onChange={(e) => setCustomVariant(e.target.value)}
                        className={inputBase + " pr-9 font-semibold tracking-wide"}
                        style={{ fontFamily: "var(--cs-font-mono)" }}
                      />
                      <PasteBtn setter={setCustomVariant} />
                    </div>
                  </div>
                </div>

                {/* Row 2: Genomic Coordinates */}
                <div className="flex flex-col gap-1.5">
                  <label 
                    htmlFor="input-genomic-coords"
                    className="text-[12px] font-medium flex justify-between items-center"
                    style={{ color: "var(--cs-text-secondary)" }}
                  >
                    <span>Genomic Coordinates (Optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      id="input-genomic-coords"
                      type="text"
                      placeholder="e.g. 20-23365054-G-A"
                      value={customGenomic}
                      onChange={(e) => setCustomGenomic(e.target.value)}
                      className={inputBase + " pr-9 uppercase"}
                      style={{ fontFamily: "var(--cs-font-mono)" }}
                    />
                    <PasteBtn setter={setCustomGenomic} />
                  </div>
                </div>

                {/* Row 3: UniProt Accession */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <label 
                    htmlFor="input-uniprot-acc"
                    className="text-[12px] font-medium flex justify-between items-center"
                    style={{ color: "var(--cs-text-secondary)" }}
                  >
                    <span>UniProt Accession (Optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      id="input-uniprot-acc"
                      type="text"
                      placeholder="e.g. Q9H8M5 (Auto-resolved if omitted)"
                      value={customUniprot}
                      onChange={(e) => setCustomUniprot(e.target.value)}
                      className={inputBase + " pr-9 uppercase"}
                      style={{ fontFamily: "var(--cs-font-mono)" }}
                    />
                    <PasteBtn setter={setCustomUniprot} />
                  </div>
                </div>

                {/* AI Focus Area / Custom Instructions (Collapsible) */}
                <div className="border border-[var(--cs-border)] rounded-lg overflow-hidden bg-[var(--cs-surface-2)] transition-all">
                  <details className="group">
                    <summary className="flex justify-between items-center px-3.5 py-2.5 text-xs font-medium select-none cursor-pointer transition-colors hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />
                        AI Focus Area & Custom Analysis Instructions
                      </span>
                      <span className="transition-transform group-open:rotate-180 text-[var(--cs-text-muted)]">
                        <ChevronDown className="w-4 h-4" />
                      </span>
                    </summary>
                    <div className="p-3.5 border-t border-[var(--cs-border-subtle)] space-y-2.5">
                      <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] leading-relaxed flex gap-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <span style={{ color: "var(--cs-text-secondary)" }}>
                          <strong>Privacy Notice:</strong> Filtered workspace. Do not submit patient PII (names, MRNs, dates of birth).
                        </span>
                      </div>
                      <textarea
                        id="textarea-user-directions"
                        aria-label="AI Focus Area & Custom Analysis Instructions"
                        placeholder="e.g. Focus on structural disruption of cofactor binding loop, evaluate ACMG PM2/PS3 rules, or analyze active site residue proximity..."
                        value={userDirections}
                        onChange={(e) => {
                          const text = e.target.value.slice(0, 2000);
                          setUserDirections(text);
                        }}
                        maxLength={2000}
                        className="w-full h-20 rounded-md border p-2.5 text-xs outline-none bg-[var(--cs-surface)] resize-none border-[var(--cs-border)]"
                        style={{ color: "var(--cs-text-primary)" }}
                      />
                      <div className="flex justify-between items-center text-[10px]" style={{ color: "var(--cs-text-muted)" }}>
                        <span>Directs downstream AI narrative synthesis</span>
                        <span>{userDirections.length}/2000 chars</span>
                      </div>
                    </div>
                  </details>
                </div>

                {/* Submit Action Button — Greyed out with direct CTA if API keys are unconfigured */}
                {!hasConfiguredGeminiKey ? (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => openSettingsTab("api")}
                      aria-label="API Key Required — Open Settings"
                      className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-[13.5px] font-semibold transition-all cursor-pointer shadow-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 active:scale-[0.99]"
                    >
                      <KeyRound className="w-4 h-4 text-amber-500" />
                      <span>API Key Required · Configure to Analyze</span>
                      <ArrowRight className="w-4 h-4 ml-1 opacity-80" />
                    </button>
                    <p className="text-[11px] text-center text-cs-text-muted">
                      Pipeline execution requires a configured API key. Click above to configure.
                    </p>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={isPipelineActive}
                    aria-label="Analyze Variant"
                    className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-[14px] font-semibold text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-none hover:brightness-105 active:scale-[0.99]"
                    style={{ background: "var(--cs-accent-clay)" }}
                  >
                    {isPipelineActive ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Executing Pipeline Analysis…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Analyze Variant
                        <ArrowRight className="w-4 h-4 ml-1 opacity-80" />
                      </>
                    )}
                  </button>
                )}
              </form>

              {/* Format Help Box (Preserves layout card height balance with clean, modern badge chips) */}
              <div className="mt-4 p-3.5 rounded-lg border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] text-[12px] flex items-start gap-3 shadow-xs">
                <HelpCircle className="w-4 h-4 text-[var(--cs-accent-clay)] shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[12px]" style={{ color: "var(--cs-text-primary)" }}>
                      Supported Input Formats & Conventions
                    </span>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)] text-[var(--cs-text-muted)]">
                      Auto-Resolved
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                    <div className="flex items-center justify-between py-0.5">
                      <span>• <strong>Protein HGVS:</strong></span>
                      <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)]">p.Gly380Arg</code>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span>• <strong>cDNA HGVS:</strong></span>
                      <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)]">c.123A&gt;G</code>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span>• <strong>Genomic:</strong></span>
                      <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)]">20-23365054-G-A</code>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span>• <strong>ClinVar ID:</strong></span>
                      <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)]">VCV000013920</code>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span>• <strong>Gene Symbol:</strong></span>
                      <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)]">CNNM2, MECP2</code>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span>• <strong>UniProt:</strong></span>
                      <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)]">Q9H8M5, P51587</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Live & Interactive Workflow Pipeline Rail (col-span-5) ── */}
          <div className="lg:col-span-5 p-6 lg:p-7 bg-[var(--cs-surface-2)] border-t lg:border-t-0 lg:border-l border-[var(--cs-border)] flex flex-col justify-between gap-4">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--cs-border-subtle)] shrink-0">
                <h2 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "var(--cs-text-primary)" }}>
                  <Layers className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                  Workflow Pipeline
                </h2>
                <span className={!isPipelineActive && result ? "text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-1.5" : "badge-data-source flex items-center gap-1.5"}>
                  <Activity className={`w-3 h-3 ${!isPipelineActive && result ? "text-emerald-500" : "text-[var(--cs-accent-clay)] animate-pulse"}`} />
                  {isPipelineActive ? "Live Execution" : result ? "Result Loaded" : "Est. ~30 sec"}
                </span>
              </div>

              {/* Workflow Live Stages List — Evenly Distributed without Dead Space */}
              <div className="flex-1 flex flex-col justify-between gap-2 my-1">
                {[
                  { key: "evidence", title: "Evidence Pipeline", Icon: BarChart2, targetView: "evidence" as MasterView },
                  { key: "structure", title: "3D Structure", Icon: Layers, targetView: "structure" as MasterView },
                  { key: "energetics", title: "Energetics Engine", Icon: Activity, targetView: "energetics" as MasterView },
                  { key: "landscape", title: "Landscape Minimap", Icon: Map, targetView: "landscape" as MasterView },
                  { key: "insights", title: "Variant Insights", Icon: FlaskConical, targetView: "insights" as MasterView },
                  { key: "literature", title: "Literature Mining", Icon: BookOpen, targetView: "literature" as MasterView },
                  { key: "report", title: "Clinical Report", Icon: FileText, targetView: "report" as MasterView },
                ].map(({ key, title, Icon, targetView }) => {
                  const info = getStageInfo(key as any);
                  const isClickable = !!result && !!onViewChange;
                  const isRunning = info.status === "In Progress" || info.status === "Computing";
                  const isDone = info.status === "Complete";
                  const isDegraded = info.status === "Degraded" || info.status === "degraded";
                  const isErr = info.status === "Error" || info.status === "error";

                  return (
                    <div 
                      key={key}
                      onClick={() => isClickable && onViewChange?.(targetView)}
                      className={`p-2.5 px-3 rounded-lg border transition-all flex-1 min-h-[50px] flex items-center justify-between gap-3 select-none ${
                        isClickable ? "cursor-pointer hover:border-[var(--cs-accent-clay)] hover:shadow-xs" : ""
                      } ${
                        isDone 
                          ? "border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-xs" 
                          : isRunning 
                          ? "border-[var(--cs-accent-clay)]/50 bg-[var(--cs-surface)] shadow-xs" 
                          : isDegraded || isErr
                          ? "border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/10 shadow-xs"
                          : "border-[var(--cs-border-subtle)] bg-[var(--cs-surface)]/80"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {isRunning ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[var(--cs-accent-clay)] shrink-0" />
                        ) : isDone ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : isDegraded || isErr ? (
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-[var(--cs-text-muted)] shrink-0" />
                        )}
                        
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5 text-[var(--cs-text-muted)] shrink-0" />
                            <span className="text-[12px] font-semibold text-cs-text-primary truncate">
                              {title}
                            </span>
                          </div>
                          <p className="text-[10px] text-cs-text-secondary truncate mt-0.5 font-sans leading-tight">
                            {info.desc}
                          </p>
                        </div>
                      </div>

                      {/* Right Action / Status Badge */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={
                          isDone 
                            ? "text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" 
                            : isRunning 
                            ? "text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" 
                            : isDegraded || isErr
                            ? "text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                            : "badge-data-source text-[9.5px]"
                        }>
                          {info.status}
                        </span>

                        {isClickable && (
                          <span className="p-0.5 rounded text-cs-text-muted hover:text-cs-accent-clay hover:bg-cs-bg-subtle transition-colors">
                            <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pipeline Live Status Footer */}
            <div className="p-3.5 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[11px] leading-relaxed flex items-center gap-2.5 shadow-xs" style={{ color: "var(--cs-text-secondary)" }}>
              <Zap className="w-4 h-4 text-[var(--cs-accent-clay)] shrink-0" />
              <span>
                {isPipelineActive 
                  ? loadingStep || "Processing pipeline analysis…" 
                  : result 
                    ? "Analysis complete! Click on any pipeline step card above to navigate and explore the results." 
                    : "Parallel biophysical computation engine"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── LOWER SECTION: Recent Searches ── */}
      {history.length > 0 && (
        <div className={`p-4 rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-none ${classBorderSec}`}>
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setHistoryOpen(p => !p)}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              <span className="p-1 rounded bg-[var(--cs-surface-2)] text-[var(--cs-accent-clay)] group-hover:bg-[var(--cs-bg-subtle)] transition-colors">
                <History className="w-3.5 h-3.5" />
              </span>
              <span className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: "var(--cs-text-secondary)" }}>
                Recent Searches ({history.length})
              </span>
              {historyOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
              )}
            </button>

            <button
              type="button"
              onClick={clearHistory}
              className="text-[11px] font-medium flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer hover:bg-rose-500/10 text-[var(--cs-text-muted)] hover:text-rose-500"
              title="Clear search history"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>

          {historyOpen && (
            <div className="flex flex-wrap gap-2 pt-1">
              {history.map((item, idx) => (
                <button
                  key={`${item.gene}_${item.variant}_${idx}`}
                  onClick={() => handleSelectHistoryItem(item)}
                  className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer flex items-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
                  style={{
                    background: gene === item.gene && variant === item.variant
                      ? "var(--cs-accent-mag-soft)" : "var(--cs-surface-2)",
                    border: gene === item.gene && variant === item.variant
                      ? "1px solid var(--cs-accent-clay)" : "1px solid var(--cs-border)",
                  }}
                >
                  <span className="font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                    {item.gene}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--cs-text-secondary)" }}>
                    {item.variant}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(VariantSearchPanel);
