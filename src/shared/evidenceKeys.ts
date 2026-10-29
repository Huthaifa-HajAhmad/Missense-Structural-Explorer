/**
 * The store keys for the newer evidence-context sources, built in exactly one place.
 *
 * The slot strings (`alignment:GENE`, `hpo:GENEQ…) are shared between the loader (which writes
 * them) and the reader hooks (which select them). Building them here means a vocabulary change
 * cannot drift between writer and readers — a rename fails the type check instead of silently
 * reading `undefined` from the store.
 */
export type ExtraContextKind = 'alignment' | 'pext' | 'hpo' | 'phenotypes' | 'hpa' | 'hotspots';

export const extraContextKey = (kind: ExtraContextKind, gene: string, query = ''): string => `${kind}:${gene}${query}`;

/** The hot-spot read is per protein and transcript; one query string for the loader and every reader. */
export const hotspotSearch = (uniprot: string | null | undefined, transcript: string | null | undefined): string =>
  uniprot ? `?uniprot=${encodeURIComponent(uniprot)}${transcript ? `&transcript=${encodeURIComponent(transcript)}` : ''}` : '';

/**
 * The slot the hotspot loader writes and every reader selects. Composed here, not inline at each call site:
 * a reader that rebuilt it differently would wait forever on an empty slot while the writer filled another.
 */
export const hotspotsSlot = (
  gene: string | null | undefined,
  uniprot: string | null | undefined,
  transcript: string | null | undefined,
): string => extraContextKey('hotspots', gene ?? '', hotspotSearch(uniprot, transcript));
