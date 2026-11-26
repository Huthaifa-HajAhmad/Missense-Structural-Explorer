import React from "react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";

/** An empty or waiting state, said as a sentence on the card, with an optional action under it. */
export function Statement({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="ifc-statement">
      <p className="ifc-statement__title">{title}</p>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ActionButton({ onClick, busy, icon, children }: { onClick: () => void; busy?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  // `aria-disabled`, not `disabled`: a disabled control leaves the tab order and drops focus to <body>.
  return (
    <button type="button" className="ifc-button" onClick={() => { if (!busy) onClick(); }} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
      {icon}
      {children}
    </button>
  );
}

/** A table row's reason and state chip, for a reading that has no value. */
export function StateCells({ label, reason, span = 2, action }: { label: string | null; reason: string | null; span?: number; action?: React.ReactNode }) {
  const tone = label === ENGINE_STATE_LABELS.running ? "neutral" : label === ENGINE_STATE_LABELS["upstream-error"] ? "warning" : "muted";
  return (
    <>
      <td className="ifc-reason" colSpan={span}>
        {reason}
        {action && <span className="ifc-inline-action">{action}</span>}
      </td>
      <td className="ifc-status">{label && <span className="ev-tier" data-tone={tone}>{label}</span>}</td>
    </>
  );
}
