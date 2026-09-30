import React, { useEffect, useReducer } from "react";
import { useSettings } from "../../../context/SettingsContext";
import { useApiConnections } from "../../../hooks/useApiConnections";
import { useDiagnostics } from "../../../hooks/useDiagnostics";
import { SecretInput } from "../ui/SecretInput";
import { SettingsBlock, SettingsSection } from "../ui/Section";
import { ChevronRight } from "lucide-react";
import { clearInvalidApiKey } from "../../../api/authSession";

function ServicePill({ name, ready, detail }: { name: string; ready: boolean | undefined; detail?: string }) {
  const state = ready === undefined ? "Checking…" : ready ? "Online" : "Offline";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 px-3 py-2 min-w-0">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full shrink-0 ${
          ready === undefined
            ? "bg-cs-text-muted animate-pulse"
            : ready
              ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
              : "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.15)]"
        }`}
      />
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-cs-text-primary truncate">{name}</div>
        <div className="text-[11px] text-cs-text-muted truncate">{detail && ready ? detail : state}</div>
      </div>
    </div>
  );
}

function HowTo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-1.5 cursor-pointer list-none text-[12px] font-medium text-cs-text-secondary hover:text-cs-text-primary select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="mt-2 pl-5 text-[12px] leading-relaxed text-cs-text-secondary">{children}</div>
    </details>
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

  /**
   * The app's Gemini readiness is a composite, and every surface must agree on it: a server
   * environment key, an active client session, or a client key — any one carries the clinical
   * AI. The server diagnostics verdict alone (`diagnostics.geminiReady`, the server-env key)
   * reported Offline while a live session ran, contradicting the rail ("Session Active") and
   * the form gate on the same state.
   */
  const geminiOperational =
    sessionActive || (!sessionExpired && serverGeminiReady) || Boolean(settings.geminiApiKey?.trim());
  const geminiSource = sessionActive
    ? "Session active"
    : serverGeminiReady
      ? diagnostics?.geminiModel || "Server key active"
      : geminiOperational
        ? "Client key"
        : undefined;

  const handleGeminiKeyChange = (value: string) => {
    const previous = settings.geminiApiKey || "";
    updateSetting("geminiApiKey", value.trim());
    // A stateless session is bound to the key that created it — clear the old
    // session as soon as the key is edited so no stale token is reported active.
    if (value.trim() !== previous) {
      updateSetting("geminiSessionId", "");
      updateSetting("geminiSessionExpiresAt", 0);
      clearInvalidApiKey(value.trim());
    }
    clearLinkError();
  };

  const statusTone = sessionActive || (!sessionExpired && serverGeminiReady)
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
    : sessionExpired
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
      : "bg-cs-surface-2 text-cs-text-secondary border-cs-border-subtle";
  const dotTone = sessionActive || (!sessionExpired && serverGeminiReady)
    ? "bg-emerald-500"
    : sessionExpired
      ? "bg-amber-500"
      : "bg-cs-text-muted";

  return (
    <div className="space-y-7">
      <SettingsSection
        title="Gemini session"
        hint="Optional. Unlocks AI clinical synthesis and PubMed narrative mining — core biophysics and 3D folding work without a key."
      >
        <SettingsBlock className="!pb-0 border-none">
          <div role="status" className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium ${statusTone}`}>
            <span aria-hidden className={`h-2 w-2 rounded-full shrink-0 ${dotTone}`} />
            {sessionActive
              ? `Session active — auto-renews, expires in ${minutesLeft} min`
              : sessionExpired
                ? "Session expired — link the key again to renew"
                : serverGeminiReady
                  ? "Server environment key active — pipeline online"
                  : "No Gemini key linked"}
          </div>
        </SettingsBlock>

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

        <SettingsBlock className="!py-3">
          <HowTo title="How to get a Google Gemini API key">
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                Visit{" "}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 font-medium text-cs-text-accent hover:opacity-80"
                >
                  Google AI Studio
                </a>{" "}
                and sign in with a Google account.
              </li>
              <li>Open “Get API key” in the top menu and create a key in an existing project.</li>
              <li>Paste the key above and press “Link API key”.</li>
            </ol>
          </HowTo>
        </SettingsBlock>
      </SettingsSection>

      <SettingsSection title="Credentials" hint="Held only for this browser tab and cleared on reset.">
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
          description="Enables ESM3 multimodal generative structural refinement on forge.evolutionaryscale.ai."
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
          description="Enables GPN-Star phylogeny LM, SaProt 650M structure-aware scoring, and ESM-2 via Hugging Face inference."
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
          description="Enables variant impact (AVI) scoring, the SHAP contributions of its 18 features, and Atlas track predictions."
          action={{
            label: "Test connection",
            busyLabel: "Testing…",
            busy: tests.alphagenome.testing,
            disabled: !settings.alphagenomeApiKey?.trim(),
            run: () => runTest("alphagenome")
          }}
          status={tests.alphagenome.status}
        />
        <SecretInput
          label="Tamarind Bio API key"
          placeholder="Enter TAMARIND_API_KEY…"
          value={settings.tamarindApiKey || ""}
          onChange={(value) => updateSetting("tamarindApiKey", value)}
          description="Remote execution and fallback for ThermoMPNN ΔΔG stability predictions on app.tamarind.bio."
          action={{
            label: "Test connection",
            busyLabel: "Testing…",
            busy: tests.tamarind.testing,
            disabled: !settings.tamarindApiKey?.trim(),
            run: () => runTest("tamarind")
          }}
          status={tests.tamarind.status}
        />
        <SettingsBlock className="!py-3">
          <HowTo title="How to get a Tamarind Bio API key">
            Visit{" "}
            <a
              href="https://app.tamarind.bio/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 font-medium text-cs-text-accent hover:opacity-80"
            >
              app.tamarind.bio/settings/api
            </a>{" "}
            to create an account and generate a key for remote biophysical prediction jobs.
          </HowTo>
        </SettingsBlock>
      </SettingsSection>

      <SettingsSection
        title="Server services"
        hint={loading ? "Checking service readiness…" : "FoldX and the model server are reported by the server diagnostics endpoint; Gemini reflects whichever source is carrying it. Cache controls live in Data & storage."}
      >
        <SettingsBlock>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <ServicePill name="FoldX engine" ready={diagnostics?.foldxReady} />
            <ServicePill name="Model server" ready={diagnostics?.modelServerReady} />
            <ServicePill name="Gemini" ready={geminiOperational} detail={geminiSource} />
          </div>
        </SettingsBlock>
      </SettingsSection>
    </div>
  );
}
