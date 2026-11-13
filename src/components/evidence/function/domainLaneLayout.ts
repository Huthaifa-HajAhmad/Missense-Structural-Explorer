/**
 * domainLaneLayout.ts — where the domain boxes of the protein map go.
 *
 * One box per domain unit (see `shared/domainUnits.ts`), never one per database: the databases that
 * model a unit are listed in its title and in the inspector. The box is drawn in two tones. The solid
 * core is where every database agrees; the pale ends are where only some extend.
 *
 * - Lanes are packed in residue space over every unit, so a lane number never changes with the zoom.
 *   Units that share no residue share a lane; GZF1's BTB domain and ten zinc fingers fit on one.
 * - A unit cut by the window edge keeps a square end on that side, so it does not look like the
 *   domain ends there.
 * - A label goes in the widest free stretch of the box. A long name falls back to the unit's number
 *   ("10"), then to nothing. When any unit of an entry lost its name, one entry label ("Zinc finger
 *   C2H2-type ×10") sits over the entry's units in that lane, away from the variant's stem.
 */

import type { DomainUnit } from "../../../shared/domainUnits";
import { sourceList } from "../../../shared/domainUnits";
import type { ArchLabel, ArchWindow } from "./architectureLayout";

export const BOX_H = 30;
export const LANE_PITCH = 42;

export interface ArchBox {
  key: string;
  rowKey: string;
  /** Every table row this box stands for; a hover or selection on any of them lights the box. */
  memberKeys: string[];
  y: number;
  lane: number;
  selected: boolean;
  start: number;
  end: number;
  x: number;
  width: number;
  /** The stretch every database agrees on, in px; null when it is the whole box. */
  core: { x: number; width: number } | null;
  /** True on a side the window cuts. */
  clip: { left: boolean; right: boolean };
  covers: boolean;
  label: ArchLabel | null;
  ends: ArchLabel[];
  title: string;
}

const CHAR = 0.58;
const textWidth = (text: string, size: number) => text.length * size * CHAR;

/** Residue-space lane packing over every unit, so the assignment is the same in every window. */
export function domainLanes(units: DomainUnit[]): { lanes: Map<string, number>; count: number } {
  const lanes = new Map<string, number>();
  const ends: number[] = [];
  for (const u of [...units].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key))) {
    let lane = ends.findIndex((end) => end < u.start);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = u.end;
    lanes.set(u.key, lane);
  }
  return { lanes, count: ends.length };
}

/** The widest stretch of [lo, hi] that no block covers. */
function widestFree(lo: number, hi: number, blocks: Array<[number, number]>): [number, number] | null {
  const free: Array<[number, number]> = [];
  let cursor = lo;
  for (const [l, r] of blocks.filter(([l, r]) => r > lo && l < hi).sort((p, q) => p[0] - q[0])) {
    if (l > cursor) free.push([cursor, l]);
    cursor = Math.max(cursor, r);
  }
  if (hi > cursor) free.push([cursor, hi]);
  return free.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0] ?? null;
}

interface LaneContext {
  units: DomainUnit[];
  win: ArchWindow;
  x: (r: number) => number;
  bb: number;
  queryX: number | null;
  /** Spans in lane 0 a label must not cross (region insets). */
  regionSpans: Array<[number, number]>;
  selectedKey: string | null;
}

export function layoutDomainBoxes(ctx: LaneContext): { boxes: ArchBox[]; laneCount: number; entryLabels: ArchLabel[] } {
  const { units, win, x, bb, queryX, selectedKey } = ctx;
  const { lanes, count } = domainLanes(units);
  const inWin = (r: number) => r >= win.start && r <= win.end;
  const visible = units.filter((u) => u.end >= win.start && u.start <= win.end);
  const boxes = visible.map((u) => {
    const lane = lanes.get(u.key) ?? 0;
    const centreY = bb + lane * LANE_PITCH;
    const a = x(u.start);
    const b = x(u.end);
    const w = Math.max(3, b - a);
    const showEnds = w > 80 && inWin(u.start) && inWin(u.end);
    const crossed = (l: ArchLabel) => {
      if (queryX === null) return false;
      const lw = textWidth(l.text, l.size);
      const [lo, hi] = l.anchor === "start" ? [l.x, l.x + lw] : [l.x - lw, l.x];
      return queryX > lo - 4 && queryX < hi + 4;
    };
    const ends = showEnds
      ? ([
          { x: a + 7, y: centreY + 4, text: String(u.start), anchor: "start", size: 10.5, mono: true, tone: "secondary" },
          { x: b - 7, y: centreY + 4, text: String(u.end), anchor: "end", size: 10.5, mono: true, tone: "secondary" },
        ] as ArchLabel[]).filter((l) => !crossed(l))
      : [];
    const lo = a + (showEnds ? 14 + textWidth(String(u.start), 10.5) : 4);
    const hi = b - (showEnds ? 14 + textWidth(String(u.end), 10.5) : 4);
    const blocks = [...(lane === 0 ? ctx.regionSpans : []), ...(queryX !== null ? [[queryX - 5, queryX + 5] as [number, number]] : [])];
    const room = widestFree(lo, hi, blocks);
    const roomW = room ? room[1] - room[0] : 0;
    const number = u.ofEntry > 1 ? String(u.index) : null;
    const text = textWidth(u.name, 12) + 10 < roomW ? u.name : number && textWidth(number, 11) + 6 < roomW ? number : null;
    const label: ArchLabel | null =
      text && room
        ? { x: (room[0] + room[1]) / 2, y: centreY + 4, text, anchor: "middle", size: text === u.name ? 12 : 11, weight: 600, tone: "ink", mono: text !== u.name }
        : null;
    const coreA = x(u.core.start);
    const coreB = x(u.core.end);
    const core = u.core.start === u.start && u.core.end === u.end ? null : { x: coreA, width: Math.max(2, coreB - coreA) };
    const agreement = u.sources.length > 1
      ? u.core.start === u.start && u.core.end === u.end
        ? "databases agree on the bounds"
        : `all agree on ${u.core.start}–${u.core.end}`
      : "";
    return {
      key: u.key,
      rowKey: u.rowKey,
      memberKeys: u.memberKeys,
      y: centreY - BOX_H / 2,
      lane,
      selected: !!selectedKey && u.memberKeys.includes(selectedKey),
      start: u.start,
      end: u.end,
      x: a,
      width: w,
      core,
      clip: { left: u.start < win.start, right: u.end > win.end },
      covers: u.covers,
      label,
      ends,
      title: `${u.name}, ${u.start}–${u.end} · ${sourceList(u)}${agreement ? ` (${agreement})` : ""}`,
    } satisfies ArchBox;
  });

  // One label per entry and lane over its units, when the boxes could not carry their names.
  const entryLabels: ArchLabel[] = [];
  const groups = new Map<string, ArchBox[]>();
  for (const box of boxes) {
    const u = visible.find((v) => v.key === box.key)!;
    if (u.ofEntry < 2) continue;
    const k = `${u.entryKey}|${box.lane}`;
    groups.set(k, [...(groups.get(k) ?? []), box]);
  }
  for (const [k, group] of groups) {
    if (group.length < 2 || group.every((g) => g.label && !g.label.mono)) continue;
    const u = units.find((v) => `${v.entryKey}|${lanes.get(v.key)}` === k)!;
    const lo = Math.min(...group.map((g) => g.x));
    const hi = Math.max(...group.map((g) => g.x + g.width));
    const spot = widestFree(lo, hi, queryX !== null ? [[queryX - 6, queryX + 6]] : []);
    if (!spot) continue;
    const full = `${u.entryName} ×${u.ofEntry}`;
    const text = [full, u.entryName].find((t) => textWidth(t, 11) + 8 < spot[1] - spot[0]);
    if (!text) continue;
    entryLabels.push({ x: (spot[0] + spot[1]) / 2, y: group[0].y - 6, text, anchor: "middle", size: 11, tone: "secondary" });
  }
  return { boxes, laneCount: count, entryLabels };
}
