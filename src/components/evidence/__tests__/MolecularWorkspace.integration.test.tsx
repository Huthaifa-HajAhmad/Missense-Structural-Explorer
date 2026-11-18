// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FunctionTab } from '../function/FunctionTab';
import { StructureTab } from '../StructureTab';
import { FunctionRail } from '../../inspector/FunctionRail';
import { ResidueShiftInspector } from '../../inspector/ResidueShiftInspector';
import { EvidenceWorkspaceProvider } from '../EvidenceWorkspace';
import { molecularWorkspaceFixture } from '../../../test/molecularWorkspaceFixture';
import type { TabComponentProps } from '../types';
import type { AnalysisResult } from '../../../types';

vi.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ settings: {}, updateSetting: vi.fn(), openSettingsTab: vi.fn() }) }));
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth: vi.fn() }) }));
function Harness({ tab = 'function', result }: { tab?: string; result: AnalysisResult }) {
  const props = { analysisState: { result, isLoading: false, error: null }, setSelectedMetric: vi.fn() } as unknown as TabComponentProps;
  return <EvidenceWorkspaceProvider result={result}>
    {tab === 'function' ? <><FunctionTab {...props} /><FunctionRail analysisResult={result} /></> : <><StructureTab {...props} /><ResidueShiftInspector analysisResult={result} /></>}
  </EvidenceWorkspaceProvider>;
}
const inspector = () => within(screen.getByRole('region', { name: 'Selected evidence reading' }));

describe('molecular workspace interaction contracts', () => {
  it('retains the domain pin, window and layers across navigation, then resets for another substitution at the same residue', () => {
    const result = molecularWorkspaceFixture();
    const view = render(<Harness result={result} />);
    fireEvent.click(screen.getByRole('button', { name: /^Illustrative overlap, 90–245 · SMART/ }));
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
    fireEvent.change(screen.getByLabelText('From residue'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('To residue'), { target: { value: '200' } });
    expect(screen.getByRole('button', { name: 'Zoom' })).toBeDisabled();
    // The invalid inputs point a screen reader at the reason, which is a live status.
    const from = screen.getByLabelText('From residue');
    const describedBy = from.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/increasing positions between 1 and 534/);
    fireEvent.change(screen.getByLabelText('To residue'), { target: { value: '400' } });
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
    fireEvent.click(screen.getByRole('tab', { name: 'Environment & pockets' }));
    expect(inspector().getByRole('heading', { name: 'Net charge' })).toBeInTheDocument();
    expect(inspector().getByText('−1')).toBeInTheDocument();
    expect(inspector().getByText('0')).toBeInTheDocument();
  });
  it('shows native values once, with the source and the scale read in the pinned inspector', () => {
    render(<Harness result={molecularWorkspaceFixture()} tab="structure" />);
    // One figure, no second table: the values live on the rows, the provenance in the inspector.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const polarity = screen.getByRole('button', { name: 'Polarity, less polar' });
    expect(polarity).toHaveAccessibleName('Polarity, less polar');
    expect(polarity).toHaveAccessibleDescription('How unevenly the electrical charge is distributed.');
    fireEvent.click(polarity);
    // Pinning states itself in words and never renames the row.
    expect(polarity).toHaveAccessibleName('Polarity, less polar');
    expect(polarity).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Pinned in inspector')).toBeInTheDocument();
    expect(inspector().getByRole('heading', { name: 'Polarity' })).toBeInTheDocument();
    expect(inspector().getByText('Source')).toBeInTheDocument();
    expect(inspector().getByText('Grantham 1974')).toBeInTheDocument();
    expect(inspector().getByText(/Other residues on this scale/)).toBeInTheDocument();
    expect(screen.getAllByText(/glycine frees the backbone/i)).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Environment & pockets' }));
    expect(screen.queryByTestId('residue-glyph-pair')).not.toBeInTheDocument();
    // The records view names the substitution it reports on, without redrawing the figure.
    expect(screen.getByTestId('residue-context-line')).toHaveTextContent('Asp');
    expect(screen.getByTestId('residue-environment')).toBeInTheDocument();
    expect(inspector().getByRole('heading', { name: 'Polarity' })).toBeInTheDocument();
  });
  it('keeps focus on the tablist when the reader moves to Annotation details with the keyboard', () => {
    render(<Harness result={molecularWorkspaceFixture()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Illustrative overlap/ })[0]);
    const records = screen.getByRole('tab', { name: 'Annotation details' });
    records.focus();
    fireEvent.keyDown(screen.getByRole('tablist', { name: /Functional domains views/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Annotation details' })).toHaveAttribute('aria-selected', 'true');
    // Depending on workspace.view alone, the row-focus effect pulled the keyboard user into the table.
    expect(document.activeElement).toBe(records);
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
