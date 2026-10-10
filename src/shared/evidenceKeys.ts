/**
 * The store keys for the newer evidence-context sources, built in exactly one place.
 *
 * The slot strings (`alignment:GENE`, `hpo:GENEQ…) are shared between the loader (which writes
 * them) and the reader hooks (which select them). Building them here means a vocabulary change
 * cannot drift between writer and readers — a rename fails the type check instead of silently
 * reading `undefined` from the store.
 */
export type ExtraContextKind = 'alignment' | 'pext' | 'hpo' | 'phenotypes' | 'hpa';

export const extraContextKey = (kind: ExtraContextKind, gene: string, query = ''): string => `${kind}:${gene}${query}`;
