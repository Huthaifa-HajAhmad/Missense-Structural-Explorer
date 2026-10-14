// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InterfaceTrack } from '../interfaces/InterfaceTrack';
import { buildInterfacesEvidence } from '../../../shared/interfacesEvidence';
import { SOD1_INTERFACES as f } from '../../../shared/__tests__/fixtures/sod1Interfaces';

describe('interface track controls', () => {
  it('offers legacy-table controls only for lanes with corresponding rows', () => {
    const ev = buildInterfacesEvidence({ result: f.result, assembly: f.assembly, assemblyStatus: 'ready', ppi: f.ppi, ppiStatus: 'ready', shift: null, shiftLoading: false });
    // An unlinked lane represents annotation context that has no legacy table row.
    ev.track[0] = { ...ev.track[0], rowKey: null };
    const open = vi.fn();
    const { rerender } = render(<InterfaceTrack ev={ev} onOpen={open} />);
    for (const lane of ev.track) {
      if (lane.rowKey) {
        fireEvent.click(screen.getByRole('button', { name: lane.label }));
        expect(open).toHaveBeenLastCalledWith(lane.rowKey);
      } else expect(screen.queryByRole('button', { name: lane.label })).toBeNull();
    }
    const contextualLane = ev.track.find(l => !l.rowKey)!;
    expect(contextualLane).toBeDefined();
    rerender(<InterfaceTrack ev={ev} onOpen={open} inspectAllLanes />);
    fireEvent.click(screen.getByRole('button', { name: contextualLane.label }));
    expect(open).toHaveBeenLastCalledWith(`track:${contextualLane.key}`);
  });
});
