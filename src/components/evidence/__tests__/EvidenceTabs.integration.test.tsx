// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalTab } from '../ClinicalTab';
import { PredictorsTab } from '../PredictorsTab';
import { AlphaGenomeTab } from '../AlphaGenomeTab';
import { PopulationRail } from '../../inspector/PopulationRail';
import { PredictorsRail } from '../../inspector/PredictorsRail';
import { AlphaGenomeRail } from '../../inspector/AlphaGenomeRail';
import { EvidenceWorkspaceProvider } from '../EvidenceWorkspace';
import { evidenceWorkspaceFixture } from '../../../test/evidenceWorkspaceFixture';
import type { TabComponentProps } from '../types';

vi.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { alphagenomeApiKey: '' }, openSettingsTab: vi.fn() }) }));
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth: vi.fn() }) }));

const cases = [
  { name: 'Population', Tab: ClinicalTab, Rail: PopulationRail, title: /How often is this allele observed/, record: /gnomAD exomes/, pinned: /gnomAD exomes/ },
  { name: 'Predictors', Tab: PredictorsTab, Rail: PredictorsRail, title: /Where do the predictors agree/, record: /^REVEL$/, pinned: /^REVEL$/ },
  { name: 'AlphaGenome', Tab: AlphaGenomeTab, Rail: AlphaGenomeRail, title: /What contributes to this score/, record: /^AlphaMissense$/, pinned: /^AlphaMissense$/ },
];
describe('Production evidence tabs and their inspectors', () => {
  it.each(cases)('$name connects chart and source-record selections to the same inspector', async ({ Tab, Rail, title, record, pinned }) => {
    const result = evidenceWorkspaceFixture('Partial');
    const props = { analysisState: { result, isLoading: false, error: null } } as TabComponentProps;
    render(<EvidenceWorkspaceProvider result={result}><Tab {...props} /><Rail analysisResult={result} /></EvidenceWorkspaceProvider>);
    const chart = await screen.findByRole('img', { name: title });
    fireEvent.focus(chart); fireEvent.keyDown(chart, { key: 'Home' }); fireEvent.keyDown(chart, { key: 'Enter' });
    const inspector = screen.getByRole('region', { name: 'Selected evidence reading' });
    await waitFor(() => expect(within(inspector).getByRole('button', { name: 'Clear pin' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    const source = screen.getByRole('button', { name: record });
    fireEvent.click(source);
    expect(within(inspector).getByRole('heading', { name: pinned })).toBeInTheDocument();
    expect(source).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getAllByRole('tab')[0]);
    await screen.findByRole('img', { name: title });
    expect(within(inspector).getByRole('heading', { name: pinned })).toBeInTheDocument();
  });
  it('explains partial AlphaGenome coverage beside the finding, with approachable help and no disease probability', async () => {
    const result = evidenceWorkspaceFixture('Partial');
    render(<EvidenceWorkspaceProvider result={result}><AlphaGenomeTab {...({ analysisState: { result } } as TabComponentProps)} /></EvidenceWorkspaceProvider>);
    await screen.findByRole('img', { name: /What contributes to this score/ });
    expect(screen.getByTestId('avi-composition')).toHaveTextContent('Only 3 of 18');
    expect(screen.getByTestId('avi-composition')).not.toHaveTextContent('of the score');
    expect(screen.getByText('New to AlphaGenome?')).toBeInTheDocument();
    expect(screen.getByText('What do AVI, Phred and SHAP mean?')).toBeInTheDocument();
    expect(screen.getByTestId('avi-caveat')).toHaveTextContent('not a probability of pathogenicity');
  });
});
