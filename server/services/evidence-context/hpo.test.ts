import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHpoAnnotation } from './hpo';
import { groupHpoTerms, hpoQueryIds, systemsFromAccepted, toggleAcceptedTerm } from '../../../src/shared/hpoAnnotation';
afterEach(() => vi.unstubAllGlobals());
const body = { disease: { id: 'ORPHA:15', name: 'Achondroplasia', mondoId: 'MONDO:0007037' }, categories: {
  'Skeletal system': [{ id: 'HP:0000001', name: 'Short stature', metadata: { frequency: 'Very frequent', onset: '', sources: ['ORPHA:15'] } }],
  Eye: [{ id: 'HP:0000002', name: 'Myopia', metadata: { onset: 'Childhood onset', frequency: '', sources: [] } }],
  Inheritance: [{ id: 'HP:0000006', name: 'Autosomal dominant inheritance', metadata: {} }] } };

describe('HPO adapter', () => {
  it('tries identifiers in order, skips a 404, and keeps frequency, onset and sources', async () => {
    const fetch = vi.fn(async (url: string) => String(url).endsWith('OMIM:1') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetch);
    const r = await loadHpoAnnotation('HPOT1', 'OMIM:1,ORPHA:15');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ status: 'ready', disease: { id: 'ORPHA:15', queried: 'ORPHA:15', mondoId: 'MONDO:0007037' } });
    expect(r.terms.find(t => t.id === 'HP:0000002')).toMatchObject({ onset: 'Childhood onset', frequency: null });
  });
  it('rejects anything that is not an OMIM or ORPHA id before any request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const bad of [undefined, '', 'MONDO:1', 'OMIM:1/../x', 'ORPHA:1,http://evil']) expect((await loadHpoAnnotation('HPOT2', bad)).status).toBe('not-found');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports an unknown disease as not-found and a provider failure as error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 }))); expect((await loadHpoAnnotation('HPOT3', 'OMIM:9')).status).toBe('not-found');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 }))); expect((await loadHpoAnnotation('HPOT4', 'OMIM:8')).status).toBe('error');
  });
});

describe('HPO suggestions model', () => {
  const data = { gene: 'G', status: 'ready' as const, disease: null, provenance: null, message: null, terms: [
    { id: 'HP:0000001', name: 'a', category: 'Skeletal system', frequency: null, onset: null, sources: [] },
    { id: 'HP:0000002', name: 'b', category: 'Eye', frequency: null, onset: null, sources: [] },
    { id: 'HP:0000006', name: 'c', category: 'Inheritance', frequency: null, onset: null, sources: [] }] };
  it('drops inheritance from groups and never adds a system until terms are accepted', () => {
    expect(groupHpoTerms(data).map(g => g.category).sort()).toEqual(['Eye', 'Skeletal system']);
    expect(systemsFromAccepted(data, [])).toEqual([]);
    expect(systemsFromAccepted(data, ['HP:0000002', 'HP:0000006'])).toEqual([{ system: 'vision', terms: 1 }]);
  });
  it('toggles single terms and normalises Orphanet cross-references, OMIM first', () => {
    expect(toggleAcceptedTerm(['HP:0000001'], 'HP:0000001')).toEqual([]);
    expect(hpoQueryIds(['Orphanet:15', 'OMIM:100800', 'MONDO:1', 'junk'])).toEqual(['OMIM:100800', 'ORPHA:15']);
  });
});
