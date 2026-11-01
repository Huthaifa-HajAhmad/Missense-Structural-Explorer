import React from "react";
import { Check, ChevronLeft, ChevronRight, Crosshair } from "lucide-react";
import type { SummaryMode } from "../../shared/landscapeEvidence";
import type { LandscapeViewState } from "../../stores/slices/searchSlice";

interface Props {
  scope?: "overview" | "focus";
  view: LandscapeViewState;
  onView: (patch: Partial<LandscapeViewState>) => void;
  mode: SummaryMode;
  onMode?: (mode: SummaryMode) => void;
  width: number;
  onWidth?: (width: number) => void;
  targetPos: number;
  /** A lane with nothing to draw (no regional constraint call for this gene) is disabled, not left lit. */
  available?: Partial<Record<keyof LandscapeViewState["lanes"], boolean>>;
  awayFromTarget: boolean;
  onBack: () => void;
  /** Focus scope: move the window one width left (−1) or right (+1); a bound with nowhere to go is disabled. */
  onStep?: (direction: -1 | 1) => void;
  canStep?: { previous: boolean; next: boolean };
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
    <div className="flex items-center gap-2" role="radiogroup" aria-label={label}>
      <span className="text-[11px] font-semibold text-cs-text-secondary">{label}</span>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange?.(o.value)}
          className="ls-pill"
          data-active={value === o.value ? "true" : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Controls live beside what they change; the inspector rail keeps only the selection. */
export function LandscapeToolbar({ scope, view, onView, mode, onMode, width, onWidth, targetPos, available, awayFromTarget, onBack, onStep, canStep }: Props) {
  const lanes: Array<{ key: keyof LandscapeViewState["lanes"]; label: string }> = [
    { key: "clinvar", label: "ClinVar" },
    { key: "gnomad", label: "gnomAD" },
    { key: "regions", label: "Regional O/E" }
  ];
  return (
    <div className="landscape-toolbar">
      {scope !== "overview" && <Segmented
        label="Colour by"
        options={[
          { value: "alphaMissense", label: "AlphaMissense" },
          { value: "revel", label: "REVEL" }
        ]}
        value={view.colorBy}
        onChange={(colorBy) => onView({ colorBy })}
      />}
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
      {scope === "focus" && onStep && (
        <div className="flex items-center gap-2" role="group" aria-label="Move the focus window">
          <button type="button" className="ls-pill" onClick={() => onStep(-1)} disabled={canStep?.previous === false}>
            <ChevronLeft className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> Previous {width}
          </button>
          <button type="button" className="ls-pill" onClick={() => onStep(1)} disabled={canStep?.next === false}>
            Next {width} <ChevronRight className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {scope !== "focus" && <div className="ls-lane-controls" role="group" aria-label="Visible lanes">
        <span className="text-[11px] font-semibold text-cs-text-secondary">Lanes</span>
        {lanes.map((l) => {
          const empty = available?.[l.key] === false;
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={view.lanes[l.key] && !empty}
              aria-disabled={empty || undefined}
              title={empty ? "Nothing to draw for this gene" : undefined}
              onClick={() => {
                if (!empty) onView({ lanes: { ...view.lanes, [l.key]: !view.lanes[l.key] } });
              }}
              className="ls-lane-toggle"
            >
              <Check size={12} aria-hidden="true" className="ls-lane-toggle__check" />
              {l.label}
            </button>
          );
        })}
      </div>}
      {awayFromTarget && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border border-cs-accent-clay bg-cs-surface text-cs-accent-clay font-semibold cursor-pointer"
        >
          <Crosshair className="w-3.5 h-3.5" />
          Back to residue {targetPos}
        </button>
      )}
    </div>
  );
}
