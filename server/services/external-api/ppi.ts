/**
 * server/services/external-api/ppi.ts — partners, mapped binding sites and the binding energy change
 * for one variant (the Interfaces & PPI tab).
 *
 * Two requests, because they cost very different amounts:
 *   • `analyzePpiBinding`  — lookups only: STRING's physical and functional networks, UniProt's
 *     curated partners (SUBUNIT, IntAct) with IntAct's methods and studies, and mapped interaction
 *     sites. Solved-structure interfaces are read once, by the assembly service (`multimer.ts`).
 *   • `analyzeBindingShift` — DDMut-PPI on a WILD-TYPE complex: a solved one where the residue is at
 *     the interface, else (no solved complex at all) a Boltz-2 model of the assembly's chains.
 *
 * Also replaced (doc/INTERFACES_AUDIT.md): STRING cut to its functional top five, so curated partners
 * read "not in STRING's top five" and STRING was never asked about them; IntAct "experiments" shown as
 * replication when they were assay versions in one screen; a predicted wild type when eight solved
 * complexes existed; the binding change blocked until the variant model succeeded.
 *
 * DEFECTS THIS REPLACED (doc/INTERACTIONS_TAB_REVIEW.md)
 *   • DDMut-PPI was handed the Multimer tab's complex as its wild type. That complex carries the
 *     variant on chain A, so the substitution was applied to a residue already substituted.
 *   • The DDMut-PPI value was classed "Interface disruptive" at ≥ 1.0. DDMut-PPI reports reduced
 *     affinity as ΔΔG ≤ 0 (Zhou et al., NAR 2024), so a strongly weakening prediction read as
 *     "Surface neutral". Its authors publish no cut-points; the classes are gone and the sign
 *     convention travels with the value.
 *   • An "OpenBind-0 (Tier 1)" path ran only when the client sent a mutant PDB, which it never did.
 *   • Curated interface residues dropped every `Region` and `Site` feature and then required words
 *     such as "interface" or "subunit", so "Interaction with UBA3" (NAE1 331–344 and 211) was
 *     reported as "no residue-level interface annotation". Ranges were reduced to their start and
 *     the list was capped at five.
 */
import { fetchStringPartnerLists } from "./string.ts";
import { fetchUniprotFeatures, fetchUniprotSequence } from "./uniprot.ts";
import { fetchPdbeInterfaces, observedFor } from "./pdbe-interfaces.ts";
import { fetchEntryExperiment, fetchPdbFormat, locateResidue } from "./pdbe-entries.ts";
import { fetchIntactEvidence } from "./intact.ts";
import { runBoltz2Multimer } from "./japanfold-client.ts";
import { evaluateDdmutPpi } from "../stability/ddmut-ppi.ts";
import { analyzeMultimerStructure, failureSentence } from "../structure/multimer.ts";
import { parseMutationParam } from "../../utils/mutation.ts";
import type {
  IntactEvidence,
  PpiBindingData,
  PpiBindingShift,
  PpiCuratedInteraction,
  PpiInteractionSite,
  PpiLookupStatus,
} from "../../../src/shared/contracts.ts";
import { MAX_MODELLED_CHAINS } from "../../../src/shared/multimerAssembly.ts";

export type PpiBindingAffinityResult = PpiBindingData;
export type { PpiLookupStatus };

/** UniProt feature types that can map a contact with another protein. */
const SITE_TYPES = new Set(["Region", "Site", "Binding site", "Motif"]);

/**
 * "Interaction with UBA3", "Interaction with UBA3 and NEDD8", "Necessary for interaction with X",
 * "Dimer interface". Ligand binding sites ("ATP", "Zn(2+)") name no protein and are not read.
 */
const INTERACTION_NOTE = /\binteraction with\b|\b(?:dimer|subunit|oligomer|homodimer|heterodimer) interface\b|\binterface with\b/i;

function partnersNamed(description: string): string[] {
  const m = /\b(?:interaction|interface) with\s+(.+)$/i.exec(description);
  if (!m) return [];
  const out: string[] = [];
  for (const t of m[1].matchAll(/\b[A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]{1,4})?\b/g)) {
    if (!/[A-Z0-9]/.test(t[0].slice(1))) continue;
    if (!out.includes(t[0])) out.push(t[0]);
  }
  return out;
}

export function readInteractionSites(
  features: Array<{ type: string; description?: string; start: number; end: number }>,
  position: number | null
): PpiInteractionSite[] {
  return features
    .filter(f => SITE_TYPES.has(f.type) && f.start > 0 && f.end >= f.start && INTERACTION_NOTE.test(f.description ?? ""))
    .map(f => ({
      type: f.type,
      start: f.start,
      end: f.end,
      description: f.description ?? f.type,
      partners: partnersNamed(f.description ?? ""),
      containsVariant: position !== null && position >= f.start && position <= f.end,
    }))
    .sort((a, b) => a.start - b.start);
}

export async function analyzePpiBinding(
  gene: string,
  variant: string,
  uniprotId?: string,
  signal?: AbortSignal
): Promise<PpiBindingAffinityResult> {
  const parsed = parseMutationParam(variant);
  const position = parsed?.posNum && parsed.posNum > 0 ? parsed.posNum : null;

  const stringTask = fetchStringPartnerLists(gene).catch((err: any) => {
    console.warn(`[PPI Service] STRING lookup threw for ${gene}:`, err?.message);
    return null;
  });

  const uniprotTask = (async () => {
    if (!uniprotId) return { status: "skipped" as PpiLookupStatus, features: null };
    try {
      const features = await fetchUniprotFeatures(uniprotId);
      return { status: (features ? "ok" : "failed") as PpiLookupStatus, features };
    } catch (err: any) {
      console.warn(`[PPI Service] UniProt features failed for ${uniprotId}:`, err?.message);
      return { status: "failed" as PpiLookupStatus, features: null };
    }
  })();

  const intactTask = (async (): Promise<{ status: PpiLookupStatus; byPartner: Map<string, IntactEvidence> }> => {
    if (!uniprotId) return { status: "skipped", byPartner: new Map() };
    const r = await fetchIntactEvidence(uniprotId, signal);
    return { status: r.status === "ok" ? "ok" : "failed", byPartner: r.byPartner };
  })();

  const [lists, uniprotRes, intactRes] = await Promise.all([stringTask, uniprotTask, intactTask]);
  const f = uniprotRes.features;
  const curated: PpiCuratedInteraction[] = (f?.interactionPartners ?? []).map(p => ({
    accession: p.accession,
    gene: p.gene,
    experiments: p.experiments,
    evidence: intactRes.byPartner.get(p.accession.toUpperCase().replace(/-\d+$/, "")) ?? null,
  }));

  return {
    status: "success",
    gene,
    variant,
    uniprotId,
    position,
    // The legacy field keeps the functional top five for older readers.
    stringPartners: (lists?.functional ?? []).slice(0, 5),
    string: lists ? { physical: lists.physical, functional: lists.functional, limit: lists.limit, minScore: lists.minScore } : undefined,
    stringVersion: lists?.version ?? null,
    subunitComment: f?.subunitComment ?? null,
    curatedInteractions: curated,
    interactionSites: f ? readInteractionSites(f.features ?? [], position) : [],
    sequenceLength: f?.sequenceLength ?? null,
    lookups: {
      stringPartners: lists?.functional ? "ok" : "failed",
      stringPhysical: lists?.physical ? "ok" : "failed",
      intact: intactRes.status,
      uniprot: uniprotRes.status,
    },
  };
}

export interface BindingShiftChain {
  id: string;
  accession: string;
  gene?: string | null;
}

const DDMUT_PPI = "DDMut-PPI";
/** Solved entries tried, best resolution first, before giving up on an experimental wild type. */
const MAX_ENTRIES_TRIED = 4;

type Experimental =
  | { kind: "found"; pdbText: string; pdbId: string; chain: string; authorResidue: number; method: string | null; resolution: number | null; partners: Array<{ accession: string; name: string }> }
  | { kind: "not-interfacial"; reason: string }
  | { kind: "none"; reason: string };

/**
 * The solved complex to score on: an entry in which the variant residue is at the interface with a
 * biological partner (construct tags excluded), observed, carrying the reference residue, and
 * available in PDB format. Best resolution first.
 */
async function experimentalWildType(uniprotId: string, position: number, wtLetter: string, signal?: AbortSignal): Promise<Experimental> {
  const lookup = await fetchPdbeInterfaces(uniprotId, signal);
  if (lookup.status !== "ok") {
    return { kind: "none", reason: lookup.status === "none" ? "No solved complex of this protein is in the PDB." : "Solved complexes could not be read from PDBe." };
  }
  const biological = lookup.partners.filter(p => !p.artefact).map(p => ({ p, view: observedFor(p, uniprotId, position) }));
  const hits = biological.filter(x => x.view.variantAtInterface);
  if (!hits.length) {
    return biological.length
      ? { kind: "not-interfacial", reason: `The residue is not at the interface in any of the ${new Set(biological.flatMap(x => x.p.pdbEntries)).size} solved complexes, so no binding change is estimated.` }
      : { kind: "none", reason: "Only construct partners (fusion or crystallisation tags) are in the solved structures." };
  }
  const entries = [...new Set(hits.flatMap(x => x.view.variantEntries))];
  const withExp = await Promise.all(entries.map(async id => ({ id, exp: await fetchEntryExperiment(id, signal) })));
  withExp.sort((a, b) => (a.exp?.resolution ?? 99) - (b.exp?.resolution ?? 99));

  for (const { id, exp } of withExp.slice(0, MAX_ENTRIES_TRIED)) {
    const loc = await locateResidue(id, uniprotId, position, signal);
    if (!loc || loc.residueLetter !== wtLetter.toUpperCase()) continue;
    const pdbText = await fetchPdbFormat(id, signal);
    if (!pdbText) continue;
    return {
      kind: "found",
      pdbText,
      pdbId: id,
      chain: loc.chain,
      authorResidue: loc.authorResidue,
      method: exp?.method ?? null,
      resolution: exp?.resolution ?? null,
      partners: hits.filter(x => x.view.variantEntries.includes(id)).map(x => ({ accession: x.p.accession, name: x.p.name })),
    };
  }
  return { kind: "none", reason: `None of the ${entries.length} solved complexes with this residue at the interface could be used (not observed there, a different residue, or only available as mmCIF).` };
}

/**
 * ΔΔG_bind for the substitution, on a WILD-TYPE complex.
 *
 * Wild type, in order:
 *   1. A solved complex in which the residue is at the interface (DDMut-PPI was trained on
 *      experimental wild types). The mutation is written in that entry's AUTHOR numbering.
 *   2. Only when no solved complex of the protein exists: the assembly's chains modelled by Boltz-2,
 *      all wild type (`chains`, or the chains the curated assembly gives).
 * When solved complexes exist and none has the residue at an interface, nothing is estimated: a
 * model would contradict the observation.
 */
export async function analyzeBindingShift(
  gene: string,
  variant: string,
  uniprotId: string,
  chains: BindingShiftChain[],
  signal?: AbortSignal
): Promise<PpiBindingShift> {
  const base: PpiBindingShift = {
    status: "not-applicable",
    gene,
    variant,
    ddgBind: null,
    unit: "kcal/mol",
    signConvention: "negative-weakens",
    predictor: DDMUT_PPI,
    wildType: null,
    mutation: null,
  };
  const parsed = parseMutationParam(variant);
  if (!parsed?.posNum || !parsed.wtLetter || !parsed.mutLetter) {
    return { ...base, reason: "The variant could not be read as a single amino-acid substitution." };
  }
  const wt = parsed.wtLetter.toUpperCase();
  const mut = parsed.mutLetter.toUpperCase();
  const uniprotMutation = `${wt}${parsed.posNum}${mut}`;

  const ownSeq = await fetchUniprotSequence(uniprotId).catch(() => "");
  if (!ownSeq) return { ...base, status: "failed", mutation: uniprotMutation, reason: "The UniProt sequence could not be read." };
  if ((ownSeq[parsed.posNum - 1] ?? "").toUpperCase() !== wt) {
    return { ...base, mutation: uniprotMutation, reason: "The variant's reference residue does not match the UniProt sequence at that position." };
  }

  // 1. Experimental.
  const exp = await experimentalWildType(uniprotId, parsed.posNum, wt, signal);
  if (exp.kind === "found") {
    const mutation = `${wt}${exp.authorResidue}${mut}`;
    const wildType: PpiBindingShift["wildType"] = {
      source: "experimental",
      provenance: `PDB ${exp.pdbId.toUpperCase()}${exp.method ? `, ${exp.method.toLowerCase()}` : ""}${exp.resolution ? ` ${exp.resolution.toFixed(2)} Å` : ""}`,
      ipTm: null,
      chains: exp.partners.map(p => ({ id: "", accession: p.accession, gene: p.name })),
      pdbId: exp.pdbId,
      method: exp.method,
      resolution: exp.resolution,
      chain: exp.chain,
      authorResidue: exp.authorResidue,
    };
    const outcome = await evaluateDdmutPpi(exp.pdbText, exp.chain, mutation, 20000, signal);
    if (outcome.status === "done") return { ...base, status: "ok", ddgBind: outcome.result.ddgBind, wildType, mutation, predictor: outcome.result.provenance };
    if (outcome.status === "running") return { ...base, status: "running", wildType, mutation, reason: "DDMut-PPI is still computing. Ask again shortly; the job is kept." };
    return { ...base, status: "failed", wildType, mutation, reason: outcome.reason };
  }
  if (exp.kind === "not-interfacial") return { ...base, mutation: uniprotMutation, reason: exp.reason };

  // 2. Boltz-2, only with no solved complex to use.
  let complex = chains;
  if (complex.length < 2) {
    const assembly = await analyzeMultimerStructure(gene, variant, uniprotId, signal, { model: false });
    complex = (assembly.chains ?? []).map(c => ({ id: c.id, accession: c.accession, gene: c.gene }));
  }
  if (complex.length < 2) {
    return { ...base, mutation: uniprotMutation, reason: `${exp.reason} The curated assembly gives no complex to model instead.` };
  }
  if (complex.length > MAX_MODELLED_CHAINS) {
    return { ...base, mutation: uniprotMutation, reason: `${exp.reason} This app models at most ${MAX_MODELLED_CHAINS} chains.` };
  }
  const own = uniprotId.toUpperCase().replace(/-\d+$/, "");
  if (complex[0].id !== "A" || complex[0].accession.toUpperCase().replace(/-\d+$/, "") !== own) {
    return { ...base, mutation: uniprotMutation, reason: "Chain A of the complex is not the analysed protein." };
  }
  let sequences: string[];
  try {
    sequences = await Promise.all(complex.map((c, i) => (i === 0 ? Promise.resolve(ownSeq) : fetchUniprotSequence(c.accession))));
  } catch {
    return { ...base, status: "failed", mutation: uniprotMutation, reason: "A chain's UniProt sequence could not be read." };
  }
  if (sequences.some(s => !s)) {
    return { ...base, status: "failed", mutation: uniprotMutation, reason: "A chain's UniProt sequence could not be read." };
  }

  const outcome = await runBoltz2Multimer(complex.map((c, i) => ({ chainId: c.id, sequence: sequences[i] })), signal);
  if (outcome.status === "running") {
    return { ...base, status: "running", mutation: uniprotMutation, reason: "The wild-type complex is still being modelled by Boltz-2. Ask again shortly; the job is kept." };
  }
  if (outcome.status === "failed") {
    return { ...base, status: "failed", mutation: uniprotMutation, reason: `The wild-type complex could not be modelled. ${failureSentence(outcome.failure)}` };
  }
  const model = outcome.result;
  const wildType: PpiBindingShift["wildType"] = {
    source: "boltz-2-model",
    provenance: model.provenance,
    ipTm: model.ipTm,
    chains: complex.map(c => ({ id: c.id, accession: c.accession, gene: c.gene ?? null })),
    chain: "A",
    authorResidue: parsed.posNum,
  };
  const ddmut = await evaluateDdmutPpi(model.complexPdb, "A", uniprotMutation, 20000, signal);
  if (ddmut.status === "done") return { ...base, status: "ok", ddgBind: ddmut.result.ddgBind, wildType, mutation: uniprotMutation, predictor: ddmut.result.provenance };
  if (ddmut.status === "running") return { ...base, status: "running", wildType, mutation: uniprotMutation, reason: "DDMut-PPI is still computing. Ask again shortly; the job is kept." };
  return { ...base, status: "failed", wildType, mutation: uniprotMutation, reason: ddmut.reason };
}
