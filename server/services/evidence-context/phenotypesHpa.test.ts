import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModelPhenotypes } from './modelPhenotypes';
import { loadHpa } from './hpa';
import { buildUphenoIndex, matchedNames, splitByDiseaseMatch } from '../../../src/shared/modelPhenotypes';
import { parseHpaMeasures } from '../../../src/shared/hpa';
afterEach(() => vi.unstubAllGlobals());

const SSSOM = ['#comment', 'subject_id\tpredicate_id\tobject_id\tmapping_justification',
  'UPHENO:1\tsemapv:crossSpeciesExactMatch\tMP:0001\tx', 'UPHENO:1\tsemapv:crossSpeciesExactMatch\tHP:0000505\tx', 'UPHENO:1\tsemapv:crossSpeciesExactMatch\tZP:0009\tx',
  'UPHENO:2\tsemapv:closeMatch\tMP:0002\tx', 'UPHENO:2\tsemapv:crossSpeciesExactMatch\tHP:0000002\tx'].join('\n');

describe('uPheno matching', () => {
  it('links terms that share an UPHENO id and ignores non-exact predicates', () => {
    const index = buildUphenoIndex(SSSOM);
    expect(index.humanTerms('MP:0001')).toEqual(['HP:0000505']); expect(index.humanTerms('ZP:0009')).toEqual(['HP:0000505']);
    expect(index.humanTerms('MP:0002')).toEqual([]); expect(index.humanTerms('MP:9999')).toEqual([]);
  });
  it('puts phenotypes matching the chosen disease first and names the human term', () => {
    const terms = new Map([['HP:0000505', 'Visual impairment']]);
    const rows = [{ termId: 'MP:1', statement: 'a', annotations: 1, models: 1, humanTerms: ['HP:0000505'] }, { termId: 'MP:2', statement: 'b', annotations: 1, models: 1, humanTerms: [] }];
    const split = splitByDiseaseMatch(rows, terms);
    expect(split.matched.map(r => r.termId)).toEqual(['MP:1']); expect(split.other).toHaveLength(1);
    expect(matchedNames(rows[0], terms)).toEqual(['Visual impairment']);
  });
});

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const orthologRow = (id: string, symbol: string, taxon: string, name: string) => ({ stringencyFilter: 'stringent', geneToGeneOrthologyGenerated: {
  subjectGene: { primaryExternalId: 'HGNC:1' }, objectGene: { primaryExternalId: id, geneSymbol: { displayText: symbol }, taxon: { curie: taxon, name } }, isBestScore: { name: 'Yes' }, isBestScoreReverse: { name: 'Yes' }, predictionMethodsMatched: [{}] } });
describe('model phenotype adapter', () => {
  const stub = (zebrafish: () => Response) => vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes('genenames')) return json({ response: { numFound: 1, docs: [{ hgnc_id: 'HGNC:1', symbol: decodeURIComponent(url.split('/').pop()!), status: 'Approved' }] } });
    if (url.includes('/orthologs')) return json({ total: 2, results: [orthologRow('MGI:1', 'Gx', 'NCBITaxon:10090', 'Mus musculus'), orthologRow('ZFIN:1', 'gx', 'NCBITaxon:7955', 'Danio rerio')] });
    if (url.includes('mousephenotype')) return json({ response: { numFound: 0, docs: [] } });
    if (url.includes('githubusercontent')) return new Response(SSSOM);
    if (url.includes('MGI%3A1')) return json({ total: 1, results: [{ phenotypeStatement: 'abnormal eye physiology', primaryAnnotations: [{ uniqueId: 'MGI:3040300|has_phenotype|abnormal eye physiology|MP:0001|AGRKB:1' }, { uniqueId: 'MGI:3040301|has_phenotype|abnormal eye physiology|MP:0001|AGRKB:2' }] }] });
    return zebrafish();
  }));
  it('reads allele-level terms, counts annotations and models, and attaches human matches', async () => {
    stub(() => json({ total: 0, returnedRecords: 0 }));
    const r = await loadModelPhenotypes('MPH1');
    expect(r.mapping).toBe('available');
    expect(r.species.find(s => s.symbol === 'Gx')!.phenotypes).toEqual([{ termId: 'MP:0001', statement: 'abnormal eye physiology', annotations: 2, models: 2, humanTerms: ['HP:0000505'] }]);
    expect(r.species.find(s => s.symbol === 'gx')).toMatchObject({ status: 'ready', total: 0, phenotypes: [] });
  });
  it('marks an ortholog as unreadable on an incomplete page, never as having no phenotype, and does not cache it', async () => {
    stub(() => json({ total: 3, results: [] }));
    const r = await loadModelPhenotypes('MPH2');
    expect(r.species.find(s => s.symbol === 'gx')).toMatchObject({ status: 'error', total: 0 });
    expect(r.species.find(s => s.symbol === 'Gx')!.status).toBe('ready');
  });
});

describe('HPA adapter', () => {
  const hpa = { Gene: 'HPA1', Ensembl: 'ENSG00000108370', Evidence: 'Evidence at protein level', 'RNA tissue specificity': 'Tissue enriched', 'RNA tissue distribution': 'Detected in many',
    'RNA tissue specific nTPM': { brain: '62.9' }, 'RNA single cell type specificity': 'Group enriched', 'RNA single cell type specific nCPM': { 'Rod photoreceptor cells': '906.3', Broken: 'n/a' },
    Antibody: ['HPA013550'], 'Reliability (IH)': 'Enhanced', 'Reliability (IF)': null };
  const stub = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).includes('genenames')
    ? json({ response: { docs: [{ symbol: decodeURIComponent(String(input).split('/').pop()!), status: 'Approved', ensembl_gene_id: 'ENSG00000108370' }] } }) : json(body, status)));
  it('parses string measures, drops unparsable ones and keeps zero distinct from unlisted', async () => {
    stub(hpa); const r = await loadHpa('HPA1');
    expect(r.cells!.enrichedCells).toEqual([{ name: 'Rod photoreceptor cells', value: 906.3 }]);
    expect(r.rna!.enrichedTissues).toEqual([{ name: 'brain', value: 62.9 }]);
    expect(parseHpaMeasures({ a: '0', b: 'x' })).toEqual([{ name: 'a', value: 0 }]);
  });
  it('rejects a mismatched gene, maps 404 to not-found and failure to error', async () => {
    stub({ ...hpa, Gene: 'OTHER' }); expect((await loadHpa('HPA4')).status).toBe('error');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).includes('genenames')
      ? json({ response: { docs: [{ symbol: 'HPA2', status: 'Approved', ensembl_gene_id: 'ENSG00000108371' }] } }) : json({}, 404)));
    expect((await loadHpa('HPA2')).status).toBe('not-found');
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 503))); expect((await loadHpa('HPA3')).status).toBe('error');
  });
});
