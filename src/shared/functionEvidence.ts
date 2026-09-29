/**
 * functionEvidence.ts — the one model the Functional domains tab and its Evidence lineage rail render.
 *
 * Pure: `buildFunctionEvidence(input)` → the finding (PM1 as the engine recorded it), the schematic's
 * marks, one annotation table, the rule trace and the sources. The tab and the rail format nothing of
 * their own, so they cannot disagree.
 *
 * INVARIANTS
 * - PM1 is read from the engine (`engineCriteria`) and cross-checked against `assessPm1`, the same
 *   function `criteria.ts` runs. The screen never computes a code the engine did not record; when the
 *   payload has no engine record the chip is "unconfirmed".
 * - Absence is a state. `uniprotFeatures` null during the run is "Running"; null after a timeout or
 *   error is "Provider error"; nothing is ever called "not annotated" until the record has arrived.
 * - Only UniProt's `Region` features described as disordered are disorder. A `Region` "Interaction with
 *   UBA3" is a functional region: it was painted and legended as "Disordered region" and kept out of
 *   the at-residue check, so a variant inside it read "no domain … contains residue".
 * - A domain is never inferred as "between domains": with no domain from either source the finding says
 *   so ("No domain annotated"), which is what NAE1's UniProt entry states; InterPro matches (from
 *   UniParc) are shown with their database and accession, and a family-level fold covering most of
 *   the protein is flagged as positionally uninformative.
 * - Every annotation carries its evidence level, derived from UniProt's ECO tags; "curated" is never
 *   claimed wholesale. Distances are in sequence and are labelled so.
 * - Sources and versions come from the payload (reviewed status, entry version, UniParc id). Nothing
 *   is hard-coded ("Swiss-Prot Verified", "InterPro / Pfam v2024" were).
 */

import type { DomainMatch, SecondaryStructureElement, UniprotFeaturesData, UniprotFeatureItem } from "./contracts.ts";
import { AMINO_ACID_1_TO_3_TITLE } from "./aminoAcids.ts";
import {
  assessPm1,
  EVIDENCE_LEVEL_LABEL,
  evidenceLevelOf,
  featureCoversResidue,
  isDisulfide,
  primaryCitation,
  type EvidenceLevel,
  type Pm1Assessment,
} from "./functionalSites.ts";

export type AnnotationGroup = "domains" | "variants" | "sites" | "mutagenesis" | "modifications" | "topology" | "composition";

export const ANNOTATION_GROUP_LABEL: Record<AnnotationGroup, string> = {
  domains: "Domains",
  variants: "Known variants",
  sites: "Sites and regions",
  mutagenesis: "Mutagenesis",
  modifications: "Modifications",
  topology: "Topology and processing",
  composition: "Disorder and composition",
};

const GROUP_ORDER: AnnotationGroup[] = ["domains", "variants", "sites", "mutagenesis", "modifications", "topology", "composition"];

/** Where a row is drawn on the schematic. `none` rows are listed, not drawn. */
export type SchematicLane = "domain" | "region" | "above" | "below" | "none";

export interface AnnotationRow {
  key: string;
  group: AnnotationGroup;
  name: string;
  note: string | null;
  /** UniProt feature type, or the member database for an InterPro match. */
  type: string;
  start: number;
  end: number;
  /** For a disulfide bond: the two cysteines, not a span. */
  isPair: boolean;
  residuesText: string;
  covers: boolean;
  /** Signed sequence distance from the variant residue to the nearest covered residue; 0 when covering. */
  distance: number;
  distanceText: string;
  evidence: EvidenceLevel | "match";
  evidenceLabel: string;
  citation: { label: string; url: string | null } | null;
  /** The ECO codes behind `evidence`, for the row's detail. */
  evidenceCodes: string[];
  lane: SchematicLane;
  /** Short label for the schematic ("R85Q", "K6ac", "UBA3 binding"). */
  shortLabel: string;
  disease: boolean;
}

export interface DomainBox {
  key: string;
  name: string;
  source: string;
  accession: string;
  interpro: { id: string; name: string } | null;
  segments: Array<{ start: number; end: number }>;
  covers: boolean;
  /** Share of the protein the domain covers, 0–1. */
  coverage: number;
  url: string | null;
}

export type Pm1Verdict = "met" | "not-met" | "withheld-cap" | "withheld-weighting" | "not-assessed";

export interface FunctionFact {
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
}

export interface TraceStep {
  text: string;
  strong?: string;
  warn?: boolean;
}

export interface FunctionEvidence {
  residue: number;
  residueLabel: string;
  variantShort: string;
  length: number;
  gene: string;
  uniprotId: string;
  availability: { state: "ok" | "running" | "error"; label: string; reason: string };
  domains: DomainBox[];
  structuralDomains: DomainBox[];
  /** InterPro could not be read in this run (UniProt was). */
  interproMissing: boolean;
  rows: AnnotationRow[];
  groups: Array<{ group: AnnotationGroup; label: string; rows: AnnotationRow[] }>;
  atResidue: AnnotationRow[];
  secondaryStructure: SecondaryStructureElement[];
  structureContext: { value: string; sub: string; sentence: string } | null;
  nearestDiseaseVariant: AnnotationRow | null;
  pm1: Pm1Assessment;
  verdict: Pm1Verdict;
  verdictLabel: string;
  /** True when the payload carried no engine record, so the chip is unconfirmed. */
  verdictUnconfirmed: boolean;
  engineMismatch: string | null;
  headline: { figure: string; sub: string };
  finding: { lead: string; rest: string };
  facts: FunctionFact[];
  caveats: Array<{ lead: string; rest: string }>;
  notAnnotated: string[];
  trace: TraceStep[];
  sources: Array<{ label: string; value: string; url: string | null }>;
  familyMatches: DomainBox[];
}

export interface FunctionEvidenceInput {
  gene?: string | null;
  uniprotId?: string | null;
  residue: number;
  wildType?: string | null;
  mutant?: string | null;
  uniprot: UniprotFeaturesData | null | undefined;
  /** `serviceStatus.uniprotFeatures` ("pending", "ok", "timeout", "error", "not_found"…). */
  serviceStatus?: string | null;
  numberingBasis?: "canonical" | "remapped" | "unverified" | null;
  uniprotIsoform?: string | null;
  transcriptId?: string | null;
  engineCriteria?: ReadonlyArray<{ code?: string }> | null;
  acmgWeighting?: string | null;
}

/** Member databases drawn as domain boxes. Family and superfamily signatures are listed, not drawn. */
const DOMAIN_DATABASES = ["Pfam", "SMART", "PROSITE", "PROSITE profiles", "ProfileScan"];
const STRUCTURAL_DATABASES = ["Gene3D", "CATH-Gene3D"];

const title3 = (aa?: string | null): string => {
  if (!aa) return "";
  if (aa.length === 1) return AMINO_ACID_1_TO_3_TITLE[aa.toUpperCase()] ?? aa;
  return aa.charAt(0).toUpperCase() + aa.slice(1, 3).toLowerCase();
};
const one = (aa?: string | null): string => {
  if (!aa) return "";
  if (aa.length === 1) return aa.toUpperCase();
  const t = aa.charAt(0).toUpperCase() + aa.slice(1, 3).toLowerCase();
  const hit = Object.entries(AMINO_ACID_1_TO_3_TITLE).find(([, v]) => v === t);
  return hit ? hit[0] : aa;
};

const lower = (s?: string | null) => (s ?? "").toLowerCase();
const isDisorderRegion = (f: UniprotFeatureItem) => lower(f.type) === "region" && /disorder/.test(lower(f.description));

function groupOf(f: UniprotFeatureItem): AnnotationGroup {
  const t = lower(f.type);
  if (t === "domain") return "domains";
  if (t === "natural variant") return "variants";
  if (t === "mutagenesis") return "mutagenesis";
  if (["modified residue", "glycosylation", "cross-link", "lipidation"].includes(t)) return "modifications";
  if (["transmembrane", "intramembrane", "topological domain", "signal", "propeptide", "transit peptide"].includes(t)) return "topology";
  if (t === "compositional bias" || isDisorderRegion(f)) return "composition";
  return "sites";
}

/** "in NEDFIH; dbSNP:rs123" → disease note "In NEDFIH"; a dbSNP-only record is a polymorphism. */
function variantNote(description: string): { note: string; disease: boolean } {
  const first = description.split(";")[0].trim();
  const disease = /^in\s+(?!dbsnp)/i.test(first);
  if (disease) return { note: first.charAt(0).toUpperCase() + first.slice(1), disease: true };
  return { note: "Polymorphism", disease: false };
}

/** The modified residue's letter, from UniProt's own residue name ("N6-acetyllysine" → K). */
const RESIDUE_WORDS: Array<[RegExp, string]> = [
  [/lysine/, "K"], [/alanine/, "A"], [/serine/, "S"], [/threonine/, "T"], [/tyrosine/, "Y"], [/arginine/, "R"],
  [/methionine/, "M"], [/cysteine/, "C"], [/histidine/, "H"], [/glutam(ate|ic)/, "E"], [/aspart(ate|ic)/, "D"],
  [/asparagine/, "N"], [/glutamine/, "Q"], [/proline/, "P"], [/glycine/, "G"], [/tryptophan/, "W"],
];

function ptmShort(f: UniprotFeatureItem): string {
  const d = lower(f.description);
  const aa = RESIDUE_WORDS.find(([re]) => re.test(d))?.[1] ?? "";
  if (d.includes("acetyl")) return `${aa}${f.start}ac`;
  if (d.includes("phospho")) return `${aa}${f.start}p`;
  if (d.includes("methyl")) return `${aa}${f.start}me`;
  if (d.includes("ubiquitin") || d.includes("sumo") || lower(f.type) === "cross-link") return `${aa}${f.start}ub`;
  if (lower(f.type) === "glycosylation") return `${aa}${f.start}gly`;
  return `${aa}${f.start}`;
}

function citationFor(f: UniprotFeatureItem): AnnotationRow["citation"] {
  const c = primaryCitation(f.evidence);
  if (!c) return null;
  if (c.source === "PubMed") return { label: `PubMed ${c.id}`, url: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(c.id)}/` };
  if (c.source === "PDB") return { label: `PDB ${c.id}`, url: `https://www.rcsb.org/structure/${encodeURIComponent(c.id)}` };
  if (c.source === "UniProtKB") return { label: `From ${c.id}`, url: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(c.id)}` };
  return { label: `${c.source} ${c.id}`, url: null };
}

function signedDistance(f: { type?: string; start: number; end: number }, residue: number): number {
  if (featureCoversResidue(f, residue)) return 0;
  if (isDisulfide(f)) {
    const a = f.start - residue;
    const b = f.end - residue;
    return Math.abs(a) <= Math.abs(b) ? a : b;
  }
  return f.start > residue ? f.start - residue : -(residue - f.end);
}

const distanceText = (d: number, covers: boolean) => (covers ? "inside" : d > 0 ? `+${d}` : `−${Math.abs(d)}`);

function rowFromFeature(f: UniprotFeatureItem, residue: number, idx: number): AnnotationRow {
  const group = groupOf(f);
  const t = lower(f.type);
  const pair = isDisulfide(f) && f.end !== f.start;
  const covers = featureCoversResidue(f, residue);
  const distance = signedDistance(f, residue);
  const level = evidenceLevelOf(f.evidence);
  let name = f.description || f.type;
  let note: string | null = f.type;
  let shortLabel = f.description || f.type;
  let lane: SchematicLane = "below";
  let disease = false;

  if (group === "variants" || group === "mutagenesis") {
    const from = f.change?.from ?? "";
    const to = f.change?.to?.[0] ?? "";
    const fromOne = from.length === 1 ? from : "";
    const toOne = to.length === 1 ? to : "";
    name = fromOne && toOne ? `${title3(fromOne)}${f.start}${title3(toOne)}` : `Residue ${f.start}${f.end !== f.start ? `–${f.end}` : ""}`;
    shortLabel = fromOne && toOne ? `${fromOne}${f.start}${toOne}` : `${f.start}`;
    if (group === "variants") {
      const v = variantNote(f.description || "");
      note = v.note;
      disease = v.disease;
      lane = v.disease ? "above" : "none";
    } else {
      const effect = (f.description || "").replace(/^[A-Z]+(?:->|→)[A-Z]+:\s*/i, "").replace(/\.$/, "");
      note = effect ? effect.charAt(0).toUpperCase() + effect.slice(1) : null;
      lane = "below";
    }
  } else if (group === "modifications") {
    shortLabel = ptmShort(f);
    note = f.type === "Modified residue" ? null : f.type;
  } else if (group === "domains") {
    lane = "domain";
    note = "UniProtKB domain";
  } else if (group === "sites") {
    if (f.end !== f.start && !pair) {
      lane = "region";
      shortLabel = (f.description || f.type).replace(/^Interaction with /i, "").replace(/^(.{0,22}).*$/, "$1") + (/^Interaction with /i.test(f.description || "") ? " binding" : "");
    } else {
      shortLabel = pair ? `Cys${f.start}–Cys${f.end}` : (f.description || f.type).replace(/^Interaction with /i, "") + (/^Interaction with /i.test(f.description || "") ? " site" : "");
    }
    note = pair ? "Disulfide bond, two cysteines" : f.type;
  } else if (group === "topology") {
    lane = f.end !== f.start ? "region" : "below";
    note = f.type;
    // "Helical" says nothing on the drawing; the type is the label a reader scans for.
    shortLabel = t === "transmembrane" ? "TM" : t === "intramembrane" ? "IM" : t === "signal" ? "Signal" : f.description || f.type;
  } else {
    lane = "none";
  }

  const residuesText = pair ? `${f.start}, ${f.end}` : f.start === f.end ? `${f.start}` : `${f.start}–${f.end}`;
  return {
    key: `${t}-${f.start}-${f.end}-${idx}`,
    group,
    name,
    note: note && note !== name ? note : null,
    type: f.type,
    start: f.start,
    end: f.end,
    isPair: pair,
    residuesText,
    covers,
    distance,
    distanceText: distanceText(distance, covers),
    evidence: level,
    evidenceLabel: EVIDENCE_LEVEL_LABEL[level],
    citation: citationFor(f),
    evidenceCodes: Array.from(new Set((f.evidence ?? []).map((e) => e.code))),
    lane,
    shortLabel,
    disease,
  };
}

function domainUrl(m: DomainMatch): string | null {
  if (m.interpro) return `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(m.interpro.id)}/`;
  if (m.database === "Pfam") return `https://www.ebi.ac.uk/interpro/entry/pfam/${encodeURIComponent(m.accession)}/`;
  return null;
}

function boxFromMatch(m: DomainMatch, residue: number, length: number): DomainBox {
  const covered = m.locations.reduce((n, l) => n + (l.end - l.start + 1), 0);
  return {
    key: `${m.database}-${m.accession}`,
    // A Gene3D match has no InterPro entry; "Gene3D 3.40.50.720" reads better than "G3DSA:3.40.50.720".
    name: m.interpro?.name ?? `${m.database} ${m.accession.replace(/^G3DSA:/, "")}`,
    source: m.database,
    accession: m.accession,
    interpro: m.interpro,
    segments: m.locations,
    covers: m.locations.some((l) => residue >= l.start && residue <= l.end),
    coverage: length > 0 ? Math.min(1, covered / length) : 0,
    url: domainUrl(m),
  };
}

const segText = (b: DomainBox) => b.segments.map((s) => `${s.start}–${s.end}`).join(", ");

function structureContext(ss: SecondaryStructureElement[], residue: number): { value: string; sub: string; sentence: string } | null {
  const els = ss.filter((e) => e.kind !== "turn").sort((a, b) => a.start - b.start);
  if (!els.length) return null;
  const pdb = els.find((e) => e.pdb)?.pdb;
  const pdbText = pdb ? `PDB ${pdb}` : "UniProtKB";
  const word = (k: SecondaryStructureElement["kind"]) => (k === "helix" ? "helix" : "strand");
  const plural = (k: SecondaryStructureElement["kind"]) => (k === "helix" ? "helices" : "strands");
  const inside = els.find((e) => residue >= e.start && residue <= e.end);
  if (inside) {
    return {
      value: inside.kind === "helix" ? "In a helix" : "In a β-strand",
      sub: `${word(inside.kind)} ${inside.start}–${inside.end}, ${pdbText}`,
      sentence: `It sits in the ${word(inside.kind)} ${inside.start}–${inside.end} of the solved structure (${pdbText}).`,
    };
  }
  const before = [...els].reverse().find((e) => e.end < residue);
  const after = els.find((e) => e.start > residue);
  if (!before || !after) {
    return { value: "Terminal, no regular structure", sub: pdbText, sentence: `It lies beyond the last annotated helix or strand (${pdbText}).` };
  }
  const gapStart = before.end + 1;
  const gapEnd = after.start - 1;
  const n = gapEnd - gapStart + 1;
  const pair = before.kind === after.kind ? plural(before.kind) : `${word(before.kind)} and ${word(after.kind)}`;
  return {
    value: `Between ${pair}`,
    sub: `${gapStart === gapEnd ? gapStart : `${gapStart}–${gapEnd}`} unassigned, ${pdbText}`,
    sentence: `It sits in the ${n === 1 ? "one-residue" : `${n}-residue`} link between ${pair} ${before.start}–${before.end} and ${after.start}–${after.end} of the solved structure.`,
  };
}

function availabilityOf(input: FunctionEvidenceInput): FunctionEvidence["availability"] {
  if (input.uniprot) return { state: "ok", label: "Computed", reason: "" };
  const s = lower(input.serviceStatus);
  if (s === "timeout" || s === "error" || s === "failed" || s === "offline") {
    return {
      state: "error",
      label: "Provider error",
      reason: s === "timeout" ? "UniProtKB did not answer in time, so nothing is claimed about this residue." : "UniProtKB could not be reached, so nothing is claimed about this residue.",
    };
  }
  if (s === "not_found") return { state: "error", label: "No result", reason: "UniProtKB has no feature table for this accession." };
  return { state: "running", label: "Running", reason: "Reading the UniProtKB feature table and InterPro matches." };
}

export function buildFunctionEvidence(input: FunctionEvidenceInput): FunctionEvidence {
  const residue = input.residue;
  const wt3 = title3(input.wildType);
  const mut1 = one(input.mutant);
  const residueLabel = `${wt3}${residue}`;
  const variantShort = `${one(input.wildType)}${residue}${mut1}`;
  const uniprot = input.uniprot ?? null;
  const features = (uniprot?.features ?? []).filter((f) => lower(f.type) !== "chain");
  const length =
    uniprot?.sequenceLength && uniprot.sequenceLength > 0
      ? uniprot.sequenceLength
      : Math.max(residue, ...features.map((f) => f.end || f.start || 0), 1);
  const availability = availabilityOf(input);

  const rows = features.map((f, i) => rowFromFeature(f, residue, i));

  // Domains: InterPro member-database matches when UniParc answered, UniProt's own Domain features always.
  const matches = uniprot?.domainMatches ?? [];
  const interproMissing = !!uniprot && uniprot.domainMatchesStatus !== "ok";
  const domainBoxes = matches.filter((m) => DOMAIN_DATABASES.includes(m.database)).map((m) => boxFromMatch(m, residue, length));
  const structural = matches.filter((m) => STRUCTURAL_DATABASES.includes(m.database)).map((m) => boxFromMatch(m, residue, length));
  const familyMatches = matches
    .filter((m) => !DOMAIN_DATABASES.includes(m.database) && !STRUCTURAL_DATABASES.includes(m.database))
    .map((m) => boxFromMatch(m, residue, length));
  const uniprotDomainBoxes: DomainBox[] = features
    .filter((f) => lower(f.type) === "domain")
    .map((f, i) => ({
      key: `uniprot-domain-${i}`,
      name: f.description || "Domain",
      source: "UniProtKB",
      accession: f.interproId ?? "",
      interpro: null,
      segments: [{ start: f.start, end: f.end }],
      covers: featureCoversResidue(f, residue),
      coverage: (f.end - f.start + 1) / length,
      url: f.interproId ? `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(f.interproId)}/` : null,
    }));
  // Draw InterPro domain boxes when there are any; else UniProt's. Both are listed in the table.
  const domains = domainBoxes.length ? domainBoxes : uniprotDomainBoxes;

  const domainRows: AnnotationRow[] = [...domainBoxes, ...structural].map((b) => {
    const nearest = b.segments.reduce((best, s) => {
      const d = signedDistance({ start: s.start, end: s.end }, residue);
      return Math.abs(d) < Math.abs(best) ? d : best;
    }, Number.POSITIVE_INFINITY);
    return {
      key: `match-${b.key}`,
      group: "domains" as const,
      name: b.name,
      note: `${b.interpro ? `${b.source} ${b.accession} · InterPro ${b.interpro.id}` : STRUCTURAL_DATABASES.includes(b.source) ? "Structural domain, CATH" : `${b.source} ${b.accession}`}${b.segments.length > 1 ? ` · ${b.segments.length} segments` : ""}`,
      type: b.source,
      start: b.segments[0].start,
      end: b.segments[b.segments.length - 1].end,
      isPair: false,
      residuesText: segText(b),
      covers: b.covers,
      distance: b.covers ? 0 : nearest,
      distanceText: distanceText(b.covers ? 0 : nearest, b.covers),
      evidence: "match" as const,
      evidenceLabel: "Sequence model",
      citation: b.url ? { label: b.interpro ? `InterPro ${b.interpro.id}` : `${b.source} ${b.accession}`, url: b.url } : null,
      evidenceCodes: [],
      lane: "none" as const,
      shortLabel: b.name,
      disease: false,
    };
  });
  const allRows = [...domainRows, ...rows];
  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    label: ANNOTATION_GROUP_LABEL[g],
    rows: allRows.filter((r) => r.group === g).sort((a, b) => a.start - b.start || a.end - b.end),
  })).filter((g) => g.rows.length > 0);

  // "At the residue": anything covering it, except a family-level fold that covers most of the protein.
  const broad = (b: DomainBox) => b.coverage >= 0.8;
  const atResidue = allRows.filter((r) => {
    if (!r.covers) return false;
    if (r.group === "domains" && r.evidence === "match") {
      const box = [...domainBoxes, ...structural].find((b) => `match-${b.key}` === r.key);
      return box ? !broad(box) : true;
    }
    return r.group !== "composition";
  });
  const specificAtResidue = atResidue.filter((r) => r.group !== "domains");

  const secondaryStructure = uniprot?.secondaryStructure ?? [];
  const ssContext = structureContext(secondaryStructure, residue);

  const diseaseRows = rows.filter((r) => r.disease && r.start !== residue);
  const nearestDiseaseVariant = diseaseRows.length
    ? diseaseRows.reduce((a, b) => (Math.abs(b.distance) < Math.abs(a.distance) ? b : a))
    : null;
  const sameResidueDisease = rows.filter((r) => r.disease && r.start === residue);

  // PM1: the engine's record, cross-checked with the shared rule.
  const pp3Code = input.engineCriteria?.map((c) => c?.code ?? "").find((c) => c.toUpperCase().startsWith("PP3")) ?? null;
  const pm1 = assessPm1(uniprot ? features : null, residue, { pp3Code });
  const engineKnown = Array.isArray(input.engineCriteria);
  const recorded = engineKnown && input.engineCriteria!.some((c) => (c?.code ?? "").toUpperCase() === "PM1");
  const weightingSuppresses = input.acmgWeighting === "strict-structural" || input.acmgWeighting === "conservative";
  let verdict: Pm1Verdict;
  if (!uniprot) verdict = "not-assessed";
  else if (engineKnown) {
    if (recorded) verdict = "met";
    else if (pm1.status === "withheld-cap") verdict = "withheld-cap";
    else if (pm1.status === "met" && weightingSuppresses) verdict = "withheld-weighting";
    else verdict = "not-met";
  } else verdict = pm1.status === "met" ? "met" : pm1.status === "withheld-cap" ? "withheld-cap" : "not-met";
  const verdictUnconfirmed = !!uniprot && !engineKnown;
  const engineMismatch =
    engineKnown && uniprot && ((recorded && pm1.status !== "met") || (!recorded && pm1.status === "met" && !weightingSuppresses))
      ? recorded
        ? "The engine recorded PM1, but the current rule finds no experimentally evidenced site here: this payload was classified by an earlier engine."
        : "The current rule finds a qualifying site, but the engine did not record PM1: this payload was classified by an earlier engine."
      : null;
  const verdictLabel = {
    met: "PM1 met",
    "not-met": "PM1 not met",
    "withheld-cap": "PM1 withheld",
    "withheld-weighting": "PM1 withheld",
    "not-assessed": "PM1 not assessed",
  }[verdict];

  // The finding.
  const coveringDomain = domains.find((d) => d.covers) ?? null;
  const domainPhrase = coveringDomain
    ? `inside the ${coveringDomain.name} (${coveringDomain.source}, ${segText(coveringDomain)})`
    : null;
  let lead: string;
  let sub: string;
  if (!uniprot) {
    lead = availability.state === "running" ? "Reading the annotation for this protein." : "The annotation for this protein could not be read.";
    sub = availability.label;
  } else if (pm1.qualifying && (verdict === "met" || verdict === "withheld-cap" || verdict === "withheld-weighting")) {
    const kind = pm1.qualifying.type.toLowerCase();
    lead = `Residue ${residue} is ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} with experimental evidence.`;
    const d = pm1.qualifying.description;
    sub = `${kind}${d ? `, ${d.charAt(0).toLowerCase()}${d.slice(1)}` : ""}`;
  } else if (specificAtResidue.length) {
    const first = specificAtResidue[0];
    lead = `Residue ${residue} carries ${specificAtResidue.length === 1 ? "one annotation" : `${specificAtResidue.length} annotations`}: ${first.name.toLowerCase() === first.type.toLowerCase() ? first.name : `${first.name} (${first.type.toLowerCase()})`}${specificAtResidue.length > 1 ? " and others" : ""}.`;
    sub = domainPhrase ? `${domainPhrase.replace(/ \(.*\)$/, "")}` : "annotated here";
  } else if (coveringDomain) {
    lead = `Residue ${residue} lies ${domainPhrase}, but no site, region or modification is annotated at it.`;
    sub = `inside the ${coveringDomain.name}, nothing annotated at the residue`;
  } else {
    lead = `UniProtKB annotates nothing at residue ${residue}.`;
    sub = domains.length ? "outside every annotated domain" : "no domain, site or modification annotated here";
  }
  const restParts: string[] = [];
  if (uniprot && ssContext) restParts.push(ssContext.sentence);
  if (sameResidueDisease.length) restParts.push(`UniProt lists a disease variant at this same residue (${sameResidueDisease[0].name}, ${sameResidueDisease[0].note}).`);
  else if (nearestDiseaseVariant)
    restParts.push(
      `The nearest known disease variant, ${nearestDiseaseVariant.name}, is ${Math.abs(nearestDiseaseVariant.distance)} residues ${nearestDiseaseVariant.distance < 0 ? "upstream" : "downstream"}.`
    );

  // Facts: domain, structure, nearest disease variant, engine record.
  const facts: FunctionFact[] = [
    coveringDomain
      ? { label: "Domain", value: shortDomainName(coveringDomain.name), sub: `${coveringDomain.source} ${segText(coveringDomain)}, ${Math.round(coveringDomain.coverage * 100)}% of the protein` }
      : { label: "Domain", value: uniprot ? "None at this residue" : "—", sub: uniprot ? (domains.length ? `${domains.length} annotated elsewhere` : interproMissing ? "UniProtKB; InterPro not read" : "UniProtKB and InterPro") : availability.label },
    ssContext
      ? { label: "Structure", value: ssContext.value, sub: ssContext.sub }
      : { label: "Structure", value: "Not annotated", sub: "no PDB-derived secondary structure" },
    nearestDiseaseVariant || sameResidueDisease.length
      ? sameResidueDisease.length
        ? { label: "Disease variant here", value: sameResidueDisease[0].shortLabel, sub: sameResidueDisease[0].note ?? "UniProtKB", mono: true }
        : {
            label: "Nearest disease variant",
            value: nearestDiseaseVariant!.shortLabel,
            sub: `${Math.abs(nearestDiseaseVariant!.distance)} aa ${nearestDiseaseVariant!.distance < 0 ? "upstream" : "downstream"}`,
            mono: true,
          }
      : { label: "Disease variants", value: uniprot ? "None listed" : "—", sub: "UniProtKB" },
    {
      label: "Engine record",
      value: verdictLabel,
      sub:
        verdict === "met"
          ? pm1.qualifying ? `${pm1.qualifying.type.toLowerCase()} at ${residue}` : "recorded by the engine"
          : verdict === "withheld-cap"
            ? "PP3 already at Strong"
            : verdict === "withheld-weighting"
              ? `${input.acmgWeighting} weighting`
              : verdict === "not-assessed"
                ? availability.label
                : pm1.notCounted.length
                  ? "site here lacks experimental evidence"
                  : `no qualifying site at ${residue}`,
      mono: true,
    },
  ];

  const caveats: FunctionEvidence["caveats"] = [];
  if (coveringDomain && coveringDomain.coverage >= 0.8) {
    caveats.push({
      lead: `A domain that spans ${Math.round(coveringDomain.coverage * 100)}% of the protein says little about this position.`,
      rest: "Being inside it is not a PM1 critical domain on its own, and not annotated is not the same as not functional.",
    });
  } else if (uniprot) {
    caveats.push({ lead: "Not annotated is not the same as not functional.", rest: "UniProtKB records what has been observed or inferred, not everything a residue does." });
  }
  if (interproMissing) caveats.push({ lead: "InterPro could not be read in this run.", rest: "Domains shown are UniProtKB's own annotation only." });
  if (input.numberingBasis === "unverified") {
    caveats.push({ lead: "Residue numbering is unverified.", rest: "UniProt features are numbered on the canonical isoform; an overlap shown here may not hold for the analysed transcript." });
  }
  if (pm1.notCounted.length) {
    caveats.push({
      lead: `${pm1.notCounted[0].feature.type} at ${residue} not counted for PM1.`,
      rest: `Its evidence is ${EVIDENCE_LEVEL_LABEL[pm1.notCounted[0].level].toLowerCase()}, not an observation in this protein.`,
    });
  }
  if (engineMismatch) caveats.push({ lead: "Engine record differs from the current rule.", rest: engineMismatch });

  const present = new Set(features.map((f) => lower(f.type)));
  const kinds: Array<[string, string[]]> = [
    ["domains", ["domain"]],
    ["active sites", ["active site"]],
    ["binding sites", ["binding site"]],
    ["metal binding", ["metal binding"]],
    ["disulfide bonds", ["disulfide bond"]],
    ["transmembrane segments", ["transmembrane", "intramembrane"]],
    ["glycosylation", ["glycosylation"]],
    ["signal peptide", ["signal"]],
  ];
  const notAnnotated = uniprot ? kinds.filter(([, types]) => !types.some((t) => present.has(t))).map(([label]) => label) : [];
  if (domains.length && notAnnotated[0] === "domains") notAnnotated.shift();

  const numberingText =
    input.numberingBasis === "unverified"
      ? { text: "Residue numbering could not be verified against canonical ", strong: input.uniprotId ?? "UniProt", warn: true }
      : input.numberingBasis === "remapped"
        ? { text: "Residue renumbered onto canonical ", strong: input.uniprotId ?? "UniProt" }
        : { text: "Residue numbered on canonical ", strong: input.uniprotId ?? "UniProt" };
  const trace: TraceStep[] = [
    { text: `${numberingText.text}`, strong: `${numberingText.strong}${input.transcriptId ? ` (${input.transcriptId})` : ""}.`, warn: numberingText.warn },
    uniprot
      ? {
          text: `annotations read from UniProtKB (${uniprot.reviewed === false ? "unreviewed entry" : uniprot.reviewed ? "reviewed entry" : "entry"}), ${interproMissing ? "InterPro not read" : `${matches.length} InterPro matches via UniParc`}${secondaryStructure.length ? ", secondary structure from PDB" : ""}.`,
          strong: `${features.length}`,
        }
      : { text: availability.reason, strong: availability.label, warn: availability.state === "error" },
    uniprot
      ? specificAtResidue.length
        ? { text: `${specificAtResidue.map((r) => r.name).join(", ")} cover${specificAtResidue.length === 1 ? "s" : ""} residue ${residue}.`, strong: "" }
        : { text: coveringDomain ? `Only the ${coveringDomain.name} covers residue ${residue}; no site or region does.` : `Nothing covers residue ${residue}.`, strong: "" }
      : { text: "Nothing is claimed about the residue until the record arrives.", strong: "" },
    {
      text: `PM1 tests active site, binding site, metal binding and disulfide cysteines at ${residue}, counting experimental evidence only: `,
      strong: pm1.qualifying ? `${pm1.qualifying.type.toLowerCase()} found` : pm1.notCounted.length ? "none counted" : uniprot ? "none found" : "not assessed",
    },
    {
      text: `Engine record: `,
      strong: `${verdictLabel}${verdictUnconfirmed ? " (unconfirmed, no engine record in this payload)" : ""}.`,
      warn: !!engineMismatch || verdictUnconfirmed,
    },
  ];

  const sources: FunctionEvidence["sources"] = [];
  if (input.uniprotId) {
    sources.push({
      label: `UniProtKB ${input.uniprotId}`,
      value: uniprot?.entryVersion ? `entry v${uniprot.entryVersion}${uniprot.lastAnnotationUpdate ? `, ${uniprot.lastAnnotationUpdate}` : ""}` : uniprot?.reviewed === false ? "unreviewed" : "entry",
      url: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(input.uniprotId)}/entry`,
    });
  }
  if (uniprot?.uniparcId) sources.push({ label: "InterPro via UniParc", value: uniprot.uniparcId, url: `https://www.uniprot.org/uniparc/${encodeURIComponent(uniprot.uniparcId)}` });
  const pdb = secondaryStructure.find((e) => e.pdb)?.pdb;
  if (pdb) sources.push({ label: `PDB ${pdb}`, value: "secondary structure", url: `https://www.rcsb.org/structure/${encodeURIComponent(pdb)}` });
  sources.push({ label: "Richards 2015", value: "10.1038/gim.2015.30", url: "https://doi.org/10.1038/gim.2015.30" });
  sources.push({ label: "Pejaver 2022", value: "10.1016/j.ajhg.2022.10.013", url: "https://doi.org/10.1016/j.ajhg.2022.10.013" });

  return {
    residue,
    residueLabel,
    variantShort,
    length,
    gene: input.gene ?? uniprot?.geneName ?? "",
    uniprotId: input.uniprotId ?? "",
    availability,
    domains,
    structuralDomains: structural,
    interproMissing,
    rows: allRows,
    groups,
    atResidue,
    secondaryStructure,
    structureContext: ssContext,
    nearestDiseaseVariant,
    pm1,
    verdict,
    verdictLabel,
    verdictUnconfirmed,
    engineMismatch,
    headline: { figure: residueLabel, sub },
    finding: { lead, rest: restParts.join(" ") },
    facts,
    caveats,
    notAnnotated,
    trace,
    sources,
    familyMatches,
  };
}

/** A fact cell holds one short line; the full name is in the table and the schematic. */
function shortDomainName(name: string): string {
  return name.length > 28 ? `${name.slice(0, 26).trimEnd()}…` : name;
}
