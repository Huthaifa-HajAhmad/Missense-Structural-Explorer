// @vitest-environment jsdom
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
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
  it('gives unique expression and species content its own topic without duplicating measurements', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sampling & coverage' }));
    expect(screen.getByRole('columnheader', { name: 'RNA samples' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Median TPM' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Protein Atlas' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Protein measurements' }));
    expect(screen.getByRole('heading', { name: 'Protein Atlas' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'RNA samples' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Expression at variant' }));
    expect(screen.getByRole('heading', { name: 'Base-level pext' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Protein Atlas' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go species' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Protein alignments' }));
    expect(screen.getByRole('heading', { name: 'Residue in orthologs' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Curated model phenotypes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Phenotype annotations' }));
    expect(screen.getByRole('heading', { name: 'Curated model phenotypes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Residue in orthologs' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    expect(screen.getByRole('tab', { name: 'Expression at variant' })).toHaveAttribute('aria-selected', 'true');
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
  it('expands every chart record and recovers a pin beyond the initial twenty', async () => {
    const f = contextWorkspaceFixture('Dense expression'); store.setState(f.state);
    render(<Harness result={f.result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    const chart = await screen.findByRole('img', { name: /Adult tissue expression/ }, { timeout: 8000 });
    expect(chart).not.toHaveTextContent('Illustrative tissue 54');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show all 54 records' })); });
    expect(chart).toHaveTextContent('Illustrative tissue 54');
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Sampling & coverage' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Illustrative tissue 54' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show first 20' })); });
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Tissue explorer' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show pinned record' })); });
    expect(screen.getByRole('button', { name: 'Illustrative tissue 54' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('Illustrative tissue 54');
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
  it('opens system choices explicitly and does not trap the view when its last selected system is removed', async () => {
    const f = contextWorkspaceFixture('Dense expression'); store.setState(f.state);
    render(<Harness result={f.result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    const filter = screen.getByRole('checkbox', { name: 'Selected systems only' });
    expect(filter).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose systems' }));
    const systems = screen.getByRole('group', { name: 'Review systems' });
    expect(systems.contains(document.activeElement)).toBe(true);
    const choice = within(systems).getAllByRole('button')[0];
    act(() => { fireEvent.click(choice); });
    act(() => { fireEvent.click(filter); });
    act(() => { fireEvent.click(choice); });
    expect(filter).toBeDisabled();
    expect(filter).not.toBeChecked();
    await screen.findByRole('img', { name: /Adult tissue expression/ }, { timeout: 8000 });
    expect(screen.getByText('20 of 54 records shown.')).toBeInTheDocument();
  });
  it('uses pediatric availability in the finding and rail without empty exploration controls', async () => {
    const f = contextWorkspaceFixture('Pediatric unavailable'); store.setState(f.state);
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => f.state.developmentalContexts!.SOD1.data });
    render(<Harness result={f.result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Pediatric RNA' }));
    await waitFor(() => expect(screen.getByTestId('expression-finding')).toHaveTextContent('Pediatric measurements are not available here'));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Sampled age cohort' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Linear TPM scale/)).not.toBeInTheDocument();
    const trace = screen.getByText('Review context and reading', { selector: 'summary' }).closest('details')!;
    act(() => {
      trace.open = true;
      fireEvent(trace, new Event('toggle'));
    });
    await waitFor(() => expect(screen.getByTestId('context-trace')).toHaveTextContent('Pediatric measurements are not available here'));
    expect(screen.getByTestId('context-trace')).not.toHaveTextContent('Highest in');
  });
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
    fireEvent.click(screen.getByRole('tab', { name: 'Sampling & coverage' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Panel A' }));
    expect(inspector().getByRole('heading', { name: 'Panel A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go gene' }));
    expect(screen.getByRole('button', { name: 'Records' })).toHaveAttribute('aria-pressed', 'true');
    expect(inspector().getByRole('heading', { name: 'Panel A' })).toBeInTheDocument();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
  it('filters tissue records without losing a pin, retains the cohort on navigation, and clears for a new variant', () => {
    const f = contextWorkspaceFixture(); const rendered = render(<Harness result={f.result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sampling & coverage' }));
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
  it('keeps dosage loading, failure, retry and verified absence in sync without blocking disease review', async () => {
    const f = contextWorkspaceFixture();
    f.disease.frames = f.disease.frames.slice(0, 1);
    for (const selection of Object.values(f.state.phenotypeSelections!)) selection.diseaseKey = null;
    f.state.dosageContexts = {};
    store.setState(f.state);
    let finish!: (value: unknown) => void;
    fetchWithAuth.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Harness result={f.result} />);
    const dosage = () => within(screen.getByTestId('dosage-card'));
    const source = () => within(screen.getByTestId('context-sources')).getByText('ClinGen dosage').closest('details')!;
    expect(dosage().getByRole('status')).toHaveTextContent('Running');
    expect(source()).toHaveTextContent('Running');
    expect(source()).not.toHaveTextContent('No result');
    fireEvent.click(screen.getByRole('button', { name: 'Review this disease' }));
    expect(screen.getByRole('region', { name: 'Submitted validity assertion matrix' })).toBeInTheDocument();
    await act(async () => finish({ ok: true, json: async () => ({ gene: 'SOD1', status: 'error', record: null, provenance: null, message: 'ClinGen dosage request timed out.' }) }));
    expect(source()).toHaveTextContent('Provider error');
    fireEvent.click(screen.getByRole('tab', { name: 'Dosage' }));
    expect(dosage().getByRole('status')).toHaveTextContent('timed out');
    fireEvent.click(dosage().getByRole('button', { name: 'Try again' }));
    expect(dosage().getByRole('status')).toHaveTextContent('Running');
    expect(source()).toHaveTextContent('Running');
    expect(dosage().queryByRole('button')).not.toBeInTheDocument();
    await act(async () => finish({ ok: true, json: async () => ({ gene: 'SOD1', status: 'not-found', record: null,
      provenance: { ...f.disease.provenance!, source: 'ClinGen dosage sensitivity' },
      message: 'No curation for SOD1 in the complete source table. This does not mean copy-number changes are tolerated.' }) }));
    expect(dosage().getByRole('status')).toHaveTextContent('No result');
    expect(dosage().getByText(/Source table retrieved/)).toBeInTheDocument();
    expect(source()).toHaveTextContent('No result');
    expect(source()).not.toHaveTextContent('Provider error');
    expect(dosage().queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Validity' }));
    expect(screen.getByRole('region', { name: 'Submitted validity assertion matrix' })).toBeInTheDocument();
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
  });
  it('keeps category and presentation independent and scopes each finding to its evidence', () => {
    render(<Harness result={contextWorkspaceFixture('Differing assertions').result} />);
    const tabs = screen.getByRole('tablist', { name: 'Gene–disease evidence' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Validity', 'Dosage', 'Mechanism', 'Variant context']);
    fireEvent.click(screen.getByRole('button', { name: 'Records' }));
    expect(screen.getByRole('tab', { name: 'Validity' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('dosage-card')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Dosage' }));
    expect(screen.queryByTestId('gene-disease-finding')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Validity presentation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Mechanism' }));
    expect(screen.getByRole('heading', { name: 'Disease mechanism' })).toBeInTheDocument();
    expect(screen.queryByTestId('dosage-card')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Variant context' }));
    expect(screen.getByTestId('variant-locus-card')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Validity' }));
    expect(screen.getByRole('button', { name: 'Records' })).toHaveAttribute('aria-pressed', 'true');
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
  it('names the single disease before explicit selection, preserving gene-level dosage', () => {
    const f = contextWorkspaceFixture();
    f.disease.frames = f.disease.frames.slice(0, 1);
    for (const selection of Object.values(f.state.phenotypeSelections!)) selection.diseaseKey = null;
    store.setState(f.state);
    render(<Harness result={f.result} />);
    const choice = within(screen.getByRole('region', { name: 'Disease context' }));
    expect(choice.getByRole('heading', { name: f.disease.frames[0].label })).toBeInTheDocument();
    expect(choice.getByText(/Autosomal dominant/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByTestId('dosage-card')).toBeInTheDocument();
    fireEvent.click(choice.getByRole('button', { name: 'Review this disease' }));
    expect(screen.getByRole('tab', { name: 'Validity' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Review SOD1 for' })).toHaveValue(f.disease.frames[0].key);
    expect(screen.getByRole('tab', { name: 'Validity' })).toHaveFocus();
    fireEvent.click(screen.getByRole('tab', { name: 'Variant context' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Review SOD1 for' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review this disease' }));
    expect(screen.getByRole('tab', { name: 'Validity' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Validity' })).toHaveFocus();
  });
  it('offers one source entry per provider and pins a submitter idempotently', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    const sources = within(screen.getByTestId('context-sources'));
    for (const name of ['GenCC validity', 'Gene2Phenotype mechanism', 'ClinGen dosage']) {
      expect(sources.getAllByText(name)).toHaveLength(1);
    }
    expect(sources.queryByText('Read')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review overview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Panel A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Panel A' }));
    expect(screen.getByRole('button', { name: 'Panel A' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Panel A' }).closest('tr')).toHaveAttribute('data-selected', 'true');
    expect(screen.queryByRole('heading', { name: 'Review overview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear pin' }));
    expect(screen.getByRole('heading', { name: 'Review overview' })).toBeInTheDocument();
  });
  it('restores a hidden pin to its source and keyboard target without fetching', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Panel C: Disputed Evidence' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Dosage' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tab to a record/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show pinned record' }));
    const point = screen.getByRole('button', { name: 'Panel C' });
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
  it('keeps classification reference collapsed and persists explicitly expanded reference material', () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    expect(screen.queryByRole('list', { name: /GenCC classification scale/ })).not.toBeInTheDocument();
    const trace = screen.getByText('Reference & methods', { selector: 'summary' }).closest('details')!;
    trace.open = true; fireEvent(trace, new Event('toggle'));
    expect(screen.getByRole('list', { name: /GenCC classification scale/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go gene' }));
    expect(screen.getByRole('list', { name: /GenCC classification scale/ })).toBeInTheDocument();
  });
});
