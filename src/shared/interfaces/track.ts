/**
 * The sequence map: topology, domains and regions, mapped sites, each solved partner's interface as a
 * support profile, fibrils last, the model when built.
 *
 * A solved lane also carries the stretches no structure of the pair models (`gaps`), so "no
 * coordinates" is drawn differently from "modelled, no contact": ABCG1's 348–396 linker looked like
 * an empty stretch of a measured interface (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, M1).
 */
import type { PpiInteractionSite } from "../contracts.ts";
import { drawnDomains } from "../functionEvidence.ts";
import { lower1, plural, rangeText } from "./format.ts";
import type { ModelView, ObservedView, TrackLane } from "./types.ts";

type Feature = { type: string; description?: string; start: number; end: number };
type NamedRange = { start: number; end: number; kind: "domain" | "region"; name: string };

interface TrackInput {
  features: any;
  position: number | null;
  sequenceLength: number | null;
  resLabel: string;
  sites: PpiInteractionSite[];
  native: ObservedView[];
  fibrils: ObservedView[];
  model: ModelView;
  residueName: (r: number) => string;
}

const covers = (r: { start: number; end: number }, p: number | null) => p !== null && r.start <= p && p <= r.end;

function topologyLane(feats: Feature[], position: number | null, resLabel: string): TrackLane | null {
  const topo = feats.filter(f => (f.type === "Transmembrane" || f.type === "Intramembrane" || f.type === "Topological domain") && f.start > 0 && f.end >= f.start);
  if (!topo.length) return null;
  const tm = topo.filter(f => f.type !== "Topological domain").length;
  const where = topo.find(f => covers(f, position));
  const sideOf = (f: Feature) => (/cytoplasm/i.test(f.description ?? "") ? "cytoplasmic" : /extracell|lumen/i.test(f.description ?? "") ? "outside" : "other");
  return {
    key: "topology", kind: "topology", label: "Membrane topology", sub: tm ? plural(tm, "membrane segment") : "UniProt",
    ranges: topo.map(f => ({ start: f.start, end: f.end, kind: f.type === "Topological domain" ? sideOf(f) : "membrane", name: f.type === "Topological domain" ? f.description || "Topological domain" : f.type, hit: covers(f, position) })),
    marks: [], gaps: [], hit: false, readout: null, rowKey: null,
    summary: `${plural(tm, "membrane segment")}; ${resLabel} is ${where ? (where.type === "Topological domain" ? `in the ${lower1(where.description || "topological domain")} part` : "in a membrane segment") : "outside annotated topology"}`,
  };
}

/**
 * Domains are the Functional domains map's own (drawnDomains: InterPro when it answered, else UniProt),
 * so the two tabs cannot draw different domains; regions are UniProt's named Regions, Repeats and Zinc
 * fingers. A Region that IS a mapped binding site is drawn once, in the sites lane.
 */
export function namedRanges(features: any, feats: Feature[], sites: PpiInteractionSite[], position: number | null, sequenceLength: number | null): { named: NamedRange[]; source: string; hasRegions: boolean } {
  const isSite = (f: Feature) => sites.some(x => x.start === f.start && x.end === f.end && x.description.trim().toLowerCase() === (f.description ?? "").trim().toLowerCase());
  const domainBoxes = drawnDomains(features, position ?? 0, sequenceLength ?? Math.max(position ?? 1, ...feats.map(f => f.end)));
  const regions = feats.filter(f => (f.type === "Region" || f.type === "Repeat" || f.type === "Zinc finger") && f.start > 0 && f.end >= f.start && !/disordered/i.test(f.description ?? "") && !isSite(f));
  const named: NamedRange[] = [
    ...domainBoxes.flatMap(b => b.segments.map(seg => ({ start: seg.start, end: seg.end, kind: "domain" as const, name: b.name }))),
    ...regions.map(f => ({ start: f.start, end: f.end, kind: f.type === "Region" ? ("region" as const) : ("domain" as const), name: f.description || f.type })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  return { named, source: domainBoxes.some(b => b.source !== "UniProtKB") ? "InterPro" : "UniProt", hasRegions: regions.length > 0 };
}

function solvedLane(o: ObservedView, resLabel: string, residueName: (r: number) => string): TrackLane {
  const fib = o.context === "fibril";
  const where = fib ? "amyloid fibril structure" : "solved structure";
  const notModelled = o.n === 0 && o.total > 0;
  return {
    key: o.key, kind: "solved", label: o.label,
    sub: fib ? plural(o.total, "fibril structure") : plural(o.total, "solved structure"),
    ranges: [],
    // Height is support among the pair's structures that hold the residue's interface at all.
    marks: o.residues.map((r, i) => ({ residue: r, weight: o.total ? Math.min(1, o.support[i] / o.total) : 1, title: `${residueName(r)}: ${o.support[i]} of ${plural(o.total, where)}` })),
    gaps: o.unmodelled ?? [],
    hit: o.variantAtInterface,
    readout: { k: o.k, n: o.n, total: o.total },
    rowKey: o.key,
    summary: `${o.label}: ${plural(o.residues.length, "interface residue")}; ${o.variantAtInterface ? `${resLabel} at the interface in ${o.k} of ${plural(o.n, where)}` : notModelled ? `${resLabel} not modelled in any of them` : `${resLabel} not at this interface`}`,
  };
}

export function buildTrack(t: TrackInput): TrackLane[] {
  const feats: Feature[] = t.features?.features ?? [];
  const track: TrackLane[] = [];
  const topology = topologyLane(feats, t.position, t.resLabel);
  if (topology) track.push(topology);
  const { named, source, hasRegions } = namedRanges(t.features, feats, t.sites, t.position, t.sequenceLength);
  if (named.length) {
    track.push({
      key: "domains", kind: "domains", label: "Domains & regions", sub: hasRegions && source === "InterPro" ? "InterPro and UniProt" : source,
      ranges: named.map(r => ({ ...r, hit: covers(r, t.position) })),
      marks: [], gaps: [], hit: false, readout: null, rowKey: null,
      summary: named.map(r => `${r.name} ${rangeText(r)}`).join("; "),
    });
  }
  if (t.sites.length) {
    const inSite = t.sites.some(s => s.containsVariant);
    track.push({
      key: "sites", kind: "sites", label: "Mapped binding sites", sub: `UniProt, ${plural(t.sites.length, "site")}`,
      ranges: t.sites.map(s => ({ start: s.start, end: s.end, kind: "site", name: `${s.type} ${rangeText(s)} · ${s.description}`, hit: s.containsVariant })),
      marks: [], gaps: [], hit: inSite, readout: null, rowKey: null,
      summary: `${t.sites.map(s => `${rangeText(s)} ${s.description}`).join("; ")}; ${inSite ? "includes" : "does not include"} ${t.resLabel}`,
    });
  }
  // Native interfaces (homomer first, then by structures), then fibrils last: a different kind of contact.
  const ordered = [...t.native].sort((a, b) => Number(b.homomeric) - Number(a.homomeric) || b.total - a.total);
  for (const o of [...ordered.slice(0, 6), ...t.fibrils]) track.push(solvedLane(o, t.resLabel, t.residueName));
  if (t.model.state === "built") {
    const fp = t.model.footprint;
    track.push({
      key: "predicted", kind: "predicted", label: "Predicted complex", sub: `Boltz-2, chain A, ${plural(fp.length, "residue")}`,
      ranges: [], marks: fp.map(r => ({ residue: r, weight: 1, title: `${r}: contact in the model` })), gaps: [],
      hit: t.model.variantContacts.length > 0, readout: null, rowKey: null,
      summary: `Predicted interface: ${plural(fp.length, "residue")}; ${t.model.variantContacts.length ? "includes" : "does not include"} ${t.resLabel}`,
    });
  }
  return track;
}

/**
 * Where the residue sits, for orientation: its membrane side and the annotated domains around it.
 * "Gly358 lies in the cytoplasmic part, between ABC transporter (77–317) and ABC transmembrane
 * type-2 (415–673)." Null when the residue is inside a domain or nothing is annotated.
 */
export function locationSentence(track: TrackLane[], position: number | null, resLabel: string): string | null {
  if (position === null) return null;
  const domains = track.find(l => l.kind === "domains")?.ranges.filter(r => r.kind === "domain") ?? [];
  if (!domains.length || domains.some(r => covers(r, position))) return null;
  const before = domains.filter(r => r.end < position).sort((a, b) => b.end - a.end)[0];
  const after = domains.filter(r => r.start > position).sort((a, b) => a.start - b.start)[0];
  const side = track.find(l => l.kind === "topology")?.ranges.find(r => covers(r, position));
  const part = side && side.kind !== "membrane" && side.kind !== "other" ? `in the ${side.kind === "outside" ? lower1(side.name) : "cytoplasmic"} part, ` : "";
  const named = (r: { name: string; start: number; end: number }) => `${r.name} (${rangeText(r)})`;
  if (before && after) return `${resLabel} lies ${part}between ${named(before)} and ${named(after)}.`;
  if (before) return `${resLabel} lies ${part}after ${named(before)}, outside any annotated domain.`;
  if (after) return `${resLabel} lies ${part}before ${named(after)}, outside any annotated domain.`;
  return null;
}
