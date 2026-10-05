import React from "react";
import type { InterfacesEvidence } from "../../../shared/interfacesEvidence";

/**
 * AssemblyDiagram — the stated or modelled assembly as chains around a centre, with the variant placed.
 *
 *   chain A    the analysed protein carrying the variant (clay outline);
 *   copies     further copies of the same protein (neutral fill); partners another protein (quiet fill);
 *   seams      where neighbouring chains meet: drawn only when an interface was OBSERVED or MODELLED.
 *              For an assembly that is only stated, the chains are drawn apart.
 *   the dot    on the seam when the residue is at an interface, solid when every structure (or the
 *              model) shows it, HALF-filled when only some solved structures do; on the far side when
 *              it makes no contact; off the chain, hollow, when nothing measured it.
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
  const R = r / Math.sin(Math.PI / n);
  return {
    r,
    centres: Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 - Math.PI / n + (2 * Math.PI * i) / n;
      return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    }),
  };
}

export function AssemblyDiagram({ ev }: { ev: InterfacesEvidence }) {
  const chains = ev.chains;
  const n = chains.length;
  const { centres, r } = layout(n);
  const observedSeam = ev.observed.partners.some(p => p.homomeric) && ev.assembly.kind === "homomer";
  const joined = ev.model.state === "built" || observedSeam || (ev.assembly.kind === "heteromer" && ev.observed.partners.some(p => !p.homomeric));
  const spread = joined || n === 1 ? 1 : 1.12;
  const cx = W / 2;
  const cy = H / 2;
  const pos = centres.map(c => ({ x: cx + (c.x - cx) * spread, y: cy + (c.y - cy) * spread }));

  const at = ev.interface.verdict === "at-interface";
  const measured = at || ev.interface.verdict === "not-at-interface";
  const partial = Boolean(ev.interface.observed && ev.interface.observed.k < ev.interface.observed.n);
  const a = pos[0];
  const b = pos[1] ?? null;
  let dot: Pt = { x: a.x, y: a.y + r * 0.2 };
  if (b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dot = at ? { x: a.x + (dx / len) * (r - 6), y: a.y + (dy / len) * (r - 6) } : { x: a.x - (dx / len) * (r - 10), y: a.y - (dy / len) * (r - 10) };
  } else if (!measured) {
    dot = { x: a.x + r * 0.55, y: a.y - r * 0.55 };
  }

  const seams: Array<[Pt, Pt]> = [];
  if (joined && n >= 2) {
    const pairs = n === 2 ? [[0, 1]] : Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
    for (const [i, j] of pairs) seams.push([pos[i], pos[j]]);
  }

  const described = [
    n === 1 ? "One chain" : `${n} chains: ${chains.map(c => `${c.id} ${c.label}${c.carriesVariant ? " with the variant" : ""}`).join(", ")}`,
    ev.model.state === "built" ? "modelled" : joined ? "interface seen in solved structures" : n > 1 ? "stated, not modelled" : null,
    `${ev.residueLabel} ${at ? `at an interface${ev.interface.observed ? ` in ${ev.interface.support}` : ""}` : ev.interface.verdict === "not-at-interface" ? `not at a native interface${ev.interface.fibril ? " (a fibril contact is read apart)" : ""}` : "interface not measured"}`,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <svg className="ifc-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={described}>
      <defs>
        <clipPath id="ifc-dot-half">
          <rect x={dot.x - 6} y={dot.y - 6} width={6} height={12} />
        </clipPath>
      </defs>
      {seams.map(([p, q], i) => {
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * r * 0.62;
        const ny = (dx / len) * r * 0.62;
        const withA = p === pos[0] || q === pos[0];
        return <line key={i} className="ifc-diagram__seam" data-variant={withA && at ? "" : undefined} x1={mx - nx} y1={my - ny} x2={mx + nx} y2={my + ny} />;
      })}
      {chains.map((c, i) => (
        <g key={c.id + i} className="ifc-diagram__chain" data-role={c.carriesVariant ? "variant" : c.role}>
          <circle cx={pos[i].x} cy={pos[i].y} r={r} />
          <text x={pos[i].x} y={pos[i].y - (r > 28 ? 4 : 1)} textAnchor="middle" className="ifc-diagram__id">{c.id}</text>
          {r > 22 && (
            <text x={pos[i].x} y={pos[i].y + 12} textAnchor="middle" className="ifc-diagram__gene">
              {c.label.length > 9 ? `${c.label.slice(0, 8)}…` : c.label}
            </text>
          )}
        </g>
      ))}
      <g className="ifc-diagram__variant" data-measured={(measured && !partial) || undefined} data-partial={partial || undefined}>
        <circle cx={dot.x} cy={dot.y} r={5.5} />
        {partial && <circle cx={dot.x} cy={dot.y} r={5.5} clipPath="url(#ifc-dot-half)" className="ifc-diagram__half" />}
      </g>
    </svg>
  );
}
