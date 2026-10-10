import React, { useId, useState } from "react";
import { Check, Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";

export interface ValidationStatus {
  valid: boolean;
  message: string;
}

interface SecretInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  /** Optional inline action (Test connection / Link key). */
  action?: {
    label: string;
    busyLabel: string;
    busy: boolean;
    disabled?: boolean;
    run: () => void;
  };
  /** Async validation result, announced politely to screen readers. */
  status?: ValidationStatus | null;
}

/**
 * Credential row: label + "set" badge, masked input with reveal toggle and
 * attached action button, then an aria-live status line and helper text.
 */
export function SecretInput({
  label,
  value,
  onChange,
  placeholder,
  description,
  action,
  status
}: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);
  const inputId = useId();
  const statusId = useId();
  const descId = useId();
  const hasValue = Boolean(value);

  return (
    <div className="settings-row px-4 py-3.5" data-setting-title={label}>
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="text-[13px] font-medium text-cs-text-primary">
          {label}
        </label>
        {hasValue && !status && (
          <span className="rounded-full bg-cs-bg-subtle px-1.5 py-px text-[10px] font-medium text-cs-text-secondary">
            Set
          </span>
        )}
      </div>
      {description && (
        <p id={descId} className="mt-0.5 text-[12px] leading-snug text-cs-text-muted max-w-[62ch]">
          {description}
        </p>
      )}
      <div className="mt-2.5 flex items-stretch gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            id={inputId}
            type={revealed ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={description ? descId : undefined}
            placeholder={value ? "•••••••••••••••••••••••••••••••" : placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            className="cs-input w-full h-9 font-mono !text-xs pr-9"
          />
          <button
            type="button"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
            className="absolute cs-tap-44 right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle transition-colors cursor-pointer"
          >
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {action && (
          <button
            type="button"
            onClick={action.run}
            disabled={action.busy || action.disabled}
            className="cs-btn-ghost h-9 !px-3 !text-[12px] whitespace-nowrap shrink-0"
          >
            {action.busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {action.busy ? action.busyLabel : action.label}
          </button>
        )}
      </div>
      {status && (
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className={`mt-2 flex items-start gap-1.5 text-[12px] leading-snug rounded-lg px-2.5 py-1.5 border ${
            status.valid
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
              : "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
          }`}
        >
          {status.valid ? (
            <Check className="w-3.5 h-3.5 shrink-0 mt-px" />
          ) : (
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          )}
          <span>
            {status.message ||
              (status.valid ? "Connection active and valid." : "Endpoint unreachable or invalid credential.")}
          </span>
        </p>
      )}
    </div>
  );
}
