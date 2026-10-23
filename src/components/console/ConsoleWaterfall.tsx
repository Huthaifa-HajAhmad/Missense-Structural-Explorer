import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, Copy, Download, Flame, Layers, Trash2, X } from "lucide-react";
import type { PipelineStage, TraceRun, TraceSpan } from "../../types/devConsole";
import {
  STAGE_META,
  STAGE_ORDER,
  barGeometry,
  buildTimeline,
  formatDuration,
  formatClock,
  stageWindow,
  type TimelineScale,
} from "./consoleUtils";
import { useCopy } from "./useCopy";

interface Props {
  runs: TraceRun[];
  activeRun: TraceRun | null;
  onSelectRun: (traceId: string) => void;
  onExport: () => void;
  onClear: () => void;
}

function StatusBadge({ status }: { status: TraceSpan["status"] }) {
  const tone = status === "success" ? "good" : status === "running" ? "running" : status === "unavailable" ? "warn" : "danger";
  return (
    <span className="cx-badge" data-tone={tone}>
      {status}
    </span>
  );
}

export default function ConsoleWaterfall({ runs, activeRun, onSelectRun, onExport, onClear }: Props) {
  const [scale, setScale] = useState<TimelineScale>("focus");
  const [collapsed, setCollapsed] = useState<Set<PipelineStage>>(new Set());
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { copy, status } = useCopy();

  // A span id only identifies a span within its run.
  useEffect(() => setSelectedId(null), [activeRun?.traceId]);

  const spans = activeRun?.spans ?? [];
  const selected = useMemo(() => spans.find((s) => s.id === selectedId) ?? null, [spans, selectedId]);
  const timeline = useMemo(() => (activeRun ? buildTimeline(activeRun, scale) : null), [activeRun, scale]);
  const slowestName = useMemo(() => {
    const slowest = [...spans].sort((a, b) => b.durationMs - a.durationMs)[0];
    return slowest && slowest.durationMs > 200 ? slowest.name : null;
  }, [spans]);

  const toggleStage = (stage: PipelineStage) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });

  const allCollapsed = STAGE_ORDER.every((s) => collapsed.has(s));
  const toggleExpandAll = () => setCollapsed(allCollapsed ? new Set() : new Set(STAGE_ORDER));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && selected) setSelectedId(null);
  };

  const hasLongSpans = !!timeline && timeline.outliers.size > 0;

  return (
    <>
      <div className="cx-trace-bar">
        <label htmlFor="cx-trace-session">Trace session</label>
        <select
          id="cx-trace-session"
          className="cx-select"
          aria-label="Trace session"
          value={activeRun?.traceId || ""}
          onChange={(e) => onSelectRun(e.target.value)}
        >
          {runs.length === 0 ? (
            <option value="">No traces recorded yet</option>
          ) : (
            runs.map((r) => (
              <option key={r.traceId} value={r.traceId}>
                {r.query} — {formatClock(r.timestamp)} ({formatDuration(r.totalDurationMs)}
                {r.status === "failed" ? ", issues" : r.status === "cancelled" ? ", cancelled" : r.status === "running" ? ", running" : ""})
              </option>
            ))
          )}
        </select>

        {activeRun && activeRun.spans.length > 0 && (
          <div className="cx-tabs" role="group" aria-label="Filter stages">
            <button
              type="button"
              className="cx-tab"
              aria-pressed={stageFilter === "all"}
              onClick={() => setStageFilter("all")}
            >
              All stages
            </button>
            {STAGE_ORDER.map((stage) => {
              const count = spans.filter((s) => s.stage === stage).length;
              if (count === 0) return null;
              return (
                <button
                  key={stage}
                  type="button"
                  className="cx-tab"
                  aria-pressed={stageFilter === stage}
                  onClick={() => setStageFilter(stageFilter === stage ? "all" : stage)}
                >
                  <span className="cx-stage-dot" data-stage={stage} style={{ width: 6, height: 6 }} />
                  <span style={{ textTransform: "capitalize" }}>{stage}</span>
                  <span className="cx-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {hasLongSpans && (
          <div className="cx-tabs" role="group" aria-label="Timeline scale">
            <button
              type="button"
              className="cx-tab"
              aria-pressed={scale === "focus"}
              onClick={() => setScale("focus")}
              title="Clip very long operations so the other bars stay readable"
            >
              Focus
            </button>
            <button
              type="button"
              className="cx-tab"
              aria-pressed={scale === "full"}
              onClick={() => setScale("full")}
              title="Linear scale across the whole run"
            >
              Full run
            </button>
          </div>
        )}

        <button
          type="button"
          className="cx-btn"
          disabled={!activeRun || spans.length === 0}
          onClick={toggleExpandAll}
          title={allCollapsed ? "Expand all pipeline stages" : "Collapse all pipeline stages"}
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>

        <span className="cx-spacer" />
        <button type="button" className="cx-btn" disabled={runs.length === 0} onClick={onExport} aria-label="Export trace runs as JSON">
          <Download aria-hidden />
          Export traces
        </button>
        <button type="button" className="cx-btn" disabled={runs.length === 0} onClick={onClear} aria-label="Clear all trace runs">
          <Trash2 aria-hidden />
          Clear traces
        </button>
      </div>

      {timeline?.clipped && (
        <div className="cx-banner" role="status" style={{ background: "var(--cs-surface-2)", color: "var(--cs-text-secondary)", borderBottomColor: "var(--cs-border)" }}>
          {timeline.clippedCount} long-running operation{timeline.clippedCount === 1 ? " is" : "s are"} clipped (torn edge) so the
          other bars stay readable.
          <button type="button" className="cx-btn" onClick={() => setScale("full")}>
            Show full run
          </button>
        </div>
      )}

      <div className="cx-body" data-inspector={selected ? "open" : "closed"} onKeyDown={handleKeyDown}>
        <div className="cx-main">
          {!activeRun || activeRun.spans.length === 0 || !timeline ? (
            <div className="dev-console-empty">
              <Layers aria-hidden />
              <h3>No trace recorded yet</h3>
              <p>
                Search a variant (e.g. <code>TP53 R175H</code>) to capture per-operation latency across the four pipeline stages.
              </p>
            </div>
          ) : (
            <>
              <div className="gantt-sticky">
              <div className="gantt-grid-header">
                <div>Pipeline Stage / Operation</div>
                <div>Status · Duration</div>
                <div>
                  Timeline · 0 → {formatDuration(timeline.axisMax)}
                  {timeline.clipped ? " (focused)" : ""}
                </div>
              </div>
              <div className="gantt-axis-row" aria-hidden>
                <div />
                <div />
                <div className="gantt-axis-ticks">
                  {timeline.ticks.map((t) => (
                    <span key={t.pct} style={{ left: `${t.pct}%` }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
              </div>

              {STAGE_ORDER.map((stage) => {
                if (stageFilter !== "all" && stageFilter !== stage) return null;
                const stageSpans = activeRun.spans.filter((s) => s.stage === stage);
                if (stageSpans.length === 0) return null;
                const isCollapsed = collapsed.has(stage);
                const meta = STAGE_META[stage];
                const window = stageWindow(stageSpans);

                return (
                  <section key={stage}>
                    <button
                      type="button"
                      onClick={() => toggleStage(stage)}
                      aria-expanded={!isCollapsed}
                      className="gantt-stage-header"
                    >
                      <span className="gantt-stage-title">
                        <ChevronDown aria-hidden />
                        <span className="cx-stage-dot" data-stage={stage} />
                        Stage {meta.index}: {meta.title}
                      </span>
                      <span className="gantt-stage-meta">
                        {meta.tools} · {stageSpans.length} op{stageSpans.length === 1 ? "" : "s"} ·{" "}
                        {formatDuration(window.end - window.start)} elapsed
                      </span>
                    </button>

                    {!isCollapsed &&
                      stageSpans.map((span) => {
                        const isSelected = selectedId === span.id;
                        const geo = barGeometry(span, timeline.axisMax);
                        const tip = `+${formatDuration(span.offsetMs)} · ${formatDuration(span.durationMs)}${span.cached ? " · cached" : ""}${span.error ? ` · ${span.error}` : ""}`;
                        return (
                          <button
                            key={span.id}
                            type="button"
                            data-selected={isSelected}
                            aria-pressed={isSelected}
                            onClick={() => setSelectedId(isSelected ? null : span.id)}
                            aria-label={`${span.name}, ${span.stage} stage, ${span.durationMs} milliseconds${span.cached ? ", cached" : ""}${span.status === "failed" ? ", failed" : ""}${span.status === "unavailable" ? ", unavailable" : ""}`}
                            className="gantt-row"
                          >
                            <div className="gantt-name" title={span.name}>
                              <span>{span.name}</span>
                              {span.cached && (
                                <span className="cx-badge" data-tone="warn">
                                  Cached
                                </span>
                              )}
                              {slowestName === span.name && (
                                <span className="cx-badge" data-tone="danger">
                                  <Flame style={{ width: 10, height: 10 }} aria-hidden />
                                  Slowest
                                </span>
                              )}
                            </div>
                            <div className="gantt-status">
                              <StatusBadge status={span.status} />
                              <span className="gantt-duration">{formatDuration(span.durationMs)}</span>
                            </div>
                            <div className="gantt-bar-track">
                              <div className={`gantt-bar-cell ${isSelected ? "gantt-bar-cell-selected" : ""}`} data-tip={tip}>
                                <motion.div
                                  initial={{ scaleX: 0 }}
                                  animate={{ scaleX: 1 }}
                                  transition={{ duration: 0.25, ease: "easeOut" }}
                                  data-clipped={geo.clippedRight}
                                  className={`gantt-bar ${
                                    span.status === "failed"
                                      ? "gantt-bar-failed"
                                      : span.status === "unavailable"
                                      ? "gantt-bar-unavailable"
                                      : `gantt-bar-${span.stage}`
                                  } ${span.status === "running" ? "gantt-bar-running" : ""}`}
                                  style={{ left: `${geo.leftPct}%`, width: `${geo.widthPct}%`, originX: 0 }}
                                />
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </section>
                );
              })}
            </>
          )}
        </div>

        {selected && activeRun && (
          <aside className="cx-aside" aria-label="Span detail inspector">
            <div className="cx-aside-head">
              <span className="cx-stage-dot" data-stage={selected.stage} />
              <b style={{ minWidth: 0, overflowWrap: "anywhere" }}>{selected.name}</b>
              <span className="cx-spacer" />
              <button type="button" className="cx-icon-btn" onClick={() => setSelectedId(null)} aria-label="Close span inspector">
                <X />
              </button>
            </div>
            <div className="cx-aside-body">
              <div>
                <button
                  type="button"
                  className="cx-btn"
                  onClick={() => copy(JSON.stringify(selected, null, 2), "span")}
                  title="Copy span as JSON"
                >
                  {status("span") === "copied" ? <Check style={{ color: "var(--cs-good)" }} /> : <Copy />}
                  {status("span") === "copied" ? "Copied span" : status("span") === "failed" ? "Copy failed" : "Copy span"}
                </button>
              </div>

              {selected.status === "unavailable" && (
                <div className="cx-message" style={{ borderColor: "color-mix(in srgb, var(--cs-warn) 40%, transparent)" }}>
                  The backend reported this model as unavailable — the run waited, then gave up. This is a service
                  condition, not a client error.
                </div>
              )}

              <table className="dev-console-meta-table cx-mono">
                <tbody>
                  <tr>
                    <td>Pipeline stage</td>
                    <td style={{ textTransform: "capitalize" }}>
                      <b>{selected.stage}</b>
                    </td>
                  </tr>
                  <tr>
                    <td>Status</td>
                    <td>
                      <StatusBadge status={selected.status} />
                    </td>
                  </tr>
                  <tr>
                    <td>Timeline offset</td>
                    <td>+{formatDuration(selected.offsetMs)} from pipeline initiation</td>
                  </tr>
                  <tr>
                    <td>Duration</td>
                    <td>
                      {formatDuration(selected.durationMs)}{" "}
                      <span style={{ color: "var(--cs-text-muted)" }}>
                        ({Math.round((selected.durationMs / Math.max(activeRun.totalDurationMs, 1)) * 100)}% of run)
                      </span>
                    </td>
                  </tr>
                  {selected.cached && (
                    <tr>
                      <td>Cache</td>
                      <td>Cache hit</td>
                    </tr>
                  )}
                  {selected.error && (
                    <tr>
                      <td>Error</td>
                      <td style={{ color: "var(--cs-text-danger-on-soft)", fontWeight: 600 }}>{selected.error}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {selected.meta && Object.keys(selected.meta).length > 0 && (
                <section>
                  <h4 className="cx-section-title">Metadata</h4>
                  <table className="dev-console-meta-table cx-mono">
                    <tbody>
                      {Object.entries(selected.meta).map(([k, v]) => (
                        <tr key={k}>
                          <td>{k}</td>
                          <td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
