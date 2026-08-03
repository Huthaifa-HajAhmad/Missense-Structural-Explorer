import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from "react";
import { ConsoleEntry, DevConsoleState, DevConsoleAction, LogSource, LogStream, StreamState } from "../types/devConsole";

const ERROR_STORAGE_KEY = "devConsoleErrors";
const LIVE_STORAGE_KEY = "devConsoleLive";
const MAX_ENTRIES = 500;

function loadInitialStreamEntries(key: string): ConsoleEntry[] {
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

function createInitialStreamState(storageKey: string): StreamState {
  return {
    entries: loadInitialStreamEntries(storageKey),
    unreadCount: 0,
    isCapturing: true,
    levelFilter: "all",
    sourceFilter: "all",
    searchQuery: "",
  };
}

const initialState: DevConsoleState = {
  errorState: createInitialStreamState(ERROR_STORAGE_KEY),
  liveState: createInitialStreamState(LIVE_STORAGE_KEY),
  activeTab: "error",
};

function pushToStreamState(streamState: StreamState, incoming: Omit<ConsoleEntry, "id" | "timestamp" | "count">): StreamState {
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
      meta: incoming.meta ? { ...existing.meta, ...incoming.meta } : existing.meta,
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
    default:
      return state;
  }
}

export interface DevConsoleContextValue {
  state: DevConsoleState;
  dispatch: React.Dispatch<DevConsoleAction>;
  pushErrorEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => void;
  pushLiveEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => void;
  exportErrorEntries: () => void;
  exportLiveEntries: () => void;
}

const DevConsoleContext = createContext<DevConsoleContextValue | null>(null);

function detectSourceFromArgs(args: any[]): LogSource {
  const firstArg = args[0];
  if (typeof firstArg === "string") {
    if (
      firstArg.startsWith("[DynaMut2]") ||
      firstArg.startsWith("[DDMut]") ||
      firstArg.startsWith("[ThermoMPNN]") ||
      firstArg.startsWith("[ESMFold]") ||
      firstArg.startsWith("[Retry]") ||
      firstArg.startsWith("[Comparison")
    ) {
      return "workflow";
    }
    if (firstArg.startsWith("[ErrorBoundary:")) {
      return "component";
    }
    if (firstArg.startsWith("[Notification Error]") || firstArg.startsWith("[Notification:") || firstArg.startsWith("[Notification")) {
      return "notification";
    }
  }
  return "console";
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

  // Sync to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(ERROR_STORAGE_KEY, JSON.stringify(state.errorState.entries));
    } catch (e) {}
  }, [state.errorState.entries]);

  useEffect(() => {
    try {
      sessionStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(state.liveState.entries));
    } catch (e) {}
  }, [state.liveState.entries]);

  const pushErrorEntry = useCallback((entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => {
    if (isInternalCapturingRef.current) return;
    isInternalCapturingRef.current = true;
    try {
      dispatch({ type: "PUSH_ENTRY", stream: "error", entry });
    } finally {
      isInternalCapturingRef.current = false;
    }
  }, []);

  const pushLiveEntry = useCallback((entry: Omit<ConsoleEntry, "id" | "timestamp" | "count">) => {
    if (isInternalCapturingRef.current) return;
    isInternalCapturingRef.current = true;
    try {
      dispatch({ type: "PUSH_ENTRY", stream: "live", entry });
    } finally {
      isInternalCapturingRef.current = false;
    }
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

  // Install Interceptors
  useEffect(() => {
    const origLog = console.log;
    const origInfo = console.info;
    const origError = console.error;
    const origWarn = console.warn;
    const origFetch = window.fetch;

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
          message: typeof message === "string" ? message : "Runtime Error",
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
          message,
          detail,
        });
      }
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const init = args[1];
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      try {
        const response = await origFetch(...args);
        if (!isInternalCapturingRef.current) {
          if (!response.ok) {
            pushErrorEntry({
              level: response.status >= 500 ? "error" : "warn",
              source: "network",
              message: `${method} ${url} → ${response.status} ${response.statusText}`,
              meta: { url, status: response.status, statusText: response.statusText, method },
            });
          } else if (url.includes("/api/v1/") || method === "POST") {
            pushLiveEntry({
              level: "info",
              source: "network",
              message: `HTTP ${method} ${url} → ${response.status} OK`,
              meta: { url, status: response.status, method },
            });
          }
        }
        return response;
      } catch (err: any) {
        if (err?.name !== "AbortError" && !isInternalCapturingRef.current) {
          pushErrorEntry({
            level: "error",
            source: "network",
            message: `Fetch failed: ${url}`,
            detail: err?.stack || String(err),
            meta: { url, method },
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
    };
  }, [pushErrorEntry, pushLiveEntry]);

  return (
    <DevConsoleContext.Provider
      value={{
        state,
        dispatch,
        pushErrorEntry,
        pushLiveEntry,
        exportErrorEntries,
        exportLiveEntries,
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
