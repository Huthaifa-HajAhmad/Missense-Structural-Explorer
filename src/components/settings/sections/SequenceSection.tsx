import { useSettings } from "../../../context/SettingsContext";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsRow, SettingsSection } from "../ui/Section";

const SCHEME_DESCRIPTIONS: Record<string, string> = {
  chemical: "Groups residues by sidechain chemistry (aliphatic, aromatic, basic, acidic, polar).",
  hydrophobic: "Colors residues along the Kyte-Doolittle hydrophobicity gradient.",
  minimal: "Monochrome tones keeping structural focus on the active missense site."
};

/** Representative residues for the live scheme preview strip (target at index 9). */
const PREVIEW = "MKTAYIAKQRDEWFGHPNS".split("");
const TARGET_INDEX = 9;

/** Mirrors AMINO_ACID_MAP_FULL in sequence/sequenceConstants.ts (Tailwind 500 tones). */
const CHEMICAL: Record<string, string> = {
  A: "#10B981", V: "#10B981", I: "#10B981", L: "#10B981", M: "#10B981",
  K: "#3B82F6", R: "#3B82F6", H: "#3B82F6",
  D: "#F43F5E", E: "#F43F5E",
  N: "#0EA5E9", Q: "#0EA5E9", S: "#0EA5E9", T: "#0EA5E9",
  G: "#A855F7", P: "#A855F7",
  C: "#14B8A6",
  F: "#F59E0B", Y: "#F59E0B", W: "#F59E0B"
};
/** Kyte-Doolittle hydropathy index. */
const KD: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8, W: -0.9,
  Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5
};

function previewColor(scheme: string, aa: string, index: number) {
  if (scheme === "minimal") return index === TARGET_INDEX ? "var(--cs-accent-clay)" : "var(--cs-text-muted)";
  if (scheme === "hydrophobic") {
    const t = ((KD[aa] ?? 0) + 4.5) / 9; // 0 = hydrophilic, 1 = hydrophobic
    return `color-mix(in oklab, #D97706 ${Math.round(t * 100)}%, #2563EB)`;
  }
  return CHEMICAL[aa] ?? "#94A3B8";
}

export function SequenceSection() {
  const { settings, updateSetting } = useSettings();
  const scheme = settings.seqColorScheme;

  return (
    <div className="space-y-7">
      <SettingsSection
        title="Residue coloring"
        hint="Applied to the linear sequence ribbon and tolerance landscape tracks."
      >
        <SettingsRow
          label="Color scheme"
          description={SCHEME_DESCRIPTIONS[scheme] || SCHEME_DESCRIPTIONS.chemical}
        >
          <SegmentedControl
            ariaLabel="Residue color scheme"
            value={scheme}
            onChange={(value) => updateSetting("seqColorScheme", value)}
            options={[
              { value: "chemical", label: "Chemical" },
              { value: "hydrophobic", label: "Hydrophobic" },
              { value: "minimal", label: "Minimal" }
            ]}
          />
        </SettingsRow>
        <div className="px-4 py-3" aria-hidden>
          <div className="flex gap-[3px]">
            {PREVIEW.map((aa, i) => (
              <span
                key={i}
                className={`flex-1 min-w-0 grid place-items-center h-7 rounded-[5px] font-mono text-[11px] font-semibold transition-colors ${
                  i === TARGET_INDEX ? "ring-1 ring-inset ring-current" : ""
                }`}
                style={{
                  color: previewColor(scheme, aa, i),
                  background: `color-mix(in srgb, ${previewColor(scheme, aa, i)} 13%, transparent)`
                }}
              >
                {aa}
              </span>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Sequence ribbon" hint="Controls the horizontal residue viewport window.">
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
