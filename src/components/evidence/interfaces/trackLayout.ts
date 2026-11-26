/**
 * Pure layout for the interface track: axis ticks that keep clear of the variant's label and the end
 * label, runs of equal-support residues, and where each range's name goes (inline when it fits and
 * nothing overlaps it, else a callout row). Also the lane metrics hook the names are measured against.
 */
import { useEffect, useRef, useState } from "react";
import type { TrackLane } from "../../../shared/interfacesEvidence";
import { assignLanes } from "../../../shared/residueContextEvidence";

/**
 * Ticks at round multiples of `step` between `start` and `end`, keeping clear of both edge labels:
 * within 7% of either end a tick would touch it. Multiples of the step, not offsets from `start`:
 * the "Around Gly358" window (298–418) read 298, 347, 397 when ticks were counted from its start.
 */
function niceTicks(start: number, end: number, step: number): number[] {
  const span = end - start;
  const out: number[] = [];
  for (let v = Math.ceil((start + span * 0.07) / step) * step; v <= start + span * 0.93; v += step) out.push(v);
  return out;
}

const TICK_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 5000];

/** Consecutive residues with the same weight as one element, so a 40-residue interface is not 40 nodes. */
export function runs(marks: TrackLane["marks"]): Array<{ start: number; end: number; weight: number; title: string }> {
  const out: Array<{ start: number; end: number; weight: number; title: string }> = [];
  for (const m of [...marks].sort((a, b) => a.residue - b.residue)) {
    const last = out[out.length - 1];
    if (last && m.residue <= last.end + 1 && Math.abs(m.weight - last.weight) < 1e-6) {
      last.end = m.residue;
      last.title = `${last.start}–${m.residue}: ${m.title.split(": ")[1] ?? ""}`;
    } else out.push({ start: m.residue, end: m.residue, weight: m.weight, title: m.title });
  }
  return out;
}

/**
 * The axis ticks, given the sequence length and the variant position (or null).
 *
 * The ruler's label is an opaque chip sitting on the axis row from the ruler line rightwards, so a
 * tick under it is invisible ink, not a tick (RGS9 Cys182 covered "200"). Ticks it would cover are
 * not drawn; and if that leaves fewer than two readable ticks the axis re-reads at the next smaller
 * step, so a long protein's axis never reads emptier than the ruler that crosses it.
 */
export function trackTicks(end: number, position: number | null, labelSpanPct = 6, start = 1): number[] {
  const length = end - start + 1;
  const pct = (v: number) => ((v - start) / Math.max(1, end - start)) * 100;
  const variantPct = position ? pct(position) : null;
  // `labelSpanPct` is the chip's measured width as a share of the axis (ABCG1's "Gly358" chip covered
  // the 400 tick at a fixed 6%, leaving a sliver of its digits beside the label). A tick's own label
  // is centred on it, so half a tick label's width (about 1.5%) is kept clear either side as well.
  const clearOfLabel = (ts: number[]) =>
    ts.filter(t => {
      if (variantPct === null) return true;
      const p = pct(t);
      return p < variantPct - 2 || p > variantPct + labelSpanPct + 2;
    });
  const i = TICK_STEPS.findIndex(s => length / s <= 6);
  const step = i === -1 ? 10000 : TICK_STEPS[i];
  const first = clearOfLabel(niceTicks(start, end, step));
  if (variantPct !== null && first.length < 2 && i > 0) return clearOfLabel(niceTicks(start, end, TICK_STEPS[i - 1]));
  return first;
}

/** Padding either side of an inline name: `.ifc-track__range-name` pads 5px a side. */
const INLINE_NAME_PAD_PX = 10;
/** A callout's own padding and rule: `.ifc-track__callout` pads 5px and draws a 1.5px rule. */
const CALLOUT_PAD_PX = 7;
/** One callout row under a lane: the callout's line height. */
export const CALLOUT_ROW_PX = 15;

const measuredWidths = new Map<string, number>();
/** Bound on the memo: names repeat across lanes and genes, and an unbounded map would grow for a session. */
const MEASURED_WIDTHS_MAX = 500;
/** Pixel width of `text` in `font`. Memoised: a resize re-measures every name, and names repeat across lanes. */
export function measureText(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  const known = measuredWidths.get(key);
  if (known !== undefined) return known;
  const ctx = document.createElement("canvas").getContext("2d");
  // A browser always has a 2D context; the character estimate only keeps a context-less environment deterministic.
  let width = text.length * 6;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  }
  if (measuredWidths.size >= MEASURED_WIDTHS_MAX) measuredWidths.clear();
  measuredWidths.set(key, width);
  return width;
}

export interface NamedRange {
  start: number;
  end: number;
  /** The name drawn inside the range, when it fits. */
  name: string;
  /** The name drawn as a callout under the lane: its residue span and name. */
  calloutText: string;
}

export type RangeNamePlan =
  | { inline: true }
  /** Drawn on the block's own row, in the free space to its right or left: the name stays beside the block it names. */
  | { inline: "beside"; side: "left" | "right" }
  | { inline: false; left: number; row: number };

/** Space between a block and the name drawn beside it, and the name's own side padding. */
const BESIDE_GAP_PX = 4;
const BESIDE_PAD_PX = 4;
/** A block at least this wide keeps a clipped name (full name in its tooltip) rather than a detached callout. */
const CLIPPED_NAME_MIN_PX = 56;

/**
 * A row for each range so no two overlapping ranges share one: greedy interval packing in start order,
 * each range on the first row whose last range ended before it starts. ABCG1's InterPro entries
 * (101–245, 110–300, 274–332 …) drew their boxes on top of one another in a single row.
 */
export function packRows(ranges: ReadonlyArray<{ start: number; end: number }>): number[] {
  const order = ranges.map((r, i) => ({ r, i })).sort((a, b) => a.r.start - b.r.start || b.r.end - a.r.end);
  const rowEnds: number[] = [];
  const rows: number[] = new Array(ranges.length).fill(0);
  for (const { r, i } of order) {
    let row = rowEnds.findIndex(end => end < r.start);
    if (row === -1) row = rowEnds.push(r.end) - 1;
    else rowEnds[row] = r.end;
    rows[i] = row;
  }
  return rows;
}

/**
 * Where each name goes, given the lane's pixel width and a text measure. A name stays inline only when it
 * fits its range with padding. Each callout is anchored at its range's start, pulled left when it would run
 * past the lane's end, and given a row by `assignLanes` with the widest callout as the spacing, so no two
 * callouts in a row overprint. With no width (no layout, a hidden tab, jsdom) nothing can be measured, so
 * no plan is returned: the caller draws the ranges unnamed. Rendering every name as a callout on row 0
 * would overprint them all for the first frame and jump the lane's height.
 *
 * `fitNames` (the stacked domains lane): a name that does not fit inside its block is drawn beside it, on the
 * block's own row, when that space is free of other blocks and names; failing that, a block of at least
 * `CLIPPED_NAME_MIN_PX` keeps a clipped name; only a block narrower than that gets a callout. A callout sits
 * under the lane and has to be matched to its block by eye, which at five stacked blocks it cannot be.
 */
export function planRangeNames(
  ranges: readonly NamedRange[],
  { pct, width, measure, rows, fitNames }: { pct: (v: number) => number; width: number; measure: (text: string) => number; rows?: readonly number[]; fitNames?: boolean }
): RangeNamePlan[] {
  if (width <= 0) return [];
  const plans: RangeNamePlan[] = [];
  const callouts: Array<{ index: number; left: number; span: number }> = [];
  // Overlapping ranges draw their boxes over each other, so neither name may sit inside: ABCG1's InterPro
  // "ABC transporter-like" and "AAA+ ATPase" entries printed one name over the other.
  // Ranges stacked on their own rows (`rows`) never share pixels; on one row, an overlapped range has no room for a name.
  const overlaps = (i: number) => ranges.some((o, j) => j !== i && (rows ? rows[j] === rows[i] : true) && o.start <= ranges[i].end && ranges[i].start <= o.end);
  // Pixel extents taken on each row: every block, then each name placed beside one.
  const px = (v: number) => (pct(v) / 100) * width;
  const taken = ranges.map((r, i) => ({ row: rows?.[i] ?? 0, l: px(r.start), r: Math.max(px(r.end + 1), px(r.start) + 2) }));
  const free = (row: number, a: number, b: number, self: number) => !taken.some((t, k) => k !== self && t.row === row && t.r > a && t.l < b);
  const byStart = ranges.map((_, i) => i).sort((a, b) => ranges[a].start - ranges[b].start || ranges[b].end - ranges[a].end);
  for (const index of byStart) {
    const r = ranges[index];
    const rangePx = ((pct(r.end + 1) - pct(r.start)) / 100) * width;
    if (!overlaps(index) && measure(r.name) + INLINE_NAME_PAD_PX <= rangePx) {
      plans[index] = { inline: true };
      continue;
    }
    if (fitNames && rows) {
      const own = taken[index];
      const label = measure(r.name) + BESIDE_PAD_PX;
      const right = { l: own.r + BESIDE_GAP_PX, r: own.r + BESIDE_GAP_PX + label };
      const left = { l: own.l - BESIDE_GAP_PX - label, r: own.l - BESIDE_GAP_PX };
      const side = right.r <= width && free(own.row, right.l, right.r, index) ? "right" : left.l >= 0 && free(own.row, left.l, left.r, index) ? "left" : null;
      if (side) {
        taken.push({ row: own.row, ...(side === "right" ? right : left) });
        plans[index] = { inline: "beside", side };
        continue;
      }
      if (rangePx >= CLIPPED_NAME_MIN_PX) {
        plans[index] = { inline: true };
        continue;
      }
    }
    // A name wider than the lane cannot be placed: clamp its span so the anchor stays inside the lane and
    // let CSS ellipsise it, instead of pushing it past both edges.
    const span = Math.min(100, ((measure(r.calloutText) + CALLOUT_PAD_PX) / width) * 100);
    callouts.push({ index, left: Math.max(0, Math.min(pct(r.start), 100 - span)), span });
  }
  const byLeft = [...callouts].sort((a, b) => a.left - b.left);
  const calloutRows = assignLanes(byLeft.map(c => c.left), Math.max(0, ...byLeft.map(c => c.span)));
  byLeft.forEach((c, k) => {
    plans[c.index] = { inline: false, left: c.left, row: calloutRows[k] };
  });
  return plans;
}

/**
 * The lane's pixel width and label font, read after layout and again on every resize, so a name that stops
 * fitting becomes a callout rather than overprinting. The font is the lane's own computed font, which is
 * what the names inherit; no layout (jsdom has no ResizeObserver) reads a width of 0.
 */
export function useLaneMetrics() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [font, setFont] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Re-read on every resize: a font-size change (settings, zoom) invalidates every measure, and the font
    // captured once at mount would keep culling names at the old width.
    const readFont = () => {
      const style = getComputedStyle(el);
      const next = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      setFont(prev => (prev === next ? prev : next));
    };
    readFont();
    setWidth(el.getBoundingClientRect().width);
    window.addEventListener("resize", readFont);
    if (typeof ResizeObserver === "undefined") return () => window.removeEventListener("resize", readFont);
    const observer = new ResizeObserver(entries => { setWidth(entries[0].contentRect.width); readFont(); });
    observer.observe(el);
    return () => { window.removeEventListener("resize", readFont); observer.disconnect(); };
  }, []);
  return { ref, width, font };
}
