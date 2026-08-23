import { useSettings } from "../../../context/SettingsContext";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Switch } from "../ui/Switch";
import { SettingsRow, SettingsSection } from "../ui/Section";
import { ColorSwatches } from "../ui/ColorSwatches";

const ACCENT_SWATCHES = [
  { id: "indigo", name: "Indigo", hex: "#6366F1" },
  { id: "purple", name: "Purple", hex: "#A855F7" },
  { id: "rose", name: "Rose", hex: "#F43F5E" },
  { id: "emerald", name: "Emerald", hex: "#10B981" },
  { id: "amber", name: "Amber", hex: "#F59E0B" },
  { id: "blue", name: "Blue", hex: "#3B82F6" }
] as const;

export function AppearanceSection() {
  const { theme, setTheme, settings, updateSetting } = useSettings();

  return (
    <div className="space-y-6">
      <SettingsSection title="Theme" hint="Applies instantly across the workspace.">
        <SettingsRow
          label="Color scheme"
          description="System follows your operating system preference."
        >
          <SegmentedControl
            ariaLabel="Color scheme"
            value={theme}
            onChange={(value) => setTheme(value)}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" }
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="Workspace accent"
          description="Tints selection highlights and interactive accents app-wide."
        >
          <ColorSwatches
            ariaLabel="Workspace accent color"
            colors={[...ACCENT_SWATCHES]}
            value={ACCENT_SWATCHES.find((a) => a.id === (settings.primaryAccent || "indigo"))?.hex || ACCENT_SWATCHES[0].hex}
            onChange={(hex) => {
              const match = ACCENT_SWATCHES.find((a) => a.hex === hex);
              if (match) updateSetting("primaryAccent", match.id);
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Accessibility">
        <Switch
          label="Reduce motion"
          description="Disables panel transitions, staggered reveals, and 3D camera easing. Defaults to your OS setting on first run."
          checked={settings.reducedMotion}
          onChange={(value) => updateSetting("reducedMotion", value)}
        />
        <Switch
          label="High-contrast viewport"
          description="Boosts residue color saturation and outline strength in the 3D viewer for low-contrast displays."
          checked={settings.neonHighContrast}
          onChange={(value) => updateSetting("neonHighContrast", value)}
        />
      </SettingsSection>
    </div>
  );
}
