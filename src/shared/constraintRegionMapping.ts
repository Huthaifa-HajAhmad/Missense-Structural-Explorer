/**
 * constraintRegionMapping.ts — project gnomAD regional-missense genomic intervals onto a protein axis.
 *
 * The v4.1.1 regional release defines its windows as GRCh38 **genomic** ranges, but the Landscape
 * overview is drawn on protein residues. A genomic range can span introns, so projecting it needs the
 * transcript's coding-exon structure. Given a verified CDS model, this returns the contiguous protein
 * span a genomic interval covers (coding exons are consecutive in protein space, so introns leave no
 * gap). It is pure and refuses rather than guesses: a range that overlaps no coding base returns null.
 */

export interface CdsModel {
  /** +1 for the forward strand, -1 for the reverse. */
  strand: number;
  /** Coding-sequence genomic bounds, 1-based inclusive. */
  cdsStart: number;
  cdsEnd: number;
  /** Exon genomic bounds, 1-based inclusive (any order). */
  exons: ReadonlyArray<{ start: number; end: number }>;
}

/** Exonic segments inside the CDS, ordered in transcript direction. */
export function codingSegments(model: CdsModel): Array<{ start: number; end: number }> {
  const forward = model.strand >= 0;
  const segs: Array<{ start: number; end: number }> = [];
  for (const exon of model.exons) {
    const start = Math.max(exon.start, model.cdsStart);
    const end = Math.min(exon.end, model.cdsEnd);
    if (end >= start) segs.push({ start, end });
  }
  segs.sort((a, b) => (forward ? a.start - b.start : b.start - a.start));
  return segs;
}

/** Amino-acid length of the model's coding sequence (whole codons only). */
export function proteinLengthOf(model: CdsModel): number {
  return Math.floor(codingSegments(model).reduce((n, s) => n + (s.end - s.start + 1), 0) / 3);
}

/**
 * The contiguous protein span a genomic interval covers on the CDS, or null when the interval
 * overlaps no coding base. Endpoints may be given in either order; the result is ascending.
 */
export function mapGenomicIntervalToProtein(model: CdsModel, a: number, b: number): { start: number; end: number } | null {
  const forward = model.strand >= 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let offset = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const seg of codingSegments(model)) {
    const from = Math.max(seg.start, lo);
    const to = Math.min(seg.end, hi);
    if (to >= from) {
      const withinA = forward ? from - seg.start : seg.end - to;
      const withinB = forward ? to - seg.start : seg.end - from;
      const x = offset + withinA;
      const y = offset + withinB;
      first = first === null ? Math.min(x, y) : Math.min(first, x, y);
      last = last === null ? Math.max(x, y) : Math.max(last, x, y);
    }
    offset += seg.end - seg.start + 1;
  }
  if (first === null || last === null) return null;
  return { start: Math.floor(first / 3) + 1, end: Math.floor(last / 3) + 1 };
}
