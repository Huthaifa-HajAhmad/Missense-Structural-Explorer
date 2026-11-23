import { useSettings } from "../../../context/SettingsContext";
import { useApiConnections } from "../../../hooks/useApiConnections";
import { SecretInput } from "../ui/SecretInput";
import { SettingsBlock, SettingsSection } from "../ui/Section";
import { clearInvalidApiKey } from "../../../api/authSession";
import { AccountTokenControls, LastCredentialUse, TokenOwnershipIntro, useSavedSecrets } from "./TokenOwnership";
import { HowTo, TokenField } from "./connectionParts";
import { OptionalProviders } from "./OptionalProviders";
import { CredentialStatus, useKeyFieldStatus } from "./CredentialStatus";

export function ConnectionsSection() {
  const { settings, updateSetting } = useSettings();
  const { tests, runTest, linking, linkError, linkGeminiKey, clearLinkError } = useApiConnections();
  const secrets = useSavedSecrets();
  const keyStatus = useKeyFieldStatus({ linking, linkError, linkGeminiKey });

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

  return (
    <div className="space-y-7">
      <SettingsSection
        title="Gemini session"
        hint="Optional. Unlocks AI clinical synthesis and PubMed narrative mining — core biophysics and 3D folding work without a key."
      >
        <TokenField>
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
          <CredentialStatus card={keyStatus.gemini} />
        </TokenField>

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

      <SettingsSection
        title="Credentials"
        hint={secrets.signedIn
          ? "Held for this browser tab unless you save a token to your account."
          : "Held only for this browser tab and cleared on reset."}
      >
        <TokenOwnershipIntro />
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
        <TokenField>
          <SecretInput
            label="JapanFold API key"
            placeholder="Enter JAPANFOLD_API_KEY…"
            value={settings.japanfoldApiKey || ""}
            onChange={(value) => updateSetting("japanfoldApiKey", value)}
            description="Enables Boltz-2 multimer folding on api.japanfold.aiand.com."
            action={{
              label: "Test connection",
              busyLabel: "Testing…",
              busy: tests.japanfold.testing,
              disabled: !settings.japanfoldApiKey?.trim() && !secrets.saved?.japanfold?.readable,
              run: () => runTest("japanfold", { useSaved: !settings.japanfoldApiKey?.trim() })
            }}
            status={tests.japanfold.status}
          />
          <AccountTokenControls kind="japanfold" label="JapanFold" browserToken={settings.japanfoldApiKey || ""} clearBrowserToken={() => updateSetting("japanfoldApiKey", "")} secrets={secrets} />
          <LastCredentialUse kind="japanfold" />
        </TokenField>
        <SettingsBlock className="!py-3">
          <HowTo title="How to get a JapanFold API key">
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                Visit{" "}
                <a
                  href="https://japanfold.aiand.com/account/token"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 font-medium text-cs-text-accent hover:opacity-80"
                >
                  japanfold.aiand.com/account/token
                </a>{" "}
                and sign in with an email address (new accounts include $100 in starter credits).
              </li>
              <li>Create or copy your API key from the token page.</li>
              <li>Paste the key above and press “Test connection” (or save it to your account if signed in).</li>
            </ol>
          </HowTo>
        </SettingsBlock>
        <TokenField>
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
          <CredentialStatus card={keyStatus.alphagenome} />
        </TokenField>
      </SettingsSection>

      <OptionalProviders tests={tests} runTest={runTest} secrets={secrets} />
    </div>
  );
}
