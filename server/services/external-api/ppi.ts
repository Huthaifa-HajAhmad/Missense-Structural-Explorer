/**
 * server/services/external-api/ppi.ts — partners, mapped binding sites and the binding energy change
 * for one variant (the Protein interactions tab).
 *
 * Two requests, because they cost very different amounts:
 *   • `analyzePpiBinding`  — lookups only: STRING's functional network, UniProt's curated partners
 *     (SUBUNIT, IntAct) and mapped interaction sites, and PDBe-KB interfaces in solved structures.
 *   • `analyzeBindingShift` — a Boltz-2 model of the WILD-TYPE complex and a DDMut-PPI job on it.
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
import { fetchStringInteractionsWithStatus, type StringInteraction } from "./string.ts";
import { fetchUniprotFeatures, fetchUniprotSequence } from "./uniprot.ts";
import { fetchPdbeInterfaces } from "./pdbe-interfaces.ts";
import { queryBoltz2Multimer } from "./japanfold-client.ts";
import { evaluateDdmutPpi } from "../stability/ddmut-ppi.ts";
import { parseMutationParam } from "../../utils/mutation.ts";
import type {
  PpiBindingData,
  PpiBindingShift,
  PpiCuratedInteraction,
  PpiInteractionSite,
  PpiLookupStatus,
  PpiObservedInterface,
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

  const stringTask = fetchStringInteractionsWithStatus(gene).catch((err: any) => {
    console.warn(`[PPI Service] STRING lookup threw for ${gene}:`, err?.message);
    return { partners: [] as StringInteraction[], status: "failed" as const };
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

  const pdbeTask = (async (): Promise<{ status: "ok" | "none" | "failed" | "skipped"; partners: PpiObservedInterface[] }> => {
    if (!uniprotId) return { status: "skipped", partners: [] };
    try {
      const lookup = await fetchPdbeInterfaces(uniprotId, signal);
      if (lookup.status !== "ok") return { status: lookup.status === "none" ? "none" : "failed", partners: [] };
      const own = uniprotId.toUpperCase().replace(/-\d+$/, "");
      return {
        status: "ok",
        partners: lookup.partners.map(p => ({
          accession: p.accession,
          name: p.name,
          residues: p.residues,
          pdbEntries: p.pdbEntries.length,
          homomeric: p.accession.toUpperCase().replace(/-\d+$/, "") === own,
          variantAtInterface: position !== null && p.residues.includes(position),
        })),
      };
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      return { status: "failed", partners: [] };
    }
  })();

  const [stringRes, uniprotRes, pdbeRes] = await Promise.all([stringTask, uniprotTask, pdbeTask]);
  const f = uniprotRes.features;
  const curated: PpiCuratedInteraction[] = (f?.interactionPartners ?? []).map(p => ({
    accession: p.accession,
    gene: p.gene,
    experiments: p.experiments,
  }));

  return {
    status: "success",
    gene,
    variant,
    uniprotId,
    position,
    stringPartners: stringRes.partners,
    subunitComment: f?.subunitComment ?? null,
    curatedInteractions: curated,
    interactionSites: f ? readInteractionSites(f.features ?? [], position) : [],
    observedInterfaces: pdbeRes.partners,
    sequenceLength: f?.sequenceLength ?? null,
    lookups: {
      stringPartners: stringRes.status,
      uniprot: uniprotRes.status,
      pdbe: pdbeRes.status,
    },
  };
}

export interface BindingShiftChain {
  id: string;
  accession: string;
  gene?: string | null;
}

const DDMUT_PPI = "DDMut-PPI";

/**
 * ΔΔG_bind for the substitution on chain A of a WILD-TYPE model of `chains` (the chains the Multimer
 * tab modelled). Chain A must be the analysed protein.
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
  if (chains.length < 2) {
    return { ...base, reason: "A binding change needs a complex of at least two chains." };
  }
  if (chains.length > MAX_MODELLED_CHAINS) {
    return { ...base, reason: `This app models at most ${MAX_MODELLED_CHAINS} chains.` };
  }
  const own = uniprotId.toUpperCase().replace(/-\d+$/, "");
  if (chains[0].id !== "A" || chains[0].accession.toUpperCase().replace(/-\d+$/, "") !== own) {
    return { ...base, reason: "Chain A of the complex is not the analysed protein." };
  }

  const mutation = `${parsed.wtLetter.toUpperCase()}${parsed.posNum}${parsed.mutLetter.toUpperCase()}`;
  let sequences: string[];
  try {
    sequences = await Promise.all(chains.map(c => fetchUniprotSequence(c.accession)));
  } catch {
    return { ...base, status: "failed", mutation, reason: "A chain's UniProt sequence could not be read." };
  }
  if (sequences.some(s => !s)) {
    return { ...base, status: "failed", mutation, reason: "A chain's UniProt sequence could not be read." };
  }
  const ref = sequences[0][parsed.posNum - 1];
  if (!ref || ref.toUpperCase() !== parsed.wtLetter.toUpperCase()) {
    return { ...base, mutation, reason: "The variant's reference residue does not match the UniProt sequence at that position." };
  }

  // Every chain wild type: this is the structure DDMut-PPI mutates.
  const model = await queryBoltz2Multimer(chains.map((c, i) => ({ chainId: c.id, sequence: sequences[i] })), signal);
  if (!model || model.status !== "success" || !model.complexPdb) {
    return { ...base, status: "failed", mutation, reason: "The wild-type complex could not be modelled (Boltz-2 did not return a model)." };
  }
  const wildType: PpiBindingShift["wildType"] = {
    source: "boltz-2-model",
    provenance: model.provenance,
    ipTm: model.ipTm,
    chains: chains.map(c => ({ id: c.id, accession: c.accession, gene: c.gene ?? null })),
  };

  const outcome = await evaluateDdmutPpi(model.complexPdb, "A", mutation, 20000, signal);
  if (outcome.status === "done") {
    return { ...base, status: "ok", ddgBind: outcome.result.ddgBind, wildType, mutation, predictor: outcome.result.provenance };
  }
  if (outcome.status === "running") {
    return { ...base, status: "running", wildType, mutation, reason: "DDMut-PPI is still computing. Ask again shortly; the job is kept." };
  }
  return { ...base, status: "failed", wildType, mutation, reason: outcome.reason };
}
