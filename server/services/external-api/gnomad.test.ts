import { describe, it, expect } from "vitest";
import { fetchGnomadGeneConstraint } from "./gnomad.ts";
import { getConstraintIndex, indexConstraintSnapshot, type ConstraintRow, type RegionalRow } from "./constraint-snapshot.ts";
import { CONSTRAINT_RELEASE, REGIONAL_CONSTRAINT_RELEASE } from "../../../src/shared/constraintSource.ts";
const row: ConstraintRow = { gene: "TEST", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", canonical: true, mane: true,
  missense_z: 3.13, oe_mis: 0.26, pli: 0.98, loeuf: 0.26, percentile: 5, flags: [], expected: { syn: 20, mis: 100, lof: 10 } };
const region: RegionalRow = { transcriptId: row.transcriptId, chrom: "1", start: 100, end: 200, oe: 0.5, p: 1e-6, highCoverage: true };
const coordinate = { chrom: "1", pos: 150, ref: "A", alt: "T", assembly: "GRCh38" as const };
function index(overrides: Partial<ConstraintRow> = {}, regions = [region], rows?: ConstraintRow[]) {
  return indexConstraintSnapshot({ schema: 1, release: CONSTRAINT_RELEASE, regionalRelease: REGIONAL_CONSTRAINT_RELEASE,
    sourceSha256: "test", regionalSha256: "test", rows: rows ?? [{ ...row, ...overrides }], regions });
}
function fetch(overrides: Partial<ConstraintRow> = {}, regions = [region], options: Record<string, any> = {}) {
  return fetchGnomadGeneConstraint("TEST", 999, { index: index(overrides, regions), transcriptId: row.transcriptId, coordinate, ...options });
}
describe("pinned gnomAD gene and regional constraint", () => {
  it("retains raw gene values; gene Z and o/e no longer decide PP2", async () => {
    expect(await fetch({ missense_z: 3.086, loeuf: 0.349 })).toMatchObject({ missense_z: 3.086, loeuf: 0.349 });
    // Z 1.0 and o/e 0.9 failed the retired proxy; the interval's O/E 0.5 is in the calibrated PP2 band.
    expect(await fetch({ missense_z: 1.0, oe_mis: 0.9 })).toMatchObject({ pp2Code: "PP2", isPP2Constrained: true });
  });
  it.each([[0.36, "PP2_Moderate"], [0.59, "PP2"], [0.6, null]])("reads PP2 from the interval O/E %s with Chao et al. v3's edges", async (oe, code) => {
    expect(await fetch({}, [{ ...region, oe: oe as number }])).toMatchObject({ pp2Code: code, isPP2Constrained: code !== null });
  });
  it("reads PP2 from a nonsignificant interval too: the calibration uses the O/E, not the breakpoint p", async () => {
    expect(await fetch({}, [{ ...region, p: 0.2 }])).toMatchObject({ regionalStatus: "nonsignificant", pp2Code: "PP2" });
  });
  it("gives no PP2 without a QC-passing interval at a verified locus", async () => {
    expect(await fetch({}, [{ ...region, highCoverage: false }])).toMatchObject({ pp2Code: null, isPP2Constrained: false });
    expect(await fetch({}, [region], { coordinate: null })).toMatchObject({ pp2Code: null, isPP2Constrained: false });
  });
  it("records separate pinned releases and exact transcript provenance", async () => {
    expect(await fetch()).toMatchObject({ provenance: { release: "4.1.2", assembly: "GRCh38", transcriptId: row.transcriptId, selection: "matched" }, regionalRelease: "4.1.1", regionalStatus: "measured" });
  });
  it("uses a unique MANE reference while withholding mismatched regional evidence", async () => {
    expect(await fetch({}, [region], { transcriptId: "ENST99999999999" })).toMatchObject({ provenance: { selection: "mane-select" }, regionalStatus: "transcript-mismatch", regionalConstraint: null });
  });
  it("withholds regional evidence for a different transcript version", async () => {
    expect(await fetch({}, [region], { transcriptId: `${row.transcriptId}.2` })).toMatchObject({ provenance: { selection: "mane-select" }, regionalStatus: "transcript-mismatch" });
  });
  it("requires a verified genomic identity, ignoring protein residue numbers", async () => {
    expect(await fetch({}, [region], { coordinate: null })).toMatchObject({ regionalStatus: "unverified-locus", regionalConstraint: null });
    expect(await fetch({}, [region], { transcriptId: null })).toMatchObject({ regionalStatus: "unverified-locus" });
    expect(await fetch({}, [region], { coordinate: { ...coordinate, assembly: "GRCh37" } })).toMatchObject({ regionalStatus: "unverified-locus" });
  });
  it.each([100, 200])("matches inclusive endpoint %s", async pos => {
    expect(await fetch({}, [region], { coordinate: { ...coordinate, pos } })).toMatchObject({ regionalStatus: "measured" });
  });
  it("withholds a locus outside released intervals", async () => {
    expect(await fetch({}, [region], { coordinate: { ...coordinate, pos: 201 } })).toMatchObject({ regionalStatus: "outside-region", regionalConstraint: null });
  });
  it("refuses ambiguous overlapping intervals", async () => {
    expect(await fetch({}, [region, { ...region, start: 150 }])).toMatchObject({ regionalStatus: "invalid-data", regionalConstraint: null });
  });
  it("requires explicit passed coverage QC", async () => {
    expect(await fetch({}, [{ ...region, highCoverage: false }])).toMatchObject({ regionalStatus: "failed-qc", regionalConstraint: null });
  });
  it.each([-1, NaN, Infinity, 1.1, ""])("rejects invalid p value %s", async p => {
    expect(await fetch({}, [{ ...region, p: p as number }])).toMatchObject({ regionalStatus: "invalid-data", regionalConstraint: null });
  });
  it("preserves a nonsignificant match", async () => {
    expect(await fetch({}, [{ ...region, p: 0.05 }])).toMatchObject({ regionalStatus: "nonsignificant", regionalConstraint: { isConstrained: false, pValue: 0.05, oeRatio: 0.5 } });
  });
  it("does not call nondepleted regions constrained", async () => {
    expect(await fetch({}, [{ ...region, oe: 1.2 }])).toMatchObject({ regionalStatus: "nonsignificant", regionalConstraint: { isConstrained: false } });
  });
  it.each([{ flags: ["low_coverage"] }, { expected: { syn: 0, mis: 100, lof: 10 } }])("withholds flagged or uncalibrated gene metrics", async overrides => {
    expect(await fetch(overrides)).toMatchObject({ missense_z: null, loeuf: null, pli: null, isPP2Constrained: false, regionalStatus: "failed-qc" });
  });
  it("selects the sole protein-coding transcript when it is neither MANE nor canonical", async () => {
    const sole = await fetchGnomadGeneConstraint("TEST", null, { index: index({}, [], [{ ...row, mane: false, canonical: false }]) });
    expect(sole).toMatchObject({ missense_z: row.missense_z, provenance: { selection: "sole-transcript" } });
  });
  it("refuses genuinely ambiguous transcript identity without throwing, and reports a missing gene as null", async () => {
    const two = [{ ...row, mane: false, canonical: false }, { ...row, mane: false, canonical: false, transcriptId: "ENST00000000002", geneId: "ENSG00000000002" }];
    expect(await fetchGnomadGeneConstraint("TEST", null, { index: index({}, [], two) })).toBeNull();
    expect(await fetchGnomadGeneConstraint("ABSENT", null, { index: index() })).toBeNull();
  });
  it("matches regional intervals for a lowercase contig", async () => {
    expect(await fetch({}, [{ ...region, chrom: "X" }], { coordinate: { ...coordinate, chrom: "chrx" } })).toMatchObject({ regionalStatus: "measured" });
  });
  it("checks actual packaged v4.1.2 scores and corrected bins", async () => {
    const bundled = getConstraintIndex();
    expect(bundled.snapshot.rows.length).toBeGreaterThan(80000);
    expect(await fetchGnomadGeneConstraint("BRCA1")).toMatchObject({ missense_z: 1.7336, loeuf: 0.92759, loeufPercentile: 51, provenance: { release: "4.1.2", transcriptId: "ENST00000357654" } });
    expect(bundled.snapshot.rows.some(r => r.percentile === 99)).toBe(true);
  });
});
