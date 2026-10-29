/**
 * interfacesEvidence.ts — the one model the Interfaces & PPI tab, its Evidence Lineage rail and the
 * Insights "Assembly" lane render.
 *
 * ONE QUESTION: does the variant residue sit where another protein touches this one, how well is
 * that attested, and with whom? Readings, never merged into one score:
 *   • curation     — UniProt SUBUNIT statements (each with its evidence qualifier), IntAct binary
 *                    interactions (with methods and studies), "Interaction with X" regions and sites;
 *   • observation  — interface residues in solved structures (PDBe-KB), with per-residue SUPPORT:
 *                    in how many of the pair's structures each residue is at the interface;
 *   • prediction   — a Boltz-2 complex model (on request), ipTM, the residue's contacts;
 *   • association  — STRING, physical sub-network first, functional network second;
 *   • binding      — DDMut-PPI ΔΔG_bind on a wild-type complex (solved first, model otherwise).
 *
 * INVARIANTS
 *   • No ACMG code is drawn from this tab; the engine record is "None", stated once.
 *   • "At an interface" always carries its support: "in 1 of 8 solved structures (7AIQ)". A residue
 *     seen at the interface in one structure of eight is not described like one seen in all eight.
 *   • Construct partners (MBP, T4 lysozyme …) are never counted as interfaces.
 *   • Observation and prediction that disagree are said to disagree, in words.
 *   • A model that was not run, is running or failed makes the predicted reading "not measured";
 *     it never turns into "not at an interface".
 *   • UniProt evidence qualifiers ("Probable") are shown with the statement they qualify; a partner
 *     named as a family ("other K-Cl cotransporters") is shown as unresolved, never guessed and
 *     never contradicted by "no curated interaction".
 *   • IntAct "experiments" are not replication: methods and distinct studies are shown instead.
 *   • A STRING score is association, never binding strength, drawn in neutral ink.
 *   • ΔΔG_bind carries DDMut-PPI's sign (≤ 0 weaker binding) and its error, not a class.
 *
 *   • Amyloid fibril structures are their own reading, never the native interface: chains stacked
 *     along a fibril axis touch at most of the core. SOD1 Ala5 is in 0 of 142 native structures and
 *     4 of 15 fibrils; the screen said "at the interface with the other SOD1 chain in 4 of 157".
 *   • Antibodies, nanobodies and chains with no UniProt record are set aside like construct tags, and
 *     a partner from another species is named with its species.
 *   • Every partner is counted once, whichever source named it first (SUBUNIT's "CCS" and PDBe's
 *     O14618 are one row).
 *   • The model groups and folds the partner list; the screen renders it. A long single-screen tail
 *     is one folded row listing its genes, never 60 rows repeating one sentence.
 *
 * REPLACED (doc/INTERFACES_PPI_REVIEW.md, SOD1 p.Ala5Val): fibril stacking read as the dimer
 * interface (and planned as a DDMut-PPI wild type); "NB1" and "Other" counted as partners; CCS
 * listed twice; mouse and yeast proteins unnamed as such; 120 partner rows, 66 of them one sentence.
 *
 * REPLACED (doc/INTERFACES_AUDIT.md): two tabs (Multimer assembly, Protein interactions) that each
 * answered "at an interface" from the same PDBe data, counted entries per partner instead of per
 * residue ("in 8 solved structures" for a residue at the interface in 1), called eight partners from
 * one yeast two-hybrid screen "Curated physical interaction · 3 experiments", dropped SUBUNIT's
 * "(Probable)" and its family-level heterodimer, cut STRING to a functional top five, and blocked
 * the binding change on a variant model that could not be built.
 */
import type {
  AnalysisResult,
  IntactEvidence,
  MultimerData,
  MultimerModelFailure,
  MultimerNotModelledReason,
  ObservedInterface,
  PpiBindingData,
  PpiBindingShift,
  PpiInteractionSite,
} from "./contracts.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";
import { drawnDomains } from "./functionEvidence.ts";
import { THRESHOLDS } from "./thresholds/constants.ts";
import { stringConfidenceLabel } from "./thresholds/evaluators.ts";
import { AMINO_ACID_1_TO_3_TITLE } from "./aminoAcids.ts";
import { HGVS_PATTERN } from "./variantNotation.ts";
import {
  interfaceFootprint,
  parseSubunitAssembly,
  subunitPartnerMentions,
  subunitStatements,
  variantContacts,
  type InterfaceContact,
  type SubunitStatement,
} from "./multimerAssembly.ts";

// ── Reference values ────────────────────────────────────────────────────────

export type IptmBand = "confident" | "grey" | "low";

/** AlphaFold-Multimer's published reading guide (EMBL-EBI), not a calibration; Boltz-2 has none of its own. */
export function iptmBand(iptm: number | null | undefined): IptmBand | null {
  if (iptm === null || iptm === undefined || !Number.isFinite(iptm)) return null;
  const C = THRESHOLDS.complexConfidence;
  if (iptm > C.iptmConfident) return "confident";
  if (iptm < C.iptmLow) return "low";
  return "grey";
}

export const IPTM_BAND_LABEL: Record<IptmBand, string> = {
  confident: "Confident interface",
  grey: "Uncertain",
  low: "Likely wrong",
};

/**
 * DDMut-PPI's reported performance (Zhou et al., NAR 2024;52:W207). The RMSE is what tells a reader
 * that a value of a few tenths of a kcal/mol is inside the method's error.
 */
export const DDMUT_PPI_RMSE = 1.33;
export const DDMUT_PPI_PERFORMANCE =
  "DDMut-PPI's authors report Pearson r 0.75 (RMSE 1.33 kcal/mol) leaving one complex out, and r 0.67 (RMSE 1.51 kcal/mol) leaving one binding site out. They publish no cut-point.";

export const NOT_MODELLED_REASON: Record<MultimerNotModelledReason, string> = {
  unstated: "UniProt states no assembly for this protein, so there is no complex to model.",
  "interactions-only": "UniProt lists binary interactions only, with no assembly to model.",
  complex: "The protein is one subunit of a larger complex whose composition UniProt does not state.",
  "heteromer-partner": "The partner named in the SUBUNIT record could not be resolved to exactly one UniProt entry.",
  "heteromer-stoichiometry": "Only heterodimers are modelled: a larger heteromer's copy numbers are not stated reliably.",
  "too-many-chains": "This app models at most four chains, and a partial ring is not the stated assembly.",
  "reference-mismatch": "The variant's reference residue does not match the UniProt sequence at that position.",
  "no-sequence": "The UniProt sequence could not be read.",
};

export const INTERFACES_SOURCES: Array<{ citation: string; doi?: string; url?: string }> = [
  { citation: "Varadi M, et al. PDBe-KB aggregated API (interface residues per UniProt accession). Bioinformatics 2021.", doi: "10.1093/bioinformatics/btab424" },
  { citation: "Del Toro N, et al. The IntAct database. Nucleic Acids Res 2022;50:D648.", doi: "10.1093/nar/gkab1006" },
  { citation: "Szklarczyk D, et al. The STRING database in 2023. Nucleic Acids Res 2023;51:D638.", doi: "10.1093/nar/gkac1000" },
  { citation: "Passaro S, et al. Boltz-2: towards accurate and efficient binding affinity prediction. bioRxiv 2025.", doi: "10.1101/2025.06.14.659707" },
  { citation: "Evans R, et al. Protein complex prediction with AlphaFold-Multimer. bioRxiv 2021 (ipTM defined).", doi: "10.1101/2021.10.04.463034" },
  { citation: "EMBL-EBI AlphaFold course: confidence scores in AlphaFold-Multimer (ipTM guidance).", url: "https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/confidence-scores-in-alphafold-multimer/" },
  { citation: "Zhou Y, Myung Y, Rodrigues CHM, Ascher DB. DDMut-PPI. Nucleic Acids Res 2024;52:W207.", doi: "10.1093/nar/gkae412" },
];

// ── Small helpers ───────────────────────────────────────────────────────────

function statementQualifier(sentence: string): string | null {
  const m = /\((Probable|By similarity|Potential)\)/i.exec(sentence);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const COUNT_WORD: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 12: "twelve" };
const bare = (acc: string | null | undefined) => (acc ?? "").toUpperCase().replace(/-\d+$/, "");
const rangeText = (s: { start: number; end: number }) => (s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`);
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function residueLabel(variant: string | undefined, position: number | null): string {
  const m = variant ? HGVS_PATTERN.exec(variant.replace(/^.*\((p\.[^)]+)\).*$/, "$1").trim()) : null;
  if (m) {
    const wt = m[1].length === 1 ? AMINO_ACID_1_TO_3_TITLE[m[1].toUpperCase()] ?? m[1] : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return `${wt}${m[2]}`;
  }
  return position ? `residue ${position}` : "the variant residue";
}

/** The STRING page for the query protein's network (the form STRING documents for linking). */
export function stringNetworkUrl(gene: string, partner?: string, physical = false): string {
  const ids = partner ? `${encodeURIComponent(gene)}%0d${encodeURIComponent(partner)}` : encodeURIComponent(gene);
  return `https://string-db.org/cgi/network?identifiers=${ids}&species=9606${physical ? "&network_flavor=evidence&network_type=physical" : ""}`;
}

export function rcsbUrl(pdbId: string): string {
  return `https://www.rcsb.org/structure/${pdbId.toUpperCase()}`;
}

/** "1 of 8 solved structures", "every one of 8 solved structures". */
export function supportText(k: number, n: number): string {
  if (n <= 0) return `${plural(k, "solved structure")}`;
  if (k >= n) return n === 1 ? "the one solved structure" : `all ${n} solved structures`;
  return `${k} of ${n} solved structures`;
}

// ── Model types ─────────────────────────────────────────────────────────────

export type LoadState = "loading" | "ready" | "error";

export interface AvailabilityView {
  state: "ok" | "empty" | "failed" | "skipped" | "pending" | "unknown";
  /** Chip text for a non-answer (ENGINE_STATE_LABELS); null when there is an answer. */
  label: string | null;
  reason: string | null;
}

export interface ObservedView extends ObservedInterface {
  /** Track and table name: "SOD1, other chain", "CCS", "Sod1 (mouse)", "SOD1 fibril". */
  label: string;
  /** Stable key shared by the track lane and the table row (linked highlight). */
  key: string;
  /** Entries showing the pair. */
  n: number;
  /** Entries showing the variant at this interface. */
  k: number;
  /** The best-supported residue of this interface, for context ("its core residues are seen in 5 of 8"). */
  maxSupport: number;
}

export interface ChainView {
  id: string;
  label: string;
  accession: string;
  carriesVariant: boolean;
  role: "self" | "partner";
}

export type ModelState = "built" | "not-requested" | "running" | "failed" | "not-modelled" | "not-applicable" | "pending";

export interface ModelView {
  state: ModelState;
  stateLabel: string | null;
  reason: string | null;
  failure: MultimerModelFailure | null;
  /** A transient fault: offer "Try again". */
  retryable: boolean;
  canRequest: boolean;
  iptm: number | null;
  ptm: number | null;
  band: IptmBand | null;
  contactsTotal: number;
  variantContacts: InterfaceContact[];
  footprint: number[];
  nearestInterfaceGap: number | null;
  provenance: string | null;
  hasCoordinates: boolean;
  homomeric: boolean;
  chainCount: number;
}

export type InterfaceVerdict = "at-interface" | "not-at-interface" | "not-measured" | "pending";

export interface InterfaceView {
  verdict: InterfaceVerdict;
  /** Chip text: "At an interface", "No contact", "Not measured", "Running". */
  label: string;
  /** "1 of 8 solved structures", "In the predicted complex" … */
  support: string;
  /** Observed support of the best-attested partner at the variant, when observed. */
  observed: { k: number; n: number; partner: string; entries: string[]; maxSupport: number } | null;
  /**
   * When the residue is not at a native interface: the interface it was tested against, so the screen
   * can say "0 of 142" rather than a bare "No contact".
   */
  reference: { n: number; partner: string } | null;
  /** The nearest residue at that interface in at least half as many structures as its best residue. */
  nearest: { residue: number; name: string; support: number; n: number; gap: number } | null;
  /** The residue in amyloid fibril structures, read apart from the native interface. */
  fibril: { k: number; n: number; entries: string[]; sentence: string } | null;
  /** The residue at a crystal-packing contact (the entry's biological assembly is a monomer). */
  crystal: { k: number; n: number; entries: string[]; sentence: string } | null;
  /** Observation and prediction disagree: one sentence saying how. */
  disagreement: string | null;
  /** Construct-tag interfaces at the variant, set aside: one sentence. */
  setAside: string | null;
}

export type PartnerGroup = "assembly" | "structural" | "curated" | "screen" | "physical" | "functional";

export const PARTNER_GROUP_LABEL: Record<PartnerGroup, { title: string; meta: string }> = {
  assembly: { title: "Assembly", meta: "Named in UniProt's SUBUNIT record" },
  structural: { title: "Seen in solved structures", meta: "PDBe-KB interfaces" },
  curated: { title: "Reported binding", meta: "UniProt or IntAct, beyond a single two-hybrid screen" },
  screen: { title: "Binary screen only", meta: "IntAct, two-hybrid in one study" },
  physical: { title: "Physical association only", meta: "STRING physical sub-network, no curated binding" },
  functional: { title: "Functional association only", meta: "STRING, no physical evidence" },
};

/**
 * The two bands the partner list is read in: binding evidence (a curated, structural or screened
 * claim that the two proteins actually bind) and association only (STRING physical/functional,
 * which is not a binding strength). The tier chart and the grid group headers share this map, so a
 * reader sees the same hierarchy in both.
 */
export const PARTNER_BANDS: Record<PartnerGroup, "binding" | "association"> = {
  assembly: "binding",
  structural: "binding",
  curated: "binding",
  screen: "binding",
  physical: "association",
  functional: "association",
};

export const PARTNER_BAND_LABEL: Record<"binding" | "association", { title: string; meta: string }> = {
  binding: { title: "Binding evidence", meta: "a curated, structural or screened claim that the two proteins bind" },
  association: { title: "Association only", meta: "STRING association, not a binding strength" },
};

export interface StringCell {
  score: number | null;
  band: string | null;
  /** When `score` is null: why ("None ≥ 0.15", "Not in STRING's top 500", "Not read"). */
  note: string | null;
}

export interface PartnerRow {
  key: string;
  gene: string;
  accession: string | null;
  group: PartnerGroup;
  /** One line: "Assembly partner (probable)", "Yeast two-hybrid · 1 study (PubMed 32296183)". */
  evidence: string;
  qualifier: string | null;
  /** Unresolved family claim: no gene, no accession, no columns. */
  family: boolean;
  /** Named as a binder in a SUBUNIT sentence that states no assembly ("Binds APP and TP53BP2"). */
  subunitNamed: boolean;
  intact: IntactEvidence | null;
  intactExperiments: number | null;
  observed: ObservedView | null;
  sites: PpiInteractionSite[];
  physical: StringCell;
  functional: StringCell;
  variantInSite: boolean;
  variantAtObservedInterface: boolean;
  /** The partner's species when it is not human ("mouse", "Baker's yeast", "other species"). */
  organism: string | null;
}

/** One evidence tier of the partner list, as the screen draws it: shown rows, a folded tail, a count. */
export interface PartnerGroupView {
  id: PartnerGroup;
  title: string;
  meta: string;
  /** Every partner of this tier the payloads hold (shown, folded and hidden). */
  total: number;
  /** STRING's list reached its cap, so the tier holds more than `total`. */
  capped: boolean;
  rows: PartnerRow[];
  /** Rows folded behind one summary line; the screen lists them as names on request. */
  folded: { rows: PartnerRow[]; summary: string } | null;
  /** STRING-only rows not carried at all (beyond the shown few); counted, linked to STRING. */
  hidden: number;
}

export interface TrackLane {
  key: string;
  kind: "topology" | "domains" | "sites" | "solved" | "predicted";
  label: string;
  sub: string;
  /** Ranges: topology segments, domains/regions, mapped sites. */
  ranges: Array<{ start: number; end: number; kind: string; name: string; hit: boolean }>;
  /** Residue marks with support 0–1 (solved: k/n; predicted: 1). */
  marks: Array<{ residue: number; weight: number; title: string }>;
  hit: boolean;
  /** Solved lanes: the variant residue's own support, "4/15", shown at the lane's end. */
  readout: { k: number; n: number } | null;
  /** The table row this lane is (observed partners), for the linked highlight. */
  rowKey: string | null;
  /** Accessible summary. */
  summary: string;
}

export type BindingState = "ok" | "running" | "failed" | "not-applicable" | "ready" | "pending" | "unavailable";

export interface BindingView {
  state: BindingState;
  stateLabel: string | null;
  reason: string | null;
  value: number | null;
  valueText: string | null;
  direction: "weaker" | "stronger" | "none" | null;
  directionText: string | null;
  /** |value| below DDMut-PPI's RMSE. */
  withinError: boolean;
  wildType: PpiBindingShift["wildType"];
  /** What a request will use, said before it runs. */
  plan: string | null;
  canRequest: boolean;
}

export interface TraceStep {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  /**
   * The source behind this step has not answered ("pending"), answered ("done") or failed
   * ("failed"). The rail draws it; `warn` is kept for the failed flag it already carried.
   */
  state: "done" | "pending" | "failed";
}

export interface InterfacesEvidence {
  status: { assembly: LoadState | "stale"; lookups: LoadState };
  gene: string;
  uniprotId: string | null;
  position: number | null;
  residueLabel: string;
  sequenceLength: number | null;
  assembly: {
    kind: string;
    label: string;
    copies: number | null;
    homoAssumed: boolean;
    qualifier: string | null;
    subunitText: string | null;
    statements: SubunitStatement[];
    partners: Array<{ gene: string; accession: string | null; resolvedBy: string | null }>;
    composition: string;
  };
  chains: ChainView[];
  observed: {
    availability: AvailabilityView;
    /** Native interfaces with biological partners: the ones the verdict reads. */
    partners: ObservedView[];
    /** The same pairs in amyloid fibril structures. */
    fibrils: ObservedView[];
    /** The same pairs where the entry's biological assembly is a monomer: crystal packing. */
    crystals: ObservedView[];
    /** Construct tags, tool antibodies, unmapped chains: shown, never counted. */
    artefacts: ObservedView[];
    /** What the table draws: the first few set-aside chains; the rest fold behind one line. */
    artefactsShown: ObservedView[];
    artefactsFold: { rows: ObservedView[]; summary: string } | null;
    /** False when RCSB could not be read, so fibril entries may sit among the native ones. */
    fibrilsChecked: boolean;
  };
  model: ModelView;
  interface: InterfaceView;
  sites: PpiInteractionSite[];
  sections: { uniprot: AvailabilityView; intact: AvailabilityView; stringPhysical: AvailabilityView; stringFunctional: AvailabilityView };
  /** Rows shown by default, in group order (folded and hidden rows excluded). */
  partners: PartnerRow[];
  /** The partner list by tier, with counts, folds and STRING tails: what the screen draws. */
  groups: PartnerGroupView[];
  /** Partner rows hidden from the grid (long STRING tails), per group. */
  hiddenPartners: Partial<Record<PartnerGroup, number>>;
  columns: { solved: boolean; site: boolean };
  track: TrackLane[];
  binding: BindingView;
  finding: { chip: string; chipTone: "neutral" | "muted"; headline: string; predicate: string; context: string | null };
  facts: Array<{ label: string; value: string; sub: string; mono?: boolean }>;
  trace: TraceStep[];
  string: { version: string | null; limit: number | null; minScore: number | null; bands: Array<{ id: string; count: number }> };
  stringUrl: string | null;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface BuildInterfacesInput {
  result: AnalysisResult;
  /** Assembly + solved interfaces (+ model when requested): `POST /structure/multimer`. */
  assembly: MultimerData | null;
  assemblyStatus: LoadState;
  assemblyError?: string | null;
  /** True while a model request is in flight (including polling a running job). */
  modelRequested?: boolean;
  /** Partners, IntAct, STRING, sites: `POST /ppi/binding-affinity`. */
  ppi: PpiBindingData | null;
  ppiStatus: LoadState;
  ppiError?: string | null;
  shift: PpiBindingShift | null;
  shiftLoading: boolean;
  shiftError?: string | null;
}

/**
 * A stored assembly payload that predates per-residue support, the assembly record or the fibril split
 * is not rendered: it may count fibril stacking as the native interface.
 */
export function isStaleAssembly(d: MultimerData | null | undefined): boolean {
  if (!d) return false;
  if (!d.assembly) return true;
  const partners = d.experimental?.partners ?? [];
  return (
    partners.some(p => !Array.isArray((p as any).support) || !Array.isArray((p as any).variantEntries) || !("context" in p)) ||
    // A payload written before the crystal-packing split carries no verdict on it: re-read once, then
    // trust the recorded `crystalChecked` (including `false` when RCSB did not answer) so a failed
    // RCSB lookup does not make the assembly re-read forever.
    (partners.length > 0 && (d.experimental as any)?.crystalChecked === undefined)
  );
}

/** A stored PPI payload from before IntAct evidence and the STRING lists is re-read, not rendered. */
export function isStalePpi(d: PpiBindingData | null | undefined): boolean {
  return Boolean(d) && !(d!.lookups && "intact" in d!.lookups && d!.string);
}

function availability(
  status: string | undefined,
  hasItems: boolean,
  pending: boolean,
  words: { failed: string; skipped?: string; empty: string; unknown: string }
): AvailabilityView {
  if (pending) return { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null };
  if (status === "ok") return hasItems ? { state: "ok", label: null, reason: null } : { state: "empty", label: ENGINE_STATE_LABELS["no-result"], reason: words.empty };
  if (status === "none") return { state: "empty", label: ENGINE_STATE_LABELS["no-result"], reason: words.empty };
  if (status === "failed" || status === "error") return { state: "failed", label: ENGINE_STATE_LABELS["upstream-error"], reason: words.failed };
  if (status === "skipped") return { state: "skipped", label: ENGINE_STATE_LABELS["not-covered"], reason: words.skipped ?? words.unknown };
  return { state: "unknown", label: ENGINE_STATE_LABELS["no-result"], reason: words.unknown };
}

function intactLine(e: IntactEvidence | null, experiments: number | null, intactRead: boolean): string {
  if (!e || !e.methods.length) {
    // IntAct answered and holds no row for the pair (often a different isoform or species entry): say that, not "not read".
    if (experiments === null) return "IntAct binary interaction";
    return intactRead
      ? `UniProt: ${plural(experiments, "experiment")}; IntAct gave no method for this pair`
      : `IntAct binary interaction (${plural(experiments, "assay")}, methods not read)`;
  }
  const studies = e.pubmed.length;
  const method = e.twoHybridOnly ? "Yeast two-hybrid" : e.methods.slice(0, 2).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(", ") + (e.methods.length > 2 ? ` +${e.methods.length - 2}` : "");
  return `${method} · ${studies === 1 ? `1 study (PubMed ${e.pubmed[0]})` : plural(studies, "study", "studies")}`;
}

/** Track and table name of a solved partner: "SOD1, other chain", "CCS", "Sod1 (mouse)", "SOD1 fibril". */
function observedLabel(p: ObservedInterface, gene: string): string {
  const name = p.gene ?? p.name;
  if (p.context === "fibril") return `${p.homomeric ? gene : name} fibril`;
  if (p.context === "crystal") return `${p.homomeric ? gene : name} (outside the assembly)`;
  return p.homomeric ? `${gene}, other chain` : p.organism ? `${name} (${p.organism.toLowerCase()})` : name;
}

/**
 * Native interface support at every residue, for views that read residues other than the queried one.
 *
 * The same partners the Interfaces tab counts as native (not a tool binder or construct tag, not an amyloid
 * fibril, not crystal packing outside the assembly), each with the number of solved structures that place a
 * residue at the interface and the number that show the pair, so a residue reads "104 of 118" and never
 * "at the interface".
 *   - `unavailable`: no assembly was read, or the stored one predates per-residue support. Not a negative.
 *   - `none`: the service answered and no native interface is observed for this protein. Every residue is then
 *     measured as not at one.
 */
export interface NativeInterfaceSupport {
  status: "ok" | "none" | "unavailable";
  reason: string | null;
  /** Residues with support from at least one native partner, with that partner's label and counts, best first. */
  byResidue: ReadonlyMap<number, ReadonlyArray<{ label: string; k: number; n: number }>>;
}

export function nativeInterfaceSupport(assembly: MultimerData | null | undefined, gene: string): NativeInterfaceSupport {
  const none = new Map<number, never[]>();
  if (!assembly) return { status: "unavailable", reason: "The assembly was not read.", byResidue: none };
  if (isStaleAssembly(assembly)) return { status: "unavailable", reason: "The stored assembly predates per-residue support and is being re-read.", byResidue: none };
  const exp = assembly.experimental;
  if (exp?.status !== "ok") return { status: "unavailable", reason: "PDBe-KB interfaces were not read for this protein.", byResidue: none };
  const native = exp.partners.filter(p => !p.artefact && p.context !== "fibril" && p.context !== "crystal");
  if (!native.length) return { status: "none", reason: null, byResidue: none };
  const byResidue = new Map<number, Array<{ label: string; k: number; n: number }>>();
  for (const p of native) {
    p.residues.forEach((residue, i) => {
      const k = p.support[i] ?? 0;
      if (k <= 0) return;
      const list = byResidue.get(residue) ?? [];
      list.push({ label: observedLabel(p, gene), k, n: p.pdbEntries.length });
      byResidue.set(residue, list);
    });
  }
  for (const list of byResidue.values()) list.sort((a, b) => b.k / Math.max(1, b.n) - a.k / Math.max(1, a.n) || b.k - a.k);
  return { status: "ok", reason: null, byResidue };
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildInterfacesEvidence(input: BuildInterfacesInput): InterfacesEvidence {
  const { result } = input;
  const md: any = (result as any)?.metadata ?? {};
  const features: any = (result as any)?.uniprotFeatures ?? null;
  const gene: string = md.gene ?? input.assembly?.gene ?? input.ppi?.gene ?? "This protein";
  const uniprotId: string | null = md.uniprotId ?? input.assembly?.uniprotId ?? input.ppi?.uniprotId ?? null;

  const staleAsm = isStaleAssembly(input.assembly);
  const asmData = input.assembly && !staleAsm ? input.assembly : null;
  const ppi = input.ppi && !isStalePpi(input.ppi) ? input.ppi : null;
  const asmLoading = input.assemblyStatus === "loading" && !asmData;
  const ppiLoading = input.ppiStatus === "loading" && !ppi;

  const position: number | null =
    asmData?.variantPosition ?? ppi?.position ?? (Number.isFinite(md.residueIndex) && md.residueIndex > 0 ? md.residueIndex : null);
  const resLabel = residueLabel(md.variant, position);
  const sequenceLength: number | null = features?.sequenceLength ?? ppi?.sequenceLength ?? null;

  // ── Curation: SUBUNIT ──────────────────────────────────────────────────
  const subunitText: string | null = asmData?.subunitComment ?? ppi?.subunitComment ?? features?.subunitComment ?? null;
  const parsed = parseSubunitAssembly(subunitText, gene);
  const rec = asmData?.assembly ?? {
    ...parsed,
    partners: parsed.kind === "heteromer" ? parsed.partnerGenes.map(g => ({ gene: g, accession: null as string | null, resolvedBy: null as string | null })) : [],
  };
  const statements: SubunitStatement[] = (asmData?.assembly?.statements as SubunitStatement[] | undefined) ?? subunitStatements(subunitText, gene);
  const qualifier = (rec as any).qualifier ?? parsed.qualifier ?? null;
  const composition =
    rec.kind === "monomer" ? "a single chain"
    : rec.kind === "homomer" ? `${COUNT_WORD[rec.copies ?? 0] ?? rec.copies} identical chains`
    : rec.kind === "heteromer" ? (rec.partners.length ? `with ${rec.partners.map(p => p.gene).join(" and ")}` : `${COUNT_WORD[rec.copies ?? 0] ?? "several"} different chains`)
    : rec.kind === "complex" ? "part of a larger complex"
    : rec.kind === "interactions-only" ? "binding partners listed, no assembly"
    : subunitText ? "no assembly in the record" : "no SUBUNIT record";

  // ── Observation: PDBe-KB ───────────────────────────────────────────────
  const exp = asmData?.experimental;
  const allObserved: ObservedView[] = (exp?.status === "ok" ? exp.partners : []).map(p => {
    const n = p.pdbEntries.length;
    const fibril = p.context === "fibril";
    const crystal = p.context === "crystal";
    return {
      ...p,
      label: observedLabel(p, gene),
      key: `solved:${p.accession}:${p.context ?? "native"}`,
      n,
      k: p.variantEntries.length,
      maxSupport: p.support.length ? Math.max(...p.support) : 0,
    };
  });
  const observedPartners = allObserved.filter(p => !p.artefact && p.context !== "fibril" && p.context !== "crystal");
  const fibrilPartners = allObserved.filter(p => !p.artefact && p.context === "fibril");
  const crystalPartners = allObserved.filter(p => !p.artefact && p.context === "crystal");
  // One row per non-biological chain, whichever entries it came from (PDBe's "Other" spans fibrils and crystals).
  const artefacts: ObservedView[] = [];
  for (const p of allObserved.filter(o => o.artefact)) {
    const seen = artefacts.find(a => a.accession === p.accession);
    if (!seen) artefacts.push({ ...p, key: `solved:${p.accession}:set-aside` });
    else {
      const entries = [...new Set([...seen.pdbEntries, ...p.pdbEntries])].sort();
      Object.assign(seen, { pdbEntries: entries, n: entries.length, variantAtInterface: seen.variantAtInterface || p.variantAtInterface, variantEntries: [...new Set([...seen.variantEntries, ...p.variantEntries])] });
    }
  }
  // Density budget for set-aside chains: a handful are worth showing; a screen of construct tags and
  // unmapped chains folds behind one line (SOD1's set is two, so nothing folds there).
  const SET_ASIDE_SHOWN = 4;
  const artefactsShown = artefacts.slice(0, SET_ASIDE_SHOWN);
  const artefactsFold = artefacts.length > SET_ASIDE_SHOWN
    ? { rows: artefacts.slice(SET_ASIDE_SHOWN), summary: `${plural(artefacts.length - SET_ASIDE_SHOWN, "more chain")} set aside: construct tags, tool binders or unmapped chains, not biological and not counted` }
    : null;
  const observedAvail = availability(
    // A failed assembly service (no payload at all) is a provider failure, not "not read yet":
    // otherwise the trace says "Solved structures have not been read" forever after a failed run.
    exp?.status ?? (input.assemblyStatus === "error" && !asmData ? "failed" : undefined),
    observedPartners.length > 0,
    asmLoading,
    {
      failed: exp && exp.status === "error" && exp.reason ? exp.reason : "PDBe did not answer, so solved structures were not checked.",
      empty: `PDBe records no protein–protein interface for ${gene} in any solved structure.`,
      unknown: "Solved structures have not been read for this variant yet.",
    }
  );
  if (observedAvail.state === "ok" && observedPartners.length === 0 && (artefacts.length || fibrilPartners.length || crystalPartners.length)) {
    const nonNative: string[] = [];
    if (fibrilPartners.length) nonNative.push("amyloid fibril stacking");
    if (crystalPartners.length) nonNative.push("contacts outside a deposited monomer assembly");
    Object.assign(observedAvail, {
      state: "empty",
      label: ENGINE_STATE_LABELS["no-result"],
      reason: nonNative.length
        ? `Solved structures of ${gene} show no native interface with another protein; only ${nonNative.join(" and ")}${artefacts.length ? ", and non-biological partners" : ""}.`
        : `The only interfaces in solved structures of ${gene} are with construct tags, antibodies or unmapped chains, which are not counted.`,
    });
  }

  // ── Chains (diagram) ───────────────────────────────────────────────────
  let chains: ChainView[];
  if (asmData?.chains?.length) {
    chains = asmData.chains.map(c => ({
      id: c.id,
      label: c.gene ?? c.accession,
      accession: c.accession,
      carriesVariant: c.carriesVariant,
      role: bare(c.accession) === bare(uniprotId) ? "self" : "partner",
    }));
  } else {
    const n = rec.kind === "homomer" ? Math.min(rec.copies ?? 2, 12) : rec.kind === "heteromer" ? Math.max(2, Math.min(rec.copies ?? 2, 12)) : 1;
    chains = Array.from({ length: n }, (_, i) => {
      const isPartner = rec.kind === "heteromer" && i > 0;
      const g = isPartner ? rec.partners[i - 1]?.gene ?? null : gene;
      return {
        id: String.fromCharCode(65 + i),
        label: g ?? "Partner",
        accession: isPartner ? rec.partners[i - 1]?.accession ?? "" : uniprotId ?? "",
        carriesVariant: i === 0,
        role: isPartner ? "partner" : "self",
      } as ChainView;
    });
  }

  // ── Prediction: Boltz-2 ────────────────────────────────────────────────
  const homomeric = rec.kind === "homomer";
  const contacts = asmData?.status === "success" ? asmData.interfaceContacts ?? [] : [];
  const vContacts = variantContacts(contacts, position, homomeric);
  const footprint = interfaceFootprint(contacts, homomeric);
  const failure = asmData?.failure ?? null;
  const retryable = Boolean(failure && (failure.kind === "timeout" || failure.kind === "network" || failure.kind === "http" || failure.kind === "no-model")) || (asmData?.status === "failed" && !failure);
  const model: ModelView = {
    state: "not-requested",
    stateLabel: null,
    reason: null,
    failure,
    retryable,
    canRequest: false,
    iptm: asmData?.status === "success" ? asmData.ipTm : null,
    ptm: asmData?.status === "success" ? asmData.pTm : null,
    band: asmData?.status === "success" ? iptmBand(asmData.ipTm) : null,
    contactsTotal: contacts.length,
    variantContacts: vContacts,
    footprint,
    nearestInterfaceGap: position && footprint.length && !vContacts.length ? Math.min(...footprint.map(r => Math.abs(r - position))) : null,
    provenance: asmData?.provenance ?? null,
    hasCoordinates: Boolean(asmData?.complexPdb),
    homomeric,
    chainCount: chains.length,
  };
  const modelChains = chains.length;
  if (asmLoading) {
    Object.assign(model, { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "Reading the assembly." });
  } else if (input.assemblyStatus === "error" && !asmData) {
    Object.assign(model, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: input.assemblyError ?? "The assembly service did not answer.", retryable: true });
  } else if (asmData?.status === "success") {
    model.state = "built";
  } else if (asmData?.status === "running" || (input.modelRequested && asmData?.status !== "failed")) {
    Object.assign(model, {
      state: "running",
      stateLabel: ENGINE_STATE_LABELS.running,
      reason: `Boltz-2 is modelling ${plural(modelChains, "chain")}. A large complex can take several minutes; the job is followed, not restarted.`,
    });
  } else if (asmData?.status === "failed") {
    Object.assign(model, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: asmData.error ?? "The complex prediction did not return a model." });
  } else if (asmData?.status === "monomeric") {
    Object.assign(model, { state: "not-applicable", stateLabel: ENGINE_STATE_LABELS["not-covered"], reason: "A monomer has no subunit interface to model." });
  } else if (asmData?.status === "not-modelled") {
    Object.assign(model, {
      state: "not-modelled",
      stateLabel: ENGINE_STATE_LABELS["not-installed"],
      reason: asmData.notModelledReason ? NOT_MODELLED_REASON[asmData.notModelledReason] : "This assembly is not modelled here.",
    });
  } else if (asmData?.status === "not-requested") {
    Object.assign(model, {
      state: "not-requested",
      stateLabel: null,
      reason: `Not run. Boltz-2 can model the ${rec.label.toLowerCase()} (${plural(modelChains, "chain")}, variant on chain A). It is a GPU job${observedPartners.length ? ", and solved structures already answer whether the residue is at an interface" : ""}.`,
    });
  } else if (staleAsm) {
    Object.assign(model, { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "A stored result predates per-structure support; reading it again." });
  }
  model.canRequest = model.state === "not-requested" || (model.state === "failed" && model.retryable && Boolean(asmData?.chains?.length));

  // ── Interface verdict ──────────────────────────────────────────────────
  const hits = observedPartners.filter(p => p.variantAtInterface).sort((a, b) => b.k / Math.max(1, b.n) - a.k / Math.max(1, a.n) || b.k - a.k);
  const best = hits[0] ?? null;
  const artefactHits = artefacts.filter(p => p.variantAtInterface);
  const setAside = artefactHits.length
    ? `A contact at ${resLabel} with ${artefactHits.map(a => `${a.name} (${a.artefact})`).join(" and ")} is not a biological interface and is not counted.`
    : null;

  // The fibril reading, apart from the native one.
  const fibrilHit = [...fibrilPartners].filter(p => p.variantAtInterface).sort((a, b) => b.k - a.k)[0] ?? null;
  const fibril = fibrilHit
    ? {
        k: fibrilHit.k,
        n: fibrilHit.n,
        entries: fibrilHit.variantEntries,
        sentence:
          `In ${fibrilHit.k >= fibrilHit.n ? (fibrilHit.n === 1 ? "the one" : `all ${fibrilHit.n}`) : `${fibrilHit.k} of ${fibrilHit.n}`} amyloid fibril structure${fibrilHit.n === 1 ? "" : "s"} ` +
          `(${fibrilHit.variantEntries.slice(0, 4).map(e => e.toUpperCase()).join(", ")}${fibrilHit.variantEntries.length > 4 ? "…" : ""}) ${resLabel} touches a neighbouring chain of the fibril. ` +
          "Fibril stacking is not a native interface, so it is read apart.",
      }
    : null;

  // Crystal packing, apart from the native interface: an entry whose biological assembly is a
  // monomer shows the contact only because of how the crystal packs, so it is not counted.
  const crystalHit = [...crystalPartners].filter(p => p.variantAtInterface).sort((a, b) => b.k - a.k)[0] ?? null;
  const crystal = crystalHit
    ? {
        k: crystalHit.k,
        n: crystalHit.n,
        entries: crystalHit.variantEntries,
        sentence:
          `In ${crystalHit.k >= crystalHit.n ? (crystalHit.n === 1 ? "the one" : `all ${crystalHit.n}`) : `${crystalHit.k} of ${crystalHit.n}`} solved structure${crystalHit.n === 1 ? "" : "s"} ` +
          `(${crystalHit.variantEntries.slice(0, 4).map(e => e.toUpperCase()).join(", ")}${crystalHit.variantEntries.length > 4 ? "…" : ""}) ${resLabel} touches another chain outside the deposited assembly (a monomer), so it is read apart. ` +
          "The biological assembly of that entry is a monomer, so this is not a native interface and is not counted.",
      }
    : null;

  // What the residue was tested against when it is not at a native interface, and its nearest core neighbour.
  const seq: string = typeof md.sequence === "string" ? md.sequence : "";
  const residueName = (r: number) => (seq[r - 1] && AMINO_ACID_1_TO_3_TITLE[seq[r - 1].toUpperCase()] ? `${AMINO_ACID_1_TO_3_TITLE[seq[r - 1].toUpperCase()]}${r}` : `residue ${r}`);
  const referencePartner =
    observedPartners.find(p => p.homomeric && rec.kind === "homomer") ?? [...observedPartners].sort((a, b) => b.n - a.n)[0] ?? null;
  let nearest: InterfaceView["nearest"] = null;
  if (referencePartner && position !== null && !referencePartner.variantAtInterface) {
    const core = referencePartner.residues
      .map((r, i) => ({ r, s: referencePartner.support[i] }))
      .filter(x => x.s * 2 >= referencePartner.maxSupport)
      .sort((a, b) => Math.abs(a.r - position) - Math.abs(b.r - position) || b.s - a.s)[0];
    if (core) nearest = { residue: core.r, name: residueName(core.r), support: core.s, n: referencePartner.n, gap: Math.abs(core.r - position) };
  }
  const reference = referencePartner ? { n: referencePartner.n, partner: referencePartner.label } : null;

  let iface: InterfaceView;
  if (asmLoading || staleAsm) {
    iface = { verdict: "pending", label: ENGINE_STATE_LABELS.running, support: "Reading solved structures", observed: null, reference: null, nearest: null, fibril: null, crystal: null, disagreement: null, setAside };
  } else if (best) {
    const disagreement = model.state === "built" && !vContacts.length
      ? `The predicted complex places ${resLabel} outside its interface; the solved structures are the stronger evidence.`
      : null;
    iface = {
      verdict: "at-interface",
      label: "At an interface",
      support: supportText(best.k, best.n),
      observed: { k: best.k, n: best.n, partner: best.label, entries: best.variantEntries, maxSupport: best.maxSupport },
      reference: null,
      nearest: null,
      fibril,
      crystal,
      disagreement,
      setAside,
    };
  } else if (model.state === "built" && vContacts.length) {
    iface = {
      verdict: "at-interface",
      label: "At an interface",
      support: "In the predicted complex only",
      observed: null,
      reference,
      nearest,
      fibril,
      crystal,
      disagreement: observedAvail.state === "ok"
        ? `Solved structures of ${gene} show ${plural(observedPartners.length, "interface")}, none at ${resLabel}; only the model places it at one.`
        : null,
      setAside,
    };
  } else if (model.state === "built" || observedAvail.state === "ok") {
    iface = {
      verdict: "not-at-interface",
      // Not "No contact": a fibril or construct contact may exist, and is stated beside this.
      label: "Not at an interface",
      support: model.state === "built" && observedAvail.state === "ok" ? "Model and solved structures" : model.state === "built" ? "In the predicted complex" : `In ${plural(new Set(observedPartners.flatMap(p => p.pdbEntries)).size, "native solved structure")}`,
      observed: null,
      reference: observedAvail.state === "ok" ? reference : null,
      nearest: observedAvail.state === "ok" ? nearest : null,
      fibril,
      crystal,
      disagreement: null,
      setAside,
    };
  } else {
    iface = { verdict: "not-measured", label: "Not measured", support: "No solved complex or model", observed: null, reference: null, nearest: null, fibril, crystal, disagreement: null, setAside };
  }

  // ── Curation: sites, IntAct; association: STRING ───────────────────────
  const sites: PpiInteractionSite[] = ppi?.interactionSites ?? [];
  const intact = ppi?.curatedInteractions ?? [];
  const sections = {
    uniprot: availability(ppi?.lookups?.uniprot ?? (input.ppiStatus === "error" ? "failed" : undefined), Boolean(intact.length || sites.length || subunitText), ppiLoading, {
      failed: "UniProt did not answer, so curated partners and mapped sites were not checked.",
      skipped: `No UniProt accession was resolved for ${gene}, so nothing curated was asked for.`,
      empty: `UniProt records no curated partner or mapped interaction site for ${gene}.`,
      unknown: "Curated partners and mapped sites have not been read yet.",
    }),
    intact: availability(ppi?.lookups?.intact ?? (input.ppiStatus === "error" ? "failed" : undefined), true, ppiLoading, {
      failed: "IntAct did not answer, so the methods behind each binary interaction are not shown.",
      skipped: "No UniProt accession was resolved, so IntAct was not asked.",
      empty: "",
      unknown: "IntAct has not been read yet.",
    }),
    stringPhysical: availability(ppi?.lookups?.stringPhysical ?? (input.ppiStatus === "error" ? "failed" : undefined), Boolean(ppi?.string?.physical?.length), ppiLoading, {
      failed: "STRING's physical network did not answer. This is not evidence that there is none.",
      empty: `STRING's physical network has no partner of ${gene} at or above 0.15.`,
      unknown: "STRING has not been read yet.",
    }),
    stringFunctional: availability(ppi?.lookups?.stringPartners ?? (input.ppiStatus === "error" ? "failed" : undefined), Boolean(ppi?.string?.functional?.length), ppiLoading, {
      failed: "STRING's functional network did not answer. This is not evidence that there is none.",
      empty: `STRING has no association for ${gene} at or above 0.15.`,
      unknown: "STRING has not been read yet.",
    }),
  };
  const physMap = new Map((ppi?.string?.physical ?? []).map(p => [p.partner.toUpperCase(), p.score]));
  const funcMap = new Map((ppi?.string?.functional ?? []).map(p => [p.partner.toUpperCase(), p.score]));
  const limit = ppi?.string?.limit ?? null;
  const minScore = ppi?.string?.minScore ?? 0.15;
  const stringCell = (gene: string, which: "physical" | "functional"): StringCell => {
    const list = which === "physical" ? ppi?.string?.physical : ppi?.string?.functional;
    const map = which === "physical" ? physMap : funcMap;
    // A failed lookup is not an absence: the cell says the provider errored, never "Not read".
    if (!list) return { score: null, band: null, note: ppiLoading ? null : input.ppiStatus === "error" ? ENGINE_STATE_LABELS["upstream-error"] : "Not read" };
    const s = map.get(gene.toUpperCase());
    if (s !== undefined) return { score: s, band: stringConfidenceLabel(s), note: null };
    return { score: null, band: null, note: limit !== null && list.length >= limit ? `Not in STRING's top ${limit}` : `None ≥ ${minScore.toFixed(2)}` };
  };

  // ── Partner rows ───────────────────────────────────────────────────────
  const rows = new Map<string, PartnerRow>();
  const byGene = new Map<string, string>();
  const byAcc = new Map<string, string>();
  const keyFor = (g: string | null, acc: string | null) => {
    if (acc && byAcc.has(bare(acc))) return byAcc.get(bare(acc))!;
    if (g && byGene.has(g.toUpperCase())) return byGene.get(g.toUpperCase())!;
    return bare(acc) || g?.toUpperCase() || `row${rows.size}`;
  };
  const upsert = (g: string | null, acc: string | null): PartnerRow => {
    const key = keyFor(g, acc);
    let row = rows.get(key);
    if (!row) {
      row = {
        key, gene: g ?? acc ?? "Partner", accession: acc, group: "functional", evidence: "", qualifier: null, family: false, subunitNamed: false,
        intact: null, intactExperiments: null, observed: null, sites: [],
        physical: { score: null, band: null, note: null }, functional: { score: null, band: null, note: null },
        variantInSite: false, variantAtObservedInterface: false, organism: null,
      };
      rows.set(key, row);
    }
    if (acc && !row.accession) row.accession = acc;
    if (row.accession) byAcc.set(bare(row.accession), key);
    if (g && (row.gene === row.accession || row.gene === "Partner")) row.gene = g;
    // A protein from another species is matched by accession only: its gene name ("Sod1", "Hspa5")
    // must not fold it into the human row, or into the query itself.
    if (row.gene && !row.organism) byGene.set(row.gene.toUpperCase(), key);
    return row;
  };
  /** A partner from another species: its own row, keyed by accession. */
  const upsertForeign = (g: string | null, acc: string, organism: string): PartnerRow => {
    const key = byAcc.get(bare(acc)) ?? `${bare(acc)}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key, gene: g ?? acc, accession: acc, group: "functional", evidence: "", qualifier: null, family: false, subunitNamed: false,
        intact: null, intactExperiments: null, observed: null, sites: [],
        physical: { score: null, band: null, note: null }, functional: { score: null, band: null, note: null },
        variantInSite: false, variantAtObservedInterface: false, organism,
      };
      rows.set(key, row);
      byAcc.set(bare(acc), key);
    }
    return row;
  };
  // Accessions IntAct gives for gene names, so SUBUNIT's "CCS" and PDBe's O14618 meet in one row.
  const accessionOf = new Map<string, string>();
  for (const c of intact) if (c.gene && c.accession && !c.organismDiffer && !c.evidence?.organism) accessionOf.set(c.gene.toUpperCase(), c.accession);
  for (const o of observedPartners) if (o.gene && !o.organism) accessionOf.set(o.gene.toUpperCase(), o.accession);

  // Assembly: the protein itself for a homomer, named partners, and families named without genes.
  const evidenceOf = new Map<string, string>();
  for (const st of statements) {
    if (st.kind === "homomer") {
      const row = upsert(gene, uniprotId);
      row.gene = gene;
      row.group = "assembly";
      row.qualifier = row.qualifier ?? st.qualifier;
      evidenceOf.set(row.key, `${st.label}${st.qualifier ? ` (${st.qualifier.toLowerCase()})` : ""}: another copy of ${gene}`);
    } else if (st.kind === "heteromer" && st.family) {
      const key = `family:${st.family}`;
      rows.set(key, {
        key, gene: st.family.charAt(0).toUpperCase() + st.family.slice(1), accession: null, group: "assembly",
        evidence: `${st.label}${st.qualifier ? ` (${st.qualifier.toLowerCase()})` : ""}, named as a family; not resolved to genes`,
        qualifier: st.qualifier, family: true, subunitNamed: false, intact: null, intactExperiments: null, observed: null, sites: [],
        physical: { score: null, band: null, note: null }, functional: { score: null, band: null, note: null },
        variantInSite: false, variantAtObservedInterface: false, organism: null,
      });
    } else {
      for (const g of st.partnerGenes) {
        const resolved = rec.partners.find(p => p.gene === g);
        const row = upsert(g, resolved?.accession ?? accessionOf.get(g.toUpperCase()) ?? null);
        row.group = "assembly";
        row.qualifier = row.qualifier ?? st.qualifier;
        if (!evidenceOf.has(row.key)) evidenceOf.set(row.key, `${st.label}${st.qualifier ? ` (${st.qualifier.toLowerCase()})` : ""}`);
      }
    }
  }
  // Binders the record names outside an assembly statement ("The complex binds NEDD8 and UBE2M.
  // Binds APP and TP53BP2."): curated, not assembly.
  const assemblyPartnerName = rec.partners[0]?.gene ?? null;
  for (const m of subunitPartnerMentions(subunitText, gene)) {
    const existing = rows.get(keyFor(m.gene, null));
    if (existing?.group === "assembly") continue;
    const row = upsert(m.gene, null);
    row.subunitNamed = true;
    row.qualifier = row.qualifier ?? statementQualifier(m.sentence);
    evidenceOf.set(row.key, /\bcomplex binds\b/i.test(m.sentence) ? `Binds the ${assemblyPartnerName ? `${gene}–${assemblyPartnerName}` : gene} complex (SUBUNIT)` : "Binds (SUBUNIT)");
  }
  for (const o of observedPartners) {
    const row = o.homomeric ? upsert(gene, uniprotId) : o.organism ? upsertForeign(o.gene ?? o.name, o.accession, o.organism) : upsert(o.gene ?? null, o.accession);
    if (row.gene === o.accession) row.gene = o.gene ?? o.name;
    row.observed = o;
    row.variantAtObservedInterface = o.variantAtInterface;
    if (row.group !== "assembly") row.group = "structural";
  }
  for (const c of intact) {
    if (bare(c.accession) === bare(uniprotId)) continue;
    const foreign = c.evidence?.organism ?? (c.organismDiffer ? "other species" : null);
    const row = foreign ? upsertForeign(c.gene, c.accession, foreign) : upsert(c.gene, c.accession);
    row.intactExperiments = c.experiments ?? null;
    row.intact = c.evidence ?? null;
  }
  for (const s of sites) {
    for (const p of s.partners) {
      if (p.toUpperCase() === gene.toUpperCase()) continue;
      const row = upsert(p, null);
      row.sites.push(s);
      if (s.containsVariant) row.variantInSite = true;
    }
  }
  const PHYSICAL_SHOWN = 8;
  const FUNCTIONAL_SHOWN = 5;
  for (const p of ppi?.string?.physical ?? []) upsert(p.partner, null);
  for (const p of ppi?.string?.functional ?? []) upsert(p.partner, null);

  for (const row of rows.values()) {
    if (row.family) continue;
    // The protein's own row (a homomer) has no STRING score with itself.
    const self = bare(row.accession) === bare(uniprotId) && Boolean(uniprotId);
    // STRING here is the human network: a mouse protein has no score in it, and its human ortholog's is not its own.
    const foreignNote: StringCell = { score: null, band: null, note: `Not scored (${row.organism === "other species" ? "not human" : row.organism})` };
    row.physical = self ? { score: null, band: null, note: null } : row.organism ? foreignNote : stringCell(row.gene, "physical");
    row.functional = self ? { score: null, band: null, note: null } : row.organism ? foreignNote : stringCell(row.gene, "functional");
    if (row.group === "assembly" || row.group === "structural") {
      // decided above
    } else if (row.subunitNamed) {
      row.group = "curated";
    } else if (row.intactExperiments !== null || row.intact) {
      const e = row.intact;
      row.group = e && e.twoHybridOnly && e.pubmed.length <= 1 ? "screen" : "curated";
    } else if (row.sites.length) {
      row.group = "curated";
    } else if (row.physical.score !== null) {
      row.group = "physical";
    } else {
      row.group = "functional";
    }
    const parts: string[] = [];
    if (evidenceOf.has(row.key)) parts.push(evidenceOf.get(row.key)!);
    if (row.observed) parts.push(`Solved: ${plural(row.observed.n, "structure")}`);
    if (row.intactExperiments !== null || row.intact) parts.push(intactLine(row.intact, row.intactExperiments, ppi?.lookups?.intact === "ok"));
    if (row.sites.length && !parts.length) parts.push(`Mapped site ${row.sites.map(rangeText).join(", ")}`);
    if (!parts.length) parts.push(row.group === "physical" ? "STRING physical association" : "STRING functional association");
    row.evidence = parts.join(" · ");
  }

  const groupOrder: PartnerGroup[] = ["assembly", "structural", "curated", "screen", "physical", "functional"];
  const rank = (r: PartnerRow) =>
    (r.variantInSite || r.variantAtObservedInterface ? 0 : 1) * 10 + (r.sites.length || r.observed ? 0 : 1) * 5 + (r.family ? 1 : 0);
  const sorted = [...rows.values()].sort((a, b) =>
    groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
    rank(a) - rank(b) ||
    (b.physical.score ?? 0) - (a.physical.score ?? 0) ||
    (b.functional.score ?? 0) - (a.functional.score ?? 0) ||
    a.gene.localeCompare(b.gene)
  );
  // ── Groups: what is shown, what folds, what only STRING holds ──────────
  // Density budget (data-presentation.md): about 20 rows per tier. A single-screen tail folds behind one
  // line listing its genes; a STRING tail keeps its first few and lists the rest as names with scores.
  const SCREEN_ALWAYS = 12;
  const CURATED_SHOWN = 20;
  const STRING_CORROBORATES = 0.4;
  const groups: PartnerGroupView[] = [];
  const hiddenPartners: Partial<Record<PartnerGroup, number>> = {};
  for (const id of groupOrder) {
    const all = sorted.filter(r => r.group === id);
    if (!all.length) continue;
    let rowsShown = all;
    let folded: PartnerGroupView["folded"] = null;
    let meta = PARTNER_GROUP_LABEL[id].meta;
    const list = id === "physical" ? ppi?.string?.physical : id === "functional" ? ppi?.string?.functional : null;
    const capped = Boolean(list && limit !== null && list.length >= limit);
    if (id === "screen") {
      const studies = new Set(all.flatMap(r => r.intact?.pubmed ?? []));
      if (studies.size === 1) {
        // One study for the whole tier: said once in the head, not on every row.
        meta = `Yeast two-hybrid in one study (PubMed ${[...studies][0]}), no other method`;
        for (const r of all) r.evidence = r.organism ? `Yeast two-hybrid, ${r.organism} protein` : "Yeast two-hybrid";
      }
      if (all.length > SCREEN_ALWAYS) {
        const keep = (r: PartnerRow) => (r.physical.score ?? 0) >= STRING_CORROBORATES || r.sites.length > 0 || Boolean(r.observed);
        rowsShown = all.filter(keep);
        const rest = all.filter(r => !keep(r));
        if (rest.length) {
          folded = {
            rows: rest,
            summary: `${plural(rest.length, "more partner")} from ${studies.size === 1 ? "the same screen" : "two-hybrid screens"}, none with STRING physical support of ${STRING_CORROBORATES.toFixed(2)} or more`,
          };
        }
      }
    } else if (id === "curated" && all.length > CURATED_SHOWN) {
      rowsShown = all.slice(0, CURATED_SHOWN);
      folded = { rows: all.slice(CURATED_SHOWN), summary: `${plural(all.length - CURATED_SHOWN, "more reported partner")} with weaker STRING support` };
    } else if (id === "physical" || id === "functional") {
      const cap = id === "physical" ? PHYSICAL_SHOWN : FUNCTIONAL_SHOWN;
      rowsShown = all.slice(0, cap);
      const rest = all.slice(cap);
      if (rest.length) {
        hiddenPartners[id] = rest.length;
        folded = { rows: rest, summary: `${rest.length}${capped ? "+" : ""} more on STRING${capped ? `, which returns its top ${limit}` : ""}` };
      }
    }
    groups.push({ id, title: PARTNER_GROUP_LABEL[id].title, meta, total: all.length, capped, rows: rowsShown, folded, hidden: 0 });
  }
  const partners: PartnerRow[] = groups.flatMap(g => g.rows);
  const columns = {
    solved: partners.some(p => p.observed),
    site: sites.length > 0,
  };

  // ── Track ──────────────────────────────────────────────────────────────
  const feats: Array<{ type: string; description?: string; start: number; end: number }> = features?.features ?? [];
  const track: TrackLane[] = [];
  const topo = feats.filter(f => (f.type === "Transmembrane" || f.type === "Intramembrane" || f.type === "Topological domain") && f.start > 0 && f.end >= f.start);
  if (topo.length) {
    const tm = topo.filter(f => f.type !== "Topological domain").length;
    const where = topo.find(f => position !== null && f.start <= position && position <= f.end);
    track.push({
      key: "topology",
      kind: "topology",
      label: "Membrane topology",
      sub: tm ? `${plural(tm, "membrane segment")}` : "UniProt",
      ranges: topo.map(f => ({
        start: f.start, end: f.end,
        kind: f.type === "Topological domain" ? (/cytoplasm/i.test(f.description ?? "") ? "cytoplasmic" : /extracell|lumen/i.test(f.description ?? "") ? "outside" : "other") : "membrane",
        name: f.type === "Topological domain" ? f.description || "Topological domain" : f.type,
        hit: Boolean(position !== null && f.start <= position && position <= f.end),
      })),
      marks: [],
      hit: false,
      readout: null,
      rowKey: null,
      summary: `${plural(tm, "membrane segment")}; ${resLabel} is ${where ? (where.type === "Topological domain" ? `in the ${lower1(where.description || "topological domain")} part` : "in a membrane segment") : "outside annotated topology"}`,
    });
  }
  // Domains are the Functional domains map's own (drawnDomains: InterPro when it answered, else UniProt), so
  // the two tabs cannot draw different domains; regions are UniProt's named Regions, Repeats and Zinc fingers.
  // A Region that IS a mapped binding site (same bounds and note) is drawn once, in the sites lane below: NAE1's
  // "Interaction with UBA3" sat in both lanes.
  const isSite = (f: { start: number; end: number; description?: string }) =>
    sites.some(x => x.start === f.start && x.end === f.end && x.description.trim().toLowerCase() === (f.description ?? "").trim().toLowerCase());
  const domainBoxes = drawnDomains(features, position ?? 0, sequenceLength ?? Math.max(position ?? 1, ...feats.map(f => f.end)));
  const regions = feats.filter(f => (f.type === "Region" || f.type === "Repeat" || f.type === "Zinc finger") && f.start > 0 && f.end >= f.start && !/disordered/i.test(f.description ?? "") && !isSite(f));
  const named = [
    ...domainBoxes.flatMap(b => b.segments.map(seg => ({ start: seg.start, end: seg.end, kind: "domain" as const, name: b.name }))),
    ...regions.map(f => ({ start: f.start, end: f.end, kind: f.type === "Region" ? "region" as const : "domain" as const, name: f.description || f.type })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  if (named.length) {
    const domainSource = domainBoxes.some(b => b.source !== "UniProtKB") ? "InterPro" : "UniProt";
    track.push({
      key: "domains",
      kind: "domains",
      label: "Domains & regions",
      sub: regions.length && domainSource === "InterPro" ? "InterPro and UniProt" : domainSource,
      ranges: named.map(r => ({ ...r, hit: Boolean(position !== null && r.start <= position && position <= r.end) })),
      marks: [],
      hit: false,
      readout: null,
      rowKey: null,
      summary: named.map(r => `${r.name} ${r.start === r.end ? r.start : `${r.start}–${r.end}`}`).join("; "),
    });
  }
  if (sites.length) {
    track.push({
      key: "sites",
      kind: "sites",
      label: "Mapped binding sites",
      sub: `UniProt, ${plural(sites.length, "site")}`,
      ranges: sites.map(s => ({ start: s.start, end: s.end, kind: "site", name: `${s.type} ${rangeText(s)} · ${s.description}`, hit: s.containsVariant })),
      marks: [],
      hit: sites.some(s => s.containsVariant),
      readout: null,
      rowKey: null,
      summary: `${sites.map(s => `${rangeText(s)} ${s.description}`).join("; ")}; ${sites.some(s => s.containsVariant) ? "includes" : "does not include"} ${resLabel}`,
    });
  }
  // Native interfaces (homomer first, then by structures), then fibrils last: a different kind of contact.
  const ordered = [...observedPartners].sort((a, b) => Number(b.homomeric) - Number(a.homomeric) || b.n - a.n);
  for (const o of [...ordered.slice(0, 6), ...fibrilPartners]) {
    const fib = o.context === "fibril";
    const where = fib ? "amyloid fibril structure" : "solved structure";
    track.push({
      key: o.key,
      kind: "solved",
      label: o.label,
      sub: fib ? plural(o.n, "fibril structure") : plural(o.n, "solved structure"),
      ranges: [],
      marks: o.residues.map((r, i) => ({ residue: r, weight: o.n ? Math.min(1, o.support[i] / o.n) : 1, title: `${residueName(r)}: ${o.support[i]} of ${plural(o.n, where)}` })),
      hit: o.variantAtInterface,
      readout: { k: o.k, n: o.n },
      rowKey: o.key,
      summary: `${o.label}: ${plural(o.residues.length, "interface residue")}; ${o.variantAtInterface ? `${resLabel} at the interface in ${o.k} of ${plural(o.n, where)}` : `${resLabel} not at this interface`}`,
    });
  }
  if (model.state === "built") {
    track.push({
      key: "predicted",
      kind: "predicted",
      label: "Predicted complex",
      sub: `Boltz-2, chain A, ${plural(footprint.length, "residue")}`,
      ranges: [],
      marks: footprint.map(r => ({ residue: r, weight: 1, title: `${r}: contact in the model` })),
      hit: vContacts.length > 0,
      readout: null,
      rowKey: null,
      summary: `Predicted interface: ${plural(footprint.length, "residue")}; ${vContacts.length ? "includes" : "does not include"} ${resLabel}`,
    });
  }

  // ── Binding change ─────────────────────────────────────────────────────
  const shift = input.shift;
  const solvedComplexes = observedPartners.length > 0;
  const plan = best
    ? `DDMut-PPI on a solved complex where ${resLabel} is at the interface (${best.variantEntries.map(e => e.toUpperCase()).slice(0, 3).join(", ")}${best.variantEntries.length > 3 ? "…" : ""}), best resolution first.`
    : !solvedComplexes && observedAvail.state !== "pending" && chains.length >= 2
      ? `No solved complex of ${gene} exists, so Boltz-2 models the ${rec.label.toLowerCase()} all wild type and DDMut-PPI scores ${resLabel} on it.`
      : null;
  const binding: BindingView = {
    state: "unavailable",
    stateLabel: null,
    reason: null,
    value: null,
    valueText: null,
    direction: null,
    directionText: null,
    withinError: false,
    wildType: shift?.wildType ?? null,
    plan,
    canRequest: false,
  };
  if (input.shiftLoading) {
    Object.assign(binding, { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: best ? "Fetching the solved complex and running DDMut-PPI." : "Modelling the wild-type complex and running DDMut-PPI." });
  } else if (input.shiftError) {
    Object.assign(binding, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: input.shiftError, canRequest: Boolean(plan) });
  } else if (shift?.status === "ok" && Number.isFinite(shift.ddgBind)) {
    const v = shift.ddgBind as number;
    const direction = v < 0 ? "weaker" : v > 0 ? "stronger" : "none";
    Object.assign(binding, {
      state: "ok",
      value: v,
      valueText: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} kcal/mol`,
      direction,
      directionText: direction === "weaker" ? "Weaker binding" : direction === "stronger" ? "Stronger binding" : "No change predicted",
      withinError: Math.abs(v) < DDMUT_PPI_RMSE,
    });
  } else if (shift?.status === "running") {
    Object.assign(binding, { state: "running", stateLabel: ENGINE_STATE_LABELS.running, reason: shift.reason ?? "Still computing.", canRequest: true });
  } else if (shift?.status === "failed") {
    Object.assign(binding, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: shift.reason ?? "The prediction did not return a value.", canRequest: Boolean(plan) });
  } else if (shift?.status === "not-applicable") {
    Object.assign(binding, { state: "not-applicable", stateLabel: ENGINE_STATE_LABELS["not-covered"], reason: shift.reason ?? "A binding change cannot be computed for this variant." });
  } else if (iface.verdict === "pending" || observedAvail.state === "pending") {
    Object.assign(binding, { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "Waiting for the solved structures." });
  } else if (plan) {
    Object.assign(binding, { state: "ready", reason: `Not run yet. ${plan}`, canRequest: true });
  } else if (solvedComplexes) {
    Object.assign(binding, {
      state: "not-applicable",
      stateLabel: ENGINE_STATE_LABELS["not-covered"],
      reason: `${resLabel} is not at the interface in any solved complex of ${gene}, so no binding change is estimated.`,
    });
  } else {
    Object.assign(binding, {
      state: "not-applicable",
      stateLabel: ENGINE_STATE_LABELS["not-covered"],
      reason: rec.kind === "monomer"
        ? "UniProt states a monomer, and no solved complex exists: there is no partner chain to bind."
        : "No solved complex exists, and the curated assembly gives no complex to model.",
    });
  }

  // ── Finding ────────────────────────────────────────────────────────────
  const siteHits = sites.filter(s => s.containsVariant);
  const assemblyWords =
    rec.kind === "monomer" ? `UniProt states that ${gene} is a monomer.`
    : rec.kind === "homomer" ? `${gene} forms a ${rec.label.toLowerCase()}${qualifier ? ` (${qualifier.toLowerCase()})` : ""}.`
    : rec.kind === "heteromer" ? `${gene} works as a ${rec.label.toLowerCase()}${rec.partners.length ? ` with ${rec.partners.map(p => p.gene).join(" and ")}` : ""}${qualifier ? ` (${qualifier.toLowerCase()})` : ""}.`
    : rec.kind === "complex" ? `${gene} is one subunit of a larger complex.`
    : rec.kind === "interactions-only" ? `UniProt lists binding partners for ${gene} but states no assembly.`
    : `UniProt states no assembly for ${gene}.`;

  let headline: string;
  let predicate: string;
  let context: string | null = null;
  if (iface.verdict === "pending") {
    headline = `Reading ${gene}'s assembly and solved structures.`;
    predicate = "The interface reading follows when PDBe answers";
  } else if (iface.verdict === "at-interface" && iface.observed) {
    const o = iface.observed;
    const entries = o.entries.map(e => e.toUpperCase());
    headline = `${resLabel} is at the interface with ${o.partner === `${gene}, other chain` ? `the other ${gene} chain` : o.partner} in ${supportText(o.k, o.n)}${entries.length && entries.length <= 3 ? ` (${entries.join(", ")})` : ""}.`;
    predicate = o.k < o.n
      ? `${o.k === 1 ? "A contact seen in one structure" : "A contact seen in some structures"} depends on the conformation or construct captured; this interface's best-attested residues are seen in ${o.maxSupport} of ${o.n}`
      : "Every solved structure of this pair has it at the interface";
    if (siteHits.length) predicate += `. It is also inside UniProt's mapped site${siteHits.length > 1 ? "s" : ""} ${siteHits.map(rangeText).join(", ")}`;
  } else if (iface.verdict === "at-interface") {
    headline = `In the predicted complex, ${resLabel} makes ${plural(vContacts.length, "contact")} with another chain${model.band ? ` (ipTM ${model.iptm!.toFixed(2)}, ${IPTM_BAND_LABEL[model.band].toLowerCase()})` : ""}.`;
    predicate = "No solved structure shows it; this is a prediction on the variant model, so whether a contact is lost is not measured";
  } else if (iface.verdict === "not-at-interface") {
    const ref = iface.reference;
    const refPhrase = ref ? (ref.partner === `${gene}, other chain` ? `the other ${gene} chain` : ref.partner) : null;
    headline = siteHits.length
      ? `${resLabel} is inside UniProt's mapped binding site ${siteHits.map(rangeText).join(", ")}, but no structure places it at an interface.`
      : ref && model.state !== "built"
        ? `${resLabel} is not at the interface with ${refPhrase} in any of ${plural(ref.n, "native solved structure")}.`
        : `${resLabel} is not at any interface seen ${model.state === "built" ? "in the model or " : ""}in solved structures of ${gene}.`;
    const near = iface.nearest && iface.nearest.gap <= 5
      ? `${iface.nearest.name}, ${plural(iface.nearest.gap, "residue")} away, is at that interface in ${iface.nearest.support} of ${iface.nearest.n}`
      : null;
    predicate = observedPartners.length
      ? [
          observedPartners.length > 1 ? `None of the ${observedPartners.length} native interfaces in solved structures includes it` : null,
          near,
        ].filter(Boolean).join("; ") || `Solved structures show ${plural(observedPartners.length, "interface")}, none including ${resLabel}`
      : model.nearestInterfaceGap !== null
        ? `In the predicted complex the nearest interface residue is ${plural(model.nearestInterfaceGap, "residue")} away in sequence`
        : "The predicted complex has no contact at it";
  } else {
    headline = siteHits.length
      ? `${resLabel} is inside UniProt's mapped binding site ${siteHits.map(rangeText).join(", ")}.`
      : `Whether ${resLabel} touches another protein has not been measured.`;
    predicate = observedAvail.state === "failed"
      ? "Solved structures could not be read, so a contact is not ruled out"
      : "No solved complex of this protein exists, and no model has been run";
  }
  if (rec.kind === "homomer" && iface.verdict === "at-interface") {
    context = `In a ${rec.label.toLowerCase()}, a heterozygous carrier makes mixed complexes: one mutant chain beside wild type. An interface residue is where such a variant could act on the partner chain; this tab does not test that.`;
  }

  const chipTone: "neutral" | "muted" = iface.verdict === "at-interface" ? "neutral" : "muted";

  // ── Facts ──────────────────────────────────────────────────────────────
  // Counted over every row, shown or folded; families, the query itself and set-aside chains are not partners.
  const physicalPartners = sorted.filter(p => p.group === "assembly" || p.group === "structural" || p.group === "curated" || p.group === "screen").filter(p => !p.family && !p.organism && bare(p.accession) !== bare(uniprotId));
  const foreignPartners = sorted.filter(p => p.organism && p.group !== "physical" && p.group !== "functional").length;
  const screenRows = [...rows.values()].filter(p => p.group === "screen");
  const screenOnly = screenRows.length;
  const screenStudies = new Set(screenRows.flatMap(p => p.intact?.pubmed ?? []));
  const partnerSub =
    screenOnly && screenOnly === physicalPartners.length
      ? `all two-hybrid${screenStudies.size === 1 ? `, one study (PubMed ${[...screenStudies][0]})` : ""}`
      : screenOnly
        ? `${screenOnly} from a two-hybrid screen only`
        : "curated, structural or co-purified";
  const partnerSubFull = foreignPartners ? `${partnerSub}; ${foreignPartners} more from other species` : partnerSub;
  const facts: InterfacesEvidence["facts"] = [
    {
      label: "Assembly",
      value: rec.label,
      sub: subunitText ? `UniProt SUBUNIT${qualifier ? `, ${qualifier.toLowerCase()}` : ""}` : "No SUBUNIT record",
    },
    {
      label: "Interface support",
      value: iface.observed ? `${iface.observed.k} of ${iface.observed.n}` : iface.reference ? `0 of ${iface.reference.n}` : iface.label,
      sub: (iface.observed
        ? `solved structures${iface.observed.entries.length <= 2 ? ` · ${iface.observed.entries.map(e => e.toUpperCase()).join(", ")}` : ""}`
        : iface.reference ? "native solved structures" : iface.support) + (iface.fibril ? ` · ${iface.fibril.k} of ${iface.fibril.n} fibrils` : "") + (iface.crystal ? ` · ${iface.crystal.k} of ${iface.crystal.n} monomer-assembly entries` : ""),
      mono: Boolean(iface.observed || iface.reference),
    },
    {
      label: "Reported partners",
      value: ppiLoading ? ENGINE_STATE_LABELS.running : String(physicalPartners.length),
      sub: ppiLoading ? "" : sections.uniprot.state === "failed" ? "UniProt not read" : partnerSubFull,
      mono: !ppiLoading,
    },
    {
      label: "Binding change",
      value: binding.state === "ok" ? binding.valueText! : binding.state === "pending" || binding.state === "running" ? ENGINE_STATE_LABELS.running : "Not measured",
      sub: binding.state === "ok" ? `${binding.directionText}${binding.withinError ? ", within the method's error" : ""}` : binding.state === "ready" ? "Ready to estimate" : binding.stateLabel ?? "",
      mono: binding.state === "ok",
    },
  ];

  // ── Trace ──────────────────────────────────────────────────────────────
  // Each step carries whether its source has actually answered, so the rail can draw a pending
  // marker only while a source is genuinely in flight, and a failed state (with the reason) when it
  // errored — never a spinner that outlives the run.
  const physicalCount = ppi?.string?.physical?.length ?? 0;
  const curationPending = !subunitText && (asmLoading || ppiLoading);
  const curationFailed = !subunitText && !curationPending && ((input.assemblyStatus === "error" && !asmData) || (input.ppiStatus === "error" && !ppi));
  const partnersFailed = sections.uniprot.state === "failed";
  const stringFailed = sections.stringPhysical.state === "failed";
  const trace: TraceStep[] = [
    {
      label: "Curation",
      value: curationPending
        ? ENGINE_STATE_LABELS.running
        : statements.length
          ? statements.map(s => `${s.label}${s.qualifier ? ` (${s.qualifier.toLowerCase()})` : ""}${s.family ? ` with ${s.family}` : s.partnerGenes.length ? ` with ${s.partnerGenes.join(", ")}` : ""}`).join("; ")
          : curationFailed ? ENGINE_STATE_LABELS["upstream-error"] : subunitText ? "SUBUNIT names no assembly" : "No SUBUNIT record",
      sub: statements.length > 1 ? "The first statement decides the assembly; the others are shown, not dropped." : subunitText ? undefined : curationFailed ? "UniProt did not answer, so the assembly statement could not be read." : "Read as not stated, never as a monomer.",
      state: curationPending ? "pending" : curationFailed ? "failed" : "done",
    },
    {
      label: "Solved structures",
      value: observedAvail.state === "ok"
        ? observedPartners.map(o => `${o.label}: ${plural(o.n, "entry", "entries")}`).join("; ")
        : observedAvail.reason ?? "Not read",
      sub: [
        fibrilPartners.length ? `Amyloid fibrils read apart: ${fibrilPartners.map(f => `${f.label}, ${plural(f.n, "entry", "entries")}`).join("; ")}.` : null,
        crystalPartners.length ? `Monomer-assembly entries read apart: ${crystalPartners.map(c => `${c.label}, ${plural(c.n, "entry", "entries")}`).join("; ")}.` : null,
        artefacts.length ? `Set aside, not biological: ${[...new Set(artefacts.map(a => `${a.name} (${a.artefact})`))].join("; ")}.` : null,
        exp?.status === "ok" && exp.entryKinds === "failed" ? "RCSB did not answer, so fibril and monomer-assembly entries could not be told apart from native ones." : null,
      ].filter(Boolean).join(" ") || undefined,
      warn: observedAvail.state === "failed" || (exp?.status === "ok" && exp.entryKinds === "failed"),
      state: observedAvail.state === "pending" ? "pending" : observedAvail.state === "failed" ? "failed" : "done",
    },
    {
      label: "Variant residue",
      value: iface.verdict === "pending"
        ? ENGINE_STATE_LABELS.running
        : iface.observed ? `At the interface in ${supportText(iface.observed.k, iface.observed.n)}` : iface.verdict === "at-interface" ? "At an interface in the model only" : iface.verdict === "not-at-interface" ? (iface.reference ? `Not at the interface in any of ${plural(iface.reference.n, "native structure")}` : "Not at any interface") : "Not measured",
      sub: iface.verdict === "pending"
        ? "Reading the solved structures."
        : [iface.disagreement ?? (iface.observed ? `Interacting entries: ${iface.observed.entries.map(e => e.toUpperCase()).join(", ")}.` : null), iface.fibril?.sentence ?? null].filter(Boolean).join(" ") || undefined,
      warn: Boolean(iface.disagreement),
      state: iface.verdict === "pending" ? "pending" : "done",
    },
    {
      label: "Complex model",
      value: model.state === "pending" || model.state === "running"
        ? ENGINE_STATE_LABELS.running
        : model.state === "built" ? `Built · ${plural(model.chainCount, "chain")} · ipTM ${model.iptm !== null ? model.iptm.toFixed(2) : "not reported"}` : model.state === "not-requested" ? "Not run (on request)" : model.stateLabel ?? "Not run",
      sub: model.state === "built" ? undefined : model.reason ?? undefined,
      warn: model.state === "failed",
      state: model.state === "pending" || model.state === "running" ? "pending" : model.state === "failed" ? "failed" : "done",
    },
    {
      label: "Partners",
      value: ppiLoading
        ? ENGINE_STATE_LABELS.running
        : partnersFailed ? ENGINE_STATE_LABELS["upstream-error"]
          : `${plural(physicalPartners.length, "reported partner")}: ${partnerSubFull}`,
      sub: [partnersFailed ? sections.uniprot.reason : null, sections.intact.state === "failed" ? sections.intact.reason : null].filter(Boolean).join(" ") || undefined,
      warn: partnersFailed || sections.intact.state === "failed",
      state: ppiLoading ? "pending" : partnersFailed ? "failed" : "done",
    },
    {
      label: "STRING",
      value: sections.stringPhysical.state === "ok" || sections.stringPhysical.state === "empty"
        ? `${plural(physicalCount, "physical partner")} and ${ppi?.string?.functional?.length ?? 0}${limit !== null && (ppi?.string?.functional?.length ?? 0) >= limit ? "+" : ""} functional ≥ ${minScore.toFixed(2)}`
        : sections.stringPhysical.reason ?? "Not read",
      sub: [ppi?.stringVersion ? `STRING ${ppi.stringVersion}` : null, limit !== null && (ppi?.string?.functional?.length ?? 0) >= limit ? `STRING returns its top ${limit}; the functional network is larger` : null].filter(Boolean).join(". ") || undefined,
      warn: stringFailed,
      state: ppiLoading && !ppi ? "pending" : stringFailed ? "failed" : "done",
    },
    {
      label: "Binding change",
      value: binding.state === "ok"
        ? `${binding.valueText} on ${binding.wildType?.source === "experimental" ? `PDB ${binding.wildType.pdbId?.toUpperCase()}` : "a Boltz-2 wild-type model"}`
        : binding.state === "ready" ? "Not run yet" : binding.stateLabel ?? "Not measured",
      sub: binding.state === "ok" ? undefined : binding.reason ?? undefined,
      warn: binding.state === "failed",
      state: binding.state === "pending" || binding.state === "running" ? "pending" : binding.state === "failed" ? "failed" : "done",
    },
    { label: "Engine record", value: "None", sub: "No ACMG criterion reads this tab.", state: "done" },
  ];

  // STRING band counts (physical) for the rail's cut-point list.
  const bandCounts = new Map<string, number>();
  for (const p of ppi?.string?.physical ?? []) {
    const b = stringConfidenceLabel(p.score);
    if (b) bandCounts.set(b, (bandCounts.get(b) ?? 0) + 1);
  }

  return {
    status: { assembly: staleAsm ? "stale" : asmLoading ? "loading" : input.assemblyStatus === "error" && !asmData ? "error" : "ready", lookups: ppiLoading ? "loading" : input.ppiStatus === "error" && !ppi ? "error" : "ready" },
    gene,
    uniprotId,
    position,
    residueLabel: resLabel,
    sequenceLength,
    assembly: {
      kind: rec.kind,
      label: rec.label,
      copies: rec.copies,
      homoAssumed: rec.homoAssumed,
      qualifier,
      subunitText,
      statements,
      partners: rec.partners,
      composition,
    },
    chains,
    observed: { availability: observedAvail, partners: observedPartners, fibrils: fibrilPartners, crystals: crystalPartners, artefacts, artefactsShown, artefactsFold, fibrilsChecked: exp?.status !== "ok" || exp.entryKinds !== "failed" },
    model,
    interface: iface,
    sites,
    sections,
    partners,
    groups,
    hiddenPartners,
    columns,
    track,
    binding,
    finding: { chip: iface.label, chipTone, headline, predicate, context },
    facts,
    trace,
    string: { version: ppi?.stringVersion ?? null, limit, minScore: ppi?.string?.minScore ?? null, bands: [...bandCounts].map(([id, count]) => ({ id, count })) },
    stringUrl: md.gene ? stringNetworkUrl(md.gene, undefined, true) : null,
  };
}

/**
 * The partner list as the reader narrowed it: one tier, a name query, or both. A query reaches folded
 * and STRING-tail rows too, and shows each match as a full row; nothing is filtered on the screen.
 */
export function filterPartnerGroups(groups: PartnerGroupView[], view: { tier: PartnerGroup | null; query: string }): PartnerGroupView[] {
  const q = view.query.trim().toUpperCase();
  const match = (r: PartnerRow) => !q || r.gene.toUpperCase().includes(q) || (r.accession ?? "").toUpperCase().includes(q);
  return groups
    .filter(g => !view.tier || g.id === view.tier)
    .map(g => {
      if (!q) return g;
      const rows = [...g.rows, ...(g.folded?.rows ?? [])].filter(match);
      return { ...g, rows, folded: null };
    })
    .filter(g => g.rows.length > 0 || g.folded);
}

/** The assembly sentence alone, for surfaces (Insights) that show one line. */
export function assemblySentence(ev: InterfacesEvidence): string {
  const a = ev.assembly;
  return a.kind === "unstated" ? `UniProt states no assembly for ${ev.gene}.` : `${a.label}${a.qualifier ? ` (${a.qualifier.toLowerCase()})` : ""}, per UniProt SUBUNIT.`;
}
