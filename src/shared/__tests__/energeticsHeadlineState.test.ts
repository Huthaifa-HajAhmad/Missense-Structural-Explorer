import { describe, expect, it } from 'vitest';
import { buildEnergeticsEvidence, energeticsSummary } from '../energeticsEvidence';
import { buildEnergeticsComparison, energeticsComparisonCautions, energeticsComparisonFinding, energeticsComparisonHeadline } from '../energeticsComparison';

const ABCG1_LIKE_PLDDT = 27.2;
const alphafold = { source: 'alphafold', chainId: 'A' };
const settled = { foldx: 2.62, foldxMean: 2.62, thermompnn: 1.2, stabilityoracle: -0.36, structureProvenance: alphafold };

describe('provisional state: a counting engine is still running', () => {
  // FoldX still running; three other engines have reported and are counted.
  const running = buildEnergeticsEvidence({
    foldingEnergetics: { rasp: -1.4533, thermompnn: 0.53, stabilityoracle: -0.5034, stabilityoracleStatus: 'done', raspStatus: 'done' },
    thermompnnStatus: 'done',
    isFolding: true,
  });

  it('exposes one typed provisional flag and the names of the engines still running', () => {
    expect(running.provisional).toBe(true);
    expect(running.runningEngines).toEqual(['FoldX']);
  });

  it('opens the headline with the provisional statement, before any direction word', () => {
    expect(energeticsComparisonHeadline(running)).toBe('Provisional: FoldX is still running. So far: Mostly no destabilization');
  });

  it('is not provisional once the running engine has settled', () => {
    const done = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, rasp: 1.5, stabilityoracle: 0.5 }, foldingStatus: 'success' });
    expect(done.provisional).toBe(false);
    expect(done.runningEngines).toEqual([]);
    expect(energeticsComparisonHeadline(done)).not.toMatch(/^Provisional/);
  });
});

describe('withheld direction: AlphaFold confidence is very low at the residue', () => {
  const lowConfidence = buildEnergeticsEvidence({ foldingEnergetics: settled, foldingStatus: 'success', plddt: ABCG1_LIKE_PLDDT });
  const headline = "No stability conclusion: AlphaFold's confidence at this residue is very low (pLDDT 27.2), so the coordinates the estimates use are unreliable.";

  it('replaces the combined direction with the no-conclusion headline', () => {
    expect(lowConfidence.withheldReason).toBe('very-low-plddt');
    expect(energeticsComparisonHeadline(lowConfidence)).toBe(headline);
  });

  it('keeps every engine estimate visible, with its own value', () => {
    const model = buildEnergeticsComparison(lowConfidence, 'kcal/mol');
    expect(model.points.map(p => p.name)).toEqual(expect.arrayContaining(['FoldX', 'ThermoMPNN', 'StabilityOracle']));
  });

  it('keeps the confidence note beside the estimates on the Comparison tab', () => {
    expect(energeticsComparisonCautions(lowConfidence).join(' ')).toContain('pLDDT 27.2');
  });

  it('does not state a combined direction in the finding sentence or the summary lead', () => {
    expect(energeticsComparisonFinding(lowConfidence)).not.toMatch(/predict|destabilis/i);
    expect(energeticsSummary(lowConfidence).lead).toBe(headline);
  });

  it.each([
    [49.9, 'very-low-plddt'],
    [50, null],
    [50.1, null],
  ])('withholds only below 50: pLDDT %s gives %s', (plddt, reason) => {
    const evidence = buildEnergeticsEvidence({ foldingEnergetics: settled, foldingStatus: 'success', plddt });
    expect(evidence.withheldReason).toBe(reason);
  });

  it('is not withheld for a low-confidence value that is still in the Low band', () => {
    const low = buildEnergeticsEvidence({ foldingEnergetics: settled, foldingStatus: 'success', plddt: 60 });
    expect(low.withheldReason).toBeNull();
    expect(energeticsComparisonHeadline(low)).not.toMatch(/^No stability conclusion/);
  });

  it('is not withheld when the structure is an experimental template, where the AlphaFold pLDDT does not describe it', () => {
    const experimental = buildEnergeticsEvidence({
      foldingEnergetics: { ...settled, structureProvenance: { source: 'experimental', chainId: 'A' } },
      foldingStatus: 'success',
      plddt: ABCG1_LIKE_PLDDT,
    });
    expect(experimental.withheldReason).toBeNull();
  });
});
