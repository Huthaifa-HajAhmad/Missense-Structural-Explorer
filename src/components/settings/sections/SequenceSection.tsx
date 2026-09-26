import { useSettings } from "../../../context/SettingsContext";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsRow, SettingsSection } from "../ui/Section";

const SCHEME_DESCRIPTIONS: Record<string, string> = {
  chemical: "Groups residues by sidechain chemistry (aliphatic, aromatic, basic, acidic, polar).",
  hydrophobic: "Colors residues along the Kyte-Doolittle hydrophobicity gradient.",
  minimal: "Monochrome tones keeping structural focus on the active missense site."
};

export function SequenceSection() {
  const { settings, updateSetting } = useSettings();

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Residue coloring"
        hint="Applied to the linear sequence ribbon and tolerance landscape tracks."
      >
        <SettingsRow
          label="Color scheme"
          description={SCHEME_DESCRIPTIONS[settings.seqColorScheme] || SCHEME_DESCRIPTIONS.chemical}
        >
          <SegmentedControl
            ariaLabel="Residue color scheme"
            value={settings.seqColorScheme}
            onChange={(value) => updateSetting("seqColorScheme", value)}
            options={[
              { value: "chemical", label: "Chemical" },
              { value: "hydrophobic", label: "Hydrophobic" },
              { value: "minimal", label: "Minimal" }
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Sequence ribbon"
        hint="Controls the horizontal residue viewport window."
      >
        <SettingsRow
          label="Visible slice size"
          description="Number of residues shown simultaneously in the ribbon viewport."
        >
          <SegmentedControl
            ariaLabel="Ribbon slice size"
            value={settings.seqScrollStep}
            onChange={(value) => updateSetting("seqScrollStep", value)}
            options={[
              { value: 15, label: "15 aa" },
              { value: 21, label: "21 aa" },
              { value: 31, label: "31 aa" },
              { value: 41, label: "41 aa" }
            ]}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
