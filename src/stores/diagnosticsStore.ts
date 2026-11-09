import type { CapabilitiesData, DiagnosticsData } from "../types/diagnostics";

/**
 * The one health reading of the server, shared by every screen that shows it.
 *
 * A fetch starts when the first reader subscribes and is reused by the others. Only a "live" reader
 * (the Services rail) keeps it on a schedule; a screen that needs one reading does not cause polling.
 */
export interface DiagnosticsSnapshot {
  diagnostics: DiagnosticsData | null;
  capabilities: CapabilitiesData | null;
  loading: boolean;
  error: string | null;
  /** When the last successful reading arrived (browser clock), or null before the first one. */
  checkedAt: number | null;
  lastCheckFailed: boolean;
  /** Ensembl is down and more follow-ups are coming for its fallback verdict. */
  coveragePending: boolean;
}

/** Longer than the whole follow-up schedule below (29.5 s), so a scheduled check never cuts it short. */
export const DIAGNOSTICS_POLL_MS = 60_000;

/**
 * How long a caller waits for the first reading before it decides without one. Generous enough for a
 * cold server probing every source, and still a bound: a health request that is accepted and never
 * answered must not hold a pipeline's completion open.
 */
export const FIRST_READING_DEADLINE_MS = 15_000;

/**
 * The server does not wait for the fallback probe, so the first payload after an Ensembl failure has no
 * verdict. These delays cover the probe's whole 15 s budget; the fixed count means they cannot become a loop.
 */
const FALLBACK_FOLLOW_UP_DELAYS_MS = [1500, 4000, 8000, 16000];

const IDLE: DiagnosticsSnapshot = {
  diagnostics: null,
  capabilities: null,
  loading: true,
  error: null,
  checkedAt: null,
  lastCheckFailed: false,
  coveragePending: false,
};

let snapshot = IDLE;
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let inFlight = false;
let followUpTimer: ReturnType<typeof setTimeout> | null = null;
let followUpAttempts = 0;
let liveReaders = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function publish(patch: Partial<DiagnosticsSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(listener => listener());
}

function clearFollowUp(): void {
  if (followUpTimer) clearTimeout(followUpTimer);
  followUpTimer = null;
}

/** Arms the next follow-up when Ensembl is down with no verdict. Returns whether one is coming. */
function armCoverageFollowUp(payload: DiagnosticsData): boolean {
  const ensembl = payload?.serviceHealth?.ensembl;
  if (!ensembl || ensembl.healthy || ensembl.fallback) {
    followUpAttempts = 0;
    return false;
  }
  if (followUpAttempts >= FALLBACK_FOLLOW_UP_DELAYS_MS.length) return false;
  const delay = FALLBACK_FOLLOW_UP_DELAYS_MS[followUpAttempts];
  followUpAttempts += 1;
  followUpTimer = setTimeout(() => {
    followUpTimer = null;
    void refreshDiagnostics({ scheduled: true });
  }, delay);
  return true;
}

function loadCapabilities(signal: AbortSignal): void {
  void fetch("/api/v1/capabilities", { signal })
    .then(response => (response.ok ? response.json() : null))
    .catch(() => null)
    .then(capabilities => {
      // A failed call clears the old answer: a stale "warming up" must not outlive the check that set it.
      if (!signal.aborted) publish({ capabilities });
    });
}

/**
 * Takes a new reading. `scheduled` is a follow-up or a poll: it keeps the spent follow-up count and does
 * not raise `loading`, so a background check does not look like the reader pressed something.
 */
export async function refreshDiagnostics({ scheduled = false }: { scheduled?: boolean } = {}): Promise<void> {
  controller?.abort();
  clearFollowUp();
  if (!scheduled) followUpAttempts = 0;
  const current = new AbortController();
  controller = current;
  inFlight = true;
  publish({ loading: !scheduled || snapshot.diagnostics === null, error: null });

  loadCapabilities(current.signal);
  const response = await fetch("/api/v1/diagnostics", { signal: current.signal }).catch(() => null);
  const payload: DiagnosticsData | null = response?.ok ? await response.json().catch(() => null) : null;
  if (current.signal.aborted) return;

  inFlight = false;
  if (!payload) {
    publish({
      loading: false,
      lastCheckFailed: true,
      coveragePending: false,
      error: `Diagnostics unavailable${response ? ` (HTTP ${response.status})` : ""}.`,
    });
    return;
  }
  publish({
    diagnostics: payload,
    loading: false,
    checkedAt: Date.now(),
    lastCheckFailed: false,
    coveragePending: armCoverageFollowUp(payload),
  });
}

function refreshIfOld(): void {
  if (inFlight) return;
  if (snapshot.checkedAt === null || Date.now() - snapshot.checkedAt >= DIAGNOSTICS_POLL_MS) void refreshDiagnostics({ scheduled: true });
}

function reset(): void {
  controller?.abort();
  controller = null;
  inFlight = false;
  clearFollowUp();
  followUpAttempts = 0;
  snapshot = IDLE;
}

export function getDiagnosticsSnapshot(): DiagnosticsSnapshot {
  return snapshot;
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) void refreshDiagnostics();
  else refreshIfOld();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) reset();
  };
}

/**
 * Resolves with the first reading that has answered, whether it succeeded or failed.
 *
 * A request that is accepted but never answered would otherwise hold its caller — the pipeline waits
 * here before it may finish — so the wait is bounded. Reaching the deadline answers with "no reading",
 * which every caller already handles, and the attempt itself keeps running.
 */
export function firstDiagnosticsReading(deadlineMs = FIRST_READING_DEADLINE_MS): Promise<DiagnosticsSnapshot> {
  const answered = () => snapshot.checkedAt !== null || snapshot.lastCheckFailed;
  if (answered()) return Promise.resolve(snapshot);
  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      // Read before releasing: the last reader's release resets the store, so the answer must be held.
      const reading = snapshot;
      unsubscribe();
      resolve(reading);
    };
    unsubscribe = subscribeDiagnostics(() => { if (answered()) finish(); });
    if (answered()) { finish(); return; }
    timer = setTimeout(finish, deadlineMs);
  });
}

function pollIfVisible(): void {
  if (document.visibilityState === "visible" && !followUpTimer) void refreshDiagnostics({ scheduled: true });
}

function refreshOnReturn(): void {
  if (document.visibilityState === "visible") refreshIfOld();
}

/** Keeps the reading on a schedule while the browser tab is visible. Returns the release. */
export function holdLivePolling(): () => void {
  liveReaders += 1;
  if (liveReaders === 1) {
    pollTimer = setInterval(pollIfVisible, DIAGNOSTICS_POLL_MS);
    document.addEventListener("visibilitychange", refreshOnReturn);
  }
  return () => {
    liveReaders -= 1;
    if (liveReaders > 0) return;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    document.removeEventListener("visibilitychange", refreshOnReturn);
  };
}
