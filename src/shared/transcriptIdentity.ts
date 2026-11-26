/**
 * transcriptIdentity.ts — one transcript, all its fields from that transcript.
 *
 * A result can name two transcripts: the one the analysis modelled (from the translation step) and the
 * one VEP's predictor record used (usually MANE Select). After an isoform switch they differ. Filling
 * each field from whichever record had it once paired the canonical ENST00000361802 with the MANE
 * RefSeq NM_016818.3 (ABCG1), which shows two transcripts as one. Every surface reads its transcript
 * through here, so the identifier, the RefSeq id and the tier always describe the same transcript.
 */

export interface TranscriptFields {
  transcriptId?: string | null;
  maneRefSeqId?: string | null;
  isManeSelect?: boolean | null;
  isManePlusClinical?: boolean | null;
  isCanonical?: boolean | null;
}

export interface TranscriptIdentity {
  transcriptId?: string;
  maneRefSeqId?: string;
  isManeSelect?: boolean;
  isManePlusClinical?: boolean;
  isCanonical?: boolean;
}

const clean = (id: string | null | undefined) => id?.trim() || undefined;
/** The transcript id without padding or version (`ENST…449.8` → `ENST…449`). */
export const unversioned = (id: string) => id.trim().replace(/\.\d+$/, "");

/** True when both ids name the same transcript, ignoring the version (`ENST…449.8` is `ENST…449`). */
export function sameTranscript(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(clean(a) && clean(b) && unversioned(a!) === unversioned(b!));
}

/**
 * The RefSeq id recorded for this transcript. A record naming this transcript wins; a record naming no
 * transcript cannot contradict it and is used next; a record naming a different transcript never is.
 */
export function refSeqFor(transcriptId: string | null | undefined, records: ReadonlyArray<TranscriptFields | null | undefined>): string | undefined {
  const withRefSeq = records.filter((record): record is TranscriptFields => Boolean(record && clean(record.maneRefSeqId)));
  const match = withRefSeq.find(record => sameTranscript(record.transcriptId, transcriptId))
    ?? withRefSeq.find(record => !clean(transcriptId) || !clean(record.transcriptId));
  return clean(match?.maneRefSeqId);
}

/**
 * The transcript `primary` names, completed from `secondary` only when `secondary` is the same
 * transcript. When `primary` names neither a transcript nor a RefSeq id, `secondary` is used whole.
 */
export function transcriptIdentity(primary: TranscriptFields | null | undefined, secondary: TranscriptFields | null | undefined): TranscriptIdentity {
  const primaryId = clean(primary?.transcriptId);
  const source = primaryId || clean(primary?.maneRefSeqId) ? primary! : secondary;
  const same = primaryId !== undefined && sameTranscript(primaryId, secondary?.transcriptId);
  const fill = same ? secondary : null;
  let maneRefSeqId = clean(source?.maneRefSeqId) ?? clean(fill?.maneRefSeqId);
  // Results saved before this rule carry the other transcript's RefSeq id; it is not this transcript's.
  if (primaryId && !same && clean(secondary?.transcriptId) && maneRefSeqId === clean(secondary?.maneRefSeqId)) maneRefSeqId = undefined;
  return {
    transcriptId: clean(source?.transcriptId),
    maneRefSeqId,
    isManeSelect: source?.isManeSelect ?? fill?.isManeSelect ?? undefined,
    isManePlusClinical: source?.isManePlusClinical ?? fill?.isManePlusClinical ?? undefined,
    isCanonical: source?.isCanonical ?? fill?.isCanonical ?? undefined,
  };
}
