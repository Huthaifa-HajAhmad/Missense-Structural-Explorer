import { describe, expect, it } from 'vitest';
import { buildInterfacesEvidence } from '../interfacesEvidence';
import { interfaceWorkspaceReadings } from '../mechanismWorkspace';
import { SOD1_INTERFACES as F } from './fixtures/sod1Interfaces';

const interfaces = () => buildInterfacesEvidence({ result: F.result, assembly: F.assembly, assemblyStatus: 'ready', ppi: F.ppi, ppiStatus: 'ready', shift: null, shiftLoading: false });

describe('binding change row follows the chosen energy unit', () => {
  it('converts the ΔΔG_bind value and names the unit in its label, in kJ/mol', () => {
    const ev = interfaces();
    ev.binding.value = -0.5;
    const row = interfaceWorkspaceReadings(ev, 'kJ/mol').find(r => r.key === 'binding-change')!;
    expect(row.facts?.find(f => f.label.startsWith('ΔΔG_bind'))).toEqual({ label: 'ΔΔG_bind (kJ/mol)', value: '-2.09' });
  });

  it('keeps kcal/mol by default', () => {
    const ev = interfaces();
    ev.binding.value = -0.5;
    const row = interfaceWorkspaceReadings(ev).find(r => r.key === 'binding-change')!;
    expect(row.facts?.find(f => f.label.startsWith('ΔΔG_bind'))).toEqual({ label: 'ΔΔG_bind (kcal/mol)', value: '-0.50' });
  });
});
