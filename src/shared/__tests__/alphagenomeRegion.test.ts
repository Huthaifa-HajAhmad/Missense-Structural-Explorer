import { describe, expect, it } from "vitest";
import {
  MAX_SATURATION_REGION_BP,
  buildSaturationRegion
} from "../alphagenomeRegion";

describe("buildSaturationRegion", () => {
  it("returns null without a chromosome, so no request is claimed", () => {
    expect(buildSaturationRegion({ genomicPos: 1000 })).toBeNull();
    expect(buildSaturationRegion({ chrom: "", genomicPos: 1000 })).toBeNull();
  });

  it("returns null when neither a position nor an exon exists", () => {
    expect(buildSaturationRegion({ chrom: "chr17" })).toBeNull();
  });

  it("strips the chr prefix and centres ±45 bp on the variant", () => {
    const region = buildSaturationRegion({ chrom: "chr17", genomicPos: 1000 })!;
    expect(region.chrom).toBe("17");
    expect(region).toMatchObject({ start: 955, end: 1045, clamped: false });
  });

  it("prefers the exon with its ±15 bp splice flank over the variant window", () => {
    const region = buildSaturationRegion({
      chrom: "7",
      genomicPos: 5000,
      exonStart: 4000,
      exonEnd: 4200
    })!;
    expect(region).toMatchObject({ start: 3985, end: 4215, clamped: false });
  });

  it("keeps the window inside the contract cap for a wide exon", () => {
    const region = buildSaturationRegion({
      chrom: "1",
      genomicPos: 100000,
      exonStart: 95000,
      exonEnd: 115000
    })!;
    expect(region.clamped).toBe(true);
    expect(region.end - region.start + 1).toBe(MAX_SATURATION_REGION_BP);
    expect(region.end - region.start + 1).toBeLessThanOrEqual(5000);
  });

  it("centres the clamped window on the queried variant", () => {
    const genomicPos = 105000;
    const region = buildSaturationRegion({
      chrom: "1",
      genomicPos,
      exonStart: 95000,
      exonEnd: 115000
    })!;
    expect(region.start).toBe(genomicPos - Math.floor(MAX_SATURATION_REGION_BP / 2));
    expect(region.end).toBe(region.start + MAX_SATURATION_REGION_BP - 1);
  });

  it("falls back to the exon midpoint when the variant lies outside the exon", () => {
    const region = buildSaturationRegion({
      chrom: "1",
      genomicPos: 500,
      exonStart: 95000,
      exonEnd: 115000
    })!;
    expect(region.clamped).toBe(true);
    expect(region.start).toBeLessThan(105000);
    expect(region.end).toBeGreaterThan(105000);
  });

  it("never emits a start below 1 or an inverted window near the contig origin", () => {
    const region = buildSaturationRegion({
      chrom: "1",
      genomicPos: 10,
      exonStart: 1,
      exonEnd: 60000
    })!;
    expect(region.start).toBeGreaterThanOrEqual(1);
    expect(region.end).toBeGreaterThan(region.start);
  });

  it("keeps only the two strand values the request contract allows", () => {
    expect(buildSaturationRegion({ chrom: "1", genomicPos: 100, strand: "-" })!.strand).toBe("-");
    expect(buildSaturationRegion({ chrom: "1", genomicPos: 100, strand: "x" })!.strand).toBeUndefined();
  });
});
