import { describe, expect, it } from 'vitest';
import { buildGeneDiseaseModel, compareMechanism, isAdverseLevel } from '../geneDiseaseEvidence';
import { buildDosageEvidence, parseDosageScore, DOSAGE_CODE_LABELS, type DosageResponse } from '../dosageSensitivity';
import { snapshotAge } from '../snapshotAge';
import type { GeneDiseaseResponse } from '../diseaseFrame';
import type { MechanismRecord } from '../mechanismContext';

const NOW = new Date('2026-10-07T12:00:00Z');
const provenance = (source: string, retrievedAt: string) => ({ source, url: 'https://example.org', licence: 'CC0', release: null, retrievedAt, sha256: 'a'.repeat(64) });
const validity = (rows: Array<[string, string]>) => rows.map(([submitter, level], i) => ({ id: String(i), level, submitter, submitterId: String(i), evaluatedAt: '2023-06-02 16:48:04', reportUrl: null }));
const frame = (rows: Array<[string, string]>) => ({ key: 'HGNC:1|MONDO:7103|HP:6', geneId: 'HGNC:1', geneSymbol: 'SOD1', diseaseId: 'MONDO:0007103', label: 'amyotrophic lateral sclerosis type 1',
  xrefs: [], inheritance: { id: 'HP:0000006', label: 'Autosomal dominant' }, validity: validity(rows), mechanisms: [], suggestedSystems: [] });
const disease = (rows: Array<[string, string]>, mechanisms: MechanismRecord[] = [], retrievedAt = '2026-10-06T00:00:00Z'): GeneDiseaseResponse => ({
  gene: 'SOD1', status: 'ready', frames: [frame(rows)], provenance: provenance('GenCC', retrievedAt), message: null,
  mechanismContext: { status: 'ready', records: mechanisms, provenance: provenance('Gene2Phenotype', retrievedAt), message: null } });
const mech = (mechanism: string): MechanismRecord => ({ id: 'G2P1', geneId: 'HGNC:1', gene: 'SOD1', diseaseId: 'MONDO:0007103', diseaseLabel: 'ALS1', allelicRequirement: 'monoallelic_autosomal',
  modifier: '', confidence: 'definitive', mechanism, support: 'inferred', categorisation: '', evidence: '', consequence: '', variantTypes: '', publications: [], reviewedAt: null });
const dosage = (haplo: number | string | null, triplo: number | string | null = 0): DosageResponse => ({ gene: 'SOD1', status: 'ready', message: null, provenance: null,
  record: { symbol: 'SOD1', geneId: 'HGNC:11179', location: '21q22.11', evaluatedAt: '2026-08-11', reportUrl: 'https://search.clinicalgenome.org/kb/gene-dosage/HGNC:11179',
    haploinsufficiency: { ...parseDosageScore(haplo), disease: null, diseaseId: null, history: null }, triplosensitivity: { ...parseDosageScore(triplo), disease: null, diseaseId: null, history: null } } });
const model = (d: GeneDiseaseResponse | undefined, dos?: DosageResponse, key: string | null = 'HGNC:1|MONDO:7103|HP:6') => buildGeneDiseaseModel({ gene: 'SOD1',
  disease: d ? { status: 'ready', data: d } : undefined, selectedKey: key, dosage: dos ? { status: 'ready', data: dos } : undefined, now: NOW });

describe('verdict: agreement is reported, never a winner', () => {
  it('names a single shared level without ranking submitters', () => {
    const m = model(disease([['ClinGen', 'Definitive'], ['Labcorp', 'Definitive']]));
    expect(m.verdict).toMatchObject({ kind: 'agree', tone: 'neutral', label: 'Submitters agree: Definitive' });
    expect(m.assertions.find(a => a.submitter === 'ClinGen')?.expertPanel).toBe(true);
  });
  it('does not call one submitter a consensus', () => {
    const one = model(disease([['ClinGen', 'Definitive']]));
    expect(one.verdict.label).toBe('Single submitter: Definitive');
    const same = model(disease([['A', 'Strong'], ['A', 'Limited']]));
    expect(same.headline).toBe('1 submitter'); expect(same.headlineLabel).toBe('reports 2 different validity levels');
  });
  it('says it is reading, not unavailable, while the disease sources are still loading', () => {
    const m = buildGeneDiseaseModel({ gene: 'SOD1', disease: { status: 'loading', data: null }, selectedKey: null, dosage: undefined, now: NOW });
    expect(m.verdict).toMatchObject({ kind: 'loading', tone: 'muted' }); expect(m.sentence).not.toMatch(/not available/);
  });
  it('states disagreement as evidence and does not average', () => {
    const m = model(disease([['A', 'Strong'], ['B', 'Limited']]));
    expect(m.verdict.kind).toBe('differ'); expect(m.distinctLevels).toEqual(['Strong', 'Limited']);
  });
  it.each(['Disputed Evidence', 'Refuted Evidence', 'No Known Disease Relationship'])('%s dominates the finding with a warning', level => {
    const m = model(disease([['A', 'Strong'], ['B', level]]));
    expect(isAdverseLevel(level)).toBe(true);
    expect(m.verdict).toMatchObject({ kind: 'adverse', tone: 'warning' });
    expect(m.headline).toBe('1 of 2');
    expect(m.assertions.filter(a => a.adverse)).toHaveLength(1);   // the supportive row stays visible
  });
  it('is a statement, not an empty selector, when GenCC is not installed', () => {
    const m = buildGeneDiseaseModel({ gene: 'SOD1', disease: { status: 'ready', data: { gene: 'SOD1', status: 'not-installed', frames: [], provenance: null, message: null } }, selectedKey: null, dosage: undefined, now: NOW });
    expect(m.verdict.kind).toBe('unavailable'); expect(m.sources.gencc.available).toBe(false);
    expect(m.headline).toBe('Gene-level evidence only');
  });
  it('does not claim a GenCC readout when GenCC is missing but Gene2Phenotype supplied the disease choice', () => {
    // addVerifiedMechanismChoices appends G2P frames even when the GenCC snapshot is not installed:
    // an empty validity list must then read "snapshot unavailable", never "Not curated by GenCC".
    const g2pOnly: GeneDiseaseResponse = { gene: 'SOD1', status: 'not-installed', frames: [{ ...frame([]), selectionSource: 'Gene2Phenotype' }], provenance: null, message: null };
    const m = model(g2pOnly);
    expect(m.verdict).toMatchObject({ kind: 'unavailable', label: 'GenCC snapshot unavailable' });
    expect(m.verdict.label).not.toMatch(/not curated/i);
    expect(m.sentence).toMatch(/does not refute/);
  });
  it('asks for a disease before claiming anything', () => {
    expect(model(disease([['A', 'Strong']]), undefined, null).verdict.kind).toBe('unselected');
  });
  it('does not turn missing coverage into a refutation', () => {
    const m = model(disease([]));
    expect(m.verdict).toMatchObject({ kind: 'uncurated', tone: 'muted' }); expect(m.sentence).toMatch(/does not refute/);
  });
});

describe('snapshot age flag', () => {
  it('flags GenCC after 60 days and G2P after 90, as local policy, and never ClinGen', () => {
    expect(snapshotAge('GenCC', '2026-08-09T00:00:00Z', NOW)).toMatchObject({ days: 59, stale: false });
    expect(snapshotAge('GenCC', '2026-08-01T00:00:00Z', NOW)).toMatchObject({ stale: true, thresholdDays: 60 });
    expect(snapshotAge('Gene2Phenotype', '2026-07-15T00:00:00Z', NOW)?.stale).toBe(false);
    expect(snapshotAge('Gene2Phenotype', '2026-06-01T00:00:00Z', NOW)?.stale).toBe(true);
    expect(snapshotAge('ClinGen dosage', '2020-01-01T00:00:00Z', NOW)?.stale).toBe(false);
    expect(snapshotAge('GenCC', 'not a date', NOW)).toBeNull();
  });
  it('surfaces a stale snapshot in the model without changing the verdict', () => {
    const old = model(disease([['A', 'Strong']], [], '2026-05-01T00:00:00Z'));
    expect(old.stale.map(a => a.source)).toContain('GenCC');
    expect(old.verdict.kind).toBe('agree');
  });
});

describe('ClinGen score 0 and the mechanism cross-check', () => {
  it('reads 0 as no evidence available, not as tolerance', () => {
    expect(DOSAGE_CODE_LABELS[0]).toBe('No evidence available');
    expect(buildDosageEvidence({ status: 'ready', data: dosage(0) }, null).readings[0].call).toBe('0: No evidence available');
  });
  const ev = (h: number | null) => buildDosageEvidence({ status: 'ready', data: dosage(h) }, null);
  it('says ClinGen and G2P agree when both point to loss of function', () => {
    expect(compareMechanism(ev(3), [mech('loss of function')])).toMatchObject({ state: 'compared', relation: 'consistent' });
  });
  it('flags a difference in words when HI is established but G2P records gain of function', () => {
    const c = compareMechanism(ev(3), [mech('gain of function')]);
    expect(c?.relation).toBe('differs'); expect(c?.sentence).toMatch(/more than one disease mechanism/);
  });
  it('never reads absence of evidence (HI 0 or 1) as agreement or as a contradiction', () => {
    for (const h of [0, 1]) for (const m of ['gain of function', 'loss of function']) {
      const c = compareMechanism(ev(h), [mech(m)]);
      expect(c).toMatchObject({ state: 'not-comparable', relation: null }); expect(c?.sentence).toMatch(/absence of evidence/);
    }
  });
  it('does not infer gain of function from HI 40; the loss-of-function discrepancy stays explicit', () => {
    // ClinGen 40 addresses dosage sensitivity only; it supplies no positive mechanism evidence.
    expect(compareMechanism(ev(40), [mech('gain of function')])).toMatchObject({ state: 'not-comparable', relation: null });
    expect(compareMechanism(ev(40), [mech('loss of function')])?.relation).toBe('differs');
  });
  it('explains code 30 as a recessive-phenotype call, not as a missing call', () => {
    const c = compareMechanism(ev(30), [mech('loss of function')]);
    expect(c?.state).toBe('not-comparable'); expect(c?.sentence).toMatch(/recessive phenotype \(score 30\)/);
  });
  it('refuses to compare undetermined, mixed or unscored mechanisms', () => {
    expect(compareMechanism(ev(3), [mech('undetermined')])?.state).toBe('not-comparable');
    expect(compareMechanism(ev(3), [mech('loss of function'), mech('dominant negative')])?.state).toBe('not-comparable');
    expect(compareMechanism(ev(null), [mech('loss of function')])?.state).toBe('not-comparable');
    expect(compareMechanism(ev(3), [])).toBeNull();
  });
  // The ClinGen dosage call carries its curated disease as an exact MONDO id; the cross-check
  // must never present a call made for another disease (or without a disease) as agreeing on
  // the selected one.
  const dosageScoped = (h: number, diseaseId: string | null): DosageResponse => {
    const base = dosage(h);
    return { ...base, record: base.record && { ...base.record, haploinsufficiency: { ...base.record.haploinsufficiency, disease: diseaseId ? 'ALS type 1' : null, diseaseId } } };
  };
  const evScoped = (h: number, diseaseId: string | null) => buildDosageEvidence({ status: 'ready', data: dosageScoped(h, diseaseId) }, 'MONDO:0007103');
  it('never claims a different-disease ClinGen call agrees on the selected disease', () => {
    const c = compareMechanism(evScoped(3, 'MONDO:9999999'), [mech('loss of function')]);
    expect(c).toMatchObject({ state: 'not-comparable', relation: null });
    expect(c?.sentence).toMatch(/not for the selected disease/);
  });
  it('compares a same-disease ClinGen call on disease scope', () => {
    const c = compareMechanism(evScoped(3, 'MONDO:0007103'), [mech('loss of function')]);
    expect(c).toMatchObject({ state: 'compared', relation: 'consistent' });
    expect(c?.sentence).toMatch(/haploinsufficiency for this disease \(/);
    expect(c?.sentence).not.toMatch(/gene-level/);
  });
  it('says a gene-level ClinGen call is gene-level instead of "for this disease"', () => {
    const c = compareMechanism(evScoped(3, null), [mech('loss of function')]);
    expect(c).toMatchObject({ state: 'compared', relation: 'consistent' });
    expect(c?.sentence).toMatch(/gene-level/);
    expect(c?.sentence).not.toMatch(/haploinsufficiency for this disease/);
  });
  it('is bound to the selected disease: no frame, no comparison', () => {
    expect(model(disease([['A', 'Strong']], [mech('gain of function')]), dosage(3)).crossCheck?.relation).toBe('differs');
    expect(model(disease([['A', 'Strong']], [mech('gain of function')]), dosage(3), null).crossCheck).toBeNull();
  });
});
