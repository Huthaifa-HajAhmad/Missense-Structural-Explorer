import React from "react";
import { bandLabel, bandSpans, TOOL_DISPLAY as TOOL_NAME, type LandscapeTool } from "../../shared/landscapeEvidence";
import { useMeasuredWidth } from "../sequence/useMeasuredWidth";

export const STRIP_CHIP_W = 24;
export const STRIP_CHIP_GAP = 4;

export interface StripPlacement {
  alt: string;
  value: number;
  /** Left edge (px) of the chip's true value position, clamped inside the strip. */
  anchorLeft: number;
  /** Left edge (px) the chip is drawn at, after the collision pass. */
  chipLeft: number;
}

/**
 * Chip placement for the strip. The old strip put each letter at its raw value with no collision
 * pass, so on SOD1 residue 5 the S and V chips (0.88, 0.95) drew on top of each other and the strip
 * was unreadable at first sight. Sorted left to right, then: each chip wants to sit centred on its
 * value; a chip never sits closer to its left neighbour than chip+gap; if the run reaches past the
 * right edge the whole run is walked back, and the pass keeps a floor of 0 so nothing is pushed off
 * the left. When even the tight run does not fit, chips spread evenly (the assertion lives in the
 * landscape geometry harness at real widths).
 */
export function placeStripChips(stripWidth: number, chips: Array<{ alt: string; v: number }>): StripPlacement[] {
  const W = Math.max(120, stripWidth);
  const n = chips.length;
  const sorted = [...chips].sort((a, b) => a.v - b.v || a.alt.localeCompare(b.alt));
  const anchorOf = (v: number) => Math.min(Math.max(v * W - STRIP_CHIP_W / 2, 0), W - STRIP_CHIP_W);
  if (n === 0) return [];
  // The tight run does not fit: spread the chips evenly edge to edge. They overlap by the same
  // amount each, and the stems still tie every chip to its true position.
  if (n > 1 && n * STRIP_CHIP_W + (n - 1) * STRIP_CHIP_GAP > W) {
    const step = (W - STRIP_CHIP_W) / (n - 1);
    return sorted.map((c, i) => ({ alt: c.alt, value: c.v, anchorLeft: anchorOf(c.v), chipLeft: i * step }));
  }
  const lefts = sorted.map((c) => anchorOf(c.v));
  for (let i = 1; i < n; i++) lefts[i] = Math.max(lefts[i], lefts[i - 1] + STRIP_CHIP_W + STRIP_CHIP_GAP);
  if (lefts[n - 1] > W - STRIP_CHIP_W) {
    lefts[n - 1] = W - STRIP_CHIP_W;
    for (let i = n - 2; i >= 0; i--) lefts[i] = Math.max(0, Math.min(lefts[i], lefts[i + 1] - STRIP_CHIP_W - STRIP_CHIP_GAP));
  }
  return sorted.map((c, i) => ({ alt: c.alt, value: c.v, anchorLeft: anchorOf(c.v), chipLeft: lefts[i] }));
}

/** A chip the collision pass moved off its true position (and so needs an anchor dot and stem). */
const isMoved = (p: StripPlacement) => Math.abs(p.chipLeft - p.anchorLeft) > 2;

/**
 * Every scored substitution at a residue as a letter chip over the calibrated bands. A chip the
 * collision pass moved is connected to its true position by a stem and an anchor dot, so a letter
 * never reads as sitting on the wrong band. Chips are buttons: picking one selects that
 * substitution on the tab too.
 */
export function SubstitutionStrip({
  tool,
  wt,
  subs,
  highlight,
  target,
  onPick
}: {
  tool: LandscapeTool;
  wt: string;
  subs: Array<{ alt: string; v: number }>;
  highlight: string | null;
  target: string | null;
  onPick: (alt: string) => void;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const placements = React.useMemo(() => placeStripChips(measured || 300, subs), [measured, subs]);
  return (
    <div ref={ref} className="lsr-strip">
      <div className="lsr-strip__bands" aria-hidden="true">
        {bandSpans(tool).map((b) => (
          <span key={b.key} className="ls-band" data-band={b.key} style={{ left: `${b.lo * 100}%`, width: `${(b.hi - b.lo) * 100}%` }} />
        ))}
      </div>
      {placements.map((p) => {
        return isMoved(p) ? <span key={`a-${p.alt}`} className="lsr-strip__anchor" aria-hidden="true" style={{ left: `${p.anchorLeft + STRIP_CHIP_W / 2}px` }} /> : null;
      })}
      {placements.map((p) => {
        const on = p.alt === highlight;
        return (
          <button
            key={p.alt}
            type="button"
            className="lsr-strip__chip"
            data-on={on ? "true" : undefined}
            data-query={p.alt === target ? "true" : undefined}
            aria-current={on ? "true" : undefined}
            style={{ left: `${p.chipLeft + STRIP_CHIP_W / 2}px` }}
            onClick={() => onPick(p.alt)}
            aria-label={`${wt}→${p.alt} ${TOOL_NAME[tool]} ${p.value.toFixed(3)} (${bandLabel(tool, p.value)})`}
            title={`${wt}→${p.alt} ${p.value.toFixed(3)} · ${bandLabel(tool, p.value)}`}
          >
            {p.alt}
          </button>
        );
      })}
      {placements.map((p) => {
        return isMoved(p) ? <span key={`s-${p.alt}`} className="lsr-strip__stem" aria-hidden="true" style={{ left: `${p.chipLeft + STRIP_CHIP_W / 2}px` }} /> : null;
      })}
      <span className="lsr-strip__axis" aria-hidden="true">
        <span>0</span>
        <span>1</span>
      </span>
    </div>
  );
}
