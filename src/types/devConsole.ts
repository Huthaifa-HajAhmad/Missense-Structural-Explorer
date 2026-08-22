/** Severity levels — maps to standard console and diagnostic levels */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** Source system that produced the entry */
export type LogSource =
  | "runtime"       // window.onerror, unhandledrejection
  | "console"       // intercepted console logs (generic)
  | "network"       // fetch calls & HTTP API requests
  | "component"     // ErrorBoundary catches
  | "workflow"      // background orchestrator and workflow events
  | "biophysics"    // FoldX, StabilityOracle, DynaMut2, DDMut, ThermoMPNN, ESM-2/3, SaProt
  | "genomics"      // Ensembl VEP, MANE Select, Splice Resolver, transcript parsing
  | "structure-3d"  // AlphaFold, PDB parser, Pocket Finder, Mol* viewer
  | "ai-narrative"  // Gemini clinical reasoning, ACMG synthesis
  | "literature"    // PubMed, LitRAG, semantic search
  | "notification"  // UI toasts and alerts
  | "system";       // WebGL, Worker pools, cache layer

/** Error impact classification for clinical/operational severity */
export type ErrorImpact = "fatal" | "degraded" | "recoverable" | "info";

/** Pipeline stages for Gantt waterfall tracing */
export type PipelineStage = "genomics" | "structure" | "biophysics" | "clinical";

/** Stream identifier */
export type LogStream = "error" | "live" | "tracing";

/** Session environment context attached to log entries */
export interface SessionContext {
  gene?: string;
  variant?: string;
  uniprotId?: string;
  activeView?: string;
  online?: boolean;
  memoryMB?: number;
}

/** HTTP request/response diagnostic metadata */
export interface HttpMeta {
  url?: string;
  method?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  requestBody?: unknown;
  responseBody?: string | unknown;
  cached?: boolean;
}

/** A single trace span in the pipeline Gantt waterfall */
export interface TraceSpan {
  id: string;
  traceId: string;
  name: string;
  stage: PipelineStage;
  startTime: number;
  offsetMs: number;
  durationMs: number;
  status: "success" | "failed" | "running";
  cached?: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

/** Complete pipeline trace execution run */
export interface TraceRun {
  traceId: string;
  query: string;
  timestamp: number;
  totalDurationMs: number;
  status: "running" | "completed" | "failed";
  spans: TraceSpan[];
}

/** Legacy TelemetrySpan for backwards compatibility */
export interface TelemetrySpan {
  name: string;
  durationMs: number;
  status: "success" | "failed";
  timestamp: number;
}

/** A single log entry */
export interface ConsoleEntry {
  id: string;                      // crypto.randomUUID()
  timestamp: number;               // Date.now()
  level: LogLevel;
  source: LogSource;
  impact?: ErrorImpact;
  message: string;                 // human-readable summary
  detail?: string;                 // stack trace, response body, etc.
  meta?: Record<string, unknown>;  // url, status, componentName, etc.
  httpMeta?: HttpMeta;
  sessionContext?: SessionContext;
  count: number;                   // dedup counter — incremented on repeat
}

/** State for an individual stream */
export interface StreamState {
  entries: ConsoleEntry[];
  unreadCount: number;
  isCapturing: boolean;            // pause/resume toggle
  levelFilter: LogLevel | "all";
  sourceFilter: LogSource | "all";
  impactFilter: ErrorImpact | "all";
  searchQuery: string;
}

/** Overall Reducer state */
export interface DevConsoleState {
  errorState: StreamState;
  liveState: StreamState;
  telemetrySpans: TelemetrySpan[]; // legacy list
  traceRuns: TraceRun[];           // full multi-stage trace executions
  activeTraceRun: TraceRun | null; // currently running or inspected trace
  activeTab: LogStream;
  sessionContext: SessionContext;
}

/** Reducer actions */
export type DevConsoleAction =
  | { type: "PUSH_ENTRY"; stream: LogStream; entry: Omit<ConsoleEntry, "id" | "timestamp" | "count"> }
  | { type: "CLEAR_STREAM"; stream: LogStream }
  | { type: "MARK_READ"; stream: LogStream }
  | { type: "TOGGLE_CAPTURE"; stream: LogStream }
  | { type: "SET_LEVEL_FILTER"; stream: LogStream; level: LogLevel | "all" }
  | { type: "SET_SOURCE_FILTER"; stream: LogStream; source: LogSource | "all" }
  | { type: "SET_IMPACT_FILTER"; stream: LogStream; impact: ErrorImpact | "all" }
  | { type: "SET_SEARCH"; stream: LogStream; query: string }
  | { type: "SET_ACTIVE_TAB"; tab: LogStream }
  | { type: "UPDATE_SESSION_CONTEXT"; context: Partial<SessionContext> }
  | { type: "START_TRACE_RUN"; traceId: string; query: string; timestamp?: number }
  | { type: "ADD_TRACE_SPAN"; span: Omit<TraceSpan, "id"> }
  | { type: "UPDATE_TRACE_SPAN"; traceId: string; spanName: string; updates: Partial<TraceSpan> }
  | { type: "FINISH_TRACE_RUN"; traceId: string; status?: "completed" | "failed" }
  | { type: "SET_ACTIVE_TRACE_RUN"; traceId: string }
  | { type: "CLEAR_TRACES" }
  | { type: "ADD_TELEMETRY_SPAN"; span: Omit<TelemetrySpan, "timestamp"> }
  | { type: "CLEAR_TELEMETRY" };
