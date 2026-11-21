import { useSettings } from "../../../context/SettingsContext";
import type { useApiConnections } from "../../../hooks/useApiConnections";
import { SecretInput } from "../ui/SecretInput";
import { SettingsBlock, SettingsSection } from "../ui/Section";
import { AccountTokenControls, LastCredentialUse, type useSavedSecrets } from "./TokenOwnership";
import { HowTo, TokenField } from "./connectionParts";

type Connections = ReturnType<typeof useApiConnections>;

/**
 * Keys that change nothing on a standard setup. Tamarind runs ThermoMPNN only when the lab's own model
 * server gives no answer.
 */
export function OptionalProviders({
  tests,
  runTest,
  secrets
}: Pick<Connections, "tests" | "runTest"> & { secrets: ReturnType<typeof useSavedSecrets> }) {
  const { settings, updateSetting } = useSettings();

  return (
    <SettingsSection
      title="Optional providers"
      hint="Most setups do not need this. Add a key only for the case its description names."
    >
      <TokenField>
        <SecretInput
          label="Tamarind Bio API key"
          placeholder="Enter TAMARIND_API_KEY…"
          value={settings.tamarindApiKey || ""}
          onChange={(value) => updateSetting("tamarindApiKey", value)}
          description="ThermoMPNN cloud fallback, used only when the lab's own ThermoMPNN service does not answer. The job sends the structure and the mutation to app.tamarind.bio and uses your Tamarind allowance."
          action={{
            label: "Test connection",
            busyLabel: "Testing…",
            busy: tests.tamarind.testing,
            // A token saved to the account can be tested too (WP-I4b): the server tests the saved one.
            disabled: !settings.tamarindApiKey?.trim() && !secrets.saved?.tamarind?.readable,
            run: () => runTest("tamarind", { useSaved: !settings.tamarindApiKey?.trim() })
          }}
          status={tests.tamarind.status}
        />
        <AccountTokenControls kind="tamarind" label="Tamarind" browserToken={settings.tamarindApiKey || ""} clearBrowserToken={() => updateSetting("tamarindApiKey", "")} secrets={secrets} />
        <LastCredentialUse kind="tamarind" />
      </TokenField>
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
          to create an account and a key. A successful test shows the key is accepted; it does not run a job.
        </HowTo>
      </SettingsBlock>
    </SettingsSection>
  );
}
