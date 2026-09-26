import { RotateCcw, Zap } from "lucide-react";
import { useSettings } from "../../../context/SettingsContext";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsRow, SettingsSection } from "../ui/Section";

const CONDITION_FIELDS = [
  {
    key: "ph" as const,
    label: "pH",
    step: 0.1,
    min: 0,
    max: 14,
    defaultVal: 7.4
  },
  {
    key: "temperature" as const,
    label: "Temp (°C)",
    step: 1,
    min: 0,
    max: 100,
    defaultVal: 25
  },
  {
    key: "ionicStrength" as const,
    label: "Ionic (mM)",
    step: 10,
    min: 0,
    max: 2000,
    defaultVal: 150
  }
];

const ACMG_DESCRIPTIONS: Record<string, string> = {
  standard: "Standard ACMG/AMP rules balancing population, computational, and functional evidence.",
  conservative: "Downgrades speculative in-silico predictions to avoid false-positive pathogenicity calls.",
  "strict-structural": "Heavily weights PM1 structural hotspots and PS3 functional assays."
};

export function AnalysisSection() {
  const { settings, updateSetting } = useSettings();

  const updateCondition = (key: "ph" | "temperature" | "ionicStrength", value: number) => {
    if (Number.isNaN(value)) return;
    updateSetting("biophysicsConditions", {
      ...settings.biophysicsConditions,
      [key]: value
    });
  };

  const resetToPhysiological = () => {
    updateSetting("biophysicsConditions", {
      ph: 7.4,
      temperature: 25,
      ionicStrength: 150
    });
  };

  const isPhysiological =
    settings.biophysicsConditions.ph === 7.4 &&
    settings.biophysicsConditions.temperature === 25 &&
    settings.biophysicsConditions.ionicStrength === 150;

  return (
    <div className="space-y-6">
      <SettingsSection title="Clinical evidence weighting">
        <SettingsRow
          label="ACMG weighting model"
          description={ACMG_DESCRIPTIONS[settings.acmgWeighting] || ACMG_DESCRIPTIONS.standard}
        >
          <SegmentedControl
            ariaLabel="ACMG weighting model"
            value={settings.acmgWeighting}
            onChange={(value) => updateSetting("acmgWeighting", value)}
            options={[
              { value: "standard", label: "Standard" },
              { value: "conservative", label: "Conservative" },
              { value: "strict-structural", label: "Strict-Structural" }
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="ΔΔG energy unit"
          description="Unit of measurement displayed for protein stability calculations."
        >
          <SegmentedControl
            ariaLabel="Stability energy unit"
            value={settings.energyUnit}
            onChange={(value) => updateSetting("energyUnit", value)}
            options={[
              { value: "kcal/mol", label: "kcal/mol" },
              { value: "kJ/mol", label: "kJ/mol" }
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Default models" hint="Initial models pre-selected when starting a new analysis.">
        <SettingsRow label="Structure source" description="Primary coordinate source for 3D viewing and repacking.">
          <SegmentedControl
            ariaLabel="Default structure model"
            value={settings.defaultStructureModel}
            onChange={(value) => updateSetting("defaultStructureModel", value)}
            options={[
              { value: "alphafold", label: "AlphaFold2" },
              { value: "esmfold", label: "ESMFold" }
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Perturbation model" description="Foundation protein language model for variant effect embedding.">
          <SegmentedControl
            ariaLabel="Default perturbation model"
            value={settings.defaultPerturbationModel}
            onChange={(value) => updateSetting("defaultPerturbationModel", value)}
            options={[
              { value: "saprot", label: "SaProt" },
              { value: "esm2", label: "ESM-2" },
              { value: "esmc", label: "ESMc" }
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="SaProt execution tier"
          description="Local 650M CPU takes ~3.5s; 35M runs in ~200ms with low memory footprint."
        >
          <SegmentedControl
            ariaLabel="SaProt execution tier"
            value={settings.saprotEngine || "saprot-650m"}
            onChange={(value) => updateSetting("saprotEngine", value)}
            options={[
              { value: "saprot-650m", label: "650M (Accurate)" },
              { value: "saprot-35m", label: "35M (Fast)" },
              { value: "remote-hf", label: "Cloud (HF)" }
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Simulation conditions"
        hint="Environmental parameters for FoldX force field repacking and biophysical solvers."
      >
        <div className="py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-cs-text-secondary">Physical parameters</span>
            <button
              type="button"
              onClick={resetToPhysiological}
              disabled={isPhysiological}
              className={`text-[11px] font-mono px-2 py-1 rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer active:scale-[0.97] ${
                isPhysiological
                  ? "border-cs-border-subtle bg-cs-surface-2 text-cs-text-muted opacity-60 cursor-default"
                  : "border-cs-accent-clay/30 bg-cs-accent-clay/10 text-cs-accent-clay hover:bg-cs-accent-clay/20"
              }`}
            >
              <Zap className="w-3 h-3" />
              Reset to Physiological (7.4 · 25°C · 150mM)
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3.5">
            {CONDITION_FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-cs-text-muted mb-1.5">
                  {field.label}
                </span>
                <input
                  type="number"
                  className="cs-input w-24 font-mono !text-xs [font-variant-numeric:tabular-nums]"
                  value={settings.biophysicsConditions[field.key]}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onChange={(e) => updateCondition(field.key, parseFloat(e.target.value))}
                />
              </label>
            ))}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
