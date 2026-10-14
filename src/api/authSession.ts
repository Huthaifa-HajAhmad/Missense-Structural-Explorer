import { useCallback } from "react";
import { useSettings } from "../context/SettingsContext";
import { fetchWithRetry } from "../shared/fetch-retry";
import { purgeFallbackNarratives } from "../services/pipeline/variantCache";
import { STALE_DATA_HEADER, parseStaleData, type StaleDataNote } from "../shared/providerLimits";
import { CREDENTIALS_HEADER, parseCredentialUse, type CredentialKind, type CredentialUse } from "../shared/credentials";

// Circuit-breaker set to prevent repetitive 403 authentication spam loops when an API key is invalid
const invalidApiKeys = new Set<string>();
let sessionReauthPromise: Promise<{ sessionId: string; expiresAt: number } | null> | null = null;
let sessionRefreshPromise: Promise<{ sessionId: string; expiresAt: number } | null> | null = null;
let lastReauthFailureTime = 0;
const REAUTH_COOLDOWN_MS = 30000;

// ── Auth-lapse signal ────────────────────────────────────────────────────────────────────────────
// The single choke-point every app API call passes through also knows, and only it knows, when an
// authorization refusal survived the built-in re-auth attempt. A session that lapsed while the app
// idled exposed itself only as a warn line in the dev console: background consumers (the energetics
// remote-submission poll, for one) treat any non-OK response as "nothing came back" and settle
// silently. Surfaces that CAN act — the Services rail's inline relink — subscribe here instead of
// re-deriving the failure from UI state that never records it.

export interface AuthLapse {
  /** When the terminal 401 was seen. */
  at: number;
  /** The refused relative URL, credential-free (no query string). */
  url: string;
  status: 401;
}

let authLapse: AuthLapse | null = null;
const authLapseListeners = new Set<(lapse: AuthLapse | null) => void>();

/** The most recent terminal 401, or null while authorization works. */
export function getAuthLapse(): AuthLapse | null {
  return authLapse;
}

export function subscribeAuthLapse(listener: (lapse: AuthLapse | null) => void): () => void {
  authLapseListeners.add(listener);
  return () => authLapseListeners.delete(listener);
}

/** A refused URL that never parsed keeps its path part alone; query stays out of the signal. */
function sanitizeAuthLapseUrl(raw: string): string {
  const queryStart = raw.indexOf("?");
  if (queryStart === -1) return raw;
  const path = raw.slice(0, queryStart);
  return path.length > 0 ? path : "/";
}

function setAuthLapse(next: AuthLapse): void {
  const dedupChanged = !authLapse || authLapse.url !== next.url;
  authLapse = next;
  // On re-fire for the same refused URL skip notification: the pending long-poll retries would
  // otherwise tick the panel every cycle. `at` still advances for readers that re-subscribe.
  if (dedupChanged) authLapseListeners.forEach(l => l(authLapse));
}

function clearAuthLapse(): void {
  if (!authLapse) return;
  authLapse = null;
  authLapseListeners.forEach(l => l(null));
}

// ── Stale-data signal (WP-I2) ───────────────────────────────────────────────────────────────────
// When a provider limits requests, the server answers from its saved copy instead of failing and
// says so in `X-MSE-Stale`. This choke-point is the one place that sees every response header, so
// it publishes the notes; a surface that can tell the reader (`useStaleDataNotice`) subscribes.

export interface StaleDataReport {
  /** When the response carrying the header arrived. */
  at: number;
  notes: StaleDataNote[];
}

let staleData: StaleDataReport | null = null;
const staleDataListeners = new Set<(report: StaleDataReport) => void>();

/** The most recent response that used saved data past its expiry, or null. */
export function getStaleData(): StaleDataReport | null {
  return staleData;
}

export function subscribeStaleData(listener: (report: StaleDataReport) => void): () => void {
  staleDataListeners.add(listener);
  return () => {
    staleDataListeners.delete(listener);
  };
}

/** Exported for tests; `fetchWithAuth` calls it for every same-origin response. */
export function noteStaleDataHeader(value: string | null): void {
  const notes = parseStaleData(value);
  if (notes.length === 0) return;
  const report: StaleDataReport = { at: Date.now(), notes };
  staleData = report;
  // A listener's failure must never fail the request that carried the header.
  staleDataListeners.forEach(l => {
    try {
      l(report);
    } catch (err) {
      console.warn("[Stale data] A listener failed:", err);
    }
  });
}

// ── Credential-use signal (WP-I4) ───────────────────────────────────────────────────────────────
// Which token a response's Biohub, Hugging Face or Tamarind calls used ("your token" / "the team token"),
// or why none was used. Read here for the same reason as the stale-data header; surfaces subscribe.

export interface CredentialUseReport {
  at: number;
  uses: CredentialUse[];
}

let lastCredentialUse: Partial<Record<CredentialKind, { at: number; use: CredentialUse }>> = {};
const credentialUseListeners = new Set<(report: CredentialUseReport) => void>();

/** The latest use reported for each kind (Settings → Connections shows it). */
export function getLastCredentialUse(): Partial<Record<CredentialKind, { at: number; use: CredentialUse }>> {
  return lastCredentialUse;
}

export function subscribeCredentialUse(listener: (report: CredentialUseReport) => void): () => void {
  credentialUseListeners.add(listener);
  return () => {
    credentialUseListeners.delete(listener);
  };
}

/** Exported for tests and the streamed analysis's `{type: "credentials"}` frame. */
export function noteCredentialHeader(value: string | null): void {
  const uses = parseCredentialUse(value);
  if (uses.length === 0) return;
  const report: CredentialUseReport = { at: Date.now(), uses };
  const next = { ...lastCredentialUse };
  for (const use of uses) next[use.kind] = { at: report.at, use };
  lastCredentialUse = next;
  credentialUseListeners.forEach(l => {
    try {
      l(report);
    } catch (err) {
      console.warn("[Credential use] A listener failed:", err);
    }
  });
}

export function clearInvalidApiKey(key?: string): void {
  if (key) {
    invalidApiKeys.delete(key);
  } else {
    invalidApiKeys.clear();
  }
  lastReauthFailureTime = 0;
}

export function isGeminiSessionEndpoint(url: string): boolean {
  return url.includes("/analyze-variant-narrative") ||
    url.includes("/analyze-variant-biophysical") ||
    url.includes("/literature");
}

/**
 * Keeps the caller's `timeout` covering the BODY read — as a STALL bound, not a total cap.
 *
 * A header-then-stall upstream used to leave the call pending forever, because the watchdog was
 * released as soon as the response object existed. Bounding the whole body instead would break
 * the streaming caller (`/analyze-variant/stream` drips chunks for far longer than one timeout),
 * so the bound is re-armed on every chunk: a body that keeps producing is never interrupted, and
 * one that stops for `timeout` is aborted. `onProgress` is invoked before each read attempt; the
 * returned Response carries the same status/headers, so callers are unaffected.
 *
 * If the caller never reads the body, the stall timer fires against a finished request —
 * harmless, and the timer detaches the abort listener itself.
 */
function bindWatchdogToBody(
  response: Response,
  onSettled: () => void,
  onHandedOff: () => void,
  onProgress?: () => void
): Response {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    onSettled();
    return response;
  }
  try {
    const reader = body.getReader();
    const guarded = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Restart the stall bound for the chunk we are about to wait for.
        onProgress?.();
        try {
          const { done, value } = await reader.read();
          if (done) {
            onSettled();
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (err) {
          // Includes the abort raised by the watchdog itself.
          onSettled();
          controller.error(err);
        }
      },
      cancel(reason) {
        onSettled();
        return reader.cancel(reason);
      },
    });
    onHandedOff();
    return new Response(guarded, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    // Streaming is unavailable in this environment: fall back to time-to-headers rather than
    // breaking the request.
    onSettled();
    return response;
  }
}

/**
 * Unified helper to extract researcher-friendly error messages from API responses.
 * Gracefully parses standardized { error: { message } }, { message }, { detail },
 * plain text error bodies, and provides clear HTTP status codes without trailing colons.
 */
export async function extractErrorMessage(res: Response, fallbackPrefix: string): Promise<string> {
  return (await extractApiError(res, fallbackPrefix)).message;
}

/**
 * An API failure that keeps the machine-readable parts of the response.
 *
 * `extractErrorMessage` returns a STRING, so every call site threw `new Error(message)` and both
 * `code` and `details` died there. That is why the ambiguous-numbering payload — the two readings of
 * a notation that cannot be resolved by residue number alone — could never reach a component able to
 * act on it, and the reader got a dead end instead of a decision.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(message: string, options: { code?: string; details?: unknown; status: number }) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.details = options.details;
    this.status = options.status;
  }
}

/** Reads the standard error envelope ONCE, keeping `code` and `details` beside the message. */
export async function extractApiError(res: Response, fallbackPrefix: string): Promise<ApiError> {
  const status = res.status;
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      const message =
        (typeof data?.error === "string" && data.error.trim()) ||
        (typeof data?.error?.message === "string" && data.error.message.trim()) ||
        (typeof data?.message === "string" && data.message.trim()) ||
        (typeof data?.detail === "string" && data.detail.trim());
      if (message) {
        return new ApiError(message, {
          code: typeof data?.error?.code === "string" ? data.error.code : undefined,
          details: data?.error?.details ?? data?.details,
          status,
        });
      }
    } else {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        return new ApiError(text.length > 250 ? `${text.slice(0, 250)}...` : text.trim(), { status });
      }
    }
  } catch (_) {
    // Ignore JSON/text body consumption errors
  }
  const statusInfo = status ? `(HTTP ${status}${res.statusText ? ` ${res.statusText}` : ""})` : "";
  return new ApiError(`${fallbackPrefix} ${statusInfo}`.trim(), { status });
}

export type FetchWithAuth = (
  url: string,
  options?: RequestInit & { timeout?: number }
) => Promise<Response>;

export function useAuthSession() {
  const { settings, updateSetting } = useSettings();

  const { 
    geminiSessionId, 
    geminiSessionExpiresAt, 
    geminiApiKey, 
    appApiToken, 
    biohubApiToken, 
    hfToken, 
    tamarindApiKey,
    gpnApiUrl,
    alphagenomeApiKey,
    alphagenomeApiUrl,
    spliceaiWindow
  } = settings;

  const fetchWithAuth: FetchWithAuth = useCallback(async (
    url: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<Response> => {
    let currentSessionId = geminiSessionId;
    let currentExpiresAt = geminiSessionExpiresAt || 0;
    let isExpired = !currentExpiresAt || Date.now() >= currentExpiresAt;

    // Never use or forward an expired session token
    if (isExpired && currentSessionId) {
      currentSessionId = "";
    }

    let timeoutId: any = null;
    let signal = options.signal;
    const controller = options.timeout ? new AbortController() : null;
    /**
     * Absolute instant the watchdog below will abort the call.
     *
     * Passed to the retry utility so it can refuse to start an attempt that cannot finish
     * before this instant, and cap each attempt's own timeout by the time that remains. It is
     * captured HERE rather than inside `fetchWithRetry` because the session handshake and any
     * re-auth happen before the request and already consume the same budget.
     */
    const watchdogDeadlineAt = options.timeout ? Date.now() + options.timeout : undefined;

    let abortListener: (() => void) | null = null;
    /** Body-stall bound: re-armed on every chunk, so a progressing stream is never interrupted. */
    let stallId: any = null;
    /**
     * (Re)arm the stall bound. Called once when the response is handed off and again before each
     * chunk is awaited, which is what distinguishes "this stream is still working" from "this
     * stream has stopped".
     */
    const armStall = () => {
      if (!options.timeout || !controller) return;
      if (stallId) clearTimeout(stallId);
      stallId = setTimeout(() => {
        controller.abort(
          new DOMException(`Response body stalled for ${options.timeout}ms`, "TimeoutError")
        );
        // The request is over: detach the forwarding listener even if no body was ever read.
        if (options.signal && abortListener) {
          options.signal.removeEventListener("abort", abortListener);
          abortListener = null;
        }
      }, options.timeout);
    };
    /**
     * Releases the watchdog, the stall bound and the forwarding listener together.
     *
     * Called either as soon as a response without a body is available, or when the body settles
     * (see {@link bindWatchdogToBody}) — never unconditionally on return, which was the bug that
     * let a stalled body outlive its own timeout.
     */
    const releaseWatchdog = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (stallId) {
        clearTimeout(stallId);
        stallId = null;
      }
      if (options.signal && abortListener) {
        options.signal.removeEventListener("abort", abortListener);
        abortListener = null;
      }
    };
    // Set when the watchdog is handed to the response body, so the `finally` below does not
    // release it prematurely.
    let watchdogHandedOff = false;

    if (controller && options.timeout) {
      if (options.signal) {
        abortListener = () => {
          controller.abort(options.signal?.reason);
        };
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
      signal = controller.signal;
      // Time-to-headers. Once headers arrive the body is bounded per-chunk instead (armStall),
      // which keeps long-lived streams alive while still bounding a stall.
      timeoutId = setTimeout(() => {
        controller.abort(new DOMException(`Request timed out after ${options.timeout}ms`, "TimeoutError"));
        // The request is over: detach the forwarding listener even if no body was ever read.
        if (options.signal && abortListener) {
          options.signal.removeEventListener("abort", abortListener);
          abortListener = null;
        }
      }, options.timeout);
    }

    const isRelativeOrSameOrigin = !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("//");
    const targetRequiresGemini = isGeminiSessionEndpoint(url);

    try {
      // Only perform Gemini session handshake for endpoints that need it, or when appApiToken is not configured
      const publicContextRead = (options.method ?? 'GET').toUpperCase() === 'GET' &&
        /^\/api\/v1\/evidence-context\/[^/?]+(?:\/(?:expression|development))?(?:\?.*)?$/.test(url);
      const shouldCheckSession = targetRequiresGemini || (!publicContextRead && !appApiToken && isRelativeOrSameOrigin);

      if (shouldCheckSession && geminiApiKey && !invalidApiKeys.has(geminiApiKey)) {
        // Proactively refresh session ID if near expiry (< 60s) but not yet expired
        if (currentSessionId && Date.now() < currentExpiresAt && Date.now() >= (currentExpiresAt - 60000)) {
          try {
            if (!sessionRefreshPromise) {
              sessionRefreshPromise = (async () => {
                const refreshController = new AbortController();
                const refreshTimeout = setTimeout(() => {
                  refreshController.abort(new DOMException("Session refresh timed out", "TimeoutError"));
                }, 10000);

                try {
                  const refreshHeaders: Record<string, string> = {
                    "Content-Type": "application/json",
                    "X-Gemini-Session-ID": currentSessionId
                  };
                  if (appApiToken) {
                    refreshHeaders["Authorization"] = `Bearer ${appApiToken}`;
                  }
                  const refreshRes = await fetch("/api/v1/session/refresh", {
                    method: "POST",
                    headers: refreshHeaders,
                    signal: refreshController.signal
                  });
                  if (refreshRes.ok) {
                    const refreshData = await refreshRes.json();
                    if (refreshData.sessionId) {
                      return {
                        sessionId: refreshData.sessionId,
                        expiresAt: refreshData.expiresAt || (Date.now() + 15 * 60 * 1000)
                      };
                    }
                  }
                } catch (_) {
                  // Fall back to attempting request with current credentials
                } finally {
                  clearTimeout(refreshTimeout);
                  sessionRefreshPromise = null;
                }
                return null;
              })();
            }

            const refreshResult = await sessionRefreshPromise;
            if (refreshResult) {
              currentSessionId = refreshResult.sessionId;
              currentExpiresAt = refreshResult.expiresAt;
              isExpired = false;
              updateSetting("geminiSessionId", refreshResult.sessionId);
              updateSetting("geminiSessionExpiresAt", refreshResult.expiresAt);
              purgeFallbackNarratives();
            }
          } catch (_) {
            // Fall back to attempting request with current credentials
          }
        } else if (!currentSessionId || isExpired) {
          // Deduplicate in-flight session requests & respect backoff cooldown
          if (Date.now() - lastReauthFailureTime > REAUTH_COOLDOWN_MS) {
            if (!sessionReauthPromise) {
              sessionReauthPromise = (async () => {
                const reauthController = new AbortController();
                const reauthTimeout = setTimeout(() => {
                  reauthController.abort(new DOMException("Session re-authentication timed out", "TimeoutError"));
                }, 10000);

                try {
                  const reauthHeaders: Record<string, string> = { "Content-Type": "application/json" };
                  if (appApiToken) {
                    reauthHeaders["Authorization"] = `Bearer ${appApiToken}`;
                  }
                  const sessionRes = await fetch("/api/v1/session/keys", {
                    method: "POST",
                    headers: reauthHeaders,
                    body: JSON.stringify({ apiKey: geminiApiKey }),
                    signal: reauthController.signal
                  });
                  if (sessionRes.ok) {
                    invalidApiKeys.delete(geminiApiKey);
                    const sessionData = await sessionRes.json();
                    if (sessionData.sessionId) {
                      return {
                        sessionId: sessionData.sessionId,
                        expiresAt: sessionData.expiresAt || (Date.now() + 15 * 60 * 1000)
                      };
                    }
                  } else if (sessionRes.status === 400 || sessionRes.status === 403) {
                    invalidApiKeys.add(geminiApiKey);
                    console.warn("[apiClient] Gemini API key is invalid or unauthorized. Pausing auto-authentication attempts for this key until updated in Settings.");
                  } else {
                    lastReauthFailureTime = Date.now();
                  }
                } catch (err: any) {
                  if (err?.name !== "AbortError") {
                    lastReauthFailureTime = Date.now();
                  }
                } finally {
                  clearTimeout(reauthTimeout);
                  sessionReauthPromise = null;
                }
                return null;
              })();
            }

            const reauthResult = await sessionReauthPromise;
            if (reauthResult) {
              currentSessionId = reauthResult.sessionId;
              currentExpiresAt = reauthResult.expiresAt;
              isExpired = false;
              updateSetting("geminiSessionId", reauthResult.sessionId);
              updateSetting("geminiSessionExpiresAt", reauthResult.expiresAt);
              purgeFallbackNarratives();
            } else {
              currentSessionId = "";
              currentExpiresAt = 0;
              isExpired = true;
              updateSetting("geminiSessionId", "");
              updateSetting("geminiSessionExpiresAt", 0);
            }
          }
        }
      }

      const headers: Record<string, string> = {};
      if (options.headers) {
        if (typeof (options.headers as any).forEach === "function") {
          (options.headers as any).forEach((value: string, key: string) => {
            headers[key] = value;
          });
        } else if (Array.isArray(options.headers)) {
          for (const [key, value] of options.headers) {
            headers[key] = value;
          }
        } else {
          Object.assign(headers, options.headers);
        }
      }
      if (isRelativeOrSameOrigin) {
        // Only attach X-Gemini-Session-ID if valid, non-expired, and relevant
        const hasActiveSession = Boolean(currentSessionId) && !isExpired && Date.now() < currentExpiresAt;
        if (hasActiveSession && currentSessionId && (targetRequiresGemini || !appApiToken)) {
          headers["X-Gemini-Session-ID"] = currentSessionId;
        }
        if (appApiToken) {
          headers["Authorization"] = `Bearer ${appApiToken}`;
        }
        if (biohubApiToken) {
          headers["x-biohub-token"] = biohubApiToken;
        }
        if (hfToken) {
          headers["x-hf-token"] = hfToken;
        }
        if (tamarindApiKey) {
          headers["x-tamarind-api-key"] = tamarindApiKey;
        }
        if (gpnApiUrl) {
          headers["x-gpn-api-url"] = gpnApiUrl;
        }
        if (alphagenomeApiKey) {
          headers["x-alphagenome-key"] = alphagenomeApiKey;
        }
        if (alphagenomeApiUrl) {
          headers["x-alphagenome-url"] = alphagenomeApiUrl;
        }
        // Not a credential: the reporting window of the SpliceAI score this analysis will carry.
        if (spliceaiWindow) {
          headers["x-spliceai-distance"] = String(spliceaiWindow);
        }
      }

      // `deadlineAt` tells the retry utility which whole-call deadline the watchdog above is
      // enforcing, so it never starts an attempt that timer would abort mid-flight — the bug
      // that turned a server `503 Retry-After: 60` into "Request timed out after 45000ms".
      const retryOptions = {
        ...options,
        headers,
        signal,
        ...(watchdogDeadlineAt !== undefined ? { deadlineAt: watchdogDeadlineAt } : {}),
      };

      let response = await fetchWithRetry(url, retryOptions);

      // Attempt re-auth only if 401 was returned on an endpoint that relies on Gemini sessions
      if (response.status === 401 && shouldCheckSession && geminiApiKey && !invalidApiKeys.has(geminiApiKey)) {
        try {
          const retryController = new AbortController();
          const retryTimeout = setTimeout(() => {
            retryController.abort(new DOMException("Re-authentication timed out", "TimeoutError"));
          }, 10000);

          try {
            const reauthHeaders: Record<string, string> = { "Content-Type": "application/json" };
            if (appApiToken) {
              reauthHeaders["Authorization"] = `Bearer ${appApiToken}`;
            }
            const sessionRes = await fetch("/api/v1/session/keys", {
              method: "POST",
              headers: reauthHeaders,
              body: JSON.stringify({ apiKey: geminiApiKey }),
              signal: retryController.signal
            });
            if (sessionRes.ok) {
              const data = await sessionRes.json();
              const newSessionId = data.sessionId;
              const newExpiresAt = data.expiresAt;
              if (newSessionId) {
                updateSetting("geminiSessionId", newSessionId);
                updateSetting("geminiSessionExpiresAt", newExpiresAt);
                purgeFallbackNarratives();
                headers["X-Gemini-Session-ID"] = newSessionId;
                response = await fetchWithRetry(url, retryOptions);
              }
            } else if (sessionRes.status === 400 || sessionRes.status === 403) {
              invalidApiKeys.add(geminiApiKey);
              updateSetting("geminiSessionId", "");
              updateSetting("geminiSessionExpiresAt", 0);
            }
          } finally {
            clearTimeout(retryTimeout);
          }
        } catch {
          // If re-auth fetch fails (e.g. network), return original 401 response
        }
      }

      // Authorization that survived the built-in re-auth attempt is a lapse surfaces can act on:
      // publish it (and clear it again as soon as an authorized call succeeds). Only relative
      // routes are covered — external third-party APIs manage their own credentials.
      if (isRelativeOrSameOrigin) {
        if (response.status === 401) {
          let refusedPath = url;
          try {
            // The query can carry variant context; the path is what identifies the refusal and
            // keeps deduplication stable across identical retries.
            refusedPath = new URL(url, window.location.origin).pathname;
          } catch {
            // A malformed URL keeps its raw path; the label still works.
            refusedPath = sanitizeAuthLapseUrl(url);
          }
          setAuthLapse({ at: Date.now(), url: refusedPath, status: 401 });
        } else if (response.ok) {
          clearAuthLapse();
        }
        noteStaleDataHeader(response.headers?.get?.(STALE_DATA_HEADER) ?? null);
        noteCredentialHeader(response.headers?.get?.(CREDENTIALS_HEADER) ?? null);
      }

      // `timeout` must bound the BODY read too — a header-then-stall upstream otherwise keeps
      // the call (and the UI spinner) alive indefinitely. It is applied as a per-chunk STALL
      // bound, not a whole-response cap, so streaming endpoints keep working.
      return bindWatchdogToBody(response, releaseWatchdog, () => {
        watchdogHandedOff = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        armStall();
      }, armStall);
    } finally {
      // Only when the watchdog was NOT handed to a body: otherwise it is released on settlement.
      if (!watchdogHandedOff) releaseWatchdog();
    }
  }, [
    geminiSessionId, 
    geminiSessionExpiresAt, 
    geminiApiKey, 
    appApiToken, 
    biohubApiToken, 
    hfToken, 
    tamarindApiKey,
    gpnApiUrl,
    alphagenomeApiKey,
    alphagenomeApiUrl,
    spliceaiWindow,
    updateSetting
  ]);

  return { fetchWithAuth };
}
