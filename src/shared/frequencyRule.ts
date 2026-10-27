/**
 * frequencyRule.ts — the BA1 / BS1 / PM2 decision, shared by the rule engine
 * (`server/services/prediction/acmg/criteria.ts`) and every surface that explains it
 * (`frequencyEvidence.ts`). Two implementations of one rule disagree on screen; this is the one.
 *
 * WHICH NUMBER EACH CRITERION READS
 * ---------------------------------
 * • BA1 and BS1 (benign) read gnomAD's FILTERING allele frequency, FAF95 — the lower bound of the
 *   95% CI of the highest grpmax-group frequency — when the record carries it. That is ClinGen SVI's
 *   recommendation for BA1 (Ghosh et al. 2018, doi:10.1002/humu.23642) and the conservative
 *   direction for benign evidence: a few chance copies in a small group cannot make a variant
 *   "common". Without FAF95 they read the grouped maximum, as before.
 * • PM2 (pathogenic) reads the RAW grouped maximum (or the global maximum, or a confirmed absence as
 *   0). The raw AF is never below FAF95, so it is the conservative direction for pathogenic evidence.
 *
 * Branch order, unchanged: BA1, then BS1, then PM2 at or below the ceiling, else no criterion. The
 * band between PM2's ceiling and BS1 yields nothing rather than a fabricated code.
 *
 * Pure.
 */

export type FrequencyStatistic = 'faf95' | 'group-max' | 'combined' | 'global' | 'absent' | 'clinvar';

export interface FrequencyRuleInputs {
  /** The frequency PM2 is tested on. */
  pm2Af: number;
  pm2Statistic: FrequencyStatistic;
  /** The frequency BA1 and BS1 are tested on. */
  benignAf: number;
  benignStatistic: FrequencyStatistic;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The two inputs from a gnomAD record. `combined` marks the local dbNSFP ingest, which has no
 * ancestry groups: its `groupMaxAF` is the exome + genome combined AF.
 */
export function gnomadRuleInputs(g: {
  groupMaxAF?: number | null; maxAF?: number | null; faf95?: number | null; dataset?: string | null; groupMaxAFIsFallback?: boolean;
} | null | undefined): FrequencyRuleInputs | null {
  if (!g) return null;
  const combined = g.dataset === 'gnomad_r4_local';
  const grouped = finite(g.groupMaxAF);
  const global = finite(g.maxAF);
  const pm2Af = grouped ?? global;
  if (pm2Af === null) return null;
  const pm2Statistic: FrequencyStatistic = combined ? 'combined' : grouped !== null && !g.groupMaxAFIsFallback ? 'group-max' : 'global';
  const faf = combined ? null : finite(g.faf95);
  return faf !== null
    ? { pm2Af, pm2Statistic, benignAf: faf, benignStatistic: 'faf95' }
    : { pm2Af, pm2Statistic, benignAf: pm2Af, benignStatistic: pm2Statistic };
}

/** One frequency used for both (a confirmed absence, a ClinVar-submitted value). */
export function singleRuleInput(af: number, statistic: FrequencyStatistic): FrequencyRuleInputs {
  return { pm2Af: af, pm2Statistic: statistic, benignAf: af, benignStatistic: statistic };
}

export type FrequencyDecision = 'BA1' | 'BS1' | 'PM2' | 'none';

export function decideFrequencyCriterion(
  inputs: FrequencyRuleInputs,
  cut: { standAloneBenign: number; tooCommonForDisorder: number; pm2Ceiling: number },
): FrequencyDecision {
  if (inputs.benignAf > cut.standAloneBenign) return 'BA1';
  if (inputs.benignAf > cut.tooCommonForDisorder) return 'BS1';
  if (inputs.pm2Af <= cut.pm2Ceiling) return 'PM2';
  return 'none';
}

/** How each statistic is named in sentences and traces. */
export const STATISTIC_LABEL: Record<FrequencyStatistic, string> = {
  faf95: 'gnomAD filtering allele frequency (FAF95)',
  'group-max': 'gnomAD ancestry-grouped maximum',
  combined: 'gnomAD combined frequency',
  global: 'gnomAD global maximum',
  absent: 'gnomAD — no record',
  clinvar: 'ClinVar-submitted frequency',
};
