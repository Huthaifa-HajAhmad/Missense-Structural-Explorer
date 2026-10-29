import { useId, type ReactNode } from 'react';

/** Shared figure contract: named chart, visible instructions, text alternative and honest empty state.
 * An empty state replaces the visual but keeps the figure's actions and captions: the affordances
 * around a chart (change filters, inspect the listed methods) stay reachable when it has no points. */
export function ChartFrame({ title, description, legend, summary, empty, actions, children, footer }: {
  title: string; description: string; legend?: ReactNode; summary: string; empty?: string;
  actions?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const id = useId();
  return <figure className="viz-frame" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`}>
    <header className="viz-frame__head"><div><h2 id={`${id}-title`}>{title}</h2><p>{description}</p>{legend}</div>{actions}</header>
    <p className="sr-only" id={`${id}-summary`}>{summary}</p>
    {empty && <p className="viz-frame__empty">{empty}</p>}
    {children}
    {footer && <figcaption className="viz-frame__foot">{footer}</figcaption>}
  </figure>;
}
