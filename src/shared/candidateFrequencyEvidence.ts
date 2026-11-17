/**
 * candidateFrequencyEvidence.ts — the Population tab's reading for a protein-only input that several
 * nucleotide alleles can produce, with gnomAD read once per candidate (`GnomadFrequencyData.candidates`).
 *
 * Two outputs, both from the shared rule in `candidateFrequency.ts` so the screen and the engine agree:
 *  - the verdict for the whole input: a criterion only when every candidate supports it;
 *  - one row per candidate allele, with that allele's own reading and verdict, so a mixed or
 *    withheld verdict shows which allele caused it.
 *
 * Pure. Imports only `src/shared/`.
 */
import type { CandidateAllOfUs, GnomadCandidateReading } from "./contracts.ts";
import type { FrequencyCriterion } from "./frequencyEvidence.ts";
import type { FrequencyDecision, FrequencyStatistic } from "./frequencyRule.ts";
import { candidateAlleleLabel, candidateNucleotideChange, decideCandidateFrequency, type CandidateDecision } from "./candidateFrequency.ts";
import { formatAlleleFrequency, formatCount, formatCutPoint } from "./frequencyFormat.ts";
import { pm2CeilingFor, type CuratedInheritance } from "./inheritanceBasis.ts";
import { THRESHOLDS } from "./thresholds/constants.ts";

/** One candidate allele, as the Population tab lists it. */
export interface CandidateAlleleRow {
  key: string;
  /** GRCh38 gnomAD id, or the GRCh37 id named as such when it was not lifted. */
  id: string;
  /** Whether this candidate resolved to a GRCh38 coordinate. */
  lifted: boolean;
  /** gnomAD answered "variant not found" for this allele (its frequency is read as 0). */
  absent: boolean;
  /** The nucleotide change, "G>A". */
  change: string | null;
  /** The change on its transcript, "ENST…:c.1138G>A", when the candidate source named it. */
  cdna: string | null;
  /** The frequency PM2 reads for this allele (grouped maximum; 0 for "not found"); null without a reading. */
  af: number | null;
  /** The frequency BA1/BS1 read for this allele (FAF95 when available, else grouped maximum); null without a reading. */
  benignAf: number | null;
  /** Which statistic BA1/BS1 read for this allele; null without a reading. */
  benignStatistic: FrequencyStatistic | null;
  /** Allele count / allele number over exomes and genomes, which gnomAD v4 samples separately. */
  counts: string | null;
  homozygotes: number | null;
  /** This allele's own verdict; null when it has no reading. */
  decision: FrequencyDecision | null;
  /** Why the allele has no figure, or that gnomAD holds no record of it. */
  note: string | null;
  /** This allele's All of Us reading (display only); null when the allele was not read there. */
  allOfUs: { af: number | null; counts: string | null; note: string | null } | null;
}

const ALL_OF_US_ABSENCE: Record<Exclude<CandidateAllOfUs["localTable"], "found">, string> = {
  absent: "Not in the local All of Us table.",
  "not-installed": "No local All of Us table in this deployment.",
  failed: "The local All of Us lookup failed on this run.",
  invalid: "The local All of Us row has counts that fail validation, so none is shown.",
};

function allOfUsFor(reading: CandidateAllOfUs | null | undefined): CandidateAlleleRow["allOfUs"] {
  if (!reading) return null;
  const ac = reading.frequency?.aouAC ?? null;
  const an = reading.frequency?.aouAN ?? null;
  if (reading.localTable !== "found" || ac === null || an === null || an <= 0) {
    return { af: null, counts: null, note: reading.localTable === "found" ? "All of Us reports no usable allele count." : ALL_OF_US_ABSENCE[reading.localTable] };
  }
  return { af: ac / an, counts: `${formatCount(ac)} / ${formatCount(an)}`, note: null };
}

type CandidateCriterion = Pick<FrequencyCriterion,
  "code" | "statement" | "headline" | "predicate" | "af" | "sourceId" | "absent" | "inputs" |
  "pm2Ceiling" | "inheritance" | "ceilingBasis" | "ceilingText"> & { candidateAlleles: number; candidatesDisagree: boolean };

const sum = (a: number | null | undefined, b: number | null | undefined) =>
  a == null && b == null ? null : (a ?? 0) + (b ?? 0);

function rowFor({ candidate, inputs, decision }: CandidateDecision): CandidateAlleleRow {
  const f = candidate.frequency;
  const ac = sum(f?.exomeAC, f?.genomeAC);
  const an = sum(f?.exomeAN, f?.genomeAN);
  const note = candidate.outcome === "not-found" ? "gnomAD holds no record of this allele (read as 0)."
    : candidate.outcome === "found"
      ? (decision === null ? "No reading: gnomAD returned a record without an allele frequency." : null)
    : `No reading: ${candidate.detail ?? "this allele was not read"}.`;
  return {
    key: candidateAlleleLabel(candidate),
    id: candidateAlleleLabel(candidate),
    lifted: candidate.id !== null,
    absent: candidate.outcome === "not-found",
    change: candidateNucleotideChange(candidate),
    cdna: candidate.cdna ?? null,
    af: inputs?.pm2Af ?? null,
    benignAf: inputs?.benignAf ?? null,
    benignStatistic: inputs?.benignStatistic ?? null,
    counts: ac !== null && an !== null ? `${formatCount(ac)} / ${formatCount(an)}` : null,
    homozygotes: f?.nHomozygous ?? null,
    decision,
    note,
    allOfUs: allOfUsFor(candidate.allOfUs),
  };
}

/**
 * The verdict for the whole input (in the shape `classifyAcmgFrequency` returns) and one row per allele.
 * The verdict's `af` is the figure that bound it: the highest PM2 input for PM2, the lowest BA1/BS1
 * input for BA1/BS1 — the candidate closest to failing the criterion.
 */
export function candidateFrequencyReading(
  candidates: ReadonlyArray<GnomadCandidateReading>,
  basis: { curatedInheritance: CuratedInheritance | null; pli: number | null },
): { criterion: CandidateCriterion; rows: CandidateAlleleRow[] } {
  const verdict = decideCandidates(candidates, basis);
  return { criterion: criterionFor(verdict, candidates.length), rows: verdict.readings.map(rowFor) };
}

function decideCandidates(
  candidates: ReadonlyArray<GnomadCandidateReading>,
  basis: { curatedInheritance: CuratedInheritance | null; pli: number | null },
) {
  const FREQ = THRESHOLDS.populationFrequency;
  const ceiling = pm2CeilingFor(
    { inheritance: basis.curatedInheritance, pli: basis.pli },
    { recessiveCeiling: FREQ.extremelyRareRecessive, dominantCeiling: FREQ.extremelyRare, pliCut: FREQ.recessivePlI },
  );
  const verdict = decideCandidateFrequency(candidates, {
    standAloneBenign: FREQ.standAloneBenign, tooCommonForDisorder: FREQ.tooCommonForDisorder, pm2Ceiling: ceiling.ceiling,
  });
  return { ...verdict, ceiling };
}

function criterionFor(verdict: ReturnType<typeof decideCandidates>, count: number): CandidateCriterion {
  const FREQ = THRESHOLDS.populationFrequency;
  const { ceiling } = verdict;
  const shared = {
    sourceId: "gnomad-group" as const,
    candidateAlleles: count,
    candidatesDisagree: verdict.kind === "mixed",
    pm2Ceiling: ceiling.ceiling,
    inheritance: ceiling.basis === "curated-recessive" || ceiling.basis === "pli-recessive" ? "recessive" as const
      : ceiling.basis === "unknown" ? "unknown" as const : "dominant" as const,
    ceilingBasis: ceiling.basis,
    ceilingText: ceiling.text,
  };
  const all = `every candidate allele (${count})`;

  if (verdict.kind === "failed") {
    const failed = verdict.failed.map(candidateAlleleLabel).join(", ");
    return {
      ...shared, code: "withheld", af: null, absent: false, inputs: null, headline: null, predicate: null,
      statement: `Population-frequency evidence was withheld: gnomAD has no reading for candidate allele ${failed}. A frequency criterion must hold for every candidate allele, so none (PM2, BS1 or BA1) was applied.`,
    };
  }
  if (verdict.kind === "mixed") {
    const each = verdict.readings.map(r => `${candidateAlleleLabel(r.candidate)}: ${r.decision === "none" ? "no criterion" : r.decision}`).join("; ");
    const predicate = `the candidate alleles fall on different sides of the cut-points (${each}), so no frequency criterion applies`;
    return { ...shared, code: "none", af: null, absent: false, inputs: null, headline: "Candidate alleles disagree", predicate, statement: `Candidate alleles disagree: ${predicate}.` };
  }

  const benign = verdict.decision === "BA1" || verdict.decision === "BS1";
  const binding = verdict.readings.reduce((a, b) => benign
    ? (b.inputs!.benignAf < a.inputs!.benignAf ? b : a)
    : (b.inputs!.pm2Af > a.inputs!.pm2Af ? b : a));
  const inputs = binding.inputs!;
  const af = benign ? inputs.benignAf : inputs.pm2Af;
  const absent = verdict.readings.every(r => r.candidate.outcome === "not-found");
  const [headline, clause] =
    verdict.decision === "BA1" ? ["Stand-alone benign", `above the ${formatCutPoint(FREQ.standAloneBenign)} BA1 cut-point`]
    : verdict.decision === "BS1" ? ["Too common for the disorder", `above the ${formatCutPoint(FREQ.tooCommonForDisorder)} BS1 cut-point`]
    : verdict.decision === "PM2" ? ["Extremely rare", `at or below the ${formatCutPoint(ceiling.ceiling)} PM2 ceiling under the app-defined policy: ${ceiling.text}`]
    : ["Between the cut-points", `between the ${formatCutPoint(ceiling.ceiling)} PM2 ceiling and the ${formatCutPoint(FREQ.tooCommonForDisorder)} BS1 cut-point, so no frequency criterion applies`];
  const predicate = `${all} is ${clause}; frequencies were not added together`;
  return {
    ...shared, code: verdict.decision, af, absent, inputs, headline, predicate,
    statement: `${headline}: ${predicate} (closest to the cut-point: ${candidateAlleleLabel(binding.candidate)} at ${formatAlleleFrequency(af)}).`,
  };
}
