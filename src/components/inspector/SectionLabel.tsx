import React from "react";

/**
 * Section heading for an inspector pane.
 *
 * There were three byte-identical local copies of this in SplicingInspector,
 * ResidueShiftInspector and (newly) PerturbationInspector. The panes all share one
 * visual language, so the heading belongs in one place: a change to its casing,
 * tracking or icon size should not have to be made three times, and a fourth
 * inspector should not be an invitation to paste a fourth copy.
 *
 * Rendered as a real `h3` so the sidebar participates in screen-reader heading
 * navigation — the reason it was an `h3` in the original copies.
 */
export function SectionLabel({
  Icon,
  children
}: {
  Icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5 m-0">
      <Icon className="w-3.5 h-3.5 text-cs-accent-clay" />
      {children}
    </h3>
  );
}

export default SectionLabel;
