import React from "react";
import type { MultimerEvidence } from "../../../shared/multimerEvidence";

/**
 * AssemblyDiagram — the stated or modelled assembly as chains around a centre.
 *
 *   chain A      the analysed protein carrying the variant (clay outline), with the variant as a dot:
 *                on the seam it shares with a neighbour when the residue is at an interface, on the
 *                far side when it makes no contact, and off the chain (hollow) when nothing measured it;
 *   copies       further copies of the same protein (neutral fill);
 *   partners     another protein (quiet fill, named);
 *   seams        where neighbouring chains meet. Solid only for a modelled complex; for an assembly
 *                that is stated but not modelled the chains are drawn apart, because no interface was
 *                computed and the picture must not imply one.
 *
 * A schematic of composition, not of geometry: positions are symmetric by construction.
 */

type Pt = { x: number; y: number };

const W = 240;
const H = 184;

function layout(n: number): { centres: Pt[]; r: number } {
  const cx = W / 2;
  const cy = H / 2;
  if (n <= 1) return { centres: [{ x: cx, y: cy }], r: 44 };
  if (n === 2) return { centres: [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }], r: 40 };
  const r = n <= 4 ? 32 : n <= 6 ? 24 : 18;
  // Ring radius so neighbouring chains just touch: chord = 2r → R = r / sin(π/n).
  const R = r / Math.sin(Math.PI / n);
  return {
    r,
    centres: Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 - Math.PI / n + (2 * Math.PI * i) / n;
      return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    }),
  };
}

export function AssemblyDiagram({ ev }: { ev: MultimerEvidence }) {
  const chains = ev.chains;
  const n = chains.length;
  const { centres, r } = layout(n);
  const modelled = ev.model.state === "built";
  const spread = modelled || n === 1 ? 1 : 1.12;
  const cx = W / 2;
  const cy = H / 2;
  const pos = centres.map(c => ({ x: cx + (c.x - cx) * spread, y: cy + (c.y - cy) * spread }));

  const at = ev.interface.verdict === "at-interface";
  const measured = ev.interface.verdict === "at-interface" || ev.interface.verdict === "not-at-interface";
  const a = pos[0];
  const b = pos[1] ?? null;
  let dot: Pt = { x: a.x, y: a.y + r * 0.2 };
  if (b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    dot = at ? { x: a.x + ux * (r - 6), y: a.y + uy * (r - 6) } : { x: a.x - ux * (r - 10), y: a.y - uy * (r - 10) };
  } else if (!measured) {
    dot = { x: a.x + r * 0.55, y: a.y - r * 0.55 };
  }

  const seams: Array<[Pt, Pt]> = [];
  if (modelled && n >= 2) {
    const pairs = n === 2 ? [[0, 1]] : Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
    for (const [i, j] of pairs) seams.push([pos[i], pos[j]]);
  }

  const described = [
    n === 1 ? "One chain" : `${n} chains: ${chains.map(c => `${c.id} ${c.label}${c.carriesVariant ? " with the variant" : ""}`).join(", ")}`,
    modelled ? "modelled" : n > 1 ? "stated, not modelled" : null,
    `${ev.residueLabel} ${ev.interface.verdict === "at-interface" ? "at an interface" : ev.interface.verdict === "not-at-interface" ? "not in contact with another chain" : "interface not measured"}`,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <svg className="mlt-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={described}>
      {seams.map(([p, q], i) => {
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * r * 0.62;
        const ny = (dx / len) * r * 0.62;
        const withA = p === pos[0] || q === pos[0];
        return (
          <line
            key={i}
            className="mlt-diagram__seam"
            data-variant={withA && at ? "" : undefined}
            x1={mx - nx}
            y1={my - ny}
            x2={mx + nx}
            y2={my + ny}
          />
        );
      })}
      {chains.map((c, i) => (
        <g key={c.id + i} className="mlt-diagram__chain" data-role={c.carriesVariant ? "variant" : c.role}>
          <circle cx={pos[i].x} cy={pos[i].y} r={r} />
          <text x={pos[i].x} y={pos[i].y - (r > 28 ? 4 : 1)} textAnchor="middle" className="mlt-diagram__id">{c.id}</text>
          {r > 22 && (
            <text x={pos[i].x} y={pos[i].y + 12} textAnchor="middle" className="mlt-diagram__gene">
              {c.label.length > 9 ? `${c.label.slice(0, 8)}…` : c.label}
            </text>
          )}
        </g>
      ))}
      <g className="mlt-diagram__variant" data-measured={measured || undefined}>
        <circle cx={dot.x} cy={dot.y} r={5.5} />
      </g>
    </svg>
  );
}
