import { describe, expect, it } from 'vitest';
import { buildEnergeticsEvidence } from '../energeticsEvidence';
import { buildEnergeticsComparison, energeticsComparisonFinding, energeticsComparisonCautions, returnedEnergyEstimates } from '../energeticsComparison';
import { KJ_PER_KCAL } from '../engineStatus';

const evidence = (extra = {}) => buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, dynamut2: 0.36, ddmut: 0, thermompnn: 1.2, ...extra }, foldingStatus: 'success' });
describe('Energetics comparison scientific display contract', () => {
  it('uses canonical signs, keeps a true zero and never plots a missing estimate', () => {
    const model = buildEnergeticsComparison(evidence(), 'kcal/mol');
    expect(model.points.find(p => p.key === 'dynamut2')?.value).toBe(-0.36);
    expect(model.points.find(p => p.key === 'ddmut')?.value).toBe(0);
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
    expect(empty.missing).toHaveLength(6);
    expect(empty.domain.every(Number.isFinite)).toBe(true);
  });
});
