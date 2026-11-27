import { describe, expect, it } from 'vitest';
import { buildEnergeticsEvidence } from '../energeticsEvidence';
import { buildEnergeticsComparison, energeticsComparisonFinding } from '../energeticsComparison';
import { FOLDX_HOW_TO_READ, fixShellOffsetNote, foldxBandCaveat } from '../foldxRepairMode';
import { buildPackingEvidence } from '../packingEvidence';

describe('B3: "predict no destabilisation" needs a method that predicts it', () => {
  it('does not name a "no destabilisation" method when none is in the list', () => {
    // Three moderate readings and one past its destabilizing mark: a majority with an exception on the other side.
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: {
        foldx: 1.2, foldxMean: 1.2, rasp: 0.8, thermompnn: 0.9, raspStatus: 'done',
        stabilityoracle: 3.0, stabilityoracleStatus: 'done',
      },
      foldingStatus: 'success',
      thermompnnStatus: 'done',
    });
    expect(ev.agreement.direction).toBe('mostly-moderate');
    expect(ev.agreement.notDestabilizing).toHaveLength(0);
    const finding = energeticsComparisonFinding(ev);
    expect(finding).not.toMatch(/predicts? no destabilisation/);
    expect(finding).toContain('StabilityOracle is past the destabilizing mark');
  });
});

describe('B14 and B26: one count and plain wording', () => {
  it('says "1 displayed method has no estimate" in the singular', () => {
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, rasp: 1.5, stabilityoracle: 0.5 },
      foldingStatus: 'success',
      thermompnnStatus: 'error',
    });
    const summary = buildEnergeticsComparison(ev, 'kcal/mol').summary;
    expect(summary).toContain('1 displayed method has no estimate.');
    expect(summary).not.toContain('methods have');
  });

  it('counts engine estimates without the ProtVar cross-check in the engine count', () => {
    const ev = buildEnergeticsEvidence({
      foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, rasp: 1.5, stabilityoracle: 0.5, thermompnn: 0.9, protvar: 2.5 },
      foldingStatus: 'success',
      thermompnnStatus: 'done',
    });
    const summary = buildEnergeticsComparison(ev, 'kcal/mol').summary;
    expect(summary).toMatch(/^4 engine estimates are shown/);
    expect(summary).toContain('ProtVar');
  });
});

describe('B16: the repair-mode text follows the chosen unit', () => {
  it('writes the local-repair offset in kJ/mol when the user chose kJ/mol', () => {
    const text = fixShellOffsetNote('kJ/mol');
    expect(text).toContain('kJ/mol');
    expect(text).not.toContain('kcal/mol');
  });

  it('writes the method note and the band caveat in kJ/mol when the user chose kJ/mol', () => {
    expect(FOLDX_HOW_TO_READ('kJ/mol')).not.toContain('kcal/mol');
    expect(foldxBandCaveat(true, 'kJ/mol')).not.toContain('kcal/mol');
  });

  it('keeps kcal/mol wording by default', () => {
    expect(fixShellOffsetNote('kcal/mol')).toContain('kcal/mol');
  });
});

describe('B15: each FoldX error test is named once, with one number', () => {
  it('does not repeat the local-repair test error inside the offset note', () => {
    expect(fixShellOffsetNote('kcal/mol')).not.toMatch(/typical error/);
  });
});

describe('packing readings follow the chosen unit', () => {
  const fe = { vdw: 2.5, electrostatics: -0.3 };
  it('converts the values, the marks and the unit label to kJ/mol', () => {
    const packing = buildPackingEvidence({ foldingEnergetics: fe, unit: 'kJ/mol' });
    const vdw = packing.readings.find(r => r.key === 'vdw')!;
    expect(vdw.unit).toBe('kJ/mol');
    expect(vdw.text).toBe('+10.46');
    expect(vdw.value).toBeCloseTo(10.46, 2);
    expect(vdw.marks[0].label).toContain('kJ/mol');
    expect(vdw.marks[0].value).toBeCloseTo(8.37, 2);
  });

  it('still makes the clash call on the kcal/mol mark, whatever the display unit', () => {
    const packing = buildPackingEvidence({ foldingEnergetics: fe, unit: 'kJ/mol' });
    expect(packing.readings.find(r => r.key === 'vdw')!.call?.label).toBe('Above clash mark');
  });

  it('keeps kcal/mol by default', () => {
    const vdw = buildPackingEvidence({ foldingEnergetics: fe }).readings.find(r => r.key === 'vdw')!;
    expect(vdw.unit).toBe('kcal/mol');
    expect(vdw.text).toBe('+2.50');
  });
});
