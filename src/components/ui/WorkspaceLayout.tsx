import React from 'react';

/** Shared pane geometry; children stay mounted when the active workspace changes. */
export function WorkspaceLayout({ kind, children }: {
  kind?: 'landscape' | 'structure'; children: React.ReactNode;
}) {
  return <div className={`data-screen-layout${kind ? ` exploration-workspace ${kind}-workspace` : ''}`}>
    {children}
  </div>;
}
