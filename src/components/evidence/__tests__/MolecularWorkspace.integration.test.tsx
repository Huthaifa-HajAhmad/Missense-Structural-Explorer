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
  it('gives each perturbation view its own question without repeating the model comparison', () => {
    render(<Harness result={molecularWorkspaceFixture()} tab="perturbation" />);
    expect(screen.getByTestId('ptb-primer')).toBeInTheDocument();
    expect(screen.getByTestId('perturbation-finding')).toHaveTextContent('Each model hides that residue');
    fireEvent.click(screen.getByRole('tab', { name: 'Packing & geometry' }));
    expect(screen.queryByTestId('perturbation-finding')).not.toBeInTheDocument();
    // The language-model primer belongs to the language-model views only.
    expect(screen.queryByTestId('ptb-primer')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What changed in the modelled protein structure?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Sequence embeddings' }));
    expect(screen.queryByTestId('perturbation-finding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ptb-primer')).not.toBeInTheDocument();
    expect(screen.getByText(/An embedding is a list of numbers/)).toBeInTheDocument();
    // Unmeasured residues stay gaps: listed as such, never drawn or tabulated as 0.
    const profile = screen.getByTestId('ptb-embedding-profile');
    expect(profile).toHaveTextContent('Measured at 130 of 140 residues');
    expect(within(profile).getAllByText('Not measured')).toHaveLength(10);
    expect(profile.querySelector('svg path:nth-of-type(2)')!.getAttribute('d')).not.toMatch(/NaN/);
    expect(within(profile).getByRole('region', { name: 'Exact changes by position' })).toHaveAttribute('tabindex', '0');
  });
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
  it('names a language model whose row was taken from settings, in the workspace as well as the table', () => {
    const result = molecularWorkspaceFixture();
    const unnamed = { ...result, saprotEval: { ...(result as any).saprotEval, provenance: undefined } } as unknown as AnalysisResult;
    render(<Harness result={unnamed} tab="perturbation" />);
    expect(screen.getByTestId('ptb-caveat-saprot')).toHaveTextContent(/taken from your settings, not from what ran/);
  });
  it('pins a probability through the real chart, then selects the same model-specific record', async () => {
    render(<Harness result={molecularWorkspaceFixture()} tab="perturbation" />);
    // ResidueDetail lazy-loads the real chart stack. A one-second DOM query deadline can expire
    // during parallel suite/build load before that module resolves; keep a bounded wait and all
    // of the real chart's keyboard, pin and record assertions.
    const chart = await screen.findByRole('img', { name: /SaProt: amino-acid preferences/ }, { timeout: 10_000 });
    fireEvent.focus(chart); fireEvent.keyDown(chart, { key: 'Home' }); fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(inspector().getByRole('button', { name: 'Clear pin' })).toBeInTheDocument());
    const pinned = inspector().getByRole('heading', { level: 3 }).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Show all 20 residues' }));
    expect(screen.getByText(/20 of 20 returned residues/)).toBeInTheDocument();
    expect(inspector().getByRole('heading', { level: 3 }).textContent).toBe(pinned);
    fireEvent.click(screen.getByRole('button', { name: 'Show overview' }));
    expect(screen.getByText(/7 of 20 returned residues/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 20 residues' }));
    // The comparison exposes every residue, including probabilities too small to target reliably.
    const picker = screen.getByRole('combobox', { name: 'Inspect amino acid' });
    const glycine = within(picker).getByRole('option', { name: /G/ }) as HTMLOptionElement;
    fireEvent.change(picker, { target: { value: glycine.value } });
    expect(inspector().getByRole('heading', { name: 'SaProt · G' })).toBeInTheDocument();
    expect(inspector().getByText('0.0004')).toBeInTheDocument();
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

  it('does not call a model picked in the strip a reading outside the probability chart', async () => {
    render(<Harness result={molecularWorkspaceFixture()} tab="perturbation" />);
    await screen.findByRole('img', { name: /SaProt: amino-acid preferences/ }, { timeout: 10_000 });
    // The strip picks the model id, which is an inspector row but not a dot on the chart.
    fireEvent.click(screen.getByRole('button', { name: /^ESM-2/ }));
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
