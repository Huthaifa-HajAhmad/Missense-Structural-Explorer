import { describe, expect, it } from "vitest";
import type { PredictorData } from "../../../src/shared/contracts.ts";
import { LOCUS_POLICY_VERSION } from "../../../src/shared/locusResolution.ts";
import { CONSTRAINT_RELEASE, REGIONAL_CONSTRAINT_RELEASE } from "../../../src/shared/constraintSource.ts";
import { indexConstraintSnapshot, type ConstraintRow, type RegionalRow } from "./constraint-snapshot.ts";
import { fetchRefinedGeneConstraint } from "./candidate-constraint.ts";

/**
 * A protein-only input can come from several single-base alleles. The regional interval belongs to the
 * POSITION, so the constraint reads every candidate and reports the interval only when they all land in
 * the same one. No allele is chosen.
 */
const row: ConstraintRow = { gene: "TEST", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", canonical: true, mane: true,
  missense_z: 3.13, oe_mis: 0.26, pli: 0.98, loeuf: 0.26, percentile: 5, flags: [], expected: { syn: 20, mis: 100, lof: 10 } };
const interval = (start: number, end: number, oe: number): RegionalRow => ({ transcriptId: row.transcriptId, chrom: "1", start, end, oe, p: 1e-6, highCoverage: true });
const index = (regions: RegionalRow[]) => indexConstraintSnapshot({ schema: 1, release: CONSTRAINT_RELEASE, regionalRelease: REGIONAL_CONSTRAINT_RELEASE,
  sourceSha256: "test", regionalSha256: "test", rows: [row], regions });
const lifted = (id: string | null) => ({ id, grch37Id: null, canonicalBy: id ? "protvar" as const : null, retryable: false });
const multiple = (ids: Array<string | null>) => ({
  available: true, transcriptId: row.transcriptId, gnomadVariantId: null, gnomadVariantAssembly: null,
  locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", policyVersion: LOCUS_POLICY_VERSION, steps: [], candidates: ids.map(lifted) },
}) as unknown as PredictorData;

describe("regional constraint across candidate alleles", () => {
  it("reports the interval when every candidate sits in it (two alleles at one position)", async () => {
    const result = await fetchRefinedGeneConstraint("TEST", 380, multiple(["1-150-A-T", "1-150-A-C"]), index([interval(100, 200, 0.5)]));
    expect(result).toMatchObject({ regionalStatus: "measured", pp2Code: "PP2", regionalConstraint: { oeRatio: 0.5 } });
  });
  it("reports it when the candidates are at different positions inside one interval", async () => {
    const result = await fetchRefinedGeneConstraint("TEST", 380, multiple(["1-150-A-T", "1-152-A-C"]), index([interval(100, 200, 0.3)]));
    expect(result).toMatchObject({ regionalStatus: "measured", pp2Code: "PP2_Moderate" });
  });
  it("withholds the reading when the candidates fall in different intervals", async () => {
    const result = await fetchRefinedGeneConstraint("TEST", 380, multiple(["1-200-A-T", "1-201-A-C"]), index([interval(100, 200, 0.3), interval(201, 300, 0.9)]));
    expect(result).toMatchObject({ regionalStatus: "candidates-differ", regionalConstraint: null, pp2Code: null, isPP2Constrained: false });
  });
  it("withholds the reading when one candidate is inside an interval and another is outside every interval", async () => {
    const result = await fetchRefinedGeneConstraint("TEST", 380, multiple(["1-200-A-T", "1-201-A-C"]), index([interval(100, 200, 0.3)]));
    expect(result).toMatchObject({ regionalStatus: "candidates-differ", regionalConstraint: null, pp2Code: null });
  });
  it("treats a repeated candidate id as agreeing with itself", async () => {
    const result = await fetchRefinedGeneConstraint("TEST", 380, multiple(["1-150-A-T", "1-150-A-T"]), index([interval(100, 200, 0.5)]));
    expect(result).toMatchObject({ regionalStatus: "measured" });
  });
  it("keeps the locus unverified when a candidate has no verified GRCh38 position", async () => {
    const result = await fetchRefinedGeneConstraint("TEST", 380, multiple(["1-150-A-T", null]), index([interval(100, 200, 0.5)]));
    expect(result).toMatchObject({ regionalStatus: "unverified-locus", regionalConstraint: null, pp2Code: null });
  });
  it("does not read candidates from an older locus policy", async () => {
    const stale = multiple(["1-150-A-T", "1-150-A-C"]);
    stale.locusResolution!.policyVersion = LOCUS_POLICY_VERSION - 1;
    expect(await fetchRefinedGeneConstraint("TEST", 380, stale, index([interval(100, 200, 0.5)]))).toMatchObject({ regionalStatus: "unverified-locus" });
  });
  it("still reads a single verified allele as before", async () => {
    const single = { available: true, transcriptId: row.transcriptId, gnomadVariantId: "1-150-A-T", gnomadVariantAssembly: "GRCh38", source: "Ensembl VEP API" } as PredictorData;
    expect(await fetchRefinedGeneConstraint("TEST", 380, single, index([interval(100, 200, 0.5)]))).toMatchObject({ regionalStatus: "measured" });
  });
});
