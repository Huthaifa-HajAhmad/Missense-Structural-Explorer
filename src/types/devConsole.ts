/** Severity levels — maps 1:1 to standard console methods */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** Source system that produced the entry */
export type LogSource =
  | "runtime"       // window.onerror, unhandledrejection
  | "console"       // intercepted console logs (generic)
  | "network"       // fetch calls
  | "component"     // ErrorBoundary catches
  | "workflow"      // entries with known prefixes like [DynaMut2], [ESMFold], [Retry]
  | "notification"; // UI toast notifications

/** Stream identifier */
export type LogStream = "error" | "live" | "tracing";

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
  message: string;                 // human-readable summary
  detail?: string;                 // stack trace, response body, etc.
  meta?: Record<string, unknown>;  // url, status, componentName, etc.
  count: number;                   // dedup counter — incremented on repeat
}

/** State for an individual stream */
export interface StreamState {
  entries: ConsoleEntry[];
  unreadCount: number;
  isCapturing: boolean;            // pause/resume toggle
  levelFilter: LogLevel | "all";
  sourceFilter: LogSource | "all";
  searchQuery: string;
}

/** Overall Reducer state */
export interface DevConsoleState {
  errorState: StreamState;
  liveState: StreamState;
  telemetrySpans: TelemetrySpan[];
  activeTab: LogStream;
}

/** Reducer actions */
export type DevConsoleAction =
  | { type: "PUSH_ENTRY"; stream: LogStream; entry: Omit<ConsoleEntry, "id" | "timestamp" | "count"> }
  | { type: "CLEAR_STREAM"; stream: LogStream }
  | { type: "MARK_READ"; stream: LogStream }
  | { type: "TOGGLE_CAPTURE"; stream: LogStream }
  | { type: "SET_LEVEL_FILTER"; stream: LogStream; level: LogLevel | "all" }
  | { type: "SET_SOURCE_FILTER"; stream: LogStream; source: LogSource | "all" }
  | { type: "SET_SEARCH"; stream: LogStream; query: string }
  | { type: "SET_ACTIVE_TAB"; tab: LogStream }
  | { type: "ADD_TELEMETRY_SPAN"; span: Omit<TelemetrySpan, "timestamp"> }
  | { type: "CLEAR_TELEMETRY" };
