import { useEffect, useReducer } from "react";
import { useSettings } from "../../../context/SettingsContext";
import { useApiConnections } from "../../../hooks/useApiConnections";
import { useDiagnostics } from "../../../hooks/useDiagnostics";
import { SecretInput } from "../ui/SecretInput";
import { SettingsSection } from "../ui/Section";

function ServicePill({ name, ready, detail }: { name: string; ready: boolean | undefined; detail?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-cs-border-subtle bg-cs-surface-2 px-2.5 py-1.5">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          ready === undefined ? "bg-cs-text-muted animate-pulse" : ready ? "bg-emerald-500" : "bg-rose-500"
        }`}
      />
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-cs-text-secondary">
        {name}
      </span>
      {ready === false && <span className="text-[10px] text-cs-text-muted">offline</span>}
      {detail && <span className="text-[10px] text-cs-text-muted truncate max-w-40">{detail}</span>}
    </div>
  );
}

export function ConnectionsSection() {
  const { settings, updateSetting, serverGeminiReady } = useSettings();
  const { tests, runTest, linking, linkError, linkGeminiKey, clearLinkError } = useApiConnections();
  const { diagnostics, loading } = useDiagnostics();
  const [, tick] = useReducer((x: number) => x + 1, 0);

  // Refresh the session countdown about twice a minute.
  useEffect(() => {
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, [tick]);

  const expiresAt = settings.geminiSessionExpiresAt || 0;
  const sessionActive = Boolean(settings.geminiSessionId) && Date.now() < expiresAt;
  const sessionExpired = Boolean(settings.geminiSessionId) && !sessionActive;
  const minutesLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));

  const handleGeminiKeyChange = (value: string) => {
    const previous = settings.geminiApiKey || "";
    updateSetting("geminiApiKey", value.trim());
    // A stateless session is bound to the key that created it — clear the old
    // session as soon as the key is edited so no stale token is reported active.
    if (value.trim() !== previous) {
      updateSetting("geminiSessionId", "");
      updateSetting("geminiSessionExpiresAt", 0);
    }
    clearLinkError();
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Gemini session"
        hint="Your key is exchanged for a short-lived server token and never written to disk."
      >
        <div className="py-3 space-y-3">
          <div
            role="status"
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium font-mono ${
              sessionActive
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                : sessionExpired
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                  : serverGeminiReady
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                    : "bg-cs-surface-2 text-cs-text-muted border-cs-border-subtle"
            }`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${sessionActive || serverGeminiReady ? "bg-emerald-500" : sessionExpired ? "bg-amber-500" : "bg-cs-text-muted"}`}
            />
            {sessionActive
              ? `Session active — auto-renews, expires in ${minutesLeft} min`
              : sessionExpired
                ? "Session expired — link the key again to renew"
                : serverGeminiReady
                  ? "Server environment key active — pipeline online"
                  : "No Gemini key linked"}
          </div>

          <SecretInput
            label="Google Gemini API key"
            placeholder="Enter GEMINI_API_KEY…"
            value={settings.geminiApiKey || ""}
            onChange={handleGeminiKeyChange}
            description="Exchanged for a 15-minute session token on the server; auto-renews while queries are active."
            action={{
              label: "Link API key",
              busyLabel: "Linking…",
              busy: linking,
              disabled: !settings.geminiApiKey?.trim(),
              run: linkGeminiKey
            }}
            status={linkError ? { valid: false, message: linkError } : null}
          />

          <details className="cs-sub-card px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium text-cs-text-secondary select-none">
              How to obtain a Google Gemini API key
            </summary>
            <ol className="list-decimal pl-4 mt-2 space-y-1 text-[11px] leading-relaxed text-cs-text-secondary">
              <li>
                Visit{" "}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium text-cs-accent-clay hover:opacity-80"
                >
                  Google AI Studio
                </a>{" "}
                and sign in with a Google account.
              </li>
              <li>Open “Get API key” in the top menu and create a key in an existing project.</li>
              <li>Paste the key above and press “Link API key”.</li>
            </ol>
          </details>
        </div>
      </SettingsSection>

      <SettingsSection title="Credentials" hint="Stored only for this browser tab and cleared on reset.">
        <SecretInput
          label="Application / Lab API token"
          placeholder="Enter APP_API_TOKEN…"
          value={settings.appApiToken || ""}
          onChange={(value) => {
            updateSetting("appApiToken", value);
            clearLinkError();
          }}
          description="Authorizes structural mutations, AlphaFold proxies, and session creation on this lab server."
        />
        <SecretInput
          label="EvolutionaryScale (Forge) token"
          placeholder="Enter EvolutionaryScale Forge API key…"
          value={settings.biohubApiToken || ""}
          onChange={(value) => updateSetting("biohubApiToken", value)}
          description="Enables ESM3 multimodal generative structural refinement and generation on forge.evolutionaryscale.ai."
          action={{
            label: "Test connection",
            busyLabel: "Testing…",
            busy: tests.biohub.testing,
            disabled: !settings.biohubApiToken?.trim(),
            run: () => runTest("biohub")
          }}
          status={tests.biohub.status}
        />
        <SecretInput
          label="Hugging Face access token"
          placeholder="Enter HF_TOKEN…"
          value={settings.hfToken || ""}
          onChange={(value) => updateSetting("hfToken", value)}
          description="Enables Song Lab GPN-Star phylogeny LM, SaProt 650M AF2 structure-aware scoring, and ESM-2 via Hugging Face inference."
          action={{
            label: "Test connection",
            busyLabel: "Testing…",
            busy: tests.hf.testing,
            disabled: !settings.hfToken?.trim(),
            run: () => runTest("hf")
          }}
          status={tests.hf.status}
        />
        <SecretInput
          label="AlphaGenome Atlas API key"
          placeholder="Enter ALPHAGENOME_API_KEY…"
          value={settings.alphagenomeApiKey || ""}
          onChange={(value) => updateSetting("alphagenomeApiKey", value)}
          description="Enables multimodal variant impact (AVI) scoring, 18-modality SHAP feature attributions, and Atlas track predictions from Google DeepMind."
          action={{
            label: "Test connection",
            busyLabel: "Testing…",
            busy: tests.alphagenome.testing,
            disabled: !settings.alphagenomeApiKey?.trim(),
            run: () => runTest("alphagenome")
          }}
          status={tests.alphagenome.status}
        />
        <details className="cs-sub-card px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-cs-text-secondary select-none">
            How to obtain a Google DeepMind AlphaGenome Atlas key
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed text-cs-text-secondary">
            Visit the{" "}
            <a
              href="https://deepmind.google.com/science/alphagenome/atlas"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium text-cs-accent-clay hover:opacity-80"
            >
              AlphaGenome Atlas Portal
            </a>{" "}
            to request research access and generate an API key.
          </p>
        </details>
        <div className="py-2.5 space-y-1">
          <label htmlFor="alphagenome-api-url" className="block text-[13px] font-medium text-cs-text-primary">
            AlphaGenome Endpoint URL (optional)
          </label>
          <input
            id="alphagenome-api-url"
            type="url"
            className="cs-input text-[12px] font-mono w-full"
            placeholder="http://127.0.0.1:8000/predict/alphagenome or custom gateway URL"
            value={settings.alphagenomeApiUrl || ""}
            onChange={(e) => updateSetting("alphagenomeApiUrl", e.target.value)}
          />
          <p className="text-[11px] text-cs-text-muted">
            Custom AlphaGenome proxy or self-hosted gRPC/REST gateway URL (overrides default DeepMind Atlas endpoint).
          </p>
        </div>
        <div className="py-2.5 space-y-1">
          <label htmlFor="gpn-api-url" className="block text-[13px] font-medium text-cs-text-primary">
            Song Lab GPN-Star Endpoint URL (optional)
          </label>
          <input
            id="gpn-api-url"
            type="url"
            className="cs-input text-[12px] font-mono w-full"
            placeholder="http://127.0.0.1:8000/predict/gpn or dedicated HF endpoint URL"
            value={settings.gpnApiUrl || ""}
            onChange={(e) => updateSetting("gpnApiUrl", e.target.value)}
          />
          <p className="text-[11px] text-cs-text-muted">
            Dedicated Hugging Face Inference Endpoint or local GPN sidecar (songlab/gpn-msa-sapiens is not served on HF serverless router).
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Server services" hint={loading ? "Checking service readiness…" : undefined}>
        <div className="flex flex-wrap gap-2 py-3">
          <ServicePill name="FoldX engine" ready={diagnostics?.foldxReady} />
          <ServicePill name="Model server" ready={diagnostics?.modelServerReady} />
          <ServicePill name="Gemini" ready={diagnostics?.geminiReady} detail={diagnostics?.geminiModel} />
        </div>
        <p className="text-[11px] leading-normal text-cs-text-muted">
          Readiness is reported by the server diagnostics endpoint; cache tables and purge controls live
          in “About &amp; data”.
        </p>
      </SettingsSection>
    </div>
  );
}
