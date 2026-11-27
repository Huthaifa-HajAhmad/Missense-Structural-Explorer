import React, { Fragment } from 'react';

/** The words every dot carries: a screen reader hears them, and the hover tooltip shows them. */
const MARK_LEAD = 'Holds a finding this view does not show';

/**
 * Workspace navigation: one keyboard stop, automatic activation, labelled panels.
 *
 * A tab may carry a `mark`: one plain sentence saying what it holds ("ClinVar has a classification…").
 * Every tab except the open one shows it as a small dot after the label, so a reader can see there is
 * something to open; the open tab is already showing its own content. Hovering the tab shows the words,
 * and assistive technology reads them as the tab's description. They are not part of the tab's name, so
 * the name stays the label.
 */
export function WorkspaceTabs<T extends string>({ id, label, tabs, value, onChange, variant = 'primary' }: {
  variant?: 'primary' | 'secondary';
  id: string; label: string; tabs: readonly { id: T; label: string; mark?: string }[];
  value: T; onChange: (value: T) => void;
}) {
  return <div className="workspace-tabs" data-variant={variant === 'secondary' ? variant : undefined} role="tablist" aria-label={label} onKeyDown={event => {
    const at = tabs.findIndex(tab => tab.id === value);
    const next = event.key === 'ArrowRight' ? (at + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (at + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    // By id, not a selector: ids from useId contain characters a selector would need escaped.
    event.currentTarget.ownerDocument.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
  }}>
    {tabs.map(tab => {
      const description = value !== tab.id && tab.mark ? `${MARK_LEAD}. ${tab.mark}` : undefined;
      return <Fragment key={tab.id}>
        <button type="button" id={`${id}-tab-${tab.id}`}
          role="tab" aria-selected={value === tab.id} aria-controls={value === tab.id ? `${id}-panel-${tab.id}` : undefined}
          aria-describedby={description ? `${id}-mark-${tab.id}` : undefined} data-marked={description ? '' : undefined} title={description}
          tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>
          {tab.label}
          {description && <span className="workspace-tabs__mark" aria-hidden="true" />}
        </button>
        {/* Outside the button, so the name stays the label; hidden, so the words are read only through the description. */}
        {description && <span id={`${id}-mark-${tab.id}`} hidden>{description}</span>}
      </Fragment>;
    })}
  </div>;
}
