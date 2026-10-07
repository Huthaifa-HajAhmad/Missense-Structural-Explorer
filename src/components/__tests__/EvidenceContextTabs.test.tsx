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
  it('shows adult measurements immediately without disease or system selections and omits removed controls', () => {
    render(<ExpressionModelsTab {...props} />);
    expect(screen.getByRole('rowheader', { name: /Skeletal muscle/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Export context' })).not.toBeInTheDocument();
    expect(screen.queryByText('Context only')).not.toBeInTheDocument();
  });
  it('explains unavailable choices and transport failures', () => {
    context.value.diseaseLoad = { status: 'error', data: null, error: 'Access denied. Public evidence access is unavailable on this server.' };
    render(<GeneDiseaseTab {...props} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText('Disease choices unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Access denied/)).toBeInTheDocument();
    expect(screen.queryByText(/Expression and model-organism observations belong/)).not.toBeInTheDocument();
  });
  it('can recheck a newly installed validity source without reloading the application', () => {
    context.value.diseaseLoad.data = { status: 'not-installed', frames: [] };
    render(<DiseaseContextPicker gene="TEST" load={context.value.diseaseLoad} selection={context.value.selection} onChange={context.value.setSelection} onRetry={context.value.retryDisease} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(context.value.retryDisease).toHaveBeenCalledOnce();
  });
  it('requires explicit disease choice and preserves systems when selecting', () => {
    const selection = { ...emptyPhenotypeSelection(), systems: ['hearing' as const] }; const onChange = vi.fn();
    render(<DiseaseContextPicker gene="TEST" load={context.value.diseaseLoad} selection={selection} onChange={onChange} onRetry={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: frame.key } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ systems: ['hearing'], diseaseKey: frame.key }));
  });
  it('shows ClinGen dosage as gene-level context scoped to the selected disease by exact ID', () => {
    const score = (code: number, diseaseId: string | null) => ({ state: 'scored', code, disease: diseaseId ? 'Example disease' : null, diseaseId, history: null });
    context.value.selection.diseaseKey = frame.key;
    context.value.dosageLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', message: null, provenance: null, record: { symbol: 'TEST', geneId: 'HGNC:1', location: null,
      haploinsufficiency: score(3, 'MONDO:1'), triplosensitivity: score(40, null), evaluatedAt: '2020-06-24', reportUrl: 'https://search.clinicalgenome.org/kb/gene-dosage/HGNC:1' } } };
    render(<GeneDiseaseTab {...props} />);
    const card = within(screen.getByTestId('dosage-card'));
    expect(card.getByText('3: Sufficient evidence')).toBeVisible();
    expect(card.getByText('40: Dosage sensitivity unlikely')).toBeVisible();
    expect(card.getByText(/exact MONDO ID/)).toBeVisible();
    expect(card.getByText(/casts no ACMG vote/)).toBeVisible();
    expect(screen.queryByText(/dosage sensitivity is not integrated yet/i)).not.toBeInTheDocument();
  });
  it('says when dosage cannot be read and offers a retry', () => {
    context.value.selection.diseaseKey = frame.key; context.value.retryDosage = vi.fn();
    context.value.dosageLoad = { status: 'error', data: null, error: 'Request limit reached' };
    render(<GeneDiseaseTab {...props} />);
    expect(within(screen.getByTestId('dosage-card')).getByText('Request limit reached')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(context.value.retryDosage).toHaveBeenCalledOnce();
  });
  it('offers one-click selection when exactly one disease is curated, without choosing for the user', () => {
    const onChange = vi.fn();
    render(<DiseaseContextPicker gene="TEST" load={context.value.diseaseLoad} selection={context.value.selection} onChange={onChange} onRetry={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Review the only curated disease: Example disease/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ diseaseKey: frame.key }));
  });
  it('matches ClinVar conditions to the selected disease by identifier, never by name', () => {
    context.value.selection.diseaseKey = frame.key;
    const clinvar = (conditions: any[]) => ({ ...props.analysisState.result, clinvar: { classification: 'Pathogenic', reviewStatus: 'criteria provided', lastEvaluated: '', alleleFrequencies: [], trait: 'x', uid: '1', conditions } });
    const view = (conditions: any[]) => render(<GeneDiseaseTab {...({ analysisState: { ...props.analysisState, result: clinvar(conditions) } } as any)} />);
    let r = view([{ label: 'Example disease', xrefs: [{ source: 'OMIM', id: '1' }] }]);
    expect(within(screen.getByTestId('variant-locus-card')).getByText(/records other conditions/)).toBeVisible();   // same name, different ID
    r.unmount();
    r = view([{ label: 'Renamed', xrefs: [{ source: 'MONDO', id: 'MONDO:1' }] }]);
    expect(within(screen.getByTestId('variant-locus-card')).getByText(/lists the selected disease/)).toBeVisible();
    expect(screen.getByText(/not attributed to this disease/)).toBeVisible();
    r.unmount();
    view([{ label: 'Old', xrefs: [] }]);
    expect(within(screen.getByTestId('variant-locus-card')).getByText(/no usable identifiers/)).toBeVisible();
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
    expect(row).toBeVisible();
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
