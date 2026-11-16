import React, { useState } from "react";

export interface LandscapeSpan {
  start: number;
  end: number;
  label: string;
  detail: string;
  tone?: "low" | "measured" | "missing" | "disordered";
}

/** Keep the residue geometry while giving short spans separate, usable button targets. */
export function LandscapeSpanTrack({ spans, start, end, width, onPick }: {
  spans: LandscapeSpan[];
  start: number;
  end: number;
  width: number;
  onPick: (pos: number) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const detail = focused ?? hovered;
  const ends: Array<{ residue: number; pixel: number }> = [];
  const unit = width / Math.max(1, end - start + 1);
  const boxes = spans.filter(s => s.end >= start && s.start <= end)
    .sort((a, b) => a.start - b.start || a.end - b.end).map(span => {
      const left = (Math.max(start, span.start) - start) * unit;
      const size = Math.max(1, (Math.min(end, span.end) - Math.max(start, span.start) + 1) * unit);
      const hitSize = Math.min(width, Math.max(24, size));
      const hitLeft = Math.max(0, Math.min(width - hitSize, left - (hitSize - size) / 2));
      let lane = ends.findIndex(last => last.residue < span.start && last.pixel <= hitLeft);
      if (lane < 0) lane = ends.length;
      ends[lane] = { residue: span.end, pixel: hitLeft + hitSize };
      return { ...span, lane, left, size, hitSize, hitLeft };
    });
  return <div className="ls-span-track">
    <div className="ls-span-track__axis" style={{ blockSize: Math.max(1, ends.length) * 32 }}>
      {boxes.map((span, i) => <button key={`${span.start}-${span.end}-${i}`} type="button"
        className="ls-span-track__span" data-tone={span.tone}
        style={{ insetInlineStart: span.hitLeft, insetBlockStart: span.lane * 32, inlineSize: span.hitSize }}
        aria-label={span.detail} title={span.detail}
        onFocus={() => setFocused(span.detail)} onBlur={() => setFocused(null)}
        onMouseEnter={() => setHovered(span.detail)} onMouseLeave={() => setHovered(null)}
        onClick={() => onPick(span.start)}>
        <span className="ls-span-track__visual" style={{ insetInlineStart: span.left - span.hitLeft, inlineSize: span.size }}>
          {span.label.length * 7 + 16 <= span.size ? span.label : <span aria-hidden="true">·</span>}
        </span>
      </button>)}
    </div>
    {detail && boxes.some(span => span.detail === detail) && <p className="ls-span-track__detail">{detail}</p>}
  </div>;
}
