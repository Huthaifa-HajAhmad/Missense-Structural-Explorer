import React from "react";
import type { SideChainDiff, SideChainGlyph, GlyphStatus } from "../../../shared/sideChainTopology";
import { BACKBONE_ANCHORS } from "../../../shared/sideChainTopology";

interface ResidueGlyphProps {
  diff: SideChainDiff | null;
  wildType: string;
  mutant: string;
  wildTypeName?: string | null;
  mutantName?: string | null;
}

function atomColor(status: GlyphStatus): string {
  switch (status) {
    case "gained":
      return "var(--cs-accent-clay)";
    case "lost":
      return "var(--cs-text-secondary)";
    case "kept":
    default:
      return "var(--cs-text-secondary)";
  }
}

function bondStroke(status: GlyphStatus): string {
  switch (status) {
    case "gained":
      return "var(--cs-accent-clay)";
    case "lost":
      return "var(--cs-text-muted)";
    case "kept":
    default:
      return "var(--cs-text-muted)";
  }
}

function SingleGlyphSvg({
  glyph,
  bounds,
  label,
}: {
  glyph: SideChainGlyph;
  bounds: SideChainDiff["bounds"];
  label: string;
}) {
  const pad = 0.8;
  const vbMinX = bounds.minX - pad;
  const vbMinY = -(bounds.maxY + pad);
  const vbWidth = bounds.maxX - bounds.minX + 2 * pad;
  const vbHeight = bounds.maxY - bounds.minY + 2 * pad;

  // Build coordinate lookup: N and CA plus all atoms in glyph
  const coordMap = new Map<string, { x: number; y: number }>();
  coordMap.set("N", BACKBONE_ANCHORS.N);
  coordMap.set("CA", BACKBONE_ANCHORS.CA);
  for (const a of glyph.atoms) {
    coordMap.set(a.name, { x: a.x, y: a.y });
  }

  return (
    <svg
      viewBox={`${vbMinX} ${vbMinY} ${vbWidth} ${vbHeight}`}
      className="rsx-glyph-svg"
      role="img"
      aria-label={label}
    >
      {/* Backbone bond N - CA */}
      <line
        x1={BACKBONE_ANCHORS.N.x}
        y1={-BACKBONE_ANCHORS.N.y}
        x2={BACKBONE_ANCHORS.CA.x}
        y2={-BACKBONE_ANCHORS.CA.y}
        stroke="var(--cs-text-muted)"
        strokeWidth="0.12"
        strokeLinecap="round"
      />

      {/* Side-chain bonds */}
      {glyph.bonds.map((bond, i) => {
        const p1 = coordMap.get(bond.a);
        const p2 = coordMap.get(bond.b);
        if (!p1 || !p2) return null;
        return (
          <line
            key={`${bond.a}-${bond.b}-${i}`}
            x1={p1.x}
            y1={-p1.y}
            x2={p2.x}
            y2={-p2.y}
            stroke={bondStroke(bond.status)}
            strokeWidth={bond.status === "gained" ? "0.14" : "0.12"}
            strokeLinecap="round"
            strokeDasharray={bond.status === "lost" ? "0.18 0.12" : undefined}
          />
        );
      })}

      {/* Backbone nodes */}
      <circle
        cx={BACKBONE_ANCHORS.N.x}
        cy={-BACKBONE_ANCHORS.N.y}
        r="0.12"
        fill="var(--cs-surface)"
        stroke="var(--cs-text-muted)"
        strokeWidth="0.06"
      />
      <text
        x={BACKBONE_ANCHORS.N.x - 0.22}
        y={-BACKBONE_ANCHORS.N.y + 0.08}
        fontSize="0.28"
        fontFamily="var(--cs-font-mono)"
        fill="var(--cs-text-muted)"
        textAnchor="end"
      >
        N
      </text>

      <circle
        cx={BACKBONE_ANCHORS.CA.x}
        cy={-BACKBONE_ANCHORS.CA.y}
        r="0.14"
        fill="var(--cs-surface)"
        stroke="var(--cs-text-primary)"
        strokeWidth="0.08"
      />
      <text
        x={BACKBONE_ANCHORS.CA.x + 0.22}
        y={-BACKBONE_ANCHORS.CA.y + 0.08}
        fontSize="0.28"
        fontFamily="var(--cs-font-mono)"
        fill="var(--cs-text-primary)"
        textAnchor="start"
      >
        Cα
      </text>

      {/* Side chain atoms */}
      {glyph.atoms.map(atom => {
        const isGained = atom.status === "gained";
        const isLost = atom.status === "lost";
        return (
          <g key={atom.name}>
            <circle
              cx={atom.x}
              cy={-atom.y}
              r={isGained ? "0.18" : "0.15"}
              fill={isLost ? "var(--cs-surface)" : atomColor(atom.status)}
              stroke={atomColor(atom.status)}
              strokeWidth={isLost ? "0.08" : "0.04"}
              opacity={1}
            />
            <text
              x={atom.x}
              y={-atom.y - 0.24}
              fontSize="0.26"
              fontFamily="var(--cs-font-mono)"
              fontWeight={isGained ? "600" : "400"}
              fill="var(--cs-text-primary)"
              textAnchor="middle"
            >
              {atom.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ResidueGlyph({
  diff,
  wildType,
  mutant,
  wildTypeName,
  mutantName,
}: ResidueGlyphProps) {
  if (!diff) return null;

  return (
    <div className="rsx-glyph-panel" data-testid="residue-glyph-pair">
      <div className="rsx-glyph-pair">
        <div className="rsx-glyph-card" data-state="wild-type">
          <div className="rsx-glyph-caption">
            <span className="rsx-glyph-code">{wildType}</span>
            <span className="rsx-glyph-role">Wild type</span>
            {wildTypeName && <span className="rsx-glyph-name">{wildTypeName}</span>}
          </div>
          <div className="rsx-glyph-frame">
            <SingleGlyphSvg
              glyph={diff.wildType}
              bounds={diff.bounds}
              label={`Side-chain topology of wild-type ${wildType}`}
            />
          </div>
          {diff.wildType.atoms.length === 0 && <span className="rsx-glyph-empty">No heavy side-chain atoms</span>}
        </div>

        <div className="rsx-glyph-divider" aria-hidden="true">
          <span className="rsx-glyph-arrow">&rarr;</span>
        </div>

        <div className="rsx-glyph-card" data-state="variant">
          <div className="rsx-glyph-caption">
            <span className="rsx-glyph-code rsx-glyph-code--mut">{mutant}</span>
            <span className="rsx-glyph-role">Variant</span>
            {mutantName && <span className="rsx-glyph-name">{mutantName}</span>}
          </div>
          <div className="rsx-glyph-frame">
            <SingleGlyphSvg
              glyph={diff.mutant}
              bounds={diff.bounds}
              label={`Side-chain topology of variant ${mutant}`}
            />
          </div>
          {diff.mutant.atoms.length === 0 && <span className="rsx-glyph-empty">No heavy side-chain atoms</span>}
        </div>
      </div>
      <p className="rsx-glyph-note">Side-chain schematic, shown at the same scale. Dashed bonds mark atoms lost; accent marks atoms gained.</p>

      {diff.summary && (
        <div className="rsx-glyph-summary" data-testid="glyph-diff-summary">
          <span className="rsx-glyph-badge">Side-chain atoms</span>
          <span className="rsx-glyph-diff-text">{diff.summary}</span>
        </div>
      )}
    </div>
  );
}
