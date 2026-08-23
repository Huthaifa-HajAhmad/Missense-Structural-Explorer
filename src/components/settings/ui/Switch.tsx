import React from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Full settings-row switch: label + description + clay toggle. */
export function Switch({ checked, onChange, label, description, disabled = false }: SwitchProps) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <span className="min-w-0">
        <span className={`block text-[13px] font-medium ${disabled ? "text-cs-text-muted" : "text-cs-text-primary"}`}>
          {label}
        </span>
        {description && (
          <span className="block text-[11px] leading-normal text-cs-text-muted mt-0.5">{description}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-checked={checked}
        className="cs-switch"
        onClick={() => onChange(!checked)}
      >
        <span className="cs-switch-thumb" />
      </button>
    </div>
  );
}
