/**
 * Expression & models: the one-line reading the tab and its inspector both render.
 *
 * The tab's question is "where is this gene measured, and which of the reviewer's systems does
 * that measurement not reach?" — not an ACMG question. So the finding is a coverage-aware
 * description, never a classification.
 *
 * INVARIANTS
 *  - No expression cut-point. "Expressed" / "not expressed" is never said: the finding quotes the
 *    measured median, its rank among the tissues GTEx sampled, and what was not sampled.
 *  - A system GTEx does not sample is a coverage gap, never a low reading.
 *  - A zero median is a measurement and is reported as one.
 *  - Review systems are the reviewer's choice; the local grouping is not an HPO-to-anatomy mapping.
 *  - Nothing here adds or changes an ACMG criterion.
 *
 * Replaced: a stack of eleven cards with no summary, where the answer to "is my system covered?"
 * had to be assembled from a gap list, a table and a footnote.
 */
import { buildAdultExpressionEvidence, tissueMatchesSystem, type AdultExpressionResponse, type TissueExpression } from './expressionModels.ts';
import { REVIEW_SYSTEMS, type ReviewSystemId } from './phenotypeFrame.ts';

/** What a reviewer should read into "not sampled": the anatomy GTEx has no tissue for. */
export const UNSAMPLED_ANATOMY: Partial<Record<ReviewSystemId, string>> = {
  skeletal: 'bone and growth-plate cartilage', hearing: 'cochlea', vision: 'retina and ocular structures',
};
const systemLabel = (id: ReviewSystemId) => REVIEW_SYSTEMS.find(s => s.id === id)?.label ?? id;

export type LoadState = 'loading' | 'error' | 'not-found' | 'ready';
export type SystemCoverage = { id: ReviewSystemId; label: string; state: 'measured' | 'no-reading' | 'not-sampled'; top: { label: string; value: number | null } | null };
export type ExpressionFinding = {
  state: LoadState | 'no-values';
  /** The one figure: the highest measured median in scope, TPM. Null when there is none. */
  figure: number | null;
  figureLabel: string | null;
  headline: string;
  predicate: string;
  coverage: SystemCoverage[];
  sampledTissues: number;
  /** Rank of the figure among sampled tissues; ties share the better rank. */
  rank: number | null;
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
function rankOf(value: number, tissues: TissueExpression[]) {
  return 1 + tissues.filter(t => t.value !== null && t.value > value).length;
}

export function buildExpressionFinding(data: AdultExpressionResponse | null, loadState: 'loading' | 'error' | 'ready' | null, systems: ReviewSystemId[]): ExpressionFinding {
  const base = { figure: null, figureLabel: null, coverage: [] as SystemCoverage[], sampledTissues: 0, rank: null };
  if (!loadState || loadState === 'loading') return { ...base, state: 'loading', headline: 'Reading GTEx', predicate: 'Tissue medians are being read.' };
  if (loadState === 'error' || data?.status === 'error') return { ...base, state: 'error', headline: 'GTEx could not be read', predicate: 'Retry below. This is a provider fault, not a finding about the gene.' };
  if (!data || data.status === 'not-found') return { ...base, state: 'not-found', headline: 'No gene reading in GTEx', predicate: 'This is not evidence that the gene is unexpressed.' };
  const measured = data.tissues.filter(t => t.value !== null);

  const { relevant, gaps } = buildAdultExpressionEvidence(data, systems);
  const best = (list: TissueExpression[]) => list.filter(t => t.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0] ?? null;
  const coverage: SystemCoverage[] = systems.map(id => {
    const tissues = data.tissues.filter(t => tissueMatchesSystem(t.id, id));
    const top = best(tissues);
    return { id, label: systemLabel(id), state: top ? 'measured' : tissues.length ? 'no-reading' : 'not-sampled', top: top ? { label: top.label, value: top.value } : null };
  });
  const sampledTissues = measured.length;
  if (!measured.length) return { ...base, coverage, state: 'no-values', sampledTissues: 0, headline: 'No tissue median reported', predicate: 'GTEx returned the gene without values. Returned tissues remain distinct from unsampled systems.' };

  if (!systems.length) {
    const top = best(data.tissues)!;
    return { state: 'ready', figure: top.value, figureLabel: `${top.label} · highest of ${sampledTissues} sampled adult tissues`, rank: 1, coverage, sampledTissues,
      headline: `Highest in ${top.label}`, predicate: 'Choose review systems to see how your tissues of interest are covered.' };
  }
  const top = best(relevant);
  const covered = coverage.filter(c => c.state === 'measured').length;
  const gapText = gaps.length ? ` GTEx has no tissue for ${gaps.map(g => UNSAMPLED_ANATOMY[g] ?? `${systemLabel(g).toLowerCase()} (no tissue in the local grouping)`).join('; ')}: that is a coverage limit, not a low reading.` : '';
  if (!top) {
    return { state: 'ready', figure: null, figureLabel: null, rank: null, coverage, sampledTissues,
      headline: relevant.length ? 'No gene reading in your sampled review systems' : `GTEx samples none of your ${systems.length === 1 ? 'review system' : `${systems.length} review systems`}`,
      predicate: `Nothing here can be read for them.${gapText}` };
  }
  const rank = rankOf(top.value!, data.tissues);
  return { state: 'ready', figure: top.value, figureLabel: `${top.label} · rank ${rank} of ${sampledTissues} sampled tissues`, rank, coverage, sampledTissues,
    headline: `Measured in ${covered} of ${systems.length} review ${systems.length === 1 ? 'system' : 'systems'}`,
    predicate: `Highest in your systems: ${top.label}, median ${fmt(top.value!)} TPM${top.value === 0 ? ' (a measured zero)' : ''}.${gapText}` };
}

export type SourceFact = { key: string; label: string; value: string; sub: string; tone: 'ok' | 'muted' };
type Slot<T> = { status: 'loading' | 'error' | 'ready'; data: T | null } | undefined;

/** Four source readings beside the finding. Every state is stated; none is shown as a blank. */
export function buildSourceFacts(input: {
  adult: ExpressionFinding;
  developmental: Slot<{ status: string; counts: { includedSamples: number; includedDonors: number } | null }>;
  hpa: Slot<{ status: string; rna: { specificity: string | null } | null; protein: { evidence: string | null } | null }>;
  pext: { load: 'loading' | 'error' | 'ready' | null; status: string | null; region: { mean: number | null; tissues: number } | null; locationNote: string | null };
}): SourceFact[] {
  const state = (s: Slot<unknown>, noun: string, installNoun?: string) => {
    if (!s || s.status === 'loading') return { value: 'Running', sub: `Reading ${noun}.` };
    if (s.status === 'error') return { value: 'Provider error', sub: `${noun} could not be read.` };
    const status = (s.data as { status?: string } | null)?.status;
    if (status === 'not-installed') return { value: 'Not available here', sub: `${installNoun ?? noun} is not installed.` };
    if (status === 'not-found') return { value: 'No result', sub: `Nothing for this gene in ${noun}.` };
    return null;
  };
  const adult = input.adult;
  const dev = state(input.developmental, 'dGTEx', 'A dGTEx snapshot');
  const hpa = state(input.hpa, 'the Protein Atlas');
  const counts = input.developmental?.data?.counts;
  const pext = input.pext;
  return [
    { key: 'adult', label: 'Adult tissues', tone: adult.state === 'ready' ? 'ok' : 'muted',
      value: adult.state === 'ready' ? `${adult.sampledTissues} sampled` : adult.state === 'loading' ? 'Running' : adult.state === 'error' ? 'Provider error' : 'No result',
      sub: 'GTEx bulk RNA-seq medians' },
    { key: 'pediatric', label: 'Pediatric', tone: dev ? 'muted' : 'ok',
      value: dev ? dev.value : `${counts?.includedSamples ?? 0} samples`, sub: dev ? dev.sub : `${counts?.includedDonors ?? 0} donors, dGTEx public cohorts` },
    { key: 'hpa', label: 'Protein Atlas', tone: hpa ? 'muted' : 'ok',
      value: hpa ? hpa.value : input.hpa?.data?.rna?.specificity ?? 'Not reported', sub: hpa ? hpa.sub : input.hpa?.data?.protein?.evidence ?? 'Protein evidence level not reported' },
    { key: 'pext', label: 'At the variant', tone: pext.region ? 'ok' : 'muted',
      value: pext.region ? (pext.region.mean === null ? 'No value' : `pext ${pext.region.mean.toFixed(2)}`)
        : pext.load === 'ready' && pext.status === 'ready' ? 'Not placed' : pext.load === 'error' ? 'Provider error' : pext.load === 'ready' ? 'No result' : 'Running',
      sub: pext.region ? `Base-level, mean of ${pext.region.tissues} tissues` : pext.locationNote ?? 'Base-level pext for the coding region' },
  ];
}
