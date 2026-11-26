/** The finding the hero states, and the four facts under it. Words only; nothing here is decided again. */
import type { PpiInteractionSite } from "../contracts.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import { IPTM_BAND_LABEL } from "./constants.ts";
import { partnerPhrase, plural, rangeText, supportText } from "./format.ts";
import type { BindingView, InterfaceView, InterfacesEvidence, ModelView, ObservedView } from "./types.ts";

interface FindingInput {
  iface: InterfaceView;
  model: ModelView;
  native: ObservedView[];
  sites: PpiInteractionSite[];
  solvedFailed: boolean;
  gene: string;
  resLabel: string;
  homomerLabel: string | null;
  location: string | null;
  /** PDBe said which structures model the residue, so a denominator can say "that model it". */
  coverageChecked: boolean;
}

type Finding = InterfacesEvidence["finding"];

function atInterface(f: FindingInput, siteHits: PpiInteractionSite[]): Pick<Finding, "headline" | "predicate"> {
  const o = f.iface.observed!;
  const entries = o.entries.map(e => e.toUpperCase());
  let predicate = o.k < o.n
    ? `${o.k === 1 ? "A contact seen in one structure" : "A contact seen in some structures"} depends on the conformation or construct captured; this interface's best-attested residues are seen in ${o.maxSupport} of ${o.total}`
    : "Every solved structure of this pair has it at the interface";
  if (siteHits.length) predicate += `. It is also inside UniProt's mapped site${siteHits.length > 1 ? "s" : ""} ${siteHits.map(rangeText).join(", ")}`;
  return {
    headline: `${f.resLabel} is at the interface with ${partnerPhrase(o.partner, f.gene)} in ${supportText(o.k, o.n)}${entries.length && entries.length <= 3 ? ` (${entries.join(", ")})` : ""}.`,
    predicate,
  };
}

function notAtInterface(f: FindingInput, siteHits: PpiInteractionSite[]): Pick<Finding, "headline" | "predicate"> {
  const { iface, model, native, resLabel, gene } = f;
  const ref = iface.reference;
  const silent = iface.unmodelled;
  if (silent) {
    // The model is the only witness: no solved structure has coordinates for the residue (audit C1).
    return {
      headline: `${resLabel} is not at an interface in the predicted complex. None of the ${plural(silent.total, "solved structure")} of ${gene} has coordinates for it, so they cannot confirm that.`,
      predicate: `${silent.gap ? `Residues ${rangeText(silent.gap)} have no coordinates in any of them: a stretch the experiments did not resolve` : "It has no coordinates in any of them"}${model.nearestInterfaceGap !== null ? `; the nearest interface residue in the model is ${plural(model.nearestInterfaceGap, "residue")} away in sequence` : ""}`,
    };
  }
  const headline = siteHits.length
    ? `${resLabel} is inside UniProt's mapped binding site ${siteHits.map(rangeText).join(", ")}, but no structure places it at an interface.`
    : ref && model.state !== "built"
      ? `${resLabel} is not at the interface with ${partnerPhrase(ref.partner, gene)} in any of ${plural(ref.n, "native solved structure")}${f.coverageChecked ? " that model it" : ""}.`
      : `${resLabel} is not at any interface seen ${model.state === "built" ? "in the model or " : ""}in solved structures of ${gene}.`;
  const near = iface.nearest && iface.nearest.gap <= 5 ? `${iface.nearest.name}, ${plural(iface.nearest.gap, "residue")} away, is at that interface in ${iface.nearest.support} of ${iface.nearest.n}` : null;
  const predicate = native.length
    ? [native.length > 1 ? `None of the ${native.length} native interfaces in solved structures includes it` : null, near].filter(Boolean).join("; ") || `Solved structures show ${plural(native.length, "interface")}, none including ${resLabel}`
    : model.nearestInterfaceGap !== null
      ? `In the predicted complex the nearest interface residue is ${plural(model.nearestInterfaceGap, "residue")} away in sequence`
      : "The predicted complex has no contact at it";
  return { headline, predicate };
}

/** The figure the hero leads with, and the caption that says what it counts. */
function figureOf(f: FindingInput): Finding["figure"] {
  const { iface, resLabel, gene } = f;
  const that = f.coverageChecked ? ` that model ${resLabel}` : "";
  if (iface.observed) return { value: `${iface.observed.k} of ${iface.observed.n}`, isCount: true, caption: `solved structures${that} place it at the interface · PDBe-KB` };
  if (iface.reference) return { value: `0 of ${iface.reference.n}`, isCount: true, caption: `native solved structures${that} place it at the interface with ${partnerPhrase(iface.reference.partner, gene)} · PDBe-KB` };
  if (iface.unmodelled) {
    const lead = iface.verdict === "not-at-interface" ? "Predicted complex only. " : "";
    return { value: iface.label, isCount: false, caption: `${lead}${plural(iface.unmodelled.total, "solved structure")} with ${partnerPhrase(iface.unmodelled.partner, gene)}; none has coordinates for ${resLabel} · PDBe-KB` };
  }
  return { value: iface.label, isCount: false, caption: iface.support };
}

export function readFinding(f: FindingInput): Finding {
  const { iface, model, resLabel, gene } = f;
  const siteHits = f.sites.filter(s => s.containsVariant);
  let words: Pick<Finding, "headline" | "predicate">;
  if (iface.verdict === "pending") {
    words = { headline: `Reading ${gene}'s assembly and solved structures.`, predicate: "The interface reading follows when PDBe answers" };
  } else if (iface.verdict === "at-interface" && iface.observed) {
    words = atInterface(f, siteHits);
  } else if (iface.verdict === "at-interface") {
    words = {
      headline: `In the predicted complex, ${resLabel} makes ${plural(model.variantContacts.length, "contact")} with another chain${model.band ? ` (ipTM ${model.iptm!.toFixed(2)}, ${IPTM_BAND_LABEL[model.band].toLowerCase()})` : ""}.`,
      predicate: "No solved structure shows it; this is a prediction on the variant model, so whether a contact is lost is not measured",
    };
  } else if (iface.verdict === "not-modelled") {
    const u = iface.unmodelled!;
    words = {
      headline: `${resLabel} is not modelled in any of the ${plural(u.total, "solved structure")} of ${gene}, so they cannot show whether it is at an interface.`,
      predicate: u.gap ? `Residues ${rangeText(u.gap)} have no coordinates in any of them: a stretch the experiments did not resolve` : "It has no coordinates in any of them",
    };
  } else if (iface.verdict === "not-at-interface") {
    words = notAtInterface(f, siteHits);
  } else {
    words = {
      headline: siteHits.length ? `${resLabel} is inside UniProt's mapped binding site ${siteHits.map(rangeText).join(", ")}.` : `Whether ${resLabel} touches another protein has not been measured.`,
      predicate: f.solvedFailed ? "Solved structures could not be read, so a contact is not ruled out" : "No solved complex of this protein exists, and no model has been run",
    };
  }
  const context = f.homomerLabel && iface.verdict === "at-interface"
    ? `In a ${f.homomerLabel.toLowerCase()}, a heterozygous carrier makes mixed complexes: one mutant chain beside wild type. An interface residue is where such a variant could act on the partner chain; this tab does not test that.`
    : iface.verdict === "not-modelled" || iface.verdict === "not-at-interface" ? f.location : null;
  return { chip: iface.label, chipTone: iface.verdict === "at-interface" ? "neutral" : "muted", figure: figureOf(f), ...words, context };
}

interface FactsInput {
  iface: InterfaceView;
  binding: BindingView;
  assemblyLabel: string;
  subunitText: string | null;
  qualifier: string | null;
  partnerCount: number;
  partnerSub: string;
  partnersLoading: boolean;
  partnersFailed: boolean;
  coverageChecked: boolean;
}

function supportFact(iface: InterfaceView, coverageChecked: boolean): InterfacesEvidence["facts"][number] {
  const extra = (iface.fibril ? ` · ${iface.fibril.k} of ${iface.fibril.n} fibrils` : "") + (iface.crystal ? ` · ${iface.crystal.k} of ${iface.crystal.n} monomer-assembly entries` : "");
  if (iface.observed) {
    const ids = iface.observed.entries.length <= 2 ? ` · ${iface.observed.entries.map(e => e.toUpperCase()).join(", ")}` : "";
    return { label: "Interface support", value: `${iface.observed.k} of ${iface.observed.n}`, sub: `solved structures${ids}${extra}`, mono: true };
  }
  if (iface.unmodelled) return { label: "Interface support", value: "Not modelled", sub: `in none of ${plural(iface.unmodelled.total, "solved structure")}${extra}` };
  if (iface.reference) return { label: "Interface support", value: `0 of ${iface.reference.n}`, sub: `native solved structures${coverageChecked ? " that model it" : ""}${extra}`, mono: true };
  return { label: "Interface support", value: iface.label, sub: `${iface.support}${extra}` };
}

export function readFacts(f: FactsInput): InterfacesEvidence["facts"] {
  const b = f.binding;
  return [
    { label: "Assembly", value: f.assemblyLabel, sub: f.subunitText ? `UniProt SUBUNIT${f.qualifier ? `, ${f.qualifier.toLowerCase()}` : ""}` : "No SUBUNIT record" },
    supportFact(f.iface, f.coverageChecked),
    {
      label: "Reported partners",
      value: f.partnersLoading ? ENGINE_STATE_LABELS.running : String(f.partnerCount),
      sub: f.partnersLoading ? "" : f.partnersFailed ? "UniProt not read" : f.partnerSub,
      mono: !f.partnersLoading,
    },
    {
      label: "Binding change",
      value: b.state === "ok" ? b.valueText! : b.state === "pending" || b.state === "running" ? ENGINE_STATE_LABELS.running : "Not measured",
      sub: b.state === "ok" ? `${b.directionText}${b.withinError ? ", within the method's error" : ""}` : b.state === "ready" ? "Ready to estimate" : b.stateLabel ?? "",
      mono: b.state === "ok",
    },
  ];
}
