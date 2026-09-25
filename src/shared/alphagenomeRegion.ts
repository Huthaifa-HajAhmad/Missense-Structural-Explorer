/**
 * AlphaGenome saturation region arithmetic.
 *
 * The request contract caps a region at 5,000 bp, so an exon with its splice flanks has to be
 * clamped before the query is issued — otherwise the route rejects it and the panel reports an
 * empty region that was never actually asked for.
 */

/** One under the contract's 5,000 bp cap, leaving room for inclusive end handling. */
export const MAX_SATURATION_REGION_BP = 4990;

export interface SaturationRegionInput {
  chrom?: string | null;
  genomicPos?: number | null;
  exonStart?: number | null;
  exonEnd?: number | null;
  exonNumber?: number | null;
  strand?: string | null;
  transcriptId?: string | null;
}

export interface SaturationRegion {
  chrom: string;
  start: number;
  end: number;
  clamped: boolean;
  strand?: "+" | "-";
  transcriptId?: string | null;
  exonNumber?: number | null;
  exonStart?: number | null;
  exonEnd?: number | null;
}

/**
 * Exon ± 15 bp of splice flank when the exon is known, otherwise ± 45 bp around the variant.
 *
 * Returns null when no interval can be built at all: no chromosome, or no position and no exon to
 * derive one from. Callers must not present that as an answered query with an empty result.
 */
export function buildSaturationRegion(input: SaturationRegionInput): SaturationRegion | null {
  const chrom = String(input.chrom || "").replace(/^chr/i, "");
  if (!chrom) return null;

  const { genomicPos, exonStart, exonEnd } = input;
  let start: number;
  let end: number;

  if (exonStart && exonEnd && exonEnd >= exonStart) {
    start = Math.max(1, exonStart - 15);
    end = exonEnd + 15;
  } else if (genomicPos && genomicPos > 0) {
    start = Math.max(1, genomicPos - 45);
    end = genomicPos + 45;
  } else {
    return null;
  }

  let clamped = false;
  if (end - start + 1 > MAX_SATURATION_REGION_BP) {
    // Center on the queried variant when it is inside the exon; otherwise on the exon midpoint,
    // so a variant outside the window still yields a region that describes the exon.
    const center =
      genomicPos && genomicPos >= start && genomicPos <= end
        ? genomicPos
        : Math.floor((start + end) / 2);
    start = Math.max(1, center - Math.floor(MAX_SATURATION_REGION_BP / 2));
    end = start + MAX_SATURATION_REGION_BP - 1;
    clamped = true;
  }

  return {
    chrom,
    start,
    end,
    clamped,
    strand: input.strand === "+" || input.strand === "-" ? (input.strand as "+" | "-") : undefined,
    transcriptId: input.transcriptId,
    exonNumber: input.exonNumber,
    exonStart,
    exonEnd
  };
}
