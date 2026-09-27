import React from "react";

interface SettingsSectionProps {
  title: string;
  hint?: string;
  /** Optional trailing control rendered beside the group heading (e.g. a reset link). */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Grouped settings list: a quiet heading above a rounded card whose rows are
 * separated by hairline dividers. Rows own their own padding (see SettingsRow,
 * SettingsBlock, Switch, SecretInput) so the card stays flush.
 */
export function SettingsSection({ title, hint, action, children }: SettingsSectionProps) {
  return (
    <section className="settings-group" data-setting-title={title}>
      <div className="flex items-end justify-between gap-4 px-1 pb-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cs-text-muted">
            {title}
          </h3>
          {hint && (
            <p className="mt-0.5 text-[12px] leading-snug text-cs-text-muted/90 max-w-[62ch]">{hint}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="settings-card divide-y divide-cs-border-subtle">{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  label: string;
  description?: React.ReactNode;
  /** id of the labelled control, when the control is an input/select. */
  htmlFor?: string;
  /**
   * Put the control on its own line under the label. Use for wide controls
   * (3+ long segments) so the description column is never squeezed.
   */
  stacked?: boolean;
  children: React.ReactNode;
}

/** Standard label-left / control-right settings row (or stacked for wide controls). */
export function SettingsRow({ label, description, htmlFor, stacked = false, children }: SettingsRowProps) {
  const labelEl = htmlFor ? (
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-cs-text-primary">
      {label}
    </label>
  ) : (
    <span className="block text-[13px] font-medium text-cs-text-primary">{label}</span>
  );

  if (stacked) {
    return (
      <div className="settings-row px-4 py-3.5" data-setting-title={label}>
        {labelEl}
        {description && (
          <p className="mt-0.5 text-[12px] leading-snug text-cs-text-muted max-w-[60ch]">{description}</p>
        )}
        <div className="mt-3">{children}</div>
      </div>
    );
  }

  return (
    <div
      className="settings-row flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-4 py-3.5"
      data-setting-title={label}
    >
      <div className="min-w-0 flex-1 basis-56">
        {labelEl}
        {description && (
          <p className="mt-0.5 text-[12px] leading-snug text-cs-text-muted max-w-[52ch]">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Free-form padded block inside a settings card (custom layouts, callouts). */
export function SettingsBlock({
  children,
  className = "",
  title
}: {
  children: React.ReactNode;
  className?: string;
  /** Search anchor, matched by the settings search "jump to" behaviour. */
  title?: string;
}) {
  return (
    <div className={`settings-row px-4 py-3.5 ${className}`} data-setting-title={title}>
      {children}
    </div>
  );
}
