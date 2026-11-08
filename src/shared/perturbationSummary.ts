import type { LmReading, PerturbationEvidence } from "./perturbationEvidence";
import type { PerturbationModelId } from "./perturbationModels";

/**
 * The short readings the Structural perturbation tab and its Evidence Lineage rail both print.
 * They live here, once, so the two panes cannot pick a different model or word a direction differently.
 */

/**
 * The model to show in detail: the preferred one if it has a result; otherwise the first model with a
 * reading, because a flat distribution has no preference to show; otherwise any scored model.
 */
export function selectLmReading(ev: PerturbationEvidence, preferred: PerturbationModelId): LmReading | null {
  return (
    ev.lms.find(l => l.id === preferred && l.availability.state === "computed") ??
    ev.scored.find(l => l.direction !== "flat") ??
    ev.scored[0] ??
    null
  );
}

/** "Favours Ser", "Near even", "No preference" — never red or green, because none of it is an ACMG code. */
export function directionLabel(lm: LmReading, wt: string, mut: string): string | null {
  switch (lm.direction) {
    case "favours-native": return `Favours ${wt}`;
    case "favours-variant": return `Favours ${mut}`;
    case "even": return "Near even";
    case "flat": return "No preference";
    default: return null;
  }
}

/**
 * The hero figure. "N of M" states a majority. With no majority (a tie, or most models near even or
 * flat) the figure says "Split" and the label lists every direction, so a minority never reads as the answer.
 */
export function directionCount(ev: PerturbationEvidence): { figure: string; label: string } {
  const dir = ev.direction;
  if (dir.nScored === 0) return { figure: "—", label: "no language model has scored this substitution yet" };
  const wt = ev.residues.wtLabel || "native";
  const mut = ev.residues.mutLabel || "variant";
  const atResidue = ev.residues.position !== null ? ` at residue ${ev.residues.position}` : "";
  const variantLeads = dir.nFavourVariant > dir.nFavourNative;
  const lead = variantLeads ? dir.nFavourVariant : dir.nFavourNative;
  if (lead * 2 > dir.nScored) {
    const order = variantLeads ? `${mut} over native ${wt}` : `native ${wt} over ${mut}`;
    return { figure: `${lead} of ${dir.nScored}`, label: `models favour ${order}${atResidue}` };
  }
  const parts = [
    dir.nFavourNative > 0 && `${dir.nFavourNative} favour native ${wt}`,
    dir.nFavourVariant > 0 && `${dir.nFavourVariant} favour ${mut}`,
    dir.nEven > 0 && `${dir.nEven} near even`,
    dir.nFlat > 0 && `${dir.nFlat} with no preference`
  ].filter(Boolean);
  return { figure: "Split", label: parts.join(" · ") + atResidue };
}

const countWords = (n: number, total: number) =>
  n === total ? (n === 1 ? "The language model" : n === 2 ? "Both language models" : `All ${n} language models`) : `${n} of ${total} language models`;

interface PlainReading { lead: string; meaning: string | null }
interface Labels { wt: string; mut: string; at: string }

/** One sentence per agreed direction. `s` is the verb ending: "" for several models, "s" for one. */
const UNANIMOUS: Record<"native" | "variant" | "even", (who: string, s: string, l: Labels) => PlainReading> = {
  native: (who, s, { wt, mut, at }) => ({
    lead: `${who} expect${s} ${wt}${at} and find${s} ${mut} less likely.`,
    meaning: `Language models learn from millions of natural protein sequences, so they learn which amino acid usually sits at each position. Here they expect ${wt}, which makes ${mut} an unusual choice. That is a hint that the position is sensitive to change. It is not proof that the variant is harmful.`
  }),
  variant: (who, s, { wt, mut, at }) => ({
    lead: `${who} find${s} ${mut} at least as likely as the original ${wt}${at}.`,
    meaning: `For these models ${mut} is not an unusual choice here. That does not show the variant is harmless: a position can tolerate the change in sequence terms and still matter for function.`
  }),
  even: (who, s, { wt, mut, at }) => ({
    lead: `${who} rate${s} ${wt} and ${mut} about equally likely${at}.`,
    meaning: "The models see little difference between the two, so they give no clear signal either way."
  })
};

/** Nothing to compare: no model has scored, or every model that did spreads its probability evenly. */
function unreadReading(ev: PerturbationEvidence, at: string): PlainReading {
  if (ev.direction.nScored === 0) {
    return { lead: ev.pending ? "The language models are still running." : "No language model has scored this substitution.", meaning: null };
  }
  return { lead: `The models spread their probability almost evenly${at}, so none of them shows a preference.`, meaning: null };
}

/**
 * The finding for a reader who has never used a language model: one sentence that says who expects what,
 * and one that says what that does and does not tell them. Built from the same counts as the hero figure,
 * so the sentence and the figure cannot disagree. Neither sentence states a pathogenicity claim.
 */
export function plainReading(ev: PerturbationEvidence): PlainReading {
  const { nScored, nFavourNative: native, nFavourVariant: variant, nEven: even, nFlat: flat } = ev.direction;
  const labels: Labels = {
    wt: ev.residues.wtLabel || "the original amino acid",
    mut: ev.residues.mutLabel || "the replacement",
    at: ev.residues.position !== null ? ` at position ${ev.residues.position}` : ""
  };
  const read = native + variant + even;
  if (read === 0) return unreadReading(ev, labels.at);
  const agreed = [["native", native], ["variant", variant], ["even", even]] as const;
  const unanimous = agreed.find(([, n]) => n === read)?.[0];
  if (unanimous) return UNANIMOUS[unanimous](countWords(read, nScored), read > 1 ? "" : "s", labels);
  const parts = [native > 0 && `${native} expect ${labels.wt}`, variant > 0 && `${variant} expect ${labels.mut}`, even > 0 && `${even} see no clear difference`].filter(Boolean);
  return {
    lead: `The language models disagree${labels.at}: ${parts.join(", ")}${flat > 0 ? `; ${flat} show no preference` : ""}.`,
    meaning: "When the models disagree, this reading gives no clear signal. Compare the models below before drawing any conclusion."
  };
}
