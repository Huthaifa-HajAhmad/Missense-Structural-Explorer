import { useState } from "react";
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
  const [paletteMode, setPaletteMode] = useState<"vibrant" | "muted">(() =>
    MUTED_SWATCHES.some((s) => s.hex === settings.residueColor) ? "muted" : "vibrant"
  );

  const activeColorName =
    [...VIBRANT_SWATCHES, ...MUTED_SWATCHES].find((s) => s.hex.toLowerCase() === settings.residueColor.toLowerCase())?.name ||
    "Custom";

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Target residue highlight"
        hint="Color used to mark the queried missense residue in the 3D viewport."
      >
        <div className="py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <SegmentedControl
              ariaLabel="Residue palette mode"
              value={paletteMode}
              onChange={(value) => setPaletteMode(value)}
              options={[
                { value: "vibrant", label: "Vibrant" },
                { value: "muted", label: "Muted" }
              ]}
            />

            {/* Live 3D Specular Preview Sphere */}
            <div
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-cs-border-subtle bg-cs-surface-2"
              title={`Active highlight: ${activeColorName} (${settings.residueColor})`}
            >
              <span
                className="w-4.5 h-4.5 rounded-full shadow-sm shrink-0 border border-black/10 dark:border-white/10"
                style={{
                  background: `radial-gradient(circle at 30% 30%, #ffffff 0%, ${settings.residueColor} 45%, #111111 100%)`
                }}
              />
              <span className="font-mono text-[11px] font-medium text-cs-text-primary [font-variant-numeric:tabular-nums]">
                {settings.residueColor}
              </span>
            </div>
          </div>

          <ColorSwatches
            ariaLabel="Target residue color"
            colors={paletteMode === "vibrant" ? VIBRANT_SWATCHES : MUTED_SWATCHES}
            value={settings.residueColor}
            onChange={(hex) => updateSetting("residueColor", hex)}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Camera">
        <SettingsRow
          label="Transition speed"
          description="Interpolation duration when rotating or centering onto residues."
        >
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
          description="Draws hydrogen bonds and polar interactions around the target residue."
          checked={settings.showAtomInteractions}
          onChange={(value) => updateSetting("showAtomInteractions", value)}
        />
      </SettingsSection>
    </div>
  );
}
