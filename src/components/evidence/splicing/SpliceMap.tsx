import React from "react";
import { THRESHOLDS } from "../../../shared/thresholds";
import { formatDelta, type SpliceGeometry, type SpliceMap as SpliceMapModel } from "../../../shared/splicingEvidence";

/**
 * SpliceMap — where the variant sits among the splice sites, and where SpliceAI predicts a change.
 *
 * ONE AXIS, in bases from the variant, in transcript direction (5′ → 3′ left to right): the
 * variant is the fixed point because SpliceAI's delta positions are measured from it. Over it:
 *
 *   gene model   the exon (to its real length when known, else running off the edge) on a thin
 *                intron line, with the transcript's neighbouring exons when the payload carries
 *                them and the introns between named; the annotated donor and acceptor as ticks;
 *                the canonical dinucleotide marked while the scale is fine enough to show it;
 *   SpliceAI     one lollipop per channel scoring ≥ 0.01, at its delta position, its height the
 *                score on a 0–1 axis with the Walker PP3 line (0.2) drawn across. Gains are solid,
 *                losses hollow. A lollipop standing on an annotated site is a weakened or
 *                strengthened real site; one standing in open sequence is a cryptic site;
 *   dbscSNV      its real window (Jian 2014) as a dashed bracket, context only.
 *
 * It replaced a fixed ±40 bp ruler of one junction and the variant, which could not show where a
 * predicted change lands. Nothing is drawn for the lane when no channel reaches 0.01; the tab says
 * so in words. All geometry comes from `buildSplicingEvidence`; this file only draws it.
 */

const W = 760;
const PAD = 28;
const CX = W / 2;
const HALF_PX = CX - PAD;
const LANE_H = 64;
const LANE_TOP = 44;
const STEP: Record<number, number> = { 50: 10, 100: 20, 200: 50, 500: 100, 1000: 200, 2000: 500 };
const signed = (p: number) => `${p > 0 ? "+" : "−"}${Math.abs(p)}`;

export function spliceMapLabel(map: SpliceMapModel, geometry: SpliceGeometry): string {
  const site = map.junction;
  const [winFrom, winTo] = site === "donor" ? [-THRESHOLDS.dbscsnv.window.donor.exonic, THRESHOLDS.dbscsnv.window.donor.intronic] : [-THRESHOLDS.dbscsnv.window.acceptor.intronic, THRESHOLDS.dbscsnv.window.acceptor.exonic];
  const preds = map.predictions.length
    ? ` SpliceAI places ${map.predictions
        .map(x => `${x.name.toLowerCase()} ${formatDelta(x.ds)} at ${x.offset > 0 ? "+" : "−"}${Math.abs(x.offset)} bases${x.atSite ? `, on the annotated ${x.atSite}` : ""}`)
        .join("; ")}.`
    : " No SpliceAI channel reaches 0.01 in its window.";
  return `Variant at position ${signed(map.position)} of the ${site}, ${geometry.regionType}. dbscSNV's window here runs ${signed(winFrom)} to ${signed(winTo)}; the variant is ${geometry.inDbscsnvWindow ? "inside" : "outside"} it.${preds}`;
}

export function SpliceMap({ map, geometry }: { map: SpliceMapModel; geometry: SpliceGeometry }) {
  const scale = HALF_PX / map.halfWidth;
  const x = (offset: number) => CX + offset * scale;
  const left = PAD;
  const right = W - PAD;
  const hasLane = map.predictions.length > 0;
  const yBase = LANE_TOP + LANE_H;
  const T = hasLane ? yBase + 20 : 18;
  const yMid = T + 38;
  const H = yMid + 134;
  const clipId = React.useId().replace(/:/g, "");

  const vx = CX;
  const edge = (offset: number | null, open: number) => (offset === null ? open : x(offset));

  // Every exon in reach, left to right: the nearest one (whose far end may be unknown) and its neighbours.
  const exons = [
    { number: map.exonNumber, x0: edge(map.exon.start, left - 24), x1: edge(map.exon.end, right + 24), current: true },
    ...map.neighbours.map(n => ({ number: n.number as number | null, x0: x(n.start), x1: x(n.end), current: false })),
  ]
    .filter(e => e.x1 > left && e.x0 < right)
    .sort((a, b) => a.x0 - b.x0);

  // Introns are the gaps between neighbouring exons and the tails to the window edges. Intron k sits between
  // exon k and k + 1 in transcript order, so a tail is named only when its number is known and real.
  const intronLabels: Array<{ x0: number; x1: number; text: string }> = [];
  const nearIntron = geometry.intronLabel;
  const total = map.totalExons;
  const gaps: Array<{ x0: number; x1: number; after: number | null }> = [];
  if (exons.length > 0) {
    const first = exons[0];
    const last = exons[exons.length - 1];
    gaps.push({ x0: left, x1: Math.max(left, first.x0), after: first.number !== null ? first.number - 1 : null });
    for (let i = 0; i < exons.length - 1; i++) gaps.push({ x0: exons[i].x1, x1: exons[i + 1].x0, after: exons[i].number });
    gaps.push({ x0: Math.min(right, last.x1), x1: right, after: last.number });
  }
  for (const gap of gaps) {
    if (gap.x1 - gap.x0 <= 70 || gap.after === null || gap.after < 1 || (total !== null && gap.after >= total)) continue;
    // The resolver's own label for the intron beside the variant's exon wins when it names the same one.
    const text = `Intron ${gap.after}`;
    intronLabels.push({ x0: gap.x0, x1: gap.x1, text: nearIntron.endsWith(String(gap.after)) ? nearIntron : text });
  }

  const nearJx = x(map.junctionOffset);
  const currentSites = [map.exon.start !== null ? { type: "acceptor" as const, offset: map.exon.start + 0.5 } : null, map.exon.end !== null ? { type: "donor" as const, offset: map.exon.end - 0.5 } : null].filter(
    (s): s is { type: "acceptor" | "donor"; offset: number } => s !== null
  );

  // Lollipop labels: greedy rows so neighbours do not overprint.
  const rowsRight: number[] = [];
  const lollipops = map.predictions.map(pr => {
    const cx = Math.min(right - 6, Math.max(left + 6, x(pr.offset)));
    const cy = yBase - pr.ds * LANE_H;
    const text = `${pr.name} ${formatDelta(pr.ds)}`;
    const half = text.length * 3.1 + 4;
    let row = rowsRight.findIndex(r => cx - half > r + 6);
    if (row === -1) row = rowsRight.length;
    rowsRight[row] = cx + half;
    return { pr, cx, cy, text, row };
  });

  const ticks: number[] = [];
  const step = STEP[map.halfWidth] ?? Math.round(map.halfWidth / 5);
  for (let t = -map.halfWidth; t <= map.halfWidth; t += step) ticks.push(t);

  const dbscX0 = Math.max(left, x(map.dbscWindow[0]));
  const dbscX1 = Math.min(right, x(map.dbscWindow[1]));
  const showDbsc = dbscX1 - dbscX0 > 3;
  const canonicalVisible = map.halfWidth <= 50;
  const canon = map.junction === "donor" ? [nearJx, x(map.junctionOffset + 2)] : [x(map.junctionOffset - 2), nearJx];

  return (
    <svg className="spl-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spliceMapLabel(map, geometry)}>
      <title>{`Splice map around ${geometry.exonLabel}`}</title>
      <defs>
        <clipPath id={clipId}>
          <rect x={left} y={0} width={right - left} height={H} />
        </clipPath>
      </defs>

      {/* SpliceAI lane */}
      {hasLane && (
        <g className="spl-map__lane">
          <line className="spl-map__lane-base" x1={left} x2={right} y1={yBase} y2={yBase} />
          <line className="spl-map__pp3" x1={left} x2={right} y1={yBase - THRESHOLDS.spliceai.splicingPp3 * LANE_H} y2={yBase - THRESHOLDS.spliceai.splicingPp3 * LANE_H} />
          <text className="spl-map__lane-text" x={left} y={yBase - THRESHOLDS.spliceai.splicingPp3 * LANE_H - 4}>
            {THRESHOLDS.spliceai.splicingPp3.toFixed(1)} · PP3
          </text>
          <text className="spl-map__lane-text" x={left} y={yBase + 12}>0</text>
          <line className="spl-map__guide" x1={vx} x2={vx} y1={LANE_TOP - 6} y2={T + 20} />
          {lollipops.map(({ pr, cx, cy, text, row }) => (
            <g key={pr.key} className="spl-map__pred" data-kind={pr.kind} data-pp3={pr.inPp3Band || undefined} data-testid={`map-${pr.key}`}>
              <line x1={cx} x2={cx} y1={yBase} y2={cy} />
              <circle cx={cx} cy={cy} r={5} />
              <text x={cx} y={cy - 11 - row * 13} textAnchor="middle">{text}</text>
            </g>
          ))}
        </g>
      )}

      {/* Gene model */}
      <g clipPath={`url(#${clipId})`}>
        <line className="spl-map__intron" x1={left} x2={right} y1={yMid} y2={yMid} />
        {exons.map(e => (
          <rect
            key={`${e.number ?? "x"}-${e.x0}`}
            className="spl-map__exon"
            data-neighbour={e.current ? undefined : true}
            x={e.x0}
            y={yMid - 14}
            width={Math.max(0, e.x1 - e.x0)}
            height={28}
            rx={4}
          />
        ))}
        {canonicalVisible && (
          <rect className="spl-map__canonical" x={Math.min(canon[0], canon[1])} y={yMid - 3} width={Math.abs(canon[1] - canon[0])} height={6} rx={1} />
        )}
        {map.sites.map(s => {
          const sx = x(s.offset + (s.type === "donor" ? 0.5 : -0.5));
          return <line key={`${s.type}-${s.offset}`} className="spl-map__site" data-far={!currentSites.some(c => c.type === s.type && c.offset === s.offset) || undefined} x1={sx} x2={sx} y1={yMid - 20} y2={yMid + 20} />;
        })}
      </g>
      {exons.map(e => {
        const x0 = Math.max(left, e.x0);
        const x1 = Math.min(right, e.x1);
        // "Exon 19" where it fits, the bare number where it does not, nothing under ~22 px.
        if (x1 - x0 < 22) return null;
        const short = x1 - x0 <= 84;
        const mid = (x0 + x1) / 2;
        // The variant's own mark must not sit on the name.
        const shift = e.current && !short && Math.abs(vx - mid) < 40 ? 56 : 0;
        return (
          <text key={`l-${e.number ?? "x"}-${e.x0}`} className="spl-map__region" data-neighbour={e.current ? undefined : true} x={mid + shift} y={yMid + 4} textAnchor="middle">
            {e.number === null ? (short ? "" : "Exon") : short ? e.number : `Exon ${e.number}`}
          </text>
        );
      })}
      {intronLabels.map(l => (
        <text key={l.text + l.x0} className="spl-map__region" data-muted x={(l.x0 + l.x1) / 2} y={yMid - 8} textAnchor="middle">
          {l.text}
        </text>
      ))}

      {/* Site names: the nearest exon's two sites only; neighbours are ticks. */}
      {currentSites.map(s => {
        const sx = x(s.offset + (s.type === "donor" ? 0.5 : -0.5));
        if (sx < left + 20 || sx > right - 20) return null;
        return (
          <text key={s.type} className="spl-map__site-name" x={sx} y={yMid + 36} textAnchor="middle">
            {s.type === "donor" ? "GT donor" : "AG acceptor"}
          </text>
        );
      })}

      {/* dbscSNV window */}
      {showDbsc && (
        <g className="spl-map__window">
          <path d={`M ${dbscX0} ${yMid + 50} V ${yMid + 56} H ${dbscX1} V ${yMid + 50}`} />
          <text x={(dbscX0 + dbscX1) / 2} y={yMid + 69} textAnchor="middle">dbscSNV window</text>
        </g>
      )}

      {/* Variant */}
      <g className="spl-map__variant">
        <line x1={vx} x2={vx} y1={yMid - 22} y2={yMid} />
        <circle cx={vx} cy={yMid} r={6} />
        <text x={vx} y={yMid - 27} textAnchor="middle">{signed(map.position)}</text>
      </g>

      {/* Axis */}
      <g className="spl-map__axis">
        <line x1={left} x2={right} y1={yMid + 88} y2={yMid + 88} />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={yMid + 88} y2={yMid + 93} />
            <text x={x(t)} y={yMid + 106} textAnchor="middle" data-strong={t === 0 || undefined}>{t === 0 ? "variant" : signed(t)}</text>
          </g>
        ))}
        <text className="spl-map__caption" x={right} y={yMid + 122} textAnchor="end">bases from the variant · transcript direction →</text>
      </g>
    </svg>
  );
}
