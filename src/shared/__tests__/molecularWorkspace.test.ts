import { describe, expect, it } from 'vitest';
import { functionReadings, residueReadings } from '../molecularWorkspace';
import { buildFunctionEvidence } from '../functionEvidence';
import { functionEvidenceInputFrom } from '../functionEvidenceInput';
import { buildResidueContextEvidence } from '../residueContextEvidence';
import { derivePocketNarrative, buildBiochemicalContrast } from '../residueShiftEvidence';
import { residueScalePositions } from '../residueScales';
import { NAE1_POCKET, NAE1_RESULT as NAE1_SHIFT_RESULT } from './fixtures/nae1ResidueShifts';
import { NAE1_UNIPROT } from './fixtures/nae1FunctionalDomains';

/**
 * The molecular comparison workspace is presentation only, but its contracts are load-bearing:
 * identical record keys between the drawing, the records and the inspector; missing readings that
 * never become zeros. These tests pin those contracts.
 */

describe('functionReadings', () => {
  it('keys every reading exactly like the drawing and the records table, including overlapping signatures', () => {
    const uniprot = structuredClone(NAE1_UNIPROT);
    // Two deliberate overlaps on the same stretch: each row stays separate, none merges.
    uniprot.domainMatches = [
      { database: 'SMART', accession: 'DEMO1', entryType: 'domain', locations: [{ start: 90, end: 245 }], interpro: { id: 'DEMO', name: 'Illustrative overlap' } },
      { database: 'Pfam', accession: 'DEMO2', entryType: 'domain', locations: [{ start: 150, end: 245 }], interpro: { id: 'DEMO', name: 'Overlapping signature' } },
    ];
    const result = { ...NAE1_SHIFT_RESULT, uniprotFeatures: uniprot } as never;
    const ev = buildFunctionEvidence(functionEvidenceInputFrom(result));
    const readings = functionReadings(ev);
    const recordKeys = new Set(readings.map(r => r.key));
    // The drawing selects rows with the same keys the inspector pins.
    for (const g of ev.groups) for (const row of g.rows) expect(recordKeys.has(row.key)).toBe(true);
    // Overlapping database signatures stay as separate rows with their own source fact.
    const overlap = readings.filter(r => r.name.includes('Illustrative overlap') || r.name.includes('Overlapping signature'));
    expect(overlap).toHaveLength(2);
    for (const r of overlap) expect(r.facts.find(f => f.label === 'Source')?.value).toMatch(/SMART|Pfam/);
  });
});

describe('residueReadings', () => {
  const contrast = buildBiochemicalContrast({
    wildTypeCode: 'D', mutantCode: 'G',
    wildTypeValues: residueScalePositions('D'), mutantValues: residueScalePositions('G'),
    wildTypeLabel: 'Asp', mutantLabel: 'Gly'
  });
  const model = buildResidueContextEvidence({
    wildTypeCode: 'D', mutantCode: 'G', wildTypeLabel: 'Asp', mutantLabel: 'Gly',
    wildTypeName: 'Aspartate', mutantName: 'Glycine', position: 116, contrast,
    disruption: NAE1_SHIFT_RESULT.disruptionPredictor, pdbId: '1YOV', pdbSource: 'RCSB PDB', chain: 'A',
    pocket: derivePocketNarrative(NAE1_POCKET, { variantResidueIndex: 116, variantResidueChain: 'A' })
  });

  it('resolves the same keys the structure records pin, one row per published scale', () => {
    const readings = residueReadings(model);
    const propertyKeys = (model.properties ?? []).map(r => r.key);
    for (const key of propertyKeys) expect(readings.some(r => r.key === key)).toBe(true);
    expect(readings.some(r => r.key === 'burial')).toBe(true);
    expect(readings.some(r => r.key === 'pocket')).toBe(true);
  });

  it('carries the other residues on the selected scale into the pinned reading', () => {
    const polarity = residueReadings(model).find(r => r.key === 'polarity')!;
    const note = polarity.notes.join(' ');
    expect(note).toContain('Other residues on this scale:');
    // The whole alphabet, grouped by value, not just the pair under study.
    expect(note.split(' · ').length).toBeGreaterThan(5);
  });

  it('keeps a scale that reported nothing distinct from a measured change', () => {
    const bare = buildResidueContextEvidence({
      wildTypeCode: 'D', mutantCode: 'G', wildTypeLabel: 'Asp', mutantLabel: 'Gly',
      wildTypeName: 'Aspartate', mutantName: 'Glycine', position: 116, contrast,
      disruption: null, pdbId: null, pdbSource: null, chain: null,
      pocket: derivePocketNarrative(null, { variantResidueIndex: 116, variantResidueChain: null })
    });
    const readings = residueReadings(bare);
    const burial = readings.find(r => r.key === 'burial')!;
    expect(burial.valueText).toBe('No result');
    expect(burial.value).toBeNull();
  });
});
