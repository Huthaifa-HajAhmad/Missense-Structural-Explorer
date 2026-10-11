// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SplicingTab } from '../SplicingTab';
import { SplicingRail } from '../../inspector/SplicingRail';
import { EvidenceWorkspaceProvider } from '../EvidenceWorkspace';
import { useVariantAnalysisStore as store } from '../../../stores/useVariantAnalysisStore';
import { splicingWorkspaceFixture } from '../../../test/splicingWorkspaceFixture';
import type { TabComponentProps } from '../types';

const fetchWithAuth = vi.fn();
const updateSetting = vi.fn();
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth }) }));
vi.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { spliceaiWindow: 500 }, updateSetting }) }));

function Harness() {
  const analysisState = store(s => s.analysisState);
  const [visible, setVisible] = useState(true);
  return <EvidenceWorkspaceProvider result={analysisState.result}>
    <button onClick={() => setVisible(!visible)}>Other evidence tab</button>
    {visible && <><SplicingTab {...{ analysisState } as TabComponentProps} /><SplicingRail analysisResult={analysisState.result!} /></>}
  </EvidenceWorkspaceProvider>;
}
const open = (name = 'Reverse strand') => {
  store.setState({ analysisState: { result: splicingWorkspaceFixture(name), isLoading: false, error: null } });
  return render(<Harness />);
};
const inspector = () => screen.getByRole('region', { name: 'Selected evidence reading' });
const pinned = (key: string) => screen.getByTestId(`map-${key}`);
const newScore = (distance = 1000) => ({ ...splicingWorkspaceFixture().conservationData!.spliceai!, ds_al: 0.6, max_ds: 0.6,
  dp: { ds_al: 15 }, provenance: { source: 'broad-lookup', distanceBp: distance, masked: 0, computedLive: true, annotationSet: 'Updated set' } });
const reply = (score = newScore()) => ({ ok: true, json: async () => ({ distance: 1000, spliceai: score, attempted: true }) });

beforeEach(() => { fetchWithAuth.mockReset(); updateSetting.mockReset(); });

describe('linked RNA splicing workspace', () => {
  it('links map, channel comparison, source record and inspector with keyboard selection', () => {
    open();
    fireEvent.keyDown(pinned('ds_al'), { key: 'Enter' });
    expect(pinned('ds_al')).toHaveAttribute('aria-pressed', 'true');
    expect(within(inspector()).getByRole('heading', { name: 'Acceptor loss' })).toBeTruthy();
    expect(inspector()).toHaveTextContent('−25 bp');
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    const source = screen.getByRole('region', { name: 'Splicing source records' });
    expect(within(source).getByRole('button', { name: 'Acceptor loss' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(source).getByRole('button', { name: 'Donor loss' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Splice map' }));
    expect(pinned('ds_dl')).toHaveAttribute('aria-pressed', 'true');
    const comparison = screen.getByTestId('splice-spliceai-ds_dl');
    expect(within(comparison).getByRole('button', { name: 'Donor loss' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(pinned('ds_dl'), { key: 'Home' });
    expect(pinned('ds_al')).toHaveFocus();
    expect(pinned('ds_al')).toHaveAttribute('aria-pressed', 'true');
  });
  it('keeps tablist focus during keyboard navigation', () => {
    open();
    fireEvent.click(pinned('ds_al'));
    const mapTab = screen.getByRole('tab', { name: 'Splice map' });
    mapTab.focus();
    fireEvent.keyDown(mapTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Source records' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Source records' })).toHaveAttribute('aria-selected', 'true');
  });
  it('retains pin, view and map controls across navigation and resets on a same-position allele change', () => {
    open();
    fireEvent.click(pinned('ds_al'));
    fireEvent.change(screen.getByLabelText('Map view'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Show non-zero signals/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByText('Other evidence tab'));
    fireEvent.click(screen.getByText('Other evidence tab'));
    expect(screen.getByRole('tab', { name: 'Source records' })).toHaveAttribute('aria-selected', 'true');
    expect(inspector()).toHaveTextContent('Acceptor loss');
    fireEvent.click(screen.getByRole('tab', { name: 'Splice map' }));
    expect(screen.getByLabelText('Map view')).toHaveValue('200');
    expect(screen.getByRole('checkbox', { name: /Show non-zero signals/ })).toBeChecked();
    act(() => store.setState({ analysisState: { result: splicingWorkspaceFixture('New variant'), isLoading: false, error: null } }));
    expect(inspector()).toHaveTextContent('No reading pinned');
    expect(screen.getByLabelText('Map view')).toHaveValue('auto');
    expect(screen.getByRole('checkbox', { name: /Show non-zero signals/ })).not.toBeChecked();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
  it('updates a pinned channel from a successful re-score even if the visible view changes', async () => {
    open();
    fireEvent.click(pinned('ds_al'));
    let finish!: (value: unknown) => void;
    fetchWithAuth.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('radio', { name: '±1000' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    await act(async () => { finish(reply()); });
    await waitFor(() => expect(inspector()).toHaveTextContent('0.6'));
    expect(inspector()).toHaveTextContent('±1000 bp');
    expect(inspector()).toHaveTextContent('−15 bp');
    expect(inspector()).toHaveTextContent('Raw');
    expect(inspector()).toHaveTextContent('Updated set');
    expect(screen.getByRole('radio', { name: '±1000' })).toHaveAttribute('aria-checked', 'true');
  });
  it('keeps a failed re-score from changing the pin, score or provenance', async () => {
    open();
    fireEvent.click(pinned('ds_al'));
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ distance: 1000, attempted: true, spliceai: null, spliceaiFailure: { kind: 'timeout' } }) });
    fireEvent.click(screen.getByRole('radio', { name: '±1000' }));
    await waitFor(() => expect(screen.getByTestId('splice-window')).toHaveTextContent('Kept ±500 bp'));
    expect(inspector()).toHaveTextContent('0.3');
    expect(inspector()).toHaveTextContent('±500 bp');
    expect(inspector()).toHaveTextContent('Masked');
    expect(updateSetting).not.toHaveBeenCalled();
  });
  it('discards a late response after switching alleles', async () => {
    open();
    let finish!: (value: unknown) => void;
    fetchWithAuth.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('radio', { name: '±1000' }));
    act(() => store.setState({ analysisState: { result: splicingWorkspaceFixture('New variant'), isLoading: false, error: null } }));
    await act(async () => { finish(reply()); });
    expect(store.getState().analysisState.result?.conservationData?.spliceai?.max_ds).toBe(0.3);
    expect(updateSetting).not.toHaveBeenCalled();
    expect(screen.getByTestId('splice-window')).not.toHaveTextContent('Re-scoring');
  });
  it.each(['response distance', 'score provenance'])('retains the previous score when the %s identifies another window', async field => {
    open();
    fireEvent.click(pinned('ds_al'));
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({
      distance: field === 'response distance' ? 500 : 1000,
      spliceai: newScore(field === 'score provenance' ? 500 : 1000), attempted: true,
    }) });
    fireEvent.click(screen.getByRole('radio', { name: '±1000' }));
    await waitFor(() => expect(screen.getByTestId('splice-window')).toHaveTextContent('did not identify the requested reporting window'));
    expect(inspector()).toHaveTextContent('0.3');
    expect(inspector()).toHaveTextContent('±500 bp');
    expect(updateSetting).not.toHaveBeenCalled();
  });
  it('shows the returned reporting window for a precomputed source without substituting a saved default', () => {
    const result = splicingWorkspaceFixture();
    result.conservationData!.spliceai!.provenance = { source: 'precomputed-dbnsfp', distanceBp: 50 };
    store.setState({ analysisState: { result, isLoading: false, error: null } });
    render(<Harness />);
    expect(screen.getByRole('radio', { name: '±50' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('splice-window')).not.toHaveTextContent('not stated');
  });
  it.each(['Zero', 'Missing', 'Unknown strand', 'Missing positions'])('keeps %s inspectable without inventing a plotted location', name => {
    open(name);
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Acceptor loss' }));
    expect(inspector()).toHaveTextContent(name === 'Zero' ? 'Measured zero' : name === 'Missing' ? 'No score returned' : name === 'Unknown strand' ? 'Strand unresolved' : 'Delta position not reported');
  });
});
