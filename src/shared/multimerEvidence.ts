/**
 * multimerEvidence.ts — the one model the Multimer assembly tab and its Evidence Lineage rail render.
 *
 * ONE QUESTION: does this protein work as part of a complex, and does the variant residue sit at a
 * subunit interface? Three readings answer it, and they are never merged into one verdict:
 *   • curation   — UniProt's SUBUNIT record (what assembly is stated, and with whom);
 *   • prediction — a Boltz-2 complex model (ipTM, pTM, the contacts the residue makes);
 *   • observation — interface residues in solved PDB structures (PDBe-KB).
 *
 * INVARIANTS
 *   • No ACMG code is drawn from this tab; the engine record is always "None", and says so.
 *   • "Not stated", "not modelled here", "provider failed" and "monomer" are four states, never one.
 *   • ipTM is read against AlphaFold-Multimer's published guidance (EMBL-EBI: > 0.8 confident, < 0.6
 *     likely wrong, between a grey zone). Boltz-2 reports ipTM the same way but has no calibration
 *     of its own, so the marks are labelled "authors' guidance", never "calibrated", and drawn in
 *     neutral ink: a confident interface is not a pathogenic one.
 *   • At an interface means the variant residue itself is in a contact (`variantContacts`). A contact
 *     in the mutant model is never reported as a contact "lost" or "disrupted": no wild-type complex
 *     is modelled beside it.
 *   • A payload without `assembly` was written by the earlier service, whose SUBUNIT reading was
 *     broken; it is `stale` and the tab asks for a fresh one rather than rendering it.
 */
import type {
  AnalysisResult,
  MultimerAssemblyRecord,
  MultimerData,
  MultimerExperimentalPartner,
  MultimerNotModelledReason,
} from "./contracts.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";
import { THRESHOLDS } from "./thresholds/constants.ts";
import { AMINO_ACID_1_TO_3_TITLE } from "./aminoAcids.ts";
import { HGVS_PATTERN } from "./variantNotation.ts";
import { interfaceFootprint, parseSubunitAssembly, variantContacts, type InterfaceContact } from "./multimerAssembly.ts";

export type IptmBand = "confident" | "grey" | "low";

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

export const NOT_MODELLED_REASON: Record<MultimerNotModelledReason, string> = {
  unstated: "UniProt states no assembly for this protein, so there is nothing to model.",
  "interactions-only": "UniProt lists binary interactions only, with no assembly to model.",
  complex: "The protein is one subunit of a larger complex whose composition UniProt does not state.",
  "heteromer-partner": "The partner named in the SUBUNIT record could not be resolved to exactly one UniProt entry.",
  "heteromer-stoichiometry": "Only heterodimers are modelled: a larger heteromer's copy numbers are not stated reliably.",
  "too-many-chains": "This app models at most four chains, and a partial ring is not the stated assembly.",
  "reference-mismatch": "The variant's reference residue does not match the UniProt sequence at that position.",
  "no-sequence": "The UniProt sequence could not be read.",
};

export type InterfaceVerdict = "at-interface" | "not-at-interface" | "not-measured" | "pending";

export interface MultimerChainView {
  id: string;
  label: string;
  gene: string | null;
  accession: string;
  carriesVariant: boolean;
  /** "self" for copies of the analysed protein, "partner" for another protein. */
  role: "self" | "partner";
  modelled: boolean;
}

export interface MultimerModelView {
  state: "built" | "not-modelled" | "not-applicable" | "failed" | "pending" | "not-requested";
  /** A state chip label from ENGINE_STATE_LABELS, or null when a model exists. */
  stateLabel: string | null;
  reason: string | null;
  iptm: number | null;
  ptm: number | null;
  band: IptmBand | null;
  contactsTotal: number;
  /** Contacts the variant residue makes, nearest first. */
  variantContacts: InterfaceContact[];
  /** Residues on the variant's chain that make any contact. */
  footprint: number[];
  /** Sequence distance from the variant to the nearest interface residue, when it is not one. */
  nearestInterfaceGap: number | null;
  provenance: string | null;
  hasCoordinates: boolean;
  homomeric: boolean;
}

export interface ExperimentalView {
  state: "ok" | "none" | "error" | "pending" | "not-requested";
  stateLabel: string | null;
  reason: string | null;
  partners: Array<MultimerExperimentalPartner & { label: string }>;
  /** Partners whose interface includes the variant residue. */
  variantPartners: Array<MultimerExperimentalPartner & { label: string }>;
}

export interface MultimerEvidence {
  status: "ready" | "loading" | "error" | "idle" | "stale";
  errorText: string | null;
  gene: string;
  uniprotId: string | null;
  position: number | null;
  residueLabel: string;
  sequenceLength: number | null;
  domains: Array<{ start: number; end: number; name: string }>;
  assembly: {
    kind: MultimerAssemblyRecord["kind"];
    label: string;
    copies: number | null;
    homoAssumed: boolean;
    sentence: string | null;
    subunitText: string | null;
    alsoStated: string[];
    partners: Array<{ gene: string; accession: string | null; resolvedBy: string | null }>;
    /** "with UBA3", "2 identical chains", "single chain", … */
    composition: string;
  };
  chains: MultimerChainView[];
  model: MultimerModelView;
  experimental: ExperimentalView;
  interface: { verdict: InterfaceVerdict; label: string; source: string };
  finding: { headline: string; predicate: string };
  canRequestModel: boolean;
}

export function residueLabel(variant: string | undefined, position: number | null): string {
  const m = variant ? HGVS_PATTERN.exec(variant.replace(/^.*\((p\.[^)]+)\).*$/, "$1").trim()) : null;
  if (m) {
    const wt = m[1].length === 1 ? AMINO_ACID_1_TO_3_TITLE[m[1].toUpperCase()] ?? m[1] : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return `${wt}${m[2]}`;
  }
  return position ? `residue ${position}` : "the variant residue";
}

function partnerLabel(p: MultimerExperimentalPartner, gene: string): string {
  return p.homomeric ? `${gene} (another copy)` : p.name;
}

const COUNT_WORD: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 12: "twelve" };

export interface BuildMultimerEvidenceInput {
  result: AnalysisResult;
  data: MultimerData | null;
  isLoading: boolean;
  error: string | null;
}

export function buildMultimerEvidence({ result, data, isLoading, error }: BuildMultimerEvidenceInput): MultimerEvidence {
  const md: any = (result as any)?.metadata ?? {};
  const gene: string = md.gene ?? data?.gene ?? "This protein";
  const uniprotId: string | null = md.uniprotId ?? data?.uniprotId ?? null;
  const features = (result as any)?.uniprotFeatures ?? null;
  const position: number | null = data?.variantPosition ?? (Number.isFinite(md.residueIndex) && md.residueIndex > 0 ? md.residueIndex : null);
  const resLabel = residueLabel(md.variant, position);
  const sequenceLength: number | null = features?.sequenceLength ?? null;
  const domains = ((features?.features ?? []) as Array<{ type: string; description: string; start: number; end: number }>)
    .filter(f => f.type === "Domain" && f.start > 0 && f.end >= f.start)
    .map(f => ({ start: f.start, end: f.end, name: f.description || "Domain" }));

  const stale = Boolean(data && !data.assembly);
  const usable = data && !stale ? data : null;

  const status: MultimerEvidence["status"] = isLoading
    ? "loading"
    : error
    ? "error"
    : stale
    ? "stale"
    : usable
    ? "ready"
    : "idle";

  // Curation: the payload's record, or — before a payload arrives — the same parser over the
  // SUBUNIT text the main analysis already carries, so the screen never waits to say what is stated.
  const subunitText: string | null = usable?.subunitComment ?? features?.subunitComment ?? null;
  const parsed = parseSubunitAssembly(subunitText, gene);
  // Before the service answers, partners are the symbols the sentence names, not yet resolved.
  const rec = usable?.assembly ?? {
    ...parsed,
    partners: parsed.kind === "heteromer"
      ? parsed.partnerGenes.map(g => ({ gene: g, accession: null as string | null, resolvedBy: null as "interaction" | "swissprot" | null }))
      : [],
  };
  const partnerGene = rec.partners[0]?.gene ?? null;
  const composition =
    rec.kind === "monomer" ? "a single chain"
    : rec.kind === "homomer" ? `${COUNT_WORD[rec.copies ?? 0] ?? rec.copies} identical chains`
    : rec.kind === "heteromer" ? (rec.partners.length ? `with ${rec.partners.map(p => p.gene).join(" and ")}` : `${COUNT_WORD[rec.copies ?? 0] ?? "several"} different chains`)
    : rec.kind === "complex" ? "part of a larger complex"
    : rec.kind === "interactions-only" ? "binding partners listed, no assembly"
    : subunitText ? "no assembly in the record" : "no SUBUNIT record";

  // Chains: the modelled ones when a model was requested; otherwise the stated assembly, drawn as not modelled.
  let chains: MultimerChainView[];
  if (usable?.chains?.length) {
    chains = usable.chains.map(c => ({
      id: c.id,
      label: c.gene ?? c.accession,
      gene: c.gene,
      accession: c.accession,
      carriesVariant: c.carriesVariant,
      role: c.accession.toUpperCase() === (uniprotId ?? "").toUpperCase() ? "self" : "partner",
      modelled: usable.status === "success",
    }));
  } else {
    const n = rec.kind === "homomer" ? Math.min(rec.copies ?? 2, 12)
      : rec.kind === "heteromer" ? Math.max(2, Math.min(rec.copies ?? 2, 12))
      : 1;
    chains = Array.from({ length: n }, (_, i) => {
      const isPartner = rec.kind === "heteromer" && i > 0;
      const g = isPartner ? (rec.partners[i - 1]?.gene ?? null) : gene;
      return {
        id: String.fromCharCode(65 + i),
        label: g ?? "Partner",
        gene: g,
        accession: isPartner ? rec.partners[i - 1]?.accession ?? "" : uniprotId ?? "",
        carriesVariant: i === 0,
        role: isPartner ? "partner" : "self",
        modelled: false,
      } as MultimerChainView;
    });
  }

  // Model.
  const homomeric = rec.kind === "homomer";
  const contacts = usable?.interfaceContacts ?? [];
  const vContacts = variantContacts(contacts, position, homomeric);
  const footprint = interfaceFootprint(contacts, homomeric);
  let nearestGap: number | null = null;
  if (position && footprint.length && vContacts.length === 0) {
    nearestGap = Math.min(...footprint.map(r => Math.abs(r - position)));
  }
  const model: MultimerModelView = {
    state: "not-requested",
    stateLabel: null,
    reason: null,
    iptm: usable?.ipTm ?? null,
    ptm: usable?.pTm ?? null,
    band: iptmBand(usable?.ipTm),
    contactsTotal: contacts.length,
    variantContacts: vContacts,
    footprint,
    nearestInterfaceGap: nearestGap,
    provenance: usable?.provenance ?? null,
    hasCoordinates: Boolean(usable?.complexPdb),
    homomeric,
  };
  if (status === "loading") {
    Object.assign(model, { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "The complex is being modelled." });
  } else if (status === "error") {
    Object.assign(model, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: error });
  } else if (usable?.status === "success") {
    model.state = "built";
  } else if (usable?.status === "monomeric") {
    Object.assign(model, { state: "not-applicable", stateLabel: ENGINE_STATE_LABELS["not-covered"], reason: "A monomer has no subunit interface to model." });
  } else if (usable?.status === "not-modelled") {
    Object.assign(model, {
      state: "not-modelled",
      stateLabel: ENGINE_STATE_LABELS["not-installed"],
      reason: usable.notModelledReason ? NOT_MODELLED_REASON[usable.notModelledReason] : "This assembly is not modelled here.",
    });
  } else if (usable?.status === "failed") {
    Object.assign(model, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: usable.error ?? "The complex prediction did not return a model." });
  } else if (status === "stale") {
    Object.assign(model, { state: "not-requested", stateLabel: ENGINE_STATE_LABELS["no-result"], reason: "The stored result came from an earlier version that misread UniProt. Run the assembly again." });
  } else {
    Object.assign(model, { state: "not-requested", stateLabel: ENGINE_STATE_LABELS["no-result"], reason: "The assembly has not been evaluated for this variant yet." });
  }

  // Observation.
  const exp = usable?.experimental;
  const expPartners = (exp?.partners ?? []).map(p => ({ ...p, label: partnerLabel(p, gene) }));
  const experimental: ExperimentalView = !exp
    ? {
        state: status === "loading" ? "pending" : "not-requested",
        stateLabel: status === "loading" ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"],
        reason: status === "loading" ? "Reading solved structures from PDBe." : "Solved structures have not been checked yet.",
        partners: [],
        variantPartners: [],
      }
    : exp.status === "ok"
    ? { state: "ok", stateLabel: null, reason: null, partners: expPartners, variantPartners: expPartners.filter(p => p.variantAtInterface) }
    : exp.status === "none"
    ? { state: "none", stateLabel: ENGINE_STATE_LABELS["no-result"], reason: "PDBe records no protein–protein interface for this protein in any solved structure.", partners: [], variantPartners: [] }
    : { state: "error", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: exp.reason ?? "PDBe did not answer.", partners: [], variantPartners: [] };

  // Interface verdict: observation outranks prediction; either one placing the residue in a contact decides.
  let iface: MultimerEvidence["interface"];
  if (status === "loading") {
    iface = { verdict: "pending", label: ENGINE_STATE_LABELS.running, source: "Modelling and reading PDBe" };
  } else if (experimental.variantPartners.length) {
    iface = { verdict: "at-interface", label: "At an interface", source: "Seen in solved structures" };
  } else if (model.state === "built" && vContacts.length) {
    iface = { verdict: "at-interface", label: "At an interface", source: "In the predicted complex" };
  } else if (model.state === "built" || experimental.state === "ok") {
    iface = {
      verdict: "not-at-interface",
      label: "No contact",
      source: model.state === "built" && experimental.state === "ok" ? "Model and solved structures" : model.state === "built" ? "In the predicted complex" : "In solved structures",
    };
  } else {
    iface = { verdict: "not-measured", label: "Not measured", source: "No model or solved complex" };
  }

  // Finding.
  const headline =
    status === "loading" && !subunitText ? `Reading ${gene}'s assembly.`
    : rec.kind === "monomer" ? `UniProt states that ${gene} is a monomer.`
    : rec.kind === "homomer" ? `${gene} forms a ${rec.label.toLowerCase()}${rec.homoAssumed ? " (stated as a dimer; read as identical chains)" : ""}.`
    : rec.kind === "heteromer" ? `${gene} works as a ${rec.label.toLowerCase()}${partnerGene ? ` with ${rec.partners.map(p => p.gene).join(" and ")}` : ""}, not as a single chain.`
    : rec.kind === "complex" ? `${gene} is one subunit of a larger complex.`
    : rec.kind === "interactions-only" ? `UniProt lists binding partners for ${gene} but states no assembly.`
    : `UniProt states no assembly for ${gene}.`;

  const vp = experimental.variantPartners;
  const entriesOf = (p: MultimerExperimentalPartner) => p.pdbEntries.length;
  let predicate: string;
  if (status === "loading") {
    predicate = "The complex model and the solved-structure interfaces are still being read";
  } else if (vp.length) {
    const first = vp[0];
    predicate = `${resLabel} is at the interface with ${first.label}${entriesOf(first) ? ` in ${entriesOf(first)} solved structure${entriesOf(first) === 1 ? "" : "s"}` : " in solved structures"}${vp.length > 1 ? `, and with ${vp.length - 1} other partner${vp.length > 2 ? "s" : ""}` : ""}`;
    if (model.state === "built") predicate += vContacts.length ? "; the predicted complex agrees" : "; the predicted complex places it outside the interface";
  } else if (model.state === "built" && vContacts.length) {
    predicate = `In the predicted complex, ${resLabel} makes ${vContacts.length} contact${vContacts.length === 1 ? "" : "s"} with another chain${model.band ? ` (ipTM ${model.iptm!.toFixed(2)}, ${IPTM_BAND_LABEL[model.band].toLowerCase()})` : ""}. This is the variant model only, so whether a contact is lost is not measured`;
  } else if (model.state === "built") {
    predicate = `In the predicted complex, ${resLabel} makes no contact with another chain${nearestGap !== null ? `; the nearest interface residue is ${nearestGap} residue${nearestGap === 1 ? "" : "s"} away in sequence` : ""}`;
    if (experimental.state === "ok") predicate += ", and solved structures agree";
  } else if (experimental.state === "ok") {
    predicate = `Solved structures show ${experimental.partners.length} interface${experimental.partners.length === 1 ? "" : "s"}, none of them at ${resLabel}`;
  } else if (rec.kind === "monomer") {
    predicate = "There is no subunit interface to assess, and no solved structure shows one";
  } else {
    predicate = `Whether ${resLabel} touches another chain has not been measured here, so read the stability tabs as the single chain alone`;
  }

  const canRequestModel = status !== "loading" && (rec.kind === "homomer" || rec.kind === "heteromer" || status === "idle" || status === "stale" || status === "error" || model.state === "failed");

  return {
    status,
    errorText: error,
    gene,
    uniprotId,
    position,
    residueLabel: resLabel,
    sequenceLength,
    domains,
    assembly: {
      kind: rec.kind,
      label: rec.label,
      copies: rec.copies,
      homoAssumed: rec.homoAssumed,
      sentence: rec.sentence,
      subunitText,
      alsoStated: rec.alsoStated,
      partners: rec.partners,
      composition,
    },
    chains,
    model,
    experimental,
    interface: iface,
    finding: { headline, predicate },
    canRequestModel,
  };
}

export const MULTIMER_SOURCES: Array<{ citation: string; doi?: string; url?: string }> = [
  { citation: "Passaro S, et al. Boltz-2: towards accurate and efficient binding affinity prediction. bioRxiv 2025.", doi: "10.1101/2025.06.14.659707" },
  { citation: "Evans R, et al. Protein complex prediction with AlphaFold-Multimer. bioRxiv 2021 (ipTM defined).", doi: "10.1101/2021.10.04.463034" },
  { citation: "EMBL-EBI AlphaFold course: confidence scores in AlphaFold-Multimer (ipTM guidance).", url: "https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/confidence-scores-in-alphafold-multimer/" },
  { citation: "PDBe-KB aggregated API: interface residues per UniProt accession.", url: "https://www.ebi.ac.uk/pdbe/graph-api/pdbe_doc/" },
];
