// @vitest-environment jsdom
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { contextWorkspaceFixture } from '../../../test/contextWorkspaceFixture';
import { useVariantAnalysisStore as store } from '../../../stores/useVariantAnalysisStore';
import { EvidenceWorkspaceProvider } from '../EvidenceWorkspace';
import { GeneDiseaseTab } from '../GeneDiseaseTab';
import { ExpressionModelsTab } from '../ExpressionModelsTab';
import { SpeciesModelsTab } from '../SpeciesModelsTab';
import { EvidenceContextRail } from '../../inspector/EvidenceContextRail';
import type { AnalysisResult } from '../../../types';
import type { TabComponentProps } from '../types';
const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth }) }));

function Harness({ result }: { result: AnalysisResult }) {
  const [tab, setTab] = useState('gene-disease');
  const props = { analysisState: { result, isLoading: false, error: null } } as TabComponentProps;
  return <EvidenceWorkspaceProvider result={result}><button onClick={() => setTab('gene-disease')}>Go gene</button><button onClick={() => setTab('expression-models')}>Go expression</button><button onClick={() => setTab('species-models')}>Go species</button>
    {tab === 'gene-disease' ? <GeneDiseaseTab {...props} /> : tab === 'expression-models' ? <ExpressionModelsTab {...props} /> : <SpeciesModelsTab {...props} />}
    <EvidenceContextRail analysisResult={result} expression={tab === 'expression-models'} species={tab === 'species-models'} />
  </EvidenceWorkspaceProvider>;
}
beforeEach(() => { fetchWithAuth.mockReset(); sessionStorage.clear(); const f = contextWorkspaceFixture(); store.setState({ ...f.state, gene: 'SOD1', variant: f.result.metadata!.variant }); });

describe('production context tabs and linked inspectors', () => {
  it('drills from a species coverage count into that source without collapsing one-to-many records', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go species' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zebrafish: 2 Alliance orthologs' }));
    expect(screen.getByRole('searchbox')).toHaveValue('NCBITaxon:7955');
    expect(within(screen.getByTestId('context-records')).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId('context-records')).getAllByRole('button')[0]);
    const pinned = screen.getByRole('region', { name: 'Selected evidence reading' }).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Mouse: 1 Ensembl alignments' }));
    expect(screen.getByRole('tab', { name: 'Variant site' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/pinned record is outside this view/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Selected evidence reading' }).textContent).toBe(pinned);
  });
  it('pins an adult tissue with the real chart keyboard interaction and preserves its exact zero in records', async () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    // The chart is a lazy chunk; a 1s default findByRole expires under full-suite CPU load.
    const chart = await screen.findByRole('img', { name: /Adult tissue expression/ }, { timeout: 8000 });
    fireEvent.focus(chart); fireEvent.keyDown(chart, { key: 'Home' }); fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Selected evidence reading' })).getByRole('button', { name: 'Clear pin' })).toBeInTheDocument());
    // The pinned record is named, not just "a pinned record": substring assertions once passed while the wrong row was pinned.
    expect(within(screen.getByRole('region', { name: 'Selected evidence reading' })).getByRole('heading', { level: 3 })).toHaveTextContent(/Skeletal/i);
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skeletal muscle' }));
    const inspector = within(screen.getByRole('region', { name: 'Selected evidence reading' }));
    expect(inspector.getByRole('heading', { level: 3 })).toHaveTextContent('Skeletal muscle');
    expect(inspector.getByText('Median TPM (exact)').parentElement).toHaveTextContent(/^Median TPM \(exact\)0$/);
  });
  it('pins an assertion from the matrix and source records, and restores it across navigation', () => {
    const f = contextWorkspaceFixture(); render(<Harness result={f.result} />);
    const matrix = screen.getByRole('region', { name: 'Submitted validity assertion matrix' });
    const columnHeaders = within(matrix).getAllByRole('columnheader').map(h => h.textContent);
    expect(columnHeaders).toEqual(['Submitter', 'Strong', 'Limited', 'Disputed Evidence', 'Evaluated']);
    fireEvent.click(screen.getByRole('button', { name: 'Panel C: Disputed Evidence' }));
    const inspector = () => within(screen.getByRole('region', { name: 'Selected evidence reading' }));
    expect(inspector().getByRole('heading', { name: 'Panel C' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Panel A' }));
    expect(inspector().getByRole('heading', { name: 'Panel A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go gene' }));
    expect(screen.getByRole('tab', { name: 'Source records' })).toHaveAttribute('aria-selected', 'true');
    expect(inspector().getByRole('heading', { name: 'Panel A' })).toBeInTheDocument();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
  it('filters tissue records without losing a pin, retains the cohort on navigation, and clears for a new variant', () => {
    const f = contextWorkspaceFixture(); const rendered = render(<Harness result={f.result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skeletal muscle' }));
    const inspector = within(screen.getByRole('region', { name: 'Selected evidence reading' }));
    expect(inspector.getByRole('heading', { level: 3 })).toHaveTextContent('Skeletal muscle');
    expect(inspector.getByText('Median TPM (exact)').parentElement).toHaveTextContent(/^Median TPM \(exact\)0$/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Liver' } });
    expect(screen.getByText(/pinned record is outside this view/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Pediatric RNA' }));
    const pediatricPanel = document.getElementById('expression-models-sources-panel-developmental')!;
    const cohort = within(pediatricPanel).getByRole('combobox', { name: 'Sampled age cohort' });
    fireEvent.change(cohort, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go species' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    expect(within(document.getElementById('expression-models-sources-panel-developmental')!).getByRole('combobox', { name: 'Sampled age cohort' })).toHaveValue('1');
    const next = contextWorkspaceFixture('New variant'); store.setState(next.state); rendered.rerender(<Harness result={next.result} />);
    expect(screen.getByRole('tab', { name: 'Adult RNA' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('Select a point or source record');
  });
  it('keeps animal source provenance in Species, shows partial annotations, and pins the mapped residue', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go species' }));
    expect(screen.getByText(/returned phenotype summaries could not be resolved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Variant site' }));
    const records = within(screen.getByTestId('context-records'));
    fireEvent.click(records.getByRole('button', { name: /Mouse.*ENSG0/ }));
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('Q3');
    const sources = within(screen.getByTestId('context-sources'));
    expect(sources.getByText('Ensembl protein alignment')).toBeInTheDocument();
    expect(sources.queryByText('GTEx adult tissues')).not.toBeInTheDocument();
  });
});


describe('gene-disease review states', () => {
  it('restores a hidden pin to its source and keyboard target without fetching', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Panel C: Disputed Evidence' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Gene dosage' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tab to a record/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show pinned record' }));
    const point = screen.getByRole('button', { name: 'Panel C: Disputed Evidence' });
    expect(point).toHaveFocus();
    expect(point).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('Panel C');
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
  it('offers disease selection without empty search or record instructions', () => {
    const f = contextWorkspaceFixture();
    for (const selection of Object.values(f.state.phenotypeSelections!)) selection.diseaseKey = null;
    store.setState(f.state);
    render(<Harness result={f.result} />);
    expect(screen.getByRole('combobox', { name: 'Review SOD1 for' })).toHaveValue('');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/records shown/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tab to a record/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Submitted validity assertion matrix' })).not.toBeInTheDocument();
  });
  it('keeps classification reference collapsed and persists an explicitly expanded trace', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    expect(screen.queryByRole('list', { name: /GenCC classification scale/ })).not.toBeInTheDocument();
    const trace = screen.getByText('Review trace', { selector: 'summary' }).closest('details')!;
    trace.open = true; fireEvent(trace, new Event('toggle'));
    expect(screen.getByTestId('context-trace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go gene' }));
    expect(screen.getByTestId('context-trace')).toBeInTheDocument();
  });
});
