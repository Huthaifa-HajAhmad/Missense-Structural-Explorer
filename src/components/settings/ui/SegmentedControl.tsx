import React, { useId } from "react";

interface SegmentedControlProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Stretch segments to fill the row (use inside stacked rows). */
  fullWidth?: boolean;
}

/** Typed wrapper over the .cs-seg-control primitive. */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = false
}: SegmentedControlProps<T>) {
  const groupId = useId();
  return (
    <div
      className={`cs-seg-control settings-seg${fullWidth ? " settings-seg--full" : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            id={`${groupId}-${String(option.value)}`}
            type="button"
            className={`cs-seg-btn${active ? " active" : ""}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
