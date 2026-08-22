import React, { useState, useEffect, useMemo } from "react";
import {
  Terminal, Search, Pause, Play, Download, Trash2, X, Copy, Check, Activity,
  ShieldAlert, Zap, AlertTriangle, Filter, ChevronRight, Layers, Clock,
  Cpu, FileText, Globe, Server, Database, Sparkles, BookOpen, Bug, Flame, RefreshCw
} from "lucide-react";
import { useDevConsole } from "../context/DevConsoleContext";
import { ConsoleEntry, LogLevel, LogSource, LogStream, ErrorImpact, TraceRun, TraceSpan, PipelineStage } from "../types/devConsole";

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

  // Update relative timestamps every 10s
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);

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
    return state.liveState.entries.filter((e) => e.message.toLowerCase().includes("[cache hit]") || e.message.includes("304")).length;
  }, [state.liveState.entries]);

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
    <div className="flex flex-col h-full w-full bg-[var(--cs-bg)] overflow-hidden font-sans text-xs">
      {/* ── Top Workbench Header ── */}
      <div className="p-3 border-b border-[var(--cs-border)] bg-[var(--cs-surface)] flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Segmented Stream Switcher */}
          <div className="flex items-center gap-1 p-1 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "SET_ACTIVE_TAB", tab: "error" });
                dispatch({ type: "MARK_READ", stream: "error" });
              }}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer font-medium ${
                activeTab === "error"
                  ? "bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                  : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
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
              onClick={() => {
                dispatch({ type: "SET_ACTIVE_TAB", tab: "live" });
                dispatch({ type: "MARK_READ", stream: "live" });
              }}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer font-medium ${
                activeTab === "live"
                  ? "bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                  : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
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
              onClick={() => dispatch({ type: "SET_ACTIVE_TAB", tab: "tracing" })}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer font-medium ${
                activeTab === "tracing"
                  ? "bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                  : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
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
                onClick={() => dispatch({ type: "SET_LEVEL_FILTER", stream: activeTab, level: opt.id })}
                className="dev-console-filter-pill"
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-[var(--cs-border)] mx-1 hidden sm:block" />

          {/* Impact filter (for Error tab) */}
          {activeTab === "error" && (
            <>
              <select
                value={currentStreamState.impactFilter}
                onChange={(e) => dispatch({ type: "SET_IMPACT_FILTER", stream: activeTab, impact: e.target.value as ErrorImpact | "all" })}
                className="text-xs px-2 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono focus:outline-none"
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
            value={currentStreamState.sourceFilter}
            onChange={(e) => dispatch({ type: "SET_SOURCE_FILTER", stream: activeTab, source: e.target.value as LogSource | "all" })}
            className="text-xs px-2 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono focus:outline-none"
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
              type="text"
              placeholder={`Search ${activeTab} diagnostics...`}
              value={currentStreamState.searchQuery}
              onChange={(e) => dispatch({ type: "SET_SEARCH", stream: activeTab, query: e.target.value })}
              className="w-full text-xs pl-8 pr-3 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono placeholder:text-[var(--cs-text-muted)] focus:outline-none"
            />
          </div>

          <div className="flex-1" />

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => dispatch({ type: "TOGGLE_CAPTURE", stream: activeTab })}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] transition cursor-pointer"
              title={currentStreamState.isCapturing ? `Pause ${activeTab} capture` : `Resume ${activeTab} capture`}
            >
              {currentStreamState.isCapturing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-amber-500" />}
            </button>

            <button
              type="button"
              disabled={currentStreamState.entries.length === 0}
              onClick={activeTab === "error" ? exportErrorEntries : exportLiveEntries}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
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
              title={`Clear ${activeTab} stream`}
            >
              <Trash2 className="w-3.5 h-3.5" />
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
                value={activeTrace?.traceId || ""}
                onChange={(e) => dispatch({ type: "SET_ACTIVE_TRACE_RUN", traceId: e.target.value })}
                className="text-xs px-2.5 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] font-mono font-medium focus:outline-none"
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
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-secondary)] hover:bg-[var(--cs-bg-subtle)] disabled:opacity-40 transition cursor-pointer font-mono text-[11px]"
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
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-secondary)] hover:bg-[var(--cs-bg-subtle)] disabled:opacity-40 transition cursor-pointer font-mono text-[11px]"
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
              {/* Timeline Header Axis */}
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

                    <div className="gantt-axis-ticks">
                      <span>0ms</span>
                      <span>{Math.round(totalDuration * 0.25)}ms</span>
                      <span>{Math.round(totalDuration * 0.5)}ms</span>
                      <span>{Math.round(totalDuration * 0.75)}ms</span>
                      <span>{totalDuration}ms</span>
                    </div>

                    {/* Grouped by Stage */}
                    {(["genomics", "structure", "biophysics", "clinical"] as PipelineStage[]).map((stageKey) => {
                      const stageSpans = activeTrace.spans.filter((s) => s.stage === stageKey);
                      if (stageSpans.length === 0) return null;

                      return (
                        <div key={stageKey} className="border-b border-[var(--cs-border-subtle)]">
                          <div className="gantt-stage-header">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${getStageColor(stageKey)}`} />
                              <span className="font-bold">{stageLabels[stageKey].title}</span>
                            </div>
                            <span className="text-[10px] text-[var(--cs-text-muted)]">{stageLabels[stageKey].desc}</span>
                          </div>

                          {stageSpans.map((span) => {
                            const leftPct = Math.min(95, Math.max(0, (span.offsetMs / totalDuration) * 100));
                            const widthPct = Math.min(100 - leftPct, Math.max(3, (span.durationMs / totalDuration) * 100));
                            const isSelected = selectedSpan?.name === span.name;
                            const isBottleneck = slowestSpan?.name === span.name && span.durationMs > 200;

                            return (
                              <div
                                key={span.name}
                                data-selected={isSelected}
                                onClick={() => setSelectedSpan(isSelected ? null : span)}
                                className="gantt-row"
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
                                      className={`gantt-bar ${
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
                                    </div>
                                  </div>
                                </div>
                              </div>
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
        <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-[var(--cs-border-subtle)]">
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

                  {/* Impact Tag (if error) */}
                  {entry.impact && entry.impact !== "info" && (
                    <span className={`dev-console-impact-badge dev-console-impact-${entry.impact}`}>
                      {entry.impact}
                    </span>
                  )}

                  {/* Source Tag */}
                  <span className={`dev-console-source-tag ${getSourceBadgeClass(entry.source)}`}>
                    [{entry.source}]
                  </span>

                  {/* HTTP Status badge if network */}
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

                  {/* Message */}
                  <span className="dev-console-message flex-1">{entry.message}</span>

                  {/* Count badge */}
                  {entry.count > 1 && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
                      ×{entry.count}
                    </span>
                  )}

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

      {/* ── Diagnostic Detail Inspector Drawer ── */}
      {selectedEntry && (
        <div className="dev-console-detail-drawer shrink-0 max-h-[45vh] overflow-y-auto flex flex-col border-t border-[var(--cs-border)] bg-[var(--cs-surface)]">
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
                className="flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition cursor-pointer"
                title="Copy as GitHub/Markdown Bug Report"
              >
                {copiedAction === "markdown" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <FileText className="w-3.5 h-3.5 text-indigo-500" />}
                <span>{copiedAction === "markdown" ? "Copied Report!" : "Copy Report"}</span>
              </button>

              {selectedEntry.httpMeta?.url && (
                <button
                  type="button"
                  onClick={() => handleCopyCurl(selectedEntry)}
                  className="flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition cursor-pointer"
                  title="Copy as cURL command"
                >
                  {copiedAction === "curl" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Terminal className="w-3.5 h-3.5 text-blue-500" />}
                  <span>{copiedAction === "curl" ? "Copied cURL!" : "Copy cURL"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => copyToClipboard(JSON.stringify(selectedEntry, null, 2), "json")}
                className="flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition cursor-pointer"
              >
                {copiedAction === "json" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAction === "json" ? "Copied JSON!" : "Copy JSON"}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
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
              className={`py-2 px-1 border-b-2 font-medium transition cursor-pointer ${
                inspectorTab === "overview"
                  ? "border-[var(--cs-accent-clay)] text-[var(--cs-text-primary)] font-bold"
                  : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
              }`}
            >
              Overview & Payload
            </button>

            {selectedEntry.detail && (
              <button
                type="button"
                onClick={() => setInspectorTab("stack")}
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
        </div>
      )}

      {/* ── Span Detail Inspector (When in Tracing tab) ── */}
      {selectedSpan && activeTab === "tracing" && (
        <div className="p-4 border-t border-[var(--cs-border)] bg-[var(--cs-surface)] font-mono text-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${getStageColor(selectedSpan.stage)}`} />
              <span className="font-bold text-sm text-[var(--cs-text-primary)]">{selectedSpan.name}</span>
              <span className="text-[var(--cs-text-muted)]">({selectedSpan.durationMs}ms duration)</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSpan(null)}
              className="p-1 rounded text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>
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
                  <td className="text-amber-600 font-bold">Fast Cache Hit (&lt;40ms)</td>
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
        </div>
      )}
    </div>
  );
}
