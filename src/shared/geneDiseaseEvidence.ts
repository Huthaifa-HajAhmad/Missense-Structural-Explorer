/**
 * The Gene–disease tab's pure model. The tab and the inspector rail both render this and compute
 * nothing of their own.
 *
 * INVARIANTS
 *  - Context only: nothing here is an ACMG input, a score or a ranking of submitters. Validity levels
 *    are shown as submitted; the verdict says whether submitters AGREE, never which one wins.
 *  - Disagreement and dispute lead. "Disputed", "Refuted" and "No Known Disease Relationship" are
 *    adverse and dominate the finding (the external audit's rule); they never hide the rest.
 *  - Mechanism is bound to the disease–inheritance tuple (G2P records that match exactly), never to
 *    the bare gene. ClinGen dosage is gene-level. When the two point different ways the model says so
 *    in words; it does not pick one and does not infer a missense mechanism.
 *  - Absence is a state: not installed, loading, provider error, no record and "not curated" are
 *    different outcomes (ENGINE_STATE_LABELS vocabulary), and none is a negative finding.
 *
 * Defects this replaced: a disabled, empty selector as the first thing on the tab when GenCC was
 * missing; ClinGen score 0 drawn as a filled accent rung; "No Known Disease Relationship" neither
 * flagged nor placed; dosage and mechanism never compared.
 */
import { ADVERSE_LEVEL, buildGeneDiseaseEvidence, type DiseaseFrame, type GeneDiseaseResponse } from './diseaseFrame';
import { buildDosageEvidence, type DosageEvidence, type DosageReading, type DosageResponse } from './dosageSensitivity';
import { scopeMechanismRecords, type MechanismRecord } from './mechanismContext';
import { snapshotAge, type SnapshotAge } from './snapshotAge';
import { ENGINE_STATE_LABELS } from './engineStatus';

type Load<T> = { status: 'loading' | 'ready' | 'error'; data: T | null; error?: string } | undefined;
export const isAdverseLevel = (level: string) => ADVERSE_LEVEL.test(level.trim());
/** ClinGen submits through its expert panels (GCEPs); the badge says so without re-ranking it. */
export const isExpertPanel = (submitter: string) => /^ClinGen$/i.test(submitter.trim());

export type VerdictKind = 'loading' | 'adverse' | 'differ' | 'agree' | 'uncurated' | 'unselected' | 'unavailable';
export interface GeneDiseaseVerdict { kind: VerdictKind; label: string; tone: 'warning' | 'neutral' | 'muted' }
export interface AssertionRow {
  id: string; submitter: string; level: string; adverse: boolean; expertPanel: boolean;
  evaluatedAt: string | null; reportUrl: string | null;
}
export interface MechanismCrossCheck {
  state: 'compared' | 'not-comparable'; relation: 'consistent' | 'differs' | null; sentence: string; mechanisms: string[];
}
export interface SourceReading {
  source: string; available: boolean; label: string; reason: string | null; age: SnapshotAge | null; release: string | null;
}
export interface GeneDiseaseModel {
  gene: string; selected: DiseaseFrame | null; frameCount: number;
  verdict: GeneDiseaseVerdict; headline: string; headlineLabel: string; sentence: string;
  assertions: AssertionRow[]; submitters: string[]; latestAssertion: string | null; distinctLevels: string[];
  dosage: DosageEvidence; crossCheck: MechanismCrossCheck | null; mechanismRecords: MechanismRecord[];
  sources: { gencc: SourceReading; g2p: SourceReading; dosage: SourceReading };
  stale: SnapshotAge[];
}

const norm = (m: string) => m.trim().toLowerCase();

export function compareMechanism(dosage: DosageEvidence, records: MechanismRecord[]): MechanismCrossCheck | null {
  if (dosage.state !== 'ready' || !records.length) return null;
  const hi: DosageReading | undefined = dosage.readings.find(r => r.key === 'haploinsufficiency');
  const mechanisms = [...new Set(records.map(r => norm(r.mechanism)).filter(m => m && !m.startsWith('undetermined')))];
  const notComparable = (sentence: string): MechanismCrossCheck => ({ state: 'not-comparable', relation: null, sentence, mechanisms });
  if (!mechanisms.length) return notComparable('Gene2Phenotype records no determined mechanism for this disease, so it cannot be compared with ClinGen dosage.');
  if (hi?.code === 30) return notComparable('ClinGen curates this gene as associated with a recessive phenotype (score 30); heterozygous haploinsufficiency does not apply, so it is not compared with the Gene2Phenotype mechanism.');
  // 0 ("no evidence available") and 1 ("little evidence") are absence of evidence, not a finding: they can neither
  // corroborate gain of function nor contradict loss of function. Only 2, 3 (established) and 40 (unlikely) are compared.
  if (!hi || hi.code === null || hi.code === 0 || hi.code === 1) return notComparable(hi?.code === null || !hi
    ? 'ClinGen has no scored haploinsufficiency call to compare with the Gene2Phenotype mechanism.'
    : `ClinGen reports ${hi.code}: ${hi.call.replace(/^\d+:\s*/, '').toLowerCase()} for haploinsufficiency. That is absence of evidence, not a finding, so it is not compared with the Gene2Phenotype mechanism (${mechanisms.join(' and ')}).`);
  const lof = mechanisms.includes('loss of function');
  const other = mechanisms.some(m => m === 'gain of function' || m === 'dominant negative');
  if (lof === other) return notComparable(`Gene2Phenotype lists ${mechanisms.join(' and ')} for this disease; a single comparison with ClinGen haploinsufficiency would be misleading.`);
  const established = hi.code === 3 || hi.code === 2; // here code is 2, 3 or 40
  const call = `${hi.code}: ${hi.call.replace(/^\d+:\s*/, '').toLowerCase()}`;
  const mech = mechanisms.join(' and ');
  const base = { state: 'compared' as const, mechanisms };
  if (lof && established) return { ...base, relation: 'consistent', sentence: `ClinGen haploinsufficiency (${call}) and Gene2Phenotype (${mech}) point the same way for this disease.` };
  if (lof) return { ...base, relation: 'differs', sentence: `Gene2Phenotype records ${mech} for this disease, but ClinGen does not establish haploinsufficiency (${call}). Each source is shown as submitted.` };
  if (established) return { ...base, relation: 'differs', sentence: `ClinGen reports haploinsufficiency (${call}), while Gene2Phenotype records ${mech} for this disease. A gene can have more than one disease mechanism; neither source is overridden.` };
  return notComparable(`ClinGen reports ${call} for haploinsufficiency. This does not establish or corroborate the Gene2Phenotype mechanism (${mech}); gain of function and dominant negative require their own evidence.`);
}

interface SnapshotLike { status: string; provenance: { retrievedAt: string; release: string | null } | null; message?: string | null }
function snapshotReading(name: string, load: Load<SnapshotLike>, now: Date, what: string): SourceReading {
  const data = load?.data;
  if (data?.status === 'ready') {
    return { source: name, available: true, label: 'Available', reason: null, release: data.provenance?.release ?? null,
      age: data.provenance ? snapshotAge(name, data.provenance.retrievedAt, now) : null };
  }
  const failed = load?.status === 'error' || data?.status === 'error';
  const label = !load || load.status === 'loading' ? ENGINE_STATE_LABELS.running : failed ? ENGINE_STATE_LABELS['upstream-error'] : ENGINE_STATE_LABELS['not-installed'];
  const reason = load?.status === 'error' ? load.error ?? data?.message ?? null
    : failed ? data?.message ?? null
    : data?.status === 'not-installed' ? `${what} is not installed on this server and could not be fetched.` : null;
  return { source: name, available: false, label, reason, release: null, age: null };
}

export function buildGeneDiseaseModel(input: {
  gene: string; disease: Load<GeneDiseaseResponse>; selectedKey: string | null; dosage: Load<DosageResponse>; now?: Date;
}): GeneDiseaseModel {
  const now = input.now ?? new Date();
  const data = input.disease?.data ?? null;
  const base = buildGeneDiseaseEvidence(data, input.selectedKey);
  const dosage = buildDosageEvidence(input.dosage, base.selected?.diseaseId ?? null);
  const mech = data?.mechanismContext;
  const sources = {
    gencc: snapshotReading('GenCC', input.disease, now, 'The GenCC snapshot'),
    g2p: snapshotReading('Gene2Phenotype', mech ? { status: 'ready', data: mech } : input.disease ? { status: input.disease.status, data: null, error: input.disease.error } : undefined, now, 'The Gene2Phenotype snapshot'),
    dosage: { source: 'ClinGen dosage', available: dosage.state === 'ready',
      label: dosage.state === 'ready' ? 'Available' : dosage.state === 'not-found' ? ENGINE_STATE_LABELS['no-result'] : dosage.state === 'error' ? ENGINE_STATE_LABELS['upstream-error'] : ENGINE_STATE_LABELS.running,
      reason: dosage.message ?? input.dosage?.error ?? null, age: null, release: null } as SourceReading,
  };
  const frames = data?.frames ?? [];
  const assertions: AssertionRow[] = base.assertions.map(a => ({ id: a.id, submitter: a.submitter, level: a.level, adverse: isAdverseLevel(a.level),
    expertPanel: isExpertPanel(a.submitter), evaluatedAt: a.evaluatedAt?.slice(0, 10) ?? null, reportUrl: a.reportUrl }));
  const levels = [...new Set(assertions.map(a => a.level))];
  const submitters = [...new Set(assertions.map(a => a.submitter))];
  const latestAssertion = assertions.map(a => a.evaluatedAt).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const adverse = assertions.some(a => a.adverse);
  const records = base.selected && mech?.status === 'ready' ? scopeMechanismRecords(mech.records, base.selected).matching : [];
  const short = (level: string) => level.replace(/ evidence$/i, '');

  let verdict: GeneDiseaseVerdict; let headline: string; let headlineLabel = ''; let sentence: string;
  if (input.disease?.status === 'loading' || !input.disease) {
    verdict = { kind: 'loading', label: ENGINE_STATE_LABELS.running, tone: 'muted' };
    headline = 'Reading sources'; headlineLabel = '';
    sentence = 'Disease-level validity is being read. ClinGen dosage below is gene-level and loads separately.';
  } else if (!sources.gencc.available && !frames.length) {
    verdict = { kind: 'unavailable', label: `GenCC ${sources.gencc.label.toLowerCase()}`, tone: 'muted' };
    headline = 'Gene-level evidence only';
    sentence = 'Disease-specific validity needs the GenCC snapshot, which is not available here. ClinGen dosage below is gene-level and does not depend on it.';
  } else if (!base.selected) {
    verdict = frames.length ? { kind: 'unselected', label: 'Choose a disease', tone: 'neutral' } : { kind: 'unselected', label: 'No curated disease', tone: 'muted' };
    headline = frames.length ? `${frames.length} disease–inheritance frame${frames.length === 1 ? '' : 's'}` : 'None listed';
    headlineLabel = frames.length ? 'curated for this gene by the installed sources' : '';
    sentence = frames.length
      ? 'Validity, mechanism and variant context are scoped to one disease and inheritance. Choose one to read them.'
      : 'The installed snapshot lists no disease for this exact gene symbol. That does not establish the absence of a disease relationship.';
  } else if (adverse) {
    const bad = assertions.filter(a => a.adverse).map(a => `${a.submitter} (${short(a.level)})`);
    verdict = { kind: 'adverse', label: 'Disputed, refuted or no known relationship', tone: 'warning' };
    headline = `${bad.length} of ${assertions.length}`;
    headlineLabel = `assertion${assertions.length === 1 ? '' : 's'} dispute or reject this relationship`;
    sentence = `${bad.join('; ')}. Computational and structural context cannot establish pathogenicity for a disease whose gene relationship is contested; read every assertion below.`;
  } else if (!assertions.length) {
    verdict = { kind: 'uncurated', label: 'No validity assertion', tone: 'muted' };
    headline = 'Not curated'; headlineLabel = `by GenCC for ${base.selected.label}`;
    sentence = `The disease choice comes from ${base.selected.selectionSource ?? 'GenCC'}. Missing validity coverage does not refute the relationship.`;
  } else if (levels.length > 1) {
    verdict = { kind: 'differ', label: 'Validity levels differ', tone: 'neutral' };
    headline = `${submitters.length} submitter${submitters.length === 1 ? '' : 's'}`; headlineLabel = `${submitters.length === 1 ? 'reports' : 'report'} ${levels.length} different validity levels`;
    sentence = `${levels.map(short).join(', ')}. Disagreement between curators is evidence in itself: levels are shown as submitted and never averaged.`;
  } else {
    verdict = { kind: 'agree', label: submitters.length > 1 ? `Submitters agree: ${short(levels[0])}` : `Single submitter: ${short(levels[0])}`, tone: 'neutral' };
    headline = short(levels[0]); headlineLabel = `${submitters.length} submitter${submitters.length === 1 ? '' : 's'}: ${submitters.join(', ')}`;
    sentence = 'Gene–disease validity describes the relationship; it does not classify this variant.';
  }
  const stale = [sources.gencc.age, sources.g2p.age].filter((a): a is SnapshotAge => !!a && a.stale);
  return { gene: input.gene, selected: base.selected, frameCount: frames.length, verdict, headline, headlineLabel, sentence,
    assertions, submitters, latestAssertion, distinctLevels: levels, dosage, crossCheck: compareMechanism(dosage, records), mechanismRecords: records, sources, stale };
}
