import React from "react";
import { THRESHOLDS } from "../../../shared/thresholds";
import type { SpliceGeometry } from "../../../shared/splicingEvidence";

/**
 * JunctionDiagram — the variant's place at its nearest splice site, to scale.
 *
 * Positions use splice-site numbering (no 0): at a donor the exon runs −1, −2… and the intron
 * +1, +2…; at an acceptor the intron runs −1, −2… and the exon +1, +2…. Either way the exon side
 * of a donor sits LEFT and of an acceptor RIGHT, in transcript orientation, so a positive position
 * always lies right of the junction.
 *
 * What is drawn, and why:
 *   • dbscSNV's window (−3..+8 donor, −12..+2 acceptor, Jian 2014) as a dashed bracket — the only
 *     region where a dbscSNV score exists. It replaced a symmetric red "±5 bp Critical Junction
 *     Zone", an app-defined band drawn as if it were evidence.
 *   • The canonical dinucleotide (intronic ±1, ±2), marked but not coloured as a verdict — a change
 *     there is a PVS1 question (Abou Tayoun 2018), not PP3.
 *   • The variant, as a dot on its base; beyond the drawn window, as a hollow mark on the edge with
 *     its position written out, never clipped silently.
 *
 * Nothing is drawn when the orientation or position is not resolved: the tab states that in words.
 */

const W = 640;
const H = 128;
const J = W / 2; // junction x
const SPAN = 40; // bp drawn each side
const BP = (J - 40) / SPAN; // px per bp
const TRACK_Y = 62;
const EDGE = 12;

/** x of the centre of splice-site position p (p ≠ 0). */
const xOf = (p: number) => J + Math.sign(p) * (Math.min(Math.abs(p), SPAN + 0.5) - 0.5) * BP;
const signed = (p: number) => `${p > 0 ? "+" : "−"}${Math.abs(p)}`;

export function JunctionDiagram({ geometry }: { geometry: SpliceGeometry }) {
  const { position, junction } = geometry;
  if (position === null || (junction !== "donor" && junction !== "acceptor")) return null;

  const exonRight = junction === "acceptor";
  const win = THRESHOLDS.dbscsnv.window[junction];
  // dbscSNV window in positions: donor −exonic..+intronic; acceptor −intronic..+exonic.
  const winFrom = junction === "donor" ? -win.exonic : -win.intronic;
  const winTo = junction === "donor" ? win.intronic : win.exonic;
  const winX0 = xOf(winFrom) - BP / 2;
  const winX1 = xOf(winTo) + BP / 2;

  const offScale = Math.abs(position) > SPAN;
  const vx = xOf(position);
  const canonical = [-2, -1, 1, 2].filter(p => (exonRight ? p < 0 : p > 0)); // intronic side only
  const ticks = [-40, -30, -20, -10, 10, 20, 30, 40];

  const exonName = geometry.exonNumber !== null ? `Exon ${geometry.exonNumber}` : "Exon";
  const intronName = geometry.intronNumber !== null ? `Intron ${geometry.intronNumber}` : "Intron";

  // Exon extent: to its real end when that end is inside the drawn window, else to the edge.
  const L = geometry.exonLength;
  const farExonX = exonRight ? W - EDGE : EDGE;
  const exonEnds = L !== null && L > 0 && L < SPAN;
  const exonEndX = exonEnds ? (exonRight ? xOf(L as number) + BP / 2 : xOf(-(L as number)) - BP / 2) : farExonX;

  // Region labels sit at the far end of their side, unless the variant is out there; then by the junction.
  const variantOnExon = geometry.regionType === "exonic";
  const farFrac = (x: number, end: number) => Math.abs(x - J) / Math.max(1, Math.abs(end - J));
  const place = (end: number, rightSide: boolean, crowded: boolean) =>
    crowded
      ? { x: rightSide ? J + 10 : J - 10, anchor: (rightSide ? "start" : "end") as "start" | "end" }
      : { x: rightSide ? end - 10 : end + 10, anchor: (rightSide ? "end" : "start") as "start" | "end" };
  const exonLabel = place(exonEndX, exonRight, variantOnExon && farFrac(vx, exonEndX) > 0.55);
  const intronEnd = exonRight ? EDGE : W - EDGE;
  const intronLabel = place(intronEnd, !exonRight, !variantOnExon && farFrac(vx, intronEnd) > 0.55);
  const site = junction === "donor" ? "donor" : "acceptor";
  const label = `Variant at position ${signed(position)} of the ${site}, ${geometry.regionType}${offScale ? `, beyond the ${SPAN} bp drawn` : ""}. dbscSNV's window here runs ${signed(winFrom)} to ${signed(winTo)}; the variant is ${geometry.inDbscsnvWindow ? "inside" : "outside"} it.`;

  return (
    <svg className="spl-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{`${exonName} ${site} boundary`}</title>

      {/* dbscSNV window bracket */}
      <g className="spl-diagram__window">
        <path d={`M ${winX0} 28 V 22 H ${winX1} V 28`} />
        <text x={(winX0 + winX1) / 2} y={15} textAnchor="middle">dbscSNV window</text>
      </g>

      {/* Intron: a line. Exon: a box, ending where the exon ends when that falls inside the window. */}
      <line className="spl-diagram__intron" x1={exonRight ? EDGE : J} x2={exonRight ? J : W - EDGE} y1={TRACK_Y} y2={TRACK_Y} />
      {exonEnds && (
        <line className="spl-diagram__intron" x1={exonEndX} x2={farExonX} y1={TRACK_Y} y2={TRACK_Y} />
      )}
      <rect className="spl-diagram__exon" x={Math.min(J, exonEndX)} y={TRACK_Y - 16} width={Math.abs(exonEndX - J)} height={32} rx={4} />
      <text className="spl-diagram__region" x={exonLabel.x} y={TRACK_Y + 4} textAnchor={exonLabel.anchor}>
        {exonName}
      </text>
      <text className="spl-diagram__region" data-muted x={intronLabel.x} y={TRACK_Y - 8} textAnchor={intronLabel.anchor}>
        {intronName}
      </text>

      {/* Canonical dinucleotide */}
      {canonical.map(p => (
        <rect key={p} className="spl-diagram__canonical" x={xOf(p) - BP / 2 + 0.5} y={TRACK_Y - 3} width={BP - 1} height={6} rx={1} />
      ))}

      {/* Junction */}
      <line className="spl-diagram__junction" x1={J} x2={J} y1={TRACK_Y - 26} y2={TRACK_Y + 26} />

      {/* Axis */}
      <g className="spl-diagram__axis">
        {ticks.map(t => (
          <g key={t}>
            <line x1={xOf(t)} x2={xOf(t)} y1={TRACK_Y + 22} y2={TRACK_Y + 27} />
            <text x={xOf(t)} y={TRACK_Y + 40} textAnchor="middle">{signed(t)}</text>
          </g>
        ))}
        <text x={J} y={TRACK_Y + 40} textAnchor="middle" data-strong>{junction === "donor" ? "GT donor" : "AG acceptor"}</text>
      </g>

      {/* Variant */}
      <g className="spl-diagram__variant" data-off-scale={offScale || undefined}>
        <line x1={vx} x2={vx} y1={TRACK_Y - 20} y2={TRACK_Y} />
        <circle cx={vx} cy={TRACK_Y} r={6} />
        <text x={vx} y={TRACK_Y - 25} textAnchor={vx > W - 60 ? "end" : vx < 60 ? "start" : "middle"}>
          {offScale ? (position > 0 ? `${signed(position)} →` : `← ${signed(position)}`) : signed(position)}
        </text>
      </g>
    </svg>
  );
}
