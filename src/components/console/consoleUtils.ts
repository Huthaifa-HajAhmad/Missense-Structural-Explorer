import type {
  ConsoleEntry,
  ErrorImpact,
  LogLevel,
  LogSource,
  PipelineStage,
  StreamState,
  TraceRun,
  TraceSpan,
} from "../../types/devConsole";

export const STAGE_ORDER: PipelineStage[] = ["genomics", "structure", "biophysics", "clinical"];

export const STAGE_META: Record<PipelineStage, { index: number; title: string; tools: string }> = {
  genomics: { index: 1, title: "Genomic & cDNA notation", tools: "Ensembl VEP · MANE Select · Splice resolver" },
  structure: { index: 2, title: "Structure retrieval & cavities", tools: "AlphaFold/PDB · Pocket finder · FoldX" },
  biophysics: { index: 3, title: "Multi-model biophysics", tools: "ESM-2 · SaProt · DynaMut2 · DDMut · ThermoMPNN" },
  clinical: { index: 4, title: "Clinical synthesis & ACMG", tools: "ClinVar · gnomAD · Literature RAG · Gemini" },
};

export const SOURCE_OPTIONS: Array<{ id: LogSource | "all"; label: string }> = [
  { id: "all", label: "All subsystems" },
  { id: "biophysics", label: "Biophysics" },
  { id: "genomics", label: "Genomics" },
  { id: "structure-3d", label: "Structure 3D" },
  { id: "ai-narrative", label: "AI narrative" },
  { id: "literature", label: "Literature" },
  { id: "network", label: "Network & HTTP" },
  { id: "workflow", label: "Workflow & retries" },
  { id: "runtime", label: "Runtime exceptions" },
  { id: "component", label: "React components" },
  { id: "notification", label: "Notifications" },
  { id: "system", label: "System (worker, WebGL, cache)" },
  { id: "console", label: "Console" },
];

export const LEVEL_OPTIONS: Array<{ id: LogLevel | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "error", label: "Error" },
  { id: "warn", label: "Warn" },
  { id: "info", label: "Info" },
  { id: "debug", label: "Debug" },
];

export const IMPACT_OPTIONS: Array<{ id: ErrorImpact | "all"; label: string }> = [
  { id: "all", label: "Any impact" },
  { id: "fatal", label: "Fatal" },
  { id: "degraded", label: "Degraded" },
  { id: "recoverable", label: "Recoverable" },
];

/** The impact a row is bucketed under — legacy rows without one fall back to their level. */
export function effectiveImpact(entry: Pick<ConsoleEntry, "impact" | "level">): ErrorImpact {
  if (entry.impact) return entry.impact;
  if (entry.level === "error") return "fatal";
  if (entry.level === "warn") return "degraded";
  return "info";
}

export interface ImpactCounts {
  fatal: number;
  degraded: number;
  recoverable: number;
}

/** Each entry lands in exactly one bucket, so the counts always sum to the actionable total. */
export function countImpacts(entries: ConsoleEntry[]): ImpactCounts {
  const counts: ImpactCounts = { fatal: 0, degraded: 0, recoverable: 0 };
  for (const entry of entries) {
    const impact = effectiveImpact(entry);
    if (impact === "fatal" || impact === "degraded" || impact === "recoverable") counts[impact] += 1;
  }
  return counts;
}

export function matchesFilters(
  entry: ConsoleEntry,
  filters: Pick<StreamState, "levelFilter" | "sourceFilter" | "impactFilter" | "searchQuery">
): boolean {
  if (filters.levelFilter !== "all" && entry.level !== filters.levelFilter) return false;
  if (filters.sourceFilter !== "all" && entry.source !== filters.sourceFilter) return false;
  if (filters.impactFilter !== "all" && effectiveImpact(entry) !== filters.impactFilter) return false;
  const q = filters.searchQuery.trim().toLowerCase();
  if (!q) return true;
  if (entry.message.toLowerCase().includes(q)) return true;
  if (entry.detail?.toLowerCase().includes(q)) return true;
  if (entry.source.toLowerCase().includes(q)) return true;
  if (entry.meta && JSON.stringify(entry.meta).toLowerCase().includes(q)) return true;
  if (entry.httpMeta && JSON.stringify(entry.httpMeta).toLowerCase().includes(q)) return true;
  return false;
}

export function isFiltered(
  filters: Pick<StreamState, "levelFilter" | "sourceFilter" | "impactFilter" | "searchQuery">
): boolean {
  return (
    filters.levelFilter !== "all" ||
    filters.sourceFilter !== "all" ||
    filters.impactFilter !== "all" ||
    filters.searchQuery.trim() !== ""
  );
}

/* ── formatting ─────────────────────────────────────────────────────────── */

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/* ── copy payloads ──────────────────────────────────────────────────────── */

function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** POSIX single-quote escaping so bodies containing apostrophes survive a paste into a shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCurl(entry: ConsoleEntry): string | null {
  const http = entry.httpMeta;
  if (!http?.url) return null;
  const method = (http.method || "GET").toUpperCase();
  const parts = [`curl -X ${method} ${shellQuote(absoluteUrl(http.url))}`];
  if (http.requestBody !== undefined) {
    const body = typeof http.requestBody === "string" ? http.requestBody : JSON.stringify(http.requestBody);
    const contentType = http.requestBodyFormat === 'form' ? 'application/x-www-form-urlencoded' : 'application/json';
    parts.push(`-H 'Content-Type: ${contentType}'`, `-d ${shellQuote(body)}`);
  }
  return parts.join(" ");
}

export function buildMarkdownReport(entry: ConsoleEntry): string {
  const http = entry.httpMeta;
  const ctx = entry.sessionContext;
  const lines = [
    `### Diagnostic report: ${entry.message}`,
    `- **Timestamp:** ${new Date(entry.timestamp).toISOString()}`,
    `- **Level / impact:** \`${entry.level.toUpperCase()}\` / \`${effectiveImpact(entry).toUpperCase()}\``,
    `- **Subsystem:** \`${entry.source}\`${entry.count > 1 ? ` (×${entry.count})` : ""}`,
    http?.url ? `- **Endpoint:** \`${http.method || "GET"} ${http.url}\` (${http.status ?? "no response"})` : "",
    ctx?.gene ? `- **Active variant:** \`${ctx.gene} ${ctx.variant || ""}\`${ctx.uniprotId ? ` (${ctx.uniprotId})` : ""}` : "",
    ctx?.activeView ? `- **View:** \`${ctx.activeView}\`` : "",
    ctx?.memoryMB ? `- **JS heap:** ~${ctx.memoryMB} MB` : "",
    "",
    entry.detail ? "#### Detail\n```\n" + entry.detail + "\n```" : "",
    http?.responseBody ? "#### Response\n```json\n" + stringifyPayload(http.responseBody) + "\n```" : "",
  ];
  return lines.filter((line, i) => line !== "" || lines[i - 1] !== "").join("\n").trim();
}

export function stringifyPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function downloadJson(prefix: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── pipeline waterfall ─────────────────────────────────────────────────── */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Spans that dwarf the rest of the run (polling jobs that sat for minutes next to
 * sub-second fetches). On a linear axis they flatten every other bar to an unreadable stub.
 */
export function findOutlierSpans(spans: TraceSpan[]): Set<string> {
  const outliers = new Set<string>();
  for (const span of spans) {
    if (span.durationMs < 10_000) continue;
    const others = spans.filter((s) => s !== span).map((s) => s.durationMs);
    if (others.length === 0) continue;
    if (span.durationMs >= Math.max(8 * median(others), 10_000)) outliers.add(span.name);
  }
  return outliers;
}

export type TimelineScale = "focus" | "full";

export interface Timeline {
  /** Time at the right edge of the track. */
  axisMax: number;
  /** True when `focus` actually clipped something. */
  clipped: boolean;
  /** How many bars run past the right edge of the focused axis. */
  clippedCount: number;
  outliers: Set<string>;
  ticks: Array<{ pct: number; label: string }>;
}

export function buildTimeline(run: TraceRun, scale: TimelineScale): Timeline {
  const spans = run.spans;
  const fullMax = Math.max(run.totalDurationMs, ...spans.map((s) => s.offsetMs + s.durationMs), 100);
  const outliers = findOutlierSpans(spans);
  let axisMax = fullMax;
  let clipped = false;
  let clippedCount = 0;
  if (scale === "focus" && outliers.size > 0) {
    const calm = spans.filter((s) => !outliers.has(s.name));
    const calmMax = Math.max(...calm.map((s) => s.offsetMs + s.durationMs), 0);
    const focusMax = Math.max(Math.ceil(calmMax * 1.08), 500);
    if (focusMax < fullMax) {
      axisMax = focusMax;
      clipped = true;
      clippedCount = spans.filter((s) => s.offsetMs + s.durationMs > focusMax).length;
    }
  }
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({ pct: pct * 100, label: formatDuration(axisMax * pct) }));
  return { axisMax, clipped, clippedCount, outliers, ticks };
}

export function barGeometry(span: TraceSpan, axisMax: number): { leftPct: number; widthPct: number; clippedRight: boolean } {
  const rawLeft = (span.offsetMs / axisMax) * 100;
  const leftPct = Math.min(97, Math.max(0, rawLeft));
  const rawWidth = (span.durationMs / axisMax) * 100;
  const widthPct = Math.min(100 - leftPct, Math.max(0.8, rawWidth));
  return { leftPct, widthPct, clippedRight: span.offsetMs + span.durationMs > axisMax };
}

export interface TraceSummary {
  spanCount: number;
  failed: number;
  unavailable: number;
  running: number;
  cached: number;
  slowest: TraceSpan | null;
}

export function summarizeTrace(run: TraceRun | null): TraceSummary {
  const empty: TraceSummary = { spanCount: 0, failed: 0, unavailable: 0, running: 0, cached: 0, slowest: null };
  if (!run) return empty;
  let slowest: TraceSpan | null = null;
  const summary = { ...empty, spanCount: run.spans.length };
  for (const span of run.spans) {
    if (span.status === "failed") summary.failed += 1;
    else if (span.status === "unavailable") summary.unavailable += 1;
    else if (span.status === "running") summary.running += 1;
    if (span.cached) summary.cached += 1;
    if (!slowest || span.durationMs > slowest.durationMs) slowest = span;
  }
  return { ...summary, slowest };
}

/** Wall-clock the run spent, from the first span start to the last span end. */
export function stageWindow(spans: TraceSpan[]): { start: number; end: number } {
  if (spans.length === 0) return { start: 0, end: 0 };
  return {
    start: Math.min(...spans.map((s) => s.offsetMs)),
    end: Math.max(...spans.map((s) => s.offsetMs + s.durationMs)),
  };
}
