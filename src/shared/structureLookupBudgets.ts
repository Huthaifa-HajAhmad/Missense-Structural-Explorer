// Sequence retrieval includes retries and time spent waiting for a provider slot.
export const SEQUENCE_LOOKUP_BUDGET_MS = 20_000;
export const HOMOLOG_DISCOVERY_BUDGET_MS = 18_000;
// Allow the server to finish and return its response before the browser stops waiting.
export const CLIENT_SEQUENCE_LOOKUP_BUDGET_MS = SEQUENCE_LOOKUP_BUDGET_MS + 5_000;
export const CLIENT_HOMOLOG_LOOKUP_BUDGET_MS = SEQUENCE_LOOKUP_BUDGET_MS + HOMOLOG_DISCOVERY_BUDGET_MS + 7_000;
// Mapping a gene symbol to its UniProt accession is one search. The server stops waiting after this long.
export const GENE_RESOLVE_BUDGET_MS = 10_000;
export const CLIENT_GENE_RESOLVE_BUDGET_MS = GENE_RESOLVE_BUDGET_MS + 5_000;
