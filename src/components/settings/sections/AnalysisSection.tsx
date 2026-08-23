import { useId } from "react";
import { useSettings } from "../../../context/SettingsContext";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsRow, SettingsSection } from "../ui/Section";

const CONDITION_FIELDS = [
  {
    key: "ph" as const,
    label: "pH",
    step: 0.1,
    min: 0,
    max: 14
  },
  {
    key: "temperature" as const,
    label: "Temp (°C)",
    step: 1,
    min: 0,
    max: 100
  },
  {
    key: "ionicStrength" as const,
    label: "Ionic (mM)",
    step: 10,
    min: 0,
    max: 2000
  }
];

export function AnalysisSection() {
  const { settings, updateSetting } = useSettings();
  const weightingId = useId();

  const updateCondition = (key: "ph" | "temperature" | "ionicStrength", value: number) => {
    if (Number.isNaN(value)) return;
    updateSetting("biophysicsConditions", {
      ...settings.biophysicsConditions,
      [key]: value
    });
  };

  return (
    <div className="space-y-6">
      <SettingsSection title="Clinical">
        <SettingsRow
          label="ACMG weighting model"
          htmlFor={weightingId}
          description="Governs how the pathfinder balances evidence criteria for the final ACMG classification."
        >
          <select
            id={weightingId}
            value={settings.acmgWeighting}
            onChange={(e) =>
              updateSetting("acmgWeighting", e.target.value as typeof settings.acmgWeighting)
            }
            className="cs-input cursor-pointer w-60"
          >
            <option value="standard">Standard (app default)</option>
            <option value="conservative">Conservative — downgrades speculative criteria</option>
            <option value="strict-structural">Strict-structural — weights PM1/PS3 hotspots</option>
          </select>
        </SettingsRow>
        <SettingsRow label="ΔΔG energy unit">
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

      <SettingsSection title="Default models" hint="Pre-selects these models when a new analysis session starts.">
        <SettingsRow label="Structure source">
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
        <SettingsRow label="Perturbation model">
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
      </SettingsSection>

      <SettingsSection
        title="Simulation conditions"
        hint="Environmental parameters sent with biophysical stability requests. Defaults mirror physiological conditions."
      >
        <div className="py-3 flex flex-wrap items-end gap-4">
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
        <p className="text-[11px] leading-normal text-cs-text-muted -mt-1 pb-1">
          Used by FoldX repacking and remote stability engines that accept environmental conditions.
        </p>
      </SettingsSection>
    </div>
  );
}
