import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAdultExpression } from './gtex';
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown[]) => ({ data, paging_info: { totalNumberOfItems: data.length, numberOfPages: data.length ? 1 : 0 } });
function mockProvider(gene: string, median = 0, mismatch = false, incomplete = false) {
  const fetch = vi.fn(async (input: URL) => {
    const url = input.toString();
    let body;
    if (url.includes('/reference/gene')) body = response([{ geneSymbol: gene, gencodeId: 'ENSG00000000001.2', gencodeVersion: 'v39', genomeBuild: 'GRCh38/hg38' }]);
    else if (url.includes('/medianGeneExpression')) body = response([{ geneSymbol: mismatch ? 'OTHER' : gene, gencodeId: 'ENSG00000000001.2', datasetId: 'gtex_v10', unit: 'TPM', median, tissueSiteDetailId: 'Liver' }]);
    else body = response([{ tissueSiteDetailId: 'Liver', tissueSiteDetail: 'Liver', datasetId: 'gtex_v10', ontologyId: 'UBERON:0002107', rnaSeqSampleSummary: { totalCount: 100 } }]);
    if (incomplete && url.includes('/medianGeneExpression')) body.paging_info.totalNumberOfItems = 2;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
describe('GTEx identity and completeness', () => {
  it('requests the v39 versioned identity, preserves measured zero and sample counts, and coalesces requests', async () => {
    const fetch = mockProvider('ZERO_TEST');
    const [result, simultaneous] = await Promise.all([fetchAdultExpression('ZERO_TEST'), fetchAdultExpression('ZERO_TEST')]);
    expect(result.status).toBe('ready'); expect(simultaneous).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0].searchParams.get('gencodeVersion')).toBe('v39');
    expect(result.tissues[0]).toMatchObject({ value: 0, unit: 'TPM', sampleCount: 100 });
    expect(result.provenance?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects an expression response for the wrong gene', async () => {
    mockProvider('MISMATCH_TEST', 1, true); expect((await fetchAdultExpression('MISMATCH_TEST')).status).toBe('error');
  });
  it('does not treat truncated pagination as coverage or expression absence', async () => {
    mockProvider('PAGE_TEST', 1, false, true); const result = await fetchAdultExpression('PAGE_TEST');
    expect(result.status).toBe('error'); expect(result.tissues).toEqual([]);
  });
});
