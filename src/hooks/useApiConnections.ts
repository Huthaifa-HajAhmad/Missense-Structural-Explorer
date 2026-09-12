import { useCallback, useState } from "react";
import { useSettings } from "../context/SettingsContext";
import type { ValidationStatus } from "../components/settings/ui/SecretInput";
import { purgeFallbackNarratives } from "../services/pipeline/variantCache";

type TestId = "biohub" | "hf";

interface TestState {
  testing: boolean;
  status: ValidationStatus | null;
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
  hf: {
    endpoint: "/api/v1/test-hf-connection",
    payload: (token) => ({ hfToken: token }),
    emptyMessage: "No Hugging Face token entered."
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
    hf: IDLE_TEST
  });
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const patchTest = (id: TestId, patch: Partial<TestState>) => {
    setTests((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const runTest = useCallback(
    async (id: TestId) => {
      const spec = ENDPOINTS[id];
      const token =
        id === "biohub"
          ? settings.biohubApiToken
          : settings.hfToken;

      if (!token) {
        patchTest(id, { status: { valid: false, message: spec.emptyMessage } });
        return;
      }

      patchTest(id, { testing: true, status: null });
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (settings.appApiToken) {
          headers["Authorization"] = `Bearer ${settings.appApiToken}`;
        }
        const res = await fetch(spec.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(spec.payload(token))
        });
        const text = await res.text();
        let data: { valid?: boolean; message?: string; error?: { message?: string } | string } = {};
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Invalid server response (HTTP ${res.status})`);
        }
        if (res.status === 401 || data.error) {
          const message =
            (typeof data.error === "object" && data.error?.message) ||
            (typeof data.error === "string" && data.error) ||
            "App authorization failed. Please check your App API Token.";
          patchTest(id, { status: { valid: false, message } });
        } else {
          patchTest(id, { status: { valid: !!data.valid, message: data.message || "" } });
        }
      } catch (err) {
        patchTest(id, {
          status: { valid: false, message: errorMessage(err, "Validation error: failed to reach server.") }
        });
      } finally {
        patchTest(id, { testing: false });
      }
    },
    [settings.biohubApiToken, settings.hfToken, settings.appApiToken]
  );

  const linkGeminiKey = useCallback(async () => {
    const apiKey = settings.geminiApiKey?.trim() || "";
    if (!apiKey) return;

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

  return {
    tests,
    runTest,
    linking,
    linkError,
    linkGeminiKey,
    clearLinkError
  };
}
