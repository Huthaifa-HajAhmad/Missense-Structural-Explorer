import type { AnalysisResult } from '../types';
import type { EvidenceContextSlice } from '../stores/slices/evidenceContextSlice';
import { geneDiseaseResponseSchema } from '../shared/diseaseFrame';
import { adultExpressionResponseSchema } from '../shared/expressionModels';
import { developmentalExpressionResponseSchema, DGTEX_COHORTS } from '../shared/developmentalExpression';
import { modelOrganismResponseSchema } from '../shared/modelOrganisms';
import { alignmentResponseSchema } from '../shared/residueAlignment';
import { modelPhenotypesResponseSchema } from '../shared/modelPhenotypes';
import { evidenceContextIdentity } from '../shared/evidenceContextIdentity';
import { emptyPhenotypeSelection } from '../shared/phenotypeFrame';
import { evidenceWorkspaceFixture } from './evidenceWorkspaceFixture';

/** Schema-checked illustrative data for interaction/geometry tests. Not a biological result. */
export function contextWorkspaceFixture(example = 'Mixed') {
  const result = { ...evidenceWorkspaceFixture(), metadata: { ...evidenceWorkspaceFixture().metadata, gene: 'SOD1', variant: example === 'New variant' ? 'p.Cys3Arg' : 'p.Cys3Gln',
    sequence: 'MACDEFGHIK', residueIndex: 3, wildType: 'Cys', mutant: example === 'New variant' ? 'Arg' : 'Gln' } } as AnalysisResult;
  const gene = 'SOD1';
  const prov = (source: string) => ({ source, url: 'https://example.org/illustrative', licence: 'Illustrative fixture', release: 'Illustrative snapshot', retrievedAt: '2026-10-09T12:00:00Z', sha256: 'a'.repeat(64) });
  const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
  const disease = geneDiseaseResponseSchema.parse({ gene, status: 'ready', provenance: prov('GenCC'), message: null,
    frames: ['Autosomal dominant', 'Autosomal recessive'].map((label, i) => ({ key: `HGNC:1|MONDO:0000001|HP:${i ? '0000007' : '0000006'}`, geneId: 'HGNC:1', geneSymbol: gene,
      diseaseId: 'MONDO:0000001', label: 'Illustrative motor-neuron condition', inheritance: { id: `HP:${i ? '0000007' : '0000006'}`, label }, xrefs: ['OMIM:100000'], mechanisms: [], suggestedSystems: [],
      validity: i ? [] : ['Strong', 'Limited', 'Disputed Evidence'].map((level, n) => ({ id: `a${n}`, level, submitter: ['Panel A', 'Panel B', 'Panel C'][n], submitterId: `s${n}`, evaluatedAt: '2026-08-20', reportUrl: 'https://example.org/illustrative' })) })),
    mechanismContext: { status: 'ready', records: [], provenance: prov('Gene2Phenotype'), message: null } });
  const tissues = [['Brain_Cortex', 'Brain — Cortex', 120], ['Muscle_Skeletal', 'Skeletal muscle', 0], ['Liver', 'Liver', 380], ['Heart_Left_Ventricle', 'Heart — Left ventricle', null]] as const;
  const adult = adultExpressionResponseSchema.parse({ gene, status: 'ready', gencodeId: 'ENSG00000000001.1', provenance: prov('GTEx'), message: null,
    tissues: tissues.map(([id, label, value]) => ({ id, label, value, ontologyId: null, unit: 'TPM', sampleCount: 100, samplingSite: null })) });
  const developmental = developmentalExpressionResponseSchema.parse({ gene, status: 'ready', gencodeId: 'ENSG00000000001.2', provenance: prov('dGTEx'), message: null,
    counts: { metadataSamples: 10, includedSamples: 8, excludedSamples: 2, wgsSamples: 0, includedDonors: 4, metadataDonors: 4 },
    observations: ['1', '2', '3', '4'].map((cohortId, i) => ({ tissueId: 'UBERON:0000955', tissue: 'Brain', cohortId, cohort: DGTEX_COHORTS[cohortId as keyof typeof DGTEX_COHORTS], sampleCount: 2, donorCount: i === 0 ? 1 : 2, value: i === 0 ? 0 : 15 + i * 7, unit: 'TPM' })) });
  const orthologs = [{ id: 'MGI:1', symbol: 'Sod1', taxonId: 'NCBITaxon:10090', species: 'Mouse' }, { id: 'ZFIN:1', symbol: 'sod1a', taxonId: 'NCBITaxon:7955', species: 'Zebrafish' }, { id: 'ZFIN:2', symbol: 'sod1b', taxonId: 'NCBITaxon:7955', species: 'Zebrafish' }];
  const models = modelOrganismResponseSchema.parse({ gene, status: 'ready', hgncId: 'HGNC:1', orthologs: orthologs.map(o => ({ ...o, bestForward: true, bestReverse: null, confidence: null, methodCount: 3 })),
    impc: { status: 'ready', screens: [{ mgiId: 'MGI:1', symbol: 'Sod1', phenotypeStatus: 'Complete', phenotypingDataAvailable: true, embryoDataAvailable: null,
      significant: ['nervous system phenotype'], notSignificant: ['skeleton phenotype'] }] }, provenance: [prov('Alliance'), prov('IMPC')], message: null });
  const alignment = alignmentResponseSchema.parse({ gene, status: 'ready', sourceProteinId: 'ENSP00000000001', provenance: prov('Ensembl Compara'), message: null,
    homologies: orthologs.map((o, i) => ({ type: i ? 'ortholog_one2many' : 'ortholog_one2one', species: o.species, taxonId: o.taxonId, geneId: `ENSG${i}`, proteinId: `ENSP${i}`,
      sourceAligned: example === 'Mismatch' ? 'MVVDEFGHIK' : 'MACDEFGHIK', targetAligned: i === 0 ? 'MAQDEFGHIK' : i === 1 ? 'MA-DEFGHIK' : 'MACDEFGHIK', humanIdentity: 90, orthologIdentity: 90, humanSimilarity: null })) });
  const phenotypes = modelPhenotypesResponseSchema.parse({ gene, status: 'ready', mapping: 'available', provenance: [prov('Alliance phenotypes')], message: null,
    species: orthologs.map((o, i) => ({ ...o, orthologId: o.id, status: 'ready', total: i ? 0 : 2, phenotypes: i ? [] : [{ termId: 'MP:0000001', statement: 'Illustrative abnormal motor response', annotations: 3, models: 1, humanTerms: ['HP:0000001'] }] })) });
  const state: Partial<EvidenceContextSlice> = {
    diseaseContexts: { [gene]: ready(disease) }, dosageContexts: { [gene]: ready({ gene, status: 'not-found', record: null, provenance: null, message: 'No dosage record in this illustrative fixture.' }) },
    expressionContexts: { [gene]: ready(adult) }, developmentalContexts: { [gene]: ready(developmental) }, modelContexts: { [gene]: ready(models) },
    extraContexts: { [`alignment:${gene}`]: ready(alignment), [`phenotypes:${gene}`]: ready(phenotypes),
      [`hpo:${gene}OMIM:100000`]: ready({ gene, status: 'ready', disease: null, terms: [{ id: 'HP:0000001', name: 'Illustrative motor finding', category: 'Nervous system', frequency: null, onset: null, sources: [] }], provenance: prov('HPO'), message: null }),
      [`hpa:${gene}`]: ready({ gene, status: 'not-found', ensemblId: null, rna: null, cells: null, protein: null, provenance: prov('HPA'), message: 'No protein measurements in this fixture.' }),
      [`pext:${gene}`]: ready({ gene, status: 'no-pext', geneId: null, chrom: null, flags: [], regions: [], provenance: prov('gnomAD'), message: 'No pext measurements in this fixture.' }) },
    phenotypeSelections: { [evidenceContextIdentity(result, gene, result.metadata!.variant)]: { ...emptyPhenotypeSelection(), diseaseKey: disease.frames[0].key, systems: ['nervous', 'hearing'] } },
  };
  if (example === 'Differing assertions') {
    const frame = disease.frames[0];
    frame.validity = ['Limited', 'Moderate', 'Limited', 'Strong'].map((level, n) => ({
      id: `d${n}`, level, submitter: `Panel ${String.fromCharCode(65 + n)}`, submitterId: `s${n}`,
      evaluatedAt: '2026-08-20', reportUrl: 'https://example.org/illustrative',
    }));
    disease.mechanismContext!.records = [{ id: 'G2P-example', geneId: frame.geneId, gene,
      diseaseId: frame.diseaseId, diseaseLabel: frame.label, allelicRequirement: 'monoallelic_autosomal',
      mechanism: 'undetermined', confidence: 'moderate', support: 'inferred', modifier: '', categorisation: '',
      evidence: '', consequence: '', variantTypes: '', publications: [], reviewedAt: '2026-08-20' }];
  }
  if (example === 'Missing') {
    const failure = { status: 'error' as const, data: null, error: 'Illustrative provider failure. Try again when the source recovers.' };
    state.expressionContexts = { [gene]: failure }; state.developmentalContexts = { [gene]: failure }; state.modelContexts = { [gene]: failure };
    state.extraContexts![`alignment:${gene}`] = failure; state.extraContexts![`phenotypes:${gene}`] = failure;
  }
  return { result, state, adult, developmental, models, alignment, phenotypes, disease };
}
