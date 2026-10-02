import React from "react";
import type { InterfacesEvidence, TrackLane } from "../../../shared/interfacesEvidence";

/**
 * InterfaceTrack — one sequence axis, lanes by kind of evidence, the variant ruled across all of them.
 *
 *   Membrane topology   UniProt topological domains and membrane segments, so a reader sees which
 *                        side of the membrane the residue is on (shown only when annotated);
 *   Domains & regions   UniProt Domain/Region features, named (the SLC12A4 "Scissor helix" that the
 *                        SUBUNIT record names as the dimer interface lives here);
 *   Mapped sites        "Interaction with X" regions and sites, outlined; clay when they hold the variant;
 *   one lane per solved partner — each interface residue drawn with INK WEIGHT = its support, the
 *                        share of the pair's structures in which it is at the interface. A contact seen
 *                        in 1 of 8 structures is faint beside one seen in 6 of 8: the old track drew
 *                        both as identical black ticks;
 *   Predicted complex   residues in contact in the Boltz-2 model (clay), when one was built.
 *
 * Lanes with nothing in them are not drawn: an empty "No domains annotated" lane read as a fact about
 * the protein when it was only an absence of one feature type.
 *
 * HTML with percentage positions rather than SVG, so labels stay crisp at any column width.
 */

function niceTicks(length: number): number[] {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 5000];
  const step = steps.find(s => length / s <= 6) ?? 10000;
  const out: number[] = [];
  for (let v = step; v < length - step * 0.4; v += step) out.push(v);
  return out;
}

/** Consecutive residues with the same weight as one element, so a 40-residue interface is not 40 nodes. */
function runs(marks: TrackLane["marks"]): Array<{ start: number; end: number; weight: number; title: string }> {
  const out: Array<{ start: number; end: number; weight: number; title: string }> = [];
  for (const m of [...marks].sort((a, b) => a.residue - b.residue)) {
    const last = out[out.length - 1];
    if (last && m.residue <= last.end + 1 && Math.abs(m.weight - last.weight) < 1e-6) {
      last.end = m.residue;
      last.title = `${last.start}–${m.residue}: ${m.title.split(": ")[1] ?? ""}`;
    } else out.push({ start: m.residue, end: m.residue, weight: m.weight, title: m.title });
  }
  return out;
}

function Lane({ lane, pct }: { lane: TrackLane; pct: (v: number) => number }) {
  return (
    <div className="ifc-track__row" data-kind={lane.kind}>
      <div className="ifc-track__label">
        <span className="ifc-track__name" title={lane.label}>{lane.label}</span>
        <span className="ifc-track__sub">{lane.sub}</span>
      </div>
      <div className="ifc-track__lane" data-kind={lane.kind} role="img" aria-label={lane.summary}>
        {lane.ranges.map(r => (
          <span
            key={`${r.kind}${r.start}-${r.end}`}
            className="ifc-track__range"
            data-kind={r.kind}
            data-hit={r.hit || undefined}
            style={{ left: `${pct(r.start)}%`, width: `max(${r.kind === "site" ? 4 : 2}px, ${pct(r.end + 1) - pct(r.start)}%)` }}
            title={`${r.name} · ${r.start === r.end ? r.start : `${r.start}–${r.end}`}`}
          >
            {/* A name that cannot fit reads as a stray letter; short ranges keep it in the tooltip and summary. */}
            {lane.kind === "domains" && pct(r.end + 1) - pct(r.start) >= 6 && <span className="ifc-track__range-name">{r.name}</span>}
          </span>
        ))}
        {runs(lane.marks).map(m => (
          <span
            key={`m${m.start}`}
            className="ifc-track__mark"
            style={{
              left: `${pct(m.start)}%`,
              width: `max(2px, ${pct(m.end + 1) - pct(m.start)}%)`,
              // Ink weight = support. A floor keeps a one-structure contact visible without promoting it.
              opacity: 0.18 + 0.72 * m.weight,
            }}
            title={m.title}
          />
        ))}
      </div>
    </div>
  );
}

export function InterfaceTrack({ ev }: { ev: InterfacesEvidence }) {
  const maxSeen = Math.max(
    ev.position ?? 0,
    10,
    ...ev.track.flatMap(l => [...l.ranges.map(r => r.end), ...l.marks.map(m => m.residue)])
  );
  const length = Math.max(ev.sequenceLength ?? 0, maxSeen);
  const pct = (v: number) => ((v - 1) / Math.max(1, length - 1)) * 100;
  const variantPct = ev.position ? pct(ev.position) : null;
  const solvedHidden = ev.observed.partners.length - ev.track.filter(l => l.kind === "solved").length;

  return (
    <div className="ifc-track" data-testid="interface-track">
      <div className="ifc-track__row ifc-track__row--axis" aria-hidden="true">
        <div className="ifc-track__label" />
        <div className="ifc-track__axis">
          <span data-edge="start">1</span>
          {niceTicks(length).map(t => (
            <span key={t} style={{ left: `${pct(t)}%` }}>{t}</span>
          ))}
          <span data-edge="end" style={{ left: "100%" }}>{length}</span>
        </div>
      </div>

      <div className="ifc-track__body">
        {variantPct !== null && (
          <div className="ifc-track__variant" style={{ left: `calc(var(--ifc-track-label) + (100% - var(--ifc-track-label)) * ${variantPct / 100})` }}>
            <span className="ifc-track__variant-label">{ev.residueLabel}</span>
          </div>
        )}
        {ev.track.length ? (
          ev.track.map(l => <Lane key={l.key} lane={l} pct={pct} />)
        ) : (
          <div className="ifc-track__row" data-kind="empty">
            <div className="ifc-track__label">
              <span className="ifc-track__name">Interfaces</span>
            </div>
            <div className="ifc-track__lane ifc-track__lane--empty">
              <span className="ifc-track__none">
                {ev.status.assembly === "loading" || ev.status.assembly === "stale" ? "Being read" : "No annotated region, mapped site or interface to place on the sequence"}
              </span>
            </div>
          </div>
        )}
      </div>
      {solvedHidden > 0 && <p className="ifc-track__more">{solvedHidden} more solved partner{solvedHidden === 1 ? "" : "s"} in the partner list below.</p>}
    </div>
  );
}
