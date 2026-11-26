import { fetchGnomadGeneConstraint } from "../external-api/gnomad.ts";
import { getConstraintIndex } from "../external-api/constraint-snapshot.ts";
import { REGIONAL_CONSTRAINT_RELEASE } from "../../../src/shared/constraintSource.ts";
import { mapGenomicIntervalToProtein } from "../../../src/shared/constraintRegionMapping.ts";
import { unversioned } from "../../../src/shared/transcriptIdentity.ts";
import type { LandscapeContext } from "../../../src/shared/contracts.ts";
import { fetchTranscriptExons } from "./splice_resolver.ts";

/**
 * gnomAD v4.1.1 regional missense constraint on one protein axis. The released intervals are genomic;
 * they are projected onto the protein through the transcript's verified CDS model, and withheld when no
 * model can be verified rather than projected blind. Reads no ClinVar or gnomAD variant rows.
 */
export interface RegionalConstraint {
  regions: LandscapeContext["regions"];
  status: LandscapeContext["regionsStatus"];
  basis: string;
  /** Why there is no answer on this axis; null when there is one, including "no interval released". */
  reason: string | null;
  /** A source failed, so a later read may repair this answer: a caller must not cache it. */
  sourceFailed: boolean;
}

const GENOMIC_BASIS = `gnomAD v${REGIONAL_CONSTRAINT_RELEASE} genomic intervals`;
/** A confirmed "no call", not an outage, so the answer stays cacheable. */
const NONE: RegionalConstraint = { regions: [], status: "none", basis: GENOMIC_BASIS, reason: null, sourceFailed: false };
const withheld = (reason: string, sourceFailed = false): RegionalConstraint =>
  ({ regions: null, status: "withheld-mapping", basis: GENOMIC_BASIS, reason, sourceFailed });

export async function fetchRegionalConstraint(gene: string, axisTranscript: string | null): Promise<RegionalConstraint> {
  const [read] = await Promise.allSettled([fetchGnomadGeneConstraint(gene)]);
  if (read.status !== "fulfilled") {
    return { regions: null, status: "unavailable", basis: GENOMIC_BASIS, reason: "Regional constraint not loaded", sourceFailed: true };
  }
  if (!read.value?.hasRegionalData) return NONE;
  // The intervals are numbered on the constraint transcript; they are drawn on the caller's residue axis.
  // Both must be known and equal, or projecting would mislabel residues.
  const constraintTx = read.value.provenance?.transcriptId ?? null;
  const axisTx = axisTranscript ? unversioned(axisTranscript) : null;
  if (!axisTx || !constraintTx || axisTx !== constraintTx) {
    return withheld(`Regional map withheld: the constraint transcript ${constraintTx ?? "(none)"} does not match the landscape axis transcript ${axisTx || "(unknown)"}.`);
  }
  return projectRegions(constraintTx, read.value.provenance?.transcriptVersion ?? null);
}

async function projectRegions(transcript: string, pinnedVersion: string | null): Promise<RegionalConstraint> {
  const structure = await fetchTranscriptExons(transcript, null, null, { requireCds: true });
  const { cdsStart, cdsEnd } = structure ?? {};
  // The model source failed, or the transcript is not coding: withhold, and retry on the next request
  // rather than caching a refusal that may be transient.
  if (!structure || cdsStart === undefined || cdsEnd === undefined || structure.exons.length === 0) {
    return withheld(`Regional map withheld: no verified CDS model for ${transcript}.`, true);
  }
  // A live exon model of another transcript version than the pinned release may have moved exon
  // boundaries, so nothing is projected through it.
  if (structure.transcriptVersion !== undefined && pinnedVersion !== null && structure.transcriptVersion !== pinnedVersion) {
    return withheld(`Regional map withheld: Ensembl transcript version ${structure.transcriptVersion} differs from the pinned ${pinnedVersion}.`);
  }
  const model = { strand: structure.strand, cdsStart, cdsEnd, exons: structure.exons, proteinLength: structure.proteinLength };
  const regions = (getConstraintIndex().regions.get(transcript) ?? [])
    .map((r) => ({ span: mapGenomicIntervalToProtein(model, r.start, r.end), oe: r.oe, p: r.p }))
    .filter((r): r is { span: { start: number; end: number }; oe: number; p: number } => r.span !== null)
    .map((r) => ({ start: r.span.start, end: r.span.end, oe: r.oe, pValue: r.p }))
    .sort((x, y) => x.start - y.start);
  // Intervals exist but none fall in coding sequence: no protein-axis call, not a withheld map.
  if (!regions.length) return NONE;
  return { regions, status: "available", basis: `gnomAD v${REGIONAL_CONSTRAINT_RELEASE} regional missense, ${transcript} protein residues (Ensembl CDS)`, reason: null, sourceFailed: false };
}
