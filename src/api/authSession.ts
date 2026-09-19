import { useCallback } from "react";
import { useSettings } from "../context/SettingsContext";
import { fetchWithRetry } from "../shared/fetch-retry";
import { purgeFallbackNarratives } from "../services/pipeline/variantCache";

// Circuit-breaker set to prevent repetitive 403 authentication spam loops when an API key is invalid
const invalidApiKeys = new Set<string>();
let sessionReauthPromise: Promise<{ sessionId: string; expiresAt: number } | null> | null = null;
let sessionRefreshPromise: Promise<{ sessionId: string; expiresAt: number } | null> | null = null;
let lastReauthFailureTime = 0;
const REAUTH_COOLDOWN_MS = 30000;

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
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data) {
        if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
        if (data.error?.message && typeof data.error.message === "string" && data.error.message.trim()) return data.error.message.trim();
        if (data.message && typeof data.message === "string" && data.message.trim()) return data.message.trim();
        if (data.detail && typeof data.detail === "string" && data.detail.trim()) return data.detail.trim();
      }
    } else {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        return text.length > 250 ? `${text.slice(0, 250)}...` : text.trim();
      }
    }
  } catch (_) {
    // Ignore JSON/text body consumption errors
  }
  const statusInfo = res.status ? `(HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""})` : "";
  return `${fallbackPrefix} ${statusInfo}`.trim();
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
    alphagenomeApiUrl
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
      const shouldCheckSession = targetRequiresGemini || (!appApiToken && isRelativeOrSameOrigin);

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
    updateSetting
  ]);

  return { fetchWithAuth };
}
