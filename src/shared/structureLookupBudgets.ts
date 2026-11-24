// Sequence retrieval includes retries and time spent waiting for a provider slot.
export const SEQUENCE_LOOKUP_BUDGET_MS = 20_000;
export const HOMOLOG_DISCOVERY_BUDGET_MS = 18_000;
// Allow the server to finish and return its response before the browser stops waiting.
export const CLIENT_SEQUENCE_LOOKUP_BUDGET_MS = SEQUENCE_LOOKUP_BUDGET_MS + 5_000;
export const CLIENT_HOMOLOG_LOOKUP_BUDGET_MS = SEQUENCE_LOOKUP_BUDGET_MS + HOMOLOG_DISCOVERY_BUDGET_MS + 7_000;
// Mapping a gene symbol to its UniProt accession is one search. The server stops waiting after this long.
export const GENE_RESOLVE_BUDGET_MS = 10_000;
export const CLIENT_GENE_RESOLVE_BUDGET_MS = GENE_RESOLVE_BUDGET_MS + 5_000;
/**
 * POST /numbering-proof resolves the gene, reads the UniProt sequence and runs the numbering check, which
 * the server caps at 2.5 s (`NUMBERING_VERIFICATION_BUDGET_MS`). The browser waits for all three.
 */
export const CLIENT_NUMBERING_PROOF_BUDGET_MS = GENE_RESOLVE_BUDGET_MS + SEQUENCE_LOOKUP_BUDGET_MS + 2_500 + 5_000;
/**
 * When the accession is already known, the proof is not needed to start the run, only to go with its
 * parallel requests, so they wait for it at most this long and then start without one (the analysis
 * route then checks the numbering itself). A warm check answers in tens of milliseconds.
 */
export const NUMBERING_PROOF_FAN_OUT_WAIT_MS = 5_000;
