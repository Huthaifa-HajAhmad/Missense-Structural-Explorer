/**
 * unverified-residue-refusal.ts — the 422 answer for an analysis whose residue numbering is not verified.
 *
 * A residue number that may belong to another protein isoform names a different residue on the canonical
 * sequence, so the analysis is not run (doc/VERIFIED_RESIDUE_DESIGN.md §4, step B1). The answer names what
 * the reader can do: state the protein the numbering belongs to, or give the coordinate. For a translated
 * coordinate, entering it again translates it again, which is the remedy after a provider outage.
 */
import { REFUSAL_CODES } from "../../../src/shared/contracts.ts";

/** Said when the isoform check gave no reason (it could not be reached, or did not answer in time). */
const NO_ANSWER_REASON = "the isoform model could not be reached or did not answer in time";

export interface UnverifiedResidueRefusal {
  code: typeof REFUSAL_CODES.unverifiedResidueNumbering;
  message: string;
  details: { inputKind: "coordinate" | "protein"; reason: string };
}

export function unverifiedResidueRefusal(params: {
  gene: string;
  variant: string;
  inputKind: "coordinate" | "protein";
  reason?: string;
}): UnverifiedResidueRefusal {
  const { gene, variant, inputKind } = params;
  const reason = params.reason ?? NO_ANSWER_REASON;
  const message =
    inputKind === "coordinate"
      ? `Numbering not verified for ${gene} ${variant}: the coordinate's translation to this residue could not be ` +
        "checked, so the analysis was not run. Enter the genomic/cDNA coordinate again and run the analysis: it is " +
        "translated and checked again, which usually works once the translation services answer. If this page " +
        "was open before an update, reload it first. Or enter the substitution qualified with the protein it was " +
        "reported on (for example NP_001032248.1:p.Lys281Asn)."
      : `Numbering not verified for ${gene} ${variant}: ${reason}. The analysis was not run, because this residue ` +
        "number may belong to another isoform, where it names a different residue. Qualify the notation with the " +
        "protein it was reported on (for example NP_001032248.1:p.Lys281Asn), or enter the genomic/cDNA " +
        "coordinate. If the isoform service was unreachable, trying again in a few minutes may also work.";
  return { code: REFUSAL_CODES.unverifiedResidueNumbering, message, details: { inputKind, reason } };
}
