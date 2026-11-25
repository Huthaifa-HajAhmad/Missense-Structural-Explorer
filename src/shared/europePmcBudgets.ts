/**
 * How long the server waits for Europe PMC. Shared so that the server and the service panel's
 * explanation always quote the same numbers.
 */

/** The health check gives up after this long and reports the service as slow, not as down. */
export const EUROPE_PMC_PROBE_TIMEOUT_MS = 3_000;
/** A literature search may wait this long in total before it falls back to the gene's saved papers. */
export const EUROPE_PMC_SEARCH_TIMEOUT_MS = 25_000;

/** A budget as plain words, e.g. 3_000 → "3 seconds". */
export function secondsLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
