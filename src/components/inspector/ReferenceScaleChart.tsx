import React, { useState, type CSSProperties } from 'react';

export interface ReferenceItem {
  key: string; label: string; definition: string;
  /** Label drawn on the chart when the full label is too long for it. */
  short?: string;
  /** Short mark drawn on the item when this gene or disease uses it (a count, "HI"); null when unused. */
  badge: string | null;
  /** The same fact in words, for the readout and for screen readers. */
  note: string | null;
  caution?: boolean;
  /** Drawn as an outline: the step means "no evidence", not a small amount of it. */
  hollow?: boolean;
}

/**
 * A short reference scale: graded steps as a staircase of bars (taller = more evidence), other
 * categories as chips beside it, and one readout that shows the chosen item's definition.
 * Choosing an item changes only the readout; it never changes evidence.
 */
export function ReferenceScaleChart({ title, stepsLabel, steps, groups, prompt, initial = null }: {
  title: string; stepsLabel: string; steps: ReferenceItem[]; groups: { label: string; items: ReferenceItem[] }[]; prompt: string;
  /** The item the readout opens on (else the first one in use). Read once: the caller changes `key` to reset it. */
  initial?: string | null;
}) {
  const all = [...steps, ...groups.flatMap(g => g.items)];
  const [chosen, setChosen] = useState<string | null>(() => initial ?? all.find(i => i.badge)?.key ?? null);
  const current = all.find(i => i.key === chosen) ?? null;
  const button = (item: ReferenceItem, className: string, children: React.ReactNode, style?: CSSProperties) =>
    <button key={item.key} type="button" className={className} style={style} aria-pressed={chosen === item.key}
      aria-label={item.note ? `${item.label}. ${item.note}` : item.label} data-marked={item.badge ? true : undefined}
      data-caution={item.caution || undefined} onClick={() => setChosen(chosen === item.key ? null : item.key)}>{children}</button>;
  return <div className="gd-ref" role="group" aria-label={title}>
    <p className="gd-ref__axis">{stepsLabel}<span aria-hidden="true"> →</span></p>
    <div className="gd-ref__steps" style={{ '--gd-steps': steps.length } as CSSProperties}>
      {steps.map((item, i) => button(item, 'gd-ref__step', <>
        <span className="gd-ref__badge" aria-hidden="true">{item.badge}</span>
        <span className="gd-ref__bar" data-hollow={item.hollow || undefined} aria-hidden="true" />
        <span className="gd-ref__label">{item.short ?? item.label}</span>
      </>, { '--gd-step': (i + 1) / steps.length } as CSSProperties))}
    </div>
    {groups.map(g => <div key={g.label} className="gd-ref__group">
      <span className="gd-ref__group-label">{g.label}</span>
      <div className="gd-ref__chips">{g.items.map(item => button(item, 'gd-ref__chip', <>{item.short ?? item.label}{item.badge && <span className="gd-ref__chip-badge" aria-hidden="true">{item.badge}</span>}</>))}</div>
    </div>)}
    <div className="gd-ref__readout" aria-live="polite">
      {current ? <><p><strong>{current.label}</strong></p>{current.note && <p className="gd-ref__note">{current.note}</p>}<p>{current.definition}</p></>
        : <p className="gd-caption">{prompt}</p>}
    </div>
  </div>;
}
