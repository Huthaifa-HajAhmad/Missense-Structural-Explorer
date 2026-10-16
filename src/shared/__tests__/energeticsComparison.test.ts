import { describe, expect, it } from 'vitest';
import { buildEnergeticsEvidence } from '../energeticsEvidence';
import { buildEnergeticsComparison, energeticsComparisonHeadline, energeticsComparisonFinding, energeticsComparisonCautions, returnedEnergyEstimates } from '../energeticsComparison';
import { KJ_PER_KCAL } from '../engineStatus';

const evidence = (extra = {}) => buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, dynamut2: 0.36, ddmut: 0, thermompnn: 1.2, ...extra }, foldingStatus: 'success' });
describe('Energetics comparison scientific display contract', () => {
  it('qualifies sparse and excluded evidence in the prominent headline before showing a direction', () => {
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({}))).toBe('No usable estimate');
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2, foldxRepairFailed: true }, foldingStatus: 'success' }))).toBe('No usable estimate');
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({ foldingDdG: 0, foldingStatus: 'success' }))).toBe('One usable estimate');
    expect(energeticsComparisonHeadline(buildEnergeticsEvidence({ foldingDdG: 2, foldingStatus: 'success', foldingEnergetics: { ddmut: -2 } }))).toBe('2 usable estimates');
    expect(energeticsComparisonHeadline(evidence())).toBe('Engines disagree');
  });
  it('uses canonical signs, keeps a true zero and never plots a missing estimate', () => {
    const model = buildEnergeticsComparison(evidence(), 'kcal/mol');
    expect(model.points.find(p => p.key === 'dynamut2')?.value).toBe(-0.36);
    expect(model.points.find(p => p.key === 'ddmut')?.value).toBe(0);
    expect(model.points.find(p => p.key === 'ddmut')?.valueText).toBe('0.00');
    expect(model.points.find(p => p.key === 'dynamut2')?.valueText).toBe('−0.36');
    expect(model.points.some(p => p.key === 'rasp')).toBe(false);
    expect(model.missing.some(p => p.key === 'rasp')).toBe(true);
  });
  it('keeps excluded values visible and filters only their display without changing agreement or the axis', () => {
    const input = evidence({ foldxRepairFailed: true });
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
    const model = buildEnergeticsComparison(evidence({ foldxMean: 42, dynamut2: 18 }), 'kcal/mol');
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
    expect(model.points.map(p => p.key)).toEqual(['foldx', 'thermompnn', 'ddmut', 'dynamut2']);
    expect(model.points.map(p => p.row)).toEqual([0, 1, 2, 3]);
  });
  it('does not imply agreement for one method or turn an empty result into a benign reading', () => {
    expect(energeticsComparisonFinding(buildEnergeticsEvidence({ foldingDdG: 0, foldingStatus: 'success' }))).toContain('Agreement cannot be assessed');
    const empty = buildEnergeticsComparison(buildEnergeticsEvidence({}), 'kcal/mol');
    expect(empty.points).toEqual([]);
    // Six counted engines and the ProtVar reference row: every method is listed as absent.
    expect(empty.missing).toHaveLength(7);
    expect(empty.domain.every(Number.isFinite)).toBe(true);
  });

  it('does not claim agreement from two engines — the records tab says two is too few', () => {
    // Same finding function, engines that each passed their destabilizing mark: the elapsed claim
    // was "The methods agree" while the Records summary beside it said "too few to read as agreement".
    const input = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.5, foldxMean: 2.5, foldxRepairFailed: true, dynamut2: -2.0, ddmut: -1.5 }, foldingStatus: 'success' });
    expect(input.agreement.nCounted).toBe(2);
    const finding = energeticsComparisonFinding(input);
    expect(finding).toContain('Both methods');
    expect(finding).toContain('too few to read as agreement');
    expect(finding).not.toContain('The methods agree');
  });

  it('says a run with no usable result yet is still being collected, not judged', () => {
    const running = buildEnergeticsEvidence({ dynamut2Status: 'pending', ddmutStatus: 'pending' });
    expect(running.agreement.nCounted).toBe(0);
    expect(running.running.length).toBeGreaterThan(0);
    expect(energeticsComparisonFinding(running)).toContain('No method has a usable result yet');
    expect(energeticsComparisonFinding(running)).not.toContain('not enough usable results');
  });

  it('keeps the honest full reading for three engines and adds the collection note while others run', () => {
    const settled = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, dynamut2: -2.0, ddmut: -1.5 }, foldingStatus: 'success' });
    expect(settled.agreement.nCounted).toBe(3);
    expect(energeticsComparisonFinding(settled)).toContain('The methods agree');
    const collecting = buildEnergeticsEvidence({
      foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, dynamut2: -2.0, ddmut: -1.5 },
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
