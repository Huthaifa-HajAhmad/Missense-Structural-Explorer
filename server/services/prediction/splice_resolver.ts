import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { THRESHOLDS } from "../../../src/shared/thresholds.ts";
import { normalizeContigName, sameContig } from "../../../src/shared/assembly.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";

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
  /** Coding-sequence bounds (1-based inclusive, genomic) and protein length, from Ensembl's Translation. */
  cdsStart?: number;
  cdsEnd?: number;
  proteinLength?: number;
  transcriptVersion?: string;
}

const exonCache = new LRUCache<string, TranscriptExonStructure>({ max: 500 });
const inFlightExonFetches = new Map<string, Promise<TranscriptExonStructure | null>>();

/**
 * Resets the in-memory L1 exon cache and in-flight fetch deduplicator for test isolation.
 */
export function resetExonCacheForTests(): void {
  exonCache.clear();
  inFlightExonFetches.clear();
}

/**
 * Query UCSC Genome Browser REST API for exon structure.
 *
 * Supports:
 * - track="knownGene" for GENCODE/Ensembl (ENST...)
 * - track="ncbiRefSeq" for NCBI RefSeq Curated (NM_..., NR_...)
 */
export async function fetchExonsFromUcsc(
  cleanId: string,
  variantChrom: string,
  genomicPos: number,
  track: "knownGene" | "ncbiRefSeq"
): Promise<TranscriptExonStructure | null> {
  // Numerical guard against NaN or non-finite positions tripping UCSC 400 and circuit breaker
  if (!Number.isFinite(genomicPos) || genomicPos < 1) {
    return null;
  }

  // Canonicalize contig for UCSC (hg38 uses "chrM", not "chrMT", and strips any double prefixes)
  const cleanContig = normalizeContigName(variantChrom);
  const normChrom = `chr${cleanContig === "MT" ? "M" : cleanContig}`;

  // Start with a 50kb window around the variant, expand to 500kb if needed
  const windows = [
    { start: Math.max(0, Math.floor(genomicPos - 25_000)), end: Math.floor(genomicPos + 25_000) },
    { start: Math.max(0, Math.floor(genomicPos - 250_000)), end: Math.floor(genomicPos + 250_000) }
  ];

  for (const win of windows) {
    try {
      const url = `https://api.genome.ucsc.edu/getData/track?genome=hg38;track=${encodeURIComponent(track)};chrom=${encodeURIComponent(normChrom)};start=${win.start};end=${win.end}`;
      const response = await fetchWithRetry(
        url,
        {
          headers: { Accept: "application/json" },
          timeout: 6000
        },
        1
      );

      if (!response.ok) continue;

      const data = (await response.json()) as any;
      const items: any[] = data?.[track] || [];
      if (!Array.isArray(items) || items.length === 0) continue;

      // Find item whose name matches cleanId (e.g. ENST00000338121.10 or NM_022482.5)
      const hit = items.find(item => {
        const name: string = item.name || "";
        return name === cleanId || name.startsWith(cleanId + ".");
      });

      if (!hit) continue;

      const isReverse = hit.strand === "-";
      const strandNum = isReverse ? -1 : 1;
      const exons: EnsemblExonData[] = [];

      // Decouple track name from format detection:
      // bigBed format supplies blockSizes and chromStarts (relative to chromStart / txStart)
      // genePred format supplies absolute exonStarts (0-based) and exonEnds (1-based closed)
      if (hit.blockSizes && hit.chromStarts) {
        const chromStart = parseInt(hit.chromStart ?? hit.txStart, 10);
        const sizes = String(hit.blockSizes).split(",").filter(Boolean).map(s => parseInt(s, 10));
        const starts = String(hit.chromStarts).split(",").filter(Boolean).map(s => parseInt(s, 10));

        for (let i = 0; i < sizes.length && i < starts.length; i++) {
          const exStart = chromStart + starts[i] + 1; // 0-based to 1-based closed
          const exEnd = chromStart + starts[i] + sizes[i]; // 1-based closed
          if (!isNaN(exStart) && !isNaN(exEnd)) {
            exons.push({
              start: exStart,
              end: exEnd,
              strand: strandNum,
              seq_region_name: hit.chrom?.replace(/^chr/, "") || cleanContig
            });
          }
        }
      } else if (hit.exonStarts && hit.exonEnds) {
        const starts = String(hit.exonStarts).split(",").filter(Boolean).map(s => parseInt(s, 10));
        const ends = String(hit.exonEnds).split(",").filter(Boolean).map(s => parseInt(s, 10));

        for (let i = 0; i < starts.length && i < ends.length; i++) {
          const exStart = starts[i] + 1; // 0-based to 1-based closed
          const exEnd = ends[i]; // 1-based closed
          if (!isNaN(exStart) && !isNaN(exEnd)) {
            exons.push({
              start: exStart,
              end: exEnd,
              strand: strandNum,
              seq_region_name: hit.chrom?.replace(/^chr/, "") || cleanContig
            });
          }
        }
      }

      if (exons.length > 0) {
        exons.sort((a, b) => a.start - b.start);
        return {
          strand: strandNum,
          seqRegionName: hit.chrom?.replace(/^chr/, "") || cleanContig,
          exons
        };
      }
    } catch (err: any) {
      console.warn(`[Splice Resolver] UCSC track query error for ${cleanId}:`, err.message);
    }
  }

  return null;
}

/**
 * How far from the variant an exon is still carried on the payload. It matches the widest window the
 * splice map draws (2 kb) with margin, and bounds the payload: a long gene has hundreds of exons.
 */
export const NEARBY_EXON_REACH_BP = 2500;

/** Exons whose span reaches within `reach` of `pos`, numbered in transcript order. Pure, for tests. */
export function nearbyExonsOf(
  exons: Array<{ start: number; end: number }>,
  pos: number,
  isReverse: boolean,
  reach = NEARBY_EXON_REACH_BP
): Array<{ number: number; start: number; end: number }> {
  const total = exons.length;
  return exons
    .map((e, i) => ({ number: isReverse ? total - i : i + 1, start: e.start, end: e.end }))
    .filter(e => e.end >= pos - reach && e.start <= pos + reach);
}

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
  /** Exons within `NEARBY_EXON_REACH_BP` of the variant, in transcript numbering. See `nearbyExons` in the contract. */
  nearbyExons?: Array<{ number: number; start: number; end: number }>;
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
 * Fetch exon boundaries and structure for a given transcript ID.
 *
 * Employs a multi-tier resilience architecture:
 * 1. L1 in-memory LRU cache (`exonCache`).
 * 2. In-flight single-flight promise deduplication (thundering herd protection).
 * 3. L2 persistent SQLite cache (`AnalysisDatabase` `external_cache`).
 * 4. Ensembl REST API lookup (for `ENST...`).
 * 5. UCSC Genome Browser REST API fallback (`knownGene` for `ENST...`, `ncbiRefSeq` for `NM_...`).
 */
export interface FetchExonOptions {
  /** Only accept a structure that carries CDS bounds, for protein-residue mapping. */
  requireCds?: boolean;
}

const hasCds = (s: TranscriptExonStructure) => s.cdsStart !== undefined && s.cdsEnd !== undefined;

export async function fetchTranscriptExons(
  transcriptId: string,
  variantChrom?: string | null,
  genomicPos?: number | null,
  options: FetchExonOptions = {}
): Promise<TranscriptExonStructure | null> {
  const cleanId = transcriptId.trim().split(".")[0]; // remove version suffix if any

  // 1. Check L1 Memory Cache
  const cached = exonCache.get(cleanId);
  if (cached && (!options.requireCds || hasCds(cached))) return cached;

  // Single-flight in-flight promise deduplication. Keyed with `requireCds`: a fetch that may settle
  // for UCSC's CDS-less exons must not answer a caller that needs CDS bounds.
  const flightKey = `${cleanId}|${options.requireCds ? "cds" : "any"}`;
  const existing = inFlightExonFetches.get(flightKey);
  if (existing) return existing;

  const fetchPromise = (async () => {
    // 2. Check L2 Persistent SQLite Cache
    try {
      const db = AnalysisDatabase.getInstance();
      const l2Entry = await db.getExternalCacheAsync<TranscriptExonStructure>(`exon:v2:${cleanId}`);
      if (l2Entry?.data && Array.isArray(l2Entry.data.exons) && l2Entry.data.exons.length > 0 && (!options.requireCds || hasCds(l2Entry.data))) {
        exonCache.set(cleanId, l2Entry.data);
        return l2Entry.data;
      }
    } catch (err: any) {
      console.warn(`[Splice Resolver] L2 SQLite read warning for ${cleanId}:`, err.message);
    }

    let structure: TranscriptExonStructure | null = null;
    const isRefSeq = cleanId.startsWith("NM_") || cleanId.startsWith("NR_");

    // 3. If RefSeq, skip Ensembl lookup/id (which 404s) and resolve directly via UCSC ncbiRefSeq
    if (isRefSeq) {
      if (variantChrom && typeof genomicPos === "number" && Number.isFinite(genomicPos)) {
        structure = await fetchExonsFromUcsc(cleanId, variantChrom, genomicPos, "ncbiRefSeq");
      }
    } else {
      // 4. For Ensembl IDs, attempt Ensembl REST API first
      try {
        const url = `https://rest.ensembl.org/lookup/id/${encodeURIComponent(cleanId)}?expand=1&content-type=application/json`;
        const response = await fetchWithRetry(
          url,
          {
            headers: { Accept: "application/json" },
            timeout: 5000
          },
          1
        );
        if (response.ok) {
          const data = (await response.json()) as any;
          const exonsRaw = data?.Exon || [];
          if (Array.isArray(exonsRaw) && exonsRaw.length > 0) {
            const exons = exonsRaw
              .map((ex: any) => ({
                id: ex.id ? String(ex.id) : undefined,
                start: parseInt(ex.start, 10),
                end: parseInt(ex.end, 10),
                strand: ex.strand !== undefined ? parseInt(ex.strand, 10) : (data.strand || 1),
                seq_region_name: ex.seq_region_name || data.seq_region_name
              }))
              .filter(ex => !isNaN(ex.start) && !isNaN(ex.end));

            if (exons.length > 0) {
              exons.sort((a, b) => a.start - b.start);
              const translation = data?.Translation;
              structure = {
                strand: data.strand !== undefined ? parseInt(data.strand, 10) : 1,
                seqRegionName: data.seq_region_name,
                exons,
                cdsStart: translation?.start !== undefined ? parseInt(translation.start, 10) : undefined,
                cdsEnd: translation?.end !== undefined ? parseInt(translation.end, 10) : undefined,
                proteinLength: translation?.length !== undefined ? parseInt(translation.length, 10) : undefined,
                transcriptVersion: data.version !== undefined ? String(data.version) : undefined
              };
            }
          }
        } else {
          console.warn(`[Splice Resolver] Ensembl lookup failed for transcript ${cleanId} (status ${response.status})`);
        }
      } catch (err: any) {
        console.warn(`[Splice Resolver Error] Ensembl request failed for ${cleanId}:`, err.message);
      }

      // 5. If Ensembl failed or timed out, fallback to UCSC knownGene. UCSC carries no CDS bounds,
      // so a mapping caller that needs them must not accept this fallback.
      if (!structure && !options.requireCds && variantChrom && typeof genomicPos === "number" && Number.isFinite(genomicPos)) {
        console.info(`[Splice Resolver] Falling back to UCSC Genome Browser knownGene for ${cleanId} at ${variantChrom}:${genomicPos}`);
        structure = await fetchExonsFromUcsc(cleanId, variantChrom, genomicPos, "knownGene");
      }
    }

    // 6. If resolved, populate L1 memory cache and L2 SQLite persistence (90 days TTL)
    if (structure && structure.exons.length > 0) {
      exonCache.set(cleanId, structure);
      try {
        const db = AnalysisDatabase.getInstance();
        await db.saveExternalCacheAsync(`exon:v2:${cleanId}`, structure, "transcript-exons", 90 * 86400);
      } catch (err: any) {
        console.warn(`[Splice Resolver] L2 SQLite write warning for ${cleanId}:`, err.message);
      }
      return structure;
    }

    return null;
  })().finally(() => {
    inFlightExonFetches.delete(flightKey);
  });

  inFlightExonFetches.set(flightKey, fetchPromise);
  return fetchPromise;
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
 *
 * `variantChrom` (when the caller has it) is checked against the transcript's contig before any
 * distance is computed. A position measured against another chromosome's exon model yields a
 * confident, meaningless number — the resolver used to accept any integer, which is how a
 * wrong-build or wrong-locus coordinate could render as measured geometry (unmapping defect F-6).
 */
export async function resolveSpliceProximity(
  transcriptId: string,
  genomicPos: number,
  variantChrom?: string | null
): Promise<SpliceProximityResult | null> {
  if (!Number.isFinite(genomicPos) || genomicPos < 1) {
    return null;
  }
  const structure = await fetchTranscriptExons(transcriptId, variantChrom, genomicPos);
  if (!structure || structure.exons.length === 0) return null;

  if (variantChrom && structure.seqRegionName) {
    // Shared normalizer (review L-8): GRCh38 names the mitochondrion "MT" while callers write
    // "chrM" — private per-side normalizers disagreed, and MT variants refused their own geometry.
    if (!sameContig(variantChrom, structure.seqRegionName)) {
      console.warn(
        `[Splice Resolver] Refusing geometry: variant contig ${variantChrom} does not match transcript ${transcriptId} on ${structure.seqRegionName}`
      );
      return null;
    }
  }

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
    nearbyExons: nearbyExonsOf(exons, genomicPos, isReverse),
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
