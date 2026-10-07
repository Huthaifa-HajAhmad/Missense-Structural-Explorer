/**
 * The single list of public reference reads under `/evidence-context/:gene/<suffix>`. The router
 * (server/routes/evidence-context.ts) must give each one a loader, and the public-read gate
 * (server/middleware.ts) is built from it, so a new source cannot be added to one and forgotten in
 * the other. Writes and unlisted paths stay authenticated.
 */
export const CONTEXT_SUFFIXES = ['development', 'dosage', 'models', 'alignment', 'pext', 'expression', 'hpo', 'phenotypes', 'hpa'] as const;
export type ContextSuffix = typeof CONTEXT_SUFFIXES[number];
/** Keep transport/validation failures distinct from a provider's evidence state. */
export class ContextHttpError extends Error {
  constructor(public status: number) { super('Context HTTP request failed'); }
}
export function contextRequestFailure(error: unknown): string {
  if (error instanceof ContextHttpError) {
    if (error.status === 401 || error.status === 403) return 'Access denied. Public evidence access is unavailable on this server.';
    if (error.status === 429) return 'Request limit reached. Wait a minute, then try again.';
    return `Server request failed (HTTP ${error.status}). Try again.`;
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return 'Request timed out. Try again.';
  if (error instanceof TypeError) return 'Connection failed. Check your connection, then try again.';
  return 'The evidence response could not be validated. Try again.';
}
