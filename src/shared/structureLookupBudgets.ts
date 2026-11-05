// Sequence retrieval includes retries and time spent waiting for a provider slot.
export const SEQUENCE_LOOKUP_BUDGET_MS = 20_000;
export const HOMOLOG_DISCOVERY_BUDGET_MS = 18_000;
// Allow the server to finish and return its response before the browser stops waiting.
export const CLIENT_SEQUENCE_LOOKUP_BUDGET_MS = SEQUENCE_LOOKUP_BUDGET_MS + 5_000;
export const CLIENT_HOMOLOG_LOOKUP_BUDGET_MS = SEQUENCE_LOOKUP_BUDGET_MS + HOMOLOG_DISCOVERY_BUDGET_MS + 7_000;
