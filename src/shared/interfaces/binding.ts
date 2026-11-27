/**
 * Binding change: DDMut-PPI ΔΔG_bind on a wild-type complex, solved first, on request; never on a
 * fibril; and never framed as "not at the interface" for a residue no solved complex models.
 */
import type { PpiBindingShift } from "../contracts.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import { signedDdg } from "../energeticsEvidence.ts";
import { DDMUT_PPI_RMSE } from "./constants.ts";
import { upperIds } from "./format.ts";
import type { BindingView, BuildInterfacesInput, InterfaceView, ObservedView } from "./types.ts";

interface BindingInput {
  input: BuildInterfacesInput;
  iface: InterfaceView;
  native: ObservedView[];
  solvedPending: boolean;
  chainCount: number;
  gene: string;
  resLabel: string;
  assemblyLabel: string;
  monomer: boolean;
  /** PDBe said which structures model the residue. */
  coverageChecked: boolean;
}

/** What a request will run on, said before it runs; null when nothing can be scored. */
function planOf(b: BindingInput): string | null {
  const best = b.native.filter(p => p.variantAtInterface).sort((x, y) => y.k / Math.max(1, y.n) - x.k / Math.max(1, x.n) || y.k - x.k)[0];
  if (best) return `DDMut-PPI on a solved complex where ${b.resLabel} is at the interface (${upperIds(best.variantEntries, 3)}), best resolution first.`;
  if (!b.native.length && !b.solvedPending && b.chainCount >= 2) {
    return `No solved complex of ${b.gene} exists, so Boltz-2 models the ${b.assemblyLabel.toLowerCase()} all wild type and DDMut-PPI scores ${b.resLabel} on it.`;
  }
  return null;
}

function okView(shift: PpiBindingShift): Partial<BindingView> {
  const v = shift.ddgBind as number;
  const direction = v < 0 ? "weaker" : v > 0 ? "stronger" : "none";
  return {
    state: "ok",
    value: v,
    valueText: signedDdg(v),
    direction,
    directionText: direction === "weaker" ? "Weaker binding" : direction === "stronger" ? "Stronger binding" : "No change predicted",
    withinError: Math.abs(v) < DDMUT_PPI_RMSE,
  };
}

/** The binding-change card names each cause with one fixed label, never the engine label "Not covered" (B10). */
export const BINDING_LABEL = {
  onRequest: "Not run (on request)",
  noComplex: "No solved complex to score",
  notMeasured: "Not measured",
} as const;

function notApplicable(reason: string, stateLabel: string = BINDING_LABEL.notMeasured): Partial<BindingView> {
  return { state: "not-applicable", stateLabel, reason };
}

function stateOf(b: BindingInput, plan: string | null): Partial<BindingView> {
  const { input, iface } = b;
  const shift = input.shift;
  if (input.shiftLoading) return { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: iface.observed ? "Fetching the solved complex and running DDMut-PPI." : "Modelling the wild-type complex and running DDMut-PPI." };
  if (input.shiftError) return { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: input.shiftError, canRequest: Boolean(plan) };
  if (shift?.status === "ok" && Number.isFinite(shift.ddgBind)) return okView(shift);
  if (shift?.status === "running") return { state: "running", stateLabel: ENGINE_STATE_LABELS.running, reason: shift.reason ?? "Still computing.", canRequest: true };
  if (shift?.status === "failed") return { state: "failed", stateLabel: ENGINE_STATE_LABELS["upstream-error"], reason: shift.reason ?? "The prediction did not return a value.", canRequest: Boolean(plan) };
  if (shift?.status === "not-applicable") return notApplicable(shift.reason ?? "A binding change cannot be computed for this variant.");
  if (iface.verdict === "pending" || b.solvedPending) return { state: "pending", stateLabel: ENGINE_STATE_LABELS.running, reason: "Waiting for the solved structures." };
  if (plan) return { state: "ready", stateLabel: BINDING_LABEL.onRequest, reason: plan, canRequest: true };
  // Keyed on the structures' silence, not the verdict: a built model can make the verdict "not at an interface" while no solved complex models the residue.
  if (iface.unmodelled) return notApplicable(`${b.resLabel} is not modelled in any solved complex of ${b.gene}, so there is no solved wild type to score on.`, BINDING_LABEL.noComplex);
  // "That model it" only when PDBe said which structures do; otherwise every structure of the pair is the denominator.
  if (b.native.length) return notApplicable(`${b.resLabel} is not at the interface in ${b.coverageChecked ? "any solved complex of " + b.gene + " that models it" : "any solved complex of " + b.gene + " (PDBe could not say which of them model it)"}, so no binding change is estimated.`);
  return notApplicable(b.monomer
    ? "UniProt states a monomer, and no solved complex exists: there is no partner chain to bind."
    : "No solved complex exists, and the curated assembly gives no complex to model.", BINDING_LABEL.noComplex);
}

export function readBinding(b: BindingInput): BindingView {
  const plan = planOf(b);
  return {
    state: "unavailable",
    stateLabel: null,
    reason: null,
    value: null,
    valueText: null,
    direction: null,
    directionText: null,
    withinError: false,
    wildType: b.input.shift?.wildType ?? null,
    plan,
    canRequest: false,
    ...stateOf(b, plan),
  };
}
