/**
 * numberingIntake.ts — the numbering proof for a typed protein notation (`POST /numbering-proof`).
 *
 * A translated coordinate or `NP_…` notation arrives with its signed proof. A typed `p.Lys281Asn` does not,
 * so the run asks the server's numbering check for one before the structure, FoldX, landscape, multimer
 * and PPI requests start, and those requests send it back (doc/VERIFIED_RESIDUE_DESIGN.md §2).
 *
 * A refusal (HTTP 422: the residue's numbering is ambiguous, unverified or does not match the sequence) is
 * thrown, because the analysis answers the same request with the same refusal: the run shows it and starts
 * nothing for that residue. Any other failure (network, timeout, server error) answers null, and the run
 * goes on without a proof; the analysis route then checks the numbering itself.
 */
import type { NumberingProofResponse } from "../../shared/contracts";

export async function requestNumberingProof(
  apiClient: any,
  params: { gene: string; variant: string; uniprotId?: string; numberingBasis?: string },
  signal: AbortSignal,
  timeoutMs?: number
): Promise<NumberingProofResponse | null> {
  if (!params.gene || typeof apiClient?.getNumberingProof !== "function") return null;
  const body = {
    gene: params.gene,
    variant: params.variant,
    ...(params.uniprotId ? { uniprotId: params.uniprotId } : {}),
    ...(params.numberingBasis ? { numberingBasis: params.numberingBasis } : {})
  };
  return apiClient.getNumberingProof(body, signal, timeoutMs).catch((error: unknown) => {
    // Read structurally, like `refusalAttachments.ts`, so this layer does not import the client's error class.
    if ((error as { status?: unknown })?.status === 422) throw error;
    console.warn("[NumberingIntake] The numbering check at intake failed:", error);
    return null;
  });
}
