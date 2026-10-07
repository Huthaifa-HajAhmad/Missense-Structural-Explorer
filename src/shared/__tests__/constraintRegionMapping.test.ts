import { describe, expect, it } from "vitest";
import { codingSegments, mapGenomicIntervalToProtein, proteinLengthOf } from "../constraintRegionMapping";

// Two-exon model: coding exon 1 is genomic 110–151, coding exon 2 is 200–241; CDS is 110–241.
// The CDS is 84 bases including a termination codon, so the translated length is 27.
const forward = { strand: 1, cdsStart: 110, cdsEnd: 241, exons: [{ start: 100, end: 151 }, { start: 200, end: 250 }], proteinLength: 27 };
const reverse = { strand: -1, cdsStart: 110, cdsEnd: 241, exons: [{ start: 100, end: 151 }, { start: 200, end: 250 }], proteinLength: 27 };
// A split-codon model: coding exon 1 is 22 bases (not a multiple of 3), so a codon spans the intron.
const split = { strand: 1, cdsStart: 100, cdsEnd: 143, exons: [{ start: 100, end: 121 }, { start: 130, end: 143 }], proteinLength: 12 };

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

  it("clamps a span that reaches the termination codon to the translated length", () => {
    expect(proteinLengthOf(forward)).toBe(27);
    // the whole model would otherwise end at residue 28 (the stop codon)
    expect(mapGenomicIntervalToProtein(forward, 1, 1000)).toEqual({ start: 1, end: 27 });
    // an interval over only the stop codon (genomic 239–241) clamps to the last residue
    expect(mapGenomicIntervalToProtein(forward, 239, 241)).toEqual({ start: 27, end: 27 });
  });

  it("refuses an interval with no coding overlap", () => {
    expect(mapGenomicIntervalToProtein(forward, 1, 99)).toBeNull();
    expect(mapGenomicIntervalToProtein(forward, 160, 199)).toBeNull();
    expect(mapGenomicIntervalToProtein(forward, 242, 300)).toBeNull();
  });

  it("maps in transcript order on the reverse strand", () => {
    // the highest coding base (241) is residue 1; 200..241 → residues 1..14
    expect(mapGenomicIntervalToProtein(reverse, 200, 241)).toEqual({ start: 1, end: 14 });
    // the lowest coding base (110) is the last residue
    expect(mapGenomicIntervalToProtein(reverse, 110, 110)).toEqual({ start: 27, end: 27 });
  });

  it("crosses an intron on the reverse strand", () => {
    // covers the 3' end of transcript-first exon 2 (200..210 → offsets 31..41) and the 5' end of
    // exon 1 (150..151 → offsets 42..43) → residues 11..15
    expect(mapGenomicIntervalToProtein(reverse, 150, 210)).toEqual({ start: 11, end: 15 });
  });

  it("keeps a codon that spans an intron on one residue", () => {
    // coding bases at offsets 21 (121), 22 (130) and 23 (131) form residue 8
    expect(mapGenomicIntervalToProtein(split, 121, 131)).toEqual({ start: 8, end: 8 });
    expect(mapGenomicIntervalToProtein(split, 121, 121)).toEqual({ start: 8, end: 8 });
    expect(mapGenomicIntervalToProtein(split, 130, 130)).toEqual({ start: 8, end: 8 });
  });

  it("accepts endpoints in either order and returns ascending residues", () => {
    expect(mapGenomicIntervalToProtein(forward, 151, 110)).toEqual({ start: 1, end: 14 });
  });
});
