import type { AnalysisResult } from '../types';
import { AVI_FEATURES } from '../shared/alphagenomeEvidence';

/** Illustrative payload for UI contracts, never a provider result or clinical fixture. */
export function evidenceWorkspaceFixture(example = 'Mixed'): AnalysisResult {
  const missing = example === 'Missing';
  const zeros = example === 'Zero';
  const fullAttributions = Object.fromEntries(AVI_FEATURES.map((f, i) => [f.id, zeros || f.group === 'indicator' ? 0 : i === 10 ? .68 : i % 4 === 0 ? -.03 * (i + 1) : .014 * (i + 1)]));
  return {
    isDemoData: true,
    metadata: { gene: 'GZF1', variant: example === 'New variant' ? 'p.Arg591Gln' : 'p.Arg591Trp', uniprotId: 'Q9H116', residueIndex: 591, acmgWeighting: 'standard' },
    predictorData: { gnomadVariantAssembly: 'GRCh38', gnomadVariantId: '20-23369727-C-T', caddPhred: missing ? null : 29.5, amPathogenicity: missing ? null : .835 },
    conservationData: missing ? { alphagenome: { status: 'unavailable', aviPhred: null, message: 'AlphaGenome Atlas query timed out.' } } : {
      revel: .234, bayesdel: .092, metarnn: .767, clinpred: .998, eigenPhred: 6.3, dann: .999, popeve: -3.931, gerp: 5, phylop: 4.91,
      alphagenome: { status: 'live', aviPhred: 26.4, aviRaw: Object.values(fullAttributions).reduce((s, v) => s + v, 0), aviQuantile: .99771, topPercentile: .229,
        atlasUrl: 'https://deepmind.google.com/science/alphagenome/atlas/track-predictions?v=chr20:23369727:C%3ET',
        featureAttributions: example === 'Partial' ? { Splicing: -.08, AlphaMissense: .68, 'RNA-seq': 0 } : fullAttributions },
    },
    gnomadFrequency: missing ? null : { maxAF: zeros ? 0 : .0000055, groupMaxAF: zeros ? 0 : .00008, genomeAF: zeros ? 0 : .000004,
      exomeAF: zeros ? 0 : .0000055, genomeAC: zeros ? 0 : 2, exomeAC: zeros ? 0 : 8, genomeAN: 500000, exomeAN: 1459156, nHomozygous: 0, dataset: 'gnomad_r4' },
    serviceStatus: { gnomadFrequency: missing ? 'timeout' : 'ok', clinvar: 'ok' },
    gnomadConstraint: { pli: .42 }, clinvar: { classification: 'Uncertain significance', reviewStatus: 'criteria provided, single submitter', trait: 'Illustrative condition' },
    ruleBasedInsights: { acmgCriteria: [{ code: 'PP3', reason: 'Illustrative engine record' }, { code: 'PM2', reason: 'Illustrative engine record' }] },
  } as unknown as AnalysisResult;
}
