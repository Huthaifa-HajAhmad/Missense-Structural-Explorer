import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { THRESHOLDS } from "../../../src/shared/thresholds.ts";

export interface EnsemblExonData {
  id?: string;
  start: number;
  end: number;
  strand?: number;
  seq_region_name?: string;
}

export interface TranscriptExonStructure {
  strand: number;
  seqRegionName?: string;
  exons: EnsemblExonData[];
}

const exonCache = new LRUCache<string, TranscriptExonStructure>({ max: 500 });

export interface SpliceProximityResult {
  distance: number;
  isNearSpliceSite: boolean;
  /**
   * True only when the nearest boundary is a genuine exon/intron junction
   * ("donor" or "acceptor"). False for transcript termini ("terminal"), for
   * single-exon transcripts, and when no boundary could be identified.
   *
   * Consumers need this separately from `distance <= 5`: a variant 2 bp from the
   * first exon's start is close to a terminus, not to a splice junction, and must
   * not be reported as a critical junction hit.
   */
  isCanonicalJunction: boolean;
  exonNumber: number | null;
  totalExons: number | null;
  exonId?: string | null;
  exonStart?: number | null;
  exonEnd?: number | null;
  exonLength?: number | null;
  intronNumber?: number | null;
  junctionType?: "donor" | "acceptor" | "terminal" | null;
  adjacentIntronNumber?: number | null;
  regionType?: "exonic" | "intronic" | null;
  strand?: "+" | "-" | null;
  transcriptId?: string | null;
  genomicPos?: number | null;
  nearestJunctionCoord?: number | null;
}

/**
 * Fetch exon boundaries and structure for a given transcript ID from the Ensembl REST API.
 * Caches results to prevent redundant calls.
 */
export async function fetchTranscriptExons(transcriptId: string): Promise<TranscriptExonStructure | null> {
  const cleanId = transcriptId.trim().split(".")[0]; // remove version suffix if any
  const cached = exonCache.get(cleanId);
  if (cached) return cached;

  try {
    const url = `https://rest.ensembl.org/lookup/id/${cleanId}?expand=1&content-type=application/json`;
    const response = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 7000
    }, 2);
    if (!response.ok) {
      console.warn(`[Splice Resolver] Ensembl lookup failed for transcript ${cleanId} (status ${response.status})`);
      return null;
    }

    const data = await response.json() as any;
    const exonsRaw = data?.Exon || [];
    if (!Array.isArray(exonsRaw) || exonsRaw.length === 0) {
      return null;
    }

    const exons = exonsRaw.map((ex: any) => ({
      id: ex.id ? String(ex.id) : undefined,
      start: parseInt(ex.start, 10),
      end: parseInt(ex.end, 10),
      strand: ex.strand !== undefined ? parseInt(ex.strand, 10) : (data.strand || 1),
      seq_region_name: ex.seq_region_name || data.seq_region_name
    })).filter(ex => !isNaN(ex.start) && !isNaN(ex.end));

    // Sort ascending by genomic start coordinate
    exons.sort((a, b) => a.start - b.start);

    const structure: TranscriptExonStructure = {
      strand: data.strand !== undefined ? parseInt(data.strand, 10) : 1,
      seqRegionName: data.seq_region_name,
      exons
    };

    exonCache.set(cleanId, structure);
    return structure;
  } catch (err: any) {
    console.warn(`[Splice Resolver Error] Failed to resolve exons for ${cleanId}:`, err.message);
    return null;
  }
}

/**
 * Calculate the absolute distance to the nearest splice site (exon start/end).
 */
export function calculateDistanceToSpliceSite(
  genomicPos: number,
  exons: Array<{ start: number; end: number }>
): number {
  if (exons.length === 0) return Infinity;
  let minDistance = Infinity;

  for (const exon of exons) {
    const distToStart = Math.abs(genomicPos - exon.start);
    const distToEnd = Math.abs(genomicPos - exon.end);
    const localMin = Math.min(distToStart, distToEnd);
    if (localMin < minDistance) {
      minDistance = localMin;
    }
  }

  return minDistance;
}

/**
 * Resolve proximity of a variant position to splicing junctions and annotate
 * with real Exon/Intron numbers, lengths, junction types (donor vs. acceptor), and coordinates.
 */
export async function resolveSpliceProximity(
  transcriptId: string,
  genomicPos: number
): Promise<SpliceProximityResult | null> {
  const structure = await fetchTranscriptExons(transcriptId);
  if (!structure || structure.exons.length === 0) return null;

  const exons = structure.exons;
  const totalExons = exons.length;
  const isReverse = structure.strand === -1;
  const strandSign = isReverse ? "-" : "+";

  let exonNumber: number | null = null;
  let exonId: string | null = null;
  let exonStart: number | null = null;
  let exonEnd: number | null = null;
  let exonLength: number | null = null;
  let intronNumber: number | null = null;
  /**
   * Starts null and is set only when position is actually classified.
   *
   * It previously defaulted to "exonic", so a position outside the transcript span
   * (upstream of exon 1 or downstream of the last exon) — which matches neither the
   * exon loop nor the intron loop — was returned as "exonic" with no exon bounds,
   * producing a payload that described itself as exonic while carrying no exon.
   */
  let regionType: "exonic" | "intronic" | null = null;
  let junctionType: "donor" | "acceptor" | "terminal" | null = null;
  let adjacentIntronNumber: number | null = null;
  let nearestJunctionCoord: number | null = null;
  let minDistance = Infinity;

  // 1. Check if variant falls inside any Exon
  for (let i = 0; i < exons.length; i++) {
    const ex = exons[i];
    if (genomicPos >= ex.start && genomicPos <= ex.end) {
      regionType = "exonic";
      // In transcript 5'->3' order: forward strand 1..N, reverse strand N..1
      exonNumber = isReverse ? (totalExons - i) : (i + 1);
      exonId = ex.id || null;
      exonStart = ex.start;
      exonEnd = ex.end;
      exonLength = ex.end - ex.start + 1;

      // Calculate distances to boundaries
      const distToStart = Math.abs(genomicPos - ex.start);
      const distToEnd = Math.abs(genomicPos - ex.end);

      if (!isReverse) {
        // Forward strand (+): start = 3' Acceptor (from Intron i), end = 5' Donor (to Intron i+1)
        if (distToEnd <= distToStart) {
          minDistance = distToEnd;
          nearestJunctionCoord = ex.end;
          junctionType = (i === totalExons - 1) ? "terminal" : "donor";
          adjacentIntronNumber = (i < totalExons - 1) ? exonNumber : null;
        } else {
          minDistance = distToStart;
          nearestJunctionCoord = ex.start;
          junctionType = (i === 0) ? "terminal" : "acceptor";
          adjacentIntronNumber = (i > 0) ? (exonNumber - 1) : null;
        }
      } else {
        // Reverse strand (-): end = 3' Acceptor (from Intron exonNumber-1), start = 5' Donor (to Intron exonNumber)
        if (distToStart <= distToEnd) {
          minDistance = distToStart;
          nearestJunctionCoord = ex.start;
          junctionType = (i === 0) ? "terminal" : "donor";
          adjacentIntronNumber = (i > 0) ? exonNumber : null;
        } else {
          minDistance = distToEnd;
          nearestJunctionCoord = ex.end;
          junctionType = (i === totalExons - 1) ? "terminal" : "acceptor";
          adjacentIntronNumber = (i < totalExons - 1) ? (exonNumber - 1) : null;
        }
      }
      break;
    }
  }

  // 2. If not inside an Exon, check which Intron it falls into
  if (exonNumber === null && totalExons > 1) {
    for (let i = 0; i < exons.length - 1; i++) {
      const leftExon = exons[i];
      const rightExon = exons[i + 1];

      if (genomicPos > leftExon.end && genomicPos < rightExon.start) {
        // Asserted only on a confirmed intronic match; setting it before the loop
        // mislabelled positions that fall outside the transcript entirely.
        regionType = "intronic";
        intronNumber = isReverse ? (totalExons - 1 - i) : (i + 1);
        adjacentIntronNumber = intronNumber;

        const distToLeft = Math.abs(genomicPos - leftExon.end);
        const distToRight = Math.abs(genomicPos - rightExon.start);

        if (distToLeft <= distToRight) {
          minDistance = distToLeft;
          nearestJunctionCoord = leftExon.end;
          junctionType = isReverse ? "acceptor" : "donor";
          exonNumber = isReverse ? (totalExons - i) : (i + 1);
        } else {
          minDistance = distToRight;
          nearestJunctionCoord = rightExon.start;
          junctionType = isReverse ? "donor" : "acceptor";
          exonNumber = isReverse ? (totalExons - 1 - i) : (i + 2);
        }
        break;
      }
    }
  }

  // Fallback distance calculation if outside transcript range
  if (minDistance === Infinity) {
    minDistance = calculateDistanceToSpliceSite(genomicPos, exons);
  }

  return {
    distance: minDistance,
    isNearSpliceSite: Boolean(
      totalExons !== null &&
      totalExons > 1 &&
      (junctionType === "donor" || junctionType === "acceptor") &&
      minDistance <= THRESHOLDS.spliceai.proximityCriticalBp
    ),
    isCanonicalJunction: junctionType === "donor" || junctionType === "acceptor",
    exonNumber,
    totalExons,
    exonId,
    exonStart,
    exonEnd,
    exonLength,
    intronNumber,
    junctionType,
    adjacentIntronNumber,
    regionType,
    strand: strandSign,
    transcriptId,
    genomicPos,
    nearestJunctionCoord
  };
}
