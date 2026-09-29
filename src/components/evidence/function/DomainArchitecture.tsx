import React, { useLayoutEffect, useRef, useState } from "react";
import type { FunctionEvidence } from "../../../shared/functionEvidence";
import { layoutArchitecture, type ArchLabel, type ArchWindow } from "./architectureLayout";

/**
 * DomainArchitecture — the protein drawn once, N to C, with everything the table lists placed on it.
 *
 *   above the backbone   disease variants (UniProt natural variants "in <disease>"), and this variant
 *                        in clay, highest, its stem running down to the secondary-structure strip
 *   on the backbone      domain boxes (InterPro member-database matches, else UniProt Domain features),
 *                        functional regions as insets
 *   under the backbone   Gene3D structural segments, the PDB helix / strand strip, then point sites,
 *                        mutagenesis and modifications as diamonds filled by evidence level
 *
 * Geometry is `layoutArchitecture`'s; this file only paints it. The SVG is drawn at its container's
 * pixel width (never scaled), so an 11px label is 11px on a phone as on a desktop.
 *
 * The drawing is an image with a text alternative. Every mark is also a row in the annotation table,
 * which is the keyboard path; clicking a mark selects that row as a pointer shortcut.
 */

const DEFAULT_WIDTH = 720;

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

function describe(ev: FunctionEvidence): string {
  const parts: string[] = [`Domain architecture of ${ev.gene || "the protein"}, ${ev.length} residues.`];
  if (ev.domains.length) {
    parts.push(ev.domains.map((d) => `${d.name} (${d.source}) ${d.segments.map((s) => `${s.start} to ${s.end}`).join(" and ")}`).join(". ") + ".");
  } else parts.push("No domain annotated.");
  const regions = ev.rows.filter((r) => r.lane === "region");
  if (regions.length) parts.push(regions.map((r) => `${r.name} ${r.start} to ${r.end}`).join(". ") + ".");
  const disease = ev.rows.filter((r) => r.disease);
  if (disease.length) parts.push(`Disease variants at ${disease.map((r) => r.start).join(", ")}.`);
  parts.push(`This variant, ${ev.variantShort}, at ${ev.residue}.`);
  return parts.join(" ");
}

export function DomainArchitecture({
  ev,
  win,
  selectedKey,
  onSelect,
}: {
  ev: FunctionEvidence;
  win: ArchWindow;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

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

  const L = layoutArchitecture(ev, width, win, selectedKey);
  const bbTop = L.backbone.y - L.backbone.h / 2;

  return (
    <div ref={ref} className="fnd-arch" data-testid="domain-architecture">
      <svg
        role="img"
        aria-label={describe(ev)}
        width={L.width}
        height={L.height}
        viewBox={`0 0 ${L.width} ${L.height}`}
        className="fnd-arch__svg"
        data-window={`${win.start}-${win.end}`}
      >
        {/* Stems first, so heads and labels sit over them. */}
        <g className="fnd-arch__stems" aria-hidden="true">
          {L.pins.map((p) => (
            <line key={`s-${p.key}`} x1={p.x} x2={p.x} y1={p.stemFrom} y2={p.shape === "dot" ? p.y + 5 : p.y - 5} className="fnd-arch__stem" data-shape={p.shape} />
          ))}
        </g>

        {/* Backbone and domains. */}
        <rect x={L.x0} y={bbTop} width={L.x1 - L.x0} height={L.backbone.h} rx={L.backbone.h / 2} className="fnd-arch__backbone" data-testid="arch-backbone" />
        {L.termini.map((t) => (
          <Label key={t.text} l={t} />
        ))}
        {L.domains.map((d) => (
          <g key={d.key} className="fnd-arch__domain" data-covers={d.covers || undefined} data-start={d.start} data-end={d.end} data-testid="arch-domain">
            <title>{d.title}</title>
            <rect x={d.x} y={L.backbone.y - 15} width={d.width} height={30} rx={7} />
            {d.label && <Label l={d.label} />}
            {d.ends.map((e) => (
              <Label key={e.text + e.anchor} l={e} />
            ))}
          </g>
        ))}
        {L.regions.map((r) => (
          <g key={r.key} className="fnd-arch__region" data-selected={r.selected || undefined} onClick={() => onSelect(r.key)} data-testid="arch-region">
            <rect x={r.x} y={r.y} width={r.width} height={r.h} rx={3} />
            {r.label && <Label l={r.label} />}
          </g>
        ))}

        {/* Structural domains and secondary structure. */}
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

        {/* Heads and labels. */}
        {L.pins.map((p) => (
          <g
            key={p.key}
            className="fnd-arch__pin"
            data-tone={p.tone}
            data-shape={p.shape}
            data-selected={p.selected || undefined}
            data-residue={p.residue}
            data-testid="arch-pin"
            onClick={() => onSelect(p.rowKey)}
          >
            {p.shape === "dot" ? (
              <circle cx={p.x} cy={p.y} r={p.selected ? 6 : 5} />
            ) : (
              <rect x={p.x - 4} y={p.y - 4} width={8} height={8} transform={`rotate(45 ${p.x} ${p.y})`} />
            )}
            {/* A wider invisible target so a 10px mark is still a 24px hit area. */}
            <rect x={p.x - 12} y={p.y - 12} width={24} height={24} className="fnd-arch__hit" />
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

        {/* Axis. */}
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
      </svg>
      {L.hiddenLabels > 0 && (
        <p className="fnd-arch__hidden" data-testid="arch-hidden-labels">
          {L.hiddenLabels} label{L.hiddenLabels === 1 ? "" : "s"} left off where marks sit too close to name. Zoom in, or read them in the table below.
        </p>
      )}
    </div>
  );
}
