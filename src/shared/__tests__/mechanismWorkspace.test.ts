import { describe, expect, it } from 'vitest';
import { buildInterfacesEvidence } from '../interfacesEvidence';
import { interfaceMapView, interfaceNumberingNote, interfaceSupportGroups, interfaceWorkspaceReadings } from '../mechanismWorkspace';
import { SOD1_INTERFACES as F } from './fixtures/sod1Interfaces';

const interfaces = () => buildInterfacesEvidence({ result: F.result, assembly: F.assembly, assemblyStatus: 'ready', ppi: F.ppi, ppiStatus: 'ready', shift: null, shiftLoading: false });
describe('Mechanism workspace contracts', () => {
  it('bounds markers without changing returned counts or accepting non-finite support', () => {
    const ev = interfaces();
    ev.observed.partners[0].k = ev.observed.partners[0].n * 2;
    const row = interfaceSupportGroups(ev).find(g => g.kind === 'native')!.rows[0];
    expect(row.supportPercent).toBe(100);
    expect(row.k).toBe(row.n * 2);
    ev.observed.partners[0].k = -1;
    expect(interfaceSupportGroups(ev).find(g => g.kind === 'native')!.rows[0].supportPercent).toBe(0);
    ev.observed.partners[0].k = NaN;
    expect(interfaceSupportGroups(ev).find(g => g.kind === 'native')!.rows[0].supportPercent).toBeNull();
  });
  it('keeps native and fibril support as separate identities with their original denominators', () => {
    const rows = interfaceWorkspaceReadings(interfaces());
    const native = rows.find(r => r.key === 'solved:P00441:native')!;
    const fibril = rows.find(r => r.key === 'solved:P00441:fibril')!;
    // Denominators are the structures that model Ala5 (137 of 142 native, 4 of 15 fibril; PDBe unipdb).
    expect(native.valueText).toBe('0 of 137');
    expect(fibril.valueText).toBe('4 of 4');
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });
  it('retains inspectable records from the folded partner tail', () => {
    const ev = interfaces();
    const folded = ev.groups.flatMap(g => g.folded?.rows ?? []);
    expect(folded.length).toBeGreaterThan(20);
    const keys = new Set(interfaceWorkspaceReadings(ev).map(r => r.key));
    expect(folded.every(p => keys.has(`partner:${p.key}`))).toBe(true);
  });
  it('filters map layers without changing the finding, support denominator or source records', () => {
    const ev = interfaces();
    const original = structuredClone(ev);
    const v = interfaceMapView(ev, true, ['fibril']);
    expect(v.bounds).toEqual({ start: 1, end: 65 });
    expect(v.evidence.track.every(l => !l.key.endsWith(':fibril'))).toBe(true);
    expect(v.evidence.interface).toEqual(original.interface);
    expect(ev).toEqual(original);
    expect(interfaceWorkspaceReadings(ev).some(r => r.key === 'solved:P00441:fibril')).toBe(true);
  });
  it('retains original bounds for an annotation clipped by the display window', () => {
    const ev = interfaces();
    ev.track.push({ key: 'test', kind: 'domains', label: 'Full span', sub: '', summary: '', marks: [], gaps: [], ranges: [{ start: 1, end: 154, name: 'Full span', hit: true, kind: 'domain' }], hit: true, rowKey: null, readout: null });
    const v = interfaceMapView(ev, true);
    expect(v.evidence.track.at(-1)?.ranges[0]).toMatchObject({ start: 1, end: 154 });
  });
  it('shows a recorded numbering remap, and never claims identity from its absence', () => {
    expect(interfaceNumberingNote({ metadata: { variant: 'p.Lys272Asn', uniprotId: 'Q9Y305' }, numberingRemap: { from: { hgvsp: 'p.Lys281Asn', isoform: 'Q9Y305-4' } } })).toMatch(/Reported as p.Lys281Asn.*modelled as p.Lys272Asn/);
    expect(interfaceNumberingNote(F.result)).toContain('do not verify isoform identity');
  });
  it('keeps peptide-only entries in their own map layer, support group and readings', () => {
    const ev = interfaces();
    const pep = {
      ...ev.observed.partners[0],
      key: 'solved:HLA-A:peptide',
      accession: 'A0A140T913',
      name: 'HLA-A',
      gene: 'HLA-A',
      label: 'HLA-A (peptide fragment)',
      context: 'peptide' as const,
      k: 6,
      n: 6,
      total: 6,
      variantAtInterface: true,
      variantEntries: ['6vqo', '6vr1'],
    };
    ev.observed.peptides.push(pep);
    ev.track.push({
      key: 'solved:HLA-A:peptide',
      kind: 'solved',
      label: pep.label,
      sub: '6 of 6 peptide structures',
      summary: 'Peptide fragment contact',
      ranges: [],
      marks: [{ residue: 5, weight: 1, title: 'Ala5' }],
      gaps: [],
      hit: true,
      readout: { k: 6, n: 6, total: 6 },
      rowKey: pep.key,
    });
    expect(interfaceSupportGroups(ev).some(g => g.kind === 'peptide' && g.rows[0].key === pep.key)).toBe(true);
    const hidden = interfaceMapView(ev, false, ['peptide']);
    expect(hidden.layers.some(l => l.id === 'peptide')).toBe(true);
    expect(hidden.evidence.track.some(l => l.rowKey === pep.key)).toBe(false);
    expect(interfaceWorkspaceReadings(ev).some(r => r.key === pep.key)).toBe(true);
  });
});

describe('interfaceMapView — the topology lane says what its window shows', () => {
  it('counts the membrane segments in view, never the whole protein\'s six under a window that holds none', async () => {
    const { ABCG1_INTERFACES: A } = await import('./fixtures/abcg1Interfaces');
    const ev = buildInterfacesEvidence({ result: A.result, assembly: A.assembly, assemblyStatus: 'ready', ppi: A.ppi, ppiStatus: 'ready', shift: null, shiftLoading: false });
    const lane = (near: boolean) => interfaceMapView(ev, near).evidence.track.find(l => l.kind === 'topology')!;
    expect(lane(false).sub).toBe('6 membrane segments');
    // Gly358 ± 60 is 298–418; the first membrane segment starts at 427.
    expect(lane(true).sub).toBe('0 of 6 segments in view');
    expect(lane(true).ranges.filter(r => r.kind === 'membrane')).toHaveLength(0);
  });
});
