import { useEffect, useSyncExternalStore } from "react";
import {
  DIAGNOSTICS_POLL_MS,
  getDiagnosticsSnapshot,
  holdLivePolling,
  refreshDiagnostics,
  subscribeDiagnostics
} from "../stores/diagnosticsStore";

export type {
  CacheDiagnostic,
  CapabilitiesData,
  DiagnosticsData,
  FallbackHealthItem,
  FallbackVerdictKind,
  ServiceHealthItem,
  VersionData
} from "../types/diagnostics";
export { DIAGNOSTICS_POLL_MS };

const refresh = () => refreshDiagnostics();

/**
 * The server's health reading. Every caller sees the same one.
 * Pass `live` from a screen that displays it continuously, to keep it on a schedule.
 */
export function useDiagnostics({ live = false }: { live?: boolean } = {}) {
  const snapshot = useSyncExternalStore(subscribeDiagnostics, getDiagnosticsSnapshot, getDiagnosticsSnapshot);
  useEffect(() => (live ? holdLivePolling() : undefined), [live]);
  return { ...snapshot, refresh };
}
