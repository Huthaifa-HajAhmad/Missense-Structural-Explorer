/**
 * candidate-frequency.ts — PM2 / BS1 / BA1 / BS2 when a protein-only input can come from several
 * nucleotide alleles and gnomAD was read once per candidate (`GnomadFrequencyData.candidates`).
 *
 * The person carries one candidate and nothing says which, so a criterion is recorded only when it
 * holds for every candidate (`src/shared/candidateFrequency.ts`, shared with the Population tab).
 */
import { THRESHOLDS } from "../../../../src/shared/thresholds.ts";
import type { GnomadCandidateReading } from "../../../../src/shared/contracts.ts";
import { candidateAlleleLabel, candidatesMeetBs2, decideCandidateFrequency } from "../../../../src/shared/candidateFrequency.ts";
import { homozygotesInformBs2, pm2CeilingFor, type CuratedInheritance } from "../../../../src/shared/inheritanceBasis.ts";
import type { ACMGItem } from "./classifier.ts";

export interface CandidateFrequencyContext {
  curatedInheritance: CuratedInheritance | null;
  pli: number | null;
  skipPathogenicComp: boolean;
  skipBenignComp: boolean;
}

export function candidateFrequencyCriteria(
  candidates: ReadonlyArray<GnomadCandidateReading>,
  context: CandidateFrequencyContext,
): { criteria: ACMGItem[]; unavailable: string[] } {
  const FREQ = THRESHOLDS.populationFrequency;
  const ceiling = pm2CeilingFor(
    { inheritance: context.curatedInheritance, pli: context.pli },
    { recessiveCeiling: FREQ.extremelyRareRecessive, dominantCeiling: FREQ.extremelyRare, pliCut: FREQ.recessivePlI },
  );
  const verdict = decideCandidateFrequency(candidates, {
    standAloneBenign: FREQ.standAloneBenign, tooCommonForDisorder: FREQ.tooCommonForDisorder, pm2Ceiling: ceiling.ceiling,
  });
  const all = `every candidate allele (${candidates.length}: ${candidates.map(candidateAlleleLabel).join(", ")})`;
  const criteria: ACMGItem[] = [];
  const unavailable: string[] = [];

  if (verdict.kind === "failed") {
    unavailable.push(`GNOMAD_FREQUENCY (no reading for candidate allele ${verdict.failed.map(candidateAlleleLabel).join(", ")} — PM2, BS1 and BA1 withheld because they must hold for every candidate)`);
  } else if (verdict.kind === "mixed") {
    unavailable.push(`GNOMAD_FREQUENCY (the candidate alleles disagree: ${verdict.readings.map(r => `${candidateAlleleLabel(r.candidate)} ${r.decision === "none" ? "no criterion" : r.decision}`).join(", ")} — no frequency criterion applied)`);
  } else if (verdict.decision === "BA1") {
    criteria.push({ code: "BA1", reason: `Allele frequency is stand-alone benign for ${all}: each is above the ${(FREQ.standAloneBenign * 100).toFixed(1)}% cut-point on its own reading. Frequencies were not added together.` });
  } else if (verdict.decision === "BS1") {
    criteria.push({ code: "BS1", reason: `Allele frequency greater than expected for the disorder for ${all}: each is above the ${(FREQ.tooCommonForDisorder * 100).toFixed(1)}% app-defined cut-point on its own reading. Frequencies were not added together.` });
  } else if (verdict.decision === "PM2" && !context.skipPathogenicComp) {
    criteria.push({ code: "PM2", reason: `Variant is extremely rare in population databases for ${all}: each is at or below the ${(ceiling.ceiling * 100).toFixed(2)}% app-defined threshold (${ceiling.text}); absence from gnomAD counts as zero. Applied at Supporting strength (ClinGen SVI 2020, PM2_Supporting).` });
  }

  const bs2Genotype = homozygotesInformBs2({ variantId: candidates.find(c => c.id)?.id ?? null, inheritance: context.curatedInheritance });
  if (candidatesMeetBs2(candidates) && !context.skipBenignComp) {
    if (bs2Genotype.applies) {
      criteria.push({ code: "BS2", reason: `Observed in homozygous state in gnomAD for ${all}: each has two or more homozygotes. gnomAD does not phenotype its participants, and penetrance is not curated here.` });
    } else {
      unavailable.push(`BS2 (homozygote count not applied: ${bs2Genotype.reason})`);
    }
  }
  return { criteria, unavailable };
}
