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
          description="Shows a banner when a background job, such as a stability prediction, fails. When off, the failure still shows in its result panel."
          checked={settings.autoShowAlerts}
          onChange={(value) => updateSetting("autoShowAlerts", value)}
        />
      </SettingsSection>

      <SettingsSection title="Search history" hint="Recent searches never leave this device.">
        <Switch
          label="Save variant search history"
          description="Keeps recent searches in this browser between visits. When off, recents last only until you reload the page."
          checked={settings.saveHistory}
          onChange={(value) => updateSetting("saveHistory", value)}
        />
        <SettingsRow label="History limit" description="How many recent searches to keep.">
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
      </SettingsSection>
    </div>
  );
}
