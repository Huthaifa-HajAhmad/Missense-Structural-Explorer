// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { contextWorkspaceFixture } from '../../../test/contextWorkspaceFixture';
import { useVariantAnalysisStore as store } from '../../../stores/useVariantAnalysisStore';
import { EvidenceWorkspaceProvider } from '../EvidenceWorkspace';
import { SpeciesModelsTab } from '../SpeciesModelsTab';
vi.mock('../../../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth: vi.fn() }) }));
beforeEach(() => sessionStorage.clear());
function show(example = 'Mixed') {
  const f = contextWorkspaceFixture(example);
  store.setState({ ...f.state, gene: 'SOD1', variant: f.result.metadata!.variant });
  render(<EvidenceWorkspaceProvider result={f.result}><SpeciesModelsTab isDark={false} classCard="" classCardHeader="" classCardTitle="" classBorderSec="" classTextBody="" classTextMute="" foldingDdG={null} foldingStatus={null} setSelectedMetric={() => {}} analysisState={{ result: f.result, isLoading: false, error: null }} /></EvidenceWorkspaceProvider>);
}
describe('Species review notices', () => {
  it('shows the singular coverage notice once in each view', () => {
    show();
    expect(screen.getAllByText(/returned phenotype summary could not be resolved/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Phenotype annotations' }));
    expect(screen.getAllByText(/returned phenotype summary could not be resolved/)).toHaveLength(1);
  });
  it('does not describe failed source reads as zero species', () => {
    show('Missing');
    expect(screen.getByText(/Model-organism sources could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/0 species with returned records/)).not.toBeInTheDocument();
  });
});
