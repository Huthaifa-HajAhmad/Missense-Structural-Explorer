/**
 * numbering.ts — which notation to SHOW, and which one was MODELLED.
 *
 * A variant's residue numbers belong to whichever protein the reporting pipeline used. Clinical labs
 * follow HGVS and report on the MANE Select / RefSeq protein (`NM_001037171.2:p.Lys281Asn` for ACOT9),
 * while this platform models the canonical UniProt sequence, because that is the only one with a
 * structure to fold (`Q9Y305`, where the same residue is K272).
 *
 * Both facts are true at once, and a surface that shows only one of them is wrong in a different way:
 * showing only the canonical number makes a clinician re-map the lab's notation by hand (and question
 * whether the analysis is even about their variant), while showing only the reported number hides the
 * basis the numbers were computed on. So every surface derives its labels from HERE — one policy, so
 * the header, the lineage panel, the report and the export cannot disagree.
 *
 * The numbers themselves are unaffected: after a correct remap both notations name the SAME residue in
 * the SAME structural context, so the engines see identical input. Only the label differs.
 */

export interface NumberingRemapLike {
  reason?: string;
  from?: {
    hgvsp?: string;
    transcriptId?: string;
    isoform?: string;
    maneRefSeqId?: string;
    accession?: string;
  } | null;
  to?: { hgvsp?: string; transcriptId?: string; isoform?: string } | null;
}

export interface VariantNumberingView {
  /** Notation a clinician should read: the source report's numbering when it is known. */
  display: string;
  /** The notation on the protein the source report used (`p.Lys281Asn`), prefix stripped. */
  reported: string | null;
  /**
   * The same notation in a form this platform can re-resolve exactly (`Q9Y305-4:p.Lys281Asn`).
   *
   * Used to pre-fill the search field: a BARE reported notation would be ambiguous for a gene like
   * ACOT9, whereas the isoform-qualified form declares its basis and round-trips.
   */
  reportedQualified: string | null;
  /** Protein/accession the report's numbers belong to, as stated by the provider. */
  reportedBasisId: string | null;
  /** Transcript the report used (MANE Select, usually), when known. */
  reportedTranscriptId: string | null;
  /** RefSeq accession of that transcript/protein, when known. */
  reportedRefSeqId: string | null;
  /** The notation actually modelled (canonical numbering). */
  modelled: string;
  /** True when the reported numbering differs from the modelled one. */
  remapped: boolean;
  /** One-line basis statement for the report/export, or null when nothing was remapped. */
  basisNote: string | null;
}

/** `ENSP00000368605.5:p.Lys281Asn` -> `p.Lys281Asn`; leaves a bare `p.…` alone. */
export function stripAccessionPrefix(hgvsp: string | undefined | null): string | null {
  if (!hgvsp) return null;
  const trimmed = hgvsp.trim();
  if (!trimmed) return null;
  const colon = trimmed.indexOf(":");
  const candidate = colon >= 0 ? trimmed.slice(colon + 1).trim() : trimmed;
  return candidate || null;
}

export function variantNumberingView(input: {
  variant: string;
  uniprotId?: string | null;
  numberingRemap?: NumberingRemapLike | null;
}): VariantNumberingView {
  const modelled = (input.variant ?? "").trim();
  const from = input.numberingRemap?.from ?? null;
  const reported = stripAccessionPrefix(from?.hgvsp);

  // A remap exists only when the provider named a DIFFERENT notation than the one returned. Providers
  // happily echo the same notation in both places, and presenting that as "reported vs modelled" would
  // invent a discrepancy the analysis does not have.
  const remapped = Boolean(reported && reported !== modelled);

  const reportedBasisId = remapped ? (from?.isoform ?? from?.accession ?? null) : null;
  const reportedQualified = remapped && reported && reportedBasisId ? `${reportedBasisId}:${reported}` : null;

  const basisNote =
    remapped && reported
      ? `Reported as ${reported}${
          reportedBasisId ? ` on ${reportedBasisId}` : ""
        }${from?.maneRefSeqId ? ` (${from.maneRefSeqId})` : ""} — modelled as ${modelled}${
          input.uniprotId ? ` on canonical ${input.uniprotId}` : ""
        }.`
      : null;

  return {
    display: remapped && reported ? reported : modelled,
    reported: remapped ? reported : null,
    reportedQualified,
    reportedBasisId,
    reportedTranscriptId: remapped ? (from?.transcriptId ?? null) : null,
    reportedRefSeqId: remapped ? (from?.maneRefSeqId ?? null) : null,
    modelled,
    remapped,
    basisNote,
  };
}
