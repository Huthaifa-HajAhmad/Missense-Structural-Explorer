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
      <span className="ls-overview__label" style={gutter ? { inlineSize: gutter, flex: "none" } : undefined}>{disorder ? "Disorder" : "Domains"}</span>
      <div className="ls-overview__plot" style={{ inlineSize: width }}>
        <LandscapeSpanTrack start={start} end={end} width={width} onPick={onPick}
          spans={spans.map(d => ({ ...d, label: d.name,
            tone: disorder ? "disordered" : undefined,
            detail: `${d.name} (${d.start}–${d.end}) · UniProt${disorder ? " · annotated disorder; not a domain" : ""}` }))} />
      </div>
    </div>;
  })}</>;
}
