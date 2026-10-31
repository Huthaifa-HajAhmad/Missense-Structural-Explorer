import { describe, expect, it } from 'vitest';
import { functionReadings, perturbationReadings, probabilityOverview, residueReadings, residueProbabilityComparison } from '../molecularWorkspace';
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

  it('keeps a model that returned nothing null, never a zero reading', () => {
    // The old form asserted `value === null` on functionReadings, whose values are hard-coded null:
    // it could not fail. A model that returned no result is where "missing is not zero" can actually
    // break, because its ΔLLR is null but its row still renders.
    const evidence = {
      residues: { wtCode: 'D', mutCode: 'G', position: 116 },
      lms: [{
        id: 'esm2', family: 'ESM2', llr: null,
        availability: { state: 'failed', label: 'Provider error', reason: 'The provider did not answer.' },
        servedBy: null, nativeRank: null, rank: null, rankSentence: '', caveats: [], preferences: [],
      }],
      physical: { readings: [], method: null, inputConfidence: null },
      esm3: null,
    } as unknown as Parameters<typeof perturbationReadings>[0];
    const [reading] = perturbationReadings(evidence);
    expect(reading.value).toBeNull();
    expect(reading.valueText).toBe('Provider error');
    expect(reading.valueText).not.toMatch(/^0(\.0+)?$/);
  });
});

describe('perturbationReadings', () => {
  const ev = buildPerturbationEvidence({ result: NAE1_RESULT, residues: NAE1_RESIDUES, foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, saprotEngine: 'remote-hf' });

  it('keeps a low-probability variant beside the highest preferences without renormalising or changing its source key', () => {
    const model = residueProbabilityComparison(ev, 'saprot');
    const overview = probabilityOverview(model, false);
    expect(model.rows).toHaveLength(20);
    expect(overview.rows.length).toBeLessThanOrEqual(8);
    const variant = model.rows.find(r => r.name.endsWith(' · variant'))!;
    const reference = model.rows.find(r => r.name.endsWith(' · reference'))!;
    expect(overview.rows).toContain(variant);
    expect(overview.rows).toContain(reference);
    expect(overview.domain).toEqual([0, 1]);
    expect(overview.ticks).toBe(model.ticks);
    expect(overview.rows.reduce((sum, r) => sum + (r.value ?? 0), 0)).toBeLessThan(model.rows.reduce((sum, r) => sum + (r.value ?? 0), 0));
    for (const r of overview.rows) expect(r).toBe(model.rows.find(original => original.key === r.key));
    expect(probabilityOverview(model, true)).toBe(model);
  });

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

  it('formats a sub-0.01% probability exponentially and keeps a returned zero at 0%', () => {
    const evidence = {
      residues: { wtCode: 'D', mutCode: 'G', position: 116 },
      lms: [{
        id: 'esm2', family: 'ESM2', llr: -1,
        availability: { state: 'computed', label: 'Computed', reason: '' },
        servedBy: 'esm2', nativeRank: 1, rank: 2, rankSentence: '', caveats: [],
        preferences: [{ aa: 'D', prob: 0.5 }, { aa: 'G', prob: 0.00001 }, { aa: 'A', prob: 0 }],
      }],
      physical: { readings: [], method: null, inputConfidence: null },
      esm3: null,
    } as unknown as Parameters<typeof residueProbabilityComparison>[0];
    const model = residueProbabilityComparison(evidence, 'esm2');
    // 0.00001 as a percent is 0.001, below the 0.01% the fixed form can show.
    expect(model.rows.find(r => r.key === 'esm2:G')?.valueText).toBe('1.00e-3%');
    // A probability the model actually returned as 0 is a reading, not a missing one.
    expect(model.rows.find(r => r.key === 'esm2:A')?.valueText).toBe('0%');
  });

  it('names each model row by the model that ran, not its family', () => {
    const stand = buildPerturbationEvidence({
      result: { ...NAE1_RESULT, esm2Eval: { ...NAE1_RESULT.esm2Eval, provenance: 'VESM-150M (Local Fallback)' } },
      residues: NAE1_RESIDUES, foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, saprotEngine: 'remote-hf',
    });
    const readings = perturbationReadings(stand);
    expect(readings.find(r => r.key === 'esm2')!.name).toBe('VESM-150M');
    expect(readings.find(r => r.key === 'esm2:D')!.name).toBe('VESM-150M · D');
  });

  it('states the scoring method a model returned, and says so when the engine recorded none', () => {
    const recorded = buildPerturbationEvidence({
      result: { ...NAE1_RESULT, esm2Eval: { ...NAE1_RESULT.esm2Eval, scoringMethod: 'masked-marginal' } },
      residues: NAE1_RESIDUES, foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, saprotEngine: 'remote-hf',
    });
    expect(perturbationReadings(recorded).find(r => r.key === 'esm2')!.facts).toContainEqual({ label: 'Scoring method', value: 'masked-marginal' });
    expect(perturbationReadings(ev).find(r => r.key === 'esm2')!.facts).toContainEqual({ label: 'Scoring method', value: 'Not recorded by this engine' });
  });

  it('adds one row per measured FoldX reading, and none for a reading that is null', () => {
    const readings = perturbationReadings(ev);
    const measured = ev.physical.readings.filter(r => r.value !== null);
    const unmeasured = ev.physical.readings.filter(r => r.value === null);
    expect(unmeasured.length).toBeGreaterThan(0);
    expect(readings.filter(r => r.key.startsWith('phys:')).map(r => r.key)).toEqual(measured.map(r => `phys:${r.key}`));
    for (const r of unmeasured) expect(readings.some(x => x.key === `phys:${r.key}`)).toBe(false);
    const vdw = readings.find(r => r.key === 'phys:vdw')!;
    expect(vdw.group).toBe('FoldX mutant model');
    expect(vdw.value).toBe(0.62);
    expect(vdw.facts).toContainEqual({ label: 'Method', value: ev.physical.method ?? 'Not recorded' });
    expect(vdw.facts.some(f => f.label === 'Input model confidence')).toBe(ev.physical.inputConfidence !== null);
    expect(vdw.notes.join(' ')).toMatch(/not a stability estimate/);
    expect(vdw.knowledgeKey).toBeTruthy();
  });

  it('adds the embedding drift row with its metric, coverage and served model', () => {
    const drift = perturbationReadings(ev).find(r => r.key === 'esm3')!;
    expect(drift.group).toBe('Sequence embedding');
    expect(drift.valueText).toMatch(/^\d\.\d{3}$/);
    expect(drift.facts).toContainEqual({ label: 'Distance metric', value: 'Cosine distance' });
    expect(drift.facts).toContainEqual({ label: 'Largest change', value: `${drift.valueText} at residue 116` });
    expect(drift.facts).toContainEqual({ label: 'At the variant residue', value: drift.valueText });
    expect(drift.facts).toContainEqual({ label: 'Coverage', value: '130 of 140 residues' });
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
