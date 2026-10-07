import { describe, expect, it } from "vitest";
import { codingSegments, mapGenomicIntervalToProtein, proteinLengthOf } from "../constraintRegionMapping";

// Two-exon model: coding exon 1 is genomic 110–151, coding exon 2 is 200–241; CDS is 110–241.
// Both coding segments are 42 bases, so the CDS is 84 bases = 28 codons on either strand.
const forward = { strand: 1, cdsStart: 110, cdsEnd: 241, exons: [{ start: 100, end: 151 }, { start: 200, end: 250 }] };
const reverse = { strand: -1, cdsStart: 110, cdsEnd: 241, exons: [{ start: 100, end: 151 }, { start: 200, end: 250 }] };

describe("codingSegments", () => {
  it("clips exons to the CDS and orders them in transcript direction", () => {
    expect(codingSegments(forward)).toEqual([{ start: 110, end: 151 }, { start: 200, end: 241 }]);
    expect(codingSegments(reverse)).toEqual([{ start: 200, end: 241 }, { start: 110, end: 151 }]);
  });
});

describe("mapGenomicIntervalToProtein", () => {
  it("maps a single coding-exon interval to a residue span on the forward strand", () => {
    // offsets 0..41 → residues 1..14
    expect(mapGenomicIntervalToProtein(forward, 110, 151)).toEqual({ start: 1, end: 14 });
  });

  it("keeps a span that crosses an intron contiguous", () => {
    // exon1 offsets 0..41, then exon2 offsets 42..52 → residues 1..18
    expect(mapGenomicIntervalToProtein(forward, 110, 210)).toEqual({ start: 1, end: 18 });
  });

  it("returns the whole coding span for an interval covering the model", () => {
    expect(proteinLengthOf(forward)).toBe(28);
    expect(mapGenomicIntervalToProtein(forward, 1, 1000)).toEqual({ start: 1, end: 28 });
  });

  it("refuses an interval with no coding overlap", () => {
    expect(mapGenomicIntervalToProtein(forward, 1, 99)).toBeNull();
    expect(mapGenomicIntervalToProtein(forward, 160, 199)).toBeNull();
    expect(mapGenomicIntervalToProtein(forward, 242, 300)).toBeNull();
  });

  it("maps in transcript order on the reverse strand", () => {
    // the highest coding base (241) is residue 1; 200..241 → residues 1..14
    expect(mapGenomicIntervalToProtein(reverse, 200, 241)).toEqual({ start: 1, end: 14 });
    // the lowest coding base (110) is the final residue
    expect(mapGenomicIntervalToProtein(reverse, 110, 110)).toEqual({ start: 28, end: 28 });
  });

  it("accepts endpoints in either order and returns ascending residues", () => {
    expect(mapGenomicIntervalToProtein(forward, 151, 110)).toEqual({ start: 1, end: 14 });
  });
});
