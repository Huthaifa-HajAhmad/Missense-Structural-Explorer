import { useCallback, useMemo, useState } from "react";
import { useSettings } from "../context/SettingsContext";
import type { ValidationStatus } from "../components/settings/ui/SecretInput";
import { purgeFallbackNarratives } from "../services/pipeline/variantCache";
import { clearInvalidApiKey } from "../api/authSession";

type TestId = "biohub" | "japanfold" | "alphagenome" | "tamarind";

interface TestState {
  testing: boolean;
  status: ValidationStatus | null;
  /** The key (and, for AlphaGenome, the endpoint) the status describes; once either changes it no longer applies. */
  testedInput?: string;
}

const IDLE_TEST: TestState = { testing: false, status: null };

interface EndpointSpec {
  endpoint: string;
  payload: (token: string) => Record<string, unknown>;
  emptyMessage: string;
}

const ENDPOINTS: Record<TestId, EndpointSpec> = {
  biohub: {
    endpoint: "/api/v1/validate-biohub-token",
    payload: (token) => ({ token }),
    emptyMessage: "No Biohub API token entered."
  },
  japanfold: {
    endpoint: "/api/v1/validate-japanfold-key",
    payload: (token) => ({ apiKey: token }),
    emptyMessage: "No JapanFold API key entered."
  },
  alphagenome: {
    endpoint: "/api/v1/alphagenome/verify-connection",
    payload: (token) => ({ apiKey: token }),
    emptyMessage: "No AlphaGenome Atlas API key entered."
  },
  tamarind: {
    endpoint: "/api/v1/test-tamarind-connection",
    payload: (token) => ({ tamarindApiKey: token }),
    emptyMessage: "No Tamarind Bio API key entered."
  }
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Consolidates the credential test/link flows that used to live as three
 * near-identical handlers inside SettingsModal plus a Gemini link handler.
 * Consumes settings directly from context — no prop drilling.
 */
export function useApiConnections() {
  const { settings, updateSetting } = useSettings();
  const [tests, setTests] = useState<Record<TestId, TestState>>({
    biohub: IDLE_TEST,
    japanfold: IDLE_TEST,
    alphagenome: IDLE_TEST,
    tamarind: IDLE_TEST
  });
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const patchTest = (id: TestId, patch: Partial<TestState>) => {
    setTests((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const tokenFor = (id: TestId): string | undefined =>
    id === "biohub"
      ? settings.biohubApiToken
      : id === "japanfold"
        ? settings.japanfoldApiKey
        : id === "tamarind"
          ? settings.tamarindApiKey
          : settings.alphagenomeApiKey;

  // What a test result is about. AlphaGenome is tested against a key AND an endpoint.
  const inputFor = (id: TestId): string =>
    id === "alphagenome" ? `${settings.alphagenomeApiKey ?? ""}\n${settings.alphagenomeApiUrl ?? ""}` : tokenFor(id) ?? "";

  const runTest = useCallback(
    /**
     * `useSaved`: no token is typed in this browser, but one is saved to the account (WP-I4b). The request
     * then carries none and the server tests the saved one (never the team's).
     */
    async (id: TestId, opts: { useSaved?: boolean } = {}) => {
      const spec = ENDPOINTS[id];
      const token = tokenFor(id);

      if (!token && !opts.useSaved && !(id === "alphagenome" && settings.alphagenomeApiUrl)) {
        patchTest(id, { status: { valid: false, message: spec.emptyMessage }, testedInput: inputFor(id) });
        return;
      }

      patchTest(id, { testing: true, status: null, testedInput: inputFor(id) });
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (settings.appApiToken) {
          headers["Authorization"] = `Bearer ${settings.appApiToken}`;
        }
        const payloadBody =
          id === "alphagenome"
            ? { apiKey: token || undefined, apiUrl: settings.alphagenomeApiUrl || undefined }
            : token
              ? spec.payload(token)
              : {};

        const res = await fetch(spec.endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify(payloadBody)
        });
        const text = await res.text();
        let data: { valid?: boolean; ok?: boolean; latencyMs?: number; message?: string; error?: { message?: string } | string } = {};
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Invalid server response (HTTP ${res.status})`);
        }
        const isValid = data.valid ?? data.ok ?? false;
        const successMessage =
          data.message ||
          (data.ok
            ? `Connected to DeepMind Atlas (${data.latencyMs ?? 0}ms)`
            : "") ||
          "";

        if (res.status === 401 || data.error || !isValid) {
          const message =
            (typeof data.error === "object" && data.error?.message) ||
            (typeof data.error === "string" && data.error) ||
            (res.status !== 401 && data.message) ||
            (res.status === 401
              ? "App authorization failed. Please check your App API Token."
              : "Connection test failed.");
          patchTest(id, { status: { valid: false, message } });
        } else {
          patchTest(id, { status: { valid: true, message: successMessage } });
        }
      } catch (err) {
        patchTest(id, {
          status: { valid: false, message: errorMessage(err, "Validation error: failed to reach server.") }
        });
      } finally {
        patchTest(id, { testing: false });
      }
    },
    [settings.biohubApiToken, settings.japanfoldApiKey, settings.tamarindApiKey, settings.alphagenomeApiKey, settings.alphagenomeApiUrl, settings.appApiToken]
  );

  const linkGeminiKey = useCallback(async () => {
    const apiKey = settings.geminiApiKey?.trim() || "";
    if (!apiKey) return;

    clearInvalidApiKey(apiKey);
    setLinking(true);
    setLinkError(null);

    // Do not leave an older token marked active while this key is being
    // validated. The server token is stateless and tied to the submitted key.
    updateSetting("geminiSessionId", "");
    updateSetting("geminiSessionExpiresAt", 0);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.appApiToken) {
        headers["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      const response = await fetch("/api/v1/session/keys", {
        method: "POST",
        headers,
        body: JSON.stringify({ apiKey })
      });
      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) {
        const serverError = responseData.error;
        const code = serverError?.code ? `[${serverError.code}] ` : "";
        const requestId = serverError?.requestId ? ` (request ${serverError.requestId})` : "";
        throw new Error(
          `${code}${serverError?.message || `Failed to link API key (HTTP ${response.status}).`}${requestId}`
        );
      }
      if (responseData.sessionId) {
        updateSetting("geminiSessionId", responseData.sessionId);
        updateSetting(
          "geminiSessionExpiresAt",
          responseData.expiresAt || Date.now() + 15 * 60 * 1000
        );
        purgeFallbackNarratives();
      } else {
        throw new Error("No session ID returned from server.");
      }
    } catch (err) {
      setLinkError(errorMessage(err, "An unexpected error occurred."));
    } finally {
      setLinking(false);
    }
  }, [settings.geminiApiKey, settings.appApiToken, updateSetting]);

  const clearLinkError = useCallback(() => setLinkError(null), []);

  const currentTests = useMemo(() => {
    const current = { ...tests };
    for (const id of Object.keys(current) as TestId[]) {
      if (current[id].status && current[id].testedInput !== inputFor(id)) current[id] = { ...current[id], status: null };
    }
    return current;
    // inputFor reads only the settings listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tests, settings.biohubApiToken, settings.japanfoldApiKey, settings.tamarindApiKey, settings.alphagenomeApiKey, settings.alphagenomeApiUrl]);

  return {
    tests: currentTests,
    runTest,
    linking,
    linkError,
    linkGeminiKey,
    clearLinkError
  };
}
