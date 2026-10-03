/**
 * architectureLayout.ts — pure geometry for the Functional domains schematic.
 *
 * Takes the model's domains, rows and secondary structure and a pixel width, and returns every shape
 * and label with its position. Pure so it can be unit-tested and so the Chromium geometry harness
 * measures exactly what the rules below promise:
 *
 * - One x scale (`x(residue)`) places every mark, box, bar and tick; nothing is hand-offset.
 * - Labels never overlap: each lollipop label takes the lowest free tier in its band (three above,
 *   three below); a label with no free tier is dropped from the drawing and counted in `hiddenLabels`
 *   (the row is still in the table), rather than drawn over another.
 * - The query variant is drawn last and highest, in clay, and its stem runs through the backbone to the
 *   secondary-structure strip so the eye can read what it sits in.
 * - Membrane topology is its own lane at the bottom, above the axis: an "outside" line, an "inside"
 *   line and the transmembrane segments as bars crossing between them, so a membrane protein is not
 *   drawn as a row of look-alike boxes on the backbone. The variant's tick runs through it.
 * - The helix / strand strip is drawn only when the window is narrow enough to read it (<= 300
 *   residues); across a whole large protein it is dashes that say nothing.
 * - Vertical space follows use: the label tiers below the backbone are only as many as were needed.
 * - Text is laid out at real pixel sizes: the SVG is drawn at its container's width, never scaled, so
 *   11px labels stay 11px on a phone.
 */

import type { AnnotationRow, DomainBox, FunctionEvidence } from "../../../shared/functionEvidence";
import type { SecondaryStructureElement } from "../../../shared/contracts";

export interface ArchWindow {
  start: number;
  end: number;
}

export interface ArchLabel {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  size: number;
  mono?: boolean;
  weight?: number;
  tone: "ink" | "secondary" | "muted" | "accent";
}

export interface ArchPin {
  key: string;
  /** The table row this mark belongs to; a disulfide's two marks share one. */
  rowKey: string;
  residue: number;
  x: number;
  stemFrom: number;
  y: number;
  shape: "dot" | "diamond";
  tone: "disease" | "experimental" | "inferred" | "uncited";
  selected: boolean;
  label: ArchLabel | null;
}

export interface ArchBox {
  key: string;
  start: number;
  end: number;
  x: number;
  width: number;
  covers: boolean;
  label: ArchLabel | null;
  ends: ArchLabel[];
  title: string;
}

export interface ArchLayout {
  width: number;
  height: number;
  x0: number;
  x1: number;
  backbone: { y: number; h: number };
  domains: ArchBox[];
  structural: Array<{ key: string; x: number; width: number; y: number }>;
  regions: Array<{ key: string; x: number; width: number; y: number; h: number; selected: boolean; label: ArchLabel | null }>;
  secondary: Array<{ kind: SecondaryStructureElement["kind"]; x: number; width: number; y: number }>;
  pins: ArchPin[];
  query: { x: number; headY: number; stemTo: number; label: ArchLabel } | null;
  ticks: Array<{ x: number; label: string }>;
  axisY: number;
  termini: ArchLabel[];
  hiddenLabels: number;
  /** The membrane-topology lane; null when the entry annotates none in this window. */
  membrane: ArchMembrane | null;
  /** Whether the helix / strand strip is drawn at this window. */
  showSecondary: boolean;
}

export interface ArchMembrane {
  top: number;
  bottom: number;
  outsideY: number;
  insideY: number;
  /** Topological domains as lines on the outside or inside rail. */
  rails: Array<{ key: string; rowKey: string; side: "outside" | "inside"; start: number; end: number; x: number; width: number; y: number }>;
  /** Transmembrane (and intramembrane) segments as bars crossing the lane. */
  bars: Array<{ key: string; rowKey: string; kind: "tm" | "im"; start: number; end: number; x: number; width: number; y: number; h: number; selected: boolean; label: ArchLabel | null }>;
  /** One label per rail name, set where the widest visible stretch of that rail is. */
  labels: ArchLabel[];
  /** The variant's tick, full lane height. */
  queryX: number | null;
}

/** Windows up to this many residues show the helix / strand strip. */
export const SECONDARY_MAX_SPAN = 300;

export interface ArchOverview {
  width: number;
  height: number;
  x0: number;
  x1: number;
  trackY: number;
  domains: Array<{ x: number; width: number; covers: boolean }>;
  membrane: Array<{ x: number; width: number }>;
  queryX: number | null;
  window: { x: number; width: number };
  ends: ArchLabel[];
}

/** The whole protein as a thin strip with the current window bracketed, so a zoomed view keeps its place. */
export function layoutOverview(
  ev: Pick<FunctionEvidence, "length" | "residue" | "domains" | "rows">,
  width: number,
  win: ArchWindow
): ArchOverview {
  const W = Math.max(300, Math.round(width));
  const x0 = 22;
  const x1 = W - 22;
  const len = Math.max(2, ev.length);
  const x = (r: number) => x0 + ((Math.min(Math.max(r, 1), len) - 1) / (len - 1)) * (x1 - x0);
  const trackY = 14;
  return {
    width: W,
    height: 38,
    x0,
    x1,
    trackY,
    domains: ev.domains.flatMap((d) => d.segments.map((s) => ({ x: x(s.start), width: Math.max(2, x(s.end) - x(s.start)), covers: d.covers }))),
    membrane: ev.rows.filter((r) => r.lane === "membrane" && r.type.toLowerCase() !== "topological domain").map((r) => ({ x: x(r.start), width: Math.max(1.5, x(r.end) - x(r.start)) })),
    queryX: Number.isFinite(ev.residue) ? x(ev.residue) : null,
    window: { x: x(win.start), width: Math.max(6, x(win.end) - x(win.start)) },
    ends: [
      { x: x0, y: 35, text: "1", anchor: "start", size: 10, mono: true, tone: "muted" },
      { x: x1, y: 35, text: String(ev.length), anchor: "end", size: 10, mono: true, tone: "muted" },
    ],
  };
}

const CHAR = 0.58; // approximate advance per character, as a fraction of the font size

const textWidth = (text: string, size: number) => text.length * size * CHAR;

function niceStep(span: number, maxTicks: number): number {
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
  return steps.find((s) => span / s <= maxTicks) ?? 10000;
}

function evidenceTone(row: AnnotationRow): ArchPin["tone"] {
  if (row.disease) return "disease";
  if (row.evidence === "experimental" || row.evidence === "structure" || row.evidence === "proteomics") return "experimental";
  if (row.evidence === "none") return "uncited";
  return "inferred";
}

/** First-fit tiering of labels in one band. Returns the tier index, or -1 when every tier is taken. */
function placeTier(tiers: number[][], left: number, right: number, maxTiers: number, gap = 6): number {
  for (let t = 0; t < maxTiers; t++) {
    const row = tiers[t] ?? (tiers[t] = []);
    const free = row.every((_, i) => i % 2 === 1 || right + gap <= row[i] || left - gap >= row[i + 1]);
    if (free) {
      row.push(left, right);
      return t;
    }
  }
  return -1;
}

export function layoutArchitecture(
  ev: Pick<FunctionEvidence, "length" | "residue" | "variantShort" | "domains" | "structuralDomains" | "rows" | "secondaryStructure">,
  width: number,
  win: ArchWindow,
  selectedKey: string | null
): ArchLayout {
  const W = Math.max(300, Math.round(width));
  const x0 = 22;
  const x1 = W - 22;
  const span = Math.max(1, win.end - win.start);
  const inWin = (r: number) => r >= win.start && r <= win.end;
  const x = (r: number) => x0 + ((Math.min(Math.max(r, win.start), win.end) - win.start) / span) * (x1 - x0);

  // Vertical plan, top to bottom.
  const labelTier = 16; // px between label tiers
  const aboveTiers = 3;
  const queryLabelY = 14;
  const queryHeadY = queryLabelY + 14;
  const pinHeadAbove = queryHeadY + 14 + aboveTiers * labelTier; // lowest above-pin head
  const bb = pinHeadAbove + 34; // backbone centre
  const bh = 12;
  const hasStructural = ev.structuralDomains.length > 0;
  const hasSS = ev.secondaryStructure.length > 0 && span <= SECONDARY_MAX_SPAN;
  const g3Y = bb + 21;
  const ssY = bb + (hasStructural ? 31 : 20);
  const belowTop = hasSS ? ssY + 16 : hasStructural ? g3Y + 12 : bb + 24;
  const belowTiers = 3;
  const belowRowY = (t: number) => belowTop + 12 + t * labelTier;

  let hiddenLabels = 0;

  // Domains. A box's label goes in the widest stretch of the box that no region inset, the variant's
  // stem or an end number covers, so nothing is ever drawn through it.
  const regionSpans = ev.rows
    .filter((r) => r.lane === "region" && r.end >= win.start && r.start <= win.end)
    .map((r) => [x(r.start) - 4, Math.max(x(r.start) + 4, x(r.end)) + 4] as [number, number]);
  const queryX = inWin(ev.residue) ? x(ev.residue) : null;
  const domains: ArchBox[] = ev.domains.flatMap((d: DomainBox) =>
    d.segments
      .filter((s) => s.end >= win.start && s.start <= win.end)
      .map((s, i) => {
        const a = x(s.start);
        const b = x(s.end);
        const w = Math.max(3, b - a);
        const name = d.name;
        const src = d.accession ? `${d.source} ${d.accession}` : d.source;
        const showEnds = w > 80 && inWin(s.start) && inWin(s.end);
        // An end number the variant's stem would cross is left off; the range is in the table and the title.
        const crossed = (l: ArchLabel) => {
          if (queryX === null) return false;
          const w = textWidth(l.text, l.size);
          const [lo, hi] = l.anchor === "start" ? [l.x, l.x + w] : [l.x - w, l.x];
          return queryX > lo - 4 && queryX < hi + 4;
        };
        const ends: ArchLabel[] = showEnds
          ? ([
              { x: a + 7, y: bb + 4, text: String(s.start), anchor: "start", size: 10.5, mono: true, tone: "secondary" },
              { x: b - 7, y: bb + 4, text: String(s.end), anchor: "end", size: 10.5, mono: true, tone: "secondary" },
            ] as ArchLabel[]).filter((l) => !crossed(l))
          : [];
        const lo = a + (showEnds ? 14 + textWidth(String(s.start), 10.5) : 6);
        const hi = b - (showEnds ? 14 + textWidth(String(s.end), 10.5) : 6);
        const blocks = [...regionSpans, ...(queryX !== null ? [[queryX - 5, queryX + 5] as [number, number]] : [])]
          .filter(([l, r]) => r > lo && l < hi)
          .sort((p, q) => p[0] - q[0]);
        const free: Array<[number, number]> = [];
        let cursor = lo;
        for (const [l, r] of blocks) {
          if (l > cursor) free.push([cursor, l]);
          cursor = Math.max(cursor, r);
        }
        if (hi > cursor) free.push([cursor, hi]);
        const widest = free.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
        const room = widest ? widest[1] - widest[0] : 0;
        const full = `${name} · ${src}`;
        const text = textWidth(full, 12) + 12 < room ? full : textWidth(name, 12) + 12 < room ? name : null;
        const label: ArchLabel | null = text && widest
          ? { x: (widest[0] + widest[1]) / 2, y: bb + 4, text, anchor: "middle", size: 12, weight: 600, tone: "ink" }
          : null;
        return { key: `${d.key}-${i}`, start: s.start, end: s.end, x: a, width: w, covers: d.covers, label, ends, title: `${name} (${src}), ${s.start}–${s.end}` };
      })
  );

  const structural = ev.structuralDomains.flatMap((d) =>
    d.segments
      .filter((s) => s.end >= win.start && s.start <= win.end)
      .map((s, i) => ({ key: `${d.key}-${i}`, x: x(s.start), width: Math.max(2, x(s.end) - x(s.start)), y: g3Y }))
  );

  const secondary = (hasSS ? ev.secondaryStructure : [])
    .filter((e) => e.kind !== "turn" && e.end >= win.start && e.start <= win.end)
    .map((e) => ({ kind: e.kind, x: x(e.start), width: Math.max(1.5, x(e.end + 1) - x(e.start)), y: ssY }));

  // Regions on the backbone: functional spans, drawn as insets with a label above the backbone.
  const regionRows = ev.rows.filter((r) => r.lane === "region" && r.end >= win.start && r.start <= win.end);
  const aboveTiersUsed: number[][] = [];
  const regions = regionRows.map((r) => {
    const a = x(r.start);
    const w = Math.max(4, x(r.end) - a);
    const text = r.shortLabel;
    const lw = textWidth(text, 11);
    const cx = a + w / 2;
    // Region labels sit just above the backbone in their own row; if two collide the later is dropped.
    const t = placeTier(aboveTiersUsed, cx - lw / 2, cx + lw / 2, 1);
    if (t < 0) hiddenLabels++;
    return {
      key: r.key,
      x: a,
      width: w,
      y: bb - 8,
      h: 16,
      selected: r.key === selectedKey,
      label: t < 0 ? null : ({ x: cx, y: bb - 20, text, anchor: "middle", size: 11, tone: "secondary" } as ArchLabel),
    };
  });

  // Lollipops.
  const pins: ArchPin[] = [];
  const upper: number[][] = [];
  const lower: number[][] = [];
  const qx = inWin(ev.residue) ? x(ev.residue) : null;
  const qText = ev.variantShort;
  // The query stem crosses every upper tier; reserve its column so no label is drawn over it.
  if (qx !== null) for (let t = 0; t < aboveTiers; t++) upper[t] = [qx - 2, qx + 2];

  // A disulfide bond is two marks, one per cysteine; only the first carries the label.
  const points = ev.rows
    .filter((r) => r.lane === "above" || r.lane === "below")
    .flatMap((r) => {
      const at = [{ r, residue: r.start, labelled: true, part: 1 }];
      if (r.isPair && r.end !== r.start) at.push({ r, residue: r.end, labelled: false, part: 2 });
      return at.filter((p) => inWin(p.residue));
    })
    .sort((a, b) => a.residue - b.residue);

  // Pass 1: a tier for every mark. A tier is usable when the mark and its label fit in it AND the
  // mark's stem can pass the shallower tiers without crossing a label already there; the stem then
  // reserves its column in those tiers. Below the backbone labels run to the right, so marks are
  // placed right to left: a mark's stem then sits left of every label already placed. Overflow shares
  // the deepest tier, unlabelled.
  const free = (row: number[] | undefined, l: number, r: number, gap: number) =>
    !row || row.every((_, i) => i % 2 === 1 || r + gap <= row[i] || l - gap >= row[i + 1]);
  // `spans` are the intervals the mark takes in its own tier (head, label), kept apart so a stem may
  // pass in the gap between a neighbour's head and its label.
  const place = (band: number[][], spans: Array<[number, number]>, px: number, maxTiers: number): number => {
    for (let t = 0; t < maxTiers; t++) {
      if (!spans.every(([l, r]) => free(band[t], l, r, 6))) continue;
      let stemClear = true;
      for (let u = 0; u < t; u++) if (!free(band[u], px - 0.5, px + 0.5, 0)) stemClear = false;
      if (!stemClear) continue;
      for (const [l, r] of spans) (band[t] ??= []).push(l, r);
      for (let u = 0; u < t; u++) band[u].push(px - 0.5, px + 0.5);
      return t;
    }
    return -1;
  };
  const order = [...points.filter((p) => p.r.lane === "above"), ...points.filter((p) => p.r.lane === "below").reverse()];
  const placed = order.map((p) => {
    const px = x(p.residue);
    const above = p.r.lane === "above";
    const size = 11;
    const text = p.labelled ? p.r.shortLabel : "";
    const lw = textWidth(text, size);
    let labelled = p.labelled;
    // Below the backbone labels run to the right of their mark; near the right edge of the drawing (a zoomed
    // window ends just after the mark) the label goes to the left instead, rather than off the drawing.
    const flip = !above && labelled && px + 10 + lw > W - 4;
    const t = above
      ? place(upper, [[px - Math.max(6, lw / 2), px + Math.max(6, lw / 2)]], px, aboveTiers)
      : place(lower, labelled ? [[px - 6, px + 6], flip ? [px - 10 - lw, px - 10] : [px + 10, px + 10 + lw]] : [[px - 6, px + 6]], px, belowTiers);
    const tier = t < 0 ? (above ? 0 : belowTiers - 1) : t;
    if (t < 0) labelled = false;
    if (p.labelled && !labelled) hiddenLabels++;
    return { ...p, px, above, size, text, lw, tier, labelled, flip };
  });

  // Pass 2: a label may not be crossed by another mark's stem or sit on another head. In either band a
  // stem from tier j passes every tier below j, so any mark at tier >= t inside the label's span hides it.
  for (const p of placed) {
    if (!p.labelled) continue;
    const [l, r] = p.above ? [p.px - p.lw / 2, p.px + p.lw / 2] : p.flip ? [p.px - 10 - p.lw, p.px - 10] : [p.px + 10, p.px + 10 + p.lw];
    const crossed = placed.some((o) => o !== p && o.above === p.above && o.tier >= p.tier && o.px + 5 > l && o.px - 5 < r);
    if (crossed) {
      p.labelled = false;
      hiddenLabels++;
    }
  }

  for (const p of placed) {
    const headY = p.above ? pinHeadAbove - p.tier * labelTier : belowRowY(p.tier);
    const label: ArchLabel | null = !p.labelled
      ? null
      : p.above
        ? { x: p.px, y: headY - 9, text: p.text, anchor: "middle", size: p.size, mono: true, tone: "secondary" }
        : p.flip
          ? { x: p.px - 10, y: headY + 4, text: p.text, anchor: "end", size: p.size, mono: true, tone: "secondary" }
          : { x: p.px + 10, y: headY + 4, text: p.text, anchor: "start", size: p.size, mono: true, tone: "secondary" };
    pins.push({
      key: p.part === 1 ? p.r.key : `${p.r.key}#${p.part}`,
      rowKey: p.r.key,
      residue: p.residue,
      x: p.px,
      // Over a domain box the stem starts on the box's top edge, not inside it, so it never runs
      // through the box's label.
      stemFrom: p.above ? (domains.some((d) => p.px >= d.x && p.px <= d.x + d.width) ? bb - 15 : bb - bh / 2) : hasSS ? ssY + 8 : hasStructural ? g3Y + 4 : domains.some((d) => p.px >= d.x && p.px <= d.x + d.width) ? bb + 15 : bb + bh / 2,
      y: headY,
      shape: p.above ? "dot" : "diamond",
      tone: evidenceTone(p.r),
      selected: p.r.key === selectedKey,
      label,
    });
  }

  // A region label sits between the backbone and the first tier, where the upper stems run.
  for (const reg of regions) {
    if (!reg.label) continue;
    const half = textWidth(reg.label.text, 11) / 2;
    if (pins.some((p) => p.shape === "dot" && Math.abs(p.x - reg.label!.x) < half + 6) || (qx !== null && Math.abs(qx - reg.label.x) < half + 4)) {
      reg.label = null;
      hiddenLabels++;
    }
  }

  const query =
    qx !== null
      ? {
          x: qx,
          headY: queryHeadY,
          stemTo: hasSS ? ssY + 8 : bb + bh / 2 + 4,
          label: { x: qx, y: queryLabelY, text: qText, anchor: "middle" as const, size: 12.5, mono: true, weight: 600, tone: "accent" as const },
        }
      : null;

  // Vertical extent below the backbone follows what was drawn: only the label tiers used, then the topology
  // lane, then the axis.
  const lowerUsed = placed.filter((p) => !p.above).reduce((n, p) => Math.max(n, p.tier + 1), 0);
  const sitesBottom = lowerUsed ? belowRowY(lowerUsed - 1) + 10 : belowTop - 4;

  const membrane = layoutMembrane(ev, x, win, selectedKey, sitesBottom + 14, qx);
  const axisY = (membrane ? membrane.bottom : sitesBottom) + 18;
  const height = axisY + 22;

  // Axis.
  const step = niceStep(span, Math.max(3, Math.floor((x1 - x0) / 90)));
  const ticks: ArchLayout["ticks"] = [];
  const first = Math.ceil(win.start / step) * step;
  ticks.push({ x: x(win.start), label: String(win.start) });
  for (let t = first; t < win.end; t += step) {
    if (t === win.start) continue;
    if (x(t) - x(win.start) < 30 || x(win.end) - x(t) < 30) continue;
    ticks.push({ x: x(t), label: String(t) });
  }
  ticks.push({ x: x(win.end), label: String(win.end) });

  const termini: ArchLabel[] = [
    ...(win.start === 1 ? [{ x: x0 - 8, y: bb + 4, text: "N", anchor: "end" as const, size: 11, mono: true, tone: "muted" as const }] : []),
    ...(win.end === ev.length ? [{ x: x1 + 8, y: bb + 4, text: "C", anchor: "start" as const, size: 11, mono: true, tone: "muted" as const }] : []),
  ];

  return {
    width: W,
    height,
    x0,
    x1,
    backbone: { y: bb, h: bh },
    domains,
    structural,
    regions,
    secondary,
    pins,
    query,
    ticks,
    axisY,
    termini,
    hiddenLabels,
    membrane,
    showSecondary: hasSS,
  };
}

const MEM = { railLabel: 10.5, tm: 9.5 };

/** Inside rail: UniProt names the cytoplasmic side; every other topological domain is the far side. */
const isInside = (name: string) => /cytoplasm|matrix|stroma/i.test(name);

function layoutMembrane(
  ev: Pick<FunctionEvidence, "rows">,
  x: (r: number) => number,
  win: ArchWindow,
  selectedKey: string | null,
  top: number,
  qx: number | null
): ArchMembrane | null {
  const rows = ev.rows.filter((r) => r.lane === "membrane" && r.end >= win.start && r.start <= win.end);
  if (!rows.length) return null;
  // A window that shows only the inside rail (a cytoplasmic domain, no helix) needs one line, not the full lane.
  const topoRows = rows.filter((q) => q.type.toLowerCase() === "topological domain");
  const hasBars = rows.length > topoRows.length;
  const hasOutside = hasBars || topoRows.some((q) => !isInside(q.name));
  const outsideY = hasOutside ? top + 15 : top + 9;
  const insideY = hasOutside ? outsideY + 22 : outsideY;
  const bottom = insideY + 24;

  const rails: ArchMembrane["rails"] = [];
  const widest = new Map<string, { side: "outside" | "inside"; lo: number; hi: number }>();
  for (const r of rows.filter((q) => q.type.toLowerCase() === "topological domain")) {
    const side = isInside(r.name) ? "inside" : "outside";
    const a = x(Math.max(r.start, win.start));
    const b = x(Math.min(r.end, win.end));
    rails.push({ key: r.key, rowKey: r.key, side, start: r.start, end: r.end, x: a, width: Math.max(2, b - a), y: side === "inside" ? insideY : outsideY });
    const best = widest.get(r.name);
    if (!best || b - a > best.hi - best.lo) widest.set(r.name, { side, lo: a, hi: b });
  }

  const labels: ArchLabel[] = [];
  for (const [name, w] of widest) {
    if (w.hi - w.lo < textWidth(name, MEM.railLabel) + 14) continue;
    labels.push({
      x: (w.lo + w.hi) / 2,
      y: w.side === "inside" ? insideY + 17 : outsideY - 7,
      text: name,
      anchor: "middle",
      size: MEM.railLabel,
      tone: "secondary",
    });
  }

  // One label style per lane: "TM4" only when every helix is wide enough for it, else bare numbers, so a
  // row of bars never mixes the two.
  const tmRows = rows.filter((q) => q.type.toLowerCase() === "transmembrane");
  const widthOf = (r: AnnotationRow) => Math.max(3, x(Math.min(r.end, win.end)) - x(Math.max(r.start, win.start)));
  const prefixed = tmRows.length > 0 && tmRows.every((r) => textWidth(r.shortLabel, MEM.tm) + 4 <= widthOf(r));
  const bars: ArchMembrane["bars"] = rows
    .filter((q) => q.type.toLowerCase() !== "topological domain")
    .map((r) => {
      const a = x(Math.max(r.start, win.start));
      const b = x(Math.min(r.end, win.end));
      const kind = r.type.toLowerCase() === "intramembrane" ? "im" : "tm";
      const w = Math.max(3, b - a);
      const full = r.shortLabel;
      const num = full.replace(/^TM/, "");
      const text = kind === "im" ? null : prefixed ? full : num && textWidth(num, MEM.tm) + 2 <= w ? num : null;
      const h = kind === "im" ? 12 : insideY - outsideY + 4;
      const y = kind === "im" ? (outsideY + insideY) / 2 - 6 : outsideY - 2;
      return {
        key: r.key,
        rowKey: r.key,
        kind,
        start: r.start,
        end: r.end,
        x: a,
        width: w,
        y,
        h,
        selected: r.key === selectedKey,
        label: text ? { x: a + w / 2, y: (outsideY + insideY) / 2 + 3.5, text, anchor: "middle" as const, size: MEM.tm, mono: true, tone: "ink" as const } : null,
      };
    });

  return { top, bottom, outsideY, insideY, rails, bars, labels, queryX: qx };
}
