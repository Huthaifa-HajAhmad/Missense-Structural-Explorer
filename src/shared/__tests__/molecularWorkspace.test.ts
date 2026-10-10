import { describe, expect, it } from 'vitest';
import { functionReadings, perturbationReadings, residueReadings, residueProbabilityComparison } from '../molecularWorkspace';
import { buildFunctionEvidence } from '../functionEvidence';
import { functionEvidenceInputFrom } from '../functionEvidenceInput';
import { buildPerturbationEvidence } from '../perturbationEvidence';
import { NAE1_ENERGETICS, NAE1_RESIDUES, NAE1_RESULT } from './fixtures/nae1Perturbation';
import { buildResidueContextEvidence } from '../residueContextEvidence';
import { derivePocketNarrative, buildBiochemicalContrast } from '../residueShiftEvidence';
import { residueScalePositions } from '../residueScales';
import { NAE1_POCKET, NAE1_RESULT as NAE1_SHIFT_RESULT } from './fixtures/nae1ResidueShifts';
import { NAE1_UNIPROT } from './fixtures/nae1FunctionalDomains';

/**
 * The molecular comparison workspace is presentation only, but its contracts are load-bearing:
 * identical record keys between the drawing, the records and the inspector; missing readings that
 * never become zeros; one scale per model. These tests pin those contracts.
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

  it('never lets a missing annotation read as a zero value', () => {
    const ev = buildFunctionEvidence(functionEvidenceInputFrom({ ...NAE1_SHIFT_RESULT, uniprotFeatures: null, serviceStatus: { uniprotFeatures: 'ok' } } as never));
    const readings = functionReadings(ev);
    for (const r of readings) expect(r.value).toBeNull();
  });
});

describe('perturbationReadings', () => {
  const ev = buildPerturbationEvidence({ result: NAE1_RESULT, residues: NAE1_RESIDUES, foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, saprotEngine: 'remote-hf' });

  it('keys preference rows under their model, so the records and the probability chart agree', () => {
    const readings = perturbationReadings(ev);
    const modelRow = readings.find(r => r.key === 'esm2');
    expect(modelRow).toBeDefined();
    const preference = readings.find(r => r.key.startsWith('esm2:'));
    expect(preference).toBeDefined();
    expect(modelRow!.facts.find(f => f.label === 'ΔLLR')).toBeDefined();
    expect(modelRow!.notes.join(' ')).toMatch(/not a common scale/);
  });

  it('keeps the probability spread out of the language-model group claim', () => {
    const comparison = residueProbabilityComparison(buildPerturbationEvidence({ result: NAE1_RESULT, residues: NAE1_RESIDUES, foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, saprotEngine: 'remote-hf' }), 'esm2');
    expect(comparison.domain).toEqual([0, 1]);
    // Only that one model's rows: another model's preference or ΔLLR rows never share the axis.
    for (const r of comparison.rows) expect(r.key.startsWith('esm2:')).toBe(true);
    const wt = comparison.rows.find(r => r.name.includes('reference'));
    const mut = comparison.rows.find(r => r.name.includes('variant'));
    expect(wt).toBeDefined();
    expect(mut?.tone).toBe('accent');
    expect(mut?.value).toBe(comparison.rows.find(r => r.key === `esm2:${NAE1_RESIDUES.mutCode}`)?.value);
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
