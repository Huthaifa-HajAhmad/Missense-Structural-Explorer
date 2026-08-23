import { useSettings } from "../../../context/SettingsContext";
import { ColorSwatches } from "../ui/ColorSwatches";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Switch } from "../ui/Switch";
import { SettingsRow, SettingsSection } from "../ui/Section";

const VIBRANT_SWATCHES = [
  { name: "Sunset Orange", hex: "#F97316" },
  { name: "Emerald Green", hex: "#10B981" },
  { name: "Hot Pink", hex: "#EC4899" },
  { name: "Vibrant Gold", hex: "#F59E0B" },
  { name: "Deep Blue", hex: "#3B82F6" },
  { name: "Bright Indigo", hex: "#6366F1" }
];

const MUTED_SWATCHES = [
  { name: "Muted Rose", hex: "#C36A53" },
  { name: "Sage Green", hex: "#699C82" },
  { name: "Dusty Mauve", hex: "#BA7C93" },
  { name: "Muted Amber", hex: "#CC9E48" },
  { name: "Slate Blue", hex: "#5275A1" },
  { name: "Lavender Grey", hex: "#7E6EAC" }
];

export function ViewportSection() {
  const { settings, updateSetting } = useSettings();

  return (
    <div className="space-y-6">
      <SettingsSection title="Target residue highlight" hint="Color used to mark the queried missense residue in the 3D viewport.">
        <SettingsRow label="Vibrant">
          <ColorSwatches
            ariaLabel="Vibrant residue highlight colors"
            colors={VIBRANT_SWATCHES}
            value={settings.residueColor}
            onChange={(hex) => updateSetting("residueColor", hex)}
          />
        </SettingsRow>
        <SettingsRow label="Muted" description="Low-saturation alternatives for print-adjacent palettes.">
          <ColorSwatches
            ariaLabel="Muted residue highlight colors"
            colors={MUTED_SWATCHES}
            value={settings.residueColor}
            onChange={(hex) => updateSetting("residueColor", hex)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Camera">
        <SettingsRow label="Transition speed">
          <SegmentedControl
            ariaLabel="Camera transition speed"
            value={settings.cameraDuration}
            onChange={(value) => updateSetting("cameraDuration", value)}
            options={[
              { value: 0, label: "Snap" },
              { value: 800, label: "Fast" },
              { value: 1200, label: "Balanced" },
              { value: 2000, label: "Cinematic" }
            ]}
          />
        </SettingsRow>
        <Switch
          label="Auto-zoom on selection"
          description="Re-centers and zooms the viewport onto the selected residue."
          checked={settings.autoZoomOnSelect}
          onChange={(value) => updateSetting("autoZoomOnSelect", value)}
        />
      </SettingsSection>

      <SettingsSection title="Rendering">
        <Switch
          label="3D residue labels"
          description="Renders residue identity labels inside the 3D viewport."
          checked={settings.show3DLabels}
          onChange={(value) => updateSetting("show3DLabels", value)}
        />
        <Switch
          label="Polar contacts"
          description="Draws hydrogen bonds and polar interactions around the target residue. Also available from the structure legend."
          checked={settings.showAtomInteractions}
          onChange={(value) => updateSetting("showAtomInteractions", value)}
        />
      </SettingsSection>
    </div>
  );
}
