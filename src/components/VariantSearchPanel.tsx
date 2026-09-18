import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Search, 
  Dna, 
  Sparkles, 
  History, 
  Trash2, 
  ChevronDown, 
  Loader2, 
  Clipboard, 
  ShieldAlert,
  CheckCircle2,
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
  KeyRound
} from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";
import { MasterView } from "./MasterSidebar";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { useSettings } from "../context/SettingsContext";
import { getWorkflowStageStatus } from "../shared/workflowStatus";
import { isGenomicOrCdnaNotation } from "../shared/variantNotation.ts";
import LiveTelemetryPanel from "./telemetry/LiveTelemetryPanel";

const PasteBtn: React.FC<{ setter: (v: string) => void }> = ({ setter }) => (
  <button
    type="button"
    tabIndex={-1}
    title="Paste from clipboard"
    aria-label="Paste from clipboard"
    onClick={() => pasteFromClipboard(setter)}
    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded transition-[color,scale] duration-150 ease-out cursor-pointer text-cs-text-muted hover:text-cs-accent-clay active:scale-[0.96] z-10"
  >
    <Clipboard className="w-3.5 h-3.5" />
  </button>
);

interface VariantSearchPanelProps {
  isDark: boolean;
  classCard?: string;
  classCardHeader?: string;
  classCardTitle?: string;
  classInput?: string;
  classBorderSec?: string;
  customGene?: string;
  setCustomGene?: (val: string) => void;
  customVariant?: string;
  setCustomVariant?: (val: string) => void;
  customUniprot?: string;
  setCustomUniprot?: (val: string) => void;
  customGenomic?: string;
  setCustomGenomic?: (val: string) => void;
  analysisState?: AnalysisState;
  handleSearchSubmit?: (e: React.FormEvent) => void;
  gene?: string;
  variant?: string;
  uniprotId?: string;
  history?: SearchHistoryItem[];
  clearHistory?: () => void;
  handleSelectHistoryItem?: (item: SearchHistoryItem) => void;
  onViewChange?: (view: MasterView) => void;
}

const WORKFLOW_STAGES = [
  { key: "evidence", title: "Evidence Pipeline", Icon: BarChart2, targetView: "evidence" as MasterView },
  { key: "structure", title: "3D Structure", Icon: Layers, targetView: "structure" as MasterView },
  { key: "energetics", title: "Energetics Engine", Icon: Activity, targetView: "energetics" as MasterView },
  { key: "landscape", title: "Landscape Minimap", Icon: Map, targetView: "landscape" as MasterView },
  { key: "insights", title: "Variant Insights", Icon: FlaskConical, targetView: "insights" as MasterView },
  { key: "literature", title: "Literature Mining", Icon: BookOpen, targetView: "literature" as MasterView },
  { key: "report", title: "Clinical Report", Icon: FileText, targetView: "report" as MasterView },
] as const;

type RailTabId = "telemetry" | "pipeline";
const RAIL_TAB_ORDER: RailTabId[] = ["telemetry", "pipeline"];

/**
 * Shared geometry for the outcome badge on the far right of the rail header.
 * Both tabs use it so the header never changes colour system or box size on switch.
 */
const RAIL_BADGE_BASE =
  "flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-0.5 rounded border shrink-0 whitespace-nowrap";

/**
 * One segment of the rail switcher. Both segments are rendered from this so the
 * two states can never drift apart in padding, radius or motion.
 */
const RailTab: React.FC<{
  id: RailTabId;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  tabIndex: number;
  onSelect: () => void;
}> = ({ id, active, icon, label, badge, tabIndex, onSelect }) => (
  <button
    type="button"
    role="tab"
    id={`tab-${id}`}
    aria-selected={active}
    aria-controls={`panel-${id}`}
    tabIndex={tabIndex}
    onClick={onSelect}
    className={`px-3 py-1.5 rounded-md text-[12px] flex items-center gap-1.5 whitespace-nowrap cursor-pointer border active:scale-[0.96] transition-[background-color,border-color,color,box-shadow,scale] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]/45 ${
      active
        ? "bg-[var(--cs-surface)] text-[var(--cs-accent-clay)] font-bold border-[var(--cs-accent-clay)]/40 shadow-xs ring-1 ring-[var(--cs-accent-clay)]/20"
        : "text-[var(--cs-text-secondary)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-surface)]/60 font-medium border-transparent"
    }`}
  >
    {icon}
    <span>{label}</span>
    {badge}
  </button>
);

/** Reads clipboard text and calls setter. Silently ignores permission errors. */
async function pasteFromClipboard(setter: (val: string) => void) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text !== undefined && text !== null) {
        setter(text.trim());
      }
    }
  } catch (err) {
    console.warn("[Paste] Clipboard readText failed or permission denied:", err);
  }
}

function VariantSearchPanel({
  isDark,
  classInput = "",
  classBorderSec = "",
  customGene: propsCustomGene,
  setCustomGene: propsSetCustomGene,
  customVariant: propsCustomVariant,
  setCustomVariant: propsSetCustomVariant,
  customUniprot: propsCustomUniprot,
  setCustomUniprot: propsSetCustomUniprot,
  customGenomic: propsCustomGenomic,
  setCustomGenomic: propsSetCustomGenomic,
  analysisState: propsAnalysisState,
  handleSearchSubmit: propsHandleSearchSubmit,
  gene: propsGene,
  variant: propsVariant,
  uniprotId: propsUniprotId,
  history: propsHistory,
  clearHistory: propsClearHistory,
  handleSelectHistoryItem: propsHandleSelectHistoryItem,
  onViewChange,
}: VariantSearchPanelProps) {
  // Directly subscribe to Zustand store slices to guarantee instant re-renders on keystroke and paste
  const storeCustomGene = useVariantAnalysisStore(s => s.customGene ?? "");
  const storeCustomVariant = useVariantAnalysisStore(s => s.customVariant ?? "");
  const storeCustomUniprot = useVariantAnalysisStore(s => s.customUniprot ?? "");
  const storeCustomGenomic = useVariantAnalysisStore(s => s.customGenomic ?? "");
  const storeAnalysisState = useVariantAnalysisStore(s => s.analysisState);
  const storeGene = useVariantAnalysisStore(s => s.gene ?? "");
  const storeVariant = useVariantAnalysisStore(s => s.variant ?? "");
  const storeUniprotId = useVariantAnalysisStore(s => s.uniprotId ?? "");
  const storeHistory = useVariantAnalysisStore(s => s.history ?? []);

  const userDirections = useVariantAnalysisStore(s => s.userDirections ?? "");
  const loadingStep = useVariantAnalysisStore(s => s.loadingStep ?? "");
  const isFolding = useVariantAnalysisStore(s => s.isFolding ?? false);
  const isBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading ?? false);
  const isClinicalLoading = useVariantAnalysisStore(s => s.isClinicalLoading ?? false);
  const isNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading ?? false);
  const isPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading ?? false);
  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status ?? null);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus ?? null);

  const actions = useVariantAnalysisActions();
  const { hasConfiguredGeminiKey, openSettingsTab } = useSettings();

  // Active state bindings with direct store reactivity
  const customGene = storeCustomGene;
  const setCustomGene = actions.setCustomGene;
  const customVariant = storeCustomVariant;
  const setCustomVariant = actions.setCustomVariant;
  const customUniprot = storeCustomUniprot;
  const setCustomUniprot = actions.setCustomUniprot;
  const customGenomic = storeCustomGenomic;
  const setCustomGenomic = actions.setCustomGenomic;
  const setUserDirections = actions.setUserDirections;

  const analysisState = propsAnalysisState ?? storeAnalysisState;
  const gene = propsGene ?? storeGene;
  const variant = propsVariant ?? storeVariant;
  const history = propsHistory ?? storeHistory;
  const clearHistory = propsClearHistory ?? actions.clearHistory;
  const handleSelectHistoryItem = propsHandleSelectHistoryItem ?? ((item: SearchHistoryItem) => {
    actions.setGene(item.gene);
    actions.setVariant(item.variant);
    actions.setUniprotId(item.uniprotId);
    actions.setCustomGene(item.gene);
    actions.setCustomVariant(item.variant);
    actions.setCustomUniprot(item.uniprotId ?? "");
    actions.setCustomGenomic("");
  });
  const handleSearchSubmit = propsHandleSearchSubmit ?? ((e: React.FormEvent) => {
    e.preventDefault();
  });

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

  const [activeRightTab, setActiveRightTab] = useState<"pipeline" | "telemetry">(result ? "pipeline" : "telemetry");

  useEffect(() => {
    if (isPipelineActive) {
      setActiveRightTab("pipeline");
    }
  }, [isPipelineActive]);

  // Roving focus for the rail switcher: arrow keys move and activate, as the
  // tablist pattern expects. Without this the switcher was pointer-only.
  const railTabListRef = useRef<HTMLDivElement>(null);
  const handleRailKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = RAIL_TAB_ORDER.indexOf(activeRightTab);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % RAIL_TAB_ORDER.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + RAIL_TAB_ORDER.length) % RAIL_TAB_ORDER.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = RAIL_TAB_ORDER.length - 1;
    if (next === null) return;

    e.preventDefault();
    setActiveRightTab(RAIL_TAB_ORDER[next]);
    railTabListRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      ?.[next]?.focus();
  }, [activeRightTab]);

  const onFormSubmit = (e: React.FormEvent) => {
    setActiveRightTab("pipeline");
    handleSearchSubmit(e);
  };

  const isGenomicVariant =
    (!!customVariant && isGenomicOrCdnaNotation(customVariant)) || !!customGenomic.trim();
  const isGeneRequired = !isGenomicVariant;
  const isVariantRequired = !customGenomic.trim();

  const inputBase = `w-full rounded-lg px-3 py-2 text-[13px] outline-none border transition-all font-medium select-text ${classInput}`;

  // Derive stage status & metrics for live workflow rail
  const getStageInfo = (stage: "evidence" | "structure" | "energetics" | "landscape" | "insights" | "literature" | "report") => {
    const raw = getWorkflowStageStatus({
      view: stage,
      result,
      isFolding,
      isBiophysicalLoading,
      isClinicalLoading,
      isLoadingSearch: analysisState.isLoading,
      loadingStep,
      isPocketLoading,
      dynamut2Status,
      ddmutStatus,
      isNarrativeLoading
    });
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
          {!hasConfiguredGeminiKey && (
            <button
              type="button"
              onClick={() => openSettingsTab("api")}
              title="API key is not configured — click to open Settings"
              className="badge-data-source text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 cursor-pointer flex items-center gap-1.5 transition-all active:scale-95 shadow-xs"
            >
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              API Key Required
            </button>
          )}
        </div>
      </div>

      {/* ── Main Workspace Card (Flat 1px Hairline Border, No Elevation Shadow) ── */}
      <div 
        className="rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-none overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--cs-border-subtle)]">
          {/* ── LEFT COLUMN: Search Variant Form (col-span-7) ── */}
          <div className="lg:col-span-7 p-6 lg:p-7 flex flex-col">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "var(--cs-text-primary)" }}>
                  <Search className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                  Search Variant
                </h2>
              </div>

              <form onSubmit={onFormSubmit} className="flex flex-col gap-4">
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
                        className="w-full h-20 rounded-md border p-2.5 text-xs outline-none bg-[var(--cs-surface)] resize-none border-[var(--cs-border)] select-text"
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
                      className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-[13.5px] font-semibold transition-[background-color,scale] duration-150 ease-out cursor-pointer shadow-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/45"
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
                    className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-[14px] font-semibold text-white transition-[background-color,filter,scale] duration-150 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-none hover:brightness-105 disabled:hover:brightness-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]/50 focus-visible:ring-offset-0"
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
                      <span>• <strong>Genomic HGVS:</strong></span>
                      <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)]">Chr1(GRCh38):g.25484258G&gt;A</code>
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

              {/* ── Recent Analyses / Zero-History Placeholder Tray ── */}
              <div className="mt-4 pt-3 border-t border-[var(--cs-border-subtle)]">
                {history.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase" style={{ color: "var(--cs-text-secondary)" }}>
                        <History className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />
                        <span>Recent Analyses ({history.length})</span>
                      </div>
                      <button
                        type="button"
                        onClick={clearHistory}
                        className="text-[10.5px] font-medium flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer hover:bg-rose-500/10 text-[var(--cs-text-muted)] hover:text-rose-500"
                        title="Clear search history"
                        aria-label="Clear search history"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {history.slice(0, 8).map((item, idx) => {
                        const isActive = gene === item.gene && variant === item.variant;
                        return (
                          <button
                            key={`${item.gene}_${item.variant}_${idx}`}
                            type="button"
                            onClick={() => handleSelectHistoryItem(item)}
                            aria-pressed={isActive}
                            className={`px-2.5 py-1 rounded-md text-[11px] cursor-pointer flex items-center gap-1.5 border shadow-xs transition-[background-color,border-color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cs-accent-clay)] ${
                              isActive
                                ? "border-[var(--cs-accent-clay)] bg-[var(--cs-accent-mag-soft)]"
                                : "border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] hover:border-[var(--cs-accent-clay)]/50 hover:bg-[var(--cs-surface-2)]"
                            }`}
                            title={`Reload ${item.gene} ${item.variant}`}
                            aria-label={`Select recent search ${item.gene} ${item.variant}`}
                          >
                            <span className="font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                              {item.gene}
                            </span>
                            <span className="font-mono text-[10.5px]" style={{ color: "var(--cs-text-secondary)" }}>
                              {item.variant}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Zero-History Empty State Placeholder */
                  <div className="p-4 rounded-xl border border-dashed border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)]/40 flex flex-col items-center justify-center text-center gap-2 select-none">
                    <div className="w-8 h-8 rounded-full bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)] flex items-center justify-center text-[var(--cs-accent-clay)] shadow-xs">
                      <History className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[12px] font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                        No Recent Variant Analyses
                      </p>
                      <p className="text-[11px] max-w-sm leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
                        Analyzed variants in this session will appear here for instant 1-click re-querying and review.
                      </p>
                    </div>
                    <div className="pt-0.5 flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)] text-[var(--cs-text-muted)]">
                      <span>💡 Paste HGVS, cDNA, or genomic coordinates to start</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Segmented Workflow Pipeline & Telemetry Rail (col-span-5) ──
              Height-locked to the left column. At `lg` the rail's inner layout is taken
              out of flow (absolute fill) so neither tab's content can contribute to the
              grid row height: the card is sized by the form column plus `min-h` alone, and
              both panels distribute/scroll inside a fixed track instead of resizing it. */}
          <div className="lg:col-span-5 lg:relative lg:min-h-[690px] bg-[var(--cs-surface-2)]">
            <div className="flex flex-col gap-4 p-6 lg:p-7 lg:absolute lg:inset-0">
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--cs-border-subtle)] shrink-0">
                {/* Segmented Switcher */}
                <div
                  ref={railTabListRef}
                  role="tablist"
                  aria-label="Analysis sidebar view switcher"
                  onKeyDown={handleRailKeyDown}
                  className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--cs-bg-subtle)] border border-[var(--cs-border)] shadow-xs shrink-0"
                >
                  <RailTab
                    id="telemetry"
                    active={activeRightTab === "telemetry"}
                    tabIndex={activeRightTab === "telemetry" ? 0 : -1}
                    onSelect={() => setActiveRightTab("telemetry")}
                    icon={<Activity className={`w-3.5 h-3.5 ${activeRightTab === "telemetry" ? "text-[var(--cs-accent-clay)]" : "text-[var(--cs-text-muted)]"}`} />}
                    label="Service Telemetry"
                  />

                  <RailTab
                    id="pipeline"
                    active={activeRightTab === "pipeline"}
                    tabIndex={activeRightTab === "pipeline" ? 0 : -1}
                    onSelect={() => setActiveRightTab("pipeline")}
                    icon={<Layers className={`w-3.5 h-3.5 ${activeRightTab === "pipeline" ? "text-[var(--cs-accent-clay)]" : "text-[var(--cs-text-muted)]"}`} />}
                    label="Workflow Pipeline"
                    badge={
                      isPipelineActive ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                      ) : result ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      ) : null
                    }
                  />
                </div>

                {/* Ready Status Badge on the far right above separator */}
                {activeRightTab === "telemetry" ? (
                  <span className={`${RAIL_BADGE_BASE} bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    Pre-flight Ready
                  </span>
                ) : (
                  <span className={`${RAIL_BADGE_BASE} ${
                    isPipelineActive
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      : result
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-bold"
                      : "bg-[var(--cs-surface)] text-[var(--cs-text-secondary)] border-[var(--cs-border)]"
                  }`}>
                    {isPipelineActive ? (
                      <Activity className="w-3 h-3 text-amber-500 animate-pulse shrink-0" />
                    ) : result ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    )}
                    {isPipelineActive ? "Live Execution" : result ? "Result Loaded" : "Pipeline Ready"}
                  </span>
                )}
              </div>

              {activeRightTab === "telemetry" ? (
                <div key="telemetry" id="panel-telemetry" role="tabpanel" aria-labelledby="tab-telemetry" className="flex-1 min-h-0 flex flex-col cs-tab-transition">
                  <LiveTelemetryPanel className="flex-1 min-h-0" />
                </div>
              ) : (
                <div key="pipeline" id="panel-pipeline" role="tabpanel" aria-labelledby="tab-pipeline" className="flex-1 min-h-0 flex flex-col justify-between gap-2.5 cs-tab-transition">
                  {/* Matching Subheader */}
                  <div className="flex items-center justify-between px-1 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-cs-text-primary">
                        Workflow Pipeline Execution
                      </span>
                      <span className="text-[10px] font-mono text-[var(--cs-text-muted)] px-1.5 py-0.5 rounded bg-[var(--cs-surface-2)] border border-[var(--cs-border-subtle)]">
                        {isPipelineActive ? "Running" : result ? "7/7 Complete" : "7 Stages"}
                      </span>
                    </div>
                  </div>

                  {/* Workflow Live Stages List — same row rhythm as the telemetry rail,
                      with surplus height distributed between rows rather than inside them. */}
                  <div className="flex-1 min-h-0 flex flex-col justify-between gap-2 my-0.5">
                    {WORKFLOW_STAGES.map(({ key, title, Icon, targetView }) => {
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
                          role={isClickable ? "button" : undefined}
                          tabIndex={isClickable ? 0 : undefined}
                          aria-label={isClickable ? `Navigate to ${title} view` : title}
                          onKeyDown={e => {
                            if (isClickable && (e.key === "Enter" || e.key === " ")) {
                              e.preventDefault();
                              onViewChange?.(targetView);
                            }
                          }}
                          className={`min-h-[46px] px-3 py-2 rounded-lg border transition-[border-color,background-color,scale] duration-150 ease-out flex items-center justify-between gap-2.5 select-none bg-[var(--cs-surface)] ${
                            isClickable ? "cursor-pointer hover:border-[var(--cs-accent-clay)]/70 hover:bg-[var(--cs-surface-2)] shadow-xs active:scale-[0.99] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cs-accent-clay)]" : ""
                          } ${
                            isDone
                              ? "border-[var(--cs-border)]"
                              : isRunning
                              ? "border-[var(--cs-accent-clay)]/50"
                              : isDegraded || isErr
                              ? "border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/10"
                              : "border-[var(--cs-border-subtle)]"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {/* One icon slot: it carries the stage's identity while the stage
                                is idle, and switches to the state glyph once there is a state
                                worth reporting. The status pill below always states it in text. */}
                            {isRunning ? (
                              <Loader2 className="w-4 h-4 animate-spin text-[var(--cs-accent-clay)] shrink-0" />
                            ) : isDone ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : isDegraded || isErr ? (
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                            ) : (
                              <Icon className="w-4 h-4 text-[var(--cs-text-muted)] shrink-0" />
                            )}

                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-semibold text-cs-text-primary truncate">
                                  {title}
                                </span>
                              </div>
                              <span className="text-[10px] text-cs-text-secondary truncate font-sans leading-tight">
                                {info.desc}
                              </span>
                            </div>
                          </div>

                          {/* Right Action / Status Badge */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[9.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                              isDone
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : isRunning
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : isDegraded || isErr
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
                            }`}>
                              {info.status}
                            </span>

                            {isClickable && (
                              <span className="p-0.5 rounded text-cs-text-muted hover:text-cs-accent-clay transition-colors">
                                <ArrowRight className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pipeline Live Status Footer */}
                  <div className="p-3 px-3.5 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[11.5px] leading-relaxed flex items-center gap-2.5 shadow-xs shrink-0" style={{ color: "var(--cs-text-secondary)" }}>
                    <Zap className="w-4 h-4 text-[var(--cs-accent-clay)] shrink-0" />
                    <span className="truncate">
                      {isPipelineActive
                        ? loadingStep || "Processing pipeline analysis…"
                        : result
                          ? "Analysis complete! Click on any pipeline stage card to navigate and explore."
                          : "Parallel biophysical computation engine ready"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(VariantSearchPanel);
