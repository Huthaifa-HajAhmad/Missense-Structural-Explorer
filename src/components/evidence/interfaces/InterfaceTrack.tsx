import type { InterfacesEvidence, TrackLane } from "../../../shared/interfacesEvidence";
import { CALLOUT_ROW_PX, measureText, packRows, planRangeNames, runs, trackTicks, useLaneMetrics, type NamedRange } from "./trackLayout";

/** One stacked row of the domains lane: a 16px block inside a 20px row, so stacked blocks keep a 4px gutter. */
const STACK_ROW_PX = 20;
const BLOCK_PX = 16;

export { planRangeNames, trackTicks, type NamedRange, type RangeNamePlan } from "./trackLayout";

/**
 * InterfaceTrack — one sequence axis, lanes by kind of evidence, the variant ruled across all of them.
 *
 *   Membrane topology   UniProt topological domains and membrane segments, so a reader sees which
 *                        side of the membrane the residue is on (shown only when annotated);
 *   Domains & regions   UniProt Domain/Region features, named (the SLC12A4 "Scissor helix" that the
 *                        SUBUNIT record names as the dimer interface lives here);
 *   Mapped sites        "Interaction with X" regions and sites, outlined; clay when they hold the variant;
 *   one lane per solved partner — each interface residue drawn as a BAR whose HEIGHT is its support,
 *                        the share of the pair's structures in which it is at the interface, and the
 *                        variant's own count ("4/15") at the lane's end. Height replaced ink weight:
 *                        opacity is the weakest channel there is, and SOD1's 4-of-157 fibril contact
 *                        read as dark as the dimer core;
 *   amyloid fibril       the same pair in fibril structures, last, so stacking is never read as the
 *                        native interface (SOD1 Ala5: 0 of 142 native, 4 of 15 fibrils);
 *   Predicted complex   residues in contact in the Boltz-2 model (clay), when one was built.
 *
 * Lanes with nothing in them are not drawn: an empty "No domains annotated" lane read as a fact about
 * the protein when it was only an absence of one feature type.
 *
 * Names. A domain or site name is drawn inside its range only when it fits that range's measured pixel
 * width. In the stacked domains lane it is otherwise drawn beside its own block, then clipped inside a
 * block wide enough to hold a few words; only a narrow block gets a callout under the lane, and
 * `assignLanes` gives each callout a row so none overprints the next. NAE1: the Site at 211 and the Region at
 * 331–344 were hollow boxes with no label, and
 * the old rule (name only the ranges that were 6% of the protein's length) guessed the fit from the
 * protein, not the lane. A lane's end reads exact containment: In domain / At site / Outside.
 *
 * HTML with percentage positions rather than SVG, so labels stay crisp at any column width.
 */


interface LinkProps {
  /** The table row key lit by hover on either side. */
  lit?: string | null;
  onLit?: (key: string | null) => void;
  /** Bring the lane's table row into view. */
  onOpen?: (key: string) => void;
  /** Workspace records exist for every lane; legacy tables link only lanes with a row key. */
  inspectAllLanes?: boolean;
}

const rangeText = (r: { start: number; end: number }) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`);

function Lane({ lane, pct, lit, onLit, onOpen, inspectAllLanes, variantKnown, summary }: { lane: TrackLane; pct: (v: number) => number; variantKnown: boolean; summary?: boolean } & LinkProps) {
  const readingKey = lane.rowKey ?? `track:${lane.key}`;
  const linked = !summary && Boolean(onOpen && (lane.rowKey || inspectAllLanes));
  const labelled = lane.kind === "domains" || lane.kind === "sites";
  const metrics = useLaneMetrics();
  const named: NamedRange[] = labelled
    ? lane.ranges.map(r => ({ start: r.start, end: r.end, name: r.name, calloutText: lane.kind === "sites" ? r.name : `${rangeText(r)} · ${r.name}` }))
    : [];
  // Domains and regions overlap (InterPro entries nest), so each takes a stacked row; sites stay on one.
  const stack = lane.kind === "domains" ? packRows(lane.ranges) : null;
  const stackRows = stack ? Math.max(1, ...stack.map(r => r + 1)) : 1;
  const plans = labelled ? planRangeNames(named, { pct, width: metrics.width, measure: text => measureText(text, metrics.font), rows: stack ?? undefined, fitNames: lane.kind === "domains" }) : [];
  const callouts = plans.flatMap((plan, index) => (plan.inline ? [] : [{ ...plan, index }]));
  const rows = callouts.length ? Math.max(...callouts.map(c => c.row)) + 1 : 0;
  // Exact containment, read at the lane's end. Without a known variant position no range can contain it.
  const inside = labelled && lane.ranges.some(r => r.hit);
  // A solved lane with no structure modelling the residue reads "–/5": no count exists, so none is printed.
  const notModelled = Boolean(lane.readout && lane.readout.n === 0 && lane.readout.total > 0);
  // The topology lane reads the side of the membrane the residue is on, from the range that holds it ("Outside" would
  // not say whether the residue is in a segment or on a loop). Unannotated sides ("other") say nothing.
  const topologySide = lane.kind === "topology" ? lane.ranges.find(r => r.hit)?.kind : undefined;
  const topologyText = topologySide === "membrane" ? "Membrane" : topologySide === "cytoplasmic" ? "Cytoplasm" : topologySide === "outside" ? "Outside" : "";
  const readout = !variantKnown ? "" : lane.kind === "topology" ? topologyText : lane.kind === "domains" ? (inside ? "In domain" : "Outside") : lane.kind === "sites" ? (inside ? "At site" : "Outside")
    : lane.readout ? (notModelled ? `–/${lane.readout.total}` : `${lane.readout.k}/${lane.readout.n}`) : "";
  return (
    <div
      className="ifc-track__row"
      data-reading-key={summary ? undefined : readingKey}
      data-kind={lane.kind}
      data-fibril={lane.key.endsWith(":fibril") || undefined}
      data-lit={lit === readingKey || undefined}
      onMouseEnter={lane.rowKey ? () => onLit?.(readingKey) : undefined}
      onMouseLeave={lane.rowKey ? () => onLit?.(null) : undefined}
    >
      <div className="ifc-track__label">
        {linked ? (
          <button type="button" className="ifc-track__name ifc-track__open" title={`${lane.label}: inspect evidence`} aria-pressed={lit === readingKey} onClick={() => onOpen!(readingKey)} onFocus={() => onLit?.(readingKey)} onBlur={() => onLit?.(null)}>
            {lane.label}
          </button>
        ) : (
          <span className="ifc-track__name" title={lane.label}>{lane.label}</span>
        )}
        <span className="ifc-track__sub">{lane.sub}</span>
      </div>
      <div className="ifc-track__plot">
        <div className="ifc-track__lane" ref={metrics.ref} data-kind={lane.kind} role="img" aria-label={lane.summary} style={stack ? { height: stackRows * STACK_ROW_PX } : undefined}>
          {lane.gaps.map(g => (
            <span
              key={`gap${g.start}`}
              className="ifc-track__gap"
              style={{ left: `${pct(g.start)}%`, width: `max(2px, ${pct(g.end + 1) - pct(g.start)}%)` }}
              title={`${rangeText(g)}: no coordinates in any of this pair's structures`}
            />
          ))}
          {lane.ranges.map((r, i) => {
            const plan = plans[i];
            return (
              <span
                key={`${r.kind}${r.start}-${r.end}`}
                className="ifc-track__range"
                data-kind={r.kind}
                data-hit={r.hit || undefined}
                style={{
                  left: `${pct(r.start)}%`,
                  width: `max(${r.kind === "site" ? 4 : 2}px, ${pct(r.end + 1) - pct(r.start)}%)`,
                  ...(stack ? { top: stack[i] * STACK_ROW_PX + (STACK_ROW_PX - BLOCK_PX) / 2, height: BLOCK_PX, bottom: "auto" } : {}),
                }}
                title={`${r.name} · ${rangeText(r)}`}
              >
                {plan?.inline === true && <span className="ifc-track__range-name">{r.name}</span>}
              </span>
            );
          })}
          {/* A name that did not fit its block, on the block's own row: the block and its name read as one thing. */}
          {lane.ranges.map((r, i) => {
            const plan = plans[i];
            if (plan?.inline !== "beside" || !stack) return null;
            return (
              <span
                key={`n${r.kind}${r.start}-${r.end}`}
                className="ifc-track__beside"
                data-hit={r.hit || undefined}
                aria-hidden="true"
                style={{
                  top: stack[i] * STACK_ROW_PX + (STACK_ROW_PX - BLOCK_PX) / 2,
                  ...(plan.side === "right" ? { left: `calc(${pct(r.end + 1)}% + 4px)` } : { right: `calc(${100 - pct(r.start)}% + 4px)` }),
                }}
              >
                {r.name}
              </span>
            );
          })}
          {runs(lane.marks).map(m => (
            <span
              key={`m${m.start}`}
              className="ifc-track__mark"
              style={{
                left: `${pct(m.start)}%`,
                width: `max(2px, ${pct(m.end + 1) - pct(m.start)}%)`,
                // Height = support. A 2px floor keeps a one-structure contact visible without promoting it.
                height: lane.kind === "solved" ? `max(2px, ${m.weight * 100}%)` : undefined,
              }}
              title={m.title}
            />
          ))}
        </div>
        {/* The lane's own ranges carry these names to assistive tech; the callouts are the same words, drawn. */}
        {rows > 0 && (
          <div className="ifc-track__callouts" aria-hidden="true" style={{ height: rows * CALLOUT_ROW_PX }}>
            {callouts.map(c => (
              <span
                key={c.index}
                className="ifc-track__callout"
                data-kind={lane.ranges[c.index].kind}
                data-hit={lane.ranges[c.index].hit || undefined}
                style={{ left: `${c.left}%`, top: c.row * CALLOUT_ROW_PX }}
              >
                {named[c.index].calloutText}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="ifc-track__readout" data-hit={(inside || topologySide === "membrane" || (lane.readout && lane.readout.k > 0)) || undefined} title={notModelled ? `Not modelled in any of ${lane.readout!.total} structures` : undefined}>
        {readout}
      </span>
    </div>
  );
}

/**
 * `summary`: a read-only copy (the finding card's map around the residue). Its lanes carry no buttons and
 * no reading keys, so the atlas's lanes stay the one place a reading is opened and focus is handed to.
 */
export function InterfaceTrack({ ev, bounds, lit, onLit, onOpen, inspectAllLanes, summary }: { ev: InterfacesEvidence; bounds?: { start: number; end: number }; summary?: boolean } & LinkProps) {
  const maxSeen = Math.max(
    ev.position ?? 0,
    10,
    ...ev.track.flatMap(l => [...l.ranges.map(r => r.end), ...l.marks.map(m => m.residue)])
  );
  const length = bounds?.end ?? Math.max(ev.sequenceLength ?? 0, maxSeen);
  const start = bounds?.start ?? 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - start) / Math.max(1, length - start)) * 100));
  const variantPct = ev.position ? pct(ev.position) : null;
  const axis = useLaneMetrics();
  // The ruler's chip, measured in the axis font (the chip is a little larger and bolder: +20%), plus its padding.
  const labelSpanPct = axis.width > 0 ? ((measureText(ev.residueLabel, axis.font) * 1.2 + 12) / axis.width) * 100 : 6;
  const ticks = trackTicks(length, ev.position, labelSpanPct, start);
  const solvedHidden = ev.observed.partners.length - ev.track.filter(l => l.kind === "solved" && !l.key.endsWith(":fibril")).length;

  return (
    <div className="ifc-track" data-testid={summary ? "interface-track-summary" : "interface-track"}>
      <div className="ifc-track__row ifc-track__row--axis" aria-hidden="true">
        <div className="ifc-track__label" />
        <div className="ifc-track__axis" ref={axis.ref}>
          <span data-edge="start">{start}</span>
          {ticks.map(t => (
            <span key={t} style={{ left: `${pct(t)}%` }}>{t}</span>
          ))}
          <span data-edge="end" style={{ left: "100%" }}>{length}</span>
        </div>
        {/* The variant's label rides the axis row's right end (the readout head), the design's
            signature for "this ruler is the variant" — it showed only when a lane had a readout, so a
            not-measured protein (RGS9) lost it and the ruler label alone carried the residue. */}
        <span className="ifc-track__readout ifc-track__readout--head">{ev.position ? ev.residueLabel : ""}</span>
      </div>

      <div className="ifc-track__body">
        {variantPct !== null && (
          <div className="ifc-track__variant" style={{ left: `calc(var(--ifc-track-label) + (100% - var(--ifc-track-label) - var(--ifc-track-readout)) * ${variantPct / 100})` }}>
            <span className="ifc-track__variant-label">{ev.residueLabel}</span>
          </div>
        )}
        {ev.track.length ? (
          ev.track.map(l => <Lane key={l.key} lane={l} pct={pct} lit={lit} onLit={summary ? undefined : onLit} onOpen={onOpen} inspectAllLanes={inspectAllLanes} variantKnown={ev.position !== null} summary={summary} />)
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
      {solvedHidden > 0 && <p className="ifc-track__more">{solvedHidden} more solved partner{solvedHidden === 1 ? "" : "s"} available in Assemblies & models.</p>}
    </div>
  );
}
