/**
 * interactionsEvidence.ts — the one model the Protein interactions tab and its Evidence Lineage rail
 * render.
 *
 * ONE QUESTION: which proteins does this one bind or work with, does the variant residue fall in a
 * mapped binding site, and is a change in binding energy predicted? Four readings answer it:
 *   • curation    — UniProt SUBUNIT text, IntAct binary interactions, and "Interaction with X"
 *                   regions and sites;
 *   • observation — interface residues in solved structures (PDBe-KB);
 *   • association — STRING's functional network (co-expression, text mining, pathways);
 *   • prediction  — DDMut-PPI ΔΔG_bind on a wild-type complex model.
 *
 * INVARIANTS
 *   • No ACMG code is drawn from this tab; the engine record is always "None", and says so.
 *   • A STRING score is functional association, never binding. It is drawn in neutral ink and a
 *     partner known only from STRING sits under "Functional association only".
 *   • An empty list is an answer only when its lookup is "ok". Failed, skipped and not-yet-asked are
 *     states with words, never an empty table.
 *   • ΔΔG_bind carries DDMut-PPI's own sign: ≤ 0 is weaker binding (Zhou et al., NAR 2024). No class
 *     is attached, because the authors publish no cut-point.
 *   • The binding change is computed on a WILD-TYPE complex only. A payload from the earlier service
 *     (which scored the variant model as the wild type) is not rendered.
 *   • The assembly (monomer, heterodimer …) is stated once, on the Multimer tab; this tab links to it.
 *
 * DEFECTS THIS REPLACED (doc/INTERACTIONS_TAB_REVIEW.md): the sign-inverted, unsourced ΔΔG classes;
 * "OpenBind-0 (Tier 1)" named for a model that never ran; "Swiss-Prot records no interface" when
 * UniProt maps two UBA3 contacts; "Monomer · Intramolecular" for a heterodimer; green "Highest" chips
 * on functional association.
 */
import type {
  AnalysisResult,
  MultimerData,
  PpiBindingData,
  PpiBindingShift,
  PpiInteractionSite,
  PpiObservedInterface,
} from "./contracts.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";
import { stringConfidenceLabel } from "./thresholds/evaluators.ts";
import { subunitPartnerMentions } from "./multimerAssembly.ts";
import { residueLabel as formatResidue } from "./multimerEvidence.ts";

export type SectionState = "ok" | "empty" | "failed" | "skipped" | "pending" | "unknown";

export interface SectionStatus {
  state: SectionState;
  /** Chip text for a non-answer, from ENGINE_STATE_LABELS; null when there is an answer. */
  label: string | null;
  /** One sentence for a non-answer; null when there is an answer. */
  reason: string | null;
}

export interface PartnerRow {
  key: string;
  gene: string;
  accession: string | null;
  group: "physical" | "functional";
  /** "Heterodimer partner", "Binds", "Binary interaction" … */
  evidence: string;
  /** Short list of the curated sources: "SUBUNIT · IntAct, 3 experiments". */
  evidenceNote: string;
  subunitSentence: string | null;
  intactExperiments: number | null;
  string: { score: number; band: string | null } | null;
  sites: PpiInteractionSite[];
  observed: PpiObservedInterface | null;
  variantInSite: boolean;
  variantAtObservedInterface: boolean;
}

export interface TrackRow {
  key: string;
  label: string;
  sub: string;
  mapped: Array<{ start: number; end: number; hit: boolean; title: string }>;
  solved: number[];
  hit: boolean;
}

export type BindingState = "ok" | "running" | "failed" | "not-applicable" | "needs-model" | "ready" | "pending" | "stale";

export interface BindingView {
  state: BindingState;
  stateLabel: string | null;
  reason: string | null;
  value: number | null;
  valueText: string | null;
  direction: "weaker" | "stronger" | "none" | null;
  directionText: string | null;
  partnerText: string | null;
  predictor: string;
  wildType: PpiBindingShift["wildType"];
  /** Chains to request with, when a wild-type complex can be modelled. */
  chains: Array<{ id: string; accession: string; gene: string | null }>;
  canRequest: boolean;
}

export interface InteractionsEvidence {
  status: "ready" | "loading" | "error";
  errorText: string | null;
  gene: string;
  uniprotId: string | null;
  position: number | null;
  residueLabel: string;
  sequenceLength: number | null;
  sections: { string: SectionStatus; uniprot: SectionStatus; pdbe: SectionStatus };
  partners: PartnerRow[];
  sites: PpiInteractionSite[];
  track: TrackRow[];
  binding: BindingView;
  finding: { figure: string; headline: string; predicate: string };
  facts: Array<{ label: string; value: string; sub: string }>;
  trace: Array<{ label: string; value: string; warn?: string }>;
  stringUrl: string | null;
}

export const DDMUT_PPI_PERFORMANCE =
  "DDMut-PPI's authors report a continuous value with no cut-point (Pearson r 0.75 in cross-validation, 0.60 on a blind antibody–antigen set).";

export const INTERACTIONS_SOURCES: Array<{ citation: string; doi?: string; url?: string }> = [
  { citation: "Szklarczyk D, et al. The STRING database in 2023. Nucleic Acids Res 2023;51:D638.", doi: "10.1093/nar/gkac1000" },
  { citation: "Zhou Y, Myung Y, Rodrigues CHM, Ascher DB. DDMut-PPI. Nucleic Acids Res 2024;52:W207.", doi: "10.1093/nar/gkae412" },
  { citation: "Passaro S, et al. Boltz-2 (wild-type complex model). bioRxiv 2025.", doi: "10.1101/2025.06.14.659707" },
  { citation: "Del Toro N, et al. The IntAct database. Nucleic Acids Res 2022;50:D648.", doi: "10.1093/nar/gkab1006" },
  { citation: "PDBe-KB aggregated API: interface residues per UniProt accession.", url: "https://www.ebi.ac.uk/pdbe/graph-api/pdbe_doc/" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function rangeText(s: { start: number; end: number }): string {
  return s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`;
}

/** The STRING page for the query protein's network (the form STRING documents for linking). */
export function stringNetworkUrl(gene: string, partner?: string): string {
  const ids = partner ? `${encodeURIComponent(gene)}%0d${encodeURIComponent(partner)}` : encodeURIComponent(gene);
  return `https://string-db.org/cgi/network?identifiers=${ids}&species=9606`;
}

function section(
  status: string | undefined,
  hasItems: boolean,
  pending: boolean,
  words: { failed: string; skipped: string; empty: string; unknown: string }
): SectionStatus {
  if (pending) return { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null };
  if (status === "ok" || (status === undefined && hasItems)) {
    return hasItems ? { state: "ok", label: null, reason: null } : { state: "empty", label: ENGINE_STATE_LABELS["no-result"], reason: words.empty };
  }
  if (status === "none") return { state: "empty", label: ENGINE_STATE_LABELS["no-result"], reason: words.empty };
  if (status === "failed") return { state: "failed", label: ENGINE_STATE_LABELS["upstream-error"], reason: words.failed };
  if (status === "skipped") return { state: "skipped", label: ENGINE_STATE_LABELS["not-covered"], reason: words.skipped };
  return { state: "unknown", label: ENGINE_STATE_LABELS["no-result"], reason: words.unknown };
}

export interface BuildInteractionsInput {
  result: AnalysisResult;
  ppi: PpiBindingData | null;
  ppiStatus: "loading" | "ready" | "error";
  ppiError?: string | null;
  shift: PpiBindingShift | null;
  shiftLoading: boolean;
  shiftError?: string | null;
}

export function buildInteractionsEvidence(input: BuildInteractionsInput): InteractionsEvidence {
  const { result, ppiStatus, shiftLoading } = input;
  const md: any = (result as any)?.metadata ?? {};
  const gene: string = md.gene ?? input.ppi?.gene ?? "This protein";
  const uniprotId: string | null = md.uniprotId ?? input.ppi?.uniprotId ?? null;
  const features: any = (result as any)?.uniprotFeatures ?? null;

  // A payload from the earlier service has no `lookups.uniprot`; its sites were read with the broken
  // filter, so only its STRING list is used.
  const ppi = input.ppi;
  const current = Boolean(ppi?.lookups && "uniprot" in ppi.lookups);
  const loading = ppiStatus === "loading" && !current;

  const position: number | null =
    ppi?.position ?? (Number.isFinite(md.residueIndex) && md.residueIndex > 0 ? md.residueIndex : null);
  const resLabel = formatResidue(md.variant, position);
  const sequenceLength: number | null = (current ? ppi?.sequenceLength : null) ?? features?.sequenceLength ?? null;

  // ── Sources ───────────────────────────────────────────────────────────────
  const stringPartners = ppi ? ppi.stringPartners : ((result as any)?.stringInteractions ?? []);
  const subunitText: string | null = (current ? ppi?.subunitComment : null) ?? features?.subunitComment ?? null;
  const intact = (current ? ppi?.curatedInteractions : null) ?? features?.interactionPartners ?? [];
  const sites: PpiInteractionSite[] = current ? ppi?.interactionSites ?? [] : [];
  const observed: PpiObservedInterface[] = current ? ppi?.observedInterfaces ?? [] : [];

  const stringSec = section(
    ppi?.lookups?.stringPartners ?? (ppiStatus === "error" ? "failed" : undefined),
    stringPartners.length > 0,
    ppiStatus === "loading" && !ppi,
    {
      failed: "STRING did not answer, so no partner list is available. This is not evidence that there is none.",
      skipped: "",
      empty: `STRING returns no association for ${gene} at or above its lowest band.`,
      unknown: "This response does not say whether STRING was asked.",
    }
  );
  const uniprotSec = section(
    current ? ppi?.lookups?.uniprot : ppiStatus === "error" ? "failed" : undefined,
    intact.length > 0 || sites.length > 0 || Boolean(subunitText),
    loading,
    {
      failed: "UniProt did not answer, so curated partners and mapped sites were not checked.",
      skipped: `No UniProt accession was resolved for ${gene}, so nothing curated was asked for.`,
      empty: `UniProt records no curated partner or mapped interaction site for ${gene}.`,
      unknown: "Curated partners and mapped sites have not been read for this variant yet.",
    }
  );
  const pdbeSec = section(
    current ? ppi?.lookups?.pdbe : ppiStatus === "error" ? "failed" : undefined,
    observed.length > 0,
    loading,
    {
      failed: "PDBe did not answer, so solved structures were not checked.",
      skipped: "No UniProt accession was resolved, so solved structures were not checked.",
      empty: `PDBe records no protein–protein interface for ${gene} in any solved structure.`,
      unknown: "Solved structures have not been read for this variant yet.",
    }
  );

  // ── Partners: one row each, joined by accession, then by gene symbol ─────────
  const rows = new Map<string, PartnerRow>();
  const byGene = new Map<string, string>();
  const byAcc = new Map<string, string>();
  const keyFor = (g: string | null, acc: string | null): string => {
    const G = g?.toUpperCase() ?? null;
    if (acc && byAcc.has(acc)) return byAcc.get(acc)!;
    if (G && byGene.has(G)) return byGene.get(G)!;
    return acc ?? G ?? `row${rows.size}`;
  };
  const upsert = (g: string | null, acc: string | null): PartnerRow => {
    const key = keyFor(g, acc);
    let row = rows.get(key);
    if (!row) {
      row = {
        key, gene: g ?? acc ?? "Partner", accession: acc, group: "functional", evidence: "", evidenceNote: "",
        subunitSentence: null, intactExperiments: null, string: null, sites: [], observed: null,
        variantInSite: false, variantAtObservedInterface: false,
      };
      rows.set(key, row);
    }
    if (acc && !row.accession) row.accession = acc;
    if (row.accession) byAcc.set(row.accession, key);
    if (g && (row.gene === row.accession || row.gene === "Partner")) row.gene = g;
    if (row.gene) byGene.set(row.gene.toUpperCase(), key);
    return row;
  };

  for (const m of subunitPartnerMentions(subunitText, gene)) {
    const row = upsert(m.gene, null);
    row.subunitSentence = m.sentence;
  }
  for (const c of intact as Array<{ accession: string; gene: string | null; experiments: number | null }>) {
    const row = upsert(c.gene, c.accession);
    row.intactExperiments = c.experiments ?? 0;
  }
  for (const o of observed) {
    if (o.homomeric) continue;
    const row = upsert(null, o.accession);
    if (row.gene === o.accession) row.gene = o.name;
    row.observed = o;
    row.variantAtObservedInterface = o.variantAtInterface;
  }
  for (const s of sites) {
    for (const p of s.partners) {
      if (p.toUpperCase() === gene.toUpperCase()) continue;
      const row = upsert(p, null);
      row.sites.push(s);
      if (s.containsVariant) row.variantInSite = true;
    }
  }
  for (const p of stringPartners as Array<{ partner: string; score: number }>) {
    if (!Number.isFinite(p.score)) continue;
    const row = upsert(p.partner, null);
    row.string = { score: p.score, band: stringConfidenceLabel(p.score) };
  }

  // The partner the assembly sentence names ("Heterodimer of UBA3 and NAE1"), for "Binds the NAE1–UBA3 complex".
  const assemblyPartner = [...rows.values()].find(r => r.subunitSentence && /\b(hetero|homo)?(di|tri|tetra)mer\b/i.test(r.subunitSentence) && r.subunitSentence.toUpperCase().includes(r.gene.toUpperCase()))?.gene ?? null;
  for (const row of rows.values()) {
    const physical = Boolean(row.subunitSentence || row.intactExperiments !== null || row.observed || row.sites.length);
    row.group = physical ? "physical" : "functional";
    const s = row.subunitSentence ?? "";
    row.evidence = /\b(hetero|homo)?(di|tri|tetra)mer\b/i.test(s) && s.toUpperCase().includes(row.gene.toUpperCase())
      ? "Assembly partner"
      : /\bcomplex binds\b/i.test(s)
        ? `Binds the ${assemblyPartner ? `${gene}–${assemblyPartner}` : gene} complex`
        : row.subunitSentence
          ? "Binds"
          : row.intactExperiments !== null
            ? "Binary interaction"
            : row.observed
              ? "Interface in solved structures"
              : row.sites.length
                ? "Mapped site"
                : "No curated interaction";
    const notes: string[] = [];
    if (row.subunitSentence) notes.push("SUBUNIT");
    if (row.intactExperiments !== null) notes.push(`IntAct, ${plural(row.intactExperiments, "experiment")}`);
    if (row.observed) notes.push(`${plural(row.observed.pdbEntries, "PDB entry", "PDB entries")}`);
    row.evidenceNote = notes.join(" · ");
  }

  const rank = (r: PartnerRow) =>
    (r.variantInSite || r.variantAtObservedInterface ? 0 : 1) * 10 +
    (r.sites.length || r.observed ? 0 : 1) * 5 +
    (r.intactExperiments !== null ? 0 : 1) * 2 +
    (r.subunitSentence ? 0 : 1);
  const partners = [...rows.values()].sort((a, b) =>
    a.group !== b.group ? (a.group === "physical" ? -1 : 1) : rank(a) - rank(b) || (b.string?.score ?? 0) - (a.string?.score ?? 0)
  );

  // ── Track: one row per partner with a mapped site or a solved interface ────────
  const track: TrackRow[] = partners
    .filter(p => p.sites.length || p.observed)
    .map(p => ({
      key: p.key,
      label: p.gene,
      sub: [p.sites.length ? `${plural(p.sites.length, "mapped site")}` : null, p.observed ? `solved, ${plural(p.observed.pdbEntries, "entry", "entries")}` : null]
        .filter(Boolean).join(" · "),
      mapped: p.sites.map(s => ({ start: s.start, end: s.end, hit: s.containsVariant, title: `${s.type} ${rangeText(s)} · ${s.description}` })),
      solved: p.observed?.residues ?? [],
      hit: p.variantInSite || p.variantAtObservedInterface,
    }));
  // Sites that name no partner still belong on the sequence.
  const orphan = sites.filter(s => s.partners.length === 0 || s.partners.every(p => p.toUpperCase() === gene.toUpperCase()));
  if (orphan.length) {
    track.push({
      key: "unnamed",
      label: "Other sites",
      sub: `${plural(orphan.length, "mapped site")}`,
      mapped: orphan.map(s => ({ start: s.start, end: s.end, hit: s.containsVariant, title: `${s.type} ${rangeText(s)} · ${s.description}` })),
      solved: [],
      hit: orphan.some(s => s.containsVariant),
    });
  }
  const homo = observed.find(o => o.homomeric);
  if (homo) {
    track.push({ key: "self", label: `${gene} (another copy)`, sub: `solved, ${plural(homo.pdbEntries, "entry", "entries")}`, mapped: [], solved: homo.residues, hit: homo.variantAtInterface });
  }

  // ── Binding energy change ────────────────────────────────────────────────
  const multimer = (result as any)?.multimerData as MultimerData | null | undefined;
  const modelChains = multimer?.status === "success" && multimer.chains?.length
    ? multimer.chains.map(c => ({ id: c.id, accession: c.accession, gene: c.gene }))
    : [];
  const chainsOk =
    modelChains.length >= 2 &&
    modelChains[0].id === "A" &&
    Boolean(uniprotId) &&
    modelChains[0].accession.toUpperCase().replace(/-\d+$/, "") === uniprotId!.toUpperCase().replace(/-\d+$/, "");
  const shift = input.shift;
  const partnerGenes = (shift?.wildType?.chains ?? modelChains).slice(1).map(c => c.gene ?? c.accession);
  const partnerText = partnerGenes.length ? `to ${[...new Set(partnerGenes)].join(" and ")}` : null;

  const binding: BindingView = {
    state: "needs-model",
    stateLabel: ENGINE_STATE_LABELS["no-result"],
    reason: null,
    value: null,
    valueText: null,
    direction: null,
    directionText: null,
    partnerText,
    predictor: shift?.predictor ?? "DDMut-PPI",
    wildType: shift?.wildType ?? null,
    chains: chainsOk ? modelChains : [],
    canRequest: false,
  };
  const legacyShift = Boolean(ppi && (ppi as any).bindingShift);
  if (shiftLoading) {
    Object.assign(binding, { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "Modelling the wild-type complex and running DDMut-PPI." });
  } else if (input.shiftError) {
    Object.assign(binding, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: input.shiftError, canRequest: chainsOk });
  } else if (shift?.status === "ok" && Number.isFinite(shift.ddgBind)) {
    const v = shift.ddgBind as number;
    const direction = v < 0 ? "weaker" : v > 0 ? "stronger" : "none";
    Object.assign(binding, {
      state: "ok",
      stateLabel: null,
      value: v,
      valueText: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} kcal/mol`,
      direction,
      directionText: direction === "weaker" ? "Weaker binding" : direction === "stronger" ? "Stronger binding" : "No change predicted",
      canRequest: false,
    });
  } else if (shift?.status === "running") {
    Object.assign(binding, { state: "running", stateLabel: ENGINE_STATE_LABELS.running, reason: shift.reason ?? "DDMut-PPI is still computing.", canRequest: chainsOk });
  } else if (shift?.status === "failed") {
    Object.assign(binding, { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: shift.reason ?? "The prediction did not return a value.", canRequest: chainsOk });
  } else if (shift?.status === "not-applicable") {
    Object.assign(binding, { state: "not-applicable", stateLabel: ENGINE_STATE_LABELS["not-covered"], reason: shift.reason ?? "A binding change cannot be computed for this variant." });
  } else if (chainsOk) {
    Object.assign(binding, {
      state: "ready",
      stateLabel: null,
      reason: `Not run yet. It models the wild-type complex ${partnerText ? `with ${partnerText.slice(3)} ` : ""}and scores ${resLabel} on it with DDMut-PPI.`,
      canRequest: true,
    });
  } else {
    const r = multimer?.status === "monomeric"
      ? "UniProt states a monomer, so there is no partner chain to bind."
      : multimer?.status === "not-modelled"
        ? "The Multimer tab could not model this assembly, so there is no complex to build a wild type from."
        : multimer?.status === "failed"
          ? "The complex model failed on the Multimer tab, so there is no complex to build a wild type from."
          : "Needs a complex model. Open the Multimer tab to build one, then estimate the change here.";
    Object.assign(binding, { state: "needs-model", stateLabel: multimer?.status === "monomeric" ? ENGINE_STATE_LABELS["not-covered"] : null, reason: r });
  }
  if (legacyShift && binding.state === "needs-model") {
    binding.reason = `${binding.reason} A value stored by an earlier version was computed on the variant model as its wild type and is not shown.`;
  }

  // ── Finding ──────────────────────────────────────────────────────────────
  const siteHits = sites.filter(s => s.containsVariant);
  const obsHits = observed.filter(o => o.variantAtInterface);
  const physicalCount = partners.filter(p => p.group === "physical").length;
  const namesOf = (xs: string[]) => [...new Set(xs)].join(" and ");
  let figure: string;
  let headline: string;
  let predicate: string;
  if (loading) {
    figure = "Reading";
    headline = `Reading curated partners and binding sites for ${gene}.`;
    predicate = "UniProt, PDBe and STRING are being asked";
  } else if (siteHits.length || obsHits.length) {
    figure = siteHits.length ? "In a mapped site" : "At an interface";
    const parts: string[] = [];
    if (siteHits.length) {
      const partnersHit = siteHits.flatMap(s => s.partners);
      parts.push(`in UniProt's ${partnersHit.length ? `${namesOf(partnersHit)} ` : ""}interaction ${siteHits.length === 1 ? "site" : "sites"} (${siteHits.map(rangeText).join(", ")})`);
    }
    if (obsHits.length) {
      const e = obsHits.reduce((n, o) => n + o.pdbEntries, 0);
      parts.push(`at the interface with ${namesOf(obsHits.map(o => (o.homomeric ? `another ${gene} copy` : rows.get(byAcc.get(o.accession) ?? "")?.gene ?? o.name)))} in ${plural(e, "solved structure")}`);
    }
    headline = `${resLabel} is ${parts.join(", and ")}.`;
    predicate = binding.state === "ok"
      ? `DDMut-PPI predicts ${binding.directionText!.toLowerCase()} (${binding.valueText})`
      : "Contact is not disruption: whether binding changes is a separate prediction, below";
  } else if (uniprotSec.state === "ok" || uniprotSec.state === "empty" || pdbeSec.state === "ok" || pdbeSec.state === "empty") {
    const mapped = sites.length > 0;
    figure = mapped || observed.length ? "Outside mapped sites" : "No mapped sites";
    headline = mapped
      ? `${resLabel} does not fall in any binding site UniProt maps for ${gene}.`
      : uniprotSec.state === "ok" || uniprotSec.state === "empty"
        ? `UniProt maps no protein-interaction site on ${gene}, so none can place ${resLabel}.`
        : `UniProt's mapped sites were not read for ${gene}.`;
    predicate = pdbeSec.state === "ok"
      ? `Solved structures show ${plural(observed.length, "interface")}, none of them at ${resLabel}`
      : pdbeSec.state === "empty"
        ? "No solved structure shows an interface to compare against"
        : `Solved structures were not read, so a contact at ${resLabel} is not ruled out`;
  } else {
    figure = "Not checked";
    headline = `Curated sites and solved structures were not read for ${gene}.`;
    predicate = uniprotSec.reason ?? "No lookup answered";
  }

  const facts = [
    {
      label: "Curated partners",
      value: uniprotSec.state === "ok" || uniprotSec.state === "empty" ? String(physicalCount) : "—",
      sub: uniprotSec.state === "ok" || uniprotSec.state === "empty" ? "SUBUNIT, IntAct, solved" : uniprotSec.label ?? "",
    },
    {
      label: "Mapped sites",
      value: uniprotSec.state === "ok" || uniprotSec.state === "empty" ? String(sites.length) : "—",
      sub: sites.length
        ? `${siteHits.length ? `${siteHits.length} contain${siteHits.length === 1 ? "s" : ""}` : "None contains"} ${resLabel}`
        : uniprotSec.state === "ok" || uniprotSec.state === "empty" ? "UniProt maps none" : uniprotSec.label ?? "",
    },
    {
      label: "Binding change",
      value: binding.state === "ok" ? binding.valueText! : binding.state === "pending" || binding.state === "running" ? ENGINE_STATE_LABELS.running : "Not measured",
      sub: binding.state === "ok" ? `${binding.directionText} · DDMut-PPI` : binding.state === "ready" ? "Ready to estimate" : "No wild-type complex scored",
    },
    { label: "Engine record", value: "None", sub: "No ACMG code uses this tab" },
  ];

  const trace = [
    {
      label: "Curated partners",
      value: uniprotSec.state === "ok" || uniprotSec.state === "empty"
        ? `${plural(physicalCount, "partner")} from SUBUNIT, IntAct and solved structures${uniprotId ? ` (${uniprotId})` : ""}`
        : uniprotSec.reason ?? "Not read",
      warn: uniprotSec.state === "failed" || uniprotSec.state === "skipped" ? uniprotSec.label ?? undefined : undefined,
    },
    {
      label: "Mapped sites",
      value: sites.length ? sites.map(s => `${s.type} ${rangeText(s)}${s.partners.length ? ` (${s.partners.join(", ")})` : ""}`).join("; ") : uniprotSec.state === "ok" || uniprotSec.state === "empty" ? "None mapped" : "Not read",
    },
    {
      label: "Solved structures",
      value: pdbeSec.state === "ok" ? `${plural(observed.length, "interface")} in PDBe-KB` : pdbeSec.reason ?? "Not read",
      warn: pdbeSec.state === "failed" ? pdbeSec.label ?? undefined : undefined,
    },
    {
      label: "Variant",
      value: position === null ? "Position not read" : siteHits.length || obsHits.length ? `Residue ${position} is in ${siteHits.length ? "a mapped site" : ""}${siteHits.length && obsHits.length ? " and " : ""}${obsHits.length ? "a solved interface" : ""}` : `Residue ${position} is in no mapped site or solved interface`,
    },
    {
      label: "Functional network",
      value: stringSec.state === "ok" ? `STRING, ${plural(stringPartners.length, "strongest partner")}` : stringSec.reason ?? "Not read",
      warn: stringSec.state === "failed" ? stringSec.label ?? undefined : undefined,
    },
    {
      label: "Binding change",
      value: binding.state === "ok" ? `${binding.valueText} on a wild-type model (ipTM ${binding.wildType?.ipTm?.toFixed(2) ?? "not reported"})` : "Not measured",
      warn: binding.state === "ok" ? undefined : binding.state === "pending" || binding.state === "running" ? `${ENGINE_STATE_LABELS.running}.` : binding.state === "ready" ? "Not run yet." : binding.state === "failed" ? `${ENGINE_STATE_LABELS["upstream-error"]}.` : "No wild-type complex.",
    },
    { label: "Engine record", value: "None: no ACMG code uses this tab" },
  ];

  return {
    status: loading ? "loading" : ppiStatus === "error" && !ppi ? "error" : "ready",
    errorText: input.ppiError ?? null,
    gene,
    uniprotId,
    position,
    residueLabel: resLabel,
    sequenceLength,
    sections: { string: stringSec, uniprot: uniprotSec, pdbe: pdbeSec },
    partners,
    sites,
    track,
    binding,
    finding: { figure, headline, predicate },
    facts,
    trace,
    stringUrl: md.gene ? stringNetworkUrl(md.gene) : null,
  };
}
