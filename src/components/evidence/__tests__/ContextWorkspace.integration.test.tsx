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
  it('pins an adult tissue with the real chart keyboard interaction and preserves its exact zero in records', async () => {
    render(<Harness result={contextWorkspaceFixture().result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    const chart = await screen.findByRole('img', { name: /Adult tissue expression/ });
    fireEvent.focus(chart); fireEvent.keyDown(chart, { key: 'Home' }); fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Selected evidence reading' })).getByRole('button', { name: 'Clear pin' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skeletal muscle' }));
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('Median TPM (exact)0');
  });
  it('pins an assertion from the matrix and source records, and restores it across navigation', () => {
    const f = contextWorkspaceFixture(); render(<Harness result={f.result} />);
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
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('0');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Liver' } });
    expect(screen.getByText(/pinned record is outside this view/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Pediatric RNA' }));
    const cohort = screen.getAllByRole('combobox', { name: 'Sampled age cohort' })[0];
    fireEvent.change(cohort, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go species' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go expression' }));
    expect(screen.getAllByRole('combobox', { name: 'Sampled age cohort' })[0]).toHaveValue('1');
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
