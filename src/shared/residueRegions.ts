/**
 * residueRegions.ts — the UniProt annotations that cover one residue, and whether it sits between
 * annotated domains.
 *
 * DEFINITIONS (no guessing from the coordinates)
 *   - "Linker": a UniProt Region whose description names a linker. Only UniProt's word is used.
 *   - "Disordered": a UniProt Region described as "Disordered". UniProt derives these by sequence
 *     analysis (MobiDB-lite), so the evidence level is printed with it.
 *   - "Between domains": the residue is in no UniProt Domain, and a Domain ends before it and another
 *     starts after it. It names the two flanking domains. It does not claim the segment is a linker.
 *
 * Feature types are compared without case: the server sends UniProt's own names ("Domain",
 * "Region"); an older client filter tested "DOMAIN" and so never matched anything.
 */

import { EVIDENCE_LEVEL_LABEL, evidenceLevelOf, featureCoversResidue } from "./functionalSites.ts";
import type { UniprotFeatureEvidence } from "./contracts.ts";

export interface RegionFeature {
  type: string;
  description?: string;
  start: number;
  end: number;
  evidence?: UniprotFeatureEvidence[];
}

export type RegionKind =
  | "domain" | "linker" | "disordered" | "region" | "motif" | "repeat" | "zinc-finger" | "dna-binding"
  | "coiled-coil" | "transmembrane" | "intramembrane" | "topological" | "compositional-bias" | "signal" | "propeptide" | "transit";

const TYPE_TO_KIND: Record<string, RegionKind> = {
  domain: "domain",
  region: "region",
  motif: "motif",
  repeat: "repeat",
  "zinc finger": "zinc-finger",
  "dna binding": "dna-binding",
  "coiled coil": "coiled-coil",
  transmembrane: "transmembrane",
  intramembrane: "intramembrane",
  "topological domain": "topological",
  "compositional bias": "compositional-bias",
  signal: "signal",
  propeptide: "propeptide",
  "transit peptide": "transit",
};

/** Kind order in the rail: what the residue belongs to first, then what it is near. */
const KIND_ORDER: RegionKind[] = [
  "domain", "zinc-finger", "dna-binding", "linker", "disordered", "motif", "repeat", "coiled-coil",
  "transmembrane", "intramembrane", "topological", "region", "compositional-bias", "signal", "propeptide", "transit",
];

export interface RegionHit {
  kind: RegionKind;
  /** UniProt's description, or its type name when the description is empty. */
  label: string;
  start: number;
  end: number;
  /** "Experimental", "Sequence analysis"… from the ECO codes UniProt cites. */
  evidence: string;
}

function kindOf(f: RegionFeature): RegionKind | null {
  const kind = TYPE_TO_KIND[f.type.trim().toLowerCase()];
  if (kind !== "region") return kind ?? null;
  const d = (f.description ?? "").toLowerCase();
  if (/\blinker\b/.test(d)) return "linker";
  if (/^disordered\b/.test(d)) return "disordered";
  return "region";
}

/**
 * The one place that decides whether a UniProt feature is a Domain or a Region. The server forwards
 * UniProt's own names ("Domain", "Region"); older call sites tested uppercase and matched nothing.
 */
export function isRegionFeatureType(type: string | null | undefined): boolean {
  const t = (type ?? "").trim().toLowerCase();
  return t === "domain" || t === "region";
}

/** Every annotated span that contains the residue, ordered by kind then by start. */
export function regionsAt(features: readonly RegionFeature[] | null | undefined, position: number | null): RegionHit[] {
  if (!features || position === null) return [];
  const hits: RegionHit[] = [];
  for (const f of features) {
    const kind = kindOf(f);
    if (!kind || !featureCoversResidue(f, position)) continue;
    hits.push({
      kind,
      label: (f.description ?? "").trim() || f.type,
      start: f.start,
      end: f.end,
      evidence: EVIDENCE_LEVEL_LABEL[evidenceLevelOf(f.evidence)],
    });
  }
  return hits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.start - b.start);
}

export interface BetweenDomains {
  before: { label: string; start: number; end: number };
  after: { label: string; start: number; end: number };
  /** The uncovered stretch the residue sits in. */
  start: number;
  end: number;
}

/** The two UniProt Domains that flank the residue, when it lies in no Domain itself. */
export function betweenDomainsAt(features: readonly RegionFeature[] | null | undefined, position: number | null): BetweenDomains | null {
  if (!features || position === null) return null;
  const domains = features
    .filter(f => kindOf(f) === "domain")
    .map(f => ({ label: (f.description ?? "").trim() || "Domain", start: f.start, end: f.end }));
  if (domains.some(d => position >= d.start && position <= d.end)) return null;
  const before = domains.filter(d => d.end < position).sort((a, b) => b.end - a.end)[0];
  const after = domains.filter(d => d.start > position).sort((a, b) => a.start - b.start)[0];
  if (!before || !after) return null;
  return { before, after, start: before.end + 1, end: after.start - 1 };
}

/** Spans for the fold track: domains and the named linker / disordered regions only. */
export function trackRegions(features: readonly RegionFeature[] | null | undefined): Array<{ kind: RegionKind; label: string; start: number; end: number }> {
  if (!features) return [];
  const out: Array<{ kind: RegionKind; label: string; start: number; end: number }> = [];
  for (const f of features) {
    const kind = kindOf(f);
    if (kind === "domain" || kind === "linker" || kind === "disordered" || kind === "zinc-finger" || kind === "dna-binding") {
      out.push({ kind, label: (f.description ?? "").trim() || f.type, start: f.start, end: f.end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export const REGION_KIND_LABEL: Record<RegionKind, string> = {
  domain: "Domain",
  linker: "Linker",
  disordered: "Disordered",
  region: "Region",
  motif: "Motif",
  repeat: "Repeat",
  "zinc-finger": "Zinc finger",
  "dna-binding": "DNA binding",
  "coiled-coil": "Coiled coil",
  transmembrane: "Transmembrane",
  intramembrane: "Intramembrane",
  topological: "Topology",
  "compositional-bias": "Composition",
  signal: "Signal peptide",
  propeptide: "Propeptide",
  transit: "Transit peptide",
};
