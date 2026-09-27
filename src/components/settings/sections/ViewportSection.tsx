import { useState } from "react";
import { useSettings } from "../../../context/SettingsContext";
import { ColorSwatches } from "../ui/ColorSwatches";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Switch } from "../ui/Switch";
import { SettingsBlock, SettingsRow, SettingsSection } from "../ui/Section";

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
    MUTED_SWATCHES.some((s) => s.hex.toLowerCase() === settings.residueColor?.toLowerCase()) ? "muted" : "vibrant"
  );

  const activeColorName =
    [...VIBRANT_SWATCHES, ...MUTED_SWATCHES].find(
      (s) => s.hex.toLowerCase() === settings.residueColor.toLowerCase()
    )?.name || "Custom";

  return (
    <div className="space-y-7">
      <SettingsSection title="Target residue">
        <SettingsBlock title="Target residue highlight">
          <div className="flex items-center gap-4">
            {/* Live specular preview of the highlighted residue */}
            <div
              className="settings-residue-stage shrink-0"
              title={`Active highlight: ${activeColorName} (${settings.residueColor})`}
              aria-hidden
            >
              <span
                className="block w-9 h-9 rounded-full"
                style={{
                  background: `radial-gradient(circle at 32% 30%, #ffffff 0%, ${settings.residueColor} 42%, #111111 100%)`,
                  boxShadow: `0 6px 16px -4px ${settings.residueColor}99`
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-cs-text-primary">Highlight color</span>
              <p className="mt-0.5 text-[12px] leading-snug text-cs-text-muted">
                Marks the queried missense residue in the 3D viewport.
              </p>
              <p className="mt-1 text-[12px] text-cs-text-secondary">
                {activeColorName}
                <span className="ml-1.5 font-mono text-[11px] text-cs-text-muted [font-variant-numeric:tabular-nums]">
                  {settings.residueColor.toUpperCase()}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-cs-surface-2 px-3 py-2.5">
            <ColorSwatches
              ariaLabel="Target residue color"
              colors={paletteMode === "vibrant" ? VIBRANT_SWATCHES : MUTED_SWATCHES}
              value={settings.residueColor}
              onChange={(hex) => updateSetting("residueColor", hex)}
            />
            <SegmentedControl
              ariaLabel="Residue palette mode"
              value={paletteMode}
              onChange={(value) => setPaletteMode(value)}
              options={[
                { value: "vibrant", label: "Vibrant" },
                { value: "muted", label: "Muted" }
              ]}
            />
          </div>
        </SettingsBlock>
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
