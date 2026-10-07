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
  context.value = { gene: 'TEST', key: 'TEST|V', selection: emptyPhenotypeSelection(), setSelection: vi.fn(), retryDisease: vi.fn(), retryExpression: vi.fn(), retryDevelopment: vi.fn(), retryModels: vi.fn(), retryPhenotypes: vi.fn(), retryHpa: vi.fn(), retryHpo: vi.fn(), hpoIds: 'OMIM:1',
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
    const finding = within(screen.getByTestId('expression-finding'));
    expect(finding.getByText(/GTEx samples none of your review system/)).toBeInTheDocument();
    expect(finding.getByText(/no tissue for bone and growth-plate cartilage: that is a coverage limit, not a low reading/)).toBeInTheDocument();
    expect(finding.getByText('Not sampled')).toBeInTheDocument();
    const row = screen.getByRole('rowheader', { name: /Skeletal muscle/ }).closest('tr')!;
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(row).toBeVisible();
  });
  it('renders an upstream error without claiming missing tissue or no expression', () => {
    context.value.expressionLoad = { status: 'error', data: null }; render(<ExpressionModelsTab {...props} />);
    expect(screen.getByText(/tissue measurements could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/coverage limit, not a low reading/)).not.toBeInTheDocument();
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
  it('shows orthologs and the mouse screen per system without calling a quiet screen normal', () => {
    context.value.selection.systems = ['vision', 'muscle'];
    const ortholog = { id: 'MGI:1', symbol: 'Tst', taxonId: 'NCBITaxon:10090', species: 'Mouse', bestForward: true, bestReverse: true, confidence: 'high', methodCount: 4 };
    context.value.modelLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', hgncId: 'HGNC:1', orthologs: [ortholog], provenance: [], message: null,
      impc: { status: 'ready', screens: [{ mgiId: 'MGI:1', symbol: 'Tst', phenotypeStatus: 'Phenotyping data available', phenotypingDataAvailable: true, embryoDataAvailable: false, significant: ['vision/eye phenotype'], notSignificant: ['muscle phenotype'] }] } } };
    render(<ExpressionModelsTab {...props} />);
    const card = within(screen.getByTestId('model-organisms-card'));
    expect(card.getByText('Best match both directions')).toBeInTheDocument();
    expect(card.getByText('Significant difference')).toBeInTheDocument();
    expect(card.getByText('No significant difference')).toBeInTheDocument();
    expect(card.getByText(/not that the mouse is normal/)).toBeInTheDocument();
    expect(card.queryByText(/phenotypically normal/i)).toBeNull();
  });
  it('says an unscreened mouse is absent data and offers a retry when IMPC fails', () => {
    const base = { gene: 'TEST', status: 'ready', hgncId: 'HGNC:1', provenance: [], message: null, orthologs: [{ id: 'MGI:1', symbol: 'Tst', taxonId: 'NCBITaxon:10090', species: 'Mouse', bestForward: true, bestReverse: true, confidence: null, methodCount: 1 }] };
    context.value.modelLoad = { status: 'ready', data: { ...base, impc: { status: 'ready', screens: [{ mgiId: 'MGI:1', symbol: 'Tst', phenotypeStatus: 'Phenotyping not planned', phenotypingDataAvailable: false, embryoDataAvailable: false, significant: [], notSignificant: [] }] } } };
    const { unmount } = render(<ExpressionModelsTab {...props} />);
    expect(screen.getByText(/Absence of data is not a normal result/)).toBeInTheDocument(); unmount();
    context.value.modelLoad = { status: 'ready', data: { ...base, impc: { status: 'error', screens: [] } } };
    render(<ExpressionModelsTab {...props} />);
    fireEvent.click(within(screen.getByTestId('model-organisms-card')).getByRole('button', { name: 'Try again' }));
    expect(context.value.retryModels).toHaveBeenCalled();
  });
  it('offers HPO terms for acceptance one by one and adds a system only on an explicit click', () => {
    context.value.selection = { ...emptyPhenotypeSelection(), diseaseKey: 'TEST|MONDO:1|AD', acceptedTerms: ['HP:0000002'] };
    context.value.hpoLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', provenance: null, message: null, disease: { queried: 'OMIM:1', id: 'OMIM:1', name: 'Example disease', mondoId: 'MONDO:1' },
      terms: [{ id: 'HP:0000001', name: 'Short stature', category: 'Skeletal system', frequency: 'Frequent', onset: null, sources: [] }, { id: 'HP:0000002', name: 'Myopia', category: 'Eye', frequency: null, onset: 'Childhood onset', sources: [] },
        { id: 'HP:0000006', name: 'Autosomal dominant inheritance', category: 'Inheritance', frequency: null, onset: null, sources: [] }] } };
    render(<ExpressionModelsTab {...props} />);
    const card = within(screen.getByTestId('hpo-card'));
    expect(card.getByText(/Matches your chosen disease by MONDO ID/)).toBeInTheDocument();
    expect(card.queryByText('Autosomal dominant inheritance')).toBeNull();
    expect(context.value.setSelection).not.toHaveBeenCalled();
    fireEvent.click(card.getByRole('button', { name: /Add Vision to review/ }));
    expect(context.value.setSelection).toHaveBeenCalledWith(expect.objectContaining({ systems: ['vision'] }));
    fireEvent.click(card.getByRole('checkbox', { name: /Short stature/ }));
    expect(context.value.setSelection).toHaveBeenLastCalledWith(expect.objectContaining({ acceptedTerms: ['HP:0000002', 'HP:0000001'] }));
  });
  it('shows the residue in each ortholog and refuses to map when the reference differs', () => {
    const homology = { type: '1:1', species: 'mus_musculus', taxonId: 'NCBITaxon:10090', geneId: 'ENSMUSG1', proteinId: 'P', sourceAligned: 'ABCDE', targetAligned: 'ABQDE', humanIdentity: 90, orthologIdentity: 90, humanSimilarity: 95 };
    context.value.alignmentLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', sourceProteinId: 'ENSP1', homologies: [homology], provenance: null, message: null } };
    const result = { metadata: { gene: 'TEST', sequence: 'ABCDE', residueIndex: 3, wildType: 'C', mutant: 'Q' } };
    const { unmount } = render(<ExpressionModelsTab {...props} analysisState={{ result, isLoading: false, error: null } as any} />);
    expect(within(screen.getByTestId('residue-alignment-card')).getByText(/normal residue in Mouse/)).toBeInTheDocument(); unmount();
    render(<ExpressionModelsTab {...props} analysisState={{ result: { metadata: { ...result.metadata, sequence: 'ZZZZZ' } }, isLoading: false, error: null } as any} />);
    expect(within(screen.getByTestId('residue-alignment-card')).getByText(/No residue is mapped/)).toBeInTheDocument();
  });
  it('maps the residue when the pipeline records three-letter codes (real payload shape)', () => {
    const homology = { type: '1:1', species: 'mus_musculus', taxonId: 'NCBITaxon:10090', geneId: 'ENSMUSG1', proteinId: 'P', sourceAligned: 'ABCDE', targetAligned: 'ABQDE', humanIdentity: 90, orthologIdentity: 90, humanSimilarity: 95 };
    context.value.alignmentLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', sourceProteinId: 'ENSP1', homologies: [homology], provenance: null, message: null } };
    // 'ABCDE' is not real amino-acid text, so use real residues: C3 -> Q.
    homology.sourceAligned = 'ACCDE'; homology.targetAligned = 'ACQDE';
    render(<ExpressionModelsTab {...props} analysisState={{ result: { metadata: { gene: 'TEST', sequence: 'ACCDE', residueIndex: 3, wildType: 'Cys', mutant: 'Gln' } }, isLoading: false, error: null } as any} />);
    const card = within(screen.getByTestId('residue-alignment-card'));
    expect(card.queryByText(/No residue is mapped/)).toBeNull();
    expect(card.getByText(/normal residue in Mouse/)).toBeInTheDocument();
  });
  it('uses the GTEx tissue name in the pext table and states a uniform region instead of ranking ties', () => {
    context.value.expressionLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', gencodeId: 'G', provenance: null, message: null,
      tissues: [{ id: 'Brain_Frontal_Cortex_BA9', label: 'Brain - Frontal Cortex (BA9)', ontologyId: null, value: 5, unit: 'TPM', sampleCount: 10, samplingSite: null }] } };
    context.value.pextLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', geneId: 'E', chrom: '17', flags: [], provenance: null, message: null,
      regions: [{ start: 100, stop: 110, mean: 1, tissues: [{ tissue: 'brain_frontal_cortex_ba9', value: 1 }, { tissue: 'liver', value: 1 }] }] } };
    render(<ExpressionModelsTab {...props} analysisState={{ result: { metadata: { gene: 'TEST' }, predictorData: { gnomadVariantId: '17-105-A-T', gnomadVariantAssembly: 'GRCh38' } }, isLoading: false, error: null } as any} />);
    const card = within(screen.getByTestId('pext-card'));
    expect(card.getByText(/All 2 tissues have base-level pext/)).toBeInTheDocument();
    fireEvent.click(card.getByText('All 2 tissues'));
    expect(card.getByText('Brain - Frontal Cortex (BA9)')).toBeInTheDocument();
  });
  it('places the variant on a pext region only with a verified GRCh38 locus', () => {
    context.value.pextLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', geneId: 'E', chrom: '17', flags: ['low_max_pext'], provenance: null, message: null,
      regions: [{ start: 100, stop: 110, mean: 0.5, tissues: [{ tissue: 'liver', value: 0.9 }] }] } };
    const make = (assembly: string) => ({ metadata: { gene: 'TEST' }, predictorData: { gnomadVariantId: '17-105-A-T', gnomadVariantAssembly: assembly } });
    const { unmount } = render(<ExpressionModelsTab {...props} analysisState={{ result: make('GRCh38'), isLoading: false, error: null } as any} />);
    expect(within(screen.getByTestId('pext-card')).getByText('Liver')).toBeInTheDocument();
    expect(within(screen.getByTestId('pext-card')).getByText(/low_max_pext/)).toBeInTheDocument(); unmount();
    render(<ExpressionModelsTab {...props} analysisState={{ result: make('GRCh37'), isLoading: false, error: null } as any} />);
    expect(within(screen.getByTestId('pext-card')).getByText(/no verified GRCh38 position/)).toBeInTheDocument();
  });
  it('marks model phenotypes that match the chosen disease and never reads an empty list as normal', () => {
    context.value.hpoLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', provenance: null, message: null, disease: null, terms: [{ id: 'HP:0000505', name: 'Visual impairment', category: 'Eye', frequency: null, onset: null, sources: [] }] } };
    const mouse = { taxonId: 'NCBITaxon:10090', species: 'Mouse', orthologId: 'MGI:1', symbol: 'Tst', status: 'ready', total: 1, phenotypes: [{ termId: 'MP:1', statement: 'abnormal eye physiology', annotations: 2, models: 1, humanTerms: ['HP:0000505'] }] };
    const fish = { taxonId: 'NCBITaxon:7955', species: 'Zebrafish', orthologId: 'ZFIN:1', symbol: 'tst', status: 'ready', total: 0, phenotypes: [] };
    context.value.phenotypesLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', mapping: 'available', provenance: [], message: null, species: [fish, mouse] } };
    render(<ExpressionModelsTab {...props} />);
    const card = within(screen.getByTestId('model-phenotypes-card'));
    expect(card.getByText(/Same phenotype as: Visual impairment/)).toBeInTheDocument();
    expect(card.getByText(/That is not evidence of a normal organism/)).toBeInTheDocument();
  });
  it('shows Protein Atlas cell-type enrichment on its own scale with a GTEx-overlap caveat', () => {
    context.value.hpaLoad = { status: 'ready', data: { gene: 'TEST', status: 'ready', ensemblId: 'ENSG1', provenance: null, message: null,
      rna: { specificity: 'Tissue enriched', distribution: 'Detected in many', enrichedTissues: [{ name: 'brain', value: 62.9 }] },
      cells: { specificity: 'Group enriched', distribution: null, enrichedCells: [{ name: 'Rod photoreceptor cells', value: 906.3 }] },
      protein: { evidence: 'Evidence at protein level', tissueSpecificity: 'Not detected', antibodies: ['HPA1'], reliabilityIhc: 'Enhanced', reliabilityIf: null } } };
    render(<ExpressionModelsTab {...props} />);
    const card = within(screen.getByTestId('hpa-card'));
    expect(card.getByText('Rod photoreceptor cells')).toBeInTheDocument();
    expect(card.getByText('nCPM')).toBeInTheDocument(); expect(card.getByText('nTPM')).toBeInTheDocument();
    expect(card.getByText(/includes GTEx/)).toBeInTheDocument();
  });
});
