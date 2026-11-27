/** The shapes the Interfaces & PPI model hands to the tab, the rail and the Insights lane. */
import type {
  AnalysisResult,
  IntactEvidence,
  MultimerData,
  MultimerModelFailure,
  ObservedInterface,
  PpiBindingData,
  PpiBindingShift,
  PpiInteractionSite,
} from "../contracts.ts";
import type { InterfaceContact, SubunitStatement } from "../multimerAssembly.ts";

export type IptmBand = "confident" | "grey" | "low";
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
  /** Entries that model the variant residue: the denominator. Equals `total` when coverage was not read. */
  n: number;
  /** Entries showing the pair at all. */
  total: number;
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
  /** Residues across the planned chains, when their lengths are known. */
  residues: number | null;
  /** Small enough for a browser fold (LocalFold); false says so before anyone clicks. */
  browserFoldable: boolean;
}

export type InterfaceVerdict = "at-interface" | "not-at-interface" | "not-modelled" | "not-measured" | "pending";

export interface InterfaceView {
  verdict: InterfaceVerdict;
  /** Chip text: "At an interface", "Not at an interface", "Not modelled", "Not measured", "Running". */
  label: string;
  /** "1 of 8 solved structures", "In the predicted complex" … */
  support: string;
  /** Observed support of the best-attested partner at the variant, when observed. */
  observed: { k: number; n: number; total: number; partner: string; entries: string[]; maxSupport: number } | null;
  /** When the residue is modelled but not at a native interface: what it was tested against ("0 of 142"). */
  reference: { n: number; partner: string } | null;
  /** When no solved structure models the residue: how many hold the pair, and the gap around it. */
  unmodelled: { total: number; partner: string; gap: { start: number; end: number } | null } | null;
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
  /** Every row of this tier the payloads hold (shown, folded and hidden). */
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
  /** Solved lanes: stretches no structure of the pair models, drawn as "no coordinates". */
  gaps: Array<{ start: number; end: number }>;
  hit: boolean;
  /** Solved lanes: the variant's own support, "4/15"; `n` 0 when no structure models it. */
  readout: { k: number; n: number; total: number } | null;
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
  /** The source behind this step has not answered ("pending"), answered ("done") or failed ("failed"). */
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
    peptides: ObservedView[];
    /** Construct tags, tool antibodies, unmapped chains: shown, never counted. */
    artefacts: ObservedView[];
    /** What the table draws: the first few set-aside chains; the rest fold behind one line. */
    artefactsShown: ObservedView[];
    artefactsFold: { rows: ObservedView[]; summary: string } | null;
    /** False when RCSB could not be read, so fibril entries may sit among the native ones. */
    fibrilsChecked: boolean;
    /** False when PDBe could not say which residues each structure models. */
    coverageChecked: boolean;
  };
  model: ModelView;
  interface: InterfaceView;
  sites: PpiInteractionSite[];
  sections: { uniprot: AvailabilityView; intact: AvailabilityView; stringPhysical: AvailabilityView; stringFunctional: AvailabilityView };
  /** Rows shown by default, in group order (folded and hidden rows excluded). */
  partners: PartnerRow[];
  /** The partner list by tier, with counts, folds and STRING tails: what the screen draws. */
  groups: PartnerGroupView[];
  /** One count of partner proteins per band: human, not the protein itself, not a family. */
  partnerSummary: { binding: number; association: number; capped: boolean; otherSpecies: number };
  /** Partner rows hidden from the grid (long STRING tails), per group. */
  hiddenPartners: Partial<Record<PartnerGroup, number>>;
  columns: { solved: boolean; site: boolean };
  track: TrackLane[];
  binding: BindingView;
  finding: {
    chip: string;
    chipTone: "neutral" | "muted";
    /** The hero's one figure: a count ("1 of 4") or, with no count to give, the verdict in words. */
    figure: { value: string; isCount: boolean; caption: string };
    headline: string;
    predicate: string;
    context: string | null;
  };
  facts: Array<{ label: string; value: string; sub: string; mono?: boolean }>;
  trace: TraceStep[];
  string: { version: string | null; limit: number | null; minScore: number | null; bands: Array<{ id: string; count: number }> };
  stringUrl: string | null;
}

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
