import { useSettings } from "../../../context/SettingsContext";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Switch } from "../ui/Switch";
import { SettingsRow, SettingsSection } from "../ui/Section";

export function WorkspaceSection() {
  const { settings, updateSetting } = useSettings();

  return (
    <div className="space-y-7">
      <SettingsSection title="Notifications">
        <Switch
          label="Show alert banners automatically"
          description="Raises warning and error banners as analysis results arrive. Turn off to review issues only from the notification tray."
          checked={settings.autoShowAlerts}
          onChange={(value) => updateSetting("autoShowAlerts", value)}
        />
      </SettingsSection>

      <SettingsSection title="Search history" hint="History is opt-in and never leaves this device.">
        <Switch
          label="Save variant search history"
          description="Stores recent queries locally for autocomplete and quick recall (obfuscated at rest). Off by default for PHI hygiene."
          checked={settings.saveHistory}
          onChange={(value) => updateSetting("saveHistory", value)}
        />
        <div
          className={`transition-opacity ${settings.saveHistory ? "" : "opacity-50"}`}
          aria-disabled={!settings.saveHistory || undefined}
        >
          <SettingsRow label="History limit" description="Even the highest limit stays well under 50 KB.">
            <SegmentedControl
              ariaLabel="History item limit"
              value={settings.maxHistoryItems}
              onChange={(value) => updateSetting("maxHistoryItems", value)}
              options={[
                { value: 5, label: "5" },
                { value: 10, label: "10" },
                { value: 20, label: "20" },
                { value: 50, label: "50" }
              ]}
            />
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
