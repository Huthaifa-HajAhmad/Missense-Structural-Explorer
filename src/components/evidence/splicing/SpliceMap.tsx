import React from "react";
import { THRESHOLDS } from "../../../shared/thresholds";
import { formatDelta, SPLICE_MAP_FLOOR, SPLICE_MAP_STEPS, type SpliceGeometry, type SpliceMap as SpliceMapModel } from "../../../shared/splicingEvidence";
import type { SpliceMapView } from '../EvidenceWorkspace';

/**
 * SpliceMap — where the variant sits among the splice sites, and where SpliceAI predicts a change.
 *
 * ONE AXIS, in bases from the variant, in transcript direction (5′ → 3′ left to right): the
 * variant is the fixed point because SpliceAI's delta positions are measured from it. Over it:
 *
 *   gene model   the exon (to its real length when known, else running off the edge) on a thin
 *                intron line, with the transcript's neighbouring exons when the payload carries
 *                them and the introns between named; the annotated donor and acceptor as ticks;
 *                transcript termini distinguished from annotated splice junctions;
 *   SpliceAI     one lollipop per displayed channel, at its delta position, its height the
 *                score on an explicitly labelled axis with the Walker PP3 line. Gains are solid,
 *                losses hollow. A lollipop standing on an annotated site is a weakened or
 *                strengthened real site; one standing in open sequence is a cryptic site;
 *   dbscSNV      its real window (Jian 2014) as a dashed bracket, context only.
 *
 * It replaced a fixed ±40 bp ruler of one junction and the variant, which could not show where a
 * predicted change lands. A channel below the plotting floor has no meaningful delta position, so it
 * is never drawn on the axis; it is listed in a compact "no signal" row under it. All geometry comes
 * from `buildSplicingEvidence`; this file only draws it.
 */

const W = 760;
const PAD = 28;
const CX = W / 2;
const HALF_PX = CX - PAD;
const LANE_H = 140;
const LANE_TOP = 290;
const STEP: Record<number, number> = { 50: 10, 100: 20, 200: 50, 500: 100, 1000: 200, 2000: 500 };
const signed = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}`;

/** The gain/loss reading of a channel key, for channels whose model object carries no `kind`. */
const channelKind = (key: string): "gain" | "loss" => (key === "ds_ag" || key === "ds_dg" ? "gain" : "loss");

/**
 * The exact delta of a below-floor channel. `formatDelta` prints "< 0.01" — honest on the map, but
 * here the value itself is the fact, so it is printed unrounded (0, 0.004, 0.001…). `String` gives
 * the shortest round-trip form, so 0.00999 never rounds up onto the floor it sits below.
 */
const exactDelta = (v: number) => String(v);

interface PredictedSiteRow {
  key: string;
  name: string;
  kind: "gain" | "loss" | "no-signal";
  dsText: string;
  position: string;
  status: string;
}

/**
 * Every SpliceAI channel as one row: the ones the map places (strongest Δ first), then those scored
 * without a delta position, then those below the plotting floor. The figure draws only the first
 * group; the rest are kept here so no channel is silently dropped.
 */
function predictedSiteRows(map: SpliceMapModel): PredictedSiteRow[] {
  const placed = [...map.predictions]
    .sort((a, b) => b.ds - a.ds)
    .map((pr): PredictedSiteRow => ({
      key: pr.key,
      name: pr.name,
      kind: pr.kind,
      dsText: formatDelta(pr.ds),
      position: `${signed(pr.offset)} bp`,
      status: pr.atSite
        ? `Coincides with annotated ${pr.atSite} (within 1 bp)${Math.abs(pr.offset) > map.halfWidth ? " · Outside the map view" : ""}`
        : Math.abs(pr.offset) > map.halfWidth
        ? "Outside the map view"
        : "No matching annotated site in the supplied geometry",
    }));
  const missing = map.missingPositions.map((pr): PredictedSiteRow => ({
    key: pr.key,
    name: pr.name,
    kind: channelKind(pr.key),
    dsText: formatDelta(pr.ds),
    position: "Not returned",
    status: "Scored, but no delta position was returned — it still contributes to the maximum, and its location cannot be plotted.",
  }));
  const quiet = map.quiet.map((q): PredictedSiteRow => ({
    key: q.key,
    name: q.name,
    kind: "no-signal",
    dsText: exactDelta(q.ds),
    position: "—",
    status: "No predicted site — Δ too small for a position to mean anything",
  }));
  return [...placed, ...missing, ...quiet];
}

/**
 * The section's conclusion in one sentence, computed from what the map placed. It names positions
 * and whether they land on an annotated site — never a PP3/BP4 call, which belongs to the rule trace.
 */
function predictedSiteSummary(map: SpliceMapModel): string {
  const placed = [...map.predictions].sort((a, b) => b.ds - a.ds);
  if (placed.length > 0) {
    const n = placed.length;
    const items = placed.map(pr => `${pr.name.toLowerCase()} at ${signed(pr.offset)} bp (Δ ${formatDelta(pr.ds)})`);
    const list = n === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[n - 1]}`;
    if (n === 1) {
      return `SpliceAI places 1 predicted site: ${list}${
        placed[0].atSite
          ? `, which coincides with the annotated ${placed[0].atSite} (within 1 bp).`
          : `, which does not coincide with the annotated ${placed[0].type}.`
      }`;
    }
    const onSite = placed.filter(pr => pr.atSite).length;
    const tail = onSite === 0 ? " None coincides with an annotated site (within 1 bp)." : onSite === n ? " Each coincides with an annotated site (within 1 bp)." : ` ${onSite} of ${n} coincide with an annotated site (within 1 bp).`;
    return `SpliceAI places ${n} predicted sites: ${list}.${tail}`;
  }
  if (map.missingPositions.length > 0) {
    const m = map.missingPositions.length;
    return `SpliceAI places no predicted site on the map: ${m === 1 ? "one scored channel has no delta position" : `${m} scored channels have no delta position`}, so ${m === 1 ? "its" : "their"} location cannot be plotted.`;
  }
  if (map.predictionsNote) return `SpliceAI places no predicted site on the map: ${map.predictionsNote}`;
  if (map.quiet.length > 0) {
    const q = map.quiet.length;
    return `SpliceAI places no predicted site; ${q === 4 ? "all four channels score" : `${q} scored channel${q === 1 ? "" : "s"} score`} below ${SPLICE_MAP_FLOOR}.`;
  }
  if (map.maxScore === null) return "SpliceAI returned no score for this variant, so no predicted site can be placed.";
  return "No predicted site can be placed.";
}

/**
 * The map's conclusion, always visible: which channels SpliceAI places on what, where each lands and
 * whether that coincides with an annotated site — plus the channels it does not place. It replaced a
 * collapsed `<details>`, which hid the very answer the figure is asking.
 */
function PredictedSites({ map, selectedKey, onSelect }: { map: SpliceMapModel; selectedKey?: string | null; onSelect?: (key: string) => void }) {
  const headingId = React.useId();
  const rows = predictedSiteRows(map);
  return (
    <section className="spl-preds" aria-labelledby={headingId} data-testid="predicted-sites">
      <h3 className="eyebrow" id={headingId}>Predicted splice sites</h3>
      <p className="spl-preds__summary" data-testid="predicted-sites-summary">{predictedSiteSummary(map)}</p>
      <div className="spl-preds__wrap">
        <table className="spl-preds__table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col" title="SpliceAI delta score">Δ</th>
              <th scope="col" title="Bases from the variant, transcript direction (5′ → 3′)">Position</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} data-testid={`predicted-${row.key}`} data-kind={row.kind} data-selected={selectedKey === `spliceai-${row.key}` || undefined}>
                <th scope="row" className="spl-preds__channel">
                  <i className="spl-key" data-kind={row.kind} aria-hidden="true" />
                  {onSelect ? <button type="button" className="spl-record-button" aria-pressed={selectedKey === `spliceai-${row.key}`} onClick={() => onSelect(`spliceai-${row.key}`)}>{row.name}</button> : row.name}
                </th>
                <td className="spl-preds__delta spl-mono">{row.dsText}</td>
                <td className="spl-preds__position spl-mono">{row.position}</td>
                <td className="spl-preds__status">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function spliceMapLabel(map: SpliceMapModel, geometry: SpliceGeometry): string {
  const site = map.junction;
  const [winFrom, winTo] = site === "donor" ? [-THRESHOLDS.dbscsnv.window.donor.exonic, THRESHOLDS.dbscsnv.window.donor.intronic] : [-THRESHOLDS.dbscsnv.window.acceptor.intronic, THRESHOLDS.dbscsnv.window.acceptor.exonic];
  const quietNames = map.quiet.map(q => `${q.name.toLowerCase()} ${formatDelta(q.ds)}`).join(", ");
  const quietText = map.quiet.length
    ? ` ${map.quiet.length === 1 ? "One channel is" : `${map.quiet.length} channels are`} below ${SPLICE_MAP_FLOOR} (${quietNames}); ${map.quiet.length === 1 ? "it is" : "they are"} drawn in the no-signal row below the axis, not placed on it, because a Δ this close to zero has no meaningful position.`
    : "";
  const fallback = map.maxScore === null
    ? " No predicted site is drawn; inspect the channel readings for scores."
    : ` No SpliceAI channel reaches ${SPLICE_MAP_FLOOR} anywhere in its window, so no predicted site is placed.`;
  const preds = map.predictions.length
    ? ` SpliceAI places ${map.predictions
        .map(x => `${x.name.toLowerCase()} ${formatDelta(x.ds)} at ${signed(x.offset)} bases from the variant in transcript direction${x.atSite ? `, on the annotated ${x.atSite}` : ""}${Math.abs(x.offset) > map.halfWidth ? ", outside the map view" : ""}`)
        .join("; ")}.${quietText}`
    : (map.predictionsNote ?? fallback) + quietText;
  return `Variant at position ${signed(map.position)} of the ${site}, ${geometry.regionType}. dbscSNV's window here runs ${signed(winFrom)} to ${signed(winTo)}; the variant is ${geometry.inDbscsnvWindow ? "inside" : "outside"} it.${preds}${map.predictions.length > 0 && map.predictionsNote ? ` ${map.predictionsNote}` : ""}`;
}

export function SpliceMap({ map: sourceMap, geometry, selectedKey, onSelect, view, onViewChange }: {
  map: SpliceMapModel; geometry: SpliceGeometry; selectedKey?: string | null; onSelect?: (key: string) => void;
  view?: SpliceMapView; onViewChange?: (patch: Partial<SpliceMapView>) => void;
}) {
  const [localZoom, setLocalZoom] = React.useState<number | null>(null);
  const [localFocused, setLocalFocused] = React.useState(false);
  const zoom = view ? view.halfWidth : localZoom;
  const focusedScore = view ? view.focusedScore : localFocused;
  const setZoom = (halfWidth: number | null) => onViewChange ? onViewChange({ halfWidth }) : setLocalZoom(halfWidth);
  const setFocusedScore = (focusedScore: boolean) => onViewChange ? onViewChange({ focusedScore }) : setLocalFocused(focusedScore);
  const map = { ...sourceMap, halfWidth: zoom ?? sourceMap.halfWidth };
  // Roving tabindex: one tab stop on the pinned mark (or the first drawn), arrows move focus only.
  // Arrows leave the choice to Enter/Space, so focus travel never re-orders the pinned reading.
  const markKeys = [...map.predictions.map(p => p.key), ...map.quiet.map(q => q.key)];
  const tabStop = selectedKey !== null && selectedKey !== undefined && selectedKey.startsWith('spliceai-')
    ? selectedKey.slice('spliceai-'.length)
    : markKeys[0] ?? null;
  const pickProps = (key: string, name: string) => onSelect ? {
    role: 'button', tabIndex: key === tabStop ? 0 : -1,
    'aria-label': `Pin ${name} on splice map`,
    'aria-pressed': selectedKey === `spliceai-${key}`,
    'data-splice-pick': key,
    onClick: () => onSelect(`spliceai-${key}`),
    onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(`spliceai-${key}`); }
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const marks = Array.from(event.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>('[data-splice-pick]') ?? []);
        const index = marks.indexOf(event.currentTarget);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? marks.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : marks.length - 1)) % marks.length;
        marks[next]?.focus();
      }
    },
  } : {};
  // Include scores with missing positions: a focused view must not obscure the highest signal.
  const canFocus = map.maxScore !== null && map.maxScore <= 0.3 && map.predictions.every(p => p.ds <= 0.3);
  const scoreMax = focusedScore && canFocus ? 0.3 : 1;
  const scoreY = (score: number) => yBase - score / scoreMax * LANE_H;
  const scale = HALF_PX / map.halfWidth;
  const x = (offset: number) => CX + offset * scale;
  const left = PAD;
  const right = W - PAD;
  const hasLane = map.predictions.length > 0;
  const yBase = LANE_TOP + LANE_H;
  // Structure first, predictions second, on the same horizontal coordinate system.
  const yMid = 86;
  const modelH = hasLane ? yBase + 34 : yMid + 134;
  // The "no signal" row is deliberately OFF the positional axis: below-floor channels have no trustworthy
  // delta position, so placing them on the axis would assert a site there. It is left-aligned with fixed
  // x coordinates, so it can never collide with the lollipop lane, the variant mark, the exon bar, the
  // ruler or the PP3 line — at the default ±100 bp view or at any zoom (zoom only changes x()).
  const quietRows = (() => {
    const rows: Array<Array<{ q: SpliceMapModel["quiet"][number]; cx: number; label: string }>> = [];
    let row: Array<{ q: SpliceMapModel["quiet"][number]; cx: number; label: string }> = [];
    let cx = left + 16;
    for (const q of map.quiet) {
      const label = `${q.name} ${formatDelta(q.ds)}`;
      const width = label.length * 6.5 + 42;
      if (row.length > 0 && cx + width > right) {
        rows.push(row);
        row = [];
        cx = left + 16;
      }
      row.push({ q, cx, label });
      cx += width + 16;
    }
    if (row.length > 0) rows.push(row);
    return rows;
  })();
  const quietTop = modelH + 24;
  const quietItemBase = quietTop + 48;
  const H = quietRows.length > 0 ? quietItemBase + (quietRows.length - 1) * 36 + 28 : modelH + 12;
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

  const currentSites = map.sites.filter(s => !s.far ||
    (s.type === "acceptor" ? s.offset === (map.exon.start ?? NaN) + 0.5 : s.offset === (map.exon.end ?? NaN) - 0.5));

  // Avoid collisions in both dimensions, including unequal scores and labels clamped at edges.
  const labelBoxes: Array<{ left: number; right: number; y: number }> = [];
  const lollipops = map.predictions.map(pr => {
    const cx = Math.min(right - 6, Math.max(left + 6, x(pr.offset)));
    const cy = scoreY(pr.ds);
    const offScale = Math.abs(pr.offset) > map.halfWidth;
    const text = `${pr.name} ${formatDelta(pr.ds)} · ${signed(pr.offset)} bp${offScale ? " (off view)" : ""}`;
    const half = text.length * 3.3 + 12;
    const labelX = Math.max(left + half, Math.min(right - half, cx));
    let labelY = cy - 18;
    while (labelBoxes.some(b => labelX - half < b.right + 8 && labelX + half > b.left - 8 && Math.abs(labelY - b.y) < 26)) labelY -= 26;
    // High-scoring collisions wrap below the point, keeping the track heading clear.
    if (labelY < 278) {
      labelY = cy + 30;
      while (labelBoxes.some(b => labelX - half < b.right + 8 && labelX + half > b.left - 8 && Math.abs(labelY - b.y) < 26)) labelY += 26;
    }
    labelBoxes.push({ left: labelX - half, right: labelX + half, y: labelY });
    return { pr, cx, cy, text, labelX, labelY, half, offScale };
  });

  const ticks: number[] = [];
  const step = STEP[map.halfWidth] ?? Math.round(map.halfWidth / 5);
  for (let t = -map.halfWidth; t <= map.halfWidth; t += step) ticks.push(t);

  const dbscX0 = Math.max(left, x(map.dbscWindow[0]));
  const dbscX1 = Math.min(right, x(map.dbscWindow[1]));
  const showDbsc = dbscX1 - dbscX0 > 3;

  return (
    <div className="spl-map-panel">
      <header className="spl-map-heading">
        <div><span className="eyebrow">Splice landscape</span><h3>Structure & predicted effects</h3></div>
        <span className="spl-map-heading__direction">5′ <span aria-hidden="true">⟶</span> 3′ <span>Transcript direction</span></span>
      </header>
      <div className="spl-map-controls">
        <label>Map view <select aria-label="Map view" value={zoom ?? "auto"} onChange={e => setZoom(e.target.value === "auto" ? null : Number(e.target.value))}>
          <option value="auto">Auto (±{sourceMap.halfWidth} bp)</option>
          {SPLICE_MAP_STEPS.map(w => <option key={w} value={w}>±{w} bp</option>)}
        </select></label>
        <label>SpliceAI Δ axis <select aria-label="SpliceAI delta axis" value={focusedScore && canFocus ? "focused" : "full"} onChange={e => setFocusedScore(e.target.value === "focused")}>
          <option value="full">0–1 (full range)</option>
          <option value="focused" disabled={!canFocus}>0–0.3 (focused range)</option>
        </select></label>
        <span>View controls do not re-score the variant. Predictions are scored against SpliceAI's own annotation, which may differ from the transcript shown here.</span>
      </div>
    <div className="spl-map-scroll" role={onSelect ? 'region' : undefined} aria-label={onSelect ? 'Interactive splice map' : undefined} tabIndex={onSelect ? 0 : undefined}>
    <svg className="spl-map" viewBox={`0 0 ${W} ${H}`} role={onSelect ? 'group' : 'img'} aria-label={spliceMapLabel(map, geometry)}>
      <title>{`Splice map around ${geometry.exonLabel}`}</title>
      <defs>
        <clipPath id={clipId}>
          <rect x={left} y={0} width={right - left} height={H} />
        </clipPath>
      </defs>

      <rect className="spl-map__track-surface" x={8} y={8} width={W - 16} height={210} rx={10} />
      <text className="spl-map__track-title" x={left} y={32} aria-hidden="true">ANNOTATED TRANSCRIPT</text>
      <text className="spl-map__transcript-id" x={right} y={32} textAnchor="end" aria-hidden="true">{geometry.transcriptId ?? 'Transcript unresolved'}</text>
      {hasLane && <>
        <rect className="spl-map__prediction-surface" x={8} y={232} width={W - 16} height={yBase - 210} rx={10} />
        <text className="spl-map__track-title" x={left} y={254}>PREDICTED SPLICE CHANGES</text>
        {ticks.filter(t => t !== 0).map(t => <line key={`guide-${t}`} className="spl-map__coordinate-guide" x1={x(t)} x2={x(t)} y1={yMid + 88} y2={yBase} />)}
        <line className="spl-map__guide" x1={vx} x2={vx} y1={yMid + 8} y2={yBase} />
      </>}

      {/* SpliceAI lane */}
      {hasLane && (
        <g className="spl-map__lane">
          <line className="spl-map__lane-base" x1={left} x2={right} y1={yBase} y2={yBase} />
          <text className="spl-map__lane-text" x={right} y={254} textAnchor="end" aria-hidden="true">SpliceAI Δ · 0–{scoreMax}</text>
          <line className="spl-map__score-grid" x1={left} x2={right} y1={LANE_TOP} y2={LANE_TOP} />
          <text className="spl-map__lane-text" x={left} y={LANE_TOP - 5} aria-hidden="true">{scoreMax}</text>
          <line className="spl-map__pp3" x1={left} x2={right} y1={scoreY(THRESHOLDS.spliceai.splicingPp3)} y2={scoreY(THRESHOLDS.spliceai.splicingPp3)} />
          <text className="spl-map__lane-text" x={left} y={scoreY(THRESHOLDS.spliceai.splicingPp3) - 4} aria-hidden="true">
            {THRESHOLDS.spliceai.splicingPp3.toFixed(1)} · PP3
          </text>
          <text className="spl-map__lane-text" x={left} y={yBase + 12} aria-hidden="true">0</text>
          {lollipops.map(({ pr, cx, cy, text, labelX, labelY, half, offScale }) => (
            <g key={pr.key} className="spl-map__pred" data-kind={pr.kind} data-pp3={pr.inPp3Band || undefined} data-testid={`map-${pr.key}`} {...pickProps(pr.key, pr.name)}>
              {onSelect && <rect className="spl-map-hit" x={cx - 12} y={cy - 12} width={24} height={24} rx={6} />}
              <title>{`${pr.name}: Δ ${pr.ds}; ${signed(pr.offset)} bp from the variant in transcript direction; ${pr.atSite ? `coincides with an annotated ${pr.atSite} (±1 bp)` : "does not coincide with an annotated site of this type"}${offScale ? "; outside the map view" : ""}`}</title>
              <line x1={cx} x2={cx} y1={yBase} y2={cy} />
              {offScale ? <path className="spl-map__offscale" d={pr.offset < 0 ? `M ${cx + 5} ${cy - 5} L ${cx - 3} ${cy} L ${cx + 5} ${cy + 5}` : `M ${cx - 5} ${cy - 5} L ${cx + 3} ${cy} L ${cx - 5} ${cy + 5}`} /> : <circle cx={cx} cy={cy} r={6} />}
              <rect className="spl-map__label-surface" x={labelX - half} y={labelY - 15} width={half * 2} height={23} rx={5} />
              <text x={labelX} y={labelY} textAnchor="middle" aria-hidden="true">{text}</text>
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
            y={yMid - 17}
            width={Math.max(0, e.x1 - e.x0)}
            height={34}
            rx={5}
          />
        ))}
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
          <text key={`l-${e.number ?? "x"}-${e.x0}`} className="spl-map__region" data-neighbour={e.current ? undefined : true} x={mid + shift} y={yMid + 4} textAnchor="middle" aria-hidden="true">
            {e.number === null ? (short ? "" : "Exon") : short ? e.number : `Exon ${e.number}`}
          </text>
        );
      })}
      {intronLabels.map(l => (
        <text key={l.text + l.x0} className="spl-map__region" data-muted x={(l.x0 + l.x1) / 2} y={yMid - 8} textAnchor="middle" aria-hidden="true">
          {l.text}
        </text>
      ))}

      {/* Site names: the nearest exon's two sites only; neighbours are ticks. */}
      {currentSites.map(s => {
        const sx = x(s.offset + (s.type === "donor" ? 0.5 : -0.5));
        if (sx < left + 20 || sx > right - 20) return null;
        return (
          <text key={s.type} className="spl-map__site-name" x={sx} y={yMid + 36} textAnchor="middle" aria-hidden="true">
            {s.type === "donor" ? "Annotated donor" : "Annotated acceptor"}
          </text>
        );
      })}
      {map.exonNumber === 1 && map.exon.start !== null && x(map.exon.start) >= left + 20 && x(map.exon.start) <= right - 20 && (
        <text className="spl-map__site-name" x={x(map.exon.start)} y={yMid + 36} textAnchor="middle" aria-hidden="true">Transcript start</text>
      )}
      {map.totalExons !== null && map.exonNumber === map.totalExons && map.exon.end !== null && x(map.exon.end) >= left + 20 && x(map.exon.end) <= right - 20 && (
        <text className="spl-map__site-name" x={x(map.exon.end)} y={yMid + 36} textAnchor="middle" aria-hidden="true">Transcript end</text>
      )}

      {/* dbscSNV window */}
      {showDbsc && (
        <g className="spl-map__window">
          <path d={`M ${dbscX0} ${yMid + 50} V ${yMid + 56} H ${dbscX1} V ${yMid + 50}`} />
          <text x={(dbscX0 + dbscX1) / 2} y={yMid + 69} textAnchor="middle" aria-hidden="true">dbscSNV window</text>
        </g>
      )}

      {/* Variant */}
      <g className="spl-map__variant">
        <line x1={vx} x2={vx} y1={yMid - 22} y2={yMid} />
        <circle cx={vx} cy={yMid} r={6} />
        <text x={vx} y={yMid - 27} textAnchor="middle" aria-hidden="true">Variant · {map.junction} {signed(map.position)}</text>
      </g>

      {/* Axis */}
      <g className="spl-map__axis">
        <line x1={left} x2={right} y1={yMid + 88} y2={yMid + 88} />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={yMid + 88} y2={yMid + 93} />
            <text x={x(t)} y={yMid + 106} textAnchor="middle" data-strong={t === 0 || undefined} aria-hidden="true">{t === 0 ? "variant" : signed(t)}</text>
          </g>
        ))}
        <text className="spl-map__caption" x={right} y={yMid + 122} textAnchor="end" aria-hidden="true">bases from the variant · transcript direction →</text>
      </g>

      {/* No-signal row: below-floor channels, drawn off the axis because their Δ has no meaningful position. */}
      {quietRows.length > 0 && (
        <g className="spl-map__quiet" data-testid="map-no-signal-row">
          <text className="spl-map__quiet-head" x={left} y={quietTop} aria-hidden="true">No signal</text>
          <text className="spl-map__quiet-caption" x={left} y={quietTop + 16} aria-hidden="true">Δ &lt; {SPLICE_MAP_FLOOR} · no predicted site, so not placed on the axis</text>
          {quietRows.map((row, ri) =>
            row.map(({ q, cx, label }) => {
              const y = quietItemBase + ri * 36;
              return (
                <g key={q.key} className="spl-map__quiet-item" data-kind={q.kind} data-testid={`map-quiet-${q.key}`} {...pickProps(q.key, q.name)}>
                  <rect className="spl-map__quiet-surface" x={cx - 14} y={y - 15} width={label.length * 6.5 + 42} height={30} rx={6} />
                  {onSelect && <rect className="spl-map-hit" x={cx - 12} y={y - 12} width={24} height={24} rx={6} />}
                  <title>{`${q.name}: Δ ${q.ds}; below the ${SPLICE_MAP_FLOOR} plotting floor, so there is no meaningful delta position to place on the axis.`}</title>
                  <line x1={cx - 9} x2={cx + 9} y1={y} y2={y} />
                  <circle cx={cx} cy={y} r={4} />
                  <text x={cx + 16} y={y + 4} aria-hidden="true">{label}</text>
                </g>
              );
            })
          )}
        </g>
      )}
    </svg>
    </div>
    <PredictedSites map={map} selectedKey={selectedKey} onSelect={onSelect} />
    </div>
  );
}
