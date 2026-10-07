/**
 * Small, dependency-free charts shared by the context tabs. Each is a figure with a text
 * equivalent (the number beside it or a table), uses theme tokens only, and carries no
 * good/bad colour: one accent, with opacity for magnitude.
 */
import React from 'react';
import type { PextRegion } from '../../shared/pext';
import type { ResidueMapping } from '../../shared/residueAlignment';

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
 * The coding exons in transcript order, width proportional to coding length, shade = mean pext.
 * Introns are not drawn. The marker shows where the variant falls; no region means no marker.
 */
export function PextStrip({ regions, activeIndex, position }: { regions: PextRegion[]; activeIndex: number; position: number | null }) {
  const total = regions.reduce((n, r) => n + (r.stop - r.start + 1), 0) || 1;
  const W = 640; const H = 44; const GAP = regions.length > 120 ? 0.5 : 2; const usable = Math.max(W / 2, W - GAP * (regions.length - 1));
  let x = 0; let markerX: number | null = null;
  const boxes = regions.map((r, i) => {
    const w = Math.max(0.5, ((r.stop - r.start + 1) / total) * usable);
    if (i === activeIndex && position !== null) markerX = x + ((position - r.start + 0.5) / (r.stop - r.start + 1)) * w;
    const box = <rect key={`${r.start}-${r.stop}`} x={x} y={14} width={w} height={22} rx={2} fill="currentColor"
      fillOpacity={0.12 + 0.88 * Math.min(1, r.mean ?? 0)} stroke={i === activeIndex ? 'var(--cs-text-primary)' : 'none'} strokeWidth={1.5}>
      <title>{`Coding region ${i + 1} of ${regions.length}: ${r.start.toLocaleString()}–${r.stop.toLocaleString()}, mean pext ${r.mean === null ? 'not reported' : r.mean.toFixed(2)}`}</title></rect>;
    x += w + GAP; return box;
  });
  return <svg className="ctx-pext" viewBox={`0 0 ${W} ${H}`} role="img" preserveAspectRatio="none"
    aria-label={`Mean base-level pext across ${regions.length} coding regions${markerX === null ? '' : '; the variant falls in the outlined region'}`}>
    {boxes}
    {markerX !== null && <path d={`M${markerX - 5} 1 L${markerX + 5} 1 L${markerX} 11 Z`} fill="var(--cs-text-primary)" />}
  </svg>;
}

/** The variant's column in a gapped alignment, with the flank each side. Gaps are drawn as gaps. */
export function AlignmentStrip({ mapping }: { mapping: ResidueMapping }) {
  if (!mapping.window) return null;
  const { human, target, focus } = mapping.window;
  const cells = (seq: string, other: string) => [...seq].map((c, i) => <span key={i} className="ctx-aln__c" data-focus={i === focus || undefined}
    data-gap={c === '-' || undefined} data-diff={(c !== other[i] && i !== focus) || undefined}>{c === '-' ? '–' : c}</span>);
  return <span className="ctx-aln" role="img" aria-label={`Alignment around the variant. Human ${human.replaceAll('-', 'gap ')}; ortholog ${target.replaceAll('-', 'gap ')}.`}>
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
