/**
 * The per-source status of a result. Results carry it twice (`serviceStatus` and
 * `metadata.serviceStatus`), so every reader goes through here and cannot miss a key held only in one.
 *
 * The top level wins on a shared key, matching how `mergeResultPatch` writes them. When nothing needs
 * merging the top-level object is returned as it is, so a hash built from it stays the same.
 */
export function serviceStatusOf(result: any): Record<string, any> | null {
  const top = result?.serviceStatus;
  const nested = result?.metadata?.serviceStatus;
  if (!top) return nested ?? null;
  if (!nested) return top;
  return Object.keys(nested).every(key => key in top) ? top : { ...nested, ...top };
}
