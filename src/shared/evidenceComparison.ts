/** Presentation-only chart models. INVARIANTS: never classify, normalise unlike scores,
 * place zero on a log axis, or turn an absent attribution into zero. Filters do not
 * change domains, shares, engine records or the underlying evidence. */
import { formatCount, frequencyObservationName, observationAbsence, populationReading, type FrequencyEvidence } from './frequencyEvidence';
import { AVI_FEATURES, AVI_GROUP_LABEL, fmtShare, type AlphaGenomeEvidence, type AviFeatureGroup } from './alphagenomeEvidence';
import { CAVEAT_TEXT, type PredictorEvidence } from './predictorEvidence';
import type { LadderEvidence } from './ladderEvidence';
import { formatEvidenceCode } from './thresholds';

export type EvidenceWorkspaceTab = 'clinical' | 'predictors' | 'alphagenome' | 'gene-disease' | 'expression-models' | 'species-models' | 'structure' | 'perturbation' | 'function' | 'splicing' | 'interfaces';
export interface EvidenceChartRow {
  /** Educational topic only; never changes a reading or the engine's recorded interpretation. */
  knowledgeKey?: string;
  key: string; name: string; value: number | null; valueText: string; description: string;
  group: string; tone: 'accent' | 'neutral' | 'danger' | 'good';
  facts: { label: string; value: string }[]; notes: string[];
  counted?: boolean;
  /** Optional second line beside a plotted value; never inferred from a different source. */
  contextText?: string;
}
export interface EvidenceChartModel {
  rows: EvidenceChartRow[]; domain: [number, number]; ticks: number[];
  axisLabel: string; tickLabels: string[]; summary: string;
  /** What a reading with no plotted value is called, and what that means — the model's words, so the
   * generic renderer carries no tab-specific interpretation. */
  unplottedHeading: string;
  unplottedBody: string;
  /** The figure's honest empty state, when nothing at all can be plotted. */
  emptyCopy: string;
}

/** One unit across the frequency chart: never mix fractions and percentages on its axis. */
export function formatFrequencyPercent(af: number): string {
  if (af === 0) return '0%';
  const pct = af * 100;
  return `${pct < .001 ? pct.toExponential(2) : Number(pct.toPrecision(4))}%`;
}

export function buildPopulationComparison(evidence: FrequencyEvidence): EvidenceChartModel {
  const rows: EvidenceChartRow[] = evidence.observations.map(o => ({
    knowledgeKey: 'allele_frequency', key: o.key, name: frequencyObservationName(o),
    value: o.availability.state === 'available' && o.af !== null && o.af > 0 ? Math.log10(o.af) : null,
    valueText: o.af !== null ? formatFrequencyPercent(o.af)
      : evidence.criterion.absent && o.id.startsWith('gnomad') ? 'No variant record returned'
      : o.availability.state === 'no-result' ? 'No frequency returned' : o.availability.label ?? 'No frequency',
    description: o.af === null ? observationAbsence(o) : o.af === 0 ? 'A reported frequency of zero. Zero has no position on a logarithmic axis.' : 'Reported allele frequency in this source.',
    group: o.id, tone: 'neutral',
    contextText: o.ac !== null || o.an !== null ? `AC ${formatCount(o.ac)} · AN ${formatCount(o.an)}` : undefined,
    facts: [{ label: 'Allele count (AC)', value: formatCount(o.ac) }, { label: 'Alleles assessed (AN)', value: formatCount(o.an) },
      { label: 'Frequency (AF)', value: o.af === null ? 'Not reported' : `${formatFrequencyPercent(o.af)} (${o.af} as a fraction)` },
      { label: 'Dataset', value: o.dataset }, { label: 'Homozygotes', value: formatCount(o.homozygotes) }, { label: 'Heterozygotes', value: formatCount(o.heterozygotes) }],
    notes: ['AC counts copies of the allele; AN counts assessed alleles, not people. Sources can overlap and must not be added together.'],
  }));
  const c = evidence.criterion;
  if (c.af !== null) rows.push({
    knowledgeKey: 'population', key: 'frequency-rule-input', name: 'Engine frequency input',
    value: !c.absent && c.af > 0 ? Math.log10(c.af) : null,
    valueText: c.absent ? 'Not observed' : formatFrequencyPercent(c.af),
    description: c.absent ? 'Confirmed absence was read by the engine. This is not a measured frequency of zero.' : populationReading(evidence).ruleSource,
    group: 'rule', tone: 'accent',
    contextText: 'Rule input · not a cohort',
    facts: [{ label: 'Input source', value: c.absent ? 'Confirmed gnomAD absence' : populationReading(evidence).ruleSource },
      { label: 'Engine record', value: evidence.applied.known ? evidence.applied.code ?? 'No frequency criterion' : 'Not recorded' }],
    notes: [c.statement, 'This is the input used by the rule, not an additional cohort. A grouped maximum need not equal a dataset-wide frequency.'],
  });
  const values = rows.flatMap(r => r.value === null ? [] : [r.value]);
  const lo = values.length ? Math.min(...values.map(v => Math.floor(v))) : -6;
  const hi = values.length ? Math.max(lo + 1, ...values.map(v => Math.ceil(v))) : -2;
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  const ticks = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  return { rows, domain: [lo - .3, hi + .3], ticks,
    tickLabels: ticks.map(v => formatFrequencyPercent(10 ** v)), axisLabel: 'Allele frequency (%) · logarithmic scale',
    unplottedHeading: 'Not plotted',
    unplottedBody: 'Zero and unavailable frequencies cannot sit on a log axis. Their states remain distinct.',
    emptyCopy: 'No values can be plotted on this axis. Inspect the available records below.',
    summary: `${values.length} positive frequency readings. Equal steps on this axis represent multiplicative changes. Zero and unavailable readings are listed separately. The engine input is distinguished from source observations.` };
}

export function buildPredictorComparison(evidence: PredictorEvidence, ladder: LadderEvidence): EvidenceChartModel {
  const rows: EvidenceChartRow[] = evidence.readings.map(r => {
    const calibrated = ladder.ladder.find(l => l.key === r.key);
    const at = calibrated?.at == null || r.cutpoints.bands.length === 0 ? -1 : ladder.columns.findIndex(c => c.id === calibrated.at);
    return { key: r.key, name: r.name, value: at < 0 ? null : at, valueText: r.scoreText,
      description: r.description, group: r.cutpoints.kind, counted: r.votes, knowledgeKey: r.knowledgeKey ?? undefined,
      tone: r.callTone === 'muted' ? 'neutral' : r.callTone,
      facts: [{ label: 'Raw score', value: `${r.scoreText}${r.unit ? ` ${r.unit}` : ''}` },
        { label: 'Reading', value: formatEvidenceCode(r.callLabel) }, { label: 'Engine use', value: r.votes ? 'Included in the voting rule' : 'Informational · not counted' },
        { label: 'Cut-point source', value: r.cutpoints.source ?? 'No published cut-point' }, { label: 'Score source', value: r.source }],
      notes: [r.note, r.availability.reason, ...r.caveats.map(c => CAVEAT_TEXT[c].detail),
        ...(calibrated?.cutLines ?? []),
        r.cutpoints.kind === 'authors' ? 'The authors’ cut-point gives a direction, not a calibrated evidence strength.' : null,
        'Predictors may share inputs and training data. Their strengths must not be added as independent evidence.'].filter((s): s is string => Boolean(s)),
    };
  });
  return { rows, domain: [-.5, ladder.columns.length - .5], ticks: ladder.columns.map((_, i) => i),
    tickLabels: ladder.columns.map(c => c.direction ? `${c.direction} ${c.label === 'Very strong' ? 'V. strong' : c.label}` : 'Neither'),
    axisLabel: 'Published evidence-strength bands · separate categories, not raw scores',
    unplottedHeading: 'Outside the calibrated comparison',
    unplottedBody: 'These tools have no calibrated strength to plot, or no returned score. Select one to inspect its own scale and status.',
    emptyCopy: 'No values can be plotted on this axis. Inspect the available records below.',
    summary: 'Each dot shows the published calibrated band reached by one predictor. Direction-only and uncalibrated tools remain inspectable below. These individual readings are not additional engine criteria.' };
}

export type AttributionFilter = 'all' | AviFeatureGroup;
/** Keep small non-zero contributions visible; the inspector retains all supplied digits. */
export function formatAttributionValue(value: number): string {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  return `${value > 0 ? '+' : '−'}${magnitude < .001 ? magnitude.toExponential(2) : Number(magnitude.toPrecision(5)).toString()}`;
}
export function buildAttributionComparison(evidence: AlphaGenomeEvidence, filter: AttributionFilter = 'all'): EvidenceChartModel {
  const supplied = evidence.groups?.flatMap(g => g.rows) ?? [];
  const all = AVI_FEATURES.map(def => supplied.find(r => r.id === def.id) ?? { ...def, shap: null, share: null });
  const max = Math.max(...all.map(r => Math.abs(r.shap ?? 0)));
  const bound = max > 0 ? max * 1.15 : 1;
  const rows: EvidenceChartRow[] = all.filter(r => filter === 'all' || r.group === filter)
    .sort((a, b) => (b.shap === null ? -1 : Math.abs(b.shap)) - (a.shap === null ? -1 : Math.abs(a.shap)))
    .map(r => ({ knowledgeKey: 'shap', key: r.id, name: r.name, value: r.shap, valueText: r.shap === null ? 'Not attributed' : formatAttributionValue(r.shap),
      description: r.description, group: r.group, tone: r.group === 'molecular' ? 'accent' : 'neutral',
      facts: [{ label: 'Feature family', value: AVI_GROUP_LABEL[r.group] },
        { label: 'Signed contribution', value: r.shap === null ? 'Not attributed' : String(r.shap) },
        { label: 'Share of reported magnitude', value: r.share === null ? 'Not defined' : fmtShare(r.share) }],
      notes: [r.shap === null ? 'No contribution was returned for this feature. Missing does not mean zero.' : r.shap === 0 ? 'The returned contribution is zero.' : `This contribution ${r.shap > 0 ? 'raises' : 'lowers'} the raw AVI score. Its sign does not tell you whether gene expression or another biological activity increases or decreases.`,
        r.group === 'molecular' ? 'The input summarises a predicted molecular effect across biosamples. This attribution alone does not identify the affected tissue or establish a disease mechanism.' : r.group === 'coding' ? 'AlphaMissense is also shown on Predictors. It is not an independent confirmation of that score.' : r.group === 'conservation' ? 'Conservation describes evolutionary constraint. This is the same kind of evidence as other conservation scores, not necessarily the same measurement.' : 'This input describes the variant type; it is not a measured molecular effect.',
        'Share uses the absolute contributions returned in this payload. It is neither a percentage of disease risk nor a fraction of the signed raw score.'],
    }));
  const reported = all.filter(r => r.shap !== null).length;
  const ticks = [-max, 0, max].filter((v, i, a) => a.indexOf(v) === i);
  /**
   * Three absence states, in the Atlas's own words: not assessed (nothing was queried), assessed
   * without a feature vector (the score arrived, the attributions did not), and assessed with a
   * vector. The old single summary asserted "0 of 18 returned" for an unassessed variant — the
   * Atlas never answered, so nothing "returned".
   */
  const summary = !evidence.assessed
    ? 'No AlphaGenome impact score was assessed for this variant, so no contributions were queried. This absence is not a reading; the finding card states the reason and remedy.'
    : evidence.groups === null
      ? 'The score arrived without its feature contributions, so none can be read here. A missing attribution is not a zero.'
      : `${reported} of ${all.length} feature contributions returned. ${reported < all.length ? 'Attribution coverage is incomplete; shares describe only returned contributions. ' : ''}Left lowers the score; right raises it. A contribution explains the model score, not a proven biological mechanism.`;
  return { rows, domain: [-bound, bound], ticks, tickLabels: ticks.map(formatAttributionValue),
    axisLabel: 'Contribution to the raw AVI score (SHAP units)',
    unplottedHeading: 'Not plotted',
    unplottedBody: 'A missing attribution is not a contribution of zero.',
    emptyCopy: !evidence.assessed
      ? 'No AlphaGenome assessment was made for this variant, so there is nothing to plot. The finding card states the reason and remedy.'
      : 'The score arrived without its feature contributions, so none can be plotted.',
    summary };
}
