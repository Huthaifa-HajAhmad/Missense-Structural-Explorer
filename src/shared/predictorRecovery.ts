import type { ConservationData } from './contracts';

/** Retry interrupted score lookups; a completed provider miss remains a valid result. */
export function hasInterruptedPredictorReadings(result: { conservationData?: ConservationData | null } | null | undefined): boolean {
  const data = result?.conservationData;
  if (!data) return false;
  const interrupted = (state: string | undefined) => state === 'pending' || state === 'timeout';
  return ((data.metarnn == null || data.esm1b == null || data.eigenPhred == null) && interrupted(data.modelStatus?.base))
    || (data.popeve == null && interrupted(data.modelStatus?.popeve));
}
