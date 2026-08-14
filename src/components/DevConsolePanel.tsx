import React, { useState, useEffect, useMemo } from "react";
import {
  Terminal, Search, Pause, Play, Download, Trash2, X, Copy, Check, Activity, ShieldAlert, Zap, AlertTriangle, Filter
} from "lucide-react";
import { useDevConsole } from "../context/DevConsoleContext";
import { ConsoleEntry, LogLevel, LogSource, LogStream } from "../types/devConsole";

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
  const { state, dispatch, exportErrorEntries, exportLiveEntries } = useDevConsole();
  const activeTab = state.activeTab;
  const currentStreamState = activeTab === "error" ? state.errorState : state.liveState;

  const [selectedEntry, setSelectedEntry] = useState<ConsoleEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);

  // Update relative timestamps every 10s
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);

  const handleCopyJson = (entry: ConsoleEntry) => {
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeStream = activeTab;

  const cacheHitCount = useMemo(() => {
    return state.liveState.entries.filter((e) => e.message.toLowerCase().includes("[cache hit]") || e.message.includes("304")).length;
  }, [state.liveState.entries]);

  const apiCallCount = useMemo(() => {
    return state.liveState.entries.filter((e) => e.message.includes("/api/v1/")).length;
  }, [state.liveState.entries]);

  const errorAlertCount = useMemo(() => {
    return state.errorState.entries.filter((e) => e.level === "error" || e.level === "warn").length;
  }, [state.errorState.entries]);

  const filteredEntries = useMemo(() => {
    return currentStreamState.entries.filter((entry) => {
      if (currentStreamState.levelFilter !== "all" && entry.level !== currentStreamState.levelFilter) {
        return false;
      }
      if (currentStreamState.sourceFilter !== "all" && entry.source !== currentStreamState.sourceFilter) {
        return false;
      }
      if (currentStreamState.searchQuery.trim() !== "") {
        const q = currentStreamState.searchQuery.toLowerCase();
        const msgMatch = entry.message.toLowerCase().includes(q);
        const detailMatch = entry.detail?.toLowerCase().includes(q);
        const metaMatch = entry.meta ? JSON.stringify(entry.meta).toLowerCase().includes(q) : false;
        if (!msgMatch && !detailMatch && !metaMatch) {
          return false;
        }
      }
      return true;
    });
  }, [currentStreamState.entries, currentStreamState.levelFilter, currentStreamState.sourceFilter, currentStreamState.searchQuery]);

  const levelOptions: Array<{ id: LogLevel | "all"; label: string }> = [
    { id: "all", label: "All" },
    { id: "error", label: "Error" },
    { id: "warn", label: "Warn" },
    { id: "info", label: "Info" },
    { id: "debug", label: "Debug" },
  ];

  const sourceOptions: Array<{ id: LogSource | "all"; label: string }> = [
    { id: "all", label: "All Sources" },
    { id: "runtime", label: "Runtime" },
    { id: "console", label: "Console" },
    { id: "network", label: "Network" },
    { id: "component", label: "Component" },
    { id: "workflow", label: "Workflow" },
    { id: "notification", label: "Notification" },
  ];

  const getLevelDotColor = (level: LogLevel) => {
    switch (level) {
      case "error":
        return "var(--cs-text-danger, #ef4444)";
      case "warn":
        return "var(--cs-text-warning, #f59e0b)";
      case "info":
        return "var(--cs-info, #3b82f6)";
      case "debug":
        return "var(--cs-text-muted, #94a3b8)";
      default:
        return "var(--cs-text-muted, #94a3b8)";
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--cs-surface)] overflow-hidden">
      {/* ── Dual Stream Layout Switcher ── */}
      <div className="p-3 border-b border-[var(--cs-border)] bg-[var(--cs-surface-2)] flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Main Tab Buttons */}
          <div className="flex items-center gap-1 p-1 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-bg-subtle)]">
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "SET_ACTIVE_TAB", tab: "error" });
                dispatch({ type: "MARK_READ", stream: "error" });
              }}
              className={`px-3.5 py-1.5 text-xs rounded-md transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === "error"
                  ? "bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                  : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent font-medium"
              }`}
            >
              <ShieldAlert className={`w-3.5 h-3.5 ${activeTab === "error" ? "text-rose-500" : "text-[var(--cs-text-muted)]"}`} />
              <span>Error Console</span>
              {state.errorState.entries.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                  activeTab === "error"
                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                    : "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)]"
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
              className={`px-3.5 py-1.5 text-xs rounded-md transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === "live"
                  ? "bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                  : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent font-medium"
              }`}
            >
              <Activity className={`w-3.5 h-3.5 ${activeTab === "live" ? "text-[var(--cs-accent-clay)]" : "text-[var(--cs-text-muted)]"}`} />
              <span>Live Log Stream</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                activeTab === "live"
                  ? "bg-[var(--cs-accent-clay)]/10 text-[var(--cs-accent-clay)] border border-[var(--cs-accent-clay)]/20"
                  : "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)]"
              }`}>
                {state.liveState.entries.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                dispatch({ type: "SET_ACTIVE_TAB", tab: "tracing" });
              }}
              className={`px-3.5 py-1.5 text-xs rounded-md transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === "tracing"
                  ? "bg-[var(--cs-surface)] text-[var(--cs-text-primary)] font-semibold shadow-xs border border-[var(--cs-border)]"
                  : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent font-medium"
              }`}
            >
              <Activity className={`w-3.5 h-3.5 ${activeTab === "tracing" ? "text-indigo-500" : "text-[var(--cs-text-muted)]"}`} />
              <span>Pipeline Tracing</span>
            </button>
          </div>

          {/* KPI Strip */}
          <div className="flex items-center gap-2.5 text-[11px] font-mono">
            {activeTab === "live" ? (
              <>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface)]" title="API requests logged">
                  <Activity className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[var(--cs-text-muted)]">API Calls:</span>
                  <span className="font-bold text-[var(--cs-text-primary)]">{apiCallCount}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface)]" title="Cached responses count">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[var(--cs-text-muted)]">Cache Hits:</span>
                  <span className="font-bold text-[var(--cs-text-primary)]">{cacheHitCount}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface)]" title="Total captured errors and warnings">
                <AlertTriangle className={`w-3.5 h-3.5 ${errorAlertCount > 0 ? "text-rose-500 animate-pulse" : "text-[var(--cs-text-muted)]"}`} />
                <span className="text-[var(--cs-text-muted)]">Active Issues:</span>
                <span className={`font-bold ${errorAlertCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-[var(--cs-text-primary)]"}`}>
                  {errorAlertCount}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* ── Toolbar ── */}
      {activeTab !== "tracing" && (
        <div className="dev-console-toolbar">
          {/* Level filter pills */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
            {levelOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-active={currentStreamState.levelFilter === opt.id}
                onClick={() => dispatch({ type: "SET_LEVEL_FILTER", stream: activeStream, level: opt.id })}
                className="dev-console-filter-pill"
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-[var(--cs-border)] mx-1 hidden sm:block" />

          {/* Source filter dropdown */}
          <select
            value={currentStreamState.sourceFilter}
            onChange={(e) => dispatch({ type: "SET_SOURCE_FILTER", stream: activeStream, source: e.target.value as LogSource | "all" })}
            className="text-xs px-2 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] focus:outline-none"
          >
            {sourceOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="h-4 w-px bg-[var(--cs-border)] mx-1 hidden sm:block" />

          {/* Search bar */}
          <div className="relative flex-1 min-w-[120px] max-w-[280px]">
            <Search className="w-3.5 h-3.5 text-[var(--cs-text-muted)] absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder={`Search ${activeTab} logs...`}
              value={currentStreamState.searchQuery}
              onChange={(e) => dispatch({ type: "SET_SEARCH", stream: activeStream, query: e.target.value })}
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded border border-[var(--cs-border)] bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] placeholder:text-[var(--cs-text-muted)] focus:outline-none"
            />
          </div>

          <div className="flex-1" />

          {/* Capture Controls */}
          <div className="flex items-center gap-1">
            {/* Pause */}
            <button
              type="button"
              onClick={() => dispatch({ type: "TOGGLE_CAPTURE", stream: activeStream })}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] transition cursor-pointer"
              title={currentStreamState.isCapturing ? `Pause ${activeTab} capture` : `Resume ${activeTab} capture`}
            >
              {currentStreamState.isCapturing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 text-amber-500" />}
            </button>

            {/* Export */}
            <button
              type="button"
              disabled={currentStreamState.entries.length === 0}
              onClick={activeTab === "error" ? exportErrorEntries : exportLiveEntries}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              title={`Download ${activeTab} logs (JSON)`}
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Clear */}
            <button
              type="button"
              disabled={currentStreamState.entries.length === 0}
              onClick={() => {
                dispatch({ type: "CLEAR_STREAM", stream: activeStream });
                setSelectedEntry(null);
              }}
              className="p-1.5 rounded hover:bg-[var(--cs-bg-subtle)] text-[var(--cs-text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              title={`Clear ${activeTab} stream`}
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Entry count */}
            <span className="text-xs text-[var(--cs-text-muted)] font-mono ml-2">
              {currentStreamState.entries.length === filteredEntries.length
                ? `${currentStreamState.entries.length} entries`
                : `${filteredEntries.length} of ${currentStreamState.entries.length}`}
            </span>
          </div>
        </div>
      )}

      {/* ── Pause Banner ── */}
      {activeTab !== "tracing" && !currentStreamState.isCapturing && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-2 shrink-0">
          <Pause className="w-3.5 h-3.5" />
          <span>{activeTab === "error" ? "Error capture paused" : "Live stream paused"} — new entries in this tab are not being recorded.</span>
        </div>
      )}

      {/* ── Main Log List / Empty State / Tracing Waterfall ── */}
      {activeTab === "tracing" ? (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4" style={{ background: "var(--cs-bg)" }}>
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div>
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider" style={{ color: "var(--cs-text-primary)" }}>Pipeline Trace Waterfall</h3>
              <p className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>Real-time latency metrics for variant translation, structure fetches, biophysical jobs, and narrative generation.</p>
            </div>
            <button
              onClick={() => dispatch({ type: "CLEAR_TELEMETRY" })}
              className="text-[10px] font-bold px-2 py-1 border rounded transition-colors cursor-pointer"
              style={{ borderColor: "var(--cs-border)", background: "var(--cs-surface-2)", color: "var(--cs-text-secondary)" }}
            >
              Clear Traces
            </button>
          </div>

          {state.telemetrySpans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl" style={{ borderColor: "var(--cs-border)" }}>
              <Activity className="w-8 h-8 mb-2 opacity-40" style={{ color: "var(--cs-text-muted)" }} />
              <h4 className="text-xs font-semibold" style={{ color: "var(--cs-text-primary)" }}>No Traces Recorded</h4>
              <p className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>Run a variant search or trigger structural calculations to capture latency spans.</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* KPI metrics */}
              {(() => {
                const totalDuration = state.telemetrySpans.reduce((sum, s) => sum + s.durationMs, 0);
                const maxSpan = Math.max(...state.telemetrySpans.map(s => s.durationMs), 1);
                
                return (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg border bg-[var(--cs-surface-2)]" style={{ borderColor: "var(--cs-border-subtle)" }}>
                        <span className="text-[9px] font-mono uppercase tracking-wider block" style={{ color: "var(--cs-text-muted)" }}>Recorded Spans</span>
                        <span className="text-sm font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>{state.telemetrySpans.length}</span>
                      </div>
                      <div className="p-3 rounded-lg border bg-[var(--cs-surface-2)]" style={{ borderColor: "var(--cs-border-subtle)" }}>
                        <span className="text-[9px] font-mono uppercase tracking-wider block" style={{ color: "var(--cs-text-muted)" }}>Max Span Latency</span>
                        <span className="text-sm font-bold font-mono text-indigo-500">{maxSpan}ms</span>
                      </div>
                      <div className="p-3 rounded-lg border bg-[var(--cs-surface-2)]" style={{ borderColor: "var(--cs-border-subtle)" }}>
                        <span className="text-[9px] font-mono uppercase tracking-wider block" style={{ color: "var(--cs-text-muted)" }}>Cumulative Duration</span>
                        <span className="text-sm font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>{totalDuration}ms</span>
                      </div>
                    </div>

                    <div className="border rounded-xl bg-[var(--cs-surface-2)] overflow-hidden" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <div className="grid grid-cols-12 gap-4 bg-[var(--cs-surface-3)] px-4 py-2 border-b text-[10px] font-bold font-mono uppercase tracking-wider" style={{ borderColor: "var(--cs-border-subtle)", color: "var(--cs-text-muted)" }}>
                        <div className="col-span-5">Span / Operation</div>
                        <div className="col-span-2">Status</div>
                        <div className="col-span-1.5 text-right">Duration</div>
                        <div className="col-span-3.5 pl-4">Timeline (Gantt)</div>
                      </div>

                      <div className="divide-y" style={{ borderColor: "var(--cs-border-subtle)" }}>
                        {state.telemetrySpans.map((span, idx) => {
                          const widthPct = Math.min(100, Math.max(2, (span.durationMs / maxSpan) * 100));
                          const isSuccess = span.status === "success";
                          
                          return (
                            <div key={idx} className="grid grid-cols-12 gap-4 px-4 py-3 items-center text-xs hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                              <div className="col-span-5 font-semibold" style={{ color: "var(--cs-text-primary)" }}>{span.name}</div>
                              <div className="col-span-2">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${isSuccess ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/10" : "bg-rose-500/10 text-rose-500 border border-rose-500/10"}`}>
                                  {isSuccess ? "Success" : "Failed"}
                                </span>
                              </div>
                              <div className="col-span-1.5 font-mono font-medium text-right pr-2" style={{ color: "var(--cs-text-secondary)" }}>{span.durationMs}ms</div>
                              <div className="col-span-3.5 pl-4">
                                <div className="w-full h-2 rounded bg-black/10 dark:bg-white/10 overflow-hidden">
                                  <div 
                                    className="h-full rounded bg-indigo-500/80 transition-all duration-300"
                                    style={{ width: `${widthPct}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
        {currentStreamState.entries.length === 0 ? (
          <div className="dev-console-empty">
            {activeTab === "error" ? (
              <>
                <ShieldAlert className="w-12 h-12 text-emerald-500/60 opacity-80" />
                <span className="text-sm font-medium text-[var(--cs-text-primary)]">Zero errors detected</span>
                <span className="text-xs text-[var(--cs-text-muted)] max-w-sm">
                  System operational. Console errors, warnings, runtime exceptions, and failed network calls will appear here automatically.
                </span>
              </>
            ) : (
              <>
                <Activity className="w-12 h-12 text-[var(--cs-text-muted)] opacity-60" />
                <span className="text-sm font-medium text-[var(--cs-text-primary)]">Live stream idle</span>
                <span className="text-xs text-[var(--cs-text-muted)] max-w-sm">
                  Real-time pipeline logs, API requests, notifications, and workflow events will stream here as you interact with the explorer.
                </span>
              </>
            )}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="dev-console-empty">
            <Filter className="w-10 h-10 text-[var(--cs-text-muted)] opacity-50" />
            <span className="text-sm font-medium text-[var(--cs-text-primary)]">No entries match your filters</span>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "SET_LEVEL_FILTER", stream: activeStream, level: "all" });
                dispatch({ type: "SET_SOURCE_FILTER", stream: activeStream, source: "all" });
                dispatch({ type: "SET_SEARCH", stream: activeStream, query: "" });
              }}
              className="mt-2 px-3 py-1 text-xs rounded-md bg-[var(--cs-surface-2)] border border-[var(--cs-border)] text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition cursor-pointer"
            >
              Reset filters
            </button>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isSelected = selectedEntry?.id === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                data-selected={isSelected}
                onClick={() => setSelectedEntry(isSelected ? null : entry)}
                className="dev-console-entry"
              >
                {/* Level Dot */}
                <span
                  className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                  style={{ background: getLevelDotColor(entry.level) }}
                />

                {/* Source Tag */}
                <span className="dev-console-source-tag">[{entry.source}]</span>

                {/* Message */}
                <span className="dev-console-message flex-1">{entry.message}</span>

                {/* Count Badge */}
                {entry.count > 1 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
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

      {/* ── Detail Drawer ── */}
      {selectedEntry && (
        <div className="dev-console-detail-drawer shrink-0 max-h-[40vh] overflow-y-auto flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: getLevelDotColor(selectedEntry.level) }}
              />
              <span className="font-mono text-xs font-semibold uppercase text-[var(--cs-text-primary)]">
                {selectedEntry.level} · {selectedEntry.source}
              </span>
              <span className="text-xs text-[var(--cs-text-muted)] font-mono">
                ({new Date(selectedEntry.timestamp).toLocaleTimeString()})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopyJson(selectedEntry)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied!" : "Copy JSON"}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="p-1 rounded text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Full Message */}
          <div className="font-mono text-xs text-[var(--cs-text-primary)] whitespace-pre-wrap break-words bg-[var(--cs-surface)] p-2.5 rounded border border-[var(--cs-border-subtle)]">
            {selectedEntry.message}
          </div>

          {/* Stack trace */}
          {selectedEntry.detail && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[var(--cs-text-muted)] uppercase tracking-wider font-mono">
                Stack / Detail
              </span>
              <pre className="dev-console-stack-trace">{selectedEntry.detail}</pre>
            </div>
          )}

          {/* Metadata table */}
          {selectedEntry.meta && Object.keys(selectedEntry.meta).length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[var(--cs-text-muted)] uppercase tracking-wider font-mono">
                Metadata
              </span>
              <table className="dev-console-meta-table bg-[var(--cs-surface)] rounded border border-[var(--cs-border-subtle)] overflow-hidden">
                <tbody>
                  {Object.entries(selectedEntry.meta).map(([key, val]) => (
                    <tr key={key}>
                      <td>{key}</td>
                      <td>{typeof val === "object" ? JSON.stringify(val) : String(val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
