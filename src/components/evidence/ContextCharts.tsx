/**
 * Small, dependency-free charts shared by the context tabs. Each is a figure with a text
 * equivalent (the number beside it or a table), uses theme tokens only, and carries no
 * good/bad colour: one accent, with opacity for magnitude.
 */
import React, { useLayoutEffect, useRef } from 'react';
import type { PextRegion } from '../../shared/pext';
import type { ResidueMapping } from '../../shared/residueAlignment';

/** The alignment's own gap character, as in residueAlignment. */
const GAP = '-';

/** Linear bar scaled to `max`. A measured zero draws a tick, never an empty gap. */
export function MeasureBar({ value, max, label }: { value: number | null; max: number; label: string }) {
  if (value === null) return <span className="ctx-bar ctx-bar--none" aria-hidden="true" />;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className="ctx-bar" role="img" aria-label={label}>
    <span className="ctx-bar__fill" style={{ width: value === 0 ? '2px' : `${Math.max(pct, 1.5)}%` }} data-zero={value === 0 || undefined} />
  </span>;
}
export const maxOf = (values: Array<number | null>) => Math.max(0, ...values.map(v => v ?? 0));

/**
 * The coding regions in returned order, width proportional to coding length, shade = mean pext.
 * Introns are not drawn. The marker shows where the variant falls; no region means no marker.
 */
export function PextStrip({ regions, activeIndex, position }: { regions: PextRegion[]; activeIndex: number; position: number | null }) {
  const total = regions.reduce((n, r) => n + (r.stop - r.start + 1), 0) || 1;
  const W = 900; const H = 104; const GAP = regions.length > 120 ? 0.5 : 3; const usable = Math.max(W / 2, W - GAP * (regions.length - 1));
  let x = 0;
  const layout = regions.map(region => {
    const width = Math.max(0.5, ((region.stop - region.start + 1) / total) * usable);
    const item = { region, x, width };
    x += width + GAP;
    return item;
  });
  const active = layout[activeIndex];
  const markerX = active && position !== null
    ? active.x + ((position - active.region.start + 0.5) / (active.region.stop - active.region.start + 1)) * active.width : null;
  // Reserve room for the active region's number, then fit other numbers without overlap.
  // The full values table retains every region, even when a dense map cannot label them all.
  const labels = layout.map((item, i) => {
    const halfWidth = String(i + 1).length * 4 + 3;
    const center = Math.max(halfWidth, Math.min(W - halfWidth, item.x + item.width / 2));
    return { center, start: center - halfWidth, end: center + halfWidth };
  });
  const activeLabel = labels[activeIndex];
  let previousLabelEnd = -Infinity;
  const boxes = layout.map(({ region: r, x, width: w }, i) => {
    const label = labels[i];
    const showLabel = i === activeIndex || (label.start >= previousLabelEnd + 4
      && (!activeLabel || label.end + 4 <= activeLabel.start || label.start >= activeLabel.end + 4));
    if (showLabel) previousLabelEnd = label.end;
    return <g key={`${r.start}-${r.stop}`}>
      <rect x={x} y={42} width={w} height={30} rx={3} fill={r.mean === null ? 'var(--cs-surface-2)' : 'currentColor'}
        fillOpacity={r.mean === null ? 1 : 0.12 + 0.88 * Math.min(1, r.mean)} stroke={i === activeIndex ? 'var(--cs-text-primary)' : r.mean === null ? 'var(--cs-text-secondary)' : 'none'} strokeDasharray={r.mean === null ? '3 2' : undefined} strokeWidth={2}>
        <title>{`Coding region ${i + 1} of ${regions.length}: ${r.start.toLocaleString()} to ${r.stop.toLocaleString()}, mean pext ${r.mean === null ? 'not reported' : String(r.mean)}`}</title>
      </rect>
      {showLabel && <text data-region-label={i + 1} x={label.center} y={94} textAnchor="middle" fill="var(--cs-text-secondary)" fontSize={13}>{i + 1}</text>}
    </g>;
  });
  // The map is 900px wide. On a narrower screen it scrolls, so start with the variant's region in view instead of at the left edge.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current && markerX !== null) scroller.current.scrollLeft = Math.max(0, markerX - scroller.current.clientWidth / 2);
  }, [markerX]);
  return <div ref={scroller} className="xp-pext-scroll" tabIndex={0} role="region" aria-label="Coding region map">
    <svg className="ctx-pext xp-pext-map" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Mean base-level pext across ${regions.length} coding regions${markerX === null ? '' : `; the variant falls in outlined region ${activeIndex + 1}`}`}>
      {boxes}
      {markerX !== null && <g fill="var(--cs-text-primary)">
        <text x={Math.max(65, Math.min(W - 65, markerX))} y={17} textAnchor="middle" fontSize={14} fontWeight={600}>Variant · region {activeIndex + 1}</text>
        <path d={`M${markerX} 23 V35 M${markerX - 5} 31 L${markerX} 38 L${markerX + 5} 31`} fill="none" stroke="var(--cs-text-primary)" strokeWidth={2} />
      </g>}
    </svg>
  </div>;
}

/** The variant's column in a gapped alignment, with the flank each side. Gaps are drawn as gaps. */
export function AlignmentStrip({ mapping }: { mapping: ResidueMapping }) {
  if (!mapping.window) return null;
  const { human, target, focus } = mapping.window;
  // `data-focus` styles the column; this sentence carries it to a screen reader as well.
  const at = (seq: string) => (seq[focus] === GAP ? 'a gap' : seq[focus]);
  const cells = (seq: string, other: string) => [...seq].map((c, i) => <span key={i} className="ctx-aln__c" data-focus={i === focus || undefined}
    data-gap={c === '-' || undefined} data-diff={(c !== other[i] && i !== focus) || undefined}>{c === '-' ? '–' : c}</span>);
  return <span className="ctx-aln" role="img" aria-label={`Alignment around the variant. Human ${human.replaceAll('-', 'gap ')}; ortholog ${target.replaceAll('-', 'gap ')}. The variant residue is column ${focus + 1}: ${at(human)} in human, ${at(target)} in the ortholog.`}>
    <span className="ctx-aln__row">{cells(human, target)}</span>
    <span className="ctx-aln__row">{cells(target, human)}</span>
  </span>;
}

/**
 * One value placed on a fixed ordinal scale. The filled rung is the source's own category; there is
 * no gradient and no good/bad colour. The text label is always shown beside it by the caller.
 */
export function OrdinalScale({ levels, index, label, quiet = false }: { levels: readonly string[]; index: number | null; label: string; quiet?: boolean }) {
  return <span className="ctx-scale" role="img" aria-label={index === null ? `${label}: not on this scale` : `${label}: ${levels[index]}, rung ${index + 1} of ${levels.length}`}>
    {levels.map((level, i) => <span key={level} className="ctx-scale__rung" data-on={i === index || undefined} data-quiet={(quiet && i === index) || undefined} data-below={(index !== null && i < index) || undefined} title={level} />)}
  </span>;
}
