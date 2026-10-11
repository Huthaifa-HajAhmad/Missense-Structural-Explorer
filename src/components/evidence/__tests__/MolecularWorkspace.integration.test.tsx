// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FunctionTab } from '../function/FunctionTab';
import { StructureTab } from '../StructureTab';
import { PerturbationTab } from '../PerturbationTab';
import { FunctionRail } from '../../inspector/FunctionRail';
import { ResidueShiftInspector } from '../../inspector/ResidueShiftInspector';
import { PerturbationRail } from '../../inspector/PerturbationRail';
import { EvidenceWorkspaceProvider } from '../EvidenceWorkspace';
import { molecularWorkspaceFixture } from '../../../test/molecularWorkspaceFixture';
import type { TabComponentProps } from '../types';
import type { AnalysisResult } from '../../../types';

vi.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { defaultPerturbationModel: 'saprot', saprotEngine: 'remote-hf' }, updateSetting: vi.fn(), openSettingsTab: vi.fn() }) }));
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth: vi.fn() }) }));
function Harness({ tab = 'function', result }: { tab?: string; result: AnalysisResult }) {
  const props = { analysisState: { result, isLoading: false, error: null }, setSelectedMetric: vi.fn() } as unknown as TabComponentProps;
  return <EvidenceWorkspaceProvider result={result}>
    {tab === 'function' ? <><FunctionTab {...props} /><FunctionRail analysisResult={result} /></> : tab === 'structure' ? <><StructureTab {...props} /><ResidueShiftInspector analysisResult={result} /></> : <><PerturbationTab {...props} /><PerturbationRail analysisResult={result} /></>}
  </EvidenceWorkspaceProvider>;
}
const inspector = () => within(screen.getByRole('region', { name: 'Selected evidence reading' }));

describe('molecular workspace interaction contracts', () => {
  it('retains the domain pin, window and layers across navigation, then resets for another substitution at the same residue', () => {
    const result = molecularWorkspaceFixture();
    const view = render(<Harness result={result} />);
    fireEvent.click(screen.getByRole('button', { name: /Illustrative overlap \(SMART/ }));
    fireEvent.click(screen.getByRole('button', { name: '116 ± 50' }));
    fireEvent.click(screen.getByTestId('layer-variants'));
    expect(inspector().getByRole('heading', { name: 'Illustrative overlap' })).toBeInTheDocument();
    view.rerender(<Harness result={result} tab="structure" />);
    view.rerender(<Harness result={result} />);
    expect(inspector().getByRole('heading', { name: 'Illustrative overlap' })).toBeInTheDocument();
    expect(screen.getByTestId('domain-architecture').querySelector('svg')).toHaveAttribute('data-window', '66-166');
    expect(screen.getByTestId('layer-variants')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'View selected record' }));
    expect(document.activeElement?.closest('tr')).toHaveAttribute('data-row-key', 'match-SMART-DEMO1');
    view.rerender(<Harness result={molecularWorkspaceFixture('New variant')} />);
    expect(inspector().queryByRole('button', { name: 'Clear pin' })).toBeNull();
    expect(screen.getByTestId('domain-architecture').querySelector('svg')).toHaveAttribute('data-window', '1-534');
  });
  it('validates numeric zoom without changing the evidence, and exposes an off-window variant', () => {
    render(<Harness result={molecularWorkspaceFixture()} />);
    const verdict = screen.getByTestId('pm1-verdict').textContent;
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '200' } });
    expect(screen.getByRole('button', { name: 'Apply window' })).toBeDisabled();
    // The invalid inputs point a screen reader at the reason, which is a live status.
    const from = screen.getByLabelText('From');
    const describedBy = from.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/increasing positions between 1 and 534/);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '400' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Protein map window' }));
    expect(screen.getByText(/variant at 116 is outside this window/)).toBeInTheDocument();
    expect(screen.getByTestId('pm1-verdict').textContent).toBe(verdict);
    fireEvent.click(screen.getByRole('button', { name: 'Return to variant' }));
    expect(screen.getByTestId('arch-query')).toBeInTheDocument();
  });
  it('pins a property and keeps its native values through the source-record view', () => {
    render(<Harness result={molecularWorkspaceFixture()} tab="structure" />);
    fireEvent.click(screen.getByRole('button', { name: /Net charge.*loses its negative charge/ }));
    expect(inspector().getByRole('heading', { name: 'Net charge' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    expect(screen.getByRole('button', { name: 'Net charge' })).toHaveAttribute('aria-pressed', 'true');
    expect(inspector().getByText('−1')).toBeInTheDocument();
    expect(inspector().getByText('0')).toBeInTheDocument();
  });
  it('pins a probability through the real chart, then selects the same model-specific record', async () => {
    render(<Harness result={molecularWorkspaceFixture()} tab="perturbation" />);
    // ResidueDetail lazy-loads the real chart stack. A one-second DOM query deadline can expire
    // during parallel suite/build load before that module resolves; keep a bounded wait and all
    // of the real chart's keyboard, pin and record assertions.
    const chart = await screen.findByRole('img', { name: /SaProt: amino-acid preferences/ }, { timeout: 10_000 });
    fireEvent.focus(chart); fireEvent.keyDown(chart, { key: 'Home' }); fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(inspector().getByRole('button', { name: 'Clear pin' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: '20. G' }));
    expect(inspector().getByRole('heading', { name: 'SaProt · G' })).toBeInTheDocument();
    expect(inspector().getByText('0.0004')).toBeInTheDocument();
  });

  it('keeps focus on the tablist when the reader moves to Source records with the keyboard', () => {
    render(<Harness result={molecularWorkspaceFixture()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Illustrative overlap/ })[0]);
    const records = screen.getByRole('tab', { name: 'Source records' });
    records.focus();
    fireEvent.keyDown(screen.getByRole('tablist', { name: /Functional domains views/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Source records' })).toHaveAttribute('aria-selected', 'true');
    // Depending on workspace.view alone, the row-focus effect pulled the keyboard user into the table.
    expect(document.activeElement).toBe(records);
  });

  it('does not call a model picked in the strip a reading outside the probability chart', async () => {
    render(<Harness result={molecularWorkspaceFixture()} tab="perturbation" />);
    await screen.findByRole('img', { name: /SaProt: amino-acid preferences/ }, { timeout: 10_000 });
    // The detail tabs pin the model id, which is an inspector row but not a dot on the chart.
    fireEvent.click(screen.getByRole('button', { name: 'ESM-2' }));
    expect(screen.queryByText(/outside this probability chart/)).toBeNull();
  });

  it('exposes every selectable drawing mark as a button that the arrow keys step', () => {
    render(<Harness result={molecularWorkspaceFixture()} />);
    const domain = screen.getAllByTestId('arch-domain')[0];
    expect(domain).toHaveAttribute('role', 'button');
    expect(domain).toHaveAttribute('tabindex', '-1');
    expect(domain).toHaveAttribute('aria-label');
    const drawing = screen.getByTestId('domain-architecture');
    fireEvent.keyDown(drawing, { key: 'ArrowRight' });
    expect(drawing.querySelector('[data-mark-key][data-selected]')).not.toBeNull();
  });
});
