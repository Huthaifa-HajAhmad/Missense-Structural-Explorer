/**
 * fetch-retry.ts — Consolidated client-side fetch retry utility.
 *
 * Provides:
 *   - Exponential backoff with jitter
 *   - Automatic retry for 429 (rate-limit) and transient 5xx gateway errors (502, 503, 504)
 *   - Non-retryable error detection (e.g. API_KEY_MISSING / isConfigError)
 *   - Proper AbortSignal cascading and timeout cleanup
 */

export interface FetchRetryOptions extends RequestInit {
  timeout?: number;
}

export async function fetchWithRetry(
  url: string,
  options: FetchRetryOptions = {},
  maxRetries = 2,
  initialDelay = 500,
  backoffFactor = 2
): Promise<Response> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You appear to be offline. Please verify your internet connection and try again.");
  }

  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeoutVal = options.timeout ?? 60000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutVal);

    const onSignalAbort = () => controller.abort();
    if (options.signal) {
      options.signal.addEventListener("abort", onSignalAbort);
      if (options.signal.aborted) {
        controller.abort();
      }
    }

    const fetchOptions: RequestInit = { ...options, signal: controller.signal };
    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onSignalAbort);
      }

      if (response.ok) {
        return response;
      }

      const shouldRetryStatus = [502, 503, 504, 429].includes(response.status) || response.status >= 500;
      if (shouldRetryStatus && attempt < maxRetries) {
        // Fast-path: Check response body for unrecoverable auth/config errors
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (text.includes("API_KEY_MISSING") || text.includes("isConfigError")) {
            return response; // Bypass retry for missing/invalid credentials
          }
        } catch {
          // Ignore body read error
        }

        attempt++;
        const jitter = 0.8 + Math.random() * 0.4;
        const delay = Math.round(initialDelay * Math.pow(backoffFactor, attempt - 1) * jitter);
        console.warn(`[Client Retry] Endpoint ${url} returned status ${response.status}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);

        await new Promise<void>((resolve, reject) => {
          let timeoutIdDelay: any = null;
          const onAbort = () => {
            if (timeoutIdDelay) clearTimeout(timeoutIdDelay);
            reject(new DOMException("The user aborted a request.", "AbortError"));
          };

          timeoutIdDelay = setTimeout(() => {
            if (options.signal) {
              options.signal.removeEventListener("abort", onAbort);
            }
            resolve();
          }, delay);

          if (options.signal) {
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
        });
        continue;
      }
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onSignalAbort);
      }

      if (err.name === "AbortError" || options.signal?.aborted) {
        throw err;
      }

      if (attempt < maxRetries) {
        attempt++;
        const jitter = 0.8 + Math.random() * 0.4;
        const delay = Math.round(initialDelay * Math.pow(backoffFactor, attempt - 1) * jitter);
        console.warn(`[Client Retry] Endpoint ${url} threw error: ${err.message || err}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);

        await new Promise<void>((resolve, reject) => {
          let timeoutIdDelay: any = null;
          const onAbort = () => {
            if (timeoutIdDelay) clearTimeout(timeoutIdDelay);
            reject(new DOMException("The user aborted a request.", "AbortError"));
          };

          timeoutIdDelay = setTimeout(() => {
            if (options.signal) {
              options.signal.removeEventListener("abort", onAbort);
            }
            resolve();
          }, delay);

          if (options.signal) {
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
        });
        continue;
      }
      throw err;
    }
  }
}
