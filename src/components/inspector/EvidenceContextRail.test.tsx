// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EvidenceContextRail } from './EvidenceContextRail';
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import { evidenceContextIdentity } from '../../shared/evidenceContextIdentity';

const prov = (source: string, release: string | null = null) => ({ source, url: 'https://example.org/x', licence: 'CC BY 4.0', release, retrievedAt: '2026-10-07T10:00:00Z', sha256: 'a'.repeat(64), timestampBasis: 'download' as const });
const result: any = { metadata: { gene: 'SOD1', variant: 'p.Ala5Val' } };
const tissue = { id: 'Liver', label: 'Liver', ontologyId: null, value: 393, unit: 'TPM', sampleCount: 262, samplingSite: null };

describe('context rail (Expression & models)', () => {
  beforeEach(() => {
    const key = evidenceContextIdentity(result, 'SOD1', 'p.Ala5Val');
    useVariantAnalysisStore.setState({ gene: 'SOD1', variant: 'p.Ala5Val',
      diseaseContexts: {}, dosageContexts: {}, modelContexts: {},
      phenotypeSelections: { [key]: { diseaseKey: null, systems: ['hearing'], excludedSuggestions: [], acceptedTerms: [], onset: 'unknown' } },
      expressionContexts: { SOD1: { status: 'ready', data: { gene: 'SOD1', status: 'ready', gencodeId: 'G', tissues: [tissue], provenance: prov('GTEx', 'gtex_v10'), message: null } } },
      developmentalContexts: { SOD1: { status: 'ready', data: { gene: 'SOD1', status: 'not-installed', counts: null, observations: [], provenance: null, message: null } } },
      extraContexts: {
        'hpa:SOD1': { status: 'ready', data: { gene: 'SOD1', status: 'ready', provenance: prov('Human Protein Atlas') } },
        'pext:SOD1': { status: 'error', data: null },
        'alignment:SOD1': { status: 'ready', data: { gene: 'SOD1', status: 'ready', provenance: prov('Ensembl Compara') } },
      } } as any);
  });
  it('traces every source the tab renders, with its state in the engine vocabulary', () => {
    render(<EvidenceContextRail analysisResult={result} expression />);
    const sources = within(screen.getByTestId('context-sources'));
    expect(within(sources.getByText('Not available here').closest('.rail-kv__row') as HTMLElement).getByText('dGTEx pediatric')).toBeInTheDocument();
    expect(within(sources.getByText('Provider error').closest('.rail-kv__row') as HTMLElement).getByText('gnomAD base-level pext')).toBeInTheDocument();
    for (const name of ['Human Protein Atlas', 'Ensembl protein alignment']) expect(sources.getByText(name)).toBeInTheDocument();
    const prv = within(screen.getByTestId('context-provenance'));
    for (const name of ['GTEx', 'Human Protein Atlas', 'Ensembl Compara']) expect(prv.getByText(name)).toBeInTheDocument();
  });
  it('states the reading and the interpretation boundary, and keeps a gap out of the figure', () => {
    render(<EvidenceContextRail analysisResult={result} expression />);
    const trace = within(screen.getByTestId('context-trace'));
    expect(trace.getByText(/samples none of your review system/)).toBeInTheDocument();
    expect(trace.getByText('No ACMG criterion is added or changed.')).toBeInTheDocument();
  });
  it('does not mention a validity-source manifest on the Expression tab', () => {
    render(<EvidenceContextRail analysisResult={result} expression />);
    expect(screen.queryByText(/validity-source manifest/)).toBeNull();
  });
});
