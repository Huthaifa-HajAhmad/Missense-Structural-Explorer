import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Check,
  Copy,
  Download,
  Layers,
  Pause,
  Play,
  Rows3,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useDevConsole } from "../context/DevConsoleContext";
import type { ErrorImpact, LogLevel, LogSource, LogStream, TraceRun } from "../types/devConsole";
import ConsoleLogView from "./console/ConsoleLogView";
import ConsoleWaterfall from "./console/ConsoleWaterfall";
import {
  IMPACT_OPTIONS,
  LEVEL_OPTIONS,
  SOURCE_OPTIONS,
  buildMarkdownReport,
  countImpacts,
  downloadJson,
  formatDuration,
  isFiltered,
  matchesFilters,
  summarizeTrace,
} from "./console/consoleUtils";

const STREAM_ORDER: LogStream[] = ["error", "live", "tracing"];

interface TileProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "danger" | "warn" | "good" | "muted";
  /** Present → the tile is a filter toggle. */
  pressed?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}

function Tile({ label, value, sub, tone, pressed, onClick, ariaLabel }: TileProps) {
  const inner = (
    <>
      <span className="cx-tile-label">{label}</span>
      <span className="cx-tile-value" data-tone={tone}>
        {value}
      </span>
      <span className="cx-tile-sub">{sub ?? " "}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="cx-tile" aria-pressed={pressed} aria-label={ariaLabel} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className="cx-tile">{inner}</div>;
}

export default function DevConsolePanel() {
  const { state, dispatch, exportTraceRuns } = useDevConsole();

  const activeTab = state.activeTab;
  const isLogTab = activeTab !== "tracing";
  const stream: Exclude<LogStream, "tracing"> = activeTab === "live" ? "live" : "error";
  const streamState = stream === "error" ? state.errorState : state.liveState;

  const [compact, setCompact] = useState(false);
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const clearAllTimer = useRef<number | undefined>(undefined);
  const copyMarkdownTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(clearAllTimer.current);
      window.clearTimeout(copyMarkdownTimer.current);
    },
    []
  );

  // Anything arriving while its stream is on screen is read by definition.
  useEffect(() => {
    if (isLogTab && streamState.unreadCount > 0) dispatch({ type: "MARK_READ", stream });
  }, [isLogTab, stream, streamState.unreadCount, dispatch]);

  const activeTrace = useMemo<TraceRun | null>(
    () => state.activeTraceRun ?? state.traceRuns[0] ?? null,
    [state.activeTraceRun, state.traceRuns]
  );
  const latestRun = state.traceRuns[0] ?? null;
  const latestSummary = useMemo(() => summarizeTrace(latestRun), [latestRun]);
  const activeSummary = useMemo(() => summarizeTrace(activeTrace), [activeTrace]);
  const pipelineProblems = latestSummary.failed + latestSummary.unavailable;

  const impacts = useMemo(() => countImpacts(state.errorState.entries), [state.errorState.entries]);

  const liveStats = useMemo(() => {
    let http = 0;
    let cached = 0;
    let latencyTotal = 0;
    let latencyN = 0;
    for (const e of state.liveState.entries) {
      if (e.httpMeta?.url) http += 1;
      if (e.httpMeta?.cached || e.httpMeta?.status === 304 || e.message.toLowerCase().includes("[cache hit]")) cached += 1;
      if (typeof e.httpMeta?.durationMs === "number") {
        latencyTotal += e.httpMeta.durationMs;
        latencyN += 1;
      }
    }
    return { http, cached, avgLatency: latencyN ? latencyTotal / latencyN : null };
  }, [state.liveState.entries]);

  const filteredEntries = useMemo(
    () => streamState.entries.filter((entry) => matchesFilters(entry, streamState)),
    [streamState]
  );

  const levelCounts = useMemo(() => {
    const counts: Partial<Record<LogLevel | "all", number>> = { all: streamState.entries.length };
    for (const entry of streamState.entries) counts[entry.level] = (counts[entry.level] || 0) + 1;
    return counts;
  }, [streamState.entries]);

  const totalConsoleItems = state.errorState.entries.length + state.liveState.entries.length + state.traceRuns.length;
  const session = state.sessionContext;
  const online = session.online !== false;

  /* ── actions ── */
  const selectStream = (next: LogStream) => dispatch({ type: "SET_ACTIVE_TAB", tab: next });

  const handleStreamNav = (e: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
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
    requestAnimationFrame(() => document.getElementById(`console-tab-${target}`)?.focus());
  };

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
  };

  const resetFilters = () => {
    dispatch({ type: "SET_LEVEL_FILTER", stream, level: "all" });
    dispatch({ type: "SET_SOURCE_FILTER", stream, source: "all" });
    dispatch({ type: "SET_IMPACT_FILTER", stream, impact: "all" });
    dispatch({ type: "SET_SEARCH", stream, query: "" });
  };

  const handleCopyMarkdown = async () => {
    const md = filteredEntries.map((e) => buildMarkdownReport(e)).join("\n\n---\n\n");
    let success = false;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(md);
        success = true;
      } catch {
        success = false;
      }
    }
    if (!success && typeof document !== "undefined") {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = md;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.select();
        success = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        success = false;
      }
    }
    if (success) {
      setCopiedAll(true);
      window.clearTimeout(copyMarkdownTimer.current);
      copyMarkdownTimer.current = window.setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const toggleImpact = (impact: ErrorImpact) =>
    dispatch({
      type: "SET_IMPACT_FILTER",
      stream: "error",
      impact: state.errorState.impactFilter === impact ? "all" : impact,
    });

  // "/" focuses search; Escape in the search box clears it (inspectors handle their own Escape).
  const handleRootKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isEditable = ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
    if (e.key === "/" && !isEditable && isLogTab) {
      e.preventDefault();
      searchInputRef.current?.focus();
      return;
    }
    if (e.key === "Escape" && isEditable && streamState.searchQuery) {
      dispatch({ type: "SET_SEARCH", stream, query: "" });
    }
  };

  const filtersActive = isFiltered(streamState);
  const errorTotal = state.errorState.entries.length;

  return (
    // Focusable (tabIndex -1) so a click on blank page space still routes "/" to the filter field.
    <div className="cx-page" tabIndex={-1} onKeyDown={handleRootKeyDown}>
      {/* ── Page heading: the same framing as "Analyse a variant." — session state and the one
          destructive action sit beside it, outside the stream panel they act on as a whole. ── */}
      <header className="cx-masthead">
        <div className="min-w-0">
          <h1 className="cx-title">
            Console<span aria-hidden="true">.</span>
          </h1>
          <p className="cx-lede">Inspect errors, follow requests, and trace each analysis.</p>
        </div>
        <div className="cx-masthead-actions">
          <div className="cx-session" aria-label="Session">
            <span className="cx-dot" data-tone={online ? undefined : "danger"} aria-hidden />
            <span className="cx-session-variant">
              {session.gene ? (
                <>
                  <b>{session.gene}</b> {session.variant}
                </>
              ) : (
                "No variant loaded"
              )}
            </span>
            <span className="cx-mono cx-session-meta">
              {online ? "online" : "offline"}
              {session.memoryMB ? ` · ${session.memoryMB} MB` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={totalConsoleItems === 0}
            className="cx-btn"
            data-tone={confirmingClearAll ? "danger" : undefined}
            aria-label={confirmingClearAll ? "Confirm clear all" : "Clear all console data — error stream, live stream, and pipeline traces"}
          >
            {confirmingClearAll ? <Check aria-hidden /> : <Trash2 aria-hidden />}
            <span>{confirmingClearAll ? "Confirm clear all" : "Clear all"}</span>
          </button>
        </div>
      </header>

      <section className="cx-root" aria-labelledby="console-streams-title">
        <h2 id="console-streams-title" className="sr-only">Console streams</h2>
        {/* ── Stream switch: the panel's header strip ── */}
        <div className="cx-head">
          <div role="tablist" aria-label="Console streams" onKeyDown={handleStreamNav} className="cx-tabs">
            <button
              type="button"
              id="console-tab-error"
              role="tab"
              className="cx-tab"
              aria-selected={activeTab === "error"}
              aria-controls="console-stream-panel"
              tabIndex={activeTab === "error" ? 0 : -1}
              onClick={() => selectStream("error")}
            >
              <ShieldAlert aria-hidden style={impacts.fatal > 0 ? { color: "var(--cs-danger)" } : undefined} />
              <span>Errors</span>
              {errorTotal > 0 && (
                <span className="cx-count" data-tone={impacts.fatal > 0 ? "danger" : "warn"}>
                  {errorTotal}
                </span>
              )}
            </button>
            <button
              type="button"
              id="console-tab-live"
              role="tab"
              className="cx-tab"
              aria-selected={activeTab === "live"}
              aria-controls="console-stream-panel"
              tabIndex={activeTab === "live" ? 0 : -1}
              onClick={() => selectStream("live")}
            >
              <Activity aria-hidden />
              <span>Live events</span>
              <span className="cx-count">{state.liveState.entries.length}</span>
            </button>
            <button
              type="button"
              id="console-tab-tracing"
              role="tab"
              className="cx-tab"
              aria-selected={activeTab === "tracing"}
              aria-controls="console-stream-panel"
              tabIndex={activeTab === "tracing" ? 0 : -1}
              onClick={() => selectStream("tracing")}
            >
              <Layers aria-hidden />
              <span>Waterfall</span>
              {pipelineProblems > 0 ? (
                <span className="cx-count" data-tone="danger" title="Failed or unavailable operations in the latest run">
                  {pipelineProblems}
                </span>
              ) : (
                activeTrace && <span className="cx-count">{formatDuration(activeTrace.totalDurationMs)}</span>
              )}
            </button>
          </div>
        </div>

        <div id="console-stream-panel" className="cx-stream-panel" role="tabpanel" aria-labelledby={`console-tab-${activeTab}`} tabIndex={-1}>
          {/* ── Metrics strip (fixed height, so switching tabs never shifts the page) ── */}
          <section className="cx-kpis" aria-label="Console metrics">
            {activeTab === "error" && (
              <>
                <Tile
                  label="Fatal"
                  value={impacts.fatal}
                  tone={impacts.fatal > 0 ? "danger" : "muted"}
                  sub="Blocks a result"
                  pressed={state.errorState.impactFilter === "fatal"}
                  onClick={() => toggleImpact("fatal")}
                  ariaLabel={`Fatal: ${impacts.fatal}. Toggle filter`}
                />
                <Tile
                  label="Degraded"
                  value={impacts.degraded}
                  tone={impacts.degraded > 0 ? "warn" : "muted"}
                  sub="Fallback in use"
                  pressed={state.errorState.impactFilter === "degraded"}
                  onClick={() => toggleImpact("degraded")}
                  ariaLabel={`Degraded: ${impacts.degraded}. Toggle filter`}
                />
                <Tile
                  label="Recoverable"
                  value={impacts.recoverable}
                  tone="muted"
                  sub="Retried or rate-limited"
                  pressed={state.errorState.impactFilter === "recoverable"}
                  onClick={() => toggleImpact("recoverable")}
                  ariaLabel={`Recoverable: ${impacts.recoverable}. Toggle filter`}
                />
                {/*
                  A run that was superseded, or cut off by a page reload, is not a CLEAN run — "clean" would
                  claim an analysis that never finished — and it is not a failure either, so the run's own
                  word is used rather than a verdict this tile never measured.
                */}
                <Tile
                  label="Pipeline operations"
                  value={pipelineProblems}
                  tone={latestSummary.failed > 0 ? "danger" : pipelineProblems > 0 ? "warn" : "good"}
                  sub={
                    !latestRun
                      ? "No run recorded"
                      : pipelineProblems > 0
                      ? `${latestSummary.failed} failed · ${latestSummary.unavailable} unavailable — open Waterfall`
                      : latestRun.status === "cancelled"
                      ? "Latest run cancelled"
                      : "Latest run clean"
                  }
                  onClick={latestRun ? () => selectStream("tracing") : undefined}
                  ariaLabel={`Pipeline operations with problems in the latest run: ${pipelineProblems}. Open waterfall`}
                />
              </>
            )}
            {activeTab === "live" && (
              <>
                <Tile label="Events captured" value={state.liveState.entries.length} sub={`${state.liveState.entries.length >= 500 ? "Buffer full (500)" : "Newest first"}`} />
                <Tile label="HTTP calls" value={liveStats.http} sub="API & POST requests" />
                <Tile label="Cache hits" value={liveStats.cached} sub={liveStats.http ? `${Math.round((liveStats.cached / Math.max(liveStats.http, 1)) * 100)}% of HTTP calls` : "—"} />
                <Tile label="Avg latency" value={liveStats.avgLatency === null ? "—" : formatDuration(liveStats.avgLatency)} sub="Across timed calls" />
              </>
            )}
            {activeTab === "tracing" && (
              <>
                <Tile label="Run duration" value={activeTrace ? formatDuration(activeTrace.totalDurationMs) : "—"} sub={activeTrace ? activeTrace.query : "No run selected"} />
                <Tile label="Operations" value={activeSummary.spanCount} sub={activeSummary.cached ? `${activeSummary.cached} cached` : "None cached"} />
                <Tile
                  label="Problems"
                  value={activeSummary.failed + activeSummary.unavailable}
                  tone={activeSummary.failed > 0 ? "danger" : activeSummary.unavailable > 0 ? "warn" : "good"}
                  sub={`${activeSummary.failed} failed · ${activeSummary.unavailable} unavailable`}
                />
                <Tile
                  label="Slowest operation"
                  value={activeSummary.slowest ? formatDuration(activeSummary.slowest.durationMs) : "—"}
                  sub={activeSummary.slowest?.name ?? "—"}
                />
              </>
            )}
          </section>

          {isLogTab ? (
            <>
              {/* ── Filter toolbar ── */}
              <div className="cx-toolbar">
                <div className="cx-pills" role="group" aria-label="Filter by level">
                  {LEVEL_OPTIONS.map((opt) => {
                    const count = levelCounts[opt.id] || 0;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className="cx-pill"
                        aria-pressed={streamState.levelFilter === opt.id}
                        aria-label={`${opt.label}${count > 0 ? ` ${count}` : ""}`}
                        onClick={() => dispatch({ type: "SET_LEVEL_FILTER", stream, level: opt.id })}
                      >
                        {opt.label}
                        {count > 0 && <span className="cx-pill-count">{count}</span>}
                      </button>
                    );
                  })}
                </div>

                <span className="cx-divider" aria-hidden />

                {stream === "error" && (
                  <select
                    aria-label="Filter by error impact"
                    className="cx-select"
                    value={streamState.impactFilter}
                    onChange={(e) => dispatch({ type: "SET_IMPACT_FILTER", stream, impact: e.target.value as ErrorImpact | "all" })}
                  >
                    {IMPACT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  aria-label="Filter by subsystem"
                  className="cx-select"
                  value={streamState.sourceFilter}
                  onChange={(e) => dispatch({ type: "SET_SOURCE_FILTER", stream, source: e.target.value as LogSource | "all" })}
                >
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <div className="cx-search">
                  <Search aria-hidden />
                  <input
                    ref={searchInputRef}
                    type="text"
                    aria-label={`Search ${stream} entries`}
                    placeholder="Filter messages and payloads"
                    value={streamState.searchQuery}
                    onChange={(e) => dispatch({ type: "SET_SEARCH", stream, query: e.target.value })}
                  />
                  {!streamState.searchQuery && <kbd className="cx-kbd">/</kbd>}
                </div>

                <span className="cx-spacer" />

                <div className="cx-tools">
                  <button
                    type="button"
                    className="cx-icon-btn"
                    aria-pressed={!streamState.isCapturing}
                    onClick={() => dispatch({ type: "TOGGLE_CAPTURE", stream })}
                    aria-label={streamState.isCapturing ? `Pause ${stream} capture` : `Resume ${stream} capture`}
                    title={streamState.isCapturing ? "Pause capture" : "Resume capture"}
                  >
                    {streamState.isCapturing ? <Pause /> : <Play />}
                  </button>
                  <button
                    type="button"
                    className="cx-icon-btn"
                    disabled={filteredEntries.length === 0}
                    onClick={handleCopyMarkdown}
                    aria-label={copiedAll ? "Copied markdown report" : "Copy filtered entries as markdown"}
                    title={copiedAll ? "Copied markdown report" : "Copy filtered entries as markdown"}
                  >
                    {copiedAll ? <Check style={{ color: "var(--cs-good)" }} /> : <Copy />}
                  </button>
                  <button
                    type="button"
                    className="cx-icon-btn"
                    disabled={filteredEntries.length === 0}
                    onClick={() => downloadJson(`${stream}-console-log`, filteredEntries)}
                    aria-label={`Download ${filtersActive ? "filtered " : ""}${stream} logs as JSON`}
                    title={filtersActive ? `Download the ${filteredEntries.length} filtered entries` : "Download as JSON"}
                  >
                    <Download />
                  </button>
                  <button
                    type="button"
                    className="cx-icon-btn"
                    disabled={streamState.entries.length === 0}
                    onClick={() => dispatch({ type: "CLEAR_STREAM", stream })}
                    aria-label={`Clear ${stream} stream`}
                    title="Clear this stream"
                  >
                    <Trash2 />
                  </button>
                  <button
                    type="button"
                    className="cx-icon-btn"
                    aria-pressed={compact}
                    onClick={() => setCompact((c) => !c)}
                    aria-label={compact ? "Switch to comfortable density" : "Switch to compact density"}
                    title={compact ? "Comfortable rows" : "Compact rows"}
                  >
                    <Rows3 />
                  </button>
                  <span className="cx-result-count cx-mono">
                    {filtersActive ? `${filteredEntries.length} of ${streamState.entries.length}` : `${streamState.entries.length} entries`}
                  </span>
                </div>
              </div>

              {/* ── Preset filter chips ── */}
              <div className="cx-presets-bar" role="group" aria-label="Quick filters">
                <span className="cx-presets-label">Quick filters</span>
                {stream === "error" ? (
                  <>
                    {/* Impact presets live on the metric tiles above; these narrow by subsystem. */}
                    <button
                      type="button"
                      className="cx-preset-chip"
                      data-active={streamState.sourceFilter === "biophysics"}
                      aria-pressed={streamState.sourceFilter === "biophysics"}
                      onClick={() =>
                        dispatch({
                          type: "SET_SOURCE_FILTER",
                          stream: "error",
                          source: streamState.sourceFilter === "biophysics" ? "all" : "biophysics",
                        })
                      }
                    >
                      Biophysics
                    </button>
                    <button
                      type="button"
                      className="cx-preset-chip"
                      data-active={streamState.sourceFilter === "genomics"}
                      aria-pressed={streamState.sourceFilter === "genomics"}
                      onClick={() =>
                        dispatch({
                          type: "SET_SOURCE_FILTER",
                          stream: "error",
                          source: streamState.sourceFilter === "genomics" ? "all" : "genomics",
                        })
                      }
                    >
                      Genomics
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="cx-preset-chip"
                      data-active={streamState.searchQuery.toLowerCase() === "http"}
                      aria-pressed={streamState.searchQuery.toLowerCase() === "http"}
                      onClick={() =>
                        dispatch({
                          type: "SET_SEARCH",
                          stream: "live",
                          query: streamState.searchQuery.toLowerCase() === "http" ? "" : "http",
                        })
                      }
                    >
                      API / HTTP ({liveStats.http})
                    </button>
                    <button
                      type="button"
                      className="cx-preset-chip"
                      data-active={streamState.searchQuery.toLowerCase() === "[cache hit]"}
                      aria-pressed={streamState.searchQuery.toLowerCase() === "[cache hit]"}
                      onClick={() =>
                        dispatch({
                          type: "SET_SEARCH",
                          stream: "live",
                          query: streamState.searchQuery.toLowerCase() === "[cache hit]" ? "" : "[cache hit]",
                        })
                      }
                    >
                      Cache hits ({liveStats.cached})
                    </button>
                    <button
                      type="button"
                      className="cx-preset-chip"
                      data-active={streamState.sourceFilter === "biophysics"}
                      aria-pressed={streamState.sourceFilter === "biophysics"}
                      onClick={() =>
                        dispatch({
                          type: "SET_SOURCE_FILTER",
                          stream: "live",
                          source: streamState.sourceFilter === "biophysics" ? "all" : "biophysics",
                        })
                      }
                    >
                      Biophysics
                    </button>
                    <button
                      type="button"
                      className="cx-preset-chip"
                      data-active={streamState.sourceFilter === "structure-3d"}
                      aria-pressed={streamState.sourceFilter === "structure-3d"}
                      onClick={() =>
                        dispatch({
                          type: "SET_SOURCE_FILTER",
                          stream: "live",
                          source: streamState.sourceFilter === "structure-3d" ? "all" : "structure-3d",
                        })
                      }
                    >
                      Structure 3D
                    </button>
                  </>
                )}
                {filtersActive && (
                  <button
                    type="button"
                    className="cx-preset-chip cx-preset-chip-clear"
                    onClick={resetFilters}
                    title="Clear all active filters"
                  >
                    Clear filters ×
                  </button>
                )}
              </div>

              {!streamState.isCapturing && (
                <div className="cx-banner" role="status">
                  <Pause style={{ width: 13, height: 13 }} aria-hidden />
                  Capture paused — new {stream} events are being discarded, not buffered.
                  <button type="button" className="cx-btn" onClick={() => dispatch({ type: "TOGGLE_CAPTURE", stream })}>
                    <Play aria-hidden />
                    Resume
                  </button>
                </div>
              )}

              <ConsoleLogView
                stream={stream}
                allEntries={streamState.entries}
                entries={filteredEntries}
                searchQuery={streamState.searchQuery}
                compact={compact}
                pipelineProblems={pipelineProblems}
                onOpenWaterfall={() => selectStream("tracing")}
                onResetFilters={resetFilters}
              />
            </>
          ) : (
            <ConsoleWaterfall
              runs={state.traceRuns}
              activeRun={activeTrace}
              onSelectRun={(traceId) => dispatch({ type: "SET_ACTIVE_TRACE_RUN", traceId })}
              onExport={exportTraceRuns}
              onClear={() => dispatch({ type: "CLEAR_TRACES" })}
            />
          )}
        </div>
      </section>
    </div>
  );
}
