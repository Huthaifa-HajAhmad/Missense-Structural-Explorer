import { useId, type ReactNode } from 'react';

/** Shared figure contract: named chart, visible instructions, text alternative and honest empty state. */
export function ChartFrame({ title, description, summary, empty, actions, children, footer }: {
  title: string; description: string; summary: string; empty?: string;
  actions?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const id = useId();
  return <figure className="viz-frame" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`}>
    <header className="viz-frame__head"><div><h2 id={`${id}-title`}>{title}</h2><p>{description}</p></div>{actions}</header>
    <p className="sr-only" id={`${id}-summary`}>{summary}</p>
    {empty ? <p className="viz-frame__empty">{empty}</p> : children}
    {footer && <figcaption className="viz-frame__foot">{footer}</figcaption>}
  </figure>;
}
