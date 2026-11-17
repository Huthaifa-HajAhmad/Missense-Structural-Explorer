import React from "react";
import type { DomainSpan } from "./types";
import { LandscapeSpanTrack } from "./LandscapeSpanTrack";

export function LandscapeDomainTracks({ domains, start, end, width, onPick, gutter }: {
  domains: DomainSpan[];
  start: number;
  end: number;
  width: number;
  onPick: (pos: number) => void;
  gutter?: number;
}) {
  return <>{[false, true].map(disorder => {
    const spans = domains.filter(d => (d.kind === "disordered") === disorder);
    if (!spans.some(d => d.end >= start && d.start <= end)) return null;
    return <div className="ls-overview__track" style={gutter ? { gap: 0 } : undefined} key={String(disorder)}>
      <span className="ls-overview__label" style={gutter ? { inlineSize: gutter, flex: "none" } : undefined}>{disorder ? "Unstructured" : "Domains"}</span>
      <div className="ls-overview__plot" style={{ inlineSize: width }}>
        <LandscapeSpanTrack start={start} end={end} width={width} onPick={onPick} annotationLabels
          spans={spans.map(d => ({ ...d, label: disorder ? `${d.start}\u2013${d.end}` : d.name,
            tone: disorder ? "disordered" : undefined,
            detail: disorder ? `Intrinsically disordered region (${d.start}\u2013${d.end}) \u00b7 UniProt: ${d.name}. A protein region without a single stable folded structure.` : `${d.name} (${d.start}\u2013${d.end}) \u00b7 UniProt` }))} />
      </div>
    </div>;
  })}</>;
}
