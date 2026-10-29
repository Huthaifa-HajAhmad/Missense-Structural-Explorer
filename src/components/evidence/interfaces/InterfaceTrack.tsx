import React, { useEffect, useRef, useState } from "react";
import type { InterfacesEvidence, TrackLane } from "../../../shared/interfacesEvidence";
import { assignLanes } from "../../../shared/residueContextEvidence";

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
 * width. Otherwise it is a callout under the lane, and `assignLanes` gives each callout a row so none
 * overprints the next. NAE1: the Site at 211 and the Region at 331–344 were hollow boxes with no label, and
 * the old rule (name only the ranges that were 6% of the protein's length) guessed the fit from the
 * protein, not the lane. A lane's end reads exact containment: In domain / At site / Outside.
 *
 * HTML with percentage positions rather than SVG, so labels stay crisp at any column width.
 */

function niceTicks(length: number, step: number): number[] {
  const out: number[] = [];
  for (let v = step; v < length - step * 0.4; v += step) out.push(v);
  return out;
}

const TICK_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 5000];

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

/**
 * The axis ticks, given the sequence length and the variant position (or null).
 *
 * The ruler's label is an opaque chip sitting on the axis row from the ruler line rightwards, so a
 * tick under it is invisible ink, not a tick (RGS9 Cys182 covered "200"). Ticks it would cover are
 * not drawn; and if that leaves fewer than two readable ticks the axis re-reads at the next smaller
 * step, so a long protein's axis never reads emptier than the ruler that crosses it.
 */
export function trackTicks(length: number, position: number | null): number[] {
  const pct = (v: number) => ((v - 1) / Math.max(1, length - 1)) * 100;
  const variantPct = position ? pct(position) : null;
  const clearOfLabel = (ts: number[]) =>
    ts.filter(t => {
      if (variantPct === null) return true;
      const p = pct(t);
      return p < variantPct - 0.6 || p > variantPct + 6;
    });
  const i = TICK_STEPS.findIndex(s => length / s <= 6);
  const step = i === -1 ? 10000 : TICK_STEPS[i];
  const first = clearOfLabel(niceTicks(length, step));
  if (variantPct !== null && first.length < 2 && i > 0) return clearOfLabel(niceTicks(length, TICK_STEPS[i - 1]));
  return first;
}

/** Padding either side of an inline name: `.ifc-track__range-name` pads 5px a side. */
const INLINE_NAME_PAD_PX = 10;
/** A callout's own padding and rule: `.ifc-track__callout` pads 5px and draws a 1.5px rule. */
const CALLOUT_PAD_PX = 7;
/** One callout row under a lane: the callout's line height. */
const CALLOUT_ROW_PX = 15;

const measuredWidths = new Map<string, number>();
/** Bound on the memo: names repeat across lanes and genes, and an unbounded map would grow for a session. */
const MEASURED_WIDTHS_MAX = 500;
/** Pixel width of `text` in `font`. Memoised: a resize re-measures every name, and names repeat across lanes. */
function measureText(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  const known = measuredWidths.get(key);
  if (known !== undefined) return known;
  const ctx = document.createElement("canvas").getContext("2d");
  // A browser always has a 2D context; the character estimate only keeps a context-less environment deterministic.
  let width = text.length * 6;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  }
  if (measuredWidths.size >= MEASURED_WIDTHS_MAX) measuredWidths.clear();
  measuredWidths.set(key, width);
  return width;
}

export interface NamedRange {
  start: number;
  end: number;
  /** The name drawn inside the range, when it fits. */
  name: string;
  /** The name drawn as a callout under the lane: its residue span and name. */
  calloutText: string;
}

export type RangeNamePlan = { inline: true } | { inline: false; left: number; row: number };

/**
 * Where each name goes, given the lane's pixel width and a text measure. A name stays inline only when it
 * fits its range with padding. Each callout is anchored at its range's start, pulled left when it would run
 * past the lane's end, and given a row by `assignLanes` with the widest callout as the spacing, so no two
 * callouts in a row overprint. With no width (no layout, a hidden tab, jsdom) nothing can be measured, so
 * no plan is returned: the caller draws the ranges unnamed. Rendering every name as a callout on row 0
 * would overprint them all for the first frame and jump the lane's height.
 */
export function planRangeNames(
  ranges: readonly NamedRange[],
  { pct, width, measure }: { pct: (v: number) => number; width: number; measure: (text: string) => number }
): RangeNamePlan[] {
  if (width <= 0) return [];
  const plans: RangeNamePlan[] = [];
  const callouts: Array<{ index: number; left: number; span: number }> = [];
  ranges.forEach((r, index) => {
    const rangePx = ((pct(r.end + 1) - pct(r.start)) / 100) * width;
    if (measure(r.name) + INLINE_NAME_PAD_PX <= rangePx) {
      plans[index] = { inline: true };
      return;
    }
    // A name wider than the lane cannot be placed: clamp its span so the anchor stays inside the lane and
    // let CSS ellipsise it, instead of pushing it past both edges.
    const span = Math.min(100, ((measure(r.calloutText) + CALLOUT_PAD_PX) / width) * 100);
    callouts.push({ index, left: Math.max(0, Math.min(pct(r.start), 100 - span)), span });
  });
  const byLeft = [...callouts].sort((a, b) => a.left - b.left);
  const rows = assignLanes(byLeft.map(c => c.left), Math.max(0, ...byLeft.map(c => c.span)));
  byLeft.forEach((c, k) => {
    plans[c.index] = { inline: false, left: c.left, row: rows[k] };
  });
  return plans;
}

/**
 * The lane's pixel width and label font, read after layout and again on every resize, so a name that stops
 * fitting becomes a callout rather than overprinting. The font is the lane's own computed font, which is
 * what the names inherit; no layout (jsdom has no ResizeObserver) reads a width of 0.
 */
function useLaneMetrics() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [font, setFont] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Re-read on every resize: a font-size change (settings, zoom) invalidates every measure, and the font
    // captured once at mount would keep culling names at the old width.
    const readFont = () => {
      const style = getComputedStyle(el);
      const next = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      setFont(prev => (prev === next ? prev : next));
    };
    readFont();
    setWidth(el.getBoundingClientRect().width);
    window.addEventListener("resize", readFont);
    if (typeof ResizeObserver === "undefined") return () => window.removeEventListener("resize", readFont);
    const observer = new ResizeObserver(entries => { setWidth(entries[0].contentRect.width); readFont(); });
    observer.observe(el);
    return () => { window.removeEventListener("resize", readFont); observer.disconnect(); };
  }, []);
  return { ref, width, font };
}

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

function Lane({ lane, pct, lit, onLit, onOpen, inspectAllLanes, variantKnown }: { lane: TrackLane; pct: (v: number) => number; variantKnown: boolean } & LinkProps) {
  const readingKey = lane.rowKey ?? `track:${lane.key}`;
  const linked = Boolean(onOpen && (lane.rowKey || inspectAllLanes));
  const labelled = lane.kind === "domains" || lane.kind === "sites";
  const metrics = useLaneMetrics();
  const named: NamedRange[] = labelled
    ? lane.ranges.map(r => ({ start: r.start, end: r.end, name: r.name, calloutText: lane.kind === "sites" ? r.name : `${rangeText(r)} · ${r.name}` }))
    : [];
  const plans = labelled ? planRangeNames(named, { pct, width: metrics.width, measure: text => measureText(text, metrics.font) }) : [];
  const callouts = plans.flatMap((plan, index) => (plan.inline ? [] : [{ ...plan, index }]));
  const rows = callouts.length ? Math.max(...callouts.map(c => c.row)) + 1 : 0;
  // Exact containment, read at the lane's end. Without a known variant position no range can contain it.
  const inside = labelled && lane.ranges.some(r => r.hit);
  const readout = !variantKnown ? "" : lane.kind === "domains" ? (inside ? "In domain" : "Outside") : lane.kind === "sites" ? (inside ? "At site" : "Outside") : lane.readout ? `${lane.readout.k}/${lane.readout.n}` : "";
  return (
    <div
      className="ifc-track__row"
      data-reading-key={readingKey}
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
        <div className="ifc-track__lane" ref={metrics.ref} data-kind={lane.kind} role="img" aria-label={lane.summary}>
          {lane.ranges.map((r, i) => {
            const plan = plans[i];
            return (
              <span
                key={`${r.kind}${r.start}-${r.end}`}
                className="ifc-track__range"
                data-kind={r.kind}
                data-hit={r.hit || undefined}
                style={{ left: `${pct(r.start)}%`, width: `max(${r.kind === "site" ? 4 : 2}px, ${pct(r.end + 1) - pct(r.start)}%)` }}
                title={`${r.name} · ${rangeText(r)}`}
              >
                {plan?.inline && <span className="ifc-track__range-name">{r.name}</span>}
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
      <span className="ifc-track__readout" data-hit={(inside || (lane.readout && lane.readout.k > 0)) || undefined}>
        {readout}
      </span>
    </div>
  );
}

export function InterfaceTrack({ ev, bounds, lit, onLit, onOpen, inspectAllLanes }: { ev: InterfacesEvidence; bounds?: { start: number; end: number } } & LinkProps) {
  const maxSeen = Math.max(
    ev.position ?? 0,
    10,
    ...ev.track.flatMap(l => [...l.ranges.map(r => r.end), ...l.marks.map(m => m.residue)])
  );
  const length = bounds?.end ?? Math.max(ev.sequenceLength ?? 0, maxSeen);
  const start = bounds?.start ?? 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - start) / Math.max(1, length - start)) * 100));
  const variantPct = ev.position ? pct(ev.position) : null;
  const ticks = trackTicks(length - start + 1, ev.position === null ? null : ev.position - start + 1).map(t => t + start - 1);
  const solvedHidden = ev.observed.partners.length - ev.track.filter(l => l.kind === "solved" && !l.key.endsWith(":fibril")).length;

  return (
    <div className="ifc-track" data-testid="interface-track">
      <div className="ifc-track__row ifc-track__row--axis" aria-hidden="true">
        <div className="ifc-track__label" />
        <div className="ifc-track__axis">
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
          ev.track.map(l => <Lane key={l.key} lane={l} pct={pct} lit={lit} onLit={onLit} onOpen={onOpen} inspectAllLanes={inspectAllLanes} variantKnown={ev.position !== null} />)
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
