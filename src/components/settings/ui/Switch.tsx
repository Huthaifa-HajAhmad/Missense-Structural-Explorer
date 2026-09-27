import React, { useId } from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Full settings-row switch: label + description + accent toggle.
 * The whole text column is a <label> for the toggle, so the hit target is the
 * entire row rather than a 34px pill.
 */
export function Switch({ checked, onChange, label, description, disabled = false }: SwitchProps) {
  const id = useId();
  return (
    <div
      className={`settings-row flex items-center justify-between gap-6 px-4 py-3.5 ${
        disabled ? "" : "hover:bg-cs-bg-subtle/40"
      } transition-colors`}
      data-setting-title={label}
    >
      <label htmlFor={id} className={`min-w-0 flex-1 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
        <span
          className={`block text-[13px] font-medium ${disabled ? "text-cs-text-muted" : "text-cs-text-primary"}`}
        >
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-[12px] leading-snug text-cs-text-muted max-w-[56ch]">
            {description}
          </span>
        )}
      </label>
      <button
        id={id}
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
