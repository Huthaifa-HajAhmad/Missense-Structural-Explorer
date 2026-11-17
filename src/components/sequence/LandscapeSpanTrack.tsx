import React, { useState } from "react";

export interface LandscapeSpan {
  start: number;
  end: number;
  label: string;
  detail: string;
  tone?: "low" | "measured" | "missing" | "disordered";
}

/** Lay out labels and button targets together so neighbouring intervals stay selectable. */
function layoutSpans(spans: LandscapeSpan[], start: number, end: number, width: number, annotations: boolean) {
  const ends: Array<{ residue: number; pixel: number }> = [];
  const unit = width / Math.max(1, end - start + 1);
  const boxes = spans.filter(s => s.end >= start && s.start <= end)
    .sort((a, b) => a.start - b.start || a.end - b.end).map(span => {
      const left = (Math.max(start, span.start) - start) * unit;
      const size = Math.max(1, (Math.min(end, span.end) - Math.max(start, span.start) + 1) * unit);
      const hitSize = Math.min(width, Math.max(24, size));
      const hitLeft = Math.max(0, Math.min(width - hitSize, left - (hitSize - size) / 2));
      const external = annotations && span.label.length * 7 + 16 > size;
      const labelWidth = Math.max(24, Math.min(width, 240, span.label.length * 7 + 16));
      const labelLeft = Math.max(0, Math.min(width - labelWidth, left + size / 2 - labelWidth / 2));
      const lo = external ? Math.min(hitLeft, labelLeft) : hitLeft;
      const hi = external ? Math.max(hitLeft + hitSize, labelLeft + labelWidth) : hitLeft + hitSize;
      let lane = ends.findIndex(last => last.residue < span.start && last.pixel + (annotations ? 4 : 0) <= lo);
      if (lane < 0) lane = ends.length;
      ends[lane] = { residue: span.end, pixel: hi };
      return { ...span, lane, left, size, hitSize, hitLeft, external, labelWidth, labelLeft };
    });
  const laneHeight = Math.max(32, ...boxes.filter(b => b.external).map(b => 40 + Math.ceil((b.label.length * 7 + 16) / b.labelWidth) * 16));
  return { boxes, laneHeight, height: Math.max(1, ends.length) * laneHeight };
}

export function LandscapeSpanTrack({ spans, start, end, width, onPick, annotationLabels = false }: {
  spans: LandscapeSpan[];
  start: number;
  end: number;
  width: number;
  onPick: (pos: number) => void;
  annotationLabels?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const detail = focused ?? hovered;
  const { boxes, laneHeight, height } = layoutSpans(spans, start, end, width, annotationLabels);
  return <div className="ls-span-track">
    <div className="ls-span-track__axis" style={{ blockSize: height }}>
      {boxes.map((span, i) => <button key={`${span.start}-${span.end}-${i}`} type="button"
        className="ls-span-track__span" data-tone={span.tone}
        style={{ insetInlineStart: span.hitLeft, insetBlockStart: span.lane * laneHeight, inlineSize: span.hitSize }}
        aria-label={span.detail} title={span.detail}
        onFocus={() => setFocused(span.detail)} onBlur={() => setFocused(null)}
        onMouseEnter={() => setHovered(span.detail)} onMouseLeave={() => setHovered(null)}
        onClick={() => onPick(span.start)}>
        <span className="ls-span-track__visual" style={{ insetInlineStart: span.left - span.hitLeft, inlineSize: span.size }}>
          {!span.external && (span.label.length * 7 + 16 <= span.size ? span.label : <span aria-hidden="true">·</span>)}
        </span>
        {span.external && <span className="ls-span-track__label" style={{ insetInlineStart: span.labelLeft - span.hitLeft,
          inlineSize: span.labelWidth, "--ls-label-anchor": `${span.left + span.size / 2 - span.labelLeft}px` } as React.CSSProperties}>{span.label}</span>}
      </button>)}
    </div>
    {detail && boxes.some(span => span.detail === detail) && <p className="ls-span-track__detail">{detail}</p>}
  </div>;
}
