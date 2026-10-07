import { describe, expect, it } from 'vitest';
import { buildDosageEvidence, parseDosageScore, type DosageResponse } from '../dosageSensitivity';

const score = (code: number | null, diseaseId: string | null = null) => ({ ...parseDosageScore(code), disease: diseaseId ? 'Example' : null, diseaseId, history: null });
const response = (haplo: ReturnType<typeof score>, triplo = score(0)): DosageResponse => ({ gene: 'PTEN', status: 'ready', message: null, provenance: null,
  record: { symbol: 'PTEN', geneId: 'HGNC:9588', location: '10q23.31', haploinsufficiency: haplo, triplosensitivity: triplo, evaluatedAt: '2020-06-24', reportUrl: 'https://search.clinicalgenome.org/kb/gene-dosage/HGNC:9588' } });

describe('ClinGen dosage score parsing', () => {
  it.each([[3, 3], ['3', 3], ['30: Gene associated with autosomal recessive phenotype', 30], ['40: Dosage sensitivity unlikely', 40], [0, 0]])('reads %j as code %j', (value, code) => {
    expect(parseDosageScore(value)).toEqual({ state: 'scored', code });
  });
  it('keeps absence distinct from score 0', () => {
    expect(parseDosageScore('Not yet evaluated')).toEqual({ state: 'not-evaluated', code: null });
    for (const v of [-5, null, undefined, '7', 'abc']) expect(parseDosageScore(v)).toEqual({ state: 'not-reported', code: null });
  });
});
describe('buildDosageEvidence', () => {
  it('scopes the curated disease by exact MONDO ID only', () => {
    const load = { status: 'ready' as const, data: response(score(3, 'MONDO:0017623')) };
    expect(buildDosageEvidence(load, 'MONDO:0017623').readings[0].scope).toBe('same-disease');
    expect(buildDosageEvidence(load, 'MONDO:1').readings[0].scope).toBe('other-disease');
    expect(buildDosageEvidence(load, null).readings[0].scope).toBe('unscoped');
    expect(buildDosageEvidence({ status: 'ready', data: response(score(0)) }, 'MONDO:1').readings[0].scope).toBe('unscoped');
  });
  it('labels special codes without ranking them above 3', () => {
    const r = buildDosageEvidence({ status: 'ready', data: response(score(40)) }, null).readings[0];
    expect(r.call).toBe('40: Dosage sensitivity unlikely'); expect(r.tone).toBe('neutral');
    expect(buildDosageEvidence({ status: 'ready', data: response(score(3)) }, null).readings[0].tone).toBe('accent');
  });
  it('reports each non-ready state rather than a value', () => {
    expect(buildDosageEvidence(undefined, null).state).toBe('not-requested');
    expect(buildDosageEvidence({ status: 'loading', data: null }, null).state).toBe('loading');
    expect(buildDosageEvidence({ status: 'error', data: null }, null).state).toBe('error');
    expect(buildDosageEvidence({ status: 'ready', data: { gene: 'X', status: 'not-found', record: null, provenance: null, message: 'none' } }, null).state).toBe('not-found');
  });
});
