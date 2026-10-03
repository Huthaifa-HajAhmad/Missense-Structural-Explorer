import { RotateCcw } from "lucide-react";
import { useSettings } from "../../../context/SettingsContext";
import { DEFAULT_UI_BIOPHYSICS_CONDITIONS } from "../../../shared/biophysicsConditions";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsBlock, SettingsRow, SettingsSection } from "../ui/Section";
import { SPLICEAI_WINDOWS } from "../../../shared/splicingEvidence";

const CONDITION_FIELDS = [
  { key: "ph" as const, label: "pH", unit: "", step: 0.1, min: 0, max: 14 },
  { key: "temperature" as const, label: "Temperature", unit: "°C", step: 1, min: 0, max: 100 },
  { key: "ionicStrength" as const, label: "Ionic strength", unit: "mM", step: 10, min: 0, max: 2000 }
];

/**
 * What "physiological" means here — the shared UI defaults, not a fourth copy of the numbers.
 *
 * These are the values the panel DISPLAYS and resets to, in the panel's own units (°C, mM). The wire
 * carries Kelvin and molar, converted at the client boundary (`foldxService` →
 * `toNativeFoldxConditions`), so nothing in this file should ever be handed to the server as-is.
 */
const PHYSIOLOGICAL = DEFAULT_UI_BIOPHYSICS_CONDITIONS;

const ACMG_DESCRIPTIONS: Record<string, string> = {
  standard: "Standard ACMG/AMP rules balancing population, computational, and functional evidence.",
  conservative: "Downgrades speculative in-silico predictions to avoid false-positive pathogenicity calls.",
  "strict-structural": "Heavily weights PM1 structural hotspots and PS3 functional assays."
};

/**
 * SpliceAI reporting windows. 50 is Illumina's published default (and what its precomputed tables
 * used); 500 is the Broad Lookup's default and this app's. Wider windows reach cryptic sites deeper in
 * an intron at the cost of more reported positions and a slower request.
 */
const SPLICEAI_DESCRIPTIONS: Record<number, string> = {
  50: "Illumina's published default. Reports only sites within 50 bp of the variant.",
  200: "A middle reach: catches most cryptic sites in the neighbouring intron.",
  500: "The Broad Lookup's default. Comparable with what the Broad web tool shows.",
  1000: "Reaches deeper into introns; more positions reported, slower request.",
  2000: "The widest reach the splice map draws; slowest request."
};

const SAPROT_DESCRIPTIONS: Record<string, string> = {
  "saprot-650m": "Local 650M on CPU — most accurate, ~3.5 s per variant.",
  "saprot-35m": "Local 35M — ~200 ms per variant with a low memory footprint.",
  "remote-hf": "Hugging Face inference — requires an HF token under Connections."
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

  const isPhysiological =
    settings.biophysicsConditions.ph === PHYSIOLOGICAL.ph &&
    settings.biophysicsConditions.temperature === PHYSIOLOGICAL.temperature &&
    settings.biophysicsConditions.ionicStrength === PHYSIOLOGICAL.ionicStrength;

  const saprotEngine = settings.saprotEngine || "saprot-650m";
  const spliceaiWindow = (SPLICEAI_WINDOWS as readonly number[]).includes(settings.spliceaiWindow ?? 500) ? (settings.spliceaiWindow ?? 500) : 500;

  return (
    <div className="space-y-7">
      <SettingsSection title="Optional AI synthesis">
        <SettingsRow stacked label="Generate AI narrative" description="Evidence and the workspace are available independently. Automatic runs Gemini in the background; on-demand waits for you to select Synthesize in Report; off makes no narrative requests.">
          <SegmentedControl fullWidth ariaLabel="AI narrative mode" value={settings.narrativeMode || "automatic"}
            onChange={(value) => updateSetting("narrativeMode", value)}
            options={[{ value: "automatic", label: "Automatic" }, { value: "on-demand", label: "On demand" }, { value: "off", label: "Off" }]} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Clinical evidence weighting">
        <SettingsRow
          stacked
          label="ACMG weighting model"
          description={ACMG_DESCRIPTIONS[settings.acmgWeighting] || ACMG_DESCRIPTIONS.standard}
        >
          <SegmentedControl
            fullWidth
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
        <SettingsRow label="ΔΔG energy unit" description="Unit displayed for protein stability calculations.">
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

      <SettingsSection title="RNA splicing">
        <SettingsRow
          stacked
          label="SpliceAI window"
          description={`${SPLICEAI_DESCRIPTIONS[spliceaiWindow]} Applies to the next analysis, and can also be changed beside the score on the RNA splicing tab, which re-scores just that variant.`}
        >
          <SegmentedControl
            fullWidth
            ariaLabel="SpliceAI reporting window"
            value={String(spliceaiWindow)}
            onChange={(value) => updateSetting("spliceaiWindow", Number(value))}
            options={SPLICEAI_WINDOWS.map((w) => ({ value: String(w), label: `±${w}` }))}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Default models" hint="Pre-selected when starting a new analysis.">
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
        <SettingsRow label="Perturbation model" description="Protein language model used for variant-effect embeddings.">
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
        <SettingsRow stacked label="SaProt execution tier" description={SAPROT_DESCRIPTIONS[saprotEngine]}>
          <SegmentedControl
            fullWidth
            ariaLabel="SaProt execution tier"
            value={saprotEngine}
            onChange={(value) => updateSetting("saprotEngine", value)}
            options={[
              { value: "saprot-650m", label: "650M · Accurate" },
              { value: "saprot-35m", label: "35M · Fast" },
              { value: "remote-hf", label: "Cloud · HF" }
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Simulation conditions"
        hint="Environment for FoldX force-field repacking and biophysical solvers."
        action={
          <button
            type="button"
            onClick={() => updateSetting("biophysicsConditions", { ...PHYSIOLOGICAL })}
            disabled={isPhysiological}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-cs-text-accent hover:bg-cs-bg-subtle disabled:text-cs-text-muted disabled:hover:bg-transparent disabled:cursor-default cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {isPhysiological ? "Physiological" : "Reset to physiological"}
          </button>
        }
      >
        <SettingsBlock title="Simulation conditions">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CONDITION_FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span className="block text-[12px] font-medium text-cs-text-secondary mb-1.5">{field.label}</span>
                <span className="relative block">
                  <input
                    type="number"
                    className={`cs-input w-full h-9 font-mono !text-[13px] [font-variant-numeric:tabular-nums] ${field.unit ? "pr-11" : ""}`}
                    value={settings.biophysicsConditions[field.key]}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(e) => updateCondition(field.key, parseFloat(e.target.value))}
                  />
                  {field.unit && (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-cs-text-muted">
                      {field.unit}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-[11px] text-cs-text-muted [font-variant-numeric:tabular-nums]">
                  Physiological {PHYSIOLOGICAL[field.key]}
                  {field.unit ? ` ${field.unit}` : ""}
                </span>
              </label>
            ))}
          </div>
        </SettingsBlock>
      </SettingsSection>
    </div>
  );
}
