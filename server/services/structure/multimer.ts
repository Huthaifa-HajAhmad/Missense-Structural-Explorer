/**
 * server/services/structure/multimer.ts — quaternary assembly for one variant.
 *
 * Three independent readings, returned together:
 *   1. What UniProt's curated SUBUNIT record states (`parseSubunitAssembly`, shared with the client).
 *   2. A Boltz-2 complex model via JapanFold, for the assemblies this app can build: homomers of up to
 *      MAX_MODELLED_CHAINS copies, and heterodimers whose partner the record names and UniProt resolves.
 *      Chain A carries the variant; every other chain is wild type. ON REQUEST ONLY (`model: true`):
 *      the pipeline asks for the lookups alone, so no GPU job starts for a tab nobody opened, and a
 *      job that outlives one request is resumed by the next ("running"), never submitted twice.
 *   3. Interface residues observed in solved PDB structures (PDBe-KB), which need no model at all,
 *      with per-residue support (in how many of the pair's structures each residue is interfacial).
 *
 * DEFECTS THIS REPLACED (doc/MULTIMER_TAB_REVIEW.md)
 *   • No SUBUNIT text (always, because of a parsing bug in uniprot.ts) became status "monomeric".
 *   • A heteromer was status "failed" with "automatic sequence cloning prohibited" — it was never a
 *     failure, and the partner's sequence is public.
 *   • A hexamer was modelled as four chains and still labelled "Homohexamer (A6)".
 *   • `mutationInterfaceDisrupted` was true for any contact within ±4 residues in sequence, and only
 *     the mutant complex was modelled, so no loss of contact was ever measured. Replaced by
 *     `variantAtInterface`: the variant residue itself is in a contact.
 *   • A variant whose reference residue did not match the sequence was modelled anyway (warn-only).
 */

import { fetchUniprotSequence, fetchUniprotFeatures, resolveGeneToUniprot } from "../external-api/uniprot.ts";
import { runBoltz2Multimer } from "../external-api/japanfold-client.ts";
import { fetchPdbeInterfaces, observedFor } from "../external-api/pdbe-interfaces.ts";
import { parseMutationParam } from "../../utils/mutation.ts";
import { sanitizeErrorMessage } from "../../utils/security.ts";
import {
  MAX_MODELLED_CHAINS,
  parseSubunitAssembly,
  subunitStatements,
  variantContacts,
  type SubunitAssembly,
} from "../../../src/shared/multimerAssembly.ts";
import type {
  MultimerAssemblyPartner,
  MultimerAssemblyRecord,
  MultimerChain,
  MultimerData,
  MultimerExperimentalInterfaces,
  MultimerNotModelledReason,
} from "../../../src/shared/contracts.ts";

export type MultimerAnalysisResult = MultimerData;

const CHAIN_LETTERS = ["A", "B", "C", "D"];

async function resolvePartners(
  assembly: SubunitAssembly,
  interactionPartners: Array<{ accession: string; gene: string | null }>
): Promise<MultimerAssemblyPartner[]> {
  if (assembly.kind !== "heteromer" && assembly.kind !== "complex") return [];
  const out: MultimerAssemblyPartner[] = [];
  for (const gene of assembly.partnerGenes) {
    const curated = interactionPartners.find(p => p.gene?.toUpperCase() === gene.toUpperCase());
    if (curated) {
      out.push({ gene, accession: curated.accession, resolvedBy: "interaction" });
      continue;
    }
    // A complex's member list can run to dozens of symbols and nothing is modelled from it: curated
    // matches only, no searches.
    if (assembly.kind === "complex") continue;
    // Only a reviewed human entry whose gene symbol is exactly this token; anything else stays unresolved.
    let accession: string | null = null;
    try {
      accession = await resolveGeneToUniprot(gene);
    } catch {
      accession = null;
    }
    out.push({ gene, accession, resolvedBy: accession ? "swissprot" : null });
  }
  // Tokens that resolve to nothing are usually not genes ("NEDD8"-like ligands resolve; "E1" does not).
  return out.filter(p => p.accession !== null);
}

async function readExperimental(
  uniprotId: string,
  position: number | null,
  signal?: AbortSignal
): Promise<MultimerExperimentalInterfaces> {
  const lookup = await fetchPdbeInterfaces(uniprotId, signal);
  if (lookup.status !== "ok") {
    return lookup.status === "error"
      ? { status: "error", reason: lookup.reason, partners: [] }
      : { status: "none", partners: [] };
  }
  return { status: "ok", partners: lookup.partners.map(p => observedFor(p, uniprotId, position)), entryKinds: lookup.entryKinds, crystalChecked: lookup.crystalChecked };
}

function toRecord(assembly: SubunitAssembly, partners: MultimerAssemblyPartner[], subunitComment: string | null, gene: string): MultimerAssemblyRecord {
  return {
    qualifier: assembly.qualifier,
    statements: subunitStatements(subunitComment, gene),
    kind: assembly.kind,
    label: assembly.label,
    copies: assembly.copies,
    homoAssumed: assembly.homoAssumed,
    sentence: assembly.sentence,
    alsoStated: assembly.alsoStated,
    partners,
  };
}

/** One sentence per failure kind: the reader learns which of the possible faults happened. */
export function failureSentence(f: { kind: string; httpStatus?: number | null; detail?: string | null }): string {
  const detail = f.detail ? ` ${f.detail.replace(/\.?$/, ".")}` : "";
  switch (f.kind) {
    case "timeout": return `Boltz-2 did not answer in time.${detail}`;
    case "network": return "Boltz-2 could not be reached.";
    case "rejected": return `Boltz-2 refused this complex (HTTP ${f.httpStatus}).${detail}`;
    case "http": return `Boltz-2 answered HTTP ${f.httpStatus}.${detail}`;
    case "job-failed": return `The Boltz-2 job failed.${detail}`;
    default: return `Boltz-2 returned no model.${detail}`;
  }
}

export async function analyzeMultimerStructure(
  gene: string,
  variant: string,
  uniprotId: string,
  signal?: AbortSignal,
  { model = false, waitMs }: { model?: boolean; waitMs?: number } = {}
): Promise<MultimerAnalysisResult> {
  const parsedMut = parseMutationParam(variant);
  const position = parsedMut?.posNum && parsedMut.posNum > 0 ? parsedMut.posNum : null;

  const base = {
    gene,
    uniprotId,
    complexPdb: null,
    ipTm: null,
    pTm: null,
    interfaceContacts: [] as MultimerData["interfaceContacts"],
    variantPosition: position,
    variantAtInterface: null,
  };

  try {
    const experimentalTask = readExperimental(uniprotId, position, signal).catch((err: any): MultimerExperimentalInterfaces => {
      if (err?.name === "AbortError") throw err;
      return { status: "error", reason: "PDBe did not answer.", partners: [] };
    });

    const [features, sequence] = await Promise.all([
      fetchUniprotFeatures(uniprotId),
      fetchUniprotSequence(uniprotId).catch(() => ""),
    ]);
    const subunitComment = features?.subunitComment ?? null;
    const assembly = parseSubunitAssembly(subunitComment, gene);
    const partners = await resolvePartners(assembly, features?.interactionPartners ?? []);
    const record = toRecord(assembly, partners, subunitComment, gene);
    const experimental = await experimentalTask;

    const common = { ...base, subunitComment, assembly: record, experimental, oligomericState: assembly.label };

    const notModelled = (reason: MultimerNotModelledReason): MultimerData => ({
      ...common,
      status: "not-modelled",
      notModelledReason: reason,
      chainCount: 1,
      chainIds: ["A"],
      provenance: subunitComment ? "UniProt SUBUNIT" : "UniProt (no SUBUNIT record)",
    });

    if (assembly.kind === "monomer") {
      return { ...common, status: "monomeric", chainCount: 1, chainIds: ["A"], provenance: "UniProt SUBUNIT" };
    }
    if (assembly.kind === "unstated" || assembly.kind === "interactions-only" || assembly.kind === "complex") {
      return notModelled(assembly.kind);
    }
    if (!sequence) return notModelled("no-sequence");

    // The variant must name the residue the sequence has; modelling a different residue is not this variant.
    let mutSequence = sequence;
    if (parsedMut && position) {
      const actual = sequence[position - 1];
      if (!actual || actual.toUpperCase() !== parsedMut.wtLetter.toUpperCase()) return notModelled("reference-mismatch");
      mutSequence = sequence.slice(0, position - 1) + parsedMut.mutLetter.toUpperCase() + sequence.slice(position);
    }

    const self: Omit<MultimerChain, "id"> = { accession: uniprotId, gene, length: sequence.length, carriesVariant: true };
    let chainSpecs: Array<Omit<MultimerChain, "id"> & { sequence: string }>;

    if (assembly.kind === "homomer") {
      const copies = assembly.copies ?? 2;
      if (copies > MAX_MODELLED_CHAINS) return notModelled("too-many-chains");
      chainSpecs = Array.from({ length: copies }, (_, i) => ({
        ...self,
        carriesVariant: i === 0,
        sequence: i === 0 ? mutSequence : sequence,
      }));
    } else {
      if (assembly.copies !== 2) return notModelled("heteromer-stoichiometry");
      // A heterodimer has exactly one other chain; "with X or Y" names two and is not guessed between.
      const partner = partners.length === 1 ? partners[0] : null;
      if (!partner?.accession) return notModelled("heteromer-partner");
      const partnerSeq = await fetchUniprotSequence(partner.accession).catch(() => "");
      if (!partnerSeq) return notModelled("heteromer-partner");
      chainSpecs = [
        { ...self, sequence: mutSequence },
        { accession: partner.accession, gene: partner.gene, length: partnerSeq.length, carriesVariant: false, sequence: partnerSeq },
      ];
    }

    const chains: MultimerChain[] = chainSpecs.map(({ sequence: _s, ...c }, i) => ({ ...c, id: CHAIN_LETTERS[i] }));
    const chainIds = chains.map(c => c.id);
    const modelled = { ...common, chainCount: chains.length, chainIds, chains, provenance: "Boltz-2 via JapanFold" };

    // The assembly can be modelled; whether it is, is the reader's choice.
    if (!model) return { ...modelled, status: "not-requested" };

    const outcome = await runBoltz2Multimer(
      chainSpecs.map((c, i) => ({ chainId: CHAIN_LETTERS[i], sequence: c.sequence })),
      signal,
      waitMs ? { waitMs } : undefined
    );

    if (outcome.status === "done") {
      const boltz = outcome.result;
      const homomeric = assembly.kind === "homomer";
      return {
        ...modelled,
        status: "success",
        complexPdb: boltz.complexPdb,
        ipTm: boltz.ipTm,
        pTm: boltz.pTm,
        interfaceContacts: boltz.interfaceContacts,
        variantAtInterface: position !== null ? variantContacts(boltz.interfaceContacts, position, homomeric).length > 0 : null,
        provenance: boltz.provenance,
      };
    }
    if (outcome.status === "running") {
      return { ...modelled, status: "running", jobId: outcome.jobId };
    }
    return { ...modelled, status: "failed", failure: outcome.failure, error: failureSentence(outcome.failure) };
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return {
      ...base,
      status: "failed",
      oligomericState: "Not stated",
      chainCount: 1,
      chainIds: ["A"],
      provenance: "Error",
      error: sanitizeErrorMessage(err),
    };
  }
}
