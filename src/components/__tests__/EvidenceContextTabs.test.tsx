// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiseaseContextPicker } from '../evidence/DiseaseContextPicker';
import { GeneDiseaseTab } from '../evidence/GeneDiseaseTab';
import { ExpressionModelsTab } from '../evidence/ExpressionModelsTab';
import { emptyPhenotypeSelection } from '../../shared/phenotypeFrame';
const { context } = vi.hoisted(() => ({ context: { value: null as any } }));
vi.mock('../../hooks/useEvidenceContext', () => ({ useEvidenceContext: () => context.value }));
const frame = { key: 'TEST|MONDO:1|AD', geneId: 'HGNC:1', geneSymbol: 'TEST', diseaseId: 'MONDO:1', label: 'Example disease', inheritance: { id: 'AD', label: 'Autosomal dominant' }, xrefs: [], mechanisms: [], suggestedSystems: [], validity: ['Strong', 'Refuted Evidence'].map((level, i) => ({ id: String(i), level, submitter: `Submitter ${i}`, submitterId: String(i), reportUrl: null, evaluatedAt: null })) };
const props = { analysisState: { result: { metadata: { gene: 'TEST' } }, isLoading: false, error: null } } as any;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => {
  context.value = { gene: 'TEST', key: 'TEST|V', selection: emptyPhenotypeSelection(), setSelection: vi.fn(), retryDisease: vi.fn(), retryExpression: vi.fn(), retryDevelopment: vi.fn(),
    developmentalLoad: { status: 'ready', data: { gene: 'TEST', status: 'not-installed', observations: [], counts: null, provenance: null, gencodeId: null, message: null } },
    diseaseLoad: { status: 'ready', data: { gene: 'TEST', status: 'ready', frames: [frame], provenance: null, message: null } },
    expressionLoad: { status: 'ready', data: { gene: 'TEST', status: 'ready', provenance: null, tissues: [{ id: 'Muscle_Skeletal', label: 'Skeletal muscle', ontologyId: null, value: 0, unit: 'TPM', sampleCount: 100, samplingSite: null }] } } };
});
describe('context tab claims and interactions', () => {
  it('exports loading and unavailable states plus an unresolved saved disease choice explicitly', () => {
    let payload: any;
    vi.stubGlobal('Blob', class { constructor(parts: string[]) { payload = JSON.parse(parts[0]); } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    context.value.selection.diseaseKey = 'retired-frame';
    context.value.diseaseLoad.data = { gene: 'TEST', status: 'not-installed', frames: [], provenance: null, message: 'Missing' };
    context.value.expressionLoad = { status: 'loading', data: null };
    render(<ExpressionModelsTab {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export context' }));
    expect(payload).toMatchObject({ schemaVersion: 2, contextOnly: true, unresolvedDiseaseKey: 'retired-frame',
      validity: { status: 'not-installed' }, loads: { adult: 'loading' }, queryMetadata: { gene: 'TEST' } });
    expect(payload.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('can recheck a newly installed validity source without reloading the application', () => {
    context.value.diseaseLoad.data = { status: 'not-installed', frames: [] };
    render(<DiseaseContextPicker gene="TEST" load={context.value.diseaseLoad} selection={context.value.selection} onChange={context.value.setSelection} onRetry={context.value.retryDisease} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(context.value.retryDisease).toHaveBeenCalledOnce();
  });
  it('makes the same context receipt available from the gene–disease tab without requesting other sources', () => {
    let payload: any;
    vi.stubGlobal('Blob', class { constructor(parts: string[]) { payload = JSON.parse(parts[0]); } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    context.value.expressionLoad = undefined; context.value.developmentalLoad = undefined;
    render(<GeneDiseaseTab {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export context' }));
    expect(payload.loads).toMatchObject({ adult: 'not-requested', development: 'not-requested' });
    expect(payload.validity.frames).toHaveLength(1);
  });
  it('requires explicit disease choice and preserves systems when selecting', () => {
    const selection = { ...emptyPhenotypeSelection(), systems: ['hearing' as const] }; const onChange = vi.fn();
    render(<DiseaseContextPicker gene="TEST" load={context.value.diseaseLoad} selection={selection} onChange={onChange} onRetry={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: frame.key } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ systems: ['hearing'], diseaseKey: frame.key }));
  });
  it('leads with refutation and retains every submitter', () => {
    context.value.selection.diseaseKey = frame.key; render(<GeneDiseaseTab {...props} />);
    expect(screen.getByText('Disputed or refuted assertions require review.')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Submitter 0' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Submitter 1' })).toBeInTheDocument();
    expect(screen.getByText('Refuted Evidence')).toBeInTheDocument();
  });
  it('keeps zero numeric and does not substitute muscle for cartilage; other tissues stay reachable', () => {
    context.value.selection.systems = ['skeletal']; render(<ExpressionModelsTab {...props} />);
    expect(screen.getByText('Relevant anatomy is not sampled by GTEx.')).toBeInTheDocument();
    const row = screen.getByRole('rowheader', { name: /Skeletal muscle/ }).closest('tr')!;
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Other sampled tissues (1)')).toBeInTheDocument();
  });
  it('renders an upstream error without claiming missing tissue or no expression', () => {
    context.value.expressionLoad = { status: 'error', data: null }; render(<ExpressionModelsTab {...props} />);
    expect(screen.getByText(/tissue measurements could not be read/)).toBeInTheDocument();
    expect(screen.queryByText('Relevant anatomy is not sampled by GTEx.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('keeps public sampled age independent of onset and flags single-donor pediatric measurements', () => {
    context.value.selection.onset = 'neonatal';
    context.value.developmentalLoad.data = { status: 'ready', counts: { includedSamples: 1, includedDonors: 1, excludedSamples: 0 }, observations: [{ tissueId: 'UBERON:0002107', tissue: 'Liver', cohortId: '1', cohort: 'Infant (0 to 2 years)', sampleCount: 1, donorCount: 1, value: 0, unit: 'TPM' }] };
    render(<ExpressionModelsTab {...props} />);
    expect(screen.getByRole('combobox', { name: 'Sampled age cohort' })).toHaveValue('all');
    expect(screen.getByText('Single donor')).toBeInTheDocument();
    expect(screen.getByText(/Exact ages are protected/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sampled age cohort' }), { target: { value: '2' } });
    expect(screen.getByText('No eligible tissue samples in this source cohort.')).toBeInTheDocument();
    expect(context.value.setSelection).not.toHaveBeenCalled();
  });
  it('shows a restricted mechanism as context without resolving its applicability to the variant', () => {
    context.value.selection.diseaseKey = frame.key;
    context.value.diseaseLoad.data.frames = [{ ...frame, inheritance: { id: 'HP:0000006', label: 'Autosomal dominant' } }];
    context.value.diseaseLoad.data.mechanismContext = { status: 'ready', records: [{ id: 'G2P1', geneId: 'HGNC:1', diseaseId: 'MONDO:1', allelicRequirement: 'monoallelic_autosomal', modifier: 'restricted mutation set', confidence: 'definitive', mechanism: 'gain of function', support: 'inferred', publications: [], reviewedAt: null }] };
    render(<GeneDiseaseTab {...props} />);
    expect(screen.getByText('gain of function')).toBeInTheDocument();
    expect(screen.getByText('inferred')).toBeInTheDocument();
    expect(screen.getByText('Modifier: restricted mutation set')).toBeInTheDocument();
    expect(screen.getByText(/do not establish applicability to this variant/)).toBeInTheDocument();
  });
});
