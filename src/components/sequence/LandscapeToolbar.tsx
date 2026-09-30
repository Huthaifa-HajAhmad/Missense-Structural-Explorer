import React from "react";
import { Crosshair } from "lucide-react";
import type { SummaryMode } from "../../shared/landscapeEvidence";
import type { LandscapeViewState } from "../../stores/slices/searchSlice";

interface Props {
  view: LandscapeViewState;
  onView: (patch: Partial<LandscapeViewState>) => void;
  mode: SummaryMode;
  onMode?: (mode: SummaryMode) => void;
  width: number;
  onWidth?: (width: number) => void;
  targetPos: number;
  awayFromTarget: boolean;
  onBack: () => void;
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange?: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-cs-text-secondary">{label}</span>
      <div className="flex rounded-md border border-cs-border bg-cs-surface p-0.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange?.(o.value)}
            className={`px-2.5 py-1 rounded text-[11px] cursor-pointer ${
              value === o.value ? "bg-cs-text-primary text-cs-surface font-semibold" : "text-cs-text-secondary hover:text-cs-text-primary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Controls live beside what they change; the inspector rail keeps only the selection. */
export function LandscapeToolbar({ view, onView, mode, onMode, width, onWidth, targetPos, awayFromTarget, onBack }: Props) {
  const lanes: Array<{ key: keyof LandscapeViewState["lanes"]; label: string }> = [
    { key: "clinvar", label: "ClinVar" },
    { key: "gnomad", label: "gnomAD" },
    { key: "regions", label: "Regional O/E" }
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Segmented
        label="Colour by"
        options={[
          { value: "alphaMissense", label: "AlphaMissense" },
          { value: "revel", label: "REVEL" }
        ]}
        value={view.colorBy}
        onChange={(colorBy) => onView({ colorBy })}
      />
      <Segmented
        label="Residue summary"
        options={[
          { value: "mean", label: "Mean" },
          { value: "max", label: "Max" }
        ]}
        value={mode}
        onChange={onMode}
      />
      <Segmented label="Focus width" options={[15, 21, 31, 41].map((w) => ({ value: w, label: String(w) }))} value={width} onChange={onWidth} />
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-cs-text-secondary">Lanes</span>
        {lanes.map((l) => (
          <button
            key={l.key}
            type="button"
            aria-pressed={view.lanes[l.key]}
            onClick={() => onView({ lanes: { ...view.lanes, [l.key]: !view.lanes[l.key] } })}
            className={`px-2.5 py-1 rounded-md border text-[11px] cursor-pointer ${
              view.lanes[l.key]
                ? "bg-cs-text-primary text-cs-surface border-cs-text-primary font-semibold"
                : "bg-cs-surface text-cs-text-secondary border-cs-border hover:text-cs-text-primary"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      {awayFromTarget && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-cs-accent-clay bg-cs-surface text-cs-accent-clay font-semibold cursor-pointer"
        >
          <Crosshair className="w-3.5 h-3.5" />
          Back to residue {targetPos}
        </button>
      )}
    </div>
  );
}
