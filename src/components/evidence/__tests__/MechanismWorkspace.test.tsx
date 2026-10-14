// @vitest-environment jsdom
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EvidenceWorkspaceProvider } from '../EvidenceWorkspace';
import { InterfacesTab } from '../InterfacesTab';
import { SplicingTab } from '../SplicingTab';
import { InterfacesRail } from '../../inspector/InterfacesRail';
import { SplicingRail } from '../../inspector/SplicingRail';
import { mechanismWorkspaceFixture } from '../../../test/mechanismWorkspaceFixture';
import { resetInterfacesLive } from '../interfaces/interfacesLive';
import type { AnalysisResult } from '../../../types';

vi.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ settings: {}, openSettingsTab: vi.fn() }) }));
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth: fetch }), extractErrorMessage: async () => 'Provider error' }));
vi.mock('../../../stores/useVariantAnalysisStore', () => ({ useVariantAnalysisStore: Object.assign((sel: any) => sel({ analysisState: { isLoading: false } }), { getState: () => ({ analysisState: null, setAnalysisState: vi.fn() }) }) }));
vi.mock('../../../services/pipeline/variantCache', () => ({ setCachedVariant: vi.fn() }));

function Body({ result, initial }: { result: AnalysisResult; initial: 'interfaces' | 'splicing' }) {
  const [tab, setTab] = useState(initial);
  return <><button onClick={() => setTab(tab === 'interfaces' ? 'splicing' : 'interfaces')}>Change tab</button>
    {tab === 'interfaces' ? <><InterfacesTab {...{ analysisState: { result, isLoading: false } } as any} /><InterfacesRail analysisResult={result} /></>
      : <><SplicingTab {...{ analysisState: { result, isLoading: false } } as any} /><SplicingRail analysisResult={result} /></>}
  </>;
}
function Fixture({ result, initial = 'interfaces' }: { result: AnalysisResult; initial?: 'interfaces' | 'splicing' }) {
  return <EvidenceWorkspaceProvider result={result}><Body result={result} initial={initial} /></EvidenceWorkspaceProvider>;
}
beforeEach(() => { resetInterfacesLive(); window.history.replaceState(null, '', '/'); });

describe('Mechanism workspaces', () => {
  it('pins a fibril reading, retains it under hidden layers, and explicitly hands focus to its source record', () => {
    render(<Fixture result={mechanismWorkspaceFixture('SOD1')} />);
    fireEvent.click(within(screen.getByTestId('interface-track')).getByRole('button', { name: 'SOD1 fibril' }));
    const inspector = screen.getByRole('region', { name: 'Selected evidence reading' });
    expect(inspector).toHaveTextContent('4 of 15');
    fireEvent.click(screen.getByRole('button', { name: 'Fibril contacts 1' }));
    expect(screen.getByText(/outside the current view or filter/)).toBeInTheDocument();
    expect(inspector).toHaveTextContent('4 of 15');
    fireEvent.click(screen.getByRole('button', { name: 'Show selected reading' }));
    expect(screen.getByRole('tab', { name: 'Source records' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toHaveTextContent('SOD1 fibril');
  });
  it('restores partner search and pin across tab navigation, then resets for another allele', () => {
    const result = mechanismWorkspaceFixture('SOD1');
    const view = render(<Fixture result={result} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Partners' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ZXDC' } });
    fireEvent.click(within(screen.getByTestId('partner-grid')).getByRole('button', { name: 'ZXDC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change tab' }));
    expect(screen.getByRole('searchbox')).toHaveValue('ZXDC');
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('ZXDC');
    const next = structuredClone(result);
    next.metadata!.variant = 'p.Ala5Gly';
    next.ppiBindingData!.variant = 'p.Ala5Gly';
    view.rerender(<Fixture result={next} />);
    expect(screen.getByRole('tab', { name: 'Interface map' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Partners' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).not.toHaveTextContent('ZXDC');
  });
  it('retains splice map view through source records and makes unpositioned high scores inspectable', () => {
    render(<Fixture result={mechanismWorkspaceFixture('Missing position')} initial="splicing" />);
    fireEvent.change(screen.getByLabelText('Map view'), { target: { value: '50' } });
    expect(screen.getByRole('option', { name: '0–0.3 (focused range)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Donor loss' }));
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('0.9');
    fireEvent.click(screen.getByRole('tab', { name: 'Splice map' }));
    expect(screen.getByLabelText('Map view')).toHaveValue('50');
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('0.9');
  });
  it('keeps view-tab keyboard focus and allows keyboard selection of a predicted site', () => {
    render(<Fixture result={mechanismWorkspaceFixture('Splice signals')} initial="splicing" />);
    const mark = screen.getByTestId('map-ds_al');
    fireEvent.keyDown(mark, { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('Acceptor loss');
    const tab = screen.getByRole('tab', { name: 'Splice map' });
    tab.focus(); fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Source records' }));
  });
});
