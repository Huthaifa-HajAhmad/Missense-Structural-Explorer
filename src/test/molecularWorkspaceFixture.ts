import type { AnalysisResult } from '../types';
import { NAE1_UNIPROT } from '../shared/__tests__/fixtures/nae1FunctionalDomains';
import { NAE1_RESULT } from '../shared/__tests__/fixtures/nae1Perturbation';
import { SOD1_UNIPROT } from '../shared/__tests__/fixtures/sod1FunctionalDomains';

/** Labelled UI scenarios. Extra domain matches deliberately exercise overlap; they are not annotations of NAE1. */
export function molecularWorkspaceFixture(example = 'Overlapping domains'): AnalysisResult {
  const dense = example === 'Dense SOD1';
  const uniprot = structuredClone(dense ? SOD1_UNIPROT : NAE1_UNIPROT);
  if (example === 'Overlapping domains') uniprot.domainMatches = [...(uniprot.domainMatches ?? []),
    { database: 'SMART', accession: 'DEMO1', entryType: 'domain', locations: [{ start: 90, end: 245 }], interpro: { id: 'DEMO', name: 'Illustrative overlap' } },
    { database: 'Pfam', accession: 'DEMO2', entryType: 'domain', locations: [{ start: 150, end: 410 }], interpro: { id: 'DEMO', name: 'Overlapping signature' } },
    { database: 'SMART', accession: 'DEMO3', entryType: 'domain', locations: [{ start: 40, end: 80 }, { start: 290, end: 380 }], interpro: { id: 'DEMO', name: 'Discontinuous annotation' } },
  ];
  return { ...NAE1_RESULT, isDemoData: true,
    metadata: { gene: dense ? 'SOD1' : 'NAE1', variant: dense ? 'p.Ala5Val' : example === 'New variant' ? 'p.Asp116Ala' : 'p.Asp116Gly', residueIndex: dense ? 5 : 116,
      wildType: dense ? 'A' : 'D', mutant: dense ? 'V' : example === 'New variant' ? 'A' : 'G', uniprotId: dense ? 'P00441' : 'Q13564' },
    uniprotFeatures: example === 'Missing' ? null : uniprot,
    serviceStatus: { uniprotFeatures: example === 'Missing' ? 'timeout' : 'ok' },
    ...(example === 'Missing' || dense || example === 'New variant' ? { saprotEval: null, esmcEval: null, esm2Eval: null } : {}),
  } as unknown as AnalysisResult;
}
