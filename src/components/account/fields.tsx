/**
 * fields.tsx — the form pieces every account screen shares.
 *
 * Each field owns its label, hint and error, wired with `aria-describedby` / `aria-invalid`, so a
 * screen reader hears the same guidance a sighted reader sees. Errors are sentences from the server
 * or the shared policy (`src/shared/accountPolicy.ts`), never codes.
 */
import React, { useEffect, useId, useState } from "react";
import { Check, Eye, EyeOff, Loader2, TriangleAlert, CircleCheck, Info } from "lucide-react";
import { PASSWORD_MIN_LENGTH } from "../../shared/accountPolicy";

interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  /** Rendered at the right of the label row (e.g. a "Forgot?" link). */
  aside?: React.ReactNode;
}

export function TextField({ label, hint, error, aside, className = "", ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="acct-field">
      <div className="acct-label-row">
        <label htmlFor={id} className="acct-label">
          {label}
        </label>
        {aside}
      </div>
      <input
        id={id}
        className={`cs-input acct-input ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {hint && !error && (
        <p id={hintId} className="acct-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="acct-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Password input with a reveal toggle and a Caps Lock warning. The warning is the single most common
 * cause of a "wrong password" that is actually right, and costs nothing to show.
 */
export function PasswordField({ label, hint, error, aside, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const capsId = `${id}-caps`;
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const describedBy = [hint && !error ? hintId : null, error ? errorId : null, capsLock ? capsId : null].filter(Boolean).join(" ") || undefined;

  const trackCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  };

  return (
    <div className="acct-field">
      <div className="acct-label-row">
        <label htmlFor={id} className="acct-label">
          {label}
        </label>
        {aside}
      </div>
      <div className="acct-password">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          className="cs-input acct-input acct-input--password"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onKeyDown={trackCaps}
          onKeyUp={trackCaps}
          onBlur={() => setCapsLock(false)}
          {...input}
        />
        <button
          type="button"
          className="acct-reveal"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          title={revealed ? "Hide password" : "Show password"}
        >
          {revealed ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
        </button>
      </div>
      {capsLock && (
        <p id={capsId} className="acct-caps" role="status">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Caps Lock is on
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="acct-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="acct-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Live checklist under a new password: what is still missing, ticked off as the reader types. */
export function PasswordChecklist({ password, confirm }: { password: string; confirm: string }) {
  const longEnough = password.length >= PASSWORD_MIN_LENGTH;
  const matches = confirm.length > 0 && password === confirm;
  const remaining = Math.max(0, PASSWORD_MIN_LENGTH - password.length);
  return (
    <ul className="acct-checklist" aria-label="Password requirements">
      <li data-met={longEnough}>
        <span className="acct-check" aria-hidden>
          {longEnough && <Check className="w-3 h-3" />}
        </span>
        At least {PASSWORD_MIN_LENGTH} characters
        {!longEnough && password.length > 0 && <span className="acct-check-note"> · {remaining} to go</span>}
        <span className="sr-only">{longEnough ? " (met)" : " (not met yet)"}</span>
      </li>
      <li data-met={matches}>
        <span className="acct-check" aria-hidden>
          {matches && <Check className="w-3 h-3" />}
        </span>
        Both entries match
        <span className="sr-only">{matches ? " (met)" : " (not met yet)"}</span>
      </li>
    </ul>
  );
}

export function FormAlert({ tone, children }: { tone: "danger" | "info" | "success"; children: React.ReactNode }) {
  const Icon = tone === "danger" ? TriangleAlert : tone === "success" ? CircleCheck : Info;
  return (
    <div className={`acct-alert acct-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="w-4 h-4 shrink-0 mt-px" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SubmitButton({ busy, busyLabel, children, disabled }: { busy: boolean; busyLabel: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" className="cs-btn-primary acct-submit" disabled={busy || disabled} aria-busy={busy || undefined}>
      {busy ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Seconds left until `until` (epoch ms), ticking once a second; 0 once passed or when null. */
export function useCountdown(until: number | null): number {
  // The interval only forces a render; the time is read fresh each render, so the first frame after
  // a lockout shows the true remaining time rather than one measured from an older mount.
  const [, tick] = useState(0);
  const remaining = until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  const running = remaining > 0;
  // Keyed on `running`, so reaching zero tears the interval down instead of ticking forever.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running, until]);
  return remaining;
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
