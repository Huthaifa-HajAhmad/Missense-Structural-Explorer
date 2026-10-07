/**
 * How old an installed reference snapshot is, and whether the tab should say so.
 *
 * The thresholds are LOCAL POLICY, not source guidance, and the UI says so:
 *  - GenCC states its download "is updated weekly" (thegencc.org/download), so 60 days is about
 *    eight missed exports: enough to matter for a reclassification, short enough to be a prompt.
 *  - Gene2Phenotype publishes no refresh cadence, so the looser 90 days is used.
 * ClinGen dosage is fetched live (cached 24 h) and has no installed snapshot, so it never ages.
 *
 * A flag is a neutral caption. It never blocks, hides, reorders or re-weights any assertion.
 */
export const SNAPSHOT_STALE_AFTER_DAYS: Record<string, number> = { GenCC: 60, Gene2Phenotype: 90 };
export interface SnapshotAge { source: string; days: number; thresholdDays: number | null; stale: boolean; label: string }

export function snapshotAge(source: string, retrievedAt: string, now: Date = new Date()): SnapshotAge | null {
  const t = Date.parse(retrievedAt);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
  const thresholdDays = Object.hasOwn(SNAPSHOT_STALE_AFTER_DAYS, source) ? SNAPSHOT_STALE_AFTER_DAYS[source] : null;
  const stale = thresholdDays !== null && days > thresholdDays;
  const age = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  return { source, days, thresholdDays, stale,
    label: stale ? `Retrieved ${age}; older than the ${thresholdDays}-day review prompt (local policy)` : `Retrieved ${age}` };
}
