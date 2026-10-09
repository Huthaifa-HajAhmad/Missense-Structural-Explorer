import React from 'react';

/** Workspace navigation: one keyboard stop, automatic activation, labelled panels. */
export function WorkspaceTabs<T extends string>({ id, label, tabs, value, onChange }: {
  id: string; label: string; tabs: readonly { id: T; label: string }[];
  value: T; onChange: (value: T) => void;
}) {
  return <div className="workspace-tabs" role="tablist" aria-label={label} onKeyDown={event => {
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
    {tabs.map(tab => <button type="button" key={tab.id} id={`${id}-tab-${tab.id}`}
      role="tab" aria-selected={value === tab.id} aria-controls={value === tab.id ? `${id}-panel-${tab.id}` : undefined}
      tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>{tab.label}</button>)}
  </div>;
}
