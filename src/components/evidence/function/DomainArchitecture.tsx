import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FunctionEvidence } from "../../../shared/functionEvidence";
import { layoutArchitecture, layoutOverview, type ArchLabel, type ArchWindow, type LayerKey } from "./architectureLayout";

/**
 * DomainArchitecture — the protein drawn once, N to C, with everything the table lists placed on it.
 *
 *   above the backbone   disease variants (UniProt natural variants "in <disease>") as lollipops, or as a
 *                        per-residue bar track once there are too many to name (see `architectureLayout.ts`);
 *                        this variant in clay, highest, its stem running down to the secondary-structure strip
 *   on the backbone      domain boxes (InterPro member-database matches, else UniProt Domain features),
 *                        functional regions as insets
 *   under the backbone   conserved-site ticks, Gene3D structural segments, the PDB helix / strand strip
 *                        (zoomed windows only), then point sites, mutagenesis and modifications: on stems
 *                        when there are few, in one lane per kind when there are many
 *   at the foot          membrane topology: outside and inside rails with the transmembrane segments
 *                        as bars between them, the variant's tick running through
 *   below, when zoomed   a whole-protein strip with the current window bracketed
 *
 * Geometry is `layoutArchitecture`'s; this file only paints it, and carries the pointer and keyboard
 * interaction: hover lights the same row in the table (and the reverse), a drag on the axis or the overview
 * zooms to that range, and ←/→ step through the marks. The SVG is drawn at its container's pixel width (never
 * scaled), so an 11px label is 11px on a phone as on a desktop.
 *
 * The drawing is an image with a text alternative. Every mark is also a row in the annotation table, which is
 * the full keyboard path; the arrow keys here are a shortcut to the same selection, announced in a live region.
 */

const DEFAULT_WIDTH = 720;
/** Narrowest window a drag may select, so a stray click does not zoom to nothing. */
const MIN_BRUSH = 10;

function Label({ l, className }: { l: ArchLabel; className?: string }) {
  return (
    <text
      x={l.x}
      y={l.y}
      textAnchor={l.anchor}
      fontSize={l.size}
      fontWeight={l.weight}
      className={`fnd-arch__text${l.mono ? " fnd-arch__text--mono" : ""}${className ? ` ${className}` : ""}`}
      data-tone={l.tone}
    >
      {l.text}
    </text>
  );
}

function describe(ev: FunctionEvidence, hidden?: ReadonlySet<LayerKey>): string {
  const parts: string[] = [`Domain architecture of ${ev.gene || "the protein"}, ${ev.length} residues.`];
  if (ev.domains.length) {
    parts.push(ev.domains.map((d) => `${d.name} (${d.source}) ${d.segments.map((s) => `${s.start} to ${s.end}`).join(" and ")}`).join(". ") + ".");
  } else parts.push("No domain annotated.");
  const regions = ev.rows.filter((r) => r.lane === "region");
  if (regions.length) parts.push(regions.map((r) => `${r.name} ${r.start} to ${r.end}`).join(". ") + ".");
  const disease = hidden?.has("variants") ? [] : ev.rows.filter((r) => r.disease);
  if (disease.length > 12) {
    parts.push(`${disease.length} disease variants at ${ev.density.residues} residues${ev.density.densest ? `, densest at ${ev.density.densest.start} to ${ev.density.densest.end}` : ""}.`);
  } else if (disease.length) parts.push(`Disease variants at ${disease.map((r) => r.start).join(", ")}.`);
  const tm = ev.rows.filter((r) => r.lane === "membrane" && r.type.toLowerCase() === "transmembrane");
  if (tm.length) parts.push(`${tm.length} transmembrane segments.`);
  parts.push(`This variant, ${ev.variantShort}, at ${ev.residue}.`);
  return parts.join(" ");
}

/** The residue under a pointer, from a drawing whose x0..x1 spans [first, last]. */
function residueAt(clientX: number, svg: SVGSVGElement, x0: number, x1: number, first: number, last: number): number {
  const box = svg.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (clientX - box.left - x0) / Math.max(1, x1 - x0)));
  return Math.round(first + f * (last - first));
}

interface Brush {
  from: number;
  to: number;
  /** Which drawing the drag started on; only that one paints the rubber band. */
  src: "axis" | "overview";
}

export function DomainArchitecture({
  ev,
  win,
  selectedKey,
  hoverKey = null,
  hidden,
  onSelect,
  onStep,
  onHover,
  onWindow,
}: {
  ev: FunctionEvidence;
  win: ArchWindow;
  selectedKey: string | null;
  /** The table row the pointer is over; its marks light up here. */
  hoverKey?: string | null;
  hidden?: ReadonlySet<LayerKey>;
  /** A click: toggles the row. */
  onSelect: (key: string) => void;
  /** An arrow key: selects the row, never toggles it off. */
  onStep?: (key: string) => void;
  onHover?: (key: string | null) => void;
  /** A drag on the axis or the overview: zoom to this range. */
  onWindow?: (w: ArchWindow) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [brush, setBrush] = useState<Brush | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyed on the window's ends, not the object: the parent builds a new `win` object on every render.
  const L = useMemo(
    () => layoutArchitecture(ev, width, { start: win.start, end: win.end }, selectedKey, { hidden }),
    [ev, width, win.start, win.end, selectedKey, hidden]
  );
  const bbTop = L.backbone.y - L.backbone.h / 2;
  const lit = (rowKey: string) => (hoverKey !== null && rowKey === hoverKey) || undefined;
  const hoverProps = (rowKey: string) => ({
    onMouseEnter: () => onHover?.(rowKey),
    onMouseLeave: () => onHover?.(null),
  });

  // Marks in reading order, one per table row, for ←/→.
  const marks = useMemo(() => {
    const out: Array<{ rowKey: string; at: number; title: string }> = [];
    const add = (rowKey: string, at: number, title: string) => {
      if (!out.some((m) => m.rowKey === rowKey)) out.push({ rowKey, at, title });
    };
    for (const p of L.pins) add(p.rowKey, p.residue, p.title);
    for (const d of L.domains) add(d.rowKey, d.start, d.title);
    for (const m of L.motifs) add(m.rowKey, m.start, m.title);
    for (const b of L.density?.bars ?? []) add(b.rowKey, b.start, b.title);
    for (const r of L.regions) {
      const row = ev.rows.find((q) => q.key === r.key);
      if (row) add(row.rowKey, row.start, `${row.name}, ${row.residuesText}`);
    }
    for (const b of L.membrane?.bars ?? []) {
      const row = ev.rows.find((q) => q.key === b.rowKey);
      if (row) add(row.rowKey, row.start, `${row.name}, ${row.residuesText}`);
    }
    return out.sort((a, b) => a.at - b.at);
  }, [L, ev.rows]);
  const current = marks.findIndex((m) => m.rowKey === selectedKey);
  const announce = current >= 0 ? marks[current].title : "";

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onStep || marks.length === 0) return;
    const go = (i: number) => {
      const target = marks[Math.min(marks.length - 1, Math.max(0, i))];
      onStep(target.rowKey);
      onHover?.(target.rowKey);
    };
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(current < 0 ? 0 : current + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(current < 0 ? marks.length - 1 : current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(marks.length - 1);
    } else if (e.key === "Escape" && selectedKey) {
      onSelect(selectedKey);
    }
  };

  // Drag to zoom: the axis in the main drawing (current window), the overview (whole protein).
  const beginBrush = (e: React.PointerEvent<SVGElement>, svg: SVGSVGElement | null, x0: number, x1: number, first: number, last: number, src: Brush["src"]) => {
    if (!onWindow || !svg || e.button > 0 || e.pointerType === 'touch') return;
    const at = residueAt(e.clientX, svg, x0, x1, first, last);
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; the drag still reads from the move events.
    }
    setBrush({ from: at, to: at, src });
  };
  const moveBrush = (e: React.PointerEvent<SVGElement>, svg: SVGSVGElement | null, x0: number, x1: number, first: number, last: number) => {
    if (!brush || !svg) return;
    setBrush({ ...brush, to: residueAt(e.clientX, svg, x0, x1, first, last) });
  };
  const endBrush = (first: number, last: number, recenter: boolean) => {
    if (!brush || !onWindow) return setBrush(null);
    const a = Math.min(brush.from, brush.to);
    const b = Math.max(brush.from, brush.to);
    setBrush(null);
    if (b - a >= MIN_BRUSH) onWindow({ start: Math.max(first, a), end: Math.min(last, b) });
    else if (recenter) {
      // A click on the overview moves the window, keeping its width.
      const half = Math.round((win.end - win.start) / 2);
      const start = Math.min(Math.max(first, a - half), Math.max(first, last - (win.end - win.start)));
      onWindow({ start, end: Math.min(last, start + (win.end - win.start)) });
    }
  };

  const brushX = (r: number) => L.x0 + ((Math.min(Math.max(r, win.start), win.end) - win.start) / Math.max(1, win.end - win.start)) * (L.x1 - L.x0);

  return (
    <div
      ref={ref}
      className="fnd-arch"
      data-testid="domain-architecture"
      tabIndex={onStep ? 0 : undefined}
      role={onStep ? "group" : undefined}
      aria-label={onStep ? "Drawing marks. Left and right arrow keys step through them; Source records lists every annotation." : undefined}
      onKeyDown={onKeyDown}
    >
      <svg
        ref={svgRef}
        role="group"
        aria-label={describe(ev, hidden)}
        width={L.width}
        height={L.height}
        viewBox={`0 0 ${L.width} ${L.height}`}
        className="fnd-arch__svg"
        data-window={`${win.start}-${win.end}`}
        data-density={L.density ? "bars" : "pins"}
        data-lanes={L.laneMode || undefined}
      >
        {/* Stems first, so heads and labels sit over them. */}
        <g className="fnd-arch__stems" aria-hidden="true">
          {L.pins
            .filter((p) => p.stem)
            .map((p) => (
              <line key={`s-${p.key}`} x1={p.x} x2={p.x} y1={p.stemFrom} y2={p.shape === "dot" ? p.y + 5 : p.y - 5} className="fnd-arch__stem" data-shape={p.shape} />
            ))}
        </g>

        {/* Backbone and domains. */}
        <rect x={L.x0} y={bbTop} width={L.x1 - L.x0} height={L.backbone.h} rx={L.backbone.h / 2} className="fnd-arch__backbone" data-testid="arch-backbone" />
        {L.termini.map((t) => (
          <Label key={t.text} l={t} />
        ))}
        {L.domains.map((d) => (
          <g key={d.key} className="fnd-arch__domain" role="button" tabIndex={0} aria-label={d.title} aria-pressed={d.selected}
            data-selected={d.selected || undefined} data-lit={lit(d.rowKey)} onClick={() => onSelect(d.rowKey)} {...hoverProps(d.rowKey)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(d.rowKey); } }}
            data-covers={d.covers || undefined} data-start={d.start} data-end={d.end} data-lane={d.lane} data-row-key={d.rowKey} data-testid="arch-domain">
            <title>{d.title}</title>
            <rect x={d.x} y={d.y} width={d.width} height={30} rx={6} />
            {d.width < 24 && <rect x={d.x - (24 - d.width) / 2} y={d.y} width={24} height={30} className="fnd-domain-hit" />}
            {d.label && <Label l={d.label} />}
            {d.ends.map((e) => (
              <Label key={e.text + e.anchor} l={e} />
            ))}
          </g>
        ))}
        {L.regions.map((r) => (
          <g key={r.key} className="fnd-arch__region" data-selected={r.selected || undefined} data-lit={lit(r.key)} onClick={() => onSelect(r.key)} {...hoverProps(r.key)} data-testid="arch-region">
            <rect x={r.x} y={r.y} width={r.width} height={r.h} rx={3} />
            {r.label && <Label l={r.label} />}
          </g>
        ))}

        {/* Conserved-site signatures, structural domains and secondary structure. */}
        {L.motifs.map((m) => (
          <g key={m.key} className="fnd-arch__motif" role="button" tabIndex={0} aria-label={m.title} aria-pressed={selectedKey === m.rowKey}
            data-covers={m.covers || undefined} data-selected={selectedKey === m.rowKey || undefined} data-lit={lit(m.rowKey)}
            onClick={() => onSelect(m.rowKey)} {...hoverProps(m.rowKey)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(m.rowKey); } }} data-testid="arch-motif">
            <title>{m.title}</title>
            <rect x={m.x} y={m.y} width={m.width} height={4} rx={2} />
          </g>
        ))}
        {L.structural.map((s) => (
          <rect key={s.key} x={s.x} y={s.y} width={s.width} height={4} rx={2} className="fnd-arch__structural" />
        ))}
        {L.secondary.map((s, i) =>
          s.kind === "helix" ? (
            <rect key={`ss-${i}`} x={s.x} y={s.y} width={s.width} height={7} rx={1} className="fnd-arch__helix" />
          ) : (
            <rect key={`ss-${i}`} x={s.x} y={s.y + 2} width={s.width} height={3} className="fnd-arch__strand" />
          )
        )}

        {/* Disease-variant density: one bar per residue, the variant's own in clay. */}
        {L.density && (
          <g className="fnd-arch__density" data-testid="arch-density" role="presentation">
            <line x1={L.x0} x2={L.x1} y1={L.density.baseline} y2={L.density.baseline} className="fnd-arch__dens-base" />
            {L.density.bars.map((b) => (
              <g
                key={b.key}
                className="fnd-arch__dens"
                data-query={b.query || undefined}
                data-selected={b.selected || undefined}
                data-lit={lit(b.rowKey)}
                data-count={b.count}
                data-start={b.start}
                data-testid="arch-dens-bar"
                onClick={() => onSelect(b.rowKey)}
                {...hoverProps(b.rowKey)}
              >
                <title>{b.title}</title>
                <rect x={b.x} y={L.density!.baseline - b.h} width={b.width} height={b.h} rx={1} />
                {/* Tiled with its neighbours (see the layout): a click lands on the bar under the pointer. */}
                <rect x={b.hit.x0} y={L.density!.baseline - Math.max(b.h, 24)} width={b.hit.x1 - b.hit.x0} height={Math.max(b.h, 24)} className="fnd-arch__hit" />
              </g>
            ))}
            {L.density.label && <Label l={L.density.label} />}
          </g>
        )}

        {/* Membrane topology: rails first, bars over them, the variant's tick last. */}
        {L.membrane && (
          <g className="fnd-arch__membrane" data-testid="arch-membrane">
            {L.membrane.rails.map((r) => (
              <line key={`rail-${r.key}`} data-start={r.start} data-end={r.end} x1={r.x} x2={r.x + r.width} y1={r.y} y2={r.y} className="fnd-arch__rail" data-side={r.side} />
            ))}
            {L.membrane.bars.map((b) => (
              <g key={`bar-${b.key}`} className="fnd-arch__tm" data-kind={b.kind} data-start={b.start} data-end={b.end} data-selected={b.selected || undefined} data-lit={lit(b.rowKey)} onClick={() => onSelect(b.rowKey)} {...hoverProps(b.rowKey)} data-testid="arch-tm">
                <rect x={b.x} y={b.y} width={b.width} height={b.h} rx={2} />
                {b.label && <Label l={b.label} />}
              </g>
            ))}
            {L.membrane.labels.map((l) => (
              <Label key={`rl-${l.text}`} l={l} />
            ))}
            {L.membrane.queryX !== null && (
              <line x1={L.membrane.queryX} x2={L.membrane.queryX} y1={L.membrane.outsideY - 6} y2={L.membrane.insideY + 5} className="fnd-arch__membrane-query" />
            )}
          </g>
        )}

        {/* Disulfide brackets (lane mode). */}
        {L.bonds.map((b) => (
          <g key={b.key} className="fnd-arch__bond" data-selected={b.selected || undefined} data-lit={lit(b.rowKey)} onClick={() => onSelect(b.rowKey)} {...hoverProps(b.rowKey)} data-testid="arch-bond">
            <title>{b.title}</title>
            <path d={`M${b.x1} ${b.y + 4} V${b.y} H${b.x2} V${b.y + 4}`} />
          </g>
        ))}

        {/* Heads and labels. */}
        {L.pins.map((p) => (
          <g
            key={p.key}
            className="fnd-arch__pin"
            data-tone={p.tone}
            data-shape={p.shape}
            data-selected={p.selected || undefined}
            data-lit={lit(p.rowKey)}
            data-residue={p.residue}
            data-lane={!p.stem || undefined}
            data-testid="arch-pin"
            onClick={() => onSelect(p.rowKey)}
            {...hoverProps(p.rowKey)}
          >
            <title>{p.title}</title>
            {p.shape === "dot" ? (
              <circle cx={p.x} cy={p.y} r={p.selected ? 6 : 5} />
            ) : p.shape === "circle" ? (
              <circle cx={p.x} cy={p.y} r={p.selected ? 4.5 : 3.5} />
            ) : p.shape === "tick" ? (
              <rect x={p.x - 1.25} y={p.y - 5} width={2.5} height={10} rx={1} />
            ) : (
              <rect x={p.x - 4} y={p.y - 4} width={8} height={8} transform={`rotate(45 ${p.x} ${p.y})`} />
            )}
            {/* A wider invisible target so a 10px mark is still a 24px hit area (less where neighbours are closer). */}
            <rect x={p.hit.x0} y={p.y - 12} width={p.hit.x1 - p.hit.x0} height={24} className="fnd-arch__hit" />
            {p.label && <Label l={p.label} />}
          </g>
        ))}

        {L.query && (
          <g className="fnd-arch__query" data-residue={ev.residue} data-testid="arch-query">
            <line x1={L.query.x} x2={L.query.x} y1={L.query.headY} y2={L.query.stemTo} />
            <circle cx={L.query.x} cy={L.query.headY} r={7} />
            <Label l={L.query.label} />
          </g>
        )}

        {/* Axis. A drag along it zooms to the range. */}
        <g className="fnd-arch__axis" aria-hidden="true">
          <line x1={L.x0} x2={L.x1} y1={L.axisY} y2={L.axisY} />
          {L.ticks.map((t, i) => (
            <g key={`${t.label}-${i}`}>
              <line x1={t.x} x2={t.x} y1={L.axisY} y2={L.axisY + 4} />
              <text x={t.x} y={L.axisY + 16} textAnchor={i === 0 ? "start" : i === L.ticks.length - 1 ? "end" : "middle"} className="fnd-arch__text fnd-arch__text--mono" data-tone="muted" fontSize={10.5}>
                {t.label}
              </text>
            </g>
          ))}
        </g>
        {L.hiddenLabels > 0 && (() => {
          const full = `${L.hiddenLabels} unlabelled \u00b7 hover a mark`;
          const short = `${L.hiddenLabels} unlabelled`;
          const room = L.x1 - (L.x0 + 190);
          const text = full.length * 10.5 * 0.58 < room ? full : short.length * 10.5 * 0.58 < room ? short : null;
          return text ? (
            <text x={L.x1} y={L.axisY + 33} textAnchor="end" className="fnd-arch__text" data-tone="muted" fontSize={10.5} data-testid="arch-hidden-labels">
              {text}
            </text>
          ) : null;
        })()}
        {onWindow && (
          <g data-testid="arch-brush">
            {/* The instruction is on the thing it instructs: the axis row. */}
            <text x={L.x0} y={L.axisY + 33} className="fnd-arch__text fnd-arch__hint" data-tone="muted" fontSize={10.5} aria-hidden="true">
              {"\u2194 Drag along the axis to zoom"}
            </text>
            {brush?.src === "axis" && (
              <rect
                x={brushX(Math.min(brush.from, brush.to))}
                y={L.axisY - 14}
                width={Math.max(1, Math.abs(brushX(brush.to) - brushX(brush.from)))}
                height={34}
                className="fnd-arch__brush"
              />
            )}
            <rect
              x={L.x0}
              y={L.axisY - 6}
              width={L.x1 - L.x0}
              height={44}
              className="fnd-arch__brushzone"
              data-testid="arch-axis-brush"
              onPointerDown={(e) => beginBrush(e, svgRef.current, L.x0, L.x1, win.start, win.end, "axis")}
              onPointerMove={(e) => moveBrush(e, svgRef.current, L.x0, L.x1, win.start, win.end)}
              onPointerUp={() => endBrush(win.start, win.end, false)}
              onPointerCancel={() => setBrush(null)}
            />
          </g>
        )}
      </svg>
      {win.start > 1 || win.end < ev.length ? (
        <Overview ev={ev} width={width} win={win} onWindow={onWindow} brush={brush} onBegin={beginBrush} onMove={moveBrush} onEnd={endBrush} />
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

/** The whole protein, thin, with the current window bracketed. Drag it to choose a window; click it to move the window. */
function Overview({
  ev,
  width,
  win,
  onWindow,
  brush,
  onBegin,
  onMove,
  onEnd,
}: {
  ev: FunctionEvidence;
  width: number;
  win: ArchWindow;
  onWindow?: (w: ArchWindow) => void;
  brush: Brush | null;
  onBegin: (e: React.PointerEvent<SVGElement>, svg: SVGSVGElement | null, x0: number, x1: number, first: number, last: number, src: Brush["src"]) => void;
  onMove: (e: React.PointerEvent<SVGElement>, svg: SVGSVGElement | null, x0: number, x1: number, first: number, last: number) => void;
  onEnd: (first: number, last: number, recenter: boolean) => void;
}) {
  const O = layoutOverview(ev, width, win);
  const ref = useRef<SVGSVGElement>(null);
  const x = (r: number) => O.x0 + ((Math.min(Math.max(r, 1), ev.length) - 1) / Math.max(1, ev.length - 1)) * (O.x1 - O.x0);
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={`Overview: the drawing above shows residues ${win.start} to ${win.end} of ${ev.length}.${onWindow ? " Drag to choose a window." : ""}`}
      width={O.width}
      height={O.height}
      viewBox={`0 0 ${O.width} ${O.height}`}
      className="fnd-arch__svg fnd-arch__overview"
      data-testid="arch-overview"
      data-brushable={onWindow ? true : undefined}
      onPointerDown={(e) => onBegin(e, ref.current, O.x0, O.x1, 1, ev.length, "overview")}
      onPointerMove={(e) => onMove(e, ref.current, O.x0, O.x1, 1, ev.length)}
      onPointerUp={() => onEnd(1, ev.length, true)}
    >
      <line x1={O.x0} x2={O.x1} y1={O.trackY} y2={O.trackY} className="fnd-arch__ov-track" />
      {O.domains.map((d, i) => (
        <rect key={`d-${i}`} x={d.x} y={O.trackY - 6} width={d.width} height={12} rx={2} className="fnd-arch__ov-domain" data-covers={d.covers || undefined} />
      ))}
      {O.membrane.map((m, i) => (
        <rect key={`m-${i}`} x={m.x} y={O.trackY - 5} width={m.width} height={10} className="fnd-arch__ov-tm" />
      ))}
      <rect x={O.window.x} y={O.trackY - 11} width={O.window.width} height={22} rx={3} className="fnd-arch__ov-window" data-testid="arch-overview-window" />
      {brush?.src === "overview" && <rect x={x(Math.min(brush.from, brush.to))} y={O.trackY - 11} width={Math.max(1, Math.abs(x(brush.to) - x(brush.from)))} height={22} className="fnd-arch__brush" />}
      {O.queryX !== null && <circle cx={O.queryX} cy={O.trackY} r={3.5} className="fnd-arch__ov-query" />}
      {O.ends.map((l) => (
        <Label key={l.text} l={l} />
      ))}
    </svg>
  );
}
