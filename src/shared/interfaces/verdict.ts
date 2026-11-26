/**
 * The interface verdict: at an interface (with its support), not at one, not modelled, not measured.
 *
 * "Not modelled" is its own answer. When no native structure has coordinates for the residue, the
 * structures say nothing about it, and the screen must not turn that silence into "not at the
 * interface in 0 of 5" (ABCG1 Gly358, doc/INTERFACES_PPI_AUDIT_2026-11-26.md, C1).
 */
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import { plural, supportText, upperIds } from "./format.ts";
import type { InterfaceView, ModelView, ObservedView, InterfacesEvidence } from "./types.ts";

interface VerdictInput {
  observed: InterfacesEvidence["observed"];
  model: ModelView;
  pending: boolean;
  homomer: boolean;
  gene: string;
  position: number | null;
  resLabel: string;
  residueName: (r: number) => string;
}

/** The fibril or crystal reading at the residue, read apart from the native one. */
function apart(partners: ObservedView[], resLabel: string, kind: "fibril" | "crystal"): InterfaceView["fibril"] {
  const hit = partners.filter(p => p.variantAtInterface).sort((a, b) => b.k - a.k)[0];
  if (!hit) return null;
  const share = hit.k >= hit.n ? (hit.n === 1 ? "the one" : `all ${hit.n}`) : `${hit.k} of ${hit.n}`;
  // The denominator is the structures that model the residue; the pair's full count follows when it differs.
  const of = hit.n < hit.total ? ` that model ${resLabel} (of ${hit.total})` : "";
  const sentence = kind === "fibril"
    ? `In ${share} amyloid fibril structure${hit.n === 1 ? "" : "s"}${of} (${upperIds(hit.variantEntries)}) ${resLabel} touches a neighbouring chain of the fibril. Fibril stacking is not a native interface, so it is read apart.`
    : `In ${share} solved structure${hit.n === 1 ? "" : "s"}${of} (${upperIds(hit.variantEntries)}) ${resLabel} touches another chain outside the deposited assembly (a monomer), so it is read apart. The biological assembly of that entry is a monomer, so this is not a native interface and is not counted.`;
  return { k: hit.k, n: hit.n, entries: hit.variantEntries, sentence };
}

/** The partner the residue is tested against when it is not at an interface: the homomer first, else the most-solved. */
function referenceOf(partners: ObservedView[], homomer: boolean): ObservedView | null {
  const modelled = partners.filter(p => p.n > 0);
  const pool = modelled.length ? modelled : partners;
  return pool.find(p => p.homomeric && homomer) ?? [...pool].sort((a, b) => b.n - a.n || b.total - a.total)[0] ?? null;
}

function nearestCore(ref: ObservedView | null, position: number | null, residueName: (r: number) => string): InterfaceView["nearest"] {
  if (!ref || position === null || ref.variantAtInterface || ref.n === 0) return null;
  const core = ref.residues
    .map((r, i) => ({ r, s: ref.support[i] }))
    .filter(x => x.s * 2 >= ref.maxSupport)
    .sort((a, b) => Math.abs(a.r - position) - Math.abs(b.r - position) || b.s - a.s)[0];
  return core ? { residue: core.r, name: residueName(core.r), support: core.s, n: ref.total, gap: Math.abs(core.r - position) } : null;
}

export function readVerdict(v: VerdictInput): InterfaceView {
  const { observed, model, resLabel, gene } = v;
  const native = observed.partners;
  const setAsideHits = observed.artefacts.filter(p => p.variantAtInterface);
  const base = {
    observed: null, reference: null, unmodelled: null, nearest: null, disagreement: null,
    fibril: apart(observed.fibrils, resLabel, "fibril"),
    crystal: apart(observed.crystals, resLabel, "crystal"),
    setAside: setAsideHits.length ? `A contact at ${resLabel} with ${setAsideHits.map(a => `${a.name} (${a.artefact})`).join(" and ")} is not a biological interface and is not counted.` : null,
  };
  if (v.pending) return { ...base, verdict: "pending", label: ENGINE_STATE_LABELS.running, support: "Reading solved structures", fibril: null, crystal: null };

  const best = native.filter(p => p.variantAtInterface).sort((a, b) => b.k / Math.max(1, b.n) - a.k / Math.max(1, a.n) || b.k - a.k)[0];
  const solvedOk = observed.availability.state === "ok";
  if (best) {
    return {
      ...base,
      verdict: "at-interface",
      label: "At an interface",
      support: supportText(best.k, best.n),
      observed: { k: best.k, n: best.n, total: best.total, partner: best.label, entries: best.variantEntries, maxSupport: best.maxSupport },
      disagreement: model.state === "built" && !model.variantContacts.length ? `The predicted complex places ${resLabel} outside its interface; the solved structures are the stronger evidence.` : null,
    };
  }
  const ref = referenceOf(native, v.homomer);
  const unmodelled = solvedOk && native.length > 0 && native.every(p => p.n === 0) && v.position !== null;
  const reference = solvedOk && ref && !unmodelled ? { n: ref.n, partner: ref.label } : null;
  const nearest = solvedOk && !unmodelled ? nearestCore(ref, v.position, v.residueName) : null;
  if (model.state === "built" && model.variantContacts.length) {
    return {
      ...base,
      verdict: "at-interface",
      label: "At an interface",
      support: "In the predicted complex only",
      reference,
      nearest,
      disagreement: solvedOk && !unmodelled ? `Solved structures of ${gene} show ${plural(native.length, "interface")}, none at ${resLabel}; only the model places it at one.` : null,
    };
  }
  if (unmodelled) {
    const total = new Set(native.flatMap(p => p.pdbEntries)).size;
    const gap = ref?.unmodelled?.find(g => g.start <= v.position! && v.position! <= g.end) ?? null;
    const silent = { total, partner: ref!.label, gap };
    if (model.state !== "built") {
      return { ...base, verdict: "not-modelled", label: "Not modelled", support: `In none of ${plural(total, "solved structure")}`, unmodelled: silent };
    }
    // A built model with no contact at the residue is the only witness: the structures have no coordinates
    // for it, so they are not a second one (audit C1, re-opened by review). `unmodelled` stays set so every
    // sentence downstream drops "and solved structures" and "that model it".
    return { ...base, verdict: "not-at-interface", label: "Not at an interface", support: "In the predicted complex only", unmodelled: silent };
  }
  if (model.state === "built" || solvedOk) {
    const nativeEntries = new Set(native.flatMap(p => p.modelledEntries ?? p.pdbEntries)).size;
    return {
      ...base,
      verdict: "not-at-interface",
      // Not "No contact": a fibril or construct contact may exist, and is stated beside this.
      label: "Not at an interface",
      support: model.state === "built" && solvedOk ? "Model and solved structures" : model.state === "built" ? "In the predicted complex" : `In ${plural(nativeEntries, "native solved structure")}`,
      reference,
      nearest,
    };
  }
  return { ...base, verdict: "not-measured", label: "Not measured", support: "No solved complex or model" };
}
