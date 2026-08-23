import React from "react";

interface SettingsSectionProps {
  title: string;
  hint?: string;
  children: React.ReactNode;
}

/** Section block with the app's signature mono-uppercase clay label. */
export function SettingsSection({ title, hint, children }: SettingsSectionProps) {
  return (
    <section>
      <div className="pb-2 border-b border-cs-border-subtle">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-cs-accent-clay">
          {title}
        </h3>
        {hint && <p className="text-[11px] leading-normal text-cs-text-muted mt-1">{hint}</p>}
      </div>
      <div className="divide-y divide-cs-border-subtle">{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  /** id of the labelled control, when the control is an input/select. */
  htmlFor?: string;
  children: React.ReactNode;
}

/** Standard label-left / control-right settings row. */
export function SettingsRow({ label, description, htmlFor, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[13px] font-medium text-cs-text-primary">
            {label}
          </label>
        ) : (
          <span className="block text-[13px] font-medium text-cs-text-primary">{label}</span>
        )}
        {description && (
          <p className="text-[11px] leading-normal text-cs-text-muted mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
