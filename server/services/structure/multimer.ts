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
 *   2b. The same fold, done in the reader's browser (LocalFold). There is no endpoint to call, so this
 *      service only hands over the job (`handoff: true`) and reads the model back when the reader saves
 *      it (`importMultimerModel`). Same chains, same contacts, provenance that names the machine.
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
import { localFoldHandoff } from "../../../src/shared/multimerHandoff.ts";
import { interfaceContactsFromPdb, oneLetterOf, residueNameAt } from "./model-contacts.ts";
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

/** Where the provider's model came from. Untouched by the LocalFold hand-off (see LOCALFOLD_PROVENANCE). */
const JAPANFOLD_PROVENANCE = "Boltz-2 via JapanFold";

/**
 * An imported model is the same model on a different machine, so it says which: the fold ran in the
 * reader's browser, nothing reached a fold server, and the contacts below were measured here from the
 * file rather than reported by the service.
 */
const LOCALFOLD_PROVENANCE = "Boltz-2 via LocalFold (browser)";

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

/** The assembly, its chains and the sequences that would be folded — before any folding is chosen. */
interface PlannedMultimer {
  assembly: SubunitAssembly;
  position: number | null;
  /** In fold order: `chainId` A carries the variant, every other chain is wild type. */
  chainSpecs: Array<{ chainId: string; sequence: string }>;
  chains: MultimerChain[];
  /** `status: "not-requested"` or `"success"`: what a fold answers with once coordinates exist. */
  modelled: MultimerData;
}

type PlanOutcome = { ok: true; plan: PlannedMultimer } | { ok: false; result: MultimerData };

/**
 * Read the assembly and decide which chains a fold would use: the shared half of the provider model,
 * the browser hand-off and the import. It never folds anything, so all three agree on the chains.
 */
async function planMultimer(
  gene: string,
  variant: string,
  uniprotId: string,
  signal?: AbortSignal
): Promise<PlanOutcome> {
  const parsedMut = parseMutationParam(variant);
  const position = parsedMut?.posNum && parsedMut.posNum > 0 ? parsedMut.posNum : null;

  const base: MultimerData = {
    status: "failed",
    gene,
    uniprotId,
    oligomericState: "Not stated",
    chainCount: 1,
    chainIds: ["A"],
    complexPdb: null,
    ipTm: null,
    pTm: null,
    interfaceContacts: [],
    variantPosition: position,
    variantAtInterface: null,
    provenance: "Error",
  };

  try {
    const experimentalTask = readExperimental(uniprotId, position, signal).catch((err: any): MultimerExperimentalInterfaces => {
      if (err?.name === "AbortError") throw err;
      return { status: "error", reason: "PDBe did not answer.", partners: [] };
    });
    // The task is awaited only after the UniProt reads below. If one of those throws first (a caller
    // abort lands on all of them at once), the task's own AbortError rejection would have no handler
    // and Node would exit on an unhandled rejection. This marks it handled; the later `await` still
    // sees the rejection.
    experimentalTask.catch(() => undefined);

    const [features, sequence] = await Promise.all([
      fetchUniprotFeatures(uniprotId),
      fetchUniprotSequence(uniprotId).catch(() => ""),
    ]);
    const subunitComment = features?.subunitComment ?? null;
    const assembly = parseSubunitAssembly(subunitComment, gene);
    const partners = await resolvePartners(assembly, features?.interactionPartners ?? []);
    const record = toRecord(assembly, partners, subunitComment, gene);
    const experimental = await experimentalTask;

    // The chain list the reader sees is on every outcome, model or not.
    const common: MultimerData = {
      ...base,
      subunitComment,
      assembly: record,
      experimental,
      oligomericState: assembly.label,
      provenance: subunitComment ? "UniProt SUBUNIT" : "UniProt (no SUBUNIT record)",
    };

    const notModelled = (reason: MultimerNotModelledReason): MultimerData => ({
      ...common,
      status: "not-modelled",
      notModelledReason: reason,
      chainCount: 1,
      chainIds: ["A"],
      provenance: subunitComment ? "UniProt SUBUNIT" : "UniProt (no SUBUNIT record)",
    });

    if (assembly.kind === "monomer") {
      return { ok: false, result: { ...common, status: "monomeric", chainCount: 1, chainIds: ["A"], provenance: "UniProt SUBUNIT" } };
    }
    if (assembly.kind === "unstated" || assembly.kind === "interactions-only" || assembly.kind === "complex") {
      return { ok: false, result: notModelled(assembly.kind) };
    }
    if (!sequence) return { ok: false, result: notModelled("no-sequence") };

    // The variant must name the residue the sequence has; modelling a different residue is not this variant.
    let mutSequence = sequence;
    if (parsedMut && position) {
      const actual = sequence[position - 1];
      if (!actual || actual.toUpperCase() !== parsedMut.wtLetter.toUpperCase()) return { ok: false, result: notModelled("reference-mismatch") };
      mutSequence = sequence.slice(0, position - 1) + parsedMut.mutLetter.toUpperCase() + sequence.slice(position);
    }

    const self: Omit<MultimerChain, "id"> = { accession: uniprotId, gene, length: sequence.length, carriesVariant: true };
    let chainSpecs: Array<Omit<MultimerChain, "id"> & { sequence: string }>;

    if (assembly.kind === "homomer") {
      const copies = assembly.copies ?? 2;
      if (copies > MAX_MODELLED_CHAINS) return { ok: false, result: notModelled("too-many-chains") };
      chainSpecs = Array.from({ length: copies }, (_, i) => ({
        ...self,
        carriesVariant: i === 0,
        sequence: i === 0 ? mutSequence : sequence,
      }));
    } else {
      if (assembly.copies !== 2) return { ok: false, result: notModelled("heteromer-stoichiometry") };
      // A heterodimer has exactly one other chain; "with X or Y" names two and is not guessed between.
      const partner = partners.length === 1 ? partners[0] : null;
      if (!partner?.accession) return { ok: false, result: notModelled("heteromer-partner") };
      const partnerSeq = await fetchUniprotSequence(partner.accession).catch(() => "");
      if (!partnerSeq) return { ok: false, result: notModelled("heteromer-partner") };
      chainSpecs = [
        { ...self, sequence: mutSequence },
        { accession: partner.accession, gene: partner.gene, length: partnerSeq.length, carriesVariant: false, sequence: partnerSeq },
      ];
    }

    const chains: MultimerChain[] = chainSpecs.map(({ sequence: _s, ...c }, i) => ({ ...c, id: CHAIN_LETTERS[i] }));
    const chainIds = chains.map(c => c.id);
    const modelled: MultimerData = { ...common, status: "not-requested", chainCount: chains.length, chainIds, chains, provenance: JAPANFOLD_PROVENANCE };

    return {
      ok: true,
      plan: {
        assembly,
        position,
        chainSpecs: chainSpecs.map((c, i) => ({ chainId: CHAIN_LETTERS[i], sequence: c.sequence })),
        chains,
        modelled,
      },
    };
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return { ok: false, result: { ...base, error: sanitizeErrorMessage(err) } };
  }
}

/** The variant-carrying job name, e.g. "NAE1 p.Asp116Gly" for the page's own title and the file name. */
function localFoldJobName(gene: string, variant: string): string {
  return `${gene} ${variant}`;
}

export async function analyzeMultimerStructure(
  gene: string,
  variant: string,
  uniprotId: string,
  signal?: AbortSignal,
  { model = false, waitMs, handoff = false }: { model?: boolean; waitMs?: number; handoff?: boolean } = {}
): Promise<MultimerAnalysisResult> {
  const planned = await planMultimer(gene, variant, uniprotId, signal);
  if (!planned.ok) return planned.result;
  const { plan } = planned;
  // The hand-off is offered whatever the model's own state is: a reader whose provider job failed, or
  // who never asked for one, can still fold the same chains in their browser.
  const withHandoff = (result: MultimerData): MultimerData =>
    handoff
      ? { ...result, handoff: localFoldHandoff(localFoldJobName(gene, variant), plan.chainSpecs.map(c => ({ id: c.chainId, sequence: c.sequence }))) }
      : result;

  // The assembly can be modelled; whether it is, is the reader's choice.
  if (!model) return withHandoff({ ...plan.modelled, status: "not-requested" });

  try {
    const outcome = await runBoltz2Multimer(plan.chainSpecs, signal, waitMs ? { waitMs } : undefined);

    if (outcome.status === "done") {
      const boltz = outcome.result;
      const homomeric = plan.assembly.kind === "homomer";
      return withHandoff({
        ...plan.modelled,
        status: "success",
        complexPdb: boltz.complexPdb,
        ipTm: boltz.ipTm,
        pTm: boltz.pTm,
        interfaceContacts: boltz.interfaceContacts,
        variantAtInterface: plan.position !== null ? variantContacts(boltz.interfaceContacts, plan.position, homomeric).length > 0 : null,
        provenance: boltz.provenance,
      });
    }
    if (outcome.status === "running") {
      return withHandoff({ ...plan.modelled, status: "running", jobId: outcome.jobId });
    }
    return withHandoff({ ...plan.modelled, status: "failed", failure: outcome.failure, error: failureSentence(outcome.failure) });
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    // No model came back, so the provenance is the fault, not the provider: a stored payload must not
    // name a service that threw while it was being asked.
    return withHandoff({ ...plan.modelled, status: "failed", provenance: "Error", error: sanitizeErrorMessage(err) });
  }
}

/** Why an imported complex cannot be read for this variant, in the reader's terms. */
function importNeedsComplex(result: MultimerData): string {
  if (result.status === "monomeric") {
    return "UniProt states a monomer: there is no subunit interface to read from a complex model.";
  }
  return "This assembly is not modelled as a complex here, so an imported complex has nothing to be scored against.";
}

/**
 * A complex the reader folded themselves (LocalFold, in their browser) as this variant's model.
 *
 * The chains are the ones the assembly already decides — the file is not allowed to invent a different
 * complex. Two things are checked before any contact is believed: the file holds every chain the
 * assembly folds, and chain A carries the variant's own residue number. Either failing is a stated
 * refusal, not an empty interface: a model of a different construct would otherwise read as "no
 * contact at the variant", which is the false negative this whole tab is built to avoid.
 *
 * ipTM and pTM are null: LocalFold reports them in its own panel and in the AF3 archive, and the PDB
 * alone does not carry them. Reporting a number here would be inventing one.
 */
export async function importMultimerModel(
  gene: string,
  variant: string,
  uniprotId: string,
  structureText: string,
  signal?: AbortSignal
): Promise<MultimerData> {
  const planned = await planMultimer(gene, variant, uniprotId, signal);
  if (!planned.ok) {
    // Nothing was imported, so the provenance stays the plan's: naming LocalFold here would claim a
    // model from a machine that never folded anything.
    return { ...planned.result, error: planned.result.error ?? importNeedsComplex(planned.result) };
  }
  const { plan } = planned;
  const refused = (message: string): MultimerData => ({
    ...plan.modelled,
    status: "failed",
    failure: null,
    ipTm: null,
    pTm: null,
    provenance: LOCALFOLD_PROVENANCE,
    error: message,
  });

  let parsed;
  try {
    parsed = interfaceContactsFromPdb(structureText);
  } catch (err: any) {
    return refused(err?.message ?? "That file could not be read as a PDB model.");
  }

  const expected = plan.chains.map(c => c.id);
  const missing = expected.filter(id => !parsed.chainIds.includes(id));
  if (missing.length > 0) {
    return refused(
      `That model holds chain${parsed.chainIds.length === 1 ? "" : "s"} ${parsed.chainIds.join(", ")}; this assembly folds ${expected.join(", ")}. ` +
      `Fold chains ${expected.join(" and ")} together — a monomer fold cannot answer an interface question.`
    );
  }
  // Extra chains are refused, not ignored: `InterfaceContact` names no chain, so a contact with a
  // chain the assembly never folded would be printed as a contact with the modelled partner.
  const extra = parsed.chainIds.filter(id => !expected.includes(id));
  if (extra.length > 0) {
    return refused(
      `That model also holds chain${extra.length === 1 ? "" : "s"} ${extra.join(", ")}; this assembly folds ` +
      `${expected.join(", ")}. Fold exactly those chains, so every contact belongs to a chain this complex names.`
    );
  }
  // A model is this variant's only if chain A's residue at the variant's position is the substituted
  // residue: a wild-type fold, a homolog, or another protein numbered 1..N would otherwise pass on
  // numbering alone and be scored as this mutant.
  if (plan.position === null) {
    return refused(
      "This variant has no residue position this app can read, so a model cannot be checked against it."
    );
  }
  const residues = parsed.residuesByChain["A"] ?? [];
  if (!residues.includes(plan.position)) {
    const span = residues.length ? `${residues[0]}–${residues[residues.length - 1]}` : "none";
    return refused(
      `Chain A in that model has no residue ${plan.position} (it numbers ${span}), so it is not this variant's fold.`
    );
  }
  const expectedLength = plan.chains[0]?.length ?? null;
  if (expectedLength !== null && residues.length !== expectedLength) {
    return refused(
      `Chain A in that model numbers ${residues.length} residues; this chain has ${expectedLength}. ` +
      `The job folds the whole chain, so a shorter or longer chain A is a different construct.`
    );
  }
  const found = oneLetterOf(residueNameAt(parsed, "A", plan.position));
  const asked = plan.chainSpecs[0]?.sequence[plan.position - 1]?.toUpperCase() ?? null;
  // A modified or unknown residue at the variant's position is not the substitution that was asked for,
  // and comparing nothing would silently accept it.
  if (found === null) {
    const named = residueNameAt(parsed, "A", plan.position);
    return refused(
      `Residue ${plan.position} of chain A is ${named ?? "unnamed"} in that model, which is not a standard amino acid, ` +
      `so it cannot be the ${asked ?? "asked-for"} substitution.`
    );
  }
  if (asked !== null && found !== asked) {
    return refused(
      `Residue ${plan.position} of chain A is ${found} in that model, and this variant's job asked for ${asked}. ` +
      `That is a different construct (wild type, or another protein), not this mutant's fold.`
    );
  }

  const homomeric = plan.assembly.kind === "homomer";
  return {
    ...plan.modelled,
    status: "success",
    complexPdb: structureText,
    ipTm: null,
    pTm: null,
    interfaceContacts: parsed.contacts,
    variantAtInterface: plan.position !== null ? variantContacts(parsed.contacts, plan.position, homomeric).length > 0 : null,
    provenance: LOCALFOLD_PROVENANCE,
  };
}
