import type { ConservationData } from './contracts';

/**
 * Retry interrupted score lookups; a completed provider miss remains a valid result.
 *
 * `modelStatus.base` is atomic: the base lookup settles only after the whole dbNSFP/Genos/dbnsfp.org
 * payload has answered, so a timed-out base has all three base-derived readings missing together.
 * A settled base with one reading absent is a provider miss and must stay cached. PopEVE runs as its
 * own model and is checked separately.
 */
export function hasInterruptedPredictorReadings(result: { conservationData?: ConservationData | null } | null | undefined): boolean {
  const data = result?.conservationData;
  if (!data) return false;
  const interrupted = (state: string | undefined) => state === 'pending' || state === 'timeout';
  return ((data.metarnn == null || data.esm1b == null || data.eigenPhred == null) && interrupted(data.modelStatus?.base))
    || (data.popeve == null && interrupted(data.modelStatus?.popeve));
}
