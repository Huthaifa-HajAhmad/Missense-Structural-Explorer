// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import ViewInspector from '../../inspector/ViewInspector';
import { SettingsProvider } from '../../../context/SettingsContext';
import { ClinicalTab } from '../ClinicalTab';
import { PredictorsTab } from '../PredictorsTab';
import { AlphaGenomeTab } from '../AlphaGenomeTab';
import { PopulationRail } from '../../inspector/PopulationRail';
import { PredictorsRail } from '../../inspector/PredictorsRail';
import { AlphaGenomeRail } from '../../inspector/AlphaGenomeRail';
import { EvidenceWorkspaceProvider, EvidenceViewTabs } from '../EvidenceWorkspace';
import { evidenceWorkspaceFixture } from '../../../test/evidenceWorkspaceFixture';
import type { TabComponentProps } from '../types';

vi.mock('../../../context/SettingsContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context/SettingsContext')>();
  return { ...actual, useSettings: () => ({ settings: { alphagenomeApiKey: '' }, openSettingsTab: vi.fn() }) };
});
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth: vi.fn() }) }));

const cases = [
  { name: 'Population', Tab: ClinicalTab, Rail: PopulationRail, title: /How often is this allele observed/, record: /gnomAD exomes/, pinned: /gnomAD exomes/ },
  { name: 'Predictors', Tab: PredictorsTab, Rail: PredictorsRail, title: /Where do the predictors agree/, record: /^REVEL$/, pinned: /^REVEL$/ },
  { name: 'AlphaGenome', Tab: AlphaGenomeTab, Rail: AlphaGenomeRail, title: /What contributes to this score/, record: /^AlphaMissense$/, pinned: /^AlphaMissense$/ },
];
describe('Production evidence tabs and their inspectors', () => {
  // The first case pays the cold React.lazy + transform cost of the chart chunk; the testing-library
  // default of 1s expired intermittently under a loaded worker and made this suite flaky.
  const FIND = { timeout: 6000 } as const;

  it.each(cases)('$name connects chart and source-record selections to the same inspector', async ({ Tab, Rail, title, record, pinned }) => {
    const result = evidenceWorkspaceFixture('Partial');
    const props = { analysisState: { result, isLoading: false, error: null } } as TabComponentProps;
    render(<EvidenceWorkspaceProvider result={result}><Tab {...props} /><Rail analysisResult={result} /></EvidenceWorkspaceProvider>);
    const chart = await screen.findByRole('img', { name: title }, FIND);
    fireEvent.focus(chart); fireEvent.keyDown(chart, { key: 'Home' }); fireEvent.keyDown(chart, { key: 'Enter' });
    const inspector = screen.getByRole('region', { name: 'Selected evidence reading' });
    await waitFor(() => expect(within(inspector).getByRole('button', { name: 'Clear pin' })).toBeInTheDocument());
    // Parity: the chart's pinned readout and the inspector heading are the same reading, spelled the same.
    expect(screen.getByText(new RegExp(`^Pinned: .+ · .+$`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    const source = screen.getByRole('button', { name: record });
    fireEvent.click(source);
    expect(within(inspector).getByRole('heading', { name: pinned })).toBeInTheDocument();
    expect(source).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getAllByRole('tab')[0]);
    await screen.findByRole('img', { name: title }, FIND);
    expect(within(inspector).getByRole('heading', { name: pinned })).toBeInTheDocument();
  });
  it('explains partial AlphaGenome coverage beside the finding, with approachable help and no disease probability', async () => {
    const result = evidenceWorkspaceFixture('Partial');
    render(<EvidenceWorkspaceProvider result={result}><AlphaGenomeTab {...({ analysisState: { result } } as TabComponentProps)} /></EvidenceWorkspaceProvider>);
    await screen.findByRole('img', { name: /What contributes to this score/ }, FIND);
    expect(screen.getByTestId('avi-composition')).toHaveTextContent('Only 3 of 18');
    expect(screen.getByTestId('avi-composition')).not.toHaveTextContent('of the score');
    expect(screen.getByText('New to AlphaGenome?')).toBeInTheDocument();
    expect(screen.getByText('What do AVI, Phred and SHAP mean?')).toBeInTheDocument();
    expect(screen.getByTestId('avi-caveat')).toHaveTextContent('not a probability of pathogenicity');
  });
  it('names each dot colour with a word in the Predictors and AlphaGenome footers', async () => {
    const result = evidenceWorkspaceFixture('Partial');
    const props = { analysisState: { result } } as TabComponentProps;
    const { unmount } = render(<EvidenceWorkspaceProvider result={result}><PredictorsTab {...props} /></EvidenceWorkspaceProvider>);
    await screen.findByRole('img', { name: /Where do the predictors agree/ }, FIND);
    expect(screen.getByText('Pathogenic direction')).toBeInTheDocument();
    expect(screen.getByText('Benign direction')).toBeInTheDocument();
    expect(screen.getByText('Indeterminate or no call')).toBeInTheDocument();
    unmount();
    render(<EvidenceWorkspaceProvider result={result}><AlphaGenomeTab {...props} /></EvidenceWorkspaceProvider>);
    await screen.findByRole('img', { name: /What contributes to this score/ }, FIND);
    expect(screen.getByText('Molecular prediction')).toBeInTheDocument();
    expect(screen.getByText('Other input')).toBeInTheDocument();
  });
  it('keeps the rail expand control available without duplicate navigation actions', async () => {
    localStorage.setItem('cs-inspector-collapsed', 'true');
    const result = evidenceWorkspaceFixture('Partial');
    render(
      <SettingsProvider>
        <EvidenceWorkspaceProvider result={result}>
          {/* Navigation has no duplicate inspector action; the rail owns expansion. */}
          <EvidenceViewTabs tab="alphagenome" comparisonLabel="Feature contributions" />
          <ViewInspector {...({ activeView: 'evidence', activeEvidenceTab: 'alphagenome', analysisResult: result, gene: 'GZF1', variant: 'p.Arg591Trp' } as any)} />
        </EvidenceWorkspaceProvider>
      </SettingsProvider>
    );
    expect(screen.getByLabelText('Collapsed Context Inspector')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open inspector' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Context Inspector' }));
    await waitFor(() => expect(screen.getByLabelText('Context & Provenance Inspector')).toBeInTheDocument());
  });
  beforeEach(() => { localStorage.clear(); });
  it.each(['Absent', 'Zero', 'Missing'])('shows inspectable source states instead of an empty chart for %s', (example) => {
    const result = evidenceWorkspaceFixture(example);
    render(<EvidenceWorkspaceProvider result={result}><ClinicalTab {...({ analysisState: { result } } as TabComponentProps)} /><PopulationRail analysisResult={result} /></EvidenceWorkspaceProvider>);
    const coverage = screen.getByRole('region', { name: 'Population source coverage' });
    expect(screen.queryByRole('img', { name: /How often is this allele observed/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Each step on the axis/)).not.toBeInTheDocument();
    if (example === 'Absent') expect(within(coverage).getAllByText('No variant record returned')).toHaveLength(2);
    if (example === 'Zero') expect(within(coverage).getAllByText('0%').length).toBeGreaterThan(0);
    if (example === 'Missing') expect(within(coverage).getAllByText('Provider error').length).toBeGreaterThan(0);
    fireEvent.click(within(coverage).getByRole('button', { name: 'gnomAD exomes' }));
    const inspector = screen.getByRole('region', { name: 'Selected evidence reading' });
    expect(within(inspector).getByRole('heading', { name: 'gnomAD exomes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    expect(within(inspector).getByRole('heading', { name: 'gnomAD exomes' })).toBeInTheDocument();
    if (example !== 'Missing') expect(screen.getByTestId('frequency-scale').querySelector('.pop-scale__marker')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Comparison' }));
    expect(screen.getByRole('button', { name: 'gnomAD exomes' })).toHaveAttribute('aria-pressed', 'true');
  });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
});
