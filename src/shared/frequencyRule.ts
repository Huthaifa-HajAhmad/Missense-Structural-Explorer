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

import type { AouFrequencyData } from './contracts.ts';

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

/**
 * BS1 and BS2 are NOT counted automatically (owner decision, 2026-11-20; HbS regression, missense#13).
 *
 * BS1 means "greater than expected for the DISORDER": it needs a condition-specific maximum credible
 * allele frequency (Whiffin 2017), and the app only has one app-wide cut-point. Counting it made
 * HbS (HBB p.Glu7Val, ClinVar Pathogenic) Benign: carrier frequency 4.8% in African ancestry sits far
 * above 1%, yet the allele is pathogenic in the homozygous state. BS2 needs individuals known to be
 * unaffected, and gnomAD does not phenotype its participants (40 homozygotes for HbS are not healthy
 * controls). The observed frequencies and counts stay visible; only the criteria are withheld.
 * `decideFrequencyCriterion` still reports 'BS1' meaning "above the app reference cut-point".
 */
export const BS1_COUNTED_AUTOMATICALLY = false;
export const BS2_COUNTED_AUTOMATICALLY = false;
export const BS1_NOT_APPLIED_REASON =
  'BS1 needs a condition-specific maximum credible allele frequency; the app-wide cut-point is not one, so it is shown as a reference and not counted';
export const BS2_NOT_APPLIED_REASON =
  'BS2 needs homozygous or hemizygous individuals documented as unaffected; gnomAD does not phenotype its participants, so the count is shown and not counted';

export function decideFrequencyCriterion(
  inputs: FrequencyRuleInputs,
  cut: { standAloneBenign: number; tooCommonForDisorder: number; pm2Ceiling: number },
): FrequencyDecision {
  if (inputs.benignAf > cut.standAloneBenign) return 'BA1';
  if (inputs.benignAf > cut.tooCommonForDisorder) return 'BS1';
  if (inputs.pm2Af <= cut.pm2Ceiling) return 'PM2';
  return 'none';
}

/**
 * PM2 holds: a frequency at or below the ceiling is still not "extremely rare" in the sense PM2 needs
 * (owner decision, 2026-11-26, after ABCG1 p.Gly358Arg was awarded PM2 with 6 homozygotes).
 *
 * • Two or more homozygotes on an autosome. At a combined frequency of 0.04% gnomAD would expect about
 *   0.1 homozygotes, so six say the allele is common somewhere the figure does not show. This only
 *   withholds pathogenic support; it never becomes BS2 (see BS2_COUNTED_AUTOMATICALLY).
 * • All of Us above the ceiling. PM2 asks about population databases, and All of Us is one; testing
 *   both against the ceiling is the same as testing the higher of the two.
 * • A combined-only figure (the local copy: no ancestry groups) within 10x of the ceiling. An
 *   ancestry group's frequency is often several times the combined one, so without the groups the
 *   figure cannot show the allele is below the ceiling in every group.
 */
export const PM2_HOMOZYGOTE_LIMIT = 2;
export const COMBINED_ONLY_PM2_MARGIN = 10;

export type Pm2Hold =
  | { kind: 'homozygotes'; count: number }
  | { kind: 'all-of-us'; af: number }
  | { kind: 'ancestry-unmeasured'; af: number; floor: number };

/** The All of Us allele frequency, AC / AN (the record carries counts only). Null without both. */
export function aouAlleleFrequency(aou: Pick<AouFrequencyData, 'aouAC' | 'aouAN'> | null | undefined): number | null {
  const ac = finite(aou?.aouAC);
  const an = finite(aou?.aouAN);
  return ac !== null && an !== null && an > 0 ? ac / an : null;
}

/** Why a PM2 decision must not be counted, or null when it stands. Read only after `decideFrequencyCriterion` says PM2. */
export function pm2Hold(
  inputs: FrequencyRuleInputs,
  context: { ceiling: number; nHomozygous?: number | null; homozygotesInform: boolean; aouAf?: number | null },
): Pm2Hold | null {
  const homozygotes = finite(context.nHomozygous);
  if (context.homozygotesInform && homozygotes !== null && homozygotes >= PM2_HOMOZYGOTE_LIMIT) {
    return { kind: 'homozygotes', count: homozygotes };
  }
  const aouAf = finite(context.aouAf);
  if (aouAf !== null && aouAf > context.ceiling) return { kind: 'all-of-us', af: aouAf };
  const floor = context.ceiling / COMBINED_ONLY_PM2_MARGIN;
  if (inputs.pm2Statistic === 'combined' && inputs.pm2Af > floor) return { kind: 'ancestry-unmeasured', af: inputs.pm2Af, floor };
  return null;
}

const percent = (value: number) => `${Number((value * 100).toPrecision(2))}%`;

/** The hold in one clause, shared by the engine's `unavailable` entry and the Population tab. */
export function pm2HoldReason(hold: Pm2Hold): string {
  switch (hold.kind) {
    case 'homozygotes':
      return `${hold.count} homozygotes observed in gnomAD, so the allele is not extremely rare; the count is not used as BS2`;
    case 'all-of-us':
      return `the All of Us frequency (${percent(hold.af)}) is above the PM2 ceiling`;
    case 'ancestry-unmeasured':
      return `the combined frequency ${percent(hold.af)} has no ancestry groups and is above ${percent(hold.floor)} (a tenth of the PM2 ceiling), so it cannot show the allele is rare in every group`;
  }
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
