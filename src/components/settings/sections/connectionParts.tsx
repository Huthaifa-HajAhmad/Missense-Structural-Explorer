import React from "react";
import { ChevronRight } from "lucide-react";

/** A folded "how to get this key" note under a credential field. */
export function HowTo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-1.5 cursor-pointer list-none text-[12px] font-medium text-cs-text-secondary hover:text-cs-text-primary select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="mt-2 pl-5 text-[12px] leading-relaxed text-cs-text-secondary">{children}</div>
    </details>
  );
}

/**
 * A token field with the notes that belong to it — the saved-to-account strip and the last-request
 * line. The card's hairlines are drawn between token fields, never between a field and its own
 * notes, which otherwise land on the note text and read as a strike-through.
 */
export function TokenField({ children }: { children: React.ReactNode }) {
  return <div className="settings-token-field">{children}</div>;
}
