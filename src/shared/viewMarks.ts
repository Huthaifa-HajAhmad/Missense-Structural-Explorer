/**
 * viewMarks.ts — when an Evidence view gets a dot on its tab, and the one sentence that goes with it.
 *
 * A dot says: "this view holds a finding the open view does not show". It must never say more than the
 * data does, so each rule below asks for the finding itself, not just for an answer to have arrived:
 *
 *   ClinVar        a classification we may quote (`clinvarPresence` = held). An "Unknown" value, a recorded
 *                  absence, or a failed read is not one.
 *   Hotspots       a hotspot rung places the residue inside a region. The regional-constraint rung is PP2
 *                  evidence about the region, not a hotspot, so it does not count.
 *   Dosage         ClinGen scored the gene (any score except 0, which means no evidence was found).
 *   Protein Atlas  the atlas returned a full record for the gene.
 *   pext           the variant lies inside a region that has pext values.
 *
 * Each rule returns the sentence, or `undefined` for no dot. Pure: no React.
 */
import { clinvarPresence } from './clinvarPresence';
import type { DosageEvidence } from './dosageSensitivity';
import type { HotspotRung } from './hotspotEvidence';

export function clinvarMark(clinvar: Parameters<typeof clinvarPresence>[0], serviceStatus?: Parameters<typeof clinvarPresence>[1]): string | undefined {
  return clinvarPresence(clinvar, serviceStatus) === 'held' ? 'ClinVar has a classification for this variant' : undefined;
}

export function hotspotMark(rungs: readonly Pick<HotspotRung, 'key' | 'atVariant'>[] | undefined): string | undefined {
  return rungs?.some(rung => rung.key !== 'regional' && rung.atVariant === 'inside') ? 'This residue lies inside a defined hotspot region' : undefined;
}

export function dosageMark(dosage: Pick<DosageEvidence, 'state' | 'readings'>): string | undefined {
  return dosage.state === 'ready' && dosage.readings.some(reading => reading.code !== null && reading.code !== 0)
    ? 'ClinGen scored this gene’s dosage sensitivity' : undefined;
}

export function proteinAtlasMark(response: { status: string; rna?: unknown; cells?: unknown; protein?: unknown } | null | undefined): string | undefined {
  return response?.status === 'ready' && response.rna && response.cells && response.protein ? 'Human Protein Atlas returned a record for this gene' : undefined;
}

export function pextMark(region: unknown): string | undefined {
  return region ? 'This variant lies in a region that has pext values' : undefined;
}
