import { describe, expect, it } from 'vitest';
import { buildG2pSnapshot, g2pSnapshotSchema, loadMechanismContext } from './g2p';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { scopeMechanismRecords } from '../../../src/shared/mechanismContext';
const provenance = { source: 'G2P', url: 'https://www.ebi.ac.uk/gene2phenotype/', licence: 'EBI Terms', release: null, retrievedAt: '2026-10-06', sha256: 'a'.repeat(64) };
const header = 'g2p id,gene symbol,hgnc id,disease name,disease MONDO,allelic requirement,cross cutting modifier,confidence,molecular mechanism,molecular mechanism support,molecular mechanism categorisation,molecular mechanism evidence,variant consequence,variant types,publications,date of last review\n';
const row = (id: string, mondo = 'MONDO:0000001', allele = 'monoallelic_autosomal', modifier = '') => `${id},TEST,1,Example,${mondo},${allele},${modifier},strong,gain of function,inferred,,,altered gene product,,123; 456,2026-01-01\n`;
describe('G2P record scope and import integrity', () => {
  it('treats prototype member names as absent genes rather than source records', async () => {
    const previous = process.env.G2P_CONTEXT_PATH;
    const directory = await mkdtemp(path.join(tmpdir(), 'mse-g2p-audit-'));
    try {
      const file = path.join(directory, 'snapshot.json'); process.env.G2P_CONTEXT_PATH = file;
      await writeFile(file, JSON.stringify(buildG2pSnapshot(header + row('G2P1'), provenance)));
      for (const gene of ['constructor', 'toString', 'valueOf']) expect((await loadMechanismContext(gene)).records).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.G2P_CONTEXT_PATH; else process.env.G2P_CONTEXT_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects a corrupt gene index, duplicate records and inaccurate counts in an installed snapshot', () => {
    const snapshot = buildG2pSnapshot('\uFEFF' + header + row('G2P1'), provenance);
    expect(() => g2pSnapshotSchema.parse({ ...snapshot, genes: { OTHER: snapshot.genes.TEST } })).toThrow('index');
    expect(() => g2pSnapshotSchema.parse({ ...snapshot, rowCount: 2 })).toThrow('count');
    expect(() => g2pSnapshotSchema.parse({ ...snapshot, rowCount: 2, genes: { TEST: [...snapshot.genes.TEST, ...snapshot.genes.TEST] } })).toThrow('identity');
  });
  it('keeps inferred support, source dates, publications and unresolved allelic scope', () => {
    const data = buildG2pSnapshot(header + row('G2P1') + row('G2P2', 'MONDO:0000001', 'biallelic_autosomal') + row('G2P3', 'MONDO:0000002') + row('G2P4', 'MONDO:0000001', 'monoallelic_autosomal', 'imprinted'), provenance);
    expect(data.genes.TEST[0]).toMatchObject({ support: 'inferred', reviewedAt: '2026-01-01', publications: ['123','456'] });
    const scope = scopeMechanismRecords(data.genes.TEST, { geneId: 'HGNC:1', diseaseId: 'MONDO:0000001', inheritance: { id: 'HP:0000006' } });
    expect(scope.matching.map(r => r.id)).toEqual(['G2P1','G2P4']);
    expect(scope.matching[1].modifier).toBe('imprinted');
    expect(scope.unresolvedScope.map(r => r.id)).toEqual(['G2P2']); expect(scope.otherDiseaseCount).toBe(1);
    expect(scopeMechanismRecords(data.genes.TEST, { geneId: 'HGNC:2', diseaseId: 'MONDO:0000001', inheritance: { id: 'HP:0000006' } }).matching).toEqual([]);
    expect(scopeMechanismRecords(data.genes.TEST, { geneId: 'HGNC:1', diseaseId: 'MONDO:0000001', inheritance: { id: 'unsupported' } }).matching).toEqual([]);
  });
  it('rejects schema drift, malformed IDs, truncated rows and duplicated records', () => {
    expect(() => buildG2pSnapshot('gene symbol\nTEST', provenance)).toThrow('schema changed');
    expect(() => buildG2pSnapshot(header + 'G2P1,TEST', provenance)).toThrow('column count');
    expect(() => buildG2pSnapshot(header + row('G2P1') + row('G2P1'), provenance)).toThrow('Duplicate');
    expect(() => buildG2pSnapshot(header + row('G2P1', 'disease label'), provenance)).toThrow();
  });
});
