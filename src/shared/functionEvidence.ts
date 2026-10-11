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
  isMetalBindingSite,
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
export type SchematicLane = "domain" | "region" | "membrane" | "above" | "below" | "none";

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
  /** The residue change of a natural variant or mutagenesis row ("A" → ["V"]). */
  substitution: { from: string; to: string[] } | null;
  /** What UniProt says beyond the disease name ("Severe form; reduces structural stability…"), dbSNP ids removed. */
  detail: string | null;
  /**
   * The table row this mark belongs to. Equal to `key` except for natural variants, which the table folds to one
   * row per residue ("Ala5 → Ser, Thr, Val"); the drawing keeps one mark per variant and points it at that row.
   */
  rowKey: string;
  /** For a folded variant row: the per-substitution rows it stands for. */
  parts: AnnotationRow[];
}

export interface DomainBox {
  key: string;
  name: string;
  source: string;
  accession: string;
  interpro: { id: string; name: string } | null;
  /** InterPro entry type when InterPro answered (`domain`, `conserved_site`…). */
  entryType: string | null;
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

/** Disease-variant density, so a 154-residue protein with 81 variants is read as a distribution, not 81 pins. */
export interface VariantDensity {
  /** UniProt disease variants (one per substitution). */
  total: number;
  /** Distinct residues carrying one. */
  residues: number;
  /** Disease variants at the query residue (all substitutions). */
  atResidue: number;
  /** Disease variants within `nearWindow` residues of the query. */
  near: number;
  nearWindow: number;
  /** The densest `densestWindow`-residue stretch. */
  densest: { start: number; end: number; count: number } | null;
  densestWindow: number;
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
  /** Short conserved-site signatures (PROSITE patterns, InterPro binding or active site entries): ticks, not boxes. */
  motifs: DomainBox[];
  /** InterPro could not be read in this run (UniProt was). */
  interproMissing: boolean;
  rows: AnnotationRow[];
  groups: Array<{ group: AnnotationGroup; label: string; rows: AnnotationRow[]; summary: string | null }>;
  atResidue: AnnotationRow[];
  secondaryStructure: SecondaryStructureElement[];
  structureContext: { value: string; sub: string; sentence: string } | null;
  nearestDiseaseVariant: AnnotationRow | null;
  /** The UniProt natural variant that is this exact change, when there is one. */
  exactVariant: AnnotationRow | null;
  /** Other UniProt variants at the same residue, context only. */
  otherVariantsHere: AnnotationRow[];
  density: VariantDensity;
  /** The processed protein's number for the residue, when UniProt's chain starts after residue 1. */
  matureNumbering: { residue: number; label: string; chainStart: number } | null;
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
  /** gnomAD regional missense constraint at the residue; context only, PM1 does not use it. */
  regionalConstraint?: { isConstrained: boolean; oeRatio: number | null; regionText: string | null } | null;
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

/** A span covering this share of the chain is context for the residue, not an annotation at it. */
const BROAD_SPAN = 0.3;
/** Longest unassigned gap still described as a link between two secondary-structure elements. */
const MAX_LINK = 8;

/** UniProt's machine-style names, as a reader writes them: "Helical; Name=4" → TM4, "Ligand: K(+)" → K⁺ binding. */
const CHARGE: Record<string, string> = { "(+)": "⁺", "(2+)": "²⁺", "(3+)": "³⁺", "(-)": "⁻", "(2-)": "²⁻" };
const ionText = (raw: string): string => raw.replace(/\((?:\d)?[+-]\)/g, (m) => CHARGE[m] ?? m);

function tidyTransmembrane(description: string): { name: string; short: string } {
  const n = /name=(\d+)/i.exec(description)?.[1];
  if (!n) return { name: description || "Transmembrane", short: "TM" };
  return { name: `TM${n}${/discontinuous/i.test(description) ? " (discontinuous)" : ""}`, short: `TM${n}` };
}

function tidyLigand(description: string): string | null {
  const m = /^ligand:\s*(.+)$/i.exec(description.trim());
  return m ? `${ionText(m[1])} binding` : null;
}

/**
 * "in ALS1; severe form; reduces structural stability and enzymatic activity; dbSNP:rs121912444" →
 * note "In ALS1", detail "Severe form; reduces structural stability and enzymatic activity".
 * The detail used to be dropped (everything after the first `;`), which threw away the one sentence UniProt
 * has on what the change does. A dbSNP-only record is a polymorphism; cross-reference ids are not detail.
 */
function variantNote(description: string): { note: string; detail: string | null; disease: boolean } {
  const clauses = description.split(";").map((c) => c.trim()).filter(Boolean);
  const first = clauses[0] ?? "";
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const disease = /^in\s+(?!dbsnp)/i.test(first);
  if (!disease) return { note: "Polymorphism", detail: null, disease: false };
  const rest = clauses.slice(1).filter((c) => !/^[A-Za-z][\w-]*:\s*\S+$/.test(c));
  return { note: cap(first), detail: rest.length ? cap(rest.join("; ")) : null, disease: true };
}

/** The modified residue's letter, from UniProt's own residue name ("N6-acetyllysine" → K). */
const RESIDUE_WORDS: Array<[RegExp, string]> = [
  [/lysine/, "K"], [/alanine/, "A"], [/serine/, "S"], [/threonine/, "T"], [/tyrosine/, "Y"], [/arginine/, "R"],
  [/methionine/, "M"], [/cysteine/, "C"], [/histidine/, "H"], [/glutam(ate|ic)/, "E"], [/aspart(ate|ic)/, "D"],
  [/asparagine/, "N"], [/glutamine/, "Q"], [/proline/, "P"], [/glycine/, "G"], [/tryptophan/, "W"],
];

const CROSSLINK_PAIR = /interchain with ([A-Z])-(\d+)/i;

function ptmShort(f: UniprotFeatureItem): string {
  const d = lower(f.description);
  // A Trp–Trp cross-link between two chains is not a ubiquitination: "W33ub" was the label.
  if (lower(f.type) === "cross-link") {
    const pair = CROSSLINK_PAIR.exec(f.description ?? "");
    const aa = /\(([a-z]{3})-[a-z]{3}\)/i.exec(f.description ?? "")?.[1];
    const letter = aa ? one(aa) : RESIDUE_WORDS.find(([re]) => re.test(d))?.[1] ?? "";
    if (/ubiquitin/.test(d)) return `${letter}${f.start}ub`;
    if (/sumo/.test(d)) return `${letter}${f.start}su`;
    if (pair) return `${letter}${f.start}–${pair[1].toUpperCase()}${pair[2]}`;
    return `${letter}${f.start}xl`;
  }
  const aa = RESIDUE_WORDS.find(([re]) => re.test(d))?.[1] ?? "";
  if (d.includes("acetyl")) return `${aa}${f.start}ac`;
  if (d.includes("phospho")) return `${aa}${f.start}p`;
  if (d.includes("methyl")) return `${aa}${f.start}me`;
  if (d.includes("ubiquitin") || d.includes("sumo")) return `${aa}${f.start}ub`;
  if (lower(f.type) === "glycosylation") return `${aa}${f.start}gly`;
  return `${aa}${f.start}`;
}

/** "Cu cation" / "Zn(2+)" as the symbol the drawing can afford: Cu, Zn²⁺. */
function ligandShort(ligand: string): string {
  return ionText(ligand).replace(/\s*cation$/i, "").trim();
}

/**
 * Cross-link descriptions are ChEBI strings ("1-(tryptophan-3-yl)-tryptophan (Trp-Trp) (interchain with W-33)",
 * "Glycyl lysine isopeptide (Lys-Gly) (interchain with G-Cter in ubiquitin)"); a reader needs what is joined to what.
 */
function tidyCrosslink(description: string): string {
  const pair = /\(([A-Za-z]{3}-[A-Za-z]{3})\)/.exec(description)?.[1];
  const partner = CROSSLINK_PAIR.exec(description);
  if (/ubiquitin/i.test(description)) return "Isopeptide link to ubiquitin";
  const sumo = /sumo\d?/i.exec(description)?.[0];
  if (sumo) return `Isopeptide link to ${sumo.toUpperCase()}`;
  if (pair && partner) return `${pair} cross-link, interchain with ${partner[1].toUpperCase()}-${partner[2]}`;
  return description;
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

const distanceText = (d: number, covers: boolean) => (covers ? "0" : d > 0 ? `+${d}` : `−${Math.abs(d)}`);

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

  let substitution: AnnotationRow["substitution"] = null;
  let detail: string | null = null;
  if (group === "variants" || group === "mutagenesis") {
    const from = f.change?.from ?? "";
    const toAll = f.change?.to ?? [];
    const to = toAll[0] ?? "";
    substitution = f.change ? { from, to: toAll } : null;
    const fromOne = from.length === 1 ? from : "";
    const toOne = to.length === 1 ? to : "";
    // A multi-residue mutagenesis (UniProt: FG → EE at 51–52) used to read "Residue 51–52" with no substitution.
    const multi = from.length > 1 && from.length === to.length && f.end - f.start + 1 === from.length;
    if (fromOne && toOne) {
      name = `${title3(fromOne)}${f.start}${title3(toOne)}`;
      shortLabel = `${fromOne}${f.start}${toOne}`;
    } else if (multi) {
      name = Array.from(from).map((a, i) => `${title3(a)}${f.start + i}${title3(to[i])}`).join(", ");
      shortLabel = `${from}${f.start}${to}`;
    } else {
      name = `Residue ${f.start}${f.end !== f.start ? `–${f.end}` : ""}`;
      shortLabel = `${f.start}`;
    }
    if (group === "variants") {
      const v = variantNote(f.description || "");
      note = v.note;
      detail = v.detail;
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
    if (t === "cross-link") name = tidyCrosslink(f.description || "") || name;
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
    // Transmembrane, intramembrane and topological spans share one topology lane (outside / membrane /
    // inside); a signal peptide or propeptide stays an inset on the backbone.
    lane = ["transmembrane", "intramembrane", "topological domain"].includes(t) ? "membrane" : f.end !== f.start ? "region" : "below";
    note = f.type;
    // "Helical" says nothing on the drawing; the type is the label a reader scans for.
    shortLabel = t === "transmembrane" ? "TM" : t === "intramembrane" ? "IM" : t === "signal" ? "Signal" : f.description || f.type;
  } else {
    lane = "none";
  }

  if (t === "transmembrane" && f.description) {
    const tm = tidyTransmembrane(f.description);
    name = tm.name;
    shortLabel = tm.short;
  } else if (group === "sites") {
    const ligand = tidyLigand(f.description || "");
    if (ligand) {
      name = ligand;
      if (f.start === f.end) shortLabel = ligandShort(ligand.replace(/ binding$/, ""));
    }
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
    // ECO:0000269 on a site is an observation in this protein; on a natural variant it is a publication that
    // reports the change. "Experimental" there reads as a functional assay (PS3), which it is not.
    evidenceLabel: group === "variants" && level !== "none" ? "Reported" : EVIDENCE_LEVEL_LABEL[level],
    citation: citationFor(f),
    evidenceCodes: Array.from(new Set((f.evidence ?? []).map((e) => e.code))),
    lane,
    shortLabel,
    disease,
    substitution,
    detail,
    rowKey: `${t}-${f.start}-${f.end}-${idx}`,
    parts: [],
  };
}

function domainUrl(m: DomainMatch): string | null {
  if (m.interpro) return `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(m.interpro.id)}/`;
  if (m.database === "Pfam") return `https://www.ebi.ac.uk/interpro/entry/pfam/${encodeURIComponent(m.accession)}/`;
  return null;
}

/** What a match is drawn as. InterPro's entry type decides when it is known; the database is only the fallback. */
type MatchKind = "domain" | "structural" | "motif" | "family";
const MOTIF_ENTRY_TYPES = ["conserved_site", "binding_site", "active_site", "ptm"];

export function kindOfMatch(m: Pick<DomainMatch, "database" | "accession" | "entryType">): MatchKind {
  if (STRUCTURAL_DATABASES.includes(m.database)) return "structural";
  if (m.entryType) {
    if (MOTIF_ENTRY_TYPES.includes(m.entryType)) return "motif";
    // Only a member database that models a domain is drawn as one, and only when InterPro agrees it is a domain:
    // CDD, SUPFAM and PRINTS carry the same InterPro entry as Pfam and would draw it again.
    return DOMAIN_DATABASES.includes(m.database) && (m.entryType === "domain" || m.entryType === "repeat") ? "domain" : "family";
  }
  // No entry type (InterPro unread): PROSITE patterns are PS00xxx, profiles PS50xxx. A pattern is a short signature,
  // and was drawn as a domain box nested inside the Pfam box.
  if (m.database === "PROSITE" && /^PS00\d{3}$/.test(m.accession)) return "motif";
  return DOMAIN_DATABASES.includes(m.database) ? "domain" : "family";
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
    entryType: m.entryType ?? null,
    segments: [...m.locations].sort((a, b) => a.start - b.start || a.end - b.end),
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
    return { value: "Terminal, no regular structure", sub: pdbText, sentence: `It lies beyond the first or last helix or strand assigned in ${pdbText}.` };
  }
  const gapStart = before.end + 1;
  const gapEnd = after.start - 1;
  const n = gapEnd - gapStart + 1;
  const pair = before.kind === after.kind ? plural(before.kind) : `${word(before.kind)} and ${word(after.kind)}`;
  // A long gap is not evidence of a link: UniProt's secondary structure omits residues the map never
  // resolved, so only a short gap between two assigned elements is called a link.
  if (n > MAX_LINK) {
    return {
      value: "No helix or strand assigned",
      sub: `${gapStart}–${gapEnd} unassigned, ${pdbText}`,
      sentence: `It is in a ${n}-residue stretch with no helix or strand assigned in ${pdbText}; that may be flexible or simply unresolved.`,
    };
  }
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
  // UniProt names helices (Name=4) only for some entries. Where none is named, number them by position so
  // the drawing can label them, and say in the row that the number is ours.
  const tmRows = rows.filter((r) => r.type.toLowerCase() === "transmembrane").sort((a, b) => a.start - b.start);
  if (tmRows.length && tmRows.every((r) => !/^TM\d/.test(r.shortLabel))) {
    tmRows.forEach((r, i) => {
      r.name = `TM${i + 1}`;
      r.shortLabel = `TM${i + 1}`;
      r.note = "Transmembrane, numbered here by position";
    });
  }

  // Domains: InterPro member-database matches when UniParc answered, UniProt's own Domain features always.
  const matches = uniprot?.domainMatches ?? [];
  const interproMissing = !!uniprot && uniprot.domainMatchesStatus !== "ok";
  const boxesOf = (kind: ReturnType<typeof kindOfMatch>) => matches.filter((m) => kindOfMatch(m) === kind).map((m) => boxFromMatch(m, residue, length));
  const domainBoxes = boxesOf("domain");
  const structural = boxesOf("structural");
  const motifs = boxesOf("motif");
  const familyMatches = boxesOf("family");
  // A structural segment spanning 80% or more of the chain in one piece (Gene3D 2-154 of SOD1) places nothing; it
  // stays in the table and is not drawn. Two segments with a gap between them (NAE1) say something and are drawn.
  const structuralDrawn = structural.filter((b) => !b.segments.some((seg) => length > 0 && (seg.end - seg.start + 1) / length >= 0.8));
  const uniprotDomainBoxes: DomainBox[] = features
    .filter((f) => lower(f.type) === "domain")
    .map((f, i) => ({
      key: `uniprot-domain-${i}`,
      name: f.description || "Domain",
      source: "UniProtKB",
      accession: f.interproId ?? "",
      interpro: null,
      entryType: null,
      segments: [{ start: f.start, end: f.end }],
      covers: featureCoversResidue(f, residue),
      coverage: (f.end - f.start + 1) / length,
      url: f.interproId ? `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(f.interproId)}/` : null,
    }));
  // Draw InterPro domain boxes when there are any; else UniProt's. Both are listed in the table.
  const domains = domainBoxes.length ? domainBoxes : uniprotDomainBoxes;

  const domainRows: AnnotationRow[] = [...domainBoxes, ...structural, ...motifs].map((b) => {
    const nearest = b.segments.reduce((best, s) => {
      const d = signedDistance({ start: s.start, end: s.end }, residue);
      return Math.abs(d) < Math.abs(best) ? d : best;
    }, Number.POSITIVE_INFINITY);
    return {
      key: `match-${b.key}`,
      group: "domains" as const,
      name: b.name,
      note: `${b.interpro ? `${b.source} ${b.accession} · InterPro ${b.interpro.id}` : STRUCTURAL_DATABASES.includes(b.source) ? "Structural domain, CATH" : `${b.source} ${b.accession}`}${motifs.includes(b) ? " · conserved-site signature" : ""}${b.segments.length > 1 ? ` · ${b.segments.length} segments` : ""}`,
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
      substitution: null,
      detail: null,
      rowKey: `match-${b.key}`,
      parts: [],
    };
  });
  const allRows = [...domainRows, ...rows];

  // Natural variants: the drawing keeps one mark per variant, the table folds them to one row per residue
  // ("Ala5 -> Ser, Thr, Val", 3 reports) so 81 variants are not 81 rows that each repeat "In ALS1" and the level.
  const variantParts = rows.filter((r) => r.group === "variants");
  const foldedVariants: AnnotationRow[] = [];
  for (const at of Array.from(new Set(variantParts.map((r) => r.start))).sort((a, b) => a - b)) {
    const parts = variantParts.filter((r) => r.start === at);
    const first = parts[0];
    const tos = parts.map((r) => (r.substitution?.to[0] ? title3(r.substitution.to[0]) : "")).filter(Boolean);
    const from = first.substitution?.from;
    const notes = Array.from(new Set(parts.map((r) => r.note).filter((n): n is string => !!n)));
    const cites = parts.map((r) => r.citation).filter((c): c is NonNullable<AnnotationRow["citation"]> => !!c);
    const key = `variants-${at}`;
    const folded: AnnotationRow = {
      ...first,
      key,
      rowKey: key,
      name: from && tos.length ? `${title3(from)}${at} → ${tos.join(", ")}` : first.name,
      note: notes.join(" · ") || null,
      detail: null,
      evidenceCodes: Array.from(new Set(parts.flatMap((r) => r.evidenceCodes))),
      citation: cites.length ? { label: cites.length > 1 ? `${cites[0].label} +${cites.length - 1}` : cites[0].label, url: cites[0].url } : null,
      shortLabel: parts.map((r) => r.shortLabel).join(", "),
      disease: parts.some((r) => r.disease),
      lane: "none",
      parts,
    };
    foldedVariants.push(folded);
    for (const part of parts) part.rowKey = key;
  }
  const tableRows = [...domainRows, ...rows.filter((r) => r.group !== "variants"), ...foldedVariants];
  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    label: ANNOTATION_GROUP_LABEL[g],
    rows: tableRows.filter((r) => r.group === g).sort((a, b) => a.start - b.start || a.end - b.end),
    summary: null as string | null,
  })).filter((g) => g.rows.length > 0);

  const topo = groups.find((g) => g.group === "topology");
  if (topo) {
    const tm = topo.rows.filter((r) => r.type.toLowerCase() === "transmembrane").length;
    const im = topo.rows.filter((r) => r.type.toLowerCase() === "intramembrane").length;
    const parts = [tm ? `${tm} transmembrane segment${tm === 1 ? "" : "s"}` : "", im ? `${im} intramembrane` : ""].filter(Boolean);
    topo.summary = parts.length ? parts.join(", ") : null;
  }

  // "At the residue": anything covering it, except a family-level fold that covers most of the protein.
  const broad = (b: DomainBox) => b.coverage >= 0.8;
  const atResidue = allRows.filter((r) => {
    if (!r.covers) return false;
    if (r.group === "domains" && r.evidence === "match") {
      const box = [...domainBoxes, ...structural, ...motifs].find((b) => `match-${b.key}` === r.key);
      return box ? !broad(box) : true;
    }
    return r.group !== "composition";
  });
  // A topological span or region covering a third of the chain is context for the residue, not a site at it.
  const isBroadRow = (r: AnnotationRow) => r.group !== "domains" && !r.isPair && length > 0 && (r.end - r.start + 1) / length >= BROAD_SPAN;
  const contextAtResidue = atResidue.filter(isBroadRow);
  /** The first broad span covering the residue, if any: named so the trace never claims "no site or region" while earlier text says the residue lies in one. */
  const broadCover = contextAtResidue[0] ?? null;
  // A natural variant is not a functional annotation of the residue, and counting the query's own variant
  // ("Residue 5 carries 3 annotations: Ala5Ser and others") annotates the variant with itself.
  const specificAtResidue = atResidue.filter((r) => r.group !== "domains" && r.group !== "variants" && !isBroadRow(r));

  const secondaryStructure = uniprot?.secondaryStructure ?? [];
  const ssContext = structureContext(secondaryStructure, residue);

  const diseaseRows = rows.filter((r) => r.disease && r.start !== residue);
  const nearestDiseaseVariant = diseaseRows.length
    ? diseaseRows.reduce((a, b) => (Math.abs(b.distance) < Math.abs(a.distance) ? b : a))
    : null;
  // The exact change, not the first variant at the position: UniProt lists A5S, A5T and A5V at SOD1 residue 5,
  // and the finding named A5S for a query of A5V.
  const variantsHere = rows.filter((r) => r.group === "variants" && r.start === residue);
  const wt1 = one(input.wildType);
  const exactVariant = mut1
    ? variantsHere.find((r) => r.substitution?.to.includes(mut1) && (!r.substitution.from || !wt1 || r.substitution.from === wt1)) ?? null
    : null;
  const otherVariantsHere = variantsHere.filter((r) => r !== exactVariant);
  const sameResidueDisease = variantsHere.filter((r) => r.disease);

  // Density, so the reader sees a distribution rather than N identical marks.
  const perResidue = new Map<number, number>();
  for (const r of rows) if (r.disease) perResidue.set(r.start, (perResidue.get(r.start) ?? 0) + 1);
  const DENSEST_WINDOW = 15;
  const NEAR_WINDOW = 10;
  let densest: VariantDensity["densest"] = null;
  for (const start of perResidue.keys()) {
    let count = 0;
    for (let r2 = start; r2 < start + DENSEST_WINDOW; r2++) count += perResidue.get(r2) ?? 0;
    if (!densest || count > densest.count || (count === densest.count && start < densest.start)) densest = { start, end: Math.min(length, start + DENSEST_WINDOW - 1), count };
  }
  const density: VariantDensity = {
    total: rows.filter((r) => r.disease).length,
    residues: perResidue.size,
    atResidue: perResidue.get(residue) ?? 0,
    near: Array.from(perResidue.entries()).filter(([r2]) => Math.abs(r2 - residue) <= NEAR_WINDOW).reduce((n, [, c]) => n + c, 0),
    nearWindow: NEAR_WINDOW,
    densest,
    densestWindow: DENSEST_WINDOW,
  };
  const variantGroup = groups.find((g) => g.group === "variants");
  if (variantGroup && density.total > 0) {
    const poly = rows.filter((r) => r.group === "variants" && !r.disease).length;
    // The group's count is rows (residues); say how many variants those are, so "58" and "81" do not look like a mistake.
    variantGroup.summary = `${density.total} disease variant${density.total === 1 ? "" : "s"} at ${density.residues} residue${density.residues === 1 ? "" : "s"}${poly ? `, ${poly} polymorphism${poly === 1 ? "" : "s"}` : ""} · ${density.near} within ±${NEAR_WINDOW} of ${residue}${density.densest && density.total >= 12 ? ` · densest ${density.densest.start}–${density.densest.end} (${density.densest.count})` : ""}`;
  }

  // The processed protein's number: UniProt's chain starts after residue 1 (initiator Met removed, signal peptide
  // cleaved), and the literature often numbers from there (SOD1 p.Ala5Val is "A4V").
  const chains = (uniprot?.features ?? []).filter((f) => lower(f.type) === "chain");
  const chainStart = uniprot?.processedChain?.start ?? (chains.length === 1 ? chains[0].start : 0);
  const matureNumbering =
    chainStart > 1 && residue >= chainStart && Number.isFinite(residue)
      ? {
          residue: residue - chainStart + 1,
          label: `${wt1}${residue - chainStart + 1}${mut1}`,
          chainStart,
        }
      : null;

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

  // The finding. A broad fold-level match (a family or repeat covering most of the chain) says
  // little about one position and is never counted as the residue's domain — the same policy the
  // inspector states — so it surfaces as broad coverage instead of inflating this count.
  const coveringDomains = domains.filter(d => d.covers && !broad(d));
  /** The broad fold-level match over this residue, if any: never the residue's domain, but it is still where the residue sits. */
  const coveringBroad = domains.find(d => d.covers && broad(d)) ?? null;
  const coveringDomain = coveringDomains[0] ?? null;
  const domainPhrase = coveringDomain
    ? coveringDomains.length > 1 ? `within ${coveringDomains.length} covering domain annotations, including ${coveringDomain.name} (${coveringDomain.source}, ${segText(coveringDomain)})` : `inside the ${coveringDomain.name} (${coveringDomain.source}, ${segText(coveringDomain)})`
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
  } else if (coveringBroad) {
    // Only a broad fold-level match covers the residue: name it as what it is, without counting it
    // as the residue's domain or implying a specific annotation exists here.
    lead = `Residue ${residue} lies inside the ${coveringBroad.name} (${coveringBroad.source}, ${segText(coveringBroad)}) — a broad fold-level match that says little about one position — and no site, region or modification is annotated at it.`;
    sub = "inside a broad fold-level match, nothing annotated at the residue";
  } else if (variantsHere.length) {
    lead = `No site, region or modification is annotated at residue ${residue}.`;
    sub = "natural variants only";
  } else {
    lead = `UniProtKB annotates nothing at residue ${residue}.`;
    sub = domains.some(d => d.covers) ? "only broad fold-level coverage" : domains.length ? "outside every annotated domain" : "no domain, site or modification annotated here";
  }
  const restParts: string[] = [];
  if (uniprot && contextAtResidue.length) {
    const c = contextAtResidue[0];
    restParts.push(`It lies in the ${c.name.toLowerCase()} ${c.type.toLowerCase()} (${c.residuesText}), a broad span rather than a site.`);
  }
  const ssSentence = uniprot && ssContext ? ssContext.sentence : null;
  const ssAt = restParts.length;
  // D2: mutagenesis at this very residue is a different substitution, so it is named but never counted.
  const mutagenesisHere = rows.filter((r) => r.group === "mutagenesis" && r.start === residue && r.end === residue);
  if (mutagenesisHere.length) {
    const m = mutagenesisHere[0];
    restParts.push(`UniProt lists mutagenesis at this residue (${m.name}${m.note ? `: ${m.note.charAt(0).toLowerCase()}${m.note.slice(1)}` : ""}); it is a different substitution and is not counted for PM1.`);
  }
  const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  if (exactVariant) {
    const cite = exactVariant.citation ? `, ${exactVariant.citation.label}` : "";
    const what = exactVariant.disease
      ? `a disease variant (${[exactVariant.note, exactVariant.detail ? lowerFirst(exactVariant.detail) : null].filter(Boolean).join("; ")}${cite})`
      : `a polymorphism${cite ? ` (${cite.slice(2)})` : ""}`;
    restParts.push(`UniProt lists this exact change, ${exactVariant.name}, as ${what}.`);
    if (otherVariantsHere.length) {
      restParts.push(`Other changes here: ${otherVariantsHere.map((o) => o.name).join(", ")} (context, not scored).`);
    }
  } else if (sameResidueDisease.length) {
    restParts.push(`UniProt lists a different disease variant at this residue (${sameResidueDisease.map((o) => o.name).join(", ")}, ${sameResidueDisease[0].note}); this exact change is not listed.`);
  } else if (nearestDiseaseVariant)
    restParts.push(
      `The nearest known disease variant, ${nearestDiseaseVariant.name}, is ${Math.abs(nearestDiseaseVariant.distance)} residues ${nearestDiseaseVariant.distance < 0 ? "upstream" : "downstream"}.`
    );
  // The change itself comes before the fold it sits in; the neighbourhood sentence stays first when no variant is at the residue.
  if (ssSentence) restParts.splice(variantsHere.length ? restParts.length : ssAt, 0, ssSentence);

  // Facts: domain, structure, nearest disease variant, engine record.
  const facts: FunctionFact[] = [
    coveringDomain
      ? { label: "Domain", value: shortDomainName(coveringDomain.name), sub: `${coveringDomain.source} ${segText(coveringDomain)}, ${Math.round(coveringDomain.coverage * 100)}% of the protein` }
      : {
          label: "Domain",
          value: uniprot ? (coveringBroad ? `Broad ${coveringBroad.source} match` : "None at this residue") : "—",
          sub: uniprot
            ? [
                domains.length ? `${domains.length} annotated elsewhere` : null,
                coveringBroad ? `${shortDomainName(coveringBroad.name)}, ${Math.round(coveringBroad.coverage * 100)}% coverage — the residue's siting, not its domain` : null,
                structural.find((b) => b.covers && b.coverage >= 0.8) ? `only a whole-chain ${structural.find((b) => b.covers && b.coverage >= 0.8)!.source} segment covers it` : null,
              ]
                .filter(Boolean)
                .join(" · ") || (interproMissing ? "UniProtKB; InterPro not read" : "UniProtKB and InterPro")
            : availability.label,
        },
    ssContext
      ? { label: "Structure", value: ssContext.value, sub: ssContext.sub }
      : { label: "Structure", value: "Not annotated", sub: "no PDB-derived secondary structure" },
    nearestDiseaseVariant || sameResidueDisease.length
      ? exactVariant?.disease
        ? {
            label: "Disease variant here",
            value: exactVariant.shortLabel,
            sub: `${exactVariant.note ?? "UniProtKB"}${otherVariantsHere.length ? ` · ${otherVariantsHere.length} ${otherVariantsHere.length === 1 ? "other" : "others"} at ${residue}` : ""}`,
            mono: true,
          }
        : sameResidueDisease.length
        ? { label: "Same residue", value: sameResidueDisease.map((r) => r.shortLabel).join(", "), sub: `other changes, ${sameResidueDisease[0].note ?? "UniProtKB"}`, mono: true }
        : {
            label: "Nearest disease variant",
            value: nearestDiseaseVariant!.shortLabel,
            sub: `${Math.abs(nearestDiseaseVariant!.distance)} aa ${nearestDiseaseVariant!.distance < 0 ? "upstream" : "downstream"}`,
            mono: true,
          }
      : { label: "Disease variants", value: uniprot ? "None in UniProtKB" : "—", sub: uniprot ? "see Population data for ClinVar" : availability.label },
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
  if (coveringBroad) {
    caveats.push({
      lead: `A domain that spans ${Math.round(coveringBroad.coverage * 100)}% of the protein says little about this position.`,
      rest: "Being inside it is not a PM1 critical domain on its own, and not annotated is not the same as not functional.",
    });
  } else if (uniprot) {
    caveats.push({ lead: "Not annotated is not the same as not functional.", rest: "UniProtKB records what has been observed or inferred, not everything a residue does." });
  }
  if (interproMissing) caveats.push({ lead: "InterPro could not be read in this run.", rest: "Domains shown are UniProtKB's own annotation only." });
  else if (uniprot?.entryTypesStatus === "error") {
    caveats.push({ lead: "InterPro entry types were not read.", rest: "Matches are drawn by their member database's convention, so a family-level entry may appear as a domain." });
  }
  if (input.numberingBasis === "unverified") {
    caveats.push({ lead: "Residue numbering is unverified.", rest: "UniProt features are numbered on the canonical isoform; an overlap shown here may not hold for the analysed transcript." });
  }
  if (pm1.notCounted.length) {
    caveats.push({
      lead: `${pm1.notCounted[0].feature.type} at ${residue} not counted for PM1.`,
      rest: `Its evidence is ${EVIDENCE_LEVEL_LABEL[pm1.notCounted[0].level].toLowerCase()}, not an observation in this protein.`,
    });
  }
  if (matureNumbering) {
    caveats.push({
      lead: `Older literature may call this ${matureNumbering.label}.`,
      rest: `UniProt's chain starts at residue ${matureNumbering.chainStart}, so the processed protein numbers every residue ${matureNumbering.chainStart - 1} lower (residue ${residue} is ${matureNumbering.residue}). This page and the report use the canonical numbering.`,
    });
  }
  // A12: a protein dense with disease variants reads as a PM1 hot spot; PM1 here tests sites only.
  if (uniprot && density.total >= 10) {
    caveats.push({
      lead: `UniProtKB lists ${density.total} disease variants across ${density.residues} residues.`,
      rest: `${density.near} lie within ${density.nearWindow} residues of ${residue}. PM1's hot-spot reading, a cluster of pathogenic variants with no benign variation, is not tested here, so density alone is not read as PM1.`,
    });
  }
  // D1: PM1 asks for a region without benign variation but does not test it. Show the one population
  // measure the payload has, as context with no cut-point of its own.
  const rc = input.regionalConstraint;
  if (uniprot && rc && typeof rc.oeRatio === "number" && Number.isFinite(rc.oeRatio)) {
    caveats.push({
      lead: "Benign variation in the region is not tested for PM1.",
      rest: `For context, gnomAD observes missense variants at ${rc.oeRatio.toFixed(2)} of expectation${rc.regionText ? ` in the window ${rc.regionText}` : " in this residue's window"} (regional O/E; 1.0 is neutral). It is not used by PM1.`,
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
  // Metal ligation is a `Binding site` with an ion ligand since 2022; keying on the retired `Metal binding` type
  // told SOD1's reader "Not annotated: metal binding" beside eight Cu/Zn sites.
  if (features.some(isMetalBindingSite)) present.add("metal binding");
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
        : {
            text: coveringDomains.length > 1
              ? `${coveringDomains.length} domain annotations cover residue ${residue}: ${coveringDomains.map(d => `${d.name} (${d.source})`).join('; ')}.${broadCover ? ` A broad ${broadCover.type.toLowerCase()} spans it too.` : ' No site or region does.'}`
              : coveringDomain
                ? `Only the ${coveringDomain.name} covers residue ${residue}; ${broadCover ? `a broad ${broadCover.type.toLowerCase()} spans it too.` : 'no site or region does.'}`
                : broadCover
                  ? `No specific site is annotated at residue ${residue}; a broad ${broadCover.type.toLowerCase()} (${broadCover.residuesText}) spans it.`
                  : `No site, region or specific domain covers residue ${residue}.`,
            strong: "",
          }
      : { text: "Nothing is claimed about the residue until the record arrives.", strong: "" },
    {
      text: `PM1 tests active site, binding site, metal binding and disulfide cysteines at ${residue}, counting only evidence observed in this protein (experimental, structure or large-scale study): `,
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
    structuralDomains: structuralDrawn,
    motifs,
    interproMissing,
    rows: allRows,
    groups,
    atResidue,
    secondaryStructure,
    structureContext: ssContext,
    nearestDiseaseVariant,
    exactVariant,
    otherVariantsHere,
    density,
    matureNumbering,
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
