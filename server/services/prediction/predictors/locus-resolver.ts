/**
 * locus-resolver.ts — recover the GRCh38 locus when the predictor ladder fell back to MyVariant.
 *
 * WHY THIS EXISTS
 * ---------------
 * The MyVariant.info fallback identifies the variant by its `_id`, which is always GRCh37. The
 * fallback used to recover GRCh38 through ONE route — the Ensembl assembly map — and that route
 * shares Ensembl's host and circuit breaker with the VEP queries whose failure is the only reason
 * the fallback runs at all. One Ensembl outage therefore disabled the primary lookup AND its
 * recovery (`liftover.ts` skips itself while the breaker is open), and the run kept an hg19 locus
 * every GRCh38-only source refused: gnomAD r4, AlphaGenome, GPN-Star, PopEVE, splice geometry.
 *
 * THE LADDER — every rung independent of the one before it
 * --------------------------------------------------------
 *   1. `ensembl-lift`   Ensembl assembly map: forward map, reverse map and the GRCh38 reference
 *                       base must all agree (the existing three-fold verification).
 *   2. `dbnsfp-grch38`  dbNSFP's OWN GRCh38 position for the same record MyVariant matched by gene
 *                       and protein change, accepted only when the UCSC hg38 reference base at that
 *                       position is the record's REF allele. Different host, different provider.
 *   3. Neither          The GRCh37 locus is kept, honestly tagged, and the trail says whether a
 *                       retry could change that.
 *
 * Rung 2 is not a weaker version of rung 1. dbNSFP computes hg38 positions natively, the record was
 * already bound to this variant by gene + substitution, and the reference-base check rejects any
 * position that is not this allele's. What it does not do is guess: no dbNSFP GRCh38 position, an
 * ambiguous one, a REF mismatch or an unreachable reference all leave the coordinate on GRCh37.
 */
import { attemptCoordinateLift } from "../../translation/liftover.ts";
import { fetchWithRetry } from "../../infra/http-client.ts";
import { parseGenomicCoordinateString } from "../../../../src/shared/contracts.ts";
import type { GenomeAssembly } from "../../../../src/shared/variantNotation.ts";
import type { LocusResolution, LocusResolutionStep } from "../../../../src/shared/locusResolution.ts";

/** Lift refusals another attempt could change: the map was unreachable, or our deadline ran out. */
const TRANSIENT_LIFT_FAILURES = new Set(["map-unavailable", "budget-exceeded"]);

/** dbNSFP's GRCh38 description of the record MyVariant matched, as read off the hit. */
export interface DbnsfpGrch38 {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
}

export interface LocusRecovery {
  id: string;
  assembly: GenomeAssembly;
  canonicalBy: LocusResolution["canonicalBy"];
  steps: LocusResolutionStep[];
  /** True when the locus stayed non-canonical and some failure on the way was transient. */
  retryable: boolean;
}

/**
 * Read dbNSFP's GRCh38 position off a MyVariant hit. dbNSFP sometimes lists several positions for
 * one record; more than one distinct position is an ambiguity, and an ambiguity is refused.
 */
export function readDbnsfpGrch38(hit: any): DbnsfpGrch38 | null {
  const db = hit?.dbnsfp;
  if (!db) return null;
  const first = (v: any) => (Array.isArray(v) ? v : [v]).filter((x) => x !== undefined && x !== null);
  const positions = first(db.hg38)
    .map((h: any) => Number(h?.start))
    .filter((n: number) => Number.isInteger(n) && n > 0);
  const distinct = [...new Set(positions)];
  const chroms = [...new Set(first(db.chrom).map((c: any) => String(c).replace(/^chr/i, "").toUpperCase()))];
  const refs = [...new Set(first(db.ref).map((r: any) => String(r).toUpperCase()))];
  const alts = [...new Set(first(db.alt).map((a: any) => String(a).toUpperCase()))];
  if (distinct.length !== 1 || chroms.length !== 1 || refs.length !== 1 || alts.length !== 1) return null;
  const [ref, alt] = [refs[0], alts[0]];
  if (!/^[ACGT]$/.test(ref) || !/^[ACGT]$/.test(alt)) return null;
  return { chrom: chroms[0], pos: distinct[0], ref, alt };
}

/** The GRCh38 reference base at a 1-based position, from UCSC (independent of Ensembl). */
async function ucscGrch38Base(chrom: string, pos: number): Promise<{ base: string } | { failure: string }> {
  // UCSC's sequence API is 0-based, half-open: [pos-1, pos) is the one base at 1-based `pos`.
  const url = `https://api.genome.ucsc.edu/getData/sequence?genome=hg38;chrom=chr${encodeURIComponent(chrom)};start=${pos - 1};end=${pos}`;
  try {
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" }, timeout: 6000 }, 1);
    if (!res.ok) return { failure: `UCSC answered HTTP ${res.status}` };
    const json = (await res.json()) as { dna?: unknown };
    const base = typeof json?.dna === "string" ? json.dna.trim().toUpperCase() : "";
    return /^[ACGTN]$/.test(base) ? { base } : { failure: "UCSC returned no reference base" };
  } catch (err: any) {
    return { failure: `UCSC unreachable (${String(err?.message ?? err).slice(0, 80)})` };
  }
}

/**
 * Recover the GRCh38 locus for a GRCh37 id from the MyVariant fallback.
 *
 * Never throws; every outcome is a value with its trail.
 */
export async function recoverCanonicalLocus(
  grch37Id: string,
  dbnsfp: DbnsfpGrch38 | null,
): Promise<LocusRecovery> {
  const steps: LocusResolutionStep[] = [];
  let transientFailure = false;
  const parsed = parseGenomicCoordinateString(grch37Id);
  const keep = (): LocusRecovery => ({
    id: grch37Id,
    assembly: "GRCh37",
    canonicalBy: null,
    steps,
    retryable: transientFailure,
  });
  if (!parsed) {
    steps.push({ step: "ensembl-lift", outcome: "skipped", detail: `unparseable GRCh37 id ${grch37Id}` });
    return keep();
  }

  // ── 1. Ensembl assembly map (three-fold verified) ──
  const attempt = await attemptCoordinateLift({ ...parsed, assembly: "GRCh37" }).catch(() => ({ failure: "map-unavailable" as const }));
  if ("lifted" in attempt) {
    const l = attempt.lifted;
    steps.push({ step: "ensembl-lift", outcome: "ok", detail: `GRCh37 ${grch37Id} → GRCh38 ${l.chrom}-${l.pos}` });
    return { id: `${l.chrom}-${l.pos}-${l.ref}-${l.alt}`, assembly: "GRCh38", canonicalBy: "ensembl-lift", steps, retryable: false };
  }
  const liftTransient = TRANSIENT_LIFT_FAILURES.has(attempt.failure);
  transientFailure ||= liftTransient;
  steps.push({
    step: "ensembl-lift",
    outcome: attempt.failure === "budget-exceeded" ? "skipped" : "failed",
    detail: attempt.failure === "budget-exceeded" ? "Ensembl host unavailable or out of time (circuit open)" : `lift refused: ${attempt.failure}`,
  });

  // ── 2. dbNSFP's own GRCh38 position, verified against the UCSC reference ──
  if (!dbnsfp) {
    steps.push({ step: "dbnsfp-grch38", outcome: "skipped", detail: "the dbNSFP record carried no single GRCh38 position" });
    return keep();
  }
  const sameAllele =
    dbnsfp.chrom === parsed.chrom.replace(/^chr/i, "").toUpperCase() &&
    dbnsfp.ref === parsed.ref.toUpperCase() &&
    dbnsfp.alt === parsed.alt.toUpperCase();
  if (!sameAllele) {
    steps.push({ step: "dbnsfp-grch38", outcome: "failed", detail: "the dbNSFP record's contig or alleles differ from the GRCh37 id" });
    return keep();
  }
  const ref = await ucscGrch38Base(dbnsfp.chrom, dbnsfp.pos);
  if ("failure" in ref) {
    transientFailure = true;
    steps.push({ step: "dbnsfp-grch38", outcome: "failed", detail: `reference check unavailable: ${ref.failure}` });
    return keep();
  }
  if (ref.base !== dbnsfp.ref) {
    steps.push({
      step: "dbnsfp-grch38",
      outcome: "failed",
      detail: `GRCh38 reference at ${dbnsfp.chrom}:${dbnsfp.pos} is ${ref.base}, not the record's ${dbnsfp.ref}`,
    });
    return keep();
  }
  steps.push({
    step: "dbnsfp-grch38",
    outcome: "ok",
    detail: `dbNSFP GRCh38 ${dbnsfp.chrom}:${dbnsfp.pos}, reference ${ref.base} verified against UCSC hg38`,
  });
  return {
    id: `${dbnsfp.chrom}-${dbnsfp.pos}-${dbnsfp.ref}-${dbnsfp.alt}`,
    assembly: "GRCh38",
    canonicalBy: "dbnsfp-grch38",
    steps,
    retryable: false,
  };
}
