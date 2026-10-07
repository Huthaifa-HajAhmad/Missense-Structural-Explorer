import type { LRUCache } from "lru-cache";
import type { AssemblyTaggedCoordinate } from "../../../src/shared/assembly.ts";
import type { GnomadConstraintData } from "../../../src/shared/contracts.ts";
import { CONSTRAINT_URL, REGIONAL_CONSTRAINT_RELEASE, REGIONAL_CONSTRAINT_URL } from "../../../src/shared/constraintSource.ts";
import { isPp2Constrained } from "../../../src/shared/thresholds.ts";
import { normalizeGeneSymbol } from "../infra/http-client.ts";
import { getConstraintIndex, type ConstraintIndex, type ConstraintRow } from "./constraint-snapshot.ts";

export type GnomadGeneConstraint = GnomadConstraintData;
export interface FetchGnomadConstraintOptions {
  /** Compatibility with external fetch callers; local snapshots do not need a cache. */
  l1Cache?: LRUCache<string, any>;
  bypassSqlite?: boolean;
  transcriptId?: string | null;
  /** Only pass a coordinate verified by the locus resolver. Hail loci are 1-based inclusive, GRCh38. */
  coordinate?: AssemblyTaggedCoordinate | null;
  index?: ConstraintIndex;
}

/** Preserve raw precision. Never transplant a protein residue onto another transcript's regional track. */
export async function fetchGnomadGeneConstraint(geneSymbol: string, _aaPos?: number | null, options: FetchGnomadConstraintOptions = {}): Promise<GnomadGeneConstraint | null> {
  const index = options.index ?? getConstraintIndex();
  const gene = normalizeGeneSymbol(geneSymbol).toUpperCase();
  const candidates = index.genes.get(gene);
  if (!candidates?.length) return null;
  const requested = options.transcriptId?.split(".")[0];
  const requestedVersion = options.transcriptId?.split(".")[1];
  const exact = requested ? candidates.find(r => r.transcriptId === requested && (!requestedVersion || r.transcriptVersion === requestedVersion)) : undefined;
  const unique = (list: ConstraintRow[]) => list.length === 1 ? list[0] : undefined;
  const row = exact ?? unique(candidates.filter(r => r.mane)) ?? unique(candidates.filter(r => r.canonical));
  // Ambiguous identity is not an invitation to select the first transcript.
  if (!row) throw new Error(`No unique MANE/canonical constraint transcript for ${gene}`);
  const flags = [...row.flags];
  const calibrated = Object.values(row.expected).every(n => typeof n === "number" && Number.isFinite(n) && n > 0);
  if (!calibrated) flags.push("missing-or-zero-expected-variants");
  const usable = calibrated && flags.length === 0;
  const result: GnomadGeneConstraint = {
    missense_z: usable ? row.missense_z : null, oe_mis: usable ? row.oe_mis : null,
    pli: usable ? row.pli : null, loeuf: usable ? row.loeuf : null,
    isPP2Constrained: usable && isPp2Constrained(row.missense_z, row.oe_mis) === true,
    provenance: { release: index.snapshot.release, assembly: "GRCh38", geneId: row.geneId, transcriptId: row.transcriptId,
      transcriptVersion: row.transcriptVersion, selection: exact ? "matched" : row.mane ? "mane-select" : "canonical",
      sourceUrl: CONSTRAINT_URL, sourceSha256: index.snapshot.sourceSha256 },
    qualityFlags: [...new Set(flags)], expectedCounts: row.expected,
    rawMetrics: { missense_z: row.missense_z, oe_mis: row.oe_mis, pli: row.pli, loeuf: row.loeuf },
    loeufPercentile: usable ? row.percentile : null,
    regionalRelease: REGIONAL_CONSTRAINT_RELEASE, regionalSourceUrl: REGIONAL_CONSTRAINT_URL,
    regionalSourceSha256: index.snapshot.regionalSha256,
    hasRegionalData: index.regions.has(row.transcriptId), regionalConstraint: null,
    regionalStatus: "unverified-locus",
  };
  if (requested && !exact) { result.regionalStatus = "transcript-mismatch"; return result; }
  const coordinate = options.coordinate;
  if (!requested || !coordinate || coordinate.assembly !== "GRCh38" ||
      !Number.isSafeInteger(coordinate.pos) || coordinate.pos < 1 || !/^[ACGT]$/.test(coordinate.ref) || !/^[ACGT]$/.test(coordinate.alt) || coordinate.ref === coordinate.alt) return result;
  const regions = index.regions.get(row.transcriptId);
  if (!regions?.length) { result.regionalStatus = "no-regions"; return result; }
  const matches = regions.filter(r => r.chrom === coordinate.chrom.replace(/^chr/i, "") && coordinate.pos >= r.start && coordinate.pos <= r.end);
  if (!matches.length) { result.regionalStatus = "outside-region"; return result; }
  if (matches.length !== 1) { result.regionalStatus = "invalid-data"; return result; }
  const region = matches[0];
  if (!Number.isFinite(region.p) || region.p < 0 || region.p > 1 || !Number.isFinite(region.oe) || region.oe < 0) {
    result.regionalStatus = "invalid-data"; return result;
  }
  if (!usable || region.highCoverage !== true) { result.regionalStatus = "failed-qc"; return result; }
  result.regionalStatus = region.p < 0.05 && region.oe < 1 ? "measured" : "nonsignificant";
  result.regionalConstraint = { isConstrained: result.regionalStatus === "measured", oeRatio: region.oe, pValue: region.p,
    regionText: `${region.chrom}:${region.start} to ${region.end} (GRCh38)` };
  return result;
}
