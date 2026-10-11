/** Illustrative splice channels on the recorded NAE1-shaped payload; not new biological evidence. */
import { molecularWorkspaceFixture } from './molecularWorkspaceFixture';
import type { AnalysisResult } from '../types';

export const SPLICING_WORKSPACE_CASES = ['Reverse strand', 'Forward strand', 'Small signals', 'Zero', 'Missing', 'Unknown strand', 'Missing positions', 'New variant'];
export function splicingWorkspaceFixture(name = 'Reverse strand'): AnalysisResult {
  const base = molecularWorkspaceFixture('NAE1');
  return {
    ...base,
    metadata: { ...base.metadata, gene: 'NAE1', variant: name === 'New variant' ? 'p.Asp116Ala' : 'p.Asp116Gly',
      genomicCoordinates: name === 'New variant' ? '16-66823281-T-C' : '16-66823281-T-G', assembly: 'GRCh38' },
    conservationData: {
      ...base.conservationData,
      alphagenome: null,
      spliceProximity: { distance: 25, isNearSpliceSite: false, isCanonicalJunction: true,
        exonNumber: 6, totalExons: 20, exonLength: 80, exonStart: null, exonEnd: null,
        intronNumber: null, adjacentIntronNumber: 5, junctionType: 'acceptor', regionType: 'exonic',
        strand: name === 'Unknown strand' ? null : name === 'Forward strand' ? '+' : '-', transcriptId: 'NM_003905.4' },
      spliceai: name === 'Missing' ? null : {
        ds_ag: name === 'Zero' ? 0 : 0.004, ds_al: name === 'Zero' ? 0 : name === 'Small signals' ? 0.009 : 0.3,
        ds_dg: 0, ds_dl: name === 'Zero' ? 0 : name === 'Small signals' ? 0.001 : 0.12,
        max_ds: name === 'Zero' ? 0 : name === 'Small signals' ? 0.009 : 0.3,
        dp: name === 'Missing positions' ? {} : { ds_ag: -100, ds_al: 25, ds_dg: 0, ds_dl: -54 },
        provenance: { source: 'broad-lookup', distanceBp: 500, masked: 1, computedLive: true, annotationSet: 'Illustrative annotation set' },
      },
      spliceaiFailure: name === 'Missing' ? { kind: 'timeout', httpStatus: null, detail: null } : null,
    },
  } as AnalysisResult;
}
