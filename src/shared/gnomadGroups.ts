/**
 * gnomadGroups.ts — which gnomAD rows a grouped maximum may be taken over.
 *
 * WHY THIS EXISTS
 * ---------------
 * The fetcher took the maximum over EVERY row of gnomAD's `populations` list with AN ≥ 2,000. In
 * gnomAD v4 that list also holds the sex splits (`XX`, `XY`, `afr_XX`…), the founder and
 * bottlenecked groups gnomAD itself leaves out of grpmax (`asj`, `fin`, `ami`) and the unclustered
 * `remaining` group. Any of those could become the "ancestry-grouped maximum" that BS1 and BA1 test.
 *
 * gnomAD v4.1 computes grpmax and the filtering allele frequency over afr, amr, eas, mid, nfe and sas
 * (gnomAD staff, discuss.gnomad.broadinstitute.org/t/gnomad-v4-bottleneck-populations/102). The AN
 * floor is the app's (`THRESHOLDS.populationFrequency.groupMinAn`, after ClinGen SVI's BA1 guidance).
 *
 * Pure: imports nothing.
 */

/** The genetic-ancestry groups gnomAD v4.1 takes grpmax and FAF over. */
export const GRPMAX_GROUPS = ['afr', 'amr', 'eas', 'mid', 'nfe', 'sas'] as const;

/** Display names, as gnomAD labels the groups. */
export const GNOMAD_GROUP_LABELS: Record<string, string> = {
  afr: 'African/African American', amr: 'Admixed American', eas: 'East Asian', mid: 'Middle Eastern',
  nfe: 'Non-Finnish European', sas: 'South Asian', asj: 'Ashkenazi Jewish', fin: 'European Finnish',
  ami: 'Amish', remaining: 'Remaining',
};

export interface PopulationCount { id: string; ac: number | null | undefined; an: number | null | undefined }

/**
 * The highest allele frequency among the grpmax groups whose allele number reaches `minAn`, with the
 * group that holds it. Rows of the same group from different cohorts (exomes and genomes) are summed
 * first, which is how gnomAD's joint frequencies are formed. Null when no group qualifies.
 */
export function groupMaximum(rows: ReadonlyArray<PopulationCount>, minAn: number): { af: number; population: string; ac: number; an: number } | null {
  const totals = new Map<string, { ac: number; an: number }>();
  for (const row of rows) {
    if (!(GRPMAX_GROUPS as readonly string[]).includes(row.id)) continue;
    const ac = typeof row.ac === 'number' && Number.isFinite(row.ac) ? row.ac : null;
    const an = typeof row.an === 'number' && Number.isFinite(row.an) ? row.an : null;
    if (ac === null || an === null) continue;
    const t = totals.get(row.id) ?? { ac: 0, an: 0 };
    totals.set(row.id, { ac: t.ac + ac, an: t.an + an });
  }
  let best: { af: number; population: string; ac: number; an: number } | null = null;
  for (const [population, { ac, an }] of totals) {
    if (an < minAn || an <= 0) continue;
    const af = ac / an;
    if (best === null || af > best.af) best = { af, population, ac, an };
  }
  return best;
}

/** "afr" → "African/African American (afr)"; unknown ids pass through. */
export function gnomadGroupLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  const name = GNOMAD_GROUP_LABELS[id];
  return name ? `${name} (${id})` : id;
}
