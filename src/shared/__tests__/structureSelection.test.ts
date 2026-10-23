import { describe, expect, it } from 'vitest';
import { buildStructureSelection, canLinkStructurePick, indexStructureResidues, linkedPickPosition } from '../structureSelection';
import type { Structure3dEvidence } from '../structure3dEvidence';

const atom = (position: number, chain = 'A', code = ' ', b = ' 92.00') =>
  `ATOM      1  CA  ALA ${chain}${String(position).padStart(4)}${code}      1.000   2.000   3.000  1.00${b}           C`;
const model = (kind = 'plddt', scale = 100, numbering = 'uniprot', verified = true, inherited = false, check = verified ? 'match' : 'mismatch', alphaFold?: { coverage: string; residues: number | null }) => ({
  canvas: { primary: { name: 'Fixture coordinates', numbering, channel: { kind, scale, inherited, note: 'Fixture provenance' } } },
  site: { canAddressVariantSite: verified, check: { state: check } },
  ...(alphaFold ? { alphaFold } : {}),
} as unknown as Structure3dEvidence);

describe('linked structure selection', () => {
  it('indexes first-model protein atoms, omitting ambiguous chains and insertion codes', () => {
    const text = [atom(5), atom(6), atom(6, 'B'), atom(7, 'A', 'A'), atom(8).replace('ATOM  ', 'HETATM'), 'ENDMDL', atom(9)].join('\n');
    expect([...indexStructureResidues(text).keys()]).toEqual([5]);
  });

  it('keeps alternate conformations of the same residue unambiguous', () => {
    expect(indexStructureResidues([atom(5), atom(5)].join('\n')).size).toBe(1);
  });

  it('never propagates author numbering, mismatches, absent residues or foreign chains', () => {
    const residues = indexStructureResidues(atom(5));
    const pick = { chain: 'A', resName: 'ALA', insertionCode: '' };
    expect(canLinkStructurePick(model(), residues, 5, pick)).toBe(true);
    expect(canLinkStructurePick(model('plddt', 100, 'entry'), residues, 5, pick)).toBe(false);
    expect(canLinkStructurePick(model('plddt', 100, 'uniprot', false), residues, 5, pick)).toBe(false);
    expect(canLinkStructurePick(model(), residues, 6, pick)).toBe(false);
    expect(canLinkStructurePick(model(), residues, 5, { ...pick, chain: 'B' })).toBe(false);
    expect(canLinkStructurePick(model(), residues, 5, { ...pick, resName: 'GLY' })).toBe(false);
    expect(canLinkStructurePick(model(), residues, 5, { ...pick, insertionCode: 'A' })).toBe(false);
  });

  it('lets a pick write the shared selection only while active, verified, unambiguous and on the primary model', () => {
    const residues = indexStructureResidues(atom(5));
    const pick = { chain: 'A', resName: 'ALA', insertionCode: '' };
    expect(linkedPickPosition(true, model(), residues, 5, pick)).toBe(5);
    expect(linkedPickPosition(false, model(), residues, 5, pick)).toBeNull();
    expect(linkedPickPosition(true, model(), residues, null, pick)).toBeNull();
    expect(linkedPickPosition(true, model('plddt', 100, 'entry'), residues, 5, pick)).toBeNull();
    expect(linkedPickPosition(true, model(), residues, 5, { ...pick, secondary: true })).toBeNull();
    expect(linkedPickPosition(true, model(), residues, 5, { ...pick, chain: 'B' })).toBeNull();
  });

  it('links through a variant site that is merely absent, but not through an identity mismatch', () => {
    const residues = indexStructureResidues(atom(5));
    const pick = { chain: 'A', resName: 'ALA', insertionCode: '' };
    expect(canLinkStructurePick(model('plddt', 100, 'uniprot', false, false, 'absent'), residues, 5, pick)).toBe(true);
    expect(canLinkStructurePick(model('plddt', 100, 'uniprot', false, false, 'mismatch'), residues, 5, pick)).toBe(false);
  });

  it('matches picks case- and padding-insensitively, including unnamed chains', () => {
    const residues = indexStructureResidues(atom(5, ' '));
    expect(canLinkStructurePick(model(), residues, 5, { chain: ' ', resName: 'ala', insertionCode: ' ' })).toBe(true);
  });

  it('labels values copied from a template as such', () => {
    expect(buildStructureSelection(model('plddt', 100, 'uniprot', true, true), indexStructureResidues(atom(5)), 5).measurement?.label).toBe('Template pLDDT (copied)');
  });

  it('retains the pinned position and explains unavailable mapping or coordinates', () => {
    const residues = indexStructureResidues(atom(5));
    expect(buildStructureSelection(model(), residues, 20)).toMatchObject({ state: 'missing', position: 20, measurement: null });
    expect(buildStructureSelection(model('plddt', 100, 'entry'), residues, 5)).toMatchObject({ state: 'unmapped', position: 5, measurement: null });
  });

  it('does not send the reader after AlphaFold coordinates a long protein cannot have', () => {
    const residues = indexStructureResidues(atom(5));
    // Below the ceiling — or with the question unestablished — the standing suggestion is still true.
    for (const alphaFold of [undefined, { coverage: 'within-limit', residues: 900 }, { coverage: 'unknown', residues: null }]) {
      const summary = buildStructureSelection(model('plddt', 100, 'entry', true, false, 'match', alphaFold), residues, 5).summary;
      expect(summary).toContain('Switch to a UniProt-numbered model (e.g. AlphaFold)');
    }

    // PKD1: no full-length AlphaFold DB model exists, so offering one would be an instruction that
    // cannot be followed.
    const summary = buildStructureSelection(
      model('plddt', 100, 'entry', true, false, 'match', { coverage: 'beyond-limit', residues: 4302 }),
      residues,
      5
    ).summary;
    expect(summary).toContain('2,700 aa');
    expect(summary).toContain('mapped experimental entry');
    expect(summary).not.toContain('Switch to a UniProt-numbered model');
    expect(summary).not.toContain('e.g. AlphaFold');
  });

  it('reads the selected residue on its own channel without inventing missing values', () => {
    expect(buildStructureSelection(model(), indexStructureResidues(atom(5)), 5).measurement).toMatchObject({ label: 'Cα pLDDT', value: '92.0' });
    expect(buildStructureSelection(model('plddt', 1), indexStructureResidues(atom(5, 'A', ' ', '  0.92')), 5).measurement?.value).toBe('92.0');
    expect(buildStructureSelection(model('temperature-factor'), indexStructureResidues(atom(5)), 5).measurement).toMatchObject({ label: 'Cα B-factor', value: '92.0 Å²' });
    expect(buildStructureSelection(model(), indexStructureResidues(atom(5, 'A', ' ', '      ')), 5).measurement).toBeNull();
    expect(buildStructureSelection(model(), indexStructureResidues(atom(5, 'A', ' ', '  0.00')), 5).measurement?.value).toBe('0.0');
  });
});
