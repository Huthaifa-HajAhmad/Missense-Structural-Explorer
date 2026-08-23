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
 * Credential input with masked/unmasked toggle, optional test action and an
 * aria-live status line. Replaces the five hand-rolled copies that used to
 * live in ApiKeysTab.
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

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="block text-[13px] font-medium text-cs-text-primary">
          {label}
        </label>
        {action && (
          <button
            type="button"
            onClick={action.run}
            disabled={action.busy || action.disabled}
            className="cs-btn-ghost !py-1 !px-2.5 !text-[11px] font-mono"
          >
            {action.busy && <Loader2 className="w-3 h-3 animate-spin" />}
            {action.busy ? action.busyLabel : action.label}
          </button>
        )}
      </div>
      <div className="relative mt-1.5">
        <input
          id={inputId}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder={value ? "•••••••••••••••••••••••••••••••" : placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          className="cs-input w-full font-mono !text-xs pr-9"
        />
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cs-text-muted hover:text-cs-text-primary transition-colors"
        >
          {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {status && (
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className={`mt-1.5 flex items-start gap-1.5 text-[11px] leading-normal rounded-md px-2 py-1.5 border ${
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
      {description && (
        <p className="text-[11px] leading-normal text-cs-text-muted mt-1.5">{description}</p>
      )}
    </div>
  );
}
