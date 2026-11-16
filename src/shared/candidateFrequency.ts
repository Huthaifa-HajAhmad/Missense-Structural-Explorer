/**
 * candidateFrequency.ts — the population rule when a protein-only input can come from several
 * nucleotide alleles (for example FGFR3 p.Gly380Arg: codon GGG, so both G>A and G>C give Arg).
 *
 * The person carries ONE of the candidate alleles, and nothing says which. A frequency criterion is
 * therefore applied only when it holds for EVERY candidate: whichever allele the person carries, the
 * criterion is then true of it. When the candidates fall on different sides of a cut-point, no
 * criterion applies. Frequencies are never added together, because every cut-point is per allele.
 *
 * Each candidate is read exactly like a single allele (`frequencyRule.ts`): FAF95 for BA1/BS1 when
 * gnomAD reports it, the grouped maximum for PM2, and gnomAD's "variant not found" as zero.
 *
 * Shared by the rule engine (`server/services/prediction/acmg/criteria.ts`) and the surfaces that
 * explain it (`frequencyEvidence.ts`), so the two cannot reach different verdicts. Pure.
 */
import type { GnomadCandidateReading } from "./contracts";
import { decideFrequencyCriterion, gnomadRuleInputs, singleRuleInput, type FrequencyDecision, type FrequencyRuleInputs } from "./frequencyRule";

export interface CandidateDecision {
  candidate: GnomadCandidateReading;
  /** What the rule read for this allele; null when the allele has no usable reading. */
  inputs: FrequencyRuleInputs | null;
  decision: FrequencyDecision | null;
}

export type CandidateVerdict =
  /** At least one candidate has no reading, so no criterion can hold for all of them. */
  | { kind: "failed"; failed: GnomadCandidateReading[]; readings: CandidateDecision[] }
  /** Every candidate reached the same decision ("none" included). */
  | { kind: "agree"; decision: FrequencyDecision; readings: CandidateDecision[] }
  /** The candidates reached different decisions, so no criterion applies. */
  | { kind: "mixed"; readings: CandidateDecision[] };

export function decideCandidateFrequency(
  candidates: ReadonlyArray<GnomadCandidateReading>,
  cut: Parameters<typeof decideFrequencyCriterion>[1],
): CandidateVerdict {
  const readings: CandidateDecision[] = candidates.map(candidate => {
    const inputs = candidate.outcome === "not-found" ? singleRuleInput(0, "absent")
      : candidate.outcome === "found" ? gnomadRuleInputs(candidate.frequency)
      : null;
    return { candidate, inputs, decision: inputs ? decideFrequencyCriterion(inputs, cut) : null };
  });
  const failed = readings.filter(r => r.decision === null).map(r => r.candidate);
  if (failed.length > 0 || readings.length === 0) return { kind: "failed", failed, readings };
  const decisions = new Set(readings.map(r => r.decision));
  return decisions.size === 1
    ? { kind: "agree", decision: readings[0].decision!, readings }
    : { kind: "mixed", readings };
}

/** BS2's homozygote test, held only when every candidate has at least `minimum` homozygotes. */
export function candidatesMeetBs2(candidates: ReadonlyArray<GnomadCandidateReading>, minimum = 2): boolean {
  return candidates.length > 0 && candidates.every(c =>
    c.outcome === "found" && typeof c.frequency?.nHomozygous === "number" && c.frequency.nHomozygous >= minimum);
}

/** The candidate's display id: its GRCh38 id, or its GRCh37 id named as such when it was not lifted. */
export function candidateAlleleLabel(candidate: Pick<GnomadCandidateReading, "id" | "grch37Id">): string {
  return candidate.id ?? `${candidate.grch37Id} (GRCh37)`;
}

/** The nucleotide change, "G>A", read from a gnomAD-style id "4-1804392-G-A". */
export function candidateNucleotideChange(candidate: Pick<GnomadCandidateReading, "id" | "grch37Id">): string | null {
  const parts = (candidate.id ?? candidate.grch37Id).split("-");
  return parts.length === 4 ? `${parts[2]}>${parts[3]}` : null;
}
