// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { createEvidenceContextSlice, type EvidenceContextSlice } from './evidenceContextSlice';
import { emptyPhenotypeSelection } from '../../shared/phenotypeFrame';
const makeStore = () => create<EvidenceContextSlice>()(createEvidenceContextSlice);
beforeEach(() => sessionStorage.clear());
describe('per-variant browser-session selection', () => {
  it('restores the same variant after reload without leaking selections to a different variant', () => {
    const key = 'FGFR3|P22607|p.Gly380Arg';
    makeStore().getState().setPhenotypeSelection(key, { ...emptyPhenotypeSelection(), diseaseKey: 'exact-frame', systems: ['skeletal'], onset: 'congenital' });
    const restored = makeStore(); restored.getState().loadPhenotypeSelection(key); restored.getState().loadPhenotypeSelection('FGFR3|P22607|p.Lys650Glu');
    expect(restored.getState().phenotypeSelections[key]).toMatchObject({ diseaseKey: 'exact-frame', systems: ['skeletal'], onset: 'congenital' });
    expect(restored.getState().phenotypeSelections['FGFR3|P22607|p.Lys650Glu']).toEqual(emptyPhenotypeSelection());
  });
  it('ignores invalid stored data', () => {
    sessionStorage.setItem('mse.evidenceContext.v1:TEST', '{invalid');
    const store = makeStore(); store.getState().loadPhenotypeSelection('TEST');
    expect(store.getState().phenotypeSelections.TEST).toEqual(emptyPhenotypeSelection());
  });
});
