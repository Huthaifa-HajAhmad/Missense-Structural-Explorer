import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from "react";
import {
  ConsoleEntry,
  DevConsoleState,
  DevConsoleAction,
  LogSource,
  LogStream,
  StreamState,
  ErrorImpact,
  TraceRun,
  TraceSpan,
  PipelineStage,
  SessionContext
} from "../types/devConsole";

const ERROR_STORAGE_KEY = "devConsoleErrors";
const LIVE_STORAGE_KEY = "devConsoleLive";
const TRACE_STORAGE_KEY = "devConsoleTraces";
const MAX_ENTRIES = 500;
const MAX_TRACES = 25;

function loadInitialStreamEntries(key: string): ConsoleEntry[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error(`Failed to load entries from sessionStorage for key ${key}:`, e);
  }
  return [];
}

function loadInitialTraces(): TraceRun[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(TRACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    // Ignore trace load errors
  }
  return [];
}

function createInitialStreamState(storageKey: string): StreamState {
  return {
    entries: loadInitialStreamEntries(storageKey),
    unreadCount: 0,
    isCapturing: true,
    levelFilter: "all",
    sourceFilter: "all",
    impactFilter: "all",
    searchQuery: "",
  };
}

function getMemoryUsageMB(): number | undefined {
  if (typeof window !== "undefined" && (window.performance as any)?.memory?.usedJSHeapSize) {
    return Math.round((window.performance as any).memory.usedJSHeapSize / (1024 * 1024));
  }
  return undefined;
}

const initialSessionContext: SessionContext = {
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  memoryMB: getMemoryUsageMB(),
};

const initialTraces = loadInitialTraces();

const initialState: DevConsoleState = {
  errorState: createInitialStreamState(ERROR_STORAGE_KEY),
  liveState: createInitialStreamState(LIVE_STORAGE_KEY),
  telemetrySpans: [],
  traceRuns: initialTraces,
  activeTraceRun: initialTraces.length > 0 ? initialTraces[0] : null,
  activeTab: "error",
  sessionContext: initialSessionContext,
};

function pushToStreamState(
  streamState: StreamState,
  incoming: Omit<ConsoleEntry, "id" | "timestamp" | "count">
): StreamState {
  if (!streamState.isCapturing) return streamState;

  // Check last 5 entries for deduplication
  const recentEntries = streamState.entries.slice(0, 5);
  const matchIndex = recentEntries.findIndex(
    (e) => e.message === incoming.message && e.source === incoming.source && e.level === incoming.level
  );

  if (matchIndex !== -1) {
    const newEntries = [...streamState.entries];
    const existing = newEntries[matchIndex];
    newEntries[matchIndex] = {
      ...existing,
      count: existing.count + 1,
      timestamp: Date.now(),
      detail: incoming.detail || existing.detail,
      impact: incoming.impact || existing.impact,
      meta: incoming.meta ? { ...existing.meta, ...incoming.meta } : existing.meta,
      httpMeta: incoming.httpMeta ? { ...existing.httpMeta, ...incoming.httpMeta } : existing.httpMeta,
      sessionContext: incoming.sessionContext ? { ...existing.sessionContext, ...incoming.sessionContext } : existing.sessionContext,
    };
    return {
      ...streamState,
      entries: newEntries,
      unreadCount: streamState.unreadCount + 1,
    };
  }

  const newEntry: ConsoleEntry = {
    ...incoming,
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    count: 1,
  };

  const updatedEntries = [newEntry, ...streamState.entries].slice(0, MAX_ENTRIES);
  return {
    ...streamState,
    entries: updatedEntries,
    unreadCount: streamState.unreadCount + 1,
  };
}

function devConsoleReducer(state: DevConsoleState, action: DevConsoleAction): DevConsoleState {
  switch (action.type) {
    case "PUSH_ENTRY": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: pushToStreamState(state[key], action.entry),
      };
    }
    case "CLEAR_STREAM": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: {
          ...state[key],
          entries: [],
          unreadCount: 0,
        },
      };
    }
    case "MARK_READ": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: {
          ...state[key],
          unreadCount: 0,
        },
      };
    }
    case "TOGGLE_CAPTURE": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: {
          ...state[key],
          isCapturing: !state[key].isCapturing,
        },
      };
    }
    case "SET_LEVEL_FILTER": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: {
          ...state[key],
          levelFilter: action.level,
        },
      };
    }
    case "SET_SOURCE_FILTER": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: {
          ...state[key],
          sourceFilter: action.source,
        },
      };
    }
    case "SET_IMPACT_FILTER": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: {
          ...state[key],
          impactFilter: action.impact,
        },
      };
    }
    case "SET_SEARCH": {
      const key = action.stream === "error" ? "errorState" : "liveState";
      return {
        ...state,
        [key]: {
          ...state[key],
          searchQuery: action.query,
        },
      };
    }
    case "SET_ACTIVE_TAB":
      return {
        ...state,
        activeTab: action.tab,
      };
    case "UPDATE_SESSION_CONTEXT":
      return {
        ...state,
        sessionContext: {
          ...state.sessionContext,
          ...action.context,
          memoryMB: getMemoryUsageMB(),
        },
      };
    case "START_TRACE_RUN": {
      const newTraceRun: TraceRun = {
        traceId: action.traceId,
        query: action.query,
        timestamp: action.timestamp || Date.now(),
        totalDurationMs: 0,
        status: "running",
        spans: [],
      };
      const updatedRuns = [newTraceRun, ...state.traceRuns.filter((r) => r.traceId !== action.traceId)].slice(
        0,
        MAX_TRACES
      );
      return {
        ...state,
        traceRuns: updatedRuns,
        activeTraceRun: newTraceRun,
      };
    }
    case "ADD_TRACE_SPAN": {
      const newSpan: TraceSpan = {
        ...action.span,
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      };

      const updatedRuns = state.traceRuns.map((run) => {
        if (run.traceId === newSpan.traceId) {
          const spans = [...run.spans.filter((s) => s.name !== newSpan.name), newSpan];
          const maxEnd = Math.max(...spans.map((s) => s.offsetMs + s.durationMs), 0);
          return {
            ...run,
            totalDurationMs: maxEnd,
            spans,
          };
        }
        return run;
      });

      const updatedActive =
        state.activeTraceRun && state.activeTraceRun.traceId === newSpan.traceId
          ? updatedRuns.find((r) => r.traceId === newSpan.traceId) || state.activeTraceRun
          : state.activeTraceRun;

      return {
        ...state,
        traceRuns: updatedRuns,
        activeTraceRun: updatedActive,
      };
    }
    case "UPDATE_TRACE_SPAN": {
      const updatedRuns = state.traceRuns.map((run) => {
        if (run.traceId === action.traceId) {
          const spans = run.spans.map((span) => {
            if (span.name === action.spanName) {
              return { ...span, ...action.updates };
            }
            return span;
          });
          const maxEnd = Math.max(...spans.map((s) => s.offsetMs + s.durationMs), 0);
          return {
            ...run,
            totalDurationMs: maxEnd,
            spans,
          };
        }
        return run;
      });

      const updatedActive =
        state.activeTraceRun && state.activeTraceRun.traceId === action.traceId
          ? updatedRuns.find((r) => r.traceId === action.traceId) || state.activeTraceRun
          : state.activeTraceRun;

      return {
        ...state,
        traceRuns: updatedRuns,
        activeTraceRun: updatedActive,
      };
    }
    case "FINISH_TRACE_RUN": {
      const updatedRuns = state.traceRuns.map((run) => {
        if (run.traceId === action.traceId) {
          const maxEnd = Math.max(...run.spans.map((s) => s.offsetMs + s.durationMs), Date.now() - run.timestamp);
          const hasFailedSpan = run.spans.some((s) => s.status === "failed");
          return {
            ...run,
            totalDurationMs: Math.max(maxEnd, 1),
            status: action.status || (hasFailedSpan ? "failed" : "completed"),
          };
        }
        return run;
      });

      const updatedActive =
        state.activeTraceRun && state.activeTraceRun.traceId === action.traceId
          ? updatedRuns.find((r) => r.traceId === action.traceId) || state.activeTraceRun
          : state.activeTraceRun;

      return {
        ...state,
        traceRuns: updatedRuns,
        activeTraceRun: updatedActive,
      };
    }
    case "SET_ACTIVE_TRACE_RUN": {
      const active = state.traceRuns.find((r) => r.traceId === action.traceId) || null;
      return {
        ...state,
        activeTraceRun: active,
      };
    }
    case "CLEAR_TRACES": {
      return {
        ...state,
        traceRuns: [],
        activeTraceRun: null,
        telemetrySpans: [],
      };
    }
    case "ADD_TELEMETRY_SPAN": {
      const newSpan = {
        ...action.span,
        timestamp: Date.now(),
      };
      const updated = [newSpan, ...state.telemetrySpans].slice(0, 50);
      return {
        ...state,
        telemetrySpans: updated,
      };
    }
    case "CLEAR_TELEMETRY": {
      return {
        ...state,
        telemetrySpans: [],
      };
    }
    default:
      return state;
  }
}

export interface DevConsoleContextValue {
  state: DevConsoleState;
  dispatch: React.Dispatch<DevConsoleAction>;
  pushErrorEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => void;
  pushLiveEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => void;
  startTraceRun: (query: string, customTraceId?: string) => string;
  addTraceSpan: (span: Omit<TraceSpan, "id">) => void;
  updateTraceSpan: (traceId: string, spanName: string, updates: Partial<TraceSpan>) => void;
  finishTraceRun: (traceId: string, status?: "completed" | "failed") => void;
  exportErrorEntries: () => void;
  exportLiveEntries: () => void;
  exportTraceRuns: () => void;
}

const DevConsoleContext = createContext<DevConsoleContextValue | null>(null);

function detectSourceFromArgs(args: any[]): LogSource {
  const firstArg = args[0];
  if (typeof firstArg === "string") {
    const s = firstArg.toLowerCase();
    if (
      s.startsWith("[dynamut2]") ||
      s.startsWith("[ddmut]") ||
      s.startsWith("[thermompnn]") ||
      s.startsWith("[foldx]") ||
      s.startsWith("[stabilityoracle]") ||
      s.startsWith("[esm-2]") ||
      s.startsWith("[esm-3]") ||
      s.startsWith("[esmc]") ||
      s.startsWith("[saprot]") ||
      s.startsWith("[biophysical") ||
      s.startsWith("[comparison")
    ) {
      return "biophysics";
    }
    if (s.startsWith("[vep]") || s.startsWith("[mane]") || s.startsWith("[splice]") || s.startsWith("[genomic]")) {
      return "genomics";
    }
    if (
      s.startsWith("[pdb]") ||
      s.startsWith("[alphafold]") ||
      s.startsWith("[pocket]") ||
      s.startsWith("[mol*]") ||
      s.startsWith("[structure")
    ) {
      return "structure-3d";
    }
    if (s.startsWith("[gemini]") || s.startsWith("[narrative]") || s.startsWith("[acmg]") || s.startsWith("[clinical]")) {
      return "ai-narrative";
    }
    if (s.startsWith("[pubmed]") || s.startsWith("[litrag]") || s.startsWith("[literature]")) {
      return "literature";
    }
    if (s.startsWith("[errorboundary:")) {
      return "component";
    }
    if (s.startsWith("[notification")) {
      return "notification";
    }
    if (s.startsWith("[cache]") || s.startsWith("[worker]") || s.startsWith("[webgl]")) {
      return "system";
    }
    if (s.startsWith("[retry]") || s.startsWith("[pipeline]")) {
      return "workflow";
    }
    if (s.startsWith("[network]") || s.startsWith("[http]") || s.startsWith("[fetch]")) {
      return "network";
    }
  }
  return "console";
}

function classifyImpact(source: LogSource, level: "error" | "warn" | "info" | "debug", message: string, status?: number): ErrorImpact {
  if (level === "info" || level === "debug") return "info";
  if (status === 429 || message.toLowerCase().includes("retry") || message.toLowerCase().includes("rate limit")) {
    return "recoverable";
  }
  if (status === 500 || level === "error" && (source === "runtime" || source === "component" || message.includes("Variant analysis failed"))) {
    return "fatal";
  }
  if (status === 404 || status === 503 || level === "warn" || source === "literature" || source === "notification") {
    return "degraded";
  }
  return level === "error" ? "fatal" : "degraded";
}

function formatArgsMessage(args: any[]): { message: string; detail?: string } {
  const messageParts = args.map((arg) => {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });

  const message = messageParts.join(" ");
  const errorArg = args.find((arg) => arg instanceof Error);
  const detail = errorArg?.stack;

  return { message, detail };
}

export function DevConsoleProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(devConsoleReducer, initialState);
  const isInternalCapturingRef = useRef(false);
  const sessionContextRef = useRef<SessionContext>(state.sessionContext);

  useEffect(() => {
    sessionContextRef.current = state.sessionContext;
  }, [state.sessionContext]);

  // Debounced sync to sessionStorage to prevent main-thread jank and quota exhaustion
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(ERROR_STORAGE_KEY, JSON.stringify(state.errorState.entries.slice(-100)));
        }
      } catch (e) {}
    }, 500);
    return () => clearTimeout(timer);
  }, [state.errorState.entries]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(state.liveState.entries.slice(-100)));
        }
      } catch (e) {}
    }, 500);
    return () => clearTimeout(timer);
  }, [state.liveState.entries]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(state.traceRuns.slice(-50)));
        }
      } catch (e) {}
    }, 500);
    return () => clearTimeout(timer);
  }, [state.traceRuns]);

  const pushErrorEntry = useCallback((entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => {
    if (isInternalCapturingRef.current) return;
    isInternalCapturingRef.current = true;
    try {
      const impact = entry.impact || classifyImpact(entry.source, entry.level, entry.message, entry.httpMeta?.status);
      const sessionContext = entry.sessionContext || { ...sessionContextRef.current, memoryMB: getMemoryUsageMB() };
      dispatch({ type: "PUSH_ENTRY", stream: "error", entry: { ...entry, impact, sessionContext } });
    } finally {
      isInternalCapturingRef.current = false;
    }
  }, []);

  const pushLiveEntry = useCallback((entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => {
    if (isInternalCapturingRef.current) return;
    isInternalCapturingRef.current = true;
    try {
      const impact = entry.impact || "info";
      const sessionContext = entry.sessionContext || { ...sessionContextRef.current, memoryMB: getMemoryUsageMB() };
      dispatch({ type: "PUSH_ENTRY", stream: "live", entry: { ...entry, impact, sessionContext } });
    } finally {
      isInternalCapturingRef.current = false;
    }
  }, []);

  const startTraceRun = useCallback((query: string, customTraceId?: string): string => {
    const traceId = customTraceId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `trace-${Date.now()}`);
    dispatch({ type: "START_TRACE_RUN", traceId, query, timestamp: Date.now() });
    return traceId;
  }, []);

  const addTraceSpan = useCallback((span: Omit<TraceSpan, "id">) => {
    dispatch({ type: "ADD_TRACE_SPAN", span });
    // Also push to legacy telemetry spans for backwards compatibility
    if (span.status !== "running") {
      dispatch({
        type: "ADD_TELEMETRY_SPAN",
        span: {
          name: span.name,
          durationMs: span.durationMs,
          status: span.status === "failed" ? "failed" : "success",
        },
      });
    }
  }, []);

  const updateTraceSpan = useCallback((traceId: string, spanName: string, updates: Partial<TraceSpan>) => {
    dispatch({ type: "UPDATE_TRACE_SPAN", traceId, spanName, updates });
  }, []);

  const finishTraceRun = useCallback((traceId: string, status?: "completed" | "failed") => {
    dispatch({ type: "FINISH_TRACE_RUN", traceId, status });
  }, []);

  const exportErrorEntries = useCallback(() => {
    const blob = new Blob([JSON.stringify(state.errorState.entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `error-console-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.errorState.entries]);

  const exportLiveEntries = useCallback(() => {
    const blob = new Blob([JSON.stringify(state.liveState.entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `live-console-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.liveState.entries]);

  const exportTraceRuns = useCallback(() => {
    const blob = new Blob([JSON.stringify(state.traceRuns, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline-traces-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.traceRuns]);

  // Install Global Interceptors
  useEffect(() => {
    const origLog = console.log.bind(console);
    const origInfo = console.info.bind(console);
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const origFetch = window.fetch.bind(window);

    console.log = (...args: any[]) => {
      origLog(...args);
      if (!isInternalCapturingRef.current) {
        const source = detectSourceFromArgs(args);
        const { message, detail } = formatArgsMessage(args);
        pushLiveEntry({ level: "info", source, message, detail });
      }
    };

    console.info = (...args: any[]) => {
      origInfo(...args);
      if (!isInternalCapturingRef.current) {
        const source = detectSourceFromArgs(args);
        const { message, detail } = formatArgsMessage(args);
        pushLiveEntry({ level: "info", source, message, detail });
      }
    };

    console.error = (...args: any[]) => {
      origError(...args);
      if (!isInternalCapturingRef.current) {
        const source = detectSourceFromArgs(args);
        const { message, detail } = formatArgsMessage(args);
        pushErrorEntry({ level: "error", source, message, detail });
      }
    };

    console.warn = (...args: any[]) => {
      origWarn(...args);
      if (!isInternalCapturingRef.current) {
        const source = detectSourceFromArgs(args);
        const { message, detail } = formatArgsMessage(args);
        pushErrorEntry({ level: "warn", source, message, detail });
      }
    };

    const handleWindowError = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error
    ) => {
      if (!isInternalCapturingRef.current) {
        pushErrorEntry({
          level: "error",
          source: "runtime",
          impact: "fatal",
          message: typeof message === "string" ? message : "Runtime Exception",
          detail: error?.stack,
          meta: { file: source, line: lineno, col: colno },
        });
      }
    };
    window.onerror = handleWindowError;

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isInternalCapturingRef.current) {
        const reason = event.reason;
        const message = reason?.message || String(reason || "Unhandled Promise Rejection");
        const detail = reason?.stack;
        pushErrorEntry({
          level: "error",
          source: "runtime",
          impact: "fatal",
          message,
          detail,
        });
      }
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    // Intercept WebGL context loss for Mol* 3D rendering failures
    const handleContextLost = (event: Event) => {
      if (!isInternalCapturingRef.current) {
        pushErrorEntry({
          level: "error",
          source: "structure-3d",
          impact: "degraded",
          message: "WebGL Context Lost — 3D Mol* canvas GPU context was interrupted.",
          detail: "Canvas GPU context was reclaimed by browser. Reloading structure or viewer component is recommended.",
        });
      }
    };
    window.addEventListener("webglcontextlost", handleContextLost, true);

    // Enhanced window.fetch interceptor with safe response error body extraction
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const init = args[1];
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const startTime = performance.now();

      try {
        const response = await origFetch(...args);
        const durationMs = Math.round(performance.now() - startTime);

        if (!isInternalCapturingRef.current) {
          if (!response.ok) {
            // Clone response safely to read error body without consuming caller's stream
            let responseBody: string | undefined;
            try {
              const clone = response.clone();
              const text = await clone.text();
              responseBody = text.slice(0, 4096); // limit to 4KB
            } catch (e) {
              responseBody = "[Failed to read response body]";
            }

            let parsedError: any = null;
            if (responseBody) {
              try {
                parsedError = JSON.parse(responseBody);
              } catch (e) {}
            }

            const rawError = parsedError?.error;
            const errorSummary =
              (typeof rawError === "string"
                ? rawError
                : rawError?.message || parsedError?.message) ||
              response.statusText;
            const message = `${method} ${url} → ${response.status} ${response.statusText}${errorSummary && errorSummary !== response.statusText ? ` (${errorSummary})` : ""}`;
            const isCritical = url.includes("/api/v1/variant/analyze") || (url.includes("/api/v1/structure/") && !url.includes("/homologs"));
            const impact: ErrorImpact = response.status >= 500 && isCritical ? "fatal" : response.status === 429 ? "recoverable" : "degraded";

            pushErrorEntry({
              level: response.status >= 500 ? "error" : "warn",
              source: "network",
              impact,
              message,
              detail: responseBody ? `HTTP Status: ${response.status}\n\nServer Response Payload:\n${responseBody}` : undefined,
              httpMeta: {
                url,
                method,
                status: response.status,
                statusText: response.statusText,
                durationMs,
                responseBody: parsedError || responseBody,
              },
              meta: { url, status: response.status, statusText: response.statusText, method, durationMs },
            });
          } else if (url.includes("/api/v1/") || method === "POST") {
            pushLiveEntry({
              level: "info",
              source: "network",
              impact: "info",
              message: `HTTP ${method} ${url} → ${response.status} OK (${durationMs}ms)`,
              httpMeta: { url, method, status: response.status, statusText: "OK", durationMs },
              meta: { url, status: response.status, method, durationMs },
            });
          }
        }
        return response;
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - startTime);
        if (err?.name !== "AbortError" && !isInternalCapturingRef.current) {
          const isCritical = url.includes("/api/v1/variant/analyze") || (url.includes("/api/v1/structure/") && !url.includes("/homologs"));
          const isTimeout = err?.name === "TimeoutError" || err?.message?.toLowerCase().includes("timed out");
          const impact: ErrorImpact = isCritical ? "fatal" : isTimeout ? "degraded" : "recoverable";

          pushErrorEntry({
            level: isCritical ? "error" : "warn",
            source: "network",
            impact,
            message: `Fetch failed: ${method} ${url}`,
            detail: err?.stack || String(err),
            httpMeta: { url, method, status: 0, durationMs },
            meta: { url, method, durationMs },
          });
        }
        throw err;
      }
    };

    return () => {
      console.log = origLog;
      console.info = origInfo;
      console.error = origError;
      console.warn = origWarn;
      window.fetch = origFetch;
      window.onerror = null;
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("webglcontextlost", handleContextLost, true);
    };
  }, [pushErrorEntry, pushLiveEntry]);

  return (
    <DevConsoleContext.Provider
      value={{
        state,
        dispatch,
        pushErrorEntry,
        pushLiveEntry,
        startTraceRun,
        addTraceSpan,
        updateTraceSpan,
        finishTraceRun,
        exportErrorEntries,
        exportLiveEntries,
        exportTraceRuns,
      }}
    >
      {children}
    </DevConsoleContext.Provider>
  );
}

export function useDevConsole(): DevConsoleContextValue {
  const context = useContext(DevConsoleContext);
  if (!context) {
    throw new Error("useDevConsole must be used within a DevConsoleProvider");
  }
  return context;
}
