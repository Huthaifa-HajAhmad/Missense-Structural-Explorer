import type { AnalysisResult } from '../types';
import { SOD1_INTERFACES } from '../shared/__tests__/fixtures/sod1Interfaces';
import { SLC12A4 } from '../shared/__tests__/fixtures/slc12a4';
import { nae1Reference } from '../shared/__tests__/fixtures/splicingReference';

/** Recorded cases plus explicitly illustrative splice scores for interaction/geometry checks. */
export function mechanismWorkspaceFixture(name = 'SOD1'): AnalysisResult {
  if (name === 'SOD1' || name === 'SLC12A4') {
    const f = structuredClone(name === 'SOD1' ? SOD1_INTERFACES : SLC12A4);
    return { ...f.result, isDemoData: true, multimerData: f.assembly, ppiBindingData: f.ppi };
  }
  return nae1Reference({ isDemoData: true,
    metadata: { variant: name === 'New variant' ? 'p.Asp116Ala' : 'p.Asp116Gly' },
    conservationData: {
      alphagenome: null,
      spliceai: name === 'Missing' || name === 'NAE1' ? null : {
        ds_ag: .08, ds_al: .24, ds_dg: .004, ds_dl: name === 'Missing position' ? .9 : .12,
        max_ds: name === 'Missing position' ? .9 : .24,
        dp: { ds_ag: 3, ds_al: -12, ds_dg: 0, ds_dl: name === 'Missing position' ? null : 240 },
      },
      spliceProximity: { strand: name === 'Unresolved strand' ? null : '-', transcriptId: 'NM_003905.4' },
    },
  });
}
