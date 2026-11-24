/**
 * numberingIntake.ts — the numbering proof for a typed protein notation (`POST /numbering-proof`).
 *
 * A translated coordinate or `NP_…` notation arrives with its signed proof. A typed `p.Lys281Asn` does not,
 * so the run asks the server's numbering check for one before the structure, FoldX, landscape, multimer
 * and PPI requests start, and those requests send it back (doc/VERIFIED_RESIDUE_DESIGN.md §2).
 *
 * Best-effort: any failure answers null, and the run goes on as it did before the proof existed; the
 * analysis route then checks the numbering itself.
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
    console.warn("[NumberingIntake] The numbering check at intake failed:", error);
    return null;
  });
}
