/**
 * Prediction: the Boltz-2 complex model, on request.
 *
 * The model's reason states how the solved structures bear on it: they answer the interface question
 * when they model the residue, and they do not when the residue has no coordinates in any of them
 * (ABCG1 Gly358). The residue count is known before anyone clicks, so a complex too large for a
 * browser (2 × 678 = 1,356 residues) is said to be too large rather than offered and then warned about.
 */
import type { MultimerData } from "../contracts.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import { interfaceFootprint, variantContacts } from "../multimerAssembly.ts";
import { LOCALFOLD_MAX_RESIDUES } from "../multimerHandoff.ts";
import { NOT_MODELLED_REASON, iptmBand } from "./constants.ts";
import { plural } from "./format.ts";
import type { AssemblyRecord } from "./assembly.ts";
import type { BuildInterfacesInput, ChainView, ModelView } from "./types.ts";

/** What the solved structures say about the residue: they answer, they never model it, or there are none. */
export type SolvedCoverage = "answers" | "unmodelled" | "none";

interface ModelInput {
  input: BuildInterfacesInput;
  asmData: MultimerData | null;
  stale: boolean;
  loading: boolean;
  rec: AssemblyRecord;
  chains: ChainView[];
  position: number | null;
  resLabel: string;
  solved: SolvedCoverage;
}

function notRequestedReason(m: ModelInput, residues: number | null): string {
  const chainCount = plural(m.chains.length, "chain");
  const size = residues ? `${residues.toLocaleString("en-GB")} residues, ` : "";
  const base = `Not run. Boltz-2 can model the ${m.rec.label.toLowerCase()} (${size}${chainCount}, variant on chain A) as a provider GPU job`;
  const browser = residues === null || residues <= LOCALFOLD_MAX_RESIDUES ? ", or free in your own browser with LocalFold" : "";
  const solved =
    m.solved === "answers" ? ", though solved structures already answer whether the residue is at an interface"
    : m.solved === "unmodelled" ? `. Solved structures do not model ${m.resLabel}, so only a model could place it; expect low confidence for a stretch experiments did not resolve`
    : "";
  return `${base}${browser}${solved}.`;
}

/** The model's state, in order of precedence: loading, service failure, built, running, refused, not run. */
function stateOf(m: ModelInput, residues: number | null): Partial<ModelView> {
  const { input, asmData } = m;
  if (m.loading) return { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "Reading the assembly." };
  if (input.assemblyStatus === "error" && !asmData) {
    return { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: input.assemblyError ?? "The assembly service did not answer.", retryable: true };
  }
  if (asmData?.status === "success") return { state: "built" };
  if (asmData?.status === "running" || (input.modelRequested && (!asmData || asmData.status === "not-requested"))) {
    return {
      state: "running",
      stateLabel: ENGINE_STATE_LABELS.running,
      reason: `Boltz-2 is modelling ${plural(m.chains.length, "chain")}. A large complex can take several minutes; the job is followed, not restarted.`,
    };
  }
  if (asmData?.status === "failed") return { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: asmData.error ?? "The complex prediction did not return a model." };
  if (asmData?.status === "monomeric") return { state: "not-applicable", stateLabel: ENGINE_STATE_LABELS["not-covered"], reason: "A monomer has no subunit interface to model." };
  if (asmData?.status === "not-modelled") {
    return {
      state: "not-modelled",
      stateLabel: ENGINE_STATE_LABELS["not-installed"],
      reason: asmData.notModelledReason ? NOT_MODELLED_REASON[asmData.notModelledReason] : "This assembly is not modelled here.",
    };
  }
  if (asmData?.status === "not-requested") return { state: "not-requested", stateLabel: null, reason: notRequestedReason(m, residues) };
  if (m.stale) return { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "A stored result predates per-structure support; reading it again." };
  return {};
}

export function readModel(m: ModelInput): ModelView {
  const { asmData, position } = m;
  const homomeric = m.rec.kind === "homomer";
  const built = asmData?.status === "success";
  const contacts = built ? asmData.interfaceContacts ?? [] : [];
  const vContacts = variantContacts(contacts, position, homomeric);
  const footprint = interfaceFootprint(contacts, homomeric);
  const failure = asmData?.failure ?? null;
  const lengths = asmData?.chains?.map(c => c.length);
  const residues = lengths?.length && lengths.every(l => Number.isFinite(l)) ? lengths.reduce((a, b) => a + b, 0) : null;
  const model: ModelView = {
    state: "not-requested",
    stateLabel: null,
    reason: null,
    failure,
    retryable: Boolean(failure && ["timeout", "network", "http", "no-model"].includes(failure.kind)) || (asmData?.status === "failed" && !failure),
    canRequest: false,
    iptm: built ? asmData.ipTm : null,
    ptm: built ? asmData.pTm : null,
    band: built ? iptmBand(asmData.ipTm) : null,
    contactsTotal: contacts.length,
    variantContacts: vContacts,
    footprint,
    nearestInterfaceGap: position && footprint.length && !vContacts.length ? Math.min(...footprint.map(r => Math.abs(r - position))) : null,
    provenance: asmData?.provenance ?? null,
    hasCoordinates: Boolean(asmData?.complexPdb),
    homomeric,
    chainCount: m.chains.length,
    residues,
    browserFoldable: residues === null || residues <= LOCALFOLD_MAX_RESIDUES,
    ...stateOf(m, residues),
  };
  model.canRequest = model.state === "not-requested" || (model.state === "failed" && model.retryable && Boolean(asmData?.chains?.length));
  return model;
}
