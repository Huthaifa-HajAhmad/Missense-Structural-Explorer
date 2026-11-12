/**
 * domainUnits.ts — one box per domain, however many databases model it.
 *
 * InterPro groups the signatures of several member databases (Pfam, SMART, PROSITE profiles) that model
 * the same domain under one entry. Drawn one row per signature, GZF1's ten C2H2 zinc fingers became
 * forty look-alike boxes on four rows, which read as forty pieces of evidence and buried the variant.
 * A unit is the set of locations of ONE InterPro entry that cover mostly the same residues. It keeps
 * every database that reported it, and the stretch all of them agree on.
 *
 * INVARIANTS
 * - Only locations of the same InterPro entry merge, and only when they overlap by at least half of
 *   the longer one. Two different entries that overlap stay two units (two rows on the map).
 * - A match with no InterPro entry is its own entry; one signature's separate locations stay separate
 *   units (ten zinc fingers from one Pfam model are ten units). UniProt's own boxes (used when InterPro
 *   has none) group by their name without the number: "CBS 1" and "CBS 2" are two units of "CBS".
 * - A UniProt Domain, Zinc finger or Repeat feature over the same residues (same half-overlap test)
 *   names the unit ("C2H2-type 10") and is the table row the unit selects. Without one, the unit
 *   selects its first database match.
 */

import type { DomainBox } from "./functionEvidence.ts";

export interface DomainUnitSource {
  source: string;
  accession: string;
  /** The table row of this database match. */
  rowKey: string;
  start: number;
  end: number;
}

export interface DomainUnit {
  key: string;
  /** InterPro entry id, or the match key when the match has no entry. */
  entryKey: string;
  entryName: string;
  /** UniProt's own name for this unit when it has one, else the entry name. */
  name: string;
  /** The table row a click selects. */
  rowKey: string;
  /** Every table row that stands for this unit: the curated row and each database match. */
  memberKeys: string[];
  sources: DomainUnitSource[];
  /** Union of the member locations. */
  start: number;
  end: number;
  /** The residues every member places in the domain. Equal to start–end when there is one member. */
  core: { start: number; end: number };
  covers: boolean;
  /** 1-based position among the units of its entry, and how many the entry has. */
  index: number;
  ofEntry: number;
  url: string | null;
}

/** A UniProt feature that can name a unit. */
export interface CuratedSpan {
  key: string;
  name: string;
  start: number;
  end: number;
}

const DB_ORDER = ["Pfam", "SMART", "PROSITE", "PROSITE profiles", "ProfileScan", "UniProtKB"];
const dbRank = (s: string) => {
  const i = DB_ORDER.indexOf(s);
  return i < 0 ? DB_ORDER.length : i;
};

/** True when two spans share at least half of the longer one. */
export function overlapsMostly(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const shared = Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1;
  return shared > 0 && shared * 2 >= Math.max(a.end - a.start + 1, b.end - b.start + 1);
}

/** "Pfam", "Pfam and SMART", "Pfam, PROSITE and SMART". */
export function sourceList(u: Pick<DomainUnit, "sources">): string {
  const names = Array.from(new Set(u.sources.map((s) => s.source)));
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface Cluster {
  boxes: Set<string>;
  sources: DomainUnitSource[];
}

function clusterEntry(members: DomainBox[]): Cluster[] {
  const locs = members
    .flatMap((b) => b.segments.map((s) => ({ b, s })))
    .sort((p, q) => p.s.start - q.s.start || p.s.end - q.s.end || dbRank(p.b.source) - dbRank(q.b.source));
  const clusters: Cluster[] = [];
  for (const { b, s } of locs) {
    // A signature never joins a unit twice: its own separate locations are separate units.
    const home = clusters.find((c) => !c.boxes.has(b.key) && c.sources.some((m) => overlapsMostly(m, s)));
    const src = { source: b.source, accession: b.accession, rowKey: `match-${b.key}`, start: s.start, end: s.end };
    if (home) {
      home.boxes.add(b.key);
      home.sources.push(src);
    } else clusters.push({ boxes: new Set([b.key]), sources: [src] });
  }
  return clusters;
}

/** "C2H2-type 3" → "C2H2-type": the family a numbered UniProt feature belongs to. */
const familyOf = (name: string) => name.replace(/\s+\d+$/, "");
const entryOf = (b: DomainBox) => b.interpro?.id ?? (b.source === "UniProtKB" ? `UniProtKB:${familyOf(b.name)}` : b.key);

export function buildDomainUnits(boxes: DomainBox[], curated: CuratedSpan[], residue: number): DomainUnit[] {
  const byEntry = new Map<string, DomainBox[]>();
  for (const b of boxes) {
    const k = entryOf(b);
    byEntry.set(k, [...(byEntry.get(k) ?? []), b]);
  }
  const used = new Set<string>();
  const units: DomainUnit[] = [];
  for (const [entryKey, members] of byEntry) {
    const entryName = members[0].interpro?.name ?? (members[0].source === "UniProtKB" ? familyOf(members[0].name) : members[0].name);
    const clusters = clusterEntry(members).sort((a, b) => a.sources[0].start - b.sources[0].start);
    clusters.forEach((c, i) => {
      const sources = [...c.sources].sort((a, b) => dbRank(a.source) - dbRank(b.source) || a.accession.localeCompare(b.accession));
      const start = Math.min(...sources.map((s) => s.start));
      const end = Math.max(...sources.map((s) => s.end));
      const coreStart = Math.max(...sources.map((s) => s.start));
      const coreEnd = Math.min(...sources.map((s) => s.end));
      const span = { start, end };
      const named = curated
        .filter((f) => !used.has(f.key) && overlapsMostly(f, span))
        .sort((a, b) => Math.abs(a.start - start) + Math.abs(a.end - end) - (Math.abs(b.start - start) + Math.abs(b.end - end)))[0];
      if (named) used.add(named.key);
      const matchKeys = sources.map((s) => s.rowKey);
      units.push({
        key: `${entryKey}:${start}-${end}`,
        entryKey,
        entryName,
        name: named?.name ?? entryName,
        rowKey: named?.key ?? matchKeys[0],
        memberKeys: Array.from(new Set([...(named ? [named.key] : []), ...matchKeys])),
        sources,
        start,
        end,
        core: coreStart <= coreEnd ? { start: coreStart, end: coreEnd } : span,
        covers: Number.isFinite(residue) && residue >= start && residue <= end,
        index: i + 1,
        ofEntry: clusters.length,
        url: members[0].url,
      });
    });
  }
  return units.sort((a, b) => a.start - b.start || a.end - b.end);
}
