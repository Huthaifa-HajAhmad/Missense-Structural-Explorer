import { describe, expect, it } from 'vitest';
import { parseCsv, buildGenccSnapshot, genccSnapshotSchema } from './gencc';
const provenance = { source: 'GenCC', url: 'https://thegencc.org/download', licence: 'CC0', release: null, retrievedAt: '2026-10-06', sha256: 'a'.repeat(64) };
const header = 'uuid,gene_curie,gene_symbol,disease_curie,disease_title,moi_curie,moi_title,classification_title,submitter_title,submitter_curie,disease_original_curie,submitted_as_date,submitted_as_public_report_url\n';
const row = (id: string, moi: string, level: string) => `${id},HGNC:1,TEST,MONDO:0000001,Example,${moi},Inheritance,${level},Submitter,GENCC:1,OMIM:123456,2026-01-01,https://example.org/report\n`;
describe('GenCC import identity and provenance', () => {
  it('rejects misplaced evidence, inconsistent frame keys, duplicate assertions and false counts in installed JSON', () => {
    const snapshot = buildGenccSnapshot(header + row('1', 'HP:0000006', 'Strong'), provenance);
    expect(() => genccSnapshotSchema.parse({ ...snapshot, genes: { OTHER: snapshot.genes.TEST } })).toThrow('index');
    expect(() => genccSnapshotSchema.parse({ ...snapshot, rowCount: 2 })).toThrow('count');
    expect(() => genccSnapshotSchema.parse({ ...snapshot, genes: { TEST: [{ ...snapshot.genes.TEST[0], key: 'wrong' }] } })).toThrow('identity');
    expect(() => genccSnapshotSchema.parse({ ...snapshot, rowCount: 2, genes: { TEST: [{ ...snapshot.genes.TEST[0], validity: [...snapshot.genes.TEST[0].validity, ...snapshot.genes.TEST[0].validity] }] } })).toThrow('Duplicate');
    expect(() => buildGenccSnapshot(header.replace('uuid,', 'uuid,uuid,') + row('1', 'HP:0000006', 'Strong'), provenance)).toThrow('schema');
    expect(() => buildGenccSnapshot(header + row('1', 'HP:0000006', 'Strong') + row('2', 'HP:0000006', 'Strong').replace(',TEST,', ',OTHER,'), provenance)).toThrow('conflicts');
  });
  it('preserves quoted commas, quotes and embedded newlines', () => {
    expect(parseCsv('a,b\r\n"comma, and ""quote""","multi\nline"\r\n')).toEqual([['a', 'b'], ['comma, and "quote"', 'multi\nline']]);
    expect(() => parseCsv('"unfinished')).toThrow('Truncated');
    expect(() => parseCsv('"quoted"unexpected,b')).toThrow('closing quote');
  });
  it('keeps different inheritance frames and all conflicting submitters', () => {
    const snapshot = buildGenccSnapshot(header + row('1', 'HP:0000006', 'Strong') + row('2', 'HP:0000006', 'Refuted Evidence') + row('3', 'HP:0000007', 'Limited'), provenance);
    expect(snapshot.genes.TEST).toHaveLength(2);
    expect(snapshot.genes.TEST[0].validity.map(a => a.level)).toEqual(['Strong', 'Refuted Evidence']);
    expect(snapshot.rowCount).toBe(3);
    expect(snapshot.genes.TEST[0].xrefs).toEqual(['OMIM:123456']);
    expect(snapshot.provenance.release).toBeNull();
  });
  it('fails on schema drift, malformed rows and duplicate assertion IDs', () => {
    expect(() => buildGenccSnapshot('gene_symbol\nTEST', provenance)).toThrow('schema changed');
    expect(() => buildGenccSnapshot(header + '1,2', provenance)).toThrow('column count');
    expect(() => buildGenccSnapshot(header + row('1', 'HP:1', 'Strong') + row('1', 'HP:1', 'Strong'), provenance)).toThrow('Duplicate');
  });
});
