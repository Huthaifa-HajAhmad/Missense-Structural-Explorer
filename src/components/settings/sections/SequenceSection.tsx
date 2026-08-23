import { useId } from "react";
import { useSettings } from "../../../context/SettingsContext";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsRow, SettingsSection } from "../ui/Section";

export function SequenceSection() {
  const { settings, updateSetting } = useSettings();
  const schemeId = useId();

  return (
    <div className="space-y-6">
      <SettingsSection title="Residue coloring">
        <SettingsRow
          label="Color scheme"
          htmlFor={schemeId}
          description="Applied to the linear sequence ribbon and landscape tracks."
        >
          <select
            id={schemeId}
            value={settings.seqColorScheme}
            onChange={(e) =>
              updateSetting("seqColorScheme", e.target.value as typeof settings.seqColorScheme)
            }
            className="cs-input cursor-pointer w-52"
          >
            <option value="chemical">Chemical properties</option>
            <option value="hydrophobic">Hydrophobicity gradient</option>
            <option value="minimal">Minimalist monochrome</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Ribbons">
        <SettingsRow
          label="Slice size"
          description="Number of residues visible per ribbon viewport. Used by the sequence ribbon and intolerance landscape."
        >
          <SegmentedControl
            ariaLabel="Ribbon slice size"
            value={settings.seqScrollStep}
            onChange={(value) => updateSetting("seqScrollStep", value)}
            options={[
              { value: 15, label: "15" },
              { value: 21, label: "21" },
              { value: 31, label: "31" },
              { value: 41, label: "41" }
            ]}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
