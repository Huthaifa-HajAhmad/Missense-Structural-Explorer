import { describe, expect, it } from 'vitest';
import { LOCAL_REPAIR_BENCHMARK } from '../foldxRepairBenchmark.generated';
import { LARGE_STRUCTURE_REPAIR_NOTE, buildEnergeticsEvidence } from '../energeticsEvidence';
import { buildEnergeticsComparison, energeticsComparisonHeadline, energeticsComparisonFinding, energeticsComparisonCautions, returnedEnergyEstimates } from '../energeticsComparison';
import { KJ_PER_KCAL } from '../engineStatus';

const evidence = (extra = {}) => buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, thermompnn: 1.2, stabilityoracle: -0.36, ...extra }, foldingStatus: 'success' });
describe('Energetics comparison scientific display contract', () => {
  it('explains a deliberate large-template repair skip beside the estimate, in whole sentences', () => {
    const e = evidence({ foldxRepairSkipped: true, foldxRepairSkippedReason: 'large-structure', structureProvenance: { source: 'alphafold', chainId: 'A' } });
    const notes = energeticsComparisonCautions(e);
    expect(notes).toContain('FoldX used an unrepaired template, which can distort the estimate.');
    expect(notes).toContain(LARGE_STRUCTURE_REPAIR_NOTE);
    expect(LARGE_STRUCTURE_REPAIR_NOTE).toContain('above 400 residues');
    expect(LARGE_STRUCTURE_REPAIR_NOTE).toContain('not a repair failure');
    // The Engine records tab shows it as visible row text, not only as hover text on the chip.
    expect(e.readings.find(r => r.key === 'foldx')?.note).toContain(LARGE_STRUCTURE_REPAIR_NOTE);
  });
  it('does not add the large-structure sentence for other repair-skip reasons', () => {
    const e = evidence({ foldxRepairSkipped: true, foldxRepairSkippedReason: 'repair-exceeds-budget', structureProvenance: { source: 'alphafold', chainId: 'A' } });
    expect(energeticsComparisonCautions(e)).not.toContain(LARGE_STRUCTURE_REPAIR_NOTE);
    expect(e.readings.find(r => r.key === 'foldx')?.note ?? '').not.toContain(LARGE_STRUCTURE_REPAIR_NOTE);
  });
  it('states the local-repair offset as visible text, not only in a hover title', () => {
    const e = evidence({
      repairMode: 'fix-shell:r15-seq14:v1',
      repairModeIntended: 'fix-shell:r15-seq14:v1',
      repairShell: { radiusA: 15, sequenceBuffer: 14, sphereResidues: 62, movableResidues: 62, totalResidues: 875, sequenceBufferApplied: false },
      structureProvenance: { source: 'alphafold', chainId: 'A' },
    });
    const notes = energeticsComparisonCautions(e);
    // The measured spread is the disclosure; a reader must not have to hover to find it.
    expect(notes.some(n => n.includes('variants with a measured stability change'))).toBe(true);
    expect(notes.some(n => n.includes(`changed the band for ${LOCAL_REPAIR_BENCHMARK.bandChanges}`))).toBe(true);
    expect(notes.some(n => n.includes('Do not compare it with a whole-chain FoldX value'))).toBe(true);
  });
  it('does not add the local-repair offset when the template was repaired whole', () => {
    const e = evidence({ repairMode: 'full', repairModeIntended: 'full', structureProvenance: { source: 'alphafold', chainId: 'A' } });
    expect(energeticsComparisonCautions(e).some(n => n.includes('variants with a measured stability change'))).toBe(false);
  });
  it('gives the moderate band its own warning tone, so every surface agrees', () => {
    const tones = Object.fromEntries(evidence({ foldx: 0.58, foldxMean: 0.58 }).readings.map(r => [r.key, r.callTone]));
    expect(tones.foldx).toBe('warning');
    expect(evidence({ foldx: 2.62, foldxMean: 2.62 }).readings.find(r => r.key === 'foldx')?.callTone).toBe('danger');
    expect(evidence({ foldx: 0.1, foldxMean: 0.1 }).readings.find(r => r.key === 'foldx')?.callTone).toBe('neutral');
  });
  it('distinguishes a missing ProtVar score from a provider failure', () => {
    const miss = evidence({ protvar: null, protvarStatus: 'done', protvarReason: 'No precomputed data for this variant.' });
    expect(buildEnergeticsComparison(miss, 'kcal/mol').missing.find(r => r.key === 'protvar')?.status).toBe('No precomputed score');
    const failed = evidence({ protvar: null, protvarStatus: 'error', protvarError: 'Provider unavailable' });
    expect(buildEnergeticsComparison(failed, 'kcal/mol').missing.find(r => r.key === 'protvar')?.status).not.toBe('No precomputed score');
  });
  it('stages a majority with its exception instead of calling three of four "disagree"', () => {
    const majorityNeutral = buildEnergeticsEvidence({
      foldingEnergetics: {
        foldx: -0.1, foldxMean: -0.1, rasp: -1.4533, thermompnn: 0.53, stabilityoracle: -0.5034,
        stabilityoracleStatus: 'done', raspStatus: 'done',
      },
      foldingStatus: 'success',
      thermompnnStatus: 'done',
    });
    expect(energeticsComparisonHeadline(majorityNeutral)).toBe('Mostly no destabilization');
    expect(energeticsComparisonFinding(majorityNeutral)).toBe(
      'Most methods predict no destabilisation under their local marks; ThermoMPNN gives a moderately destabilising reading. This does not establish that the variant is benign.'
    );
    // Mid-run the prominent sentence must not read as final.
    const running = buildEnergeticsEvidence({
      foldingEnergetics: {
        rasp: -1.4533, thermompnn: 0.53, stabilityoracle: -0.5034,
        stabilityoracleStatus: 'done', raspStatus: 'done',
      },
      thermompnnStatus: 'done',
      isFolding: true,
    });
    expect(energeticsComparisonFinding(running)).toContain('Other results are still being collected');
  });
  it('mirrors the majority rule for the destabilizing and moderate bands', () => {
    // 3 past their destabilizing mark, ThermoMPNN only moderate: a severity difference, not a split.
    const mostlyHigh = buildEnergeticsEvidence({
      foldingEnergetics: {
        foldx: 2.6, foldxMean: 2.6, rasp: 1.7, stabilityoracle: 1.6, stabilityoracleStatus: 'done', raspStatus: 'done',
        thermompnn: 0.7,
      },
      foldingStatus: 'success',
      thermompnnStatus: 'done',
    });
    expect(mostlyHigh.agreement.direction).toBe('mostly-destabilizing');
    expect(energeticsComparisonHeadline(mostlyHigh)).toBe('Mostly destabilizing');
    expect(energeticsComparisonFinding(mostlyHigh)).toContain('ThermoMPNN sits in the moderately destabilising band');
    // 3 moderate, one neutral: still a majority reading, with the dissent named.
    const mostlyModerate = buildEnergeticsEvidence({
      foldingEnergetics: {
        foldx: 1.2, foldxMean: 1.2, rasp: 0.8, thermompnn: 0.9, raspStatus: 'done',
        stabilityoracle: -0.1, stabilityoracleStatus: 'done',
      },
      foldingStatus: 'success',
      thermompnnStatus: 'done',
    });
    expect(mostlyModerate.agreement.direction).toBe('mostly-moderate');
    expect(energeticsComparisonHeadline(mostlyModerate)).toBe('Mostly moderately destabilizing');
    expect(energeticsComparisonFinding(mostlyModerate)).toContain('StabilityOracle predicts no destabilisation');
  });
  it('keeps a genuine contradiction split when engines span neutral, moderate and high', () => {
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: {
        foldx: 2.6, foldxMean: 2.6, rasp: 0.8, thermompnn: 0.9, stabilityoracle: 0.0, stabilityoracleStatus: 'done', raspStatus: 'done',
      },
      foldingStatus: 'success',
      thermompnnStatus: 'done',
    });
    expect(ev.agreement.nCounted).toBe(4);
    expect(ev.agreement.direction).toBe('split');
  });
  it('qualifies sparse and excluded evidence in the prominent headline before showing a direction', () => {
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({}))).toBe('No usable estimate');
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2, foldxRepairFailed: true }, foldingStatus: 'success' }))).toBe('No usable estimate');
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({ foldingDdG: 0, foldingStatus: 'success' }))).toBe('One usable estimate');
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({ foldingDdG: 2, foldingStatus: 'success', foldingEnergetics: { thermompnn: 2 } }))).toBe('2 usable estimates');
    expect(energeticsComparisonHeadline(evidence())).toBe('Engines disagree');
  });
  it('uses canonical signs, keeps a true zero and never plots a missing estimate', () => {
    const model = buildEnergeticsComparison(evidence({ thermompnn: 0 }), 'kcal/mol');
    expect(model.points.find(p => p.key === 'stabilityoracle')?.value).toBe(-0.36);
    expect(model.points.find(p => p.key === 'thermompnn')?.value).toBe(0);
    expect(model.points.find(p => p.key === 'thermompnn')?.valueText).toBe('0.00');
    expect(model.points.find(p => p.key === 'stabilityoracle')?.valueText).toBe('−0.36');
    expect(model.points.some(p => p.key === 'rasp')).toBe(false);
    expect(model.missing.some(p => p.key === 'rasp')).toBe(true);
  });
  it('keeps excluded values visible and filters only their display without changing agreement or the axis', () => {
    const input = evidence({ rasp: 0.8, raspStatus: 'done', foldxRepairFailed: true });
    const before = JSON.stringify(input);
    const all = buildEnergeticsComparison(input, 'kcal/mol');
    const filtered = buildEnergeticsComparison(input, 'kcal/mol', 'value', true);
    expect(all.points.find(p => p.key === 'foldx')?.counted).toBe(false);
    expect(returnedEnergyEstimates(input)).toBe(4);
    expect(input.agreement.nCounted).toBe(3);
    expect(energeticsComparisonCautions(input).join(' ')).toContain('FoldX returned a value but is excluded');
    expect(filtered.points.some(p => p.key === 'foldx')).toBe(false);
    expect(filtered.domain).toEqual(all.domain);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('expands to contain extreme estimates and every displayed local guide', () => {
    const model = buildEnergeticsComparison(evidence({ foldxMean: 42, stabilityoracle: -18 }), 'kcal/mol');
    for (const p of model.points) {
      expect(p.value).toBeGreaterThan(model.domain[0]);
      expect(p.value).toBeLessThan(model.domain[1]);
      expect(p.guide).toBeLessThan(model.domain[1]);
    }
    expect(model.domain[0]).toBeLessThan(0);
  });
  it('converts the complete geometry to kJ, including guides, bounds and exact labels', () => {
    const kcal = buildEnergeticsComparison(evidence(), 'kcal/mol');
    const kj = buildEnergeticsComparison(evidence(), 'kJ/mol');
    expect(kj.points[0].value).toBeCloseTo(kcal.points[0].value * KJ_PER_KCAL);
    expect(kj.points[0].guide).toBeCloseTo(kcal.points[0].guide * KJ_PER_KCAL);
    expect(kj.domain[0]).toBeCloseTo(kcal.domain[0] * KJ_PER_KCAL);
    expect(kj.points[0].label).toContain('kJ/mol');
    expect(kj.points[0].valueText).toBe('+10.96');
  });
  it('separates the guide value from the prediction readout', () => {
    const p = buildEnergeticsComparison(evidence(), 'kcal/mol').points[0];
    expect(p.label).toContain('+2.62');
    expect(p.guideLabel).not.toContain('+2.62');
    expect(p.guideLabel).toContain('App-defined');
  });
  it('orders measured values numerically and places absent methods last', () => {
    const model = buildEnergeticsComparison(evidence(), 'kcal/mol', 'value');
    expect(model.points.map(p => p.key)).toEqual(['foldx', 'thermompnn', 'stabilityoracle']);
    expect(model.points.map(p => p.row)).toEqual([0, 1, 2]);
  });
  it('does not imply agreement for one method or turn an empty result into a benign reading', () => {
    expect(energeticsComparisonFinding(buildEnergeticsEvidence({ foldingDdG: 0, foldingStatus: 'success' }))).toContain('Agreement cannot be assessed');
    const empty = buildEnergeticsComparison(buildEnergeticsEvidence({}), 'kcal/mol');
    expect(empty.points).toEqual([]);
    // Four counted engines and the ProtVar reference row: every method is listed as absent.
    expect(empty.missing).toHaveLength(5);
    expect(empty.domain.every(Number.isFinite)).toBe(true);
  });

  it('does not claim agreement from two engines — the records tab says two is too few', () => {
    // Same finding function, engines that each passed their destabilizing mark: the elapsed claim
    // was "The methods agree" while the Records summary beside it said "too few to read as agreement".
    const input = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.5, foldxMean: 2.5, foldxRepairFailed: true, thermompnn: 2.0, stabilityoracle: 1.5 }, foldingStatus: 'success' });
    expect(input.agreement.nCounted).toBe(2);
    const finding = energeticsComparisonFinding(input);
    expect(finding).toContain('Both methods');
    expect(finding).toContain('too few to read as agreement');
    expect(finding).not.toContain('The methods agree');
  });

  it('says a run with no usable result yet is still being collected, not judged', () => {
    const running = buildEnergeticsEvidence({ thermompnnStatus: 'pending' });
    expect(running.agreement.nCounted).toBe(0);
    expect(running.running.length).toBeGreaterThan(0);
    expect(energeticsComparisonFinding(running)).toContain('No method has a usable result yet');
    expect(energeticsComparisonFinding(running)).not.toContain('not enough usable results');
  });

  it('keeps the honest full reading for three engines and adds the collection note while others run', () => {
    const settled = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, rasp: 1.5, stabilityoracle: 0.5 }, foldingStatus: 'success' });
    expect(settled.agreement.nCounted).toBe(3);
    expect(energeticsComparisonFinding(settled)).toContain('The methods agree');
    const collecting = buildEnergeticsEvidence({
      foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, rasp: 1.5, stabilityoracle: 0.5 },
      foldingStatus: 'success',
      thermompnnStatus: 'pending',
    });
    const finding = energeticsComparisonFinding(collecting);
    expect(collecting.agreement.nCounted).toBeGreaterThanOrEqual(3);
    expect(collecting.running.map(r => r.key)).toContain('thermompnn');
    expect(finding).toContain('agree on');
    expect(finding).toContain('Other results are still being collected');
  });
  describe('FoldX on two templates', () => {
    const both = (extra = {}) => evidence({ protvar: 1.4, protvarStatus: 'done', protvarModel: 'AF-Q13564-F1', structureProvenance: { source: 'experimental', pdbId: '1yov', chainId: 'A' }, ...extra });
    it('joins the two FoldX estimates when their rows touch, and not otherwise', () => {
      const adjacent = buildEnergeticsComparison(both(), 'kcal/mol', 'method');
      expect(adjacent.foldxPair).toEqual([{ key: 'foldx-pair', x1: 2.62, y1: 0, x2: 1.4, y2: 1 }]);
      // Sorted by value another engine can sit between them; a diagonal across it would read as a third series.
      const sorted = buildEnergeticsComparison(both({ thermompnn: 2.0 }), 'kcal/mol', 'value');
      expect(sorted.foldxPair).toEqual([]);
      expect(buildEnergeticsComparison(evidence(), 'kcal/mol').foldxPair).toEqual([]);
    });
    it('names the other FoldX value beside the unrepaired-template caution', () => {
      const unrepaired = both({ foldxRepairSkipped: true, foldxRepairSkippedReason: 'large-structure' });
      const notes = energeticsComparisonCautions(unrepaired);
      expect(notes.join(' ')).toContain('unrepaired template');
      expect(notes.join(' ')).toContain('The two FoldX values differ by 1.22 kcal/mol');
    });
    it('keeps the plotted value in the display unit', () => {
      const kj = buildEnergeticsComparison(both(), 'kJ/mol', 'method');
      expect(kj.foldxPair[0].x2).toBeCloseTo(1.4 * KJ_PER_KCAL);
    });
  });
});
