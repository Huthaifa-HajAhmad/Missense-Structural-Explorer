import React, { useId } from 'react';

/** Shared framing for a figure: question, scope, controls, visual and reading note. */
export function VisualizationPanel({ title, description, actions, children, note }: {
  title: string; description: string; actions?: React.ReactNode; children: React.ReactNode; note?: React.ReactNode;
}) {
  const id = useId();
  return <section className="viz-panel" aria-labelledby={id}>
    <header className="viz-panel__header"><div><h4 id={id}>{title}</h4><p>{description}</p></div>{actions}</header>
    <div className="viz-panel__body">{children}</div>
    {note && <footer className="viz-panel__note">{note}</footer>}
  </section>;
}
