/**
 * Tells the page when the server has been updated since the page loaded.
 *
 * A page keeps running the code it loaded until it is reloaded. After a deploy it can send requests the
 * new server no longer accepts (a tab left open sent an old list of stability engines and got a
 * validation error). The server reports its revision at `/api/v1/version`; the first revision this page
 * reads is the one it loaded with, and a later, different one means the page is out of date.
 */

/** What the server's revision reading can be: a revision, none configured (development), or unreadable. */
type Reading = string | null | undefined;

export interface VersionWatch {
  /** Reads the server's revision and updates the verdict. */
  check(): Promise<void>;
  /** Called for every answered request; a request refused as malformed may mean the page is out of date. */
  noteRejectedRequest(status: number): void;
  /** Property form: neither reads `this`, so React may take them as bare functions. */
  isStale: () => boolean;
  subscribe: (listener: (stale: boolean) => void) => () => void;
}

/** Least time between checks started by refused requests, so a burst of failures reads the version once. */
export const REJECTED_CHECK_GAP_MS = 30_000;

export function createVersionWatch(readRevision: () => Promise<Reading>, now: () => number = Date.now): VersionWatch {
  let loadedWith: string | null | undefined;
  let stale = false;
  let lastRejectedCheckAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<(stale: boolean) => void>();

  const read = async () => {
    const revision = await readRevision();
    if (revision === undefined) return;
    if (loadedWith === undefined) {
      loadedWith = revision;
      return;
    }
    if (!stale && loadedWith !== null && revision !== null && revision !== loadedWith) {
      stale = true;
      listeners.forEach(listener => listener(true));
    }
  };

  return {
    check() {
      inFlight ??= read().finally(() => { inFlight = null; });
      return inFlight;
    },
    noteRejectedRequest(status) {
      if (status !== 400 && status !== 422) return;
      if (now() - lastRejectedCheckAt < REJECTED_CHECK_GAP_MS) return;
      lastRejectedCheckAt = now();
      void this.check();
    },
    isStale: () => stale,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The revision the server reports, or undefined when it did not answer with one. */
async function fetchServedRevision(): Promise<Reading> {
  const response = await fetch("/api/v1/version", { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return undefined;
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return undefined;
  return typeof body.commit === "string" && body.commit !== "unknown" ? body.commit : null;
}

/** The page's own watch. */
export const appVersionWatch = createVersionWatch(fetchServedRevision);
