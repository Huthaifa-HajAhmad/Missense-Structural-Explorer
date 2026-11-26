/** Small text helpers shared by the Interfaces & PPI model's sections. */
import type { IntactEvidence, ObservedInterface } from "../contracts.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import { AMINO_ACID_1_TO_3_TITLE } from "../aminoAcids.ts";
import { HGVS_PATTERN } from "../variantNotation.ts";
import type { AvailabilityView } from "./types.ts";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const COUNT_WORD: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 12: "twelve" };
export const bare = (acc: string | null | undefined) => (acc ?? "").toUpperCase().replace(/-\d+$/, "");
export const rangeText = (s: { start: number; end: number }) => (s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`);
export const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const upperIds = (ids: readonly string[], max = 4) => `${ids.slice(0, max).map(e => e.toUpperCase()).join(", ")}${ids.length > max ? "…" : ""}`;

export function statementQualifier(sentence: string): string | null {
  const m = /\((Probable|By similarity|Potential)\)/i.exec(sentence);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

export function residueLabel(variant: string | undefined, position: number | null): string {
  const m = variant ? HGVS_PATTERN.exec(variant.replace(/^.*\((p\.[^)]+)\).*$/, "$1").trim()) : null;
  if (m) {
    const wt = m[1].length === 1 ? AMINO_ACID_1_TO_3_TITLE[m[1].toUpperCase()] ?? m[1] : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return `${wt}${m[2]}`;
  }
  return position ? `residue ${position}` : "the variant residue";
}

/** "Gly358" from the protein sequence, "residue 358" when the sequence is not known. */
export function residueNamer(sequence: string): (r: number) => string {
  return r => {
    const three = sequence[r - 1] ? AMINO_ACID_1_TO_3_TITLE[sequence[r - 1].toUpperCase()] : undefined;
    return three ? `${three}${r}` : `residue ${r}`;
  };
}

/** The STRING page for the query protein's network (the form STRING documents for linking). */
export function stringNetworkUrl(gene: string, partner?: string, physical = false): string {
  const ids = partner ? `${encodeURIComponent(gene)}%0d${encodeURIComponent(partner)}` : encodeURIComponent(gene);
  return `https://string-db.org/cgi/network?identifiers=${ids}&species=9606${physical ? "&network_flavor=evidence&network_type=physical" : ""}`;
}

export function rcsbUrl(pdbId: string): string {
  return `https://www.rcsb.org/structure/${pdbId.toUpperCase()}`;
}

/** "1 of 8 solved structures", "all 8 solved structures". */
export function supportText(k: number, n: number): string {
  if (n <= 0) return `${plural(k, "solved structure")}`;
  if (k >= n) return n === 1 ? "the one solved structure" : `all ${n} solved structures`;
  return `${k} of ${n} solved structures`;
}

/** A lookup's outcome as one availability state, in the five-state vocabulary. */
export function availability(
  status: string | undefined,
  hasItems: boolean,
  pending: boolean,
  words: { failed: string; skipped?: string; empty: string; unknown: string }
): AvailabilityView {
  if (pending) return { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null };
  if (status === "ok") return hasItems ? { state: "ok", label: null, reason: null } : { state: "empty", label: ENGINE_STATE_LABELS["no-result"], reason: words.empty };
  if (status === "none") return { state: "empty", label: ENGINE_STATE_LABELS["no-result"], reason: words.empty };
  if (status === "failed" || status === "error") return { state: "failed", label: ENGINE_STATE_LABELS["upstream-error"], reason: words.failed };
  if (status === "skipped") return { state: "skipped", label: ENGINE_STATE_LABELS["not-covered"], reason: words.skipped ?? words.unknown };
  return { state: "unknown", label: ENGINE_STATE_LABELS["no-result"], reason: words.unknown };
}

export function intactLine(e: IntactEvidence | null, experiments: number | null, intactRead: boolean): string {
  if (!e || !e.methods.length) {
    // IntAct answered and holds no row for the pair (often a different isoform or species entry): say that, not "not read".
    if (experiments === null) return "IntAct binary interaction";
    return intactRead
      ? `UniProt: ${plural(experiments, "experiment")}; IntAct gave no method for this pair`
      : `IntAct binary interaction (${plural(experiments, "assay")}, methods not read)`;
  }
  const studies = e.pubmed.length;
  const method = e.twoHybridOnly ? "Yeast two-hybrid" : e.methods.slice(0, 2).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(", ") + (e.methods.length > 2 ? ` +${e.methods.length - 2}` : "");
  return `${method} · ${studies === 1 ? `1 study (PubMed ${e.pubmed[0]})` : plural(studies, "study", "studies")}`;
}

/** Track and table name of a solved partner: "SOD1, other chain", "CCS", "Sod1 (mouse)", "SOD1 fibril". */
export function observedLabel(p: ObservedInterface, gene: string): string {
  const name = p.gene ?? p.name;
  if (p.context === "fibril") return `${p.homomeric ? gene : name} fibril`;
  if (p.context === "crystal") return `${p.homomeric ? gene : name} (outside the assembly)`;
  return p.homomeric ? `${gene}, other chain` : p.organism ? `${name} (${p.organism.toLowerCase()})` : name;
}

/** "the other ABCG1 chain" for the homomer's own label, the partner's name otherwise. */
export function partnerPhrase(label: string, gene: string): string {
  return label === `${gene}, other chain` ? `the other ${gene} chain` : label;
}
