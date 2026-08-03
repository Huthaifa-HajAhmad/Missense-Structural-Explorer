import { useCallback } from "react";
import { useSettings } from "./context/SettingsContext";

export function useApiClient() {
  const { settings, updateSetting } = useSettings();

  const { 
    geminiSessionId, 
    geminiSessionExpiresAt, 
    geminiApiKey, 
    appApiToken, 
    biohubApiToken, 
    tamarindApiKey, 
    hfToken
  } = settings;

  const fetchWithAuth = useCallback(async (
    url: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<Response> => {
    let currentSessionId = geminiSessionId;
    const expiresAt = geminiSessionExpiresAt || 0;

    let timeoutId: any = null;
    let signal = options.signal;
    const controller = options.timeout ? new AbortController() : null;

    if (controller && options.timeout) {
      if (options.signal) {
        options.signal.addEventListener("abort", () => controller.abort());
      }
      signal = controller.signal;
      timeoutId = setTimeout(() => {
        controller.abort();
      }, options.timeout);
    }

    try {
      // Proactively refresh session ID if expired or missing (within 30s of expiry)
      if (geminiApiKey && (!currentSessionId || Date.now() >= (expiresAt - 30000))) {
        try {
          const reauthHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (appApiToken) {
            reauthHeaders["Authorization"] = `Bearer ${appApiToken}`;
          }
          const sessionRes = await fetch("/api/v1/session/keys", {
            method: "POST",
            headers: reauthHeaders,
            body: JSON.stringify({ apiKey: geminiApiKey }),
            signal: signal
          });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            if (sessionData.sessionId) {
              currentSessionId = sessionData.sessionId;
              updateSetting("geminiSessionId", sessionData.sessionId);
              updateSetting("geminiSessionExpiresAt", sessionData.expiresAt || (Date.now() + 3600000));
            }
          }
        } catch (err) {
          // Fall back to attempting request with current credentials
        }
      }

      const headers = { ...(options.headers as Record<string, string> || {}) };
      const isRelativeOrSameOrigin = !url.startsWith("http://") && !url.startsWith("https://");
      if (isRelativeOrSameOrigin) {
        if (currentSessionId) {
          headers["X-Gemini-Session-ID"] = currentSessionId;
        }
        if (appApiToken) {
          headers["Authorization"] = `Bearer ${appApiToken}`;
        }
        if (biohubApiToken) {
          headers["x-biohub-token"] = biohubApiToken;
        }
        if (tamarindApiKey) {
          headers["x-tamarind-api-key"] = tamarindApiKey;
        }
        if (hfToken) {
          headers["x-hf-token"] = hfToken;
        }
      }

      // Helper for retry logic
      const fetchWithRetry = async (u: string, o: RequestInit, retries = 2): Promise<Response> => {
        try {
          const res = await fetch(u, o);
          if (res.status >= 500 && retries > 0) {
            // Wait 250ms with jitter before retrying (L-6: add small retry backoff)
            await new Promise(r => setTimeout(r, 200 + Math.random() * 100));
            return await fetchWithRetry(u, o, retries - 1);
          }
          return res;
        } catch (err) {
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 200 + Math.random() * 100));
            return await fetchWithRetry(u, o, retries - 1);
          }
          throw err;
        }
      };

      let response = await fetchWithRetry(url, { ...options, headers, signal });

      // Attempt re-auth if 401 is returned (e.g. server restart)
      if (response.status === 401 && geminiApiKey) {
        try {
          const reauthHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (appApiToken) {
            reauthHeaders["Authorization"] = `Bearer ${appApiToken}`;
          }
          const sessionRes = await fetch("/api/v1/session/keys", {
            method: "POST",
            headers: reauthHeaders,
            body: JSON.stringify({ apiKey: geminiApiKey }),
            signal: signal
          });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            if (sessionData.sessionId) {
              updateSetting("geminiSessionId", sessionData.sessionId);
              updateSetting("geminiSessionExpiresAt", sessionData.expiresAt || (Date.now() + 3600000));

              const retryHeaders = {
                ...headers
              };
              if (isRelativeOrSameOrigin && sessionData.sessionId) {
                retryHeaders["X-Gemini-Session-ID"] = sessionData.sessionId;
              }
              response = await fetchWithRetry(url, { ...options, headers: retryHeaders, signal });
            }
          }
        } catch (reauthErr) {
          console.error("Transparent re-authentication failed:", reauthErr);
        }
      }

      return response;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }, [
    geminiSessionId, 
    geminiSessionExpiresAt, 
    geminiApiKey, 
    appApiToken, 
    biohubApiToken, 
    tamarindApiKey, 
    hfToken, 
    updateSetting
  ]);

  return { fetchWithAuth };
}
