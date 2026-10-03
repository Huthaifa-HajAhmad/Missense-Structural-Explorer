import React, { useEffect, useMemo, useState } from "react";
import { Activity, Filter, Layers, ShieldCheck } from "lucide-react";
import type { ConsoleEntry, LogStream } from "../../types/devConsole";
import ConsoleInspector, { ImpactBadge } from "./ConsoleInspector";
import { effectiveImpact, formatClock } from "./consoleUtils";

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
      <mark key={i} className="dev-console-mark">
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

interface Props {
  stream: Exclude<LogStream, "tracing">;
  /** Every entry in the stream (the inspector resolves its selection here, so a filter can't orphan it). */
  allEntries: ConsoleEntry[];
  /** Entries passing the active filters, newest first. */
  entries: ConsoleEntry[];
  searchQuery: string;
  compact: boolean;
  /** Failed/unavailable operations in the latest pipeline run — an error stream can be empty while these exist. */
  pipelineProblems: number;
  onOpenWaterfall: () => void;
  onResetFilters: () => void;
}

export default function ConsoleLogView({
  stream,
  allEntries,
  entries,
  searchQuery,
  compact,
  pipelineProblems,
  onOpenWaterfall,
  onResetFilters,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => (selectedId ? allEntries.find((e) => e.id === selectedId) ?? null : null),
    [allEntries, selectedId]
  );

  // Each stream keeps its own entries; a selection never carries across.
  useEffect(() => setSelectedId(null), [stream]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && selected) {
      setSelectedId(null);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button.dev-console-entry"));
    if (rows.length === 0) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
    if (next !== index) {
      rows[next].focus();
      e.preventDefault();
    }
  };

  let body: React.ReactNode;
  if (allEntries.length === 0) {
    body =
      stream === "error" ? (
        <div className="dev-console-empty">
          <ShieldCheck className="cx-empty-icon-good" aria-hidden />
          <h3>Zero Active Errors</h3>
          <p>
            Intercepted exceptions, failed network calls and fallback events stream here automatically.
          </p>
          {pipelineProblems > 0 && (
            <button type="button" className="cx-btn" data-tone="danger" onClick={onOpenWaterfall}>
              <Layers aria-hidden />
              {pipelineProblems} pipeline operation{pipelineProblems === 1 ? "" : "s"} failed or unavailable in the latest run
            </button>
          )}
        </div>
      ) : (
        <div className="dev-console-empty">
          <Activity aria-hidden />
          <h3>Live Log Stream Idle</h3>
          <p>API calls, cache events and background worker transitions appear here as they happen.</p>
        </div>
      );
  } else if (entries.length === 0) {
    body = (
      <div className="dev-console-empty">
        <Filter aria-hidden />
        <h3>No entries match your filters</h3>
        <button type="button" className="cx-btn" onClick={onResetFilters}>
          Reset all filters
        </button>
      </div>
    );
  } else {
    body = entries.map((entry) => {
      const impact = effectiveImpact(entry);
      const http = entry.httpMeta;
      const statusTone = !http?.status ? "danger" : http.status >= 500 ? "danger" : http.status >= 400 ? "warn" : "good";
      return (
        <button
          key={entry.id}
          type="button"
          data-selected={entry.id === selectedId}
          data-impact={impact}
          aria-pressed={entry.id === selectedId}
          onClick={() => setSelectedId(entry.id === selectedId ? null : entry.id)}
          className="dev-console-entry"
        >
          <span className="cx-time" title={new Date(entry.timestamp).toLocaleString()}>
            {formatClock(entry.timestamp)}
          </span>
          <span className="cx-level" data-level={entry.level} aria-label={entry.level} role="img" />
          <span className="dev-console-source-tag" data-source={entry.source}>
            [{entry.source}]
          </span>
          <span className="dev-console-message">{highlightText(entry.message, searchQuery)}</span>
          <span className="cx-row-badges">
            <ImpactBadge entry={entry} />
            {http && (http.status !== undefined) && (
              <span className="cx-badge" data-tone={statusTone}>
                {http.method} {http.status || "ERR"}
              </span>
            )}
            {entry.count > 1 && (
              <span className="cx-badge" data-tone="warn">
                ×{entry.count}
              </span>
            )}
          </span>
        </button>
      );
    });
  }

  return (
    <div className="cx-body" data-inspector={selected ? "open" : "closed"} onKeyDown={handleKeyDown}>
      <div
        role="log"
        aria-label={`${stream} entries`}
        className={`cx-main ${compact ? "dev-console-list-compact" : ""}`}
      >
        {body}
      </div>
      {selected && <ConsoleInspector entry={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
