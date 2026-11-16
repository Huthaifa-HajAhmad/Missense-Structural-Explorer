import { useEffect, useSyncExternalStore } from "react";
import {
  DIAGNOSTICS_POLL_MS,
  getDiagnosticsSnapshot,
  holdLivePolling,
  refreshDiagnostics,
  subscribeDiagnostics,
  type DiagnosticsSnapshot
} from "../stores/diagnosticsStore";
import type { DiagnosticsData } from "../types/diagnostics";

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

let cachedGeminiSnapshot: { ready: boolean; snapshot: DiagnosticsSnapshot } | null = null;
function getGeminiReadySnapshot(): DiagnosticsSnapshot {
  const ready = Boolean(getDiagnosticsSnapshot().diagnostics?.geminiReady);
  if (cachedGeminiSnapshot && cachedGeminiSnapshot.ready === ready) {
    return cachedGeminiSnapshot.snapshot;
  }
  const snapshot: DiagnosticsSnapshot = {
    diagnostics: ready ? ({ geminiReady: true } as DiagnosticsData) : null,
    capabilities: null,
    loading: false,
    error: null,
    checkedAt: null,
    lastCheckFailed: false,
    coveragePending: false
  };
  cachedGeminiSnapshot = { ready, snapshot };
  return snapshot;
}

/**
 * The server's health reading. Every caller sees the same one.
 * Pass `live` from a screen that displays it continuously, to keep it on a schedule.
 * Pass `geminiReadyOnly` when the caller only cares whether the server has Gemini configured,
 * so diagnostics polls and capability updates do not trigger redundant re-renders.
 */
export function useDiagnostics({ live = false, geminiReadyOnly = false }: { live?: boolean; geminiReadyOnly?: boolean } = {}) {
  const readSnapshot = geminiReadyOnly ? getGeminiReadySnapshot : getDiagnosticsSnapshot;
  const snapshot = useSyncExternalStore(subscribeDiagnostics, readSnapshot, readSnapshot);
  useEffect(() => (live ? holdLivePolling() : undefined), [live]);
  return { ...snapshot, refresh };
}
