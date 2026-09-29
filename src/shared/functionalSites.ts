/**
 * functionalSites.ts — what a UniProt feature covers, how well it is evidenced, and the PM1 rule.
 *
 * One module for the rule engine (`server/services/prediction/acmg/criteria.ts`) and the Functional
 * domains tab and rail (`src/shared/functionEvidence.ts`), so the screen can never show a PM1 answer
 * the engine did not reach.
 *
 * INVARIANTS
 * - A `Disulfide bond` covers its two cysteines and nothing between them. UniProt locates a bond by
 *   start = first Cys, end = second Cys; reading that as a span gave PM1 to every residue between the
 *   two (a Cys20–Cys180 bond met PM1 at residues 21–179), and the tab listed the bond "at" all of them.
 * - PM1 counts only sites with experimental evidence in THIS protein (ECO:0000269, or ECO:0007744 /
 *   ECO:0007829 from a structure or large-scale study). A site "by similarity" (ECO:0000250) is a
 *   transfer from another protein, and a sequence-analysis site (ECO:0000255/0000259) is a prediction;
 *   both used to raise PM1 at Moderate exactly like an observed catalytic residue.
 * - PM1 is capped with PP3: the two together may not exceed Strong (Pejaver et al. 2022,
 *   doi:10.1016/j.ajhg.2022.10.013). PM1 is withheld, and says so, when PP3 alone is already Strong.
 * - "Benign variation in the region" (Richards et al. 2015, doi:10.1038/gim.2015.30) is NOT checked, and
 *   every PM1 reason says so rather than implying the criterion was tested in full.
 */

import type { UniprotFeatureEvidence } from "./contracts.ts";

export interface SiteFeature {
  type: string;
  description?: string;
  start: number;
  end: number;
  evidence?: UniprotFeatureEvidence[];
}

export type EvidenceLevel =
  | "experimental"
  | "structure"
  | "proteomics"
  | "curated"
  | "similarity"
  | "predicted"
  | "none";

/** Strongest first; `evidenceLevelOf` returns the first level any tag reaches. */
const LEVEL_ORDER: EvidenceLevel[] = ["experimental", "structure", "proteomics", "curated", "similarity", "predicted", "none"];

export const EVIDENCE_LEVEL_LABEL: Record<EvidenceLevel, string> = {
  experimental: "Experimental",
  structure: "Structure",
  proteomics: "Proteomics",
  curated: "Curator statement",
  similarity: "By similarity",
  predicted: "Sequence analysis",
  none: "No evidence cited",
};

/** The ECO codes behind each level, for the rail's legend. */
export const EVIDENCE_LEVEL_CODES: Array<{ level: EvidenceLevel; codes: string }> = [
  { level: "experimental", codes: "ECO:0000269" },
  { level: "structure", codes: "ECO:0007744 / 0007829 (PDB)" },
  { level: "proteomics", codes: "ECO:0007744" },
  { level: "curated", codes: "ECO:0000305 / 0000303 / 0000312" },
  { level: "similarity", codes: "ECO:0000250" },
  { level: "predicted", codes: "ECO:0000255 / 0000259 / 0000256" },
  { level: "none", codes: "—" },
];

function levelOfTag(tag: UniprotFeatureEvidence): EvidenceLevel {
  switch (tag.code) {
    case "ECO:0000269":
      return "experimental";
    case "ECO:0007829":
      return "structure";
    case "ECO:0007744":
      return tag.source === "PDB" ? "structure" : "proteomics";
    case "ECO:0000250":
      return "similarity";
    case "ECO:0000255":
    case "ECO:0000256":
    case "ECO:0000259":
    case "ECO:0000257":
      return "predicted";
    case "ECO:0000305":
    case "ECO:0000303":
    case "ECO:0000312":
    case "ECO:0000313":
      return "curated";
    default:
      return "curated";
  }
}

export function evidenceLevelOf(evidence: UniprotFeatureEvidence[] | undefined): EvidenceLevel {
  if (!evidence || evidence.length === 0) return "none";
  let best = LEVEL_ORDER.length - 1;
  for (const tag of evidence) best = Math.min(best, LEVEL_ORDER.indexOf(levelOfTag(tag)));
  return LEVEL_ORDER[best];
}

/** The citation a curator can open: the first PubMed tag, else the first tag with an id. */
export function primaryCitation(evidence: UniprotFeatureEvidence[] | undefined): { source: string; id: string } | null {
  const tags = evidence ?? [];
  const pub = tags.find((t) => t.source === "PubMed" && t.id);
  const any = pub ?? tags.find((t) => t.source && t.id);
  return any ? { source: any.source as string, id: any.id as string } : null;
}

/** Levels that count as observed in this protein, and so may raise PM1. */
export const PM1_EVIDENCE_LEVELS: ReadonlySet<EvidenceLevel> = new Set(["experimental", "structure", "proteomics"]);

export function isDisulfide(f: { type?: string }): boolean {
  return (f.type ?? "").toLowerCase() === "disulfide bond";
}

/** The residues a feature actually covers — see the disulfide invariant in the header. */
export function featureCoversResidue(f: { type?: string; start?: number; end?: number }, residue: number): boolean {
  if (!Number.isFinite(residue) || typeof f.start !== "number" || !Number.isFinite(f.start)) return false;
  const end = typeof f.end === "number" && Number.isFinite(f.end) ? f.end : f.start;
  if (isDisulfide(f)) return residue === f.start || residue === end;
  return residue >= f.start && residue <= end;
}

/** UniProt feature types PM1 tests: the "critical functional site" reading of the criterion. */
export const PM1_SITE_TYPES: readonly string[] = ["Active site", "Binding site", "Metal binding", "Disulfide bond"];

const PP3_POINTS: Record<string, number> = { PP3: 1, PP3_Moderate: 2, PP3_Strong: 4, PP3_VeryStrong: 8 };
const PM1_POINTS = 2;
const STRONG_POINTS = 4;

export interface Pm1Assessment {
  /** `withheld-cap`: a qualifying site exists but PP3 already uses the Strong allowance. */
  status: "met" | "not-met" | "withheld-cap" | "no-data";
  qualifying: SiteFeature | null;
  /** PM1-type sites at the residue that were not counted because of their evidence level. */
  notCounted: Array<{ feature: SiteFeature; level: EvidenceLevel }>;
  pp3Code: string | null;
  reason: string;
}

function describeSite(f: SiteFeature, residue: number): string {
  const what = f.description ? `${f.type} "${f.description}"` : f.type;
  if (isDisulfide(f) && f.end !== f.start) {
    const partner = residue === f.start ? f.end : f.start;
    return `${what} (Cys${residue}, bonded to Cys${partner})`;
  }
  return f.start === f.end ? `${what} at residue ${f.start}` : `${what}, residues ${f.start}–${f.end}`;
}

/**
 * Does the residue sit on an experimentally evidenced critical site?
 *
 * `features` null means the annotation was not retrieved: that is `no-data`, never `not-met`.
 */
export function assessPm1(
  features: SiteFeature[] | null | undefined,
  residue: number | null | undefined,
  opts: { pp3Code?: string | null } = {}
): Pm1Assessment {
  const pp3Code = opts.pp3Code ?? null;
  if (!features || typeof residue !== "number" || !Number.isFinite(residue)) {
    return { status: "no-data", qualifying: null, notCounted: [], pp3Code, reason: "UniProtKB features were not retrieved, so PM1 was not assessed." };
  }
  const atResidue = features.filter((f) => PM1_SITE_TYPES.includes(f.type) && featureCoversResidue(f, residue));
  const qualifying = atResidue.find((f) => PM1_EVIDENCE_LEVELS.has(evidenceLevelOf(f.evidence))) ?? null;
  const notCounted = atResidue
    .filter((f) => f !== qualifying && !PM1_EVIDENCE_LEVELS.has(evidenceLevelOf(f.evidence)))
    .map((feature) => ({ feature, level: evidenceLevelOf(feature.evidence) }));

  const notCountedText = notCounted.length
    ? ` Not counted: ${notCounted.map((n) => `${describeSite(n.feature, residue)} (${EVIDENCE_LEVEL_LABEL[n.level].toLowerCase()})`).join("; ")}.`
    : "";

  if (!qualifying) {
    return {
      status: "not-met",
      qualifying: null,
      notCounted,
      pp3Code,
      reason: `No active site, binding site, metal binding or disulfide cysteine with experimental evidence at residue ${residue}.${notCountedText}`,
    };
  }

  const level = evidenceLevelOf(qualifying.evidence);
  const cite = primaryCitation(qualifying.evidence);
  const siteText = `${describeSite(qualifying, residue)}, ${EVIDENCE_LEVEL_LABEL[level].toLowerCase()} evidence${cite ? ` (${cite.source} ${cite.id})` : ""}`;
  const pp3Points = pp3Code ? PP3_POINTS[pp3Code] ?? 0 : 0;

  if (pp3Points + PM1_POINTS > STRONG_POINTS) {
    return {
      status: "withheld-cap",
      qualifying,
      notCounted,
      pp3Code,
      reason: `${siteText}. Withheld: ${pp3Code} already reaches Strong, and PP3 with PM1 is capped at Strong (Pejaver 2022).${notCountedText}`,
    };
  }

  return {
    status: "met",
    qualifying,
    notCounted,
    pp3Code,
    reason: `Critical functional site: ${siteText}. Benign variation in the region was not checked.${notCountedText}`,
  };
}
