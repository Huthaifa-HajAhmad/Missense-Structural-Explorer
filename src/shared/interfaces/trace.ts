/**
 * The rule trace the Evidence Lineage rail draws, one step per source. Each step carries whether its
 * source has answered, so the rail draws a pending marker only while a source is in flight.
 */
import type { PpiBindingData } from "../contracts.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import type { SubunitStatement } from "../multimerAssembly.ts";
import { plural, supportText } from "./format.ts";
import type { BindingView, InterfaceView, InterfacesEvidence, ModelView, TraceStep } from "./types.ts";

interface TraceInput {
  statements: SubunitStatement[];
  subunitText: string | null;
  curationPending: boolean;
  curationFailed: boolean;
  observed: InterfacesEvidence["observed"];
  entryKindsFailed: boolean;
  iface: InterfaceView;
  model: ModelView;
  partnerCount: number;
  partnerSub: string;
  sections: InterfacesEvidence["sections"];
  ppi: PpiBindingData | null;
  ppiLoading: boolean;
  binding: BindingView;
}

function curationStep(t: TraceInput): TraceStep {
  const { statements } = t;
  const both = statements.some(s => s.kind === "monomer") && statements.some(s => s.kind === "homomer" || s.kind === "heteromer");
  const sub = both
    ? "Conditional assembly: both monomeric and oligomeric states are annotated; complex modelling uses the oligomeric state when applicable."
    : statements.length > 1
      ? "Multiple assembly states are annotated; all statements are preserved."
      : t.subunitText ? undefined : t.curationFailed ? "UniProt did not answer, so the assembly statement could not be read." : "Read as not stated, never as a monomer.";
  const value = t.curationPending
    ? ENGINE_STATE_LABELS.running
    : statements.length
      ? statements.map(s => `${s.label}${s.qualifier ? ` (${s.qualifier.toLowerCase()})` : ""}${s.family ? ` with the ${s.family}` : s.partnerGenes.length ? ` with ${s.partnerGenes.join(", ")}` : ""}`).join("; ")
      : t.curationFailed ? ENGINE_STATE_LABELS["upstream-error"] : t.subunitText ? "SUBUNIT names no assembly" : "No SUBUNIT record";
  return { label: "Curation", value, sub, state: t.curationPending ? "pending" : t.curationFailed ? "failed" : "done" };
}

function solvedStep(t: TraceInput): TraceStep {
  const o = t.observed;
  const state = o.availability.state;
  const sub = [
    o.fibrils.length ? `Amyloid fibrils read apart: ${o.fibrils.map(f => `${f.label}, ${plural(f.total, "entry", "entries")}`).join("; ")}.` : null,
    o.crystals.length ? `Monomer-assembly entries read apart: ${o.crystals.map(c => `${c.label}, ${plural(c.total, "entry", "entries")}`).join("; ")}.` : null,
    o.artefacts.length ? `Set aside, not biological: ${[...new Set(o.artefacts.map(a => `${a.name} (${a.artefact})`))].join("; ")}.` : null,
    t.entryKindsFailed ? "RCSB did not answer, so fibril and monomer-assembly entries could not be told apart from native ones." : null,
    !o.coverageChecked ? "PDBe could not say which structures model the variant residue, so every structure that holds a pair is counted." : null,
  ].filter(Boolean).join(" ");
  return {
    label: "Solved structures",
    value: state === "ok" ? o.partners.map(p => `${p.label}: ${plural(p.total, "entry", "entries")}`).join("; ") : o.availability.reason ?? "Not read",
    sub: sub || undefined,
    warn: state === "failed" || t.entryKindsFailed || !o.coverageChecked,
    state: state === "pending" ? "pending" : state === "failed" ? "failed" : "done",
  };
}

function residueValue(iface: InterfaceView, coverageChecked: boolean): string {
  if (iface.verdict === "pending") return ENGINE_STATE_LABELS.running;
  if (iface.observed) return `At the interface in ${supportText(iface.observed.k, iface.observed.n)}`;
  if (iface.verdict === "at-interface") return "At an interface in the model only";
  if (iface.verdict === "not-modelled") return `Not modelled in any of ${plural(iface.unmodelled!.total, "solved structure")}`;
  if (iface.verdict === "not-at-interface" && iface.unmodelled) return `Not at an interface in the predicted complex; not modelled in any of ${plural(iface.unmodelled.total, "solved structure")}`;
  if (iface.verdict === "not-at-interface") return iface.reference ? `Not at the interface in any of ${plural(iface.reference.n, "native structure")}${coverageChecked ? " that model it" : ""}` : "Not at any interface";
  return "Not measured";
}

function residueStep(t: TraceInput): TraceStep {
  const { iface } = t;
  const gap = iface.unmodelled?.gap ? `Residues ${iface.unmodelled.gap.start}–${iface.unmodelled.gap.end} have no coordinates in any of them.` : null;
  const sub = iface.verdict === "pending"
    ? "Reading the solved structures."
    : [iface.disagreement ?? (iface.observed ? `Interacting entries: ${iface.observed.entries.map(e => e.toUpperCase()).join(", ")}.` : gap), iface.fibril?.sentence ?? null].filter(Boolean).join(" ") || undefined;
  return { label: "Variant residue", value: residueValue(iface, t.observed.coverageChecked), sub, warn: Boolean(iface.disagreement), state: iface.verdict === "pending" ? "pending" : "done" };
}

function modelStep(model: ModelView): TraceStep {
  const running = model.state === "pending" || model.state === "running";
  return {
    label: "Complex model",
    value: running
      ? ENGINE_STATE_LABELS.running
      : model.state === "built" ? `Built · ${plural(model.chainCount, "chain")} · ipTM ${model.iptm !== null ? model.iptm.toFixed(2) : "not reported"}` : model.state === "not-requested" ? "Not run (on request)" : model.stateLabel ?? "Not run",
    sub: model.state === "built" ? undefined : model.reason ?? undefined,
    warn: model.state === "failed",
    state: running ? "pending" : model.state === "failed" ? "failed" : "done",
  };
}

function stringStep(t: TraceInput): TraceStep {
  const { sections, ppi } = t;
  const limit = ppi?.string?.limit ?? null;
  const functional = ppi?.string?.functional?.length ?? 0;
  const capped = limit !== null && functional >= limit;
  const failed = sections.stringPhysical.state === "failed";
  return {
    label: "STRING",
    value: sections.stringPhysical.state === "ok" || sections.stringPhysical.state === "empty"
      ? `${plural(ppi?.string?.physical?.length ?? 0, "physical partner")} and ${functional}${capped ? "+" : ""} functional ≥ ${(ppi?.string?.minScore ?? 0.15).toFixed(2)}`
      : sections.stringPhysical.reason ?? "Not read",
    sub: [ppi?.stringVersion ? `STRING ${ppi.stringVersion}` : null, capped ? `STRING returns its top ${limit}; the functional network is larger` : null].filter(Boolean).join(". ") || undefined,
    warn: failed,
    state: t.ppiLoading && !ppi ? "pending" : failed ? "failed" : "done",
  };
}

export function readTrace(t: TraceInput): TraceStep[] {
  const { sections, binding: b } = t;
  const partnersFailed = sections.uniprot.state === "failed";
  return [
    curationStep(t),
    solvedStep(t),
    residueStep(t),
    modelStep(t.model),
    {
      label: "Partners",
      value: t.ppiLoading ? ENGINE_STATE_LABELS.running : partnersFailed ? ENGINE_STATE_LABELS["upstream-error"] : `${plural(t.partnerCount, "partner protein")} with binding evidence: ${t.partnerSub}`,
      sub: [partnersFailed ? sections.uniprot.reason : null, sections.intact.state === "failed" ? sections.intact.reason : null].filter(Boolean).join(" ") || undefined,
      warn: partnersFailed || sections.intact.state === "failed",
      state: t.ppiLoading ? "pending" : partnersFailed ? "failed" : "done",
    },
    stringStep(t),
    {
      label: "Binding change",
      value: b.state === "ok" ? `${b.valueText} on ${b.wildType?.source === "experimental" ? `PDB ${b.wildType.pdbId?.toUpperCase()}` : "a Boltz-2 wild-type model"}` : b.stateLabel ?? "Not measured",
      sub: b.state === "ok" ? undefined : b.reason ?? undefined,
      warn: b.state === "failed",
      state: b.state === "pending" || b.state === "running" ? "pending" : b.state === "failed" ? "failed" : "done",
    },
    { label: "Engine record", value: "None", sub: "No ACMG criterion reads this tab.", state: "done" },
  ];
}
