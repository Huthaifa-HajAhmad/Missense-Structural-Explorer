import React, { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Terminal, Search, Pause, Play, Download, Trash2, X, Copy, Check, Activity,
  ShieldAlert, Zap, Filter, Layers, Clock, FileText, Globe, Flame,
  ChevronDown, Rows3
} from "lucide-react";
import { useDevConsole } from "../context/DevConsoleContext";
import { ConsoleEntry, LogLevel, LogSource, LogStream, ErrorImpact, TraceRun, TraceSpan, PipelineStage } from "../types/devConsole";

const STREAM_ORDER: LogStream[] = ["error", "live", "tracing"];

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlights case-insensitive search matches with a clay-tinted <mark>. */
function highlightText(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "ig"));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="dev-console-mark">{part}</mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

export default function DevConsolePanel() {
  const {
    state,
    dispatch,
    exportErrorEntries,
    exportLiveEntries,
    exportTraceRuns,
  } = useDevConsole();

  const activeTab = state.activeTab;
  const currentStreamState = activeTab === "error" ? state.errorState : state.liveState;

  const [selectedEntry, setSelectedEntry] = useState<ConsoleEntry | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"overview" | "http" | "stack" | "session">("overview");
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [compact, setCompact] = useState(false);
  const [collapsedStages, setCollapsedStages] = useState<Set<PipelineStage>>(new Set());
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const clearAllTimer = useRef<number | undefined>(undefined);

  // Update relative timestamps every 10s
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => window.clearTimeout(clearAllTimer.current), []);

  const copyToClipboard = (text: string, actionName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAction(actionName);
    setTimeout(() => setCopiedAction(null), 2000);
  };

  const handleCopyMarkdownReport = (entry: ConsoleEntry) => {
    const report = [
      `### 🐞 Diagnostic Error Report: ${entry.message}`,
      `- **Timestamp:** ${new Date(entry.timestamp).toISOString()}`,
      `- **Level / Impact:** \`${entry.level.toUpperCase()}\` / \`${(entry.impact || "unclassified").toUpperCase()}\``,
      `- **Source Subsystem:** \`${entry.source}\``,
      entry.httpMeta?.url ? `- **Endpoint:** \`${entry.httpMeta.method || "GET"} ${entry.httpMeta.url}\` (${entry.httpMeta.status || "N/A"})` : "",
      entry.sessionContext?.gene ? `- **Active Variant:** \`${entry.sessionContext.gene} ${entry.sessionContext.variant || ""}\` (${entry.sessionContext.uniprotId || ""})` : "",
      entry.sessionContext?.memoryMB ? `- **Memory Usage:** ~${entry.sessionContext.memoryMB} MB` : "",
      "",
      entry.detail ? "#### Detail & Stack Trace\n```\n" + entry.detail + "\n```" : "",
      entry.httpMeta?.responseBody ? "#### Response Payload\n```json\n" + JSON.stringify(entry.httpMeta.responseBody, null, 2) + "\n```" : "",
    ].filter(Boolean).join("\n");

    copyToClipboard(report, "markdown");
  };

  const handleCopyCurl = (entry: ConsoleEntry) => {
    if (!entry.httpMeta?.url) return;
    const method = entry.httpMeta.method || "GET";
    const bodyStr = entry.httpMeta.requestBody ? ` -d '${JSON.stringify(entry.httpMeta.requestBody)}'` : "";
    const curl = `curl -X ${method} "${entry.httpMeta.url}" -H "Content-Type: application/json"${bodyStr}`;
    copyToClipboard(curl, "curl");
  };

  // Metrics
  const fatalErrorCount = useMemo(() => {
    return state.errorState.entries.filter((e) => e.impact === "fatal" || (e.level === "error" && !e.impact)).length;
  }, [state.errorState.entries]);

  const degradedErrorCount = useMemo(() => {
    return state.errorState.entries.filter((e) => e.impact === "degraded" || e.impact === "recoverable" || e.level === "warn").length;
  }, [state.errorState.entries]);

  const apiCallCount = useMemo(() => {
    return state.liveState.entries.filter((e) => e.source === "network" || e.message.includes("/api/v1/")).length;
  }, [state.liveState.entries]);

  const cacheHitCount = useMemo(() => {
    return state.liveState.entries.filter(
      (e) => e.httpMeta?.cached || e.message.toLowerCase().includes("[cache hit]") || e.httpMeta?.status === 304
    ).length;
  }, [state.liveState.entries]);

  const totalConsoleItems =
    state.errorState.entries.length + state.liveState.entries.length + state.traceRuns.length;

  const handleClearAll = () => {
    if (!confirmingClearAll) {
      setConfirmingClearAll(true);
      clearAllTimer.current = window.setTimeout(() => setConfirmingClearAll(false), 3000);
      return;
    }
    window.clearTimeout(clearAllTimer.current);
    setConfirmingClearAll(false);
    dispatch({ type: "CLEAR_STREAM", stream: "error" });
    dispatch({ type: "CLEAR_STREAM", stream: "live" });
    dispatch({ type: "CLEAR_TRACES" });
    setSelectedEntry(null);
    setSelectedSpan(null);
  };

  const selectStream = (stream: LogStream) => {
    dispatch({ type: "SET_ACTIVE_TAB", tab: stream });
    if (stream !== "tracing") {
      dispatch({ type: "MARK_READ", stream });
    }
  };

  const handleStreamNav = (e: React.KeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const current = STREAM_ORDER.indexOf(activeTab);
    let next = current;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = STREAM_ORDER.length - 1;
    else {
      const direction = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      next = (current + direction + STREAM_ORDER.length) % STREAM_ORDER.length;
    }
    const target = STREAM_ORDER[next];
    selectStream(target);
    requestAnimationFrame(() => {
      document.getElementById(`console-tab-${target}`)?.focus();
    });
  };

  // Panel-level shortcuts: "/" focuses search, Escape clears search / closes inspectors.
  const handleRootKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isEditable =
      ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;

    if (e.key === "/" && !isEditable && activeTab !== "tracing") {
      e.preventDefault();
      searchInputRef.current?.focus();
      return;
    }

    if (e.key === "Escape") {
      if (isEditable && currentStreamState.searchQuery) {
        dispatch({ type: "SET_SEARCH", stream: activeTab, query: "" });
        return;
      }
      if (selectedEntry) {
        setSelectedEntry(null);
        return;
      }
      if (selectedSpan) {
        setSelectedSpan(null);
      }
    }
  };

  // Arrow-key navigation across log entries.
  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button.dev-console-entry")
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1);
    if (next !== index && buttons[next]) {
      buttons[next].focus();
      e.preventDefault();
    }
  };

  const toggleStage = (stage: PipelineStage) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) {
        next.delete(stage);
      } else {
        next.add(stage);
      }
      return next;
    });
  };

  const activeTrace = useMemo<TraceRun | null>(() => {
    if (state.activeTraceRun) return state.activeTraceRun;
    if (state.traceRuns.length > 0) return state.traceRuns[0];
    return null;
  }, [state.activeTraceRun, state.traceRuns]);

  // Filtered log entries
  const filteredEntries = useMemo(() => {
    return currentStreamState.entries.filter((entry) => {
      if (currentStreamState.levelFilter !== "all" && entry.level !== currentStreamState.levelFilter) {
        return false;
      }
      if (currentStreamState.sourceFilter !== "all" && entry.source !== currentStreamState.sourceFilter) {
        return false;
      }
      if (currentStreamState.impactFilter !== "all" && (entry.impact || "info") !== currentStreamState.impactFilter) {
        return false;
      }
      if (currentStreamState.searchQuery.trim() !== "") {
        const q = currentStreamState.searchQuery.toLowerCase();
        const msgMatch = entry.message.toLowerCase().includes(q);
        const detailMatch = entry.detail?.toLowerCase().includes(q);
        const metaMatch = entry.meta ? JSON.stringify(entry.meta).toLowerCase().includes(q) : false;
        const httpMatch = entry.httpMeta ? JSON.stringify(entry.httpMeta).toLowerCase().includes(q) : false;
        if (!msgMatch && !detailMatch && !metaMatch && !httpMatch) {
          return false;
        }
      }
      return true;
    });
  }, [currentStreamState.entries, currentStreamState.levelFilter, currentStreamState.sourceFilter, currentStreamState.impactFilter, currentStreamState.searchQuery]);

  // Per-level counts for the filter pills (independent of the level filter itself).
  const levelCounts = useMemo(() => {
    const counts: Partial<Record<LogLevel | "all", number>> = { all: currentStreamState.entries.length };
    for (const entry of currentStreamState.entries) {
      counts[entry.level] = (counts[entry.level] || 0) + 1;
    }
    return counts;
  }, [currentStreamState.entries]);

  const levelOptions: Array<{ id: LogLevel | "all"; label: string }> = [
    { id: "all", label: "All Levels" },
    { id: "error", label: "Error" },
    { id: "warn", label: "Warn" },
    { id: "info", label: "Info" },
    { id: "debug", label: "Debug" },
  ];

  const impactOptions: Array<{ id: ErrorImpact | "all"; label: string }> = [
    { id: "all", label: "All Impacts" },
    { id: "fatal", label: "Fatal / Blocking" },
    { id: "degraded", label: "Degraded / Fallback" },
    { id: "recoverable", label: "Recoverable" },
  ];

  const sourceOptions: Array<{ id: LogSource | "all"; label: string }> = [
    { id: "all", label: "All Subsystems" },
    { id: "biophysics", label: "Biophysics (FoldX, ESM, DDG)" },
    { id: "genomics", label: "Genomics (VEP, MANE, Splice)" },
    { id: "structure-3d", label: "Structure 3D (PDB, Pocket, Mol*)" },
    { id: "ai-narrative", label: "AI Narrative (Gemini, ACMG)" },
    { id: "literature", label: "Literature (PubMed, LitRAG)" },
    { id: "network", label: "Network & HTTP" },
    { id: "runtime", label: "Runtime Exceptions" },
    { id: "component", label: "React Components" },
    { id: "notification", label: "Notifications" },
    { id: "system", label: "System (Worker, WebGL, Cache)" },
    { id: "console", label: "Console" },
  ];

  const getSourceBadgeClass = (source: LogSource) => {
    switch (source) {
      case "biophysics":
        return "text-[#c46849] bg-[#c46849]/10 border-[#c46849]/20";
      case "genomics":
        return "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/20";
      case "structure-3d":
        return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "ai-narrative":
        return "text-[#d946aa] bg-[#d946aa]/10 border-[#d946aa]/20";
      case "literature":
        return "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20";
      case "network":
        return "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "runtime":
      case "component":
        return "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20";
      default:
        return "text-[var(--cs-text-secondary)] bg-[var(--cs-surface-2)] border-[var(--cs-border)]";
    }
  };

  const getStageColor = (stage: PipelineStage) => {
    switch (stage) {
      case "genomics":
        return "bg-sky-500";
      case "structure":
        return "bg-emerald-500";
      case "biophysics":
        return "bg-[#c46849]";
      case "clinical":
        return "bg-[#d946aa]";
      default:
        return "bg-indigo-500";
    }
  };

  const stageLabels: Record<PipelineStage, { title: string; desc: string }> = {
    genomics: { title: "Stage 1: Genomic & cDNA Notation Translation", desc: "Ensembl VEP, MANE Select, Splice Resolver" },
    structure: { title: "Stage 2: Structural Retrieval & Cavity Detection", desc: "AlphaFold/PDB 3D fetch, Pocket Finder, FoldX Mutagenesis" },
    biophysics: { title: "Stage 3: Multi-Model Biophysics Suite", desc: "ESM-2, SaProt, DynaMut2, DDMut, ThermoMPNN, StabilityOracle" },
    clinical: { title: "Stage 4: Clinical AI Synthesis & ACMG Reasoning", desc: "ClinVar, gnomAD, Literature RAG, Gemini Clinical Narrative" },
  };

  return (
    <div
      className="flex flex-col h-full w-full bg-[var(--cs-bg)] overflow-hidden font-sans text-xs outline-none"
      tabIndex={-1}
      onKeyDown={handleRootKeyDown}
    >
      {/* ── Top Workbench Header ── */}
      <div className="p-3 border-b border-[var(--cs-border)] bg-[var(--cs-surface)] flex items-center justify-between gap-3 flex-wrap">
        {/* Segmented Stream Switcher */}
        <div
          role="tablist"
          aria-label="Console streams"
          onKeyDown={handleStreamNav}
          className="flex items-center gap-1 p-1 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-2)]"
        >
          <button
            type="button"
            id="console-tab-error"
            role="tab"
            aria-selected={activeTab === "error"}
            aria-controls="console-stream-panel"
            tabIndex={activeTab === "error" ? 0 : -1}
            onClick={() => selectStream("error")}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer font-medium ${
              activeTab === "error"
                ? "dev-console-stream-tab bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                : "dev-console-stream-tab text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
            }`}
          >
            <ShieldAlert className={`w-4 h-4 ${fatalErrorCount > 0 ? "text-rose-500" : activeTab === "error" ? "text-amber-500" : "text-[var(--cs-text-muted)]"}`} />
            <span>Error Diagnostics</span>
            {state.errorState.entries.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                fatalErrorCount > 0
                  ? "bg-rose-500 text-white"
                  : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              }`}>
                {state.errorState.entries.length}
              </span>
            )}
          </button>

          <button
            type="button"
            id="console-tab-live"
            role="tab"
            aria-selected={activeTab === "live"}
            aria-controls="console-stream-panel"
            tabIndex={activeTab === "live" ? 0 : -1}
            onClick={() => selectStream("live")}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer font-medium ${
              activeTab === "live"
                ? "dev-console-stream-tab bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                : "dev-console-stream-tab text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
            }`}
          >
            <Activity className={`w-4 h-4 ${activeTab === "live" ? "text-[#c46849]" : "text-[var(--cs-text-muted)]"}`} />
            <span>Live Events</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-[var(--cs-surface)] text-[var(--cs-text-secondary)] border border-[var(--cs-border-subtle)]">
              {state.liveState.entries.length}
            </span>
          </button>

          <button
            type="button"
            id="console-tab-tracing"
            role="tab"
            aria-selected={activeTab === "tracing"}
            aria-controls="console-stream-panel"
            tabIndex={activeTab === "tracing" ? 0 : -1}
            onClick={() => selectStream("tracing")}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer font-medium ${
              activeTab === "tracing"
                ? "dev-console-stream-tab bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                : "dev-console-stream-tab text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
            }`}
          >
            <Layers className={`w-4 h-4 ${activeTab === "tracing" ? "text-indigo-500" : "text-[var(--cs-text-muted)]"}`} />
            <span>Pipeline Waterfall</span>
            {activeTrace && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                {activeTrace.totalDurationMs}ms
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Dynamic KPI Strip */}
          <div className="flex items-center gap-2 text-[11px] font-mono">
            {activeTab === "error" && (
              <>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-[var(--cs-text-muted)]">Fatal:</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">{fatalErrorCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-[var(--cs-text-muted)]">Degraded:</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">{degradedErrorCount}</span>
                </div>
              </>
            )}

            {activeTab === "live" && (
              <>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
                  <Globe className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[var(--cs-text-muted)]">HTTP Calls:</span>
                  <span className="font-bold text-[var(--cs-text-primary)]">{apiCallCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[var(--cs-text-muted)]">Cache Hits:</span>
                  <span className="font-bold text-[var(--cs-text-primary)]">{cacheHitCount}</span>
                </div>
              </>
            )}

            {activeTab === "tracing" && activeTrace && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-[var(--cs-text-muted)]">Active Run:</span>
                <span className="font-bold text-[var(--cs-text-primary)] truncate max-w-[140px]">{activeTrace.query}</span>
              </div>
            )}
          </div>

          {/* Clear All (both log streams + traces) with two-step confirm */}
          <button
            type="button"
            onClick={handleClearAll}
            disabled={totalConsoleItems === 0}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md border font-mono text-[11px] font-semibold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              confirmingClearAll
                ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-secondary)] hover:bg-[var(--cs-bg-subtle)] hover:text-rose-600 dark:hover:text-rose-400"
            }`}
            aria-label={confirmingClearAll ? "Confirm clear all" : "Clear all console data — error stream, live stream, and pipeline traces"}
          >
            {confirmingClearAll ? <Check className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
            <span>{confirmingClearAll ? "Confirm clear all" : "Clear all"}</span>
          </button>
        </div>
      </div>

      {/* ── Multi-Dimension Filter Toolbar ── */}
      {activeTab !== "tracing" && (
        <div className="dev-console-toolbar">
          {/* Level filter pills */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
            {levelOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-active={currentStreamState.levelFilter === opt.id}
                aria-pressed={currentStreamState.levelFilter === opt.id}
                aria-label={`${opt.label}${(levelCounts[opt.id] || 0) > 0 ? ` ${levelCounts[opt.id]}` : ""}`}
                onClick={() => dispatch({ type: "SET_LEVEL_FILTER", stream: activeTab, level: opt.id })}
                className="dev-console-filter-pill"
              >
                {opt.label}
                {(levelCounts[opt.id] || 0) > 0 && (
                  <span className="dev-console-pill-count">{levelCounts[opt.id]}</span>
                )}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-[var(--cs-border)] mx-1 hidden sm:block" />

          {/* Impact filter (for Error tab) */}
          {activeTab === "error" && (
            <>
              <select
                aria-label="Filter by error impact"
                value={currentStreamState.impactFilter}
                onChange={(e) => dispatch({ type: "SET_IMPACT_FILTER", stream: activeTab, impact: e.target.value as ErrorImpact | "all" })}
                className="text-xs px-2 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
              >
                {impactOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="h-4 w-px bg-[var(--cs-border)] mx-1 hidden sm:block" />
            </>
          )}

          {/* Source filter dropdown */}
          <select
            aria-label="Filter by subsystem"
            value={currentStreamState.sourceFilter}
            onChange={(e) => dispatch({ type: "SET_SOURCE_FILTER", stream: activeTab, source: e.target.value as LogSource | "all" })}
            className="text-xs px-2 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
          >
            {sourceOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="h-4 w-px bg-[var(--cs-border)] mx-1 hidden sm:block" />

          {/* Search bar */}
          <div className="relative flex-1 min-w-[140px] max-w-[280px]">
            <Search className="w-3.5 h-3.5 text-[var(--cs-text-muted)] absolute left-2.5 top-2" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label={`Search ${activeTab} entries`}
              placeholder={`Search ${activeTab} diagnostics… (press /)`}
              value={currentStreamState.searchQuery}
              onChange={(e) => dispatch({ type: "SET_SEARCH", stream: activeTab, query: e.target.value })}
              className="w-full text-xs pl-8 pr-3 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono placeholder:text-[var(--cs-text-muted)] focus:outline-none focus:border-[var(--cs-accent-clay)]"
            />
          </div>

          <div className="flex-1" />

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => dispatch({ type: "TOGGLE_CAPTURE", stream: activeTab })}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] transition cursor-pointer"
              aria-label={currentStreamState.isCapturing ? `Pause ${activeTab} capture` : `Resume ${activeTab} capture`}
              title={currentStreamState.isCapturing ? `Pause ${activeTab} capture` : `Resume ${activeTab} capture`}
            >
              {currentStreamState.isCapturing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-amber-500" />}
            </button>

            <button
              type="button"
              disabled={currentStreamState.entries.length === 0}
              onClick={activeTab === "error" ? exportErrorEntries : exportLiveEntries}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              aria-label={`Download ${activeTab} logs as JSON`}
              title={`Download ${activeTab} logs as JSON`}
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              disabled={currentStreamState.entries.length === 0}
              onClick={() => {
                dispatch({ type: "CLEAR_STREAM", stream: activeTab });
                setSelectedEntry(null);
              }}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              aria-label={`Clear ${activeTab} stream`}
              title={`Clear ${activeTab} stream`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setCompact((c) => !c)}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] transition cursor-pointer"
              aria-label={compact ? "Switch to comfortable density" : "Switch to compact density"}
              title={compact ? "Switch to comfortable density" : "Switch to compact density"}
            >
              <Rows3 className={`w-3.5 h-3.5 ${compact ? "text-[var(--cs-accent-clay)]" : ""}`} />
            </button>

            <span className="text-[11px] text-[var(--cs-text-muted)] font-mono ml-2">
              {currentStreamState.entries.length === filteredEntries.length
                ? `${currentStreamState.entries.length} entries`
                : `${filteredEntries.length} of ${currentStreamState.entries.length}`}
            </span>
          </div>
        </div>
      )}

      {/* ── Main View Area ── */}
      <motion.div
        id="console-stream-panel"
        role="tabpanel"
        aria-labelledby={`console-tab-${activeTab}`}
        tabIndex={-1}
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex-1 min-h-0 flex flex-col outline-none"
      >
      {activeTab === "tracing" ? (
        /* ══════════════════════════════════════════════════════════
           GANTT WATERFALL TIMELINE VIEW
           ══════════════════════════════════════════════════════════ */
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
          {/* Tracing Controls Bar */}
          <div className="p-3 border-b border-[var(--cs-border)] bg-[var(--cs-surface)] flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-[var(--cs-text-secondary)]">Trace Session:</span>
              <select
                aria-label="Trace session"
                value={activeTrace?.traceId || ""}
                onChange={(e) => dispatch({ type: "SET_ACTIVE_TRACE_RUN", traceId: e.target.value })}
                className="text-xs px-2.5 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono font-medium rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
              >
                {state.traceRuns.length === 0 ? (
                  <option value="">No traces recorded yet</option>
                ) : (
                  state.traceRuns.map((r) => (
                    <option key={r.traceId} value={r.traceId}>
                      {r.query} — {new Date(r.timestamp).toLocaleTimeString()} ({r.totalDurationMs}ms)
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={state.traceRuns.length === 0}
                onClick={exportTraceRuns}
                className="cs-btn-ghost font-mono !text-[11px]"
                aria-label="Export trace runs as JSON"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Traces</span>
              </button>

              <button
                type="button"
                disabled={state.traceRuns.length === 0}
                onClick={() => {
                  dispatch({ type: "CLEAR_TRACES" });
                  setSelectedSpan(null);
                }}
                className="cs-btn-ghost font-mono !text-[11px]"
                aria-label="Clear all trace runs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Traces</span>
              </button>
            </div>
          </div>

          {!activeTrace || activeTrace.spans.length === 0 ? (
            <div className="dev-console-empty flex-1">
              <Layers className="w-12 h-12 text-[var(--cs-text-muted)] opacity-50" />
              <span className="text-sm font-semibold text-[var(--cs-text-primary)]">No Active Trace Recorded</span>
              <span className="text-xs text-[var(--cs-text-muted)] max-w-md text-center">
                Search a genomic or protein variant (e.g. <code className="font-mono px-1 py-0.5 bg-[var(--cs-surface-2)] rounded">TP53 R175H</code>) to capture real-time parallel latency spans across all 4 pipeline stages.
              </span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-y-auto">
              {(() => {
                const totalDuration = Math.max(activeTrace.totalDurationMs, 100);
                const slowestSpan = [...activeTrace.spans].sort((a, b) => b.durationMs - a.durationMs)[0];

                return (
                  <>
                    <div className="gantt-grid-header">
                      <div>Pipeline Stage / Operation</div>
                      <div>Status</div>
                      <div className="text-right">Duration</div>
                      <div className="pl-4">Waterfall Timeline (0ms → {totalDuration}ms)</div>
                    </div>

                    {/* Axis ticks aligned to the timeline column only */}
                    <div className="gantt-axis-row" aria-hidden>
                      <div />
                      <div />
                      <div />
                      <div className="pl-4">
                        <div className="gantt-axis-ticks">
                          <span>0ms</span>
                          <span>{Math.round(totalDuration * 0.25)}ms</span>
                          <span>{Math.round(totalDuration * 0.5)}ms</span>
                          <span>{Math.round(totalDuration * 0.75)}ms</span>
                          <span>{totalDuration}ms</span>
                        </div>
                      </div>
                    </div>

                    {/* Grouped by Stage */}
                    {(["genomics", "structure", "biophysics", "clinical"] as PipelineStage[]).map((stageKey) => {
                      const stageSpans = activeTrace.spans.filter((s) => s.stage === stageKey);
                      if (stageSpans.length === 0) return null;
                      const isCollapsed = collapsedStages.has(stageKey);
                      const stageTotalMs = stageSpans.reduce((sum, s) => sum + s.durationMs, 0);

                      return (
                        <div key={stageKey} className="border-b border-[var(--cs-border-subtle)]">
                          <button
                            type="button"
                            onClick={() => toggleStage(stageKey)}
                            aria-expanded={!isCollapsed}
                            className="gantt-stage-header w-full cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <ChevronDown
                                className={`w-3 h-3 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                              />
                              <span className={`w-2 h-2 rounded-full ${getStageColor(stageKey)}`} />
                              <span className="font-bold">{stageLabels[stageKey].title}</span>
                            </div>
                            <span className="text-[10px] text-[var(--cs-text-muted)]">
                              {stageLabels[stageKey].desc} · {stageSpans.length} op{stageSpans.length === 1 ? "" : "s"} · {stageTotalMs}ms
                            </span>
                          </button>

                          {!isCollapsed && stageSpans.map((span) => {
                            const leftPct = Math.min(95, Math.max(0, (span.offsetMs / totalDuration) * 100));
                            const widthPct = Math.min(100 - leftPct, Math.max(3, (span.durationMs / totalDuration) * 100));
                            const isSelected = selectedSpan?.name === span.name;
                            const isBottleneck = slowestSpan?.name === span.name && span.durationMs > 200;
                            const tooltip = `+${span.offsetMs}ms · ${span.durationMs}ms${span.cached ? " · cached" : ""}${span.error ? " · failed" : ""}`;

                            return (
                              <button
                                key={span.name}
                                type="button"
                                data-selected={isSelected}
                                onClick={() => setSelectedSpan(isSelected ? null : span)}
                                aria-label={`${span.name}, ${span.stage} stage, ${span.durationMs} milliseconds${span.cached ? ", cached" : ""}${span.error ? ", failed" : ""}`}
                                className="gantt-row w-full text-left"
                              >
                                <div className="flex items-center gap-2 truncate pr-2">
                                  <span className="font-semibold text-[var(--cs-text-primary)] truncate">{span.name}</span>
                                  {span.cached && (
                                    <span className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0">
                                      CACHED
                                    </span>
                                  )}
                                  {isBottleneck && (
                                    <span className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 shrink-0 flex items-center gap-0.5">
                                      <Flame className="w-2.5 h-2.5" /> BOTTLENECK
                                    </span>
                                  )}
                                </div>

                                <div>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                      span.status === "success"
                                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                        : span.status === "running"
                                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 animate-pulse"
                                        : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                                    }`}
                                  >
                                    {span.status.toUpperCase()}
                                  </span>
                                </div>

                                <div className="text-right font-mono font-semibold text-[var(--cs-text-secondary)]">
                                  {span.durationMs}ms
                                </div>

                                <div className="pl-4">
                                  <div className="gantt-bar-track">
                                    <div
                                      className={`gantt-bar-cell ${isSelected ? "gantt-bar-cell-selected" : ""}`}
                                      data-tip={tooltip}
                                    >
                                      <motion.div
                                        initial={{ scaleX: 0 }}
                                        animate={{ scaleX: 1 }}
                                        transition={{ duration: 0.3, ease: "easeOut" }}
                                        className={`gantt-bar origin-left ${
                                          span.status === "running" ? "gantt-bar-running" : ""
                                        } ${
                                          span.status === "failed"
                                            ? "gantt-bar-failed"
                                            : `gantt-bar-${span.stage}`
                                        }`}
                                        style={{
                                          left: `${leftPct}%`,
                                          width: `${widthPct}%`,
                                        }}
                                      >
                                        <span className="truncate">{span.durationMs}ms</span>
                                      </motion.div>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      ) : (
        /* ══════════════════════════════════════════════════════════
           LOG STREAM VIEW (ERROR & LIVE)
           ══════════════════════════════════════════════════════════ */
        <div
          role="log"
          aria-label={`${activeTab} entries`}
          onKeyDown={handleListKeyDown}
          className={`flex-1 overflow-y-auto min-h-0 divide-y divide-[var(--cs-border-subtle)] ${compact ? "dev-console-list-compact" : ""}`}
        >
          {currentStreamState.entries.length === 0 ? (
            <div className="dev-console-empty">
              {activeTab === "error" ? (
                <>
                  <ShieldAlert className="w-12 h-12 text-emerald-500/80" />
                  <span className="text-sm font-semibold text-[var(--cs-text-primary)]">Zero Active Errors</span>
                  <span className="text-xs text-[var(--cs-text-muted)] max-w-sm text-center">
                    All subsystems operational. Intercepted exceptions, failed network calls, and fallback events will stream here automatically.
                  </span>
                </>
              ) : (
                <>
                  <Activity className="w-12 h-12 text-[var(--cs-text-muted)] opacity-60" />
                  <span className="text-sm font-semibold text-[var(--cs-text-primary)]">Live Log Stream Idle</span>
                  <span className="text-xs text-[var(--cs-text-muted)] max-w-sm text-center">
                    API calls, cache events, and background worker state transitions will stream here in real time.
                  </span>
                </>
              )}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="dev-console-empty">
              <Filter className="w-10 h-10 text-[var(--cs-text-muted)] opacity-50" />
              <span className="text-sm font-semibold text-[var(--cs-text-primary)]">No entries match your active filters</span>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "SET_LEVEL_FILTER", stream: activeTab, level: "all" });
                  dispatch({ type: "SET_SOURCE_FILTER", stream: activeTab, source: "all" });
                  dispatch({ type: "SET_IMPACT_FILTER", stream: activeTab, impact: "all" });
                  dispatch({ type: "SET_SEARCH", stream: activeTab, query: "" });
                }}
                className="mt-2 px-3 py-1 text-xs rounded-md bg-[var(--cs-surface-2)] border border-[var(--cs-border)] text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition cursor-pointer font-mono"
              >
                Reset all filters
              </button>
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const isSelected = selectedEntry?.id === entry.id;
              const isFatal = entry.impact === "fatal" || (entry.level === "error" && !entry.impact);

              return (
                <button
                  key={entry.id}
                  type="button"
                  data-selected={isSelected}
                  data-impact={entry.impact}
                  onClick={() => setSelectedEntry(isSelected ? null : entry)}
                  className="dev-console-entry"
                >
                  {/* Level indicator dot */}
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${
                      isFatal
                        ? "bg-rose-500 ring-2 ring-rose-500/20"
                        : entry.level === "warn" || entry.impact === "degraded"
                        ? "bg-amber-500"
                        : entry.level === "info"
                        ? "bg-blue-500"
                        : "bg-slate-400"
                    }`}
                  />

                  {/* Message + quiet meta line */}
                  <span className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="dev-console-message">
                      {highlightText(entry.message, currentStreamState.searchQuery)}
                    </span>
                    <span className="dev-console-entry-meta">
                      <span className={`dev-console-source-tag ${getSourceBadgeClass(entry.source)}`}>
                        [{entry.source}]
                      </span>

                      {entry.impact && entry.impact !== "info" && (
                        <span className={`dev-console-impact-badge dev-console-impact-${entry.impact}`}>
                          {entry.impact}
                        </span>
                      )}

                      {entry.httpMeta?.status ? (
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold shrink-0 ${
                          entry.httpMeta.status >= 500
                            ? "bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                            : entry.httpMeta.status >= 400
                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                            : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                        }`}>
                          {entry.httpMeta.method} {entry.httpMeta.status}
                        </span>
                      ) : null}

                      {entry.count > 1 && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
                          ×{entry.count}
                        </span>
                      )}
                    </span>
                  </span>

                  {/* Relative timestamp */}
                  <span className="text-[10px] font-mono text-[var(--cs-text-muted)] shrink-0 ml-1">
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
      </motion.div>

      {/* ── Diagnostic Detail Inspector Drawer ── */}
      <AnimatePresence>
      {selectedEntry && (
        <motion.section
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 30 }}
          aria-label="Entry detail inspector"
          className="dev-console-detail-drawer shrink-0 max-h-[45vh] overflow-y-auto flex flex-col border-t border-[var(--cs-border)] bg-[var(--cs-surface)]"
        >
          {/* Inspector Header */}
          <div className="p-3 border-b border-[var(--cs-border)] bg-[var(--cs-surface-2)] flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={`dev-console-source-tag ${getSourceBadgeClass(selectedEntry.source)}`}>
                {selectedEntry.source}
              </span>
              <span className="font-mono text-xs font-bold uppercase text-[var(--cs-text-primary)]">
                {selectedEntry.level}
              </span>
              {selectedEntry.impact && (
                <span className={`dev-console-impact-badge dev-console-impact-${selectedEntry.impact}`}>
                  {selectedEntry.impact}
                </span>
              )}
              <span className="text-xs font-mono text-[var(--cs-text-muted)]">
                ({new Date(selectedEntry.timestamp).toLocaleTimeString()})
              </span>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopyMarkdownReport(selectedEntry)}
                className="cs-btn-ghost font-mono !text-[11px]"
                title="Copy as GitHub/Markdown Bug Report"
              >
                {copiedAction === "markdown" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <FileText className="w-3.5 h-3.5 text-indigo-500" />}
                <span>{copiedAction === "markdown" ? "Copied Report" : "Copy Report"}</span>
              </button>

              {selectedEntry.httpMeta?.url && (
                <button
                  type="button"
                  onClick={() => handleCopyCurl(selectedEntry)}
                  className="cs-btn-ghost font-mono !text-[11px]"
                  title="Copy as cURL command"
                >
                  {copiedAction === "curl" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Terminal className="w-3.5 h-3.5 text-blue-500" />}
                  <span>{copiedAction === "curl" ? "Copied cURL" : "Copy cURL"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => copyToClipboard(JSON.stringify(selectedEntry, null, 2), "json")}
                className="cs-btn-ghost font-mono !text-[11px]"
                title="Copy raw JSON entry"
              >
                {copiedAction === "json" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAction === "json" ? "Copied JSON" : "Copy JSON"}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                aria-label="Close entry inspector"
                className="p-1 rounded text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Inspector Sub-Tabs */}
          <div className="flex items-center gap-2 px-4 border-b border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] text-xs font-mono">
            <button
              type="button"
              onClick={() => setInspectorTab("overview")}
              aria-selected={inspectorTab === "overview"}
              className={`py-2 px-1 border-b-2 font-medium transition cursor-pointer ${
                inspectorTab === "overview"
                  ? "border-[var(--cs-accent-clay)] text-[var(--cs-text-primary)] font-bold"
                  : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
              }`}
            >
              Overview &amp; Payload
            </button>

            {selectedEntry.detail && (
              <button
                type="button"
                onClick={() => setInspectorTab("stack")}
                aria-selected={inspectorTab === "stack"}
                className={`py-2 px-1 border-b-2 font-medium transition cursor-pointer ${
                  inspectorTab === "stack"
                    ? "border-[var(--cs-accent-clay)] text-[var(--cs-text-primary)] font-bold"
                    : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
                }`}
              >
                Stack Trace
              </button>
            )}

            {selectedEntry.httpMeta && (
              <button
                type="button"
                onClick={() => setInspectorTab("http")}
                aria-selected={inspectorTab === "http"}
                className={`py-2 px-1 border-b-2 font-medium transition cursor-pointer ${
                  inspectorTab === "http"
                    ? "border-[var(--cs-accent-clay)] text-[var(--cs-text-primary)] font-bold"
                    : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
                }`}
              >
                HTTP Details
              </button>
            )}

            {selectedEntry.sessionContext && (
              <button
                type="button"
                onClick={() => setInspectorTab("session")}
                aria-selected={inspectorTab === "session"}
                className={`py-2 px-1 border-b-2 font-medium transition cursor-pointer ${
                  inspectorTab === "session"
                    ? "border-[var(--cs-accent-clay)] text-[var(--cs-text-primary)] font-bold"
                    : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
                }`}
              >
                Session Context
              </button>
            )}
          </div>

          {/* Inspector Tab Content */}
          <div className="p-4 space-y-3 font-mono text-xs overflow-y-auto">
            {inspectorTab === "overview" && (
              <>
                <div className="p-3 rounded-lg border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] whitespace-pre-wrap break-words leading-relaxed font-semibold">
                  {selectedEntry.message}
                </div>

                {selectedEntry.meta && Object.keys(selectedEntry.meta).length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-[var(--cs-text-muted)] uppercase tracking-wider">
                      Metadata Attributes
                    </span>
                    <table className="dev-console-meta-table border border-[var(--cs-border-subtle)] rounded overflow-hidden">
                      <tbody>
                        {Object.entries(selectedEntry.meta).map(([k, v]) => (
                          <tr key={k}>
                            <td>{k}</td>
                            <td className="break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {inspectorTab === "stack" && selectedEntry.detail && (
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-[var(--cs-text-muted)] uppercase tracking-wider">
                  Exception Stack Trace / Diagnostic Output
                </span>
                <pre className="dev-console-stack-trace">{selectedEntry.detail}</pre>
              </div>
            )}

            {inspectorTab === "http" && selectedEntry.httpMeta && (
              <div className="space-y-3">
                <table className="dev-console-meta-table border border-[var(--cs-border-subtle)] rounded overflow-hidden">
                  <tbody>
                    <tr>
                      <td>Endpoint</td>
                      <td className="font-semibold text-blue-600 dark:text-blue-400 break-all">{selectedEntry.httpMeta.method} {selectedEntry.httpMeta.url}</td>
                    </tr>
                    <tr>
                      <td>Status Code</td>
                      <td>{selectedEntry.httpMeta.status} {selectedEntry.httpMeta.statusText}</td>
                    </tr>
                    <tr>
                      <td>Roundtrip Latency</td>
                      <td>{selectedEntry.httpMeta.durationMs}ms</td>
                    </tr>
                  </tbody>
                </table>

                {Boolean(selectedEntry.httpMeta.responseBody) && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-[var(--cs-text-muted)] uppercase tracking-wider">
                      Server Response Body
                    </span>
                    <pre className="dev-console-stack-trace">
                      {typeof selectedEntry.httpMeta.responseBody === "object"
                        ? JSON.stringify(selectedEntry.httpMeta.responseBody, null, 2)
                        : String(selectedEntry.httpMeta.responseBody)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {inspectorTab === "session" && selectedEntry.sessionContext && (
              <table className="dev-console-meta-table border border-[var(--cs-border-subtle)] rounded overflow-hidden">
                <tbody>
                  {selectedEntry.sessionContext.gene && (
                    <tr>
                      <td>Active Gene</td>
                      <td className="font-bold">{selectedEntry.sessionContext.gene}</td>
                    </tr>
                  )}
                  {selectedEntry.sessionContext.variant && (
                    <tr>
                      <td>Active Variant</td>
                      <td className="font-bold text-[#d946aa]">{selectedEntry.sessionContext.variant}</td>
                    </tr>
                  )}
                  {selectedEntry.sessionContext.uniprotId && (
                    <tr>
                      <td>UniProt Accession</td>
                      <td>{selectedEntry.sessionContext.uniprotId}</td>
                    </tr>
                  )}
                  {selectedEntry.sessionContext.memoryMB && (
                    <tr>
                      <td>Browser JS Heap</td>
                      <td>~{selectedEntry.sessionContext.memoryMB} MB</td>
                    </tr>
                  )}
                  <tr>
                    <td>Network Connection</td>
                    <td>{selectedEntry.sessionContext.online !== false ? "Online" : "Offline"}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </motion.section>
      )}
      </AnimatePresence>

      {/* ── Span Detail Inspector (When in Tracing tab) ── */}
      <AnimatePresence>
      {selectedSpan && activeTab === "tracing" && (
        <motion.section
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 30 }}
          aria-label="Span detail inspector"
          className="p-4 border-t border-[var(--cs-border)] bg-[var(--cs-surface)] font-mono text-xs flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${getStageColor(selectedSpan.stage)}`} />
              <span className="font-bold text-sm text-[var(--cs-text-primary)]">{selectedSpan.name}</span>
              <span className="text-[var(--cs-text-muted)]">({selectedSpan.durationMs}ms duration)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyToClipboard(JSON.stringify(selectedSpan, null, 2), "span")}
                className="cs-btn-ghost font-mono !text-[11px]"
                title="Copy span as JSON"
              >
                {copiedAction === "span" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAction === "span" ? "Copied span" : "Copy span"}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedSpan(null)}
                aria-label="Close span inspector"
                className="p-1 rounded text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <table className="dev-console-meta-table border border-[var(--cs-border-subtle)] rounded overflow-hidden">
            <tbody>
              <tr>
                <td>Pipeline Stage</td>
                <td className="font-bold capitalize">{selectedSpan.stage}</td>
              </tr>
              <tr>
                <td>Execution Status</td>
                <td>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    selectedSpan.status === "success" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                  }`}>
                    {selectedSpan.status.toUpperCase()}
                  </span>
                </td>
              </tr>
              <tr>
                <td>Timeline Offset</td>
                <td>+{selectedSpan.offsetMs}ms from pipeline initiation</td>
              </tr>
              <tr>
                <td>Duration Latency</td>
                <td>{selectedSpan.durationMs}ms</td>
              </tr>
              {selectedSpan.cached && (
                <tr>
                  <td>Cache State</td>
                  <td className="text-amber-600 font-bold">Reported cache hit</td>
                </tr>
              )}
              {selectedSpan.error && (
                <tr>
                  <td>Error Reason</td>
                  <td className="text-rose-600 font-bold">{selectedSpan.error}</td>
                </tr>
              )}
            </tbody>
          </table>
        </motion.section>
      )}
      </AnimatePresence>
    </div>
  );
}
